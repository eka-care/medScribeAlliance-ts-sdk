/**
 * RecordingManager — orchestrates the full recording lifecycle.
 *
 * Responsibilities:
 * - start(): validate options → create session → create recorder → initialize → start
 * - pause() / resume(): delegate to active recorder, dispatch state events
 * - stop(): stop recorder (flush + wait uploads) → end session → return results
 * - updateAuthToken(): forward to active recorder
 *
 * Decides which recorder to use based on uploadType:
 * - 'chunked' (default) → ChunkedRecorder (VAD + chunked upload)
 * - 'single' → SingleRecorder (MediaRecorder + single file upload)
 *
 * All events are dispatched via CallbackRegistry:
 * - onRecordingStateChange: started, paused, resumed, ended
 * - onSessionEvent: created, ended
 * - onError: validation, session, or recorder errors
 *
 * This class does NOT own the session/discovery/transport layers —
 * it receives them from ScribeClient and coordinates between them.
 */

import type {
  IRecorder,
  RecordingOptions,
  RecorderConfig,
  EndRecordingResult,
  RetryUploadResult,
} from '../types/recording';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EndSessionResponse,
  SessionUploadInfo,
} from '../types/session';
import type { ApiCallResult } from '../types/common';
import type { ITransport } from '../types/transport';
import { CallbackRegistry } from '../callbacks/callback-registry';
import { SessionManager } from '../session/session-manager';
import { DiscoveryManager } from '../discovery/discovery-manager';
import { ChunkedRecorder } from './chunked-recorder';
import { SingleRecorder } from './single-recorder';
import type { WorkerManagerConfig } from '../worker/worker-manager';
import { ScribeError } from '../utils/errors';
import { getStorageProvider } from '../storage/storage-provider-factory';
import { uploadFileToStorage } from '../storage/upload-file';
import {
  RecordingState,
  SessionEventType,
  ErrorEventType,
  ErrorCode,
  UploadEventType,
} from '../constants';

export interface RecordingManagerConfig {
  workerConfig?: WorkerManagerConfig;
  debug?: boolean;
  /** Optional `flavour` identifier — sent as a header on chunk upload requests. */
  flavour?: string;
}

export class RecordingManager {
  private callbackRegistry: CallbackRegistry;
  private sessionManager: SessionManager;
  private discoveryManager: DiscoveryManager;
  private transport: ITransport;
  private config: RecordingManagerConfig;

  // Active recording state
  private recorder: IRecorder | null = null;
  private activeSession: CreateSessionResponse | null = null;
  private activeBaseUrl: string = '';
  private _isRecording: boolean = false;
  private _isStarting: boolean = false;
  private _startGeneration: number = 0;

  // Retry context — survives after stop(), cleared on reset() or next start()
  private retryContext: {
    upload: SessionUploadInfo;
    storageProvider: string;
    failedChunks: Array<{ fileName: string; blob: Blob }>;
  } | null = null;

  constructor(
    callbackRegistry: CallbackRegistry,
    sessionManager: SessionManager,
    discoveryManager: DiscoveryManager,
    transport: ITransport,
    config?: RecordingManagerConfig
  ) {
    this.callbackRegistry = callbackRegistry;
    this.sessionManager = sessionManager;
    this.discoveryManager = discoveryManager;
    this.transport = transport;
    this.config = config ?? {};
  }

  /**
   * Start a recording session:
   * 1. Map RecordingOptions → CreateSessionRequest
   * 2. Create session via SessionManager
   * 3. Create and initialize the appropriate recorder
   * 4. Start recording
   * 5. Dispatch events
   *
   * Race-safety: Uses a generation counter (`_startGeneration`) so that if
   * clearRecordingState() or reset() is called while this method is suspended
   * at an `await`, the resumed call detects the mismatch and aborts instead
   * of creating an orphaned recorder with a leaked mic/VAD.
   *
   * @param baseUrl - Server base URL (from discovery or SDK config)
   * @param options - Recording options (templates, model, etc.)
   * @param accessToken - Current Bearer token for upload auth headers
   * @returns The created session response
   */
  async start(
    baseUrl: string,
    options: RecordingOptions,
    accessToken?: string
  ): Promise<ApiCallResult<CreateSessionResponse>> {
    if (this._isRecording || this._isStarting) {
      throw new ScribeError('Recording is already in progress. Stop the current recording first.');
    }

    this._isStarting = true;
    const gen = ++this._startGeneration;

    // Clear any previous retry context
    this.retryContext = null;
    this.activeBaseUrl = baseUrl;

    // Determine upload type — default to 'chunked'
    const uploadType = options.uploadType ?? 'chunked';
    const communicationProtocol = options.communicationProtocol ?? 'http';

    // 1. Build CreateSessionRequest from RecordingOptions (camelCase → snake_case)
    const sessionRequest: CreateSessionRequest = {
      templates: options.templates,
      upload_type: uploadType,
      communication_protocol: communicationProtocol,
      model: options.model,
      language_hint: options.languageHint,
      transcript_language: options.transcriptLanguage,
      additional_data: options.additionalData,
      session_mode: options.sessionMode,
      patient_details: options.patientDetails,
      session_id: options.sessionId,
    };

    try {
      // 2. Create session — transport/validation errors possible
      let session: CreateSessionResponse;
      let createSessionHttpStatus: number | undefined;
      try {
        const createResult = await this.sessionManager.createSession(baseUrl, sessionRequest);
        session = createResult.data;
        createSessionHttpStatus = createResult.httpStatus;
      } catch (error) {
        if (gen === this._startGeneration) {
          this.dispatchStartError(
            ErrorEventType.TRANSPORT_ERROR,
            ErrorCode.SESSION_CREATION_FAILED,
            error
          );
        }
        throw error;
      }

      // Abort if superseded by a concurrent clear + start
      if (gen !== this._startGeneration) {
        throw new ScribeError('Recording start was superseded by a concurrent operation.');
      }

      this.activeSession = session;

      // Fail fast on an unsupported provider before touching the mic/VAD.
      let storageProvider: string;
      try {
        storageProvider = this.resolveStorageProviderName();
      } catch (error) {
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(
            ErrorEventType.VALIDATION_ERROR,
            ErrorCode.UNSUPPORTED_STORAGE_PROVIDER,
            error
          );
        }
        throw error;
      }

      // Dispatch session created event
      this.callbackRegistry.dispatch('onSessionEvent', {
        type: SessionEventType.CREATED,
        timestamp: new Date().toISOString(),
        data: session,
      });

      // 3. Create the appropriate recorder (local ref for safe cleanup if superseded)
      const recorder = this.createRecorder(uploadType);
      this.recorder = recorder;

      // 4. Initialize recorder with session details
      const recorderConfig: RecorderConfig = {
        accessToken,
        upload: session.upload_url,
        storageProvider,
        uploadHeaders: this.buildUploadHeaders(accessToken),
        sessionId: session.session_id,
      };

      try {
        recorder.initialize(session, recorderConfig);
      } catch (error) {
        try { recorder.reset(); } catch {}
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(
            ErrorEventType.VALIDATION_ERROR,
            ErrorCode.RECORDER_INIT_FAILED,
            error
          );
        }
        throw error;
      }

      // Apply discovery-driven chunk length overrides for chunked recorder
      if (recorder instanceof ChunkedRecorder) {
        this.applyDiscoveryOverrides(recorder);
      }

      // 5. Start recording — VAD/mic errors possible
      try {
        await recorder.start(options.deviceId);
      } catch (error) {
        try { recorder.reset(); } catch {}
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(ErrorEventType.VAD_ERROR, ErrorCode.VAD_START_FAILED, error);
        }
        throw error;
      }

      // Abort if superseded during recorder.start() (mic/VAD acquisition)
      if (gen !== this._startGeneration) {
        try { recorder.reset(); } catch {}
        throw new ScribeError('Recording start was superseded by a concurrent operation.');
      }

      this._isRecording = true;

      // Dispatch recording state change
      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.STARTED,
        timestamp: new Date().toISOString(),
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Recording started:', session.session_id);
      }

      return { data: session, httpStatus: createSessionHttpStatus };
    } finally {
      if (gen === this._startGeneration) {
        this._isStarting = false;
      }
    }
  }

  /**
   * Start recording for an already-created session.
   * Use this when the session was created externally (e.g. via createSession())
   * and you want to attach a recorder to it.
   *
   * @param baseUrl - Server base URL for ending session later
   * @param session - The existing session response (must have upload_url)
   * @param options - Upload type and optional device ID
   * @param accessToken - Current Bearer token for upload auth headers
   */
  async startWithExistingSession(
    baseUrl: string,
    session: CreateSessionResponse,
    options?: { uploadType?: string; deviceId?: string },
    accessToken?: string
  ): Promise<ApiCallResult<void>> {
    if (this._isRecording || this._isStarting) {
      throw new ScribeError('Recording is already in progress. Stop the current recording first.');
    }

    this._isStarting = true;
    // Generation counter — see start() for explanation
    const gen = ++this._startGeneration;

    // Clear any previous retry context
    this.retryContext = null;
    this.activeBaseUrl = baseUrl;

    const uploadType = options?.uploadType ?? 'chunked';

    this.activeSession = session;

    try {
      // Fail fast on an unsupported provider before touching the mic/VAD.
      let storageProvider: string;
      try {
        storageProvider = this.resolveStorageProviderName();
      } catch (error) {
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(
            ErrorEventType.VALIDATION_ERROR,
            ErrorCode.UNSUPPORTED_STORAGE_PROVIDER,
            error
          );
        }
        throw error;
      }

      // Create the appropriate recorder (local ref for safe cleanup if superseded)
      const recorder = this.createRecorder(uploadType);
      this.recorder = recorder;

      // Initialize recorder with session details
      const recorderConfig: RecorderConfig = {
        accessToken,
        upload: session.upload_url,
        storageProvider,
        uploadHeaders: this.buildUploadHeaders(accessToken),
        sessionId: session.session_id,
      };

      try {
        recorder.initialize(session, recorderConfig);
      } catch (error) {
        try { recorder.reset(); } catch {}
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(
            ErrorEventType.VALIDATION_ERROR,
            ErrorCode.RECORDER_INIT_FAILED,
            error
          );
        }
        throw error;
      }

      // Apply discovery-driven chunk length overrides for chunked recorder
      if (recorder instanceof ChunkedRecorder) {
        this.applyDiscoveryOverrides(recorder);
      }

      // Start recording — VAD/mic errors possible
      try {
        await recorder.start(options?.deviceId);
      } catch (error) {
        try { recorder.reset(); } catch {}
        if (gen === this._startGeneration) {
          this.cleanupRecordingState();
          this.dispatchStartError(ErrorEventType.VAD_ERROR, ErrorCode.VAD_START_FAILED, error);
        }
        throw error;
      }

      // Abort if superseded during recorder.start() (mic/VAD acquisition)
      if (gen !== this._startGeneration) {
        try { recorder.reset(); } catch {}
        throw new ScribeError('Recording start was superseded by a concurrent operation.');
      }

      this._isRecording = true;

      // Dispatch recording state change
      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.STARTED,
        timestamp: new Date().toISOString(),
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Recording started with existing session:', session.session_id);
      }

      // No HTTP call in this path — session was created externally and passed in.
      return { data: undefined, httpStatus: undefined };
    } finally {
      if (gen === this._startGeneration) {
        this._isStarting = false;
      }
    }
  }

  /**
   * Pause the active recording.
   */
  pause(): void {
    if (!this.recorder || !this._isRecording) {
      return;
    }

    if (!this.recorder.isPaused()) {
      this.recorder.pause();

      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.PAUSED,
        timestamp: new Date().toISOString(),
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Recording paused');
      }
    }
  }

  /**
   * Resume a paused recording.
   */
  resume(): void {
    if (!this.recorder || !this._isRecording) {
      return;
    }

    if (this.recorder.isPaused()) {
      this.recorder.resume();

      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.RESUMED,
        timestamp: new Date().toISOString(),
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Recording resumed');
      }
    }
  }

  async stop(): Promise<ApiCallResult<EndRecordingResult>> {
    if (!this.recorder || !this._isRecording) {
      return {
        data: { failedUploads: [], totalFiles: 0, sessionEnded: false },
        httpStatus: undefined,
      };
    }

    let sessionEnded = false;
    let endSessionHttpStatus: number | undefined;

    try {
      // 1. Stop recorder — flushes last chunk, waits for all uploads
      const stopResult = await this.recorder.stop();

      // 2. Preserve failed chunks for retry before cleanup destroys state
      this.preserveRetryContext();

      // Recorder has stopped — flip the flag now so the internal retry pass
      // below doesn't trip retryFailedUploads()'s _isRecording guard.
      this._isRecording = false;

      // 3. If any uploads failed, run one internal retry pass.
      let currentFailedUploads = stopResult.failedUploads;
      if (currentFailedUploads.length > 0) {
        try {
          const retryResult = await this.retryFailedUploads();
          currentFailedUploads = retryResult.data.stillFailed;
        } catch (retryError) {
          console.error('[ScribeSDK] Internal retry pass failed:', retryError);
          this.callbackRegistry.dispatch('onError', {
            type: ErrorEventType.TRANSPORT_ERROR,
            timestamp: new Date().toISOString(),
            error: {
              code: ErrorCode.INTERNAL_RETRY_FAILED,
              message: retryError instanceof Error ? retryError.message : 'Retry pass failed',
            },
          });
        }
      }

      const result: EndRecordingResult = {
        failedUploads: currentFailedUploads,
        totalFiles: stopResult.totalFiles,
        sessionEnded: false,
      };

      // 4. End session ONLY if every chunk uploaded successfully.
      if (currentFailedUploads.length === 0 && this.activeSession) {
        const finalize = await this.finalizeSession(stopResult.totalFiles, stopResult.totalFiles);
        if (finalize) {
          result.sessionEnded = true;
          result.endSessionResponse = finalize.data;
          endSessionHttpStatus = finalize.httpStatus;
          sessionEnded = true;
        }
      }

      // 5. Dispatch recording ended
      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.ENDED,
        timestamp: new Date().toISOString(),
        data: result,
      });

      if (this.config.debug) {
        console.log('[ScribeSDK] Recording stopped:', {
          totalFiles: result.totalFiles,
          failedUploads: result.failedUploads.length,
          sessionEnded: result.sessionEnded,
        });
      }

      return { data: result, httpStatus: endSessionHttpStatus };
    } catch (error) {
      console.error('[ScribeSDK] Error stopping recording:', error);

      // Dispatch error so consumers know the stop encountered a problem
      this.callbackRegistry.dispatch('onError', {
        type: ErrorEventType.TRANSPORT_ERROR,
        timestamp: new Date().toISOString(),
        error: {
          code: ErrorCode.STOP_FAILED,
          message: error instanceof Error ? error.message : 'Failed to stop recording',
        },
      });

      return {
        data: { failedUploads: [], totalFiles: 0, sessionEnded: false },
        httpStatus: undefined,
      };
    } finally {
      // Cleanup:
      // - sessionEnded === true: full cleanup (drop session + retry context).
      // - sessionEnded === false: partial cleanup — release recorder but keep
      //   activeSession/activeBaseUrl/retryContext so the consumer can retry
      //   uploads and call scribe.endSession() explicitly.
      if (sessionEnded) {
        this.cleanupRecordingState();
      } else {
        this.partialCleanupAfterFailedFinalize();
      }
    }
  }

  /**
   * End the session, dispatch onSessionEvent, and return the response.
   * Called from stop() (auto-finalize) and finalizeAfterExternalEndSession()
   * (consumer-driven). Returns undefined and dispatches onError on failure.
   * Caller is responsible for cleanup.
   */
  private async finalizeSession(
    totalFiles: number,
    successfulUploads: number
  ): Promise<ApiCallResult<EndSessionResponse> | undefined> {
    if (!this.activeSession) {
      return undefined;
    }

    try {
      const endResult = await this.sessionManager.endSession(
        this.activeBaseUrl,
        {
          audio_files_sent: totalFiles,
          audio_files_uploaded: successfulUploads,
        },
        this.activeSession.session_id
      );

      this.callbackRegistry.dispatch('onSessionEvent', {
        type: SessionEventType.ENDED,
        timestamp: new Date().toISOString(),
        data: endResult.data,
      });

      return endResult;
    } catch (error) {
      console.error('[ScribeSDK] Failed to end session:', error);
      this.callbackRegistry.dispatch('onError', {
        type: ErrorEventType.TRANSPORT_ERROR,
        timestamp: new Date().toISOString(),
        error: {
          code: ErrorCode.SESSION_END_FAILED,
          message: error instanceof Error ? error.message : 'Failed to end session',
        },
      });
      return undefined;
    }
  }

  /**
   * Immediately stop the recorder without calling endSession or waiting for uploads.
   * Used by cancelSession — we don't want the server to start processing
   * and don't want to block on pending uploads.
   */
  forceStop(): void {
    // Invalidate any in-flight start() so it aborts after its next await
    ++this._startGeneration;

    if (!this.recorder || !this._isRecording) {
      return;
    }

    try {
      // reset() is immediate: destroys VAD, releases mic, terminates worker.
      // Does NOT flush remaining audio or wait for pending uploads.
      this.recorder.reset();
    } catch (error) {
      console.error('[ScribeSDK] Error in forceStop:', error);
    } finally {
      this.callbackRegistry.dispatch('onRecordingStateChange', {
        type: RecordingState.ENDED,
        timestamp: new Date().toISOString(),
        data: { failedUploads: [], totalFiles: 0 },
      });

      this.cleanupRecordingState();
    }
  }

  /**
   * Override the session chunk limit, allowing unlimited chunks.
   * Only applies to ChunkedRecorder.
   */
  forceAllowMoreChunks(): void {
    if (this.recorder && this.recorder instanceof ChunkedRecorder) {
      this.recorder.forceAllowMoreChunks();
    }
  }

  /**
   * Update the auth token for the active recording.
   * Forwards to the active recorder (which updates WorkerManager/transport).
   */
  updateAuthToken(token: string): void {
    if (this.recorder && this.recorder instanceof ChunkedRecorder) {
      this.recorder.updateAuthToken(token);
    }
    // Also update transport directly for SingleRecorder and session calls
    this.transport.setAuthToken(token);
  }

  /**
   * Reset everything — force-stops if recording, clears state.
   */
  reset(): void {
    // Invalidate any in-flight start() so it aborts after its next await
    ++this._startGeneration;
    if (this.recorder) {
      this.recorder.reset();
    }
    this.retryContext = null;
    this.cleanupRecordingState();
  }

  isRecording(): boolean {
    return this._isRecording;
  }

  isPaused(): boolean {
    return this.recorder?.isPaused() ?? false;
  }

  getActiveSession(): CreateSessionResponse | null {
    return this.activeSession;
  }

  /**
   * Check if there are failed uploads from the last recording that can be retried.
   */
  hasFailedUploads(): boolean {
    return (this.retryContext?.failedChunks.length ?? 0) > 0;
  }

  /**
   * Called by ScribeClient.endSession() after a successful external endSession.
   * Clears the preserved recording-manager state (activeSession, activeBaseUrl,
   * retryContext) when the ended session matches our active one.
   *
   * If the consumer ended a different session, leaves our state alone.
   */
  finalizeAfterExternalEndSession(sessionId: string): void {
    if (!this.activeSession) {
      return;
    }
    if (this.activeSession.session_id !== sessionId) {
      return;
    }
    this.activeSession = null;
    this.activeBaseUrl = '';
    this.retryContext = null;
  }

  /**
   * Retry uploading audio files that failed during the last recording.
   * Uses the stored MP3 blobs and the same storage provider as the recording.
   *
   * Each file is re-uploaded via transport.request() with retry logic.
   * Successfully retried files are removed from the retry context.
   */
  async retryFailedUploads(): Promise<ApiCallResult<RetryUploadResult>> {
    if (this._isRecording) {
      throw new ScribeError('Cannot retry uploads while recording is active.');
    }

    if (!this.retryContext || this.retryContext.failedChunks.length === 0) {
      return { data: { retried: 0, succeeded: 0, stillFailed: [] }, httpStatus: undefined };
    }

    const { upload, storageProvider: storageProviderName, failedChunks } = this.retryContext;
    const retried = failedChunks.length;
    const stillFailed: string[] = [];
    let succeeded = 0;

    if (this.config.debug) {
      console.log(`[ScribeSDK] Retrying ${retried} failed uploads`);
    }

    for (const chunk of failedChunks) {
      try {
        await uploadFileToStorage(this.transport, {
          fileName: chunk.fileName,
          blob: chunk.blob,
          upload,
          storageProvider: storageProviderName,
          maxRetries: 0,
        });

        succeeded++;

        this.callbackRegistry.dispatch('onUploadEvent', {
          type: UploadEventType.PROGRESS,
          timestamp: new Date().toISOString(),
          data: { successCount: succeeded, totalCount: retried },
        });

        if (this.config.debug) {
          console.log(`[ScribeSDK] Retry succeeded: ${chunk.fileName}`);
        }
      } catch (error) {
        stillFailed.push(chunk.fileName);

        this.callbackRegistry.dispatch('onUploadEvent', {
          type: UploadEventType.FAILED,
          timestamp: new Date().toISOString(),
          data: {
            fileName: chunk.fileName,
            error: error instanceof Error ? error.message : 'Retry failed',
          },
        });

        if (this.config.debug) {
          console.log(`[ScribeSDK] Retry failed: ${chunk.fileName}`, error);
        }
      }
    }

    // Update retry context — keep only the files that still failed
    if (stillFailed.length === 0) {
      this.retryContext = null;
    } else {
      this.retryContext.failedChunks = failedChunks.filter((chunk) =>
        stillFailed.includes(chunk.fileName)
      );
    }

    if (this.config.debug) {
      console.log(`[ScribeSDK] Retry complete: ${succeeded}/${retried} succeeded`);
    }

    // No single HTTP call for the aggregate retry pass — httpStatus is undefined.
    return { data: { retried, succeeded, stillFailed }, httpStatus: undefined };
  }

  // --- Private ---

  /**
   * Create the appropriate recorder based on upload type.
   */
  private createRecorder(uploadType: string): IRecorder {
    if (uploadType === 'single') {
      return new SingleRecorder(this.callbackRegistry, this.transport);
    }

    // Default to chunked
    return new ChunkedRecorder(
      this.callbackRegistry,
      this.transport,
      undefined, // vadConfig — use defaults, overridden by discovery below
      this.config.workerConfig
    );
  }

  /** Storage provider name from discovery; defaults to 'aws'. */
  private getStorageProviderName(): string {
    try {
      return this.discoveryManager.getResolvedConfig().storageProvider || 'aws';
    } catch {
      return 'aws';
    }
  }

  /** Validate the provider has a wrapper (throws UnsupportedStorageProviderError) and return its name. */
  private resolveStorageProviderName(): string {
    const name = this.getStorageProviderName();
    getStorageProvider(name);
    return name;
  }

  /**
   * Build upload headers from the current auth state.
   */
  private buildUploadHeaders(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (this.config.flavour) {
      headers['flavour'] = this.config.flavour;
    }
    return headers;
  }

  /**
   * Apply discovery-driven overrides to ChunkedRecorder's VAD config.
   * For example, max_chunk_duration_seconds from discovery overrides the default.
   */
  private applyDiscoveryOverrides(recorder: ChunkedRecorder): void {
    try {
      const resolvedConfig = this.discoveryManager.getResolvedConfig();

      if (resolvedConfig.maxChunkDurationSeconds) {
        recorder.updateChunkLengths({
          maxChunkLength: resolvedConfig.maxChunkDurationSeconds,
        });
      }
    } catch {
      // Discovery may not have been fetched — use defaults
    }
  }

  /**
   * Dispatch an error event for a specific start() step failure.
   */
  private dispatchStartError(type: ErrorEventType, code: ErrorCode, error: unknown): void {
    this.callbackRegistry.dispatch('onError', {
      type,
      timestamp: new Date().toISOString(),
      error: {
        code,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }

  /**
   * Extract failed chunks with their blobs from the recorder
   * before cleanup destroys the recorder state.
   * Supports both ChunkedRecorder and SingleRecorder.
   */
  private preserveRetryContext(): void {
    if (!this.activeSession?.upload_url) {
      this.retryContext = null;
      return;
    }

    let failedChunks: Array<{ fileName: string; blob: Blob }> = [];

    if (this.recorder instanceof ChunkedRecorder) {
      failedChunks = this.recorder
        .getFileManager()
        .getFailedChunksWithBlobs()
        .map((c) => ({ fileName: c.fileName, blob: c.fileBlob }));
    } else if (this.recorder instanceof SingleRecorder) {
      failedChunks = this.recorder.getFailedBlobData();
    }

    if (failedChunks.length === 0) {
      this.retryContext = null;
      return;
    }

    this.retryContext = {
      upload: this.activeSession.upload_url,
      storageProvider: this.getStorageProviderName(),
      failedChunks,
    };

    if (this.config.debug) {
      console.log(`[ScribeSDK] Preserved ${failedChunks.length} failed uploads for retry`);
    }
  }

  /**
   * Clean up recording state after stop or error.
   */
  private cleanupRecordingState(): void {
    this.recorder = null;
    this.activeSession = null;
    this.activeBaseUrl = '';
    this._isRecording = false;
    this._isStarting = false;
  }

  /**
   * Release the recorder (mic, VAD, worker) but preserve session + retry context
   * so the consumer can call retryFailedUploads() and endSession() explicitly.
   *
   * Used when stop() decides NOT to auto-end the session because uploads still
   * failed after the internal retry pass.
   */
  private partialCleanupAfterFailedFinalize(): void {
    this.recorder = null;
    this._isRecording = false;
    this._isStarting = false;
    // Deliberately preserved: activeSession, activeBaseUrl, retryContext
  }
}
