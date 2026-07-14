/**
 * ChunkedRecorder — implements IRecorder for chunked (VAD-based) audio recording.
 *
 * Wires together the audio pipeline:
 *   VadClient (clip detection + raw frames)
 *     → AudioBufferManager (accumulates frames)
 *     → AudioFileManager (tracks chunk metadata)
 *     → WorkerManager (MP3 compression + upload via ITransport)
 *
 * Flow per frame:
 *   1. VadClient.onRawFrame → bufferManager.append + fileManager.incrementRawSamples
 *   2. VadClient detects clip point → onClipPoint fires
 *   3. onClipPoint handler:
 *      a. Gets buffered audio from bufferManager
 *      b. Calculates timestamps from fileManager's raw sample count
 *      c. Registers chunk in fileManager (pending status)
 *      d. Sends to workerManager.compressAndUpload()
 *      e. Dispatches chunk_ready via CallbackRegistry
 *      f. Resets buffer for next chunk
 *
 * On stop():
 *   1. Destroys VAD (stops mic)
 *   2. Flushes remaining audio in buffer as final chunk
 *   3. Waits for all pending uploads via workerManager
 *   4. Returns failed uploads + total file count
 */

import type {
  IRecorder,
  RecorderConfig,
  StopRecordingResult,
  AudioChunkInfo,
} from '../types/recording';
import type { CreateSessionResponse } from '../types/session';
import type { ITransport } from '../types/transport';
import { CallbackRegistry } from '../callbacks/callback-registry';
import { VadClient } from '../audio/vad-client';
import type { VadConfig } from '../audio/vad-client';
import { AudioBufferManager } from '../audio/audio-buffer-manager';
import { AudioFileManager } from '../audio/audio-file-manager';
import { WorkerManager } from '../worker/worker-manager';
import type { WorkerManagerConfig } from '../worker/worker-manager';
import {
  PREF_CHUNK_LENGTH,
  DESP_CHUNK_LENGTH,
  MAX_CHUNK_LENGTH,
  SAMPLING_RATE,
  AUDIO_BUFFER_SIZE_IN_S,
  MAX_CHUNKS_PER_SESSION,
} from '../audio/constants';
import { ErrorEventType, ErrorCode } from '../constants';

export class ChunkedRecorder implements IRecorder {
  private vadClient: VadClient;
  private bufferManager: AudioBufferManager;
  private fileManager: AudioFileManager;
  private workerManager: WorkerManager;
  private callbackRegistry: CallbackRegistry;

  private _isPaused: boolean = false;
  private initialized: boolean = false;
  private chunkLimitReached: boolean = false;
  private chunkLimitOverridden: boolean = false;

  constructor(
    callbackRegistry: CallbackRegistry,
    transport: ITransport,
    vadConfig?: Partial<VadConfig>,
    workerConfig?: WorkerManagerConfig
  ) {
    this.callbackRegistry = callbackRegistry;

    // Create audio pipeline components
    this.bufferManager = new AudioBufferManager(SAMPLING_RATE, AUDIO_BUFFER_SIZE_IN_S);
    this.fileManager = new AudioFileManager();

    // Create VadClient with defaults, allow overrides from discovery
    const fullVadConfig: VadConfig = {
      prefChunkLength: vadConfig?.prefChunkLength ?? PREF_CHUNK_LENGTH,
      despChunkLength: vadConfig?.despChunkLength ?? DESP_CHUNK_LENGTH,
      maxChunkLength: vadConfig?.maxChunkLength ?? MAX_CHUNK_LENGTH,
      samplingRate: vadConfig?.samplingRate ?? SAMPLING_RATE,
      frameSize: vadConfig?.frameSize,
      preSpeechPadFrames: vadConfig?.preSpeechPadFrames,
      shortSilenceThreshold: vadConfig?.shortSilenceThreshold,
      longSilenceThreshold: vadConfig?.longSilenceThreshold,
    };
    this.vadClient = new VadClient(fullVadConfig, callbackRegistry);

    // Create WorkerManager — handles MP3 compression + upload via ITransport
    this.workerManager = new WorkerManager(
      callbackRegistry,
      this.fileManager,
      transport,
      workerConfig
    );

    // Wire VadClient to audio pipeline
    this.wireVadCallbacks();
  }

  /**
   * Configure recorder with session details (upload URL, headers).
   * Called by RecordingManager after session creation.
   * Throws on failure — RecordingManager handles error dispatch.
   */
  initialize(_session: CreateSessionResponse, config: RecorderConfig): void {
    if (!config.upload || typeof config.upload !== 'object') {
      throw new Error('Upload payload is required for chunked recording');
    }
    if (!config.storageProvider) {
      throw new Error('Storage provider is required for chunked recording');
    }

    // Throws UnsupportedStorageProviderError for an unknown provider.
    this.workerManager.setUploadConfig(
      config.upload,
      config.storageProvider,
      config.uploadHeaders,
      config.refreshUploadUrl
    );

    this.initialized = true;
  }

  /**
   * Initialize VAD (mic stream + MicVAD), then start recording.
   * Throws on failure — RecordingManager handles error dispatch.
   */
  async start(deviceId?: string): Promise<void> {
    // Initialize VAD (acquires mic, creates MicVAD instance)
    await this.vadClient.init(deviceId);

    // If VAD is still loading after init, retry once
    if (this.vadClient.isVadLoading()) {
      await this.vadClient.init(deviceId);
      if (this.vadClient.isVadLoading()) {
        throw new Error('VAD instance failed to initialize after retry');
      }
    }

    // Start VAD processing
    this.vadClient.start();
    this._isPaused = false;
  }

  pause(): void {
    if (!this._isPaused) {
      this.vadClient.pause();
      this._isPaused = true;
    }
  }

  resume(): void {
    if (this._isPaused) {
      this.vadClient.start();
      this._isPaused = false;
    }
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Stop recording:
   * 1. Destroy VAD (stops mic)
   * 2. Flush remaining audio as final chunk
   * 3. Wait for all uploads to complete
   * 4. Return results
   */
  async stop(): Promise<StopRecordingResult> {
    try {
      this._isPaused = false;

      // Destroy VAD (stops mic stream, releases resources)
      this.vadClient.destroy();

      // Flush remaining audio in buffer as the last chunk
      this.flushRemainingAudio();

      // Wait for all pending uploads (including the last chunk)
      await this.workerManager.waitForAllUploads();

      // If waitForAllUploads resolved via timeout (worker unresponsive),
      // some chunks may still be 'pending'. Mark them as failed so they
      // appear in failedUploads and are available for retry.
      this.fileManager.markPendingAsFailed();

      return {
        failedUploads: this.fileManager.getFailedUploads(),
        totalFiles: this.fileManager.getChunkCount(),
      };
    } catch (error) {
      console.error('[ScribeSDK] Error stopping chunked recorder:', error);
      this.fileManager.markPendingAsFailed();
      return {
        failedUploads: this.fileManager.getFailedUploads(),
        totalFiles: this.fileManager.getChunkCount(),
      };
    }
  }

  /**
   * Full reset — destroys everything and clears all state.
   */
  reset(): void {
    this._isPaused = false;
    this.chunkLimitReached = false;
    this.chunkLimitOverridden = false;
    this.vadClient.reset();
    this.fileManager.resetInstance();
    this.bufferManager.resetInstance();
    this.workerManager.destroy();
    this.initialized = false;
  }

  /**
   * Override the session chunk limit, allowing unlimited chunks to be created.
   * Call this after receiving a 'chunk_limit_reached' error to resume chunk creation.
   */
  forceAllowMoreChunks(): void {
    this.chunkLimitOverridden = true;
    this.chunkLimitReached = false;
  }

  /**
   * Update VAD chunk length thresholds (e.g., from discovery config).
   */
  updateChunkLengths(config: {
    prefChunkLength?: number;
    despChunkLength?: number;
    maxChunkLength?: number;
    samplingRate?: number;
  }): void {
    this.vadClient.updateChunkLengths(config);
  }

  /**
   * Update the auth token for uploads.
   */
  updateAuthToken(token: string): void {
    this.workerManager.updateAuthToken(token);
  }

  /**
   * Get the AudioFileManager for external access to chunk metadata.
   */
  getFileManager(): AudioFileManager {
    return this.fileManager;
  }

  // --- Private ---

  /**
   * Wire VadClient's internal callbacks to the audio pipeline.
   */
  private wireVadCallbacks(): void {
    // Wire raw frame → buffer + sample tracking
    this.vadClient.setOnRawFrame((frame: Float32Array) => {
      this.fileManager.incrementRawSamples(frame);
      this.bufferManager.append(frame);
    });

    // Wire clip point → chunk creation + upload
    this.vadClient.setOnClipPoint(() => {
      this.handleClipPoint();
    });
  }

  /**
   * Handle a clip point: create a chunk from buffered audio and send for upload.
   */
  private handleClipPoint(): void {
    try {
      // Check chunk limit before creating a new chunk
      if (!this.chunkLimitOverridden && this.fileManager.getChunkCount() >= MAX_CHUNKS_PER_SESSION) {
        // Reset buffer to prevent unbounded memory growth
        this.bufferManager.resetBufferState();

        // Fire callback only on the first time the limit is hit
        if (!this.chunkLimitReached) {
          this.chunkLimitReached = true;
          this.callbackRegistry.dispatch('onError', {
            type: ErrorEventType.VALIDATION_ERROR,
            timestamp: new Date().toISOString(),
            error: {
              code: ErrorCode.CHUNK_LIMIT_REACHED,
              message: `Maximum chunk limit of ${MAX_CHUNKS_PER_SESSION} reached. Call forceAllowMoreChunks() to continue uploading.`,
            },
          });
        }
        return;
      }

      const audioFrames = this.bufferManager.getAudioData();
      if (audioFrames.length === 0) {
        return;
      }

      const fileName = this.fileManager.getNextFileName();
      const rawSampleDetails = this.fileManager.getRawSampleDetails();
      const timestamps = this.bufferManager.calculateChunkTimestamps(
        rawSampleDetails.totalRawSamples
      );

      // Register chunk in file manager as pending
      const chunkInfo: AudioChunkInfo = {
        fileName,
        timestamp: { st: timestamps.start, et: timestamps.end },
        status: 'pending',
        audioFrames,
      };
      const chunkIndex = this.fileManager.addChunk(chunkInfo);

      // Track inserted samples
      this.fileManager.incrementInsertedSamples(
        this.bufferManager.getCurrentSampleLength(),
        this.bufferManager.getCurrentFrameLength()
      );

      // Reset buffer for next chunk
      this.bufferManager.resetBufferState();

      // Send to WorkerManager for MP3 compression + upload.
      this.workerManager.compressAndUpload(audioFrames, fileName, chunkIndex);
    } catch (error) {
      console.error('[ScribeSDK] Error handling clip point:', error);
      this.callbackRegistry.dispatch('onError', {
        type: ErrorEventType.WORKER_ERROR,
        timestamp: new Date().toISOString(),
        error: {
          code: ErrorCode.CHUNK_CREATION_FAILED,
          message: error instanceof Error ? error.message : 'Failed to create audio chunk',
        },
      });
    }
  }

  /**
   * Flush remaining audio in the buffer as the final chunk.
   * Called during stop() to ensure no audio is lost.
   */
  private flushRemainingAudio(): void {
    if (this.bufferManager.getCurrentSampleLength() > 0) {
      this.handleClipPoint();
    }
  }
}
