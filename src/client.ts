/**
 * ScribeClient — thin facade for the MedScribe Alliance TS SDK.
 *
 * All public async methods return SDKResult<T> — expected errors
 * (API failures, auth, validation, mic denied) are returned, not thrown.
 * Only programmer errors (bad config at construction) throw.
 *
 * This class does NOT contain business logic — it delegates to:
 * - DiscoveryManager  (discovery + resolved config)
 * - SessionManager    (session CRUD + polling)
 * - RecordingManager  (recorder lifecycle + upload orchestration)
 * - CallbackRegistry  (typed event dispatch)
 * - Validator         (schema + discovery-driven validation)
 * - ITransport        (HTTP or IPC, decided at construction)
 */

import type {
  ScribeSDKConfig,
  RecordingOptions,
  CreateSessionResponse,
  GetSessionStatusResponse,
  PollOptions,
  DiscoveryDocument,
  ResolvedConfig,
  CallbackMap,
  CallbackName,
  CreateSessionRequest,
  EndSessionRequest,
  EndSessionResponse,
  SessionUploadInfo,
  SDKResult,
  ApiCallResult,
  PatchSessionRequest,
  PatchSessionResponse,
  ProcessTemplateResponse,
} from './types';
import { TransportMode, SessionEventType, DiscardReason } from './constants';
import { ScribeError, ValidationError } from './utils/errors';
import { CallbackRegistry } from './callbacks/callback-registry';
import { Validator } from './validation/validator';
import { HttpTransport } from './transport/http-transport';
import { IpcTransport } from './transport/ipc-transport';
import type { ITransport } from './types/transport';
import { DiscoveryManager } from './discovery/discovery-manager';
import { SessionManager } from './session/session-manager';
import { RecordingManager } from './recording/recording-manager';
import type {
  EndRecordingResult,
  RetryUploadResult,
  UploadAudioFileResult,
} from './types/recording';
import { uploadFileToStorage } from './storage/upload-file';

export class ScribeClient {
  private config: ScribeSDKConfig;
  private transport: ITransport;
  private callbackRegistry: CallbackRegistry;
  private validator: Validator;
  private discoveryManager: DiscoveryManager;
  private sessionManager: SessionManager;
  private recordingManager: RecordingManager;

  private isInitialized: boolean = false;

  constructor(config: ScribeSDKConfig) {
    this.validateConfig(config);

    this.config = {
      debug: false,
      autoDiscovery: true,
      mode: TransportMode.DIRECT,
      ...config,
    };

    // 1. Create shared infrastructure (before transport — transport needs onUnauthorized callback)
    this.callbackRegistry = new CallbackRegistry();
    this.validator = new Validator();

    // 2. Create transport based on mode
    this.transport = this.createTransport();

    // 3. Create managers
    this.discoveryManager = new DiscoveryManager(this.transport, this.validator, this.config.debug);

    this.sessionManager = new SessionManager(this.transport, this.validator, this.config.debug);

    this.recordingManager = new RecordingManager(
      this.callbackRegistry,
      this.sessionManager,
      this.discoveryManager,
      this.transport,
      {
        debug: this.config.debug,
        flavour: this.config.flavour,
        workerConfig: this.resolveWorkerConfig(),
      }
    );
  }

  // --- Lifecycle ---

  /**
   * Initialize the SDK — fetches the discovery document if autoDiscovery is enabled.
   * Must be called before starting a recording.
   */
  async init(): Promise<SDKResult<void>> {
    if (this.isInitialized) {
      return { success: true, data: undefined };
    }

    return this.wrapResult<void>(async () => {
      let httpStatus: number | undefined;
      if (this.config.autoDiscovery !== false) {
        const discoveryResult = await this.discoveryManager.fetchDiscovery(this.config.baseUrl);
        httpStatus = discoveryResult.httpStatus;
      }
      this.isInitialized = true;
      return { data: undefined, httpStatus };
    });
  }

  // --- Recording ---

  /**
   * Start a recording session.
   * Calls init() automatically if not already initialized.
   */
  async startRecording(options: RecordingOptions): Promise<SDKResult<CreateSessionResponse>> {
    if (!this.isInitialized) {
      const initResult = await this.init();
      if (!initResult.success) {
        return initResult;
      }
    }

    const baseUrl = this.getEffectiveBaseUrl();

    return this.wrapResult(() => {
      // Validate recording options against discovery capabilities if available
      try {
        const config = this.discoveryManager.getResolvedConfig();
        // this.validator.validateAgainstDiscovery(options, config);
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        // Discovery not available — skip validation, let server validate
      }

      return this.recordingManager.start(baseUrl, options, this.config.accessToken);
    });
  }

  /**
   * Start recording for an already-created session.
   * Use this when the session was created via createSession() and you want
   * to attach a recorder to it.
   *
   * @param session - The session response from createSession()
   * @param options - Upload type ('chunked' | 'single') and optional deviceId
   */
  async startRecordingWithSession(
    session: CreateSessionResponse,
    options?: { uploadType?: string; deviceId?: string }
  ): Promise<SDKResult<void>> {
    if (!this.isInitialized) {
      const initResult = await this.init();
      if (!initResult.success) {
        return initResult;
      }
    }

    const baseUrl = this.getEffectiveBaseUrl();

    return this.wrapResult(() =>
      this.recordingManager.startWithExistingSession(
        baseUrl,
        session,
        options,
        this.config.accessToken
      )
    );
  }

  /**
   * Pause the active recording.
   */
  pauseRecording(): void {
    this.recordingManager.pause();
  }

  /**
   * Resume a paused recording.
   */
  resumeRecording(): void {
    this.recordingManager.resume();
  }

  /**
   * End the active recording.
   *
   * Stops the recorder, flushes pending audio, waits for uploads, and — if
   * everything uploaded — ends the session. If any chunks failed to upload,
   * the SDK runs one internal retry pass; if files still fail, the session
   * is NOT ended and the result reports `sessionEnded: false`.
   */
  async endRecording(): Promise<SDKResult<EndRecordingResult>> {
    return this.wrapResult(() => this.recordingManager.stop());
  }

  /**
   * Retry uploading audio files that failed during the last recording.
   *
   * Available after `endRecording()` returns `sessionEnded: false` (or any time
   * `hasFailedUploads()` is true). After retrying, call `endSession()` to
   * finalize. Retry context is cleared on `reset()` or the next `startRecording()`.
   */
  async retryFailedUploads(): Promise<SDKResult<RetryUploadResult>> {
    return this.wrapResult(() => this.recordingManager.retryFailedUploads());
  }

  /**
   * Check if there are failed uploads from the last recording that can be retried.
   */
  hasFailedUploads(): boolean {
    return this.recordingManager.hasFailedUploads();
  }

  /**
   * Check if a recording is currently active.
   */
  isRecording(): boolean {
    return this.recordingManager.isRecording();
  }

  /**
   * Check if the active recording is paused.
   */
  isRecordingPaused(): boolean {
    return this.recordingManager.isPaused();
  }

  /**
   * Override the 500-chunk session limit, allowing unlimited chunks.
   * Call this after receiving a 'chunk_limit_reached' error to resume chunk uploads.
   */
  forceAllowMoreChunks(): void {
    this.recordingManager.forceAllowMoreChunks();
  }

  // --- Pre-recorded audio ---

  /**
   * Upload a single pre-recorded audio file to storage.
   * @param file - The audio file/blob to upload.
   * @param fileName - Storage object name, e.g. "1.mp3".
   * @param upload - The `upload_url` payload from the create-session response.
   */
  async uploadAudioFile(
    file: Blob,
    fileName: string,
    upload: SessionUploadInfo
  ): Promise<SDKResult<UploadAudioFileResult>> {
    return this.wrapResult(async () => {
      if (!file || file.size === 0) {
        throw new ValidationError('A non-empty audio file is required');
      }
      if (!fileName || !fileName.trim()) {
        throw new ValidationError('fileName is required');
      }
      if (!upload || typeof upload !== 'object') {
        throw new ValidationError('upload (upload_url payload) is required');
      }

      // Provider comes from discovery (createSession already ran it). Defaults to 'aws'.
      const response = await uploadFileToStorage(this.transport, {
        fileName,
        blob: file,
        upload,
        storageProvider: this.getStorageProviderName(),
      });

      return {
        data: {
          fileName,
          status: response.status,
          headers: response.headers,
          response: response.data,
        },
        httpStatus: response.status,
      };
    });
  }

  // --- Session ---

  /**
   * Create a session directly (without starting a recording).
   */
  async createSession(
    sessionRequest: CreateSessionRequest
  ): Promise<SDKResult<CreateSessionResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() => this.sessionManager.createSession(baseUrl, sessionRequest));
  }

  /**
   * End a session directly.
   */
  async endSession(
    request: EndSessionRequest,
    sessionId?: string
  ): Promise<SDKResult<EndSessionResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(async () => {
      // Resolve the session id we're ending BEFORE the call — sessionManager
      // clears its currentSession on success, so reading it after is unreliable.
      const endedSessionId = sessionId ?? this.recordingManager.getActiveSession()?.session_id;

      const result = await this.sessionManager.endSession(baseUrl, request, sessionId);

      if (endedSessionId) {
        this.recordingManager.finalizeAfterExternalEndSession(endedSessionId);
      }

      this.callbackRegistry.dispatch('onSessionEvent', {
        type: SessionEventType.ENDED,
        timestamp: new Date().toISOString(),
        data: result.data,
      });

      return result;
    });
  }

  /**
   * Get the status of a session.
   * Uses the current active session if no sessionId is provided.
   *
   * Pass `poll` options to keep checking until the session reaches a
   * terminal state (completed, partial, failed, expired) or times out.
   *
   * Pass `templateId` to filter status for a specific template.
   */
  async getSessionStatus(
    sessionId?: string,
    options?: { poll?: PollOptions; templateId?: string }
  ): Promise<SDKResult<GetSessionStatusResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    if (options?.poll) {
      return this.wrapResult(() =>
        this.sessionManager.pollForCompletion(baseUrl, sessionId, options.poll, options.templateId)
      );
    }
    return this.wrapResult(() =>
      this.sessionManager.getSessionStatus(baseUrl, sessionId, options?.templateId)
    );
  }

  /**
   * Get the current active session, if any.
   */
  getCurrentSession(): CreateSessionResponse | null {
    return this.recordingManager.getActiveSession() ?? this.sessionManager.getCurrentSession();
  }

  /**
   * Patch/update a session (e.g., update user_status or processing_status).
   * Uses the current active session if no sessionId is provided.
   */
  async updateSession(
    request: PatchSessionRequest,
    sessionId?: string
  ): Promise<SDKResult<PatchSessionResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() => this.sessionManager.patchSession(baseUrl, request, sessionId));
  }

  /**
   * Trigger processing for a specific template in a session.
   * Uses the current active session if no sessionId is provided.
   */
  async processTemplate(
    templateId: string,
    sessionId?: string
  ): Promise<SDKResult<ProcessTemplateResponse>> {
    const baseUrl = this.getEffectiveBaseUrl();
    return this.wrapResult(() =>
      this.sessionManager.processTemplate(baseUrl, templateId, sessionId)
    );
  }

  /**
   * Cancel a session by setting both user_status and processing_status to 'cancelled'.
   * Uses the current active session if no sessionId is provided.
   */
  async cancelSession(sessionId?: string): Promise<SDKResult<PatchSessionResponse>> {
    // Capture session ID before cleanup clears it
    const resolvedSessionId =
      sessionId ??
      this.recordingManager.getActiveSession()?.session_id ??
      this.sessionManager.getCurrentSession()?.session_id;

    // Stop recorder immediately without calling endSession (avoids triggering server processing)
    if (this.recordingManager.isRecording()) {
      this.recordingManager.forceStop();
    }

    // Clean up remaining state (retry context, etc.)
    this.recordingManager.reset();
    this.sessionManager.clearCurrentSession();

    this.callbackRegistry.dispatch('onSessionEvent', {
      type: SessionEventType.DISCARDED,
      timestamp: new Date().toISOString(),
      data: { sessionId: resolvedSessionId ?? null, reason: DiscardReason.CANCELLED },
    });

    return this.updateSession(
      { user_status: 'cancelled', processing_status: 'cancelled' },
      resolvedSessionId
    );
  }

  // --- Discovery ---

  /**
   * Get the resolved discovery config.
   * Returns error if discovery hasn't been fetched yet.
   */
  getDiscoveryConfig(): SDKResult<ResolvedConfig> {
    try {
      return { success: true, data: this.discoveryManager.getResolvedConfig() };
    } catch (error) {
      return { success: false, error: this.toScribeError(error) };
    }
  }

  /**
   * Get the raw discovery document.
   */
  getDiscoveryDocument(): DiscoveryDocument | null {
    return this.discoveryManager.getDiscoveryDocument();
  }

  /**
   * Force refresh the discovery document.
   */
  async refreshDiscovery(): Promise<SDKResult<ResolvedConfig>> {
    return this.wrapResult(() => this.discoveryManager.fetchDiscovery(this.config.baseUrl, true));
  }

  // --- Callbacks ---

  /**
   * Register a callback handler.
   *
   * @example
   * client.registerCallback('onAudioEvent', (event) => {
   *   if (event.type === 'user_speech') console.log('Speaking:', event.data.isSpeaking);
   * });
   */
  registerCallback<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    this.callbackRegistry.register(name, handler);
  }

  /**
   * Remove a previously registered callback handler.
   */
  removeCallback<K extends CallbackName>(name: K, handler: CallbackMap[K]): void {
    this.callbackRegistry.remove(name, handler);
  }

  // --- Auth ---

  /**
   * Update the Bearer token. Propagates to transport, active recorder, and worker.
   */
  setAccessToken(token: string): void {
    this.config.accessToken = token;
    this.transport.setAuthToken(token);
    this.recordingManager.updateAuthToken(token);
  }

  // --- Reset ---

  /**
   * Lightweight cleanup between back-to-back sessions.
   *
   * Stops any active recording, resets the recording pipeline (VAD, mic,
   * buffers, worker), and clears the current session reference. Does NOT
   * touch callbacks, discovery cache, transport, or initialization state —
   * use `reset()` for a full teardown.
   */
  clearRecordingState(): void {
    if (this.recordingManager.isRecording()) {
      this.recordingManager.forceStop();
    }
    this.recordingManager.reset();
    this.sessionManager.clearCurrentSession();
  }

  /**
   * Full reset — stops recording if active, clears all caches and state.
   */
  async reset(): Promise<void> {
    try {
      if (this.recordingManager.isRecording()) {
        await this.recordingManager.stop();
      }
    } catch {
      // Best-effort stop
    }

    this.recordingManager.reset();
    this.sessionManager.clearCurrentSession();
    this.discoveryManager.clearCache();
    this.callbackRegistry.removeAll();
    this.transport.destroy?.();
    this.isInitialized = false;
  }

  // --- Private ---

  /**
   * Wraps an async manager operation into SDKResult.
   * Internal manager methods always return `ApiCallResult<T>` so the HTTP
   * status from the underlying call (when present) is propagated to the
   * SDKResult success variant. On error, status is preserved via
   * `error.httpStatus`.
   */
  private async wrapResult<T>(fn: () => Promise<ApiCallResult<T>>): Promise<SDKResult<T>> {
    try {
      const result = await fn();
      return { success: true, data: result.data, httpStatus: result.httpStatus };
    } catch (error) {
      return { success: false, error: this.toScribeError(error) };
    }
  }

  /**
   * Ensures any error is a ScribeError instance.
   */
  private toScribeError(error: unknown): ScribeError {
    if (error instanceof ScribeError) {
      return error;
    }
    return new ScribeError(error instanceof Error ? error.message : 'Unknown error');
  }

  /**
   * Create the transport layer (HTTP or IPC) with 401 auto-retry wiring.
   *
   * How 401 auto-retry works:
   * 1. Transport gets a 401 response → calls onUnauthorized()
   * 2. onUnauthorized dispatches the 'onTokenRequired' callback to the consumer
   * 3. Consumer calls resolve(newToken) → token is propagated via setAccessToken()
   * 4. Promise resolves with the new token → transport retries the request once
   *
   * Deduplication: Transport holds a single tokenRefreshPromise — if multiple
   * requests get 401 concurrently, they all await the same promise, so only
   * ONE onTokenRequired callback fires regardless of how many requests failed.
   *
   * Timeout: If no handler is registered or the consumer never calls resolve(),
   * the promise resolves with undefined after 10s → transport skips retry.
   */
  private createTransport(): ITransport {
    const onUnauthorized = (): Promise<string | undefined> => {
      // No handler registered — skip token refresh, transport will throw AuthenticationError
      if (!this.callbackRegistry.hasHandlers('onTokenRequired')) {
        return Promise.resolve(undefined);
      }

      return new Promise<string | undefined>((resolve) => {
        let settled = false;

        // Safety timeout — prevent hanging if consumer never calls resolve()
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(undefined);
          }
        }, 10_000);

        // Dispatch to consumer — they call resolve(newToken) when ready
        this.callbackRegistry.dispatch('onTokenRequired', {
          resolve: (newToken: string) => {
            if (settled) return; // Timeout already fired — ignore late resolve
            settled = true;
            clearTimeout(timeout);
            this.setAccessToken(newToken); // Propagate to transport + recorder + worker
            resolve(newToken);
          },
        });
      });
    };

    if (this.config.mode === TransportMode.IPC) {
      if (!this.config.ipcTransport) {
        throw new ValidationError('ipcTransport (IpcBridge) is required when mode is "ipc"');
      }
      return new IpcTransport({
        bridge: this.config.ipcTransport,
        accessToken: this.config.accessToken,
        flavour: this.config.flavour,
        debug: this.config.debug,
        onUnauthorized,
      });
    }

    return new HttpTransport({
      accessToken: this.config.accessToken,
      flavour: this.config.flavour,
      debug: this.config.debug,
      onUnauthorized,
    });
  }

  private resolveWorkerConfig() {
    const useWorker = this.config.useWorker ?? 'auto';

    // IPC mode should never use SharedWorker (worker can't access IPC bridge)
    if (this.config.mode === TransportMode.IPC) {
      return { forceMainThread: true };
    }

    if (useWorker === false) {
      return { forceMainThread: true };
    }

    // 'auto' or true — let WorkerManager decide based on SharedWorker availability
    return {
      forceMainThread: false,
      workerScriptUrl: this.config.workerScriptUrl,
    };
  }

  /** Storage provider name from discovery; defaults to 'aws'. */
  private getStorageProviderName(): string {
    try {
      return this.discoveryManager.getResolvedConfig().storageProvider || 'aws';
    } catch {
      return 'aws';
    }
  }

  /**
   * Get the effective base URL — prefer discovery's base_url, fall back to config.
   */
  private getEffectiveBaseUrl(): string {
    try {
      const resolved = this.discoveryManager.getResolvedConfig();
      return resolved.baseUrl;
    } catch {
      return this.config.baseUrl;
    }
  }

  private validateConfig(config: ScribeSDKConfig): void {
    if (!config.baseUrl) {
      throw new ValidationError('baseUrl is required');
    }
  }
}
