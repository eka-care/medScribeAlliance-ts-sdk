/**
 * WorkerManager — manages audio compression + upload via SharedWorker or main-thread fallback.
 *
 * Upload flow (replaces the old AudioFileManager.uploadAudio):
 *   ChunkedRecorder calls workerManager.compressAndUpload(audioFrames, fileName, chunkIndex)
 *     → SharedWorker receives raw Float32Array
 *     → Worker encodes to MP3 via encodeToMp3()
 *     → Worker uploads MP3 blob via fetch with retries
 *     → Worker sends back upload_success / upload_failed
 *     → WorkerManager updates AudioFileManager metadata + dispatches CallbackRegistry events
 *
 * Fallback: If SharedWorker is not available (e.g. some browsers, Electron/IPC mode),
 * compression + upload runs on the main thread using ITransport.
 *
 * Note: SharedWorker uses raw fetch internally (separate JS context, no access to IPC bridge).
 * For IPC transport, set forceMainThread: true — the main-thread path uses ITransport
 * so uploads go through the correct transport (HTTP or IPC).
 *
 * This class does NOT handle:
 * - Audio buffering or VAD (AudioBufferManager, VadClient)
 * - Chunk metadata tracking (AudioFileManager — but it calls markSuccess/markFailure on it)
 * - Session lifecycle (SessionManager)
 */

import { CallbackRegistry } from '../callbacks/callback-registry';
import { AudioFileManager } from '../audio/audio-file-manager';
import { encodeToMp3 } from '../audio/mp3-encoder';
import type { ITransport } from '../types/transport';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../types/worker';

export interface WorkerManagerConfig {
  /** Path to the compiled shared-worker.js bundle. Required for SharedWorker mode. */
  workerScriptUrl?: string;
  /** If true, skip SharedWorker and always run on main thread via ITransport. */
  forceMainThread?: boolean;
}

export class WorkerManager {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private useWorker: boolean = false;

  private callbackRegistry: CallbackRegistry;
  private fileManager: AudioFileManager;
  private transport: ITransport;

  // Upload URL + headers set by ChunkedRecorder when session is initialized
  private uploadUrl: string = '';
  private uploadHeaders: Record<string, string> = {};

  // Track pending main-thread uploads for waitForAllUploads
  private pendingUploads: Set<Promise<void>> = new Set();

  // Resolve function for waitForAllUploads (SharedWorker mode)
  private allUploadsResolver: (() => void) | null = null;

  constructor(
    callbackRegistry: CallbackRegistry,
    fileManager: AudioFileManager,
    transport: ITransport,
    config?: WorkerManagerConfig
  ) {
    this.callbackRegistry = callbackRegistry;
    this.fileManager = fileManager;
    this.transport = transport;

    // SharedWorker only works in browser with HTTP transport.
    // For IPC transport (Electron), forceMainThread should be true.
    if (
      !config?.forceMainThread &&
      typeof SharedWorker !== 'undefined' &&
      config?.workerScriptUrl
    ) {
      try {
        this.worker = new SharedWorker(config.workerScriptUrl, {
          name: 'scribe-sdk-worker',
        });
        this.port = this.worker.port;
        this.port.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
          this.handleWorkerMessage(e.data);
        };
        this.port.start();
        this.useWorker = true;
      } catch (error) {
        console.warn(
          '[ScribeSDK] SharedWorker failed to initialize, falling back to main thread:',
          error
        );
        this.worker = null;
        this.port = null;
        this.useWorker = false;
      }
    }
  }

  /**
   * Set upload destination — called by ChunkedRecorder after session creation.
   */
  setUploadConfig(uploadUrl: string, headers: Record<string, string>): void {
    this.uploadUrl = uploadUrl;
    this.uploadHeaders = headers;
  }

  // TODO: file upload via multipart form-data or raw binary body
  /**
   * Compress raw audio to MP3 and upload.
   * Called by ChunkedRecorder each time a clip point is detected.
   *
   * @param audioFrames - Raw Float32Array PCM audio
   * @param fileName - Protocol-spec file name (e.g. audio_0.mp3)
   * @param chunkIndex - Index in AudioFileManager's chunk list
   */
  compressAndUpload(audioFrames: Float32Array, fileName: string, chunkIndex: number): void {
    if (this.useWorker && this.port) {
      this.compressAndUploadViaWorker(audioFrames, fileName);
    } else {
      this.compressAndUploadOnMainThread(audioFrames, fileName, chunkIndex);
    }
  }

  /**
   * Wait for all pending uploads to complete.
   * Called by ChunkedRecorder during stop() before ending the session.
   * Includes a safety timeout to prevent hanging if the worker becomes unresponsive.
   */
  waitForAllUploads(): Promise<void> {
    if (this.useWorker && this.port) {
      return new Promise<void>((resolve) => {
        this.allUploadsResolver = resolve;
        this.postToWorker({ type: 'wait_for_all_uploads' });

        // Safety timeout — resolve after 30s if worker never responds
        setTimeout(() => {
          if (this.allUploadsResolver) {
            console.warn('[ScribeSDK] waitForAllUploads timed out after 15s');
            this.allUploadsResolver();
            this.allUploadsResolver = null;
          }
        }, 15_000);
      });
    }

    // Main-thread fallback: wait for all pending promises
    return Promise.all(this.pendingUploads).then(() => {});
  }

  /**
   * Update the auth token — forwards to worker and updates transport.
   */
  updateAuthToken(token: string): void {
    if (this.useWorker && this.port) {
      this.postToWorker({ type: 'update_auth_token', token });
    }
    // Update transport so main-thread uploads use the new token
    this.transport.setAuthToken(token);
    this.uploadHeaders['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Terminate the worker and clean up.
   */
  destroy(): void {
    try {
      if (this.useWorker && this.port) {
        this.postToWorker({ type: 'terminate' });
        this.port.close();
      }
    } catch (error) {
      console.error('[ScribeSDK] Error destroying worker:', error);
    }
    this.worker = null;
    this.port = null;
    this.useWorker = false;
    this.pendingUploads.clear();
    this.allUploadsResolver = null;
  }

  // --- SharedWorker path ---
  // SharedWorker uses raw fetch internally (separate JS context).
  // This path is only valid for HTTP transport — IPC consumers must use forceMainThread.

  private compressAndUploadViaWorker(audioFrames: Float32Array, fileName: string): void {
    this.postToWorker({
      type: 'compress_and_upload',
      audioFrames,
      fileName,
      uploadUrl: this.uploadUrl,
      headers: { ...this.uploadHeaders },
    });
  }

  private postToWorker(message: MainToWorkerMessage): void {
    try {
      this.port!.postMessage(message);
    } catch (error) {
      console.error('[ScribeSDK] Failed to post message to worker:', error);
      this.callbackRegistry.dispatch('onError', {
        type: 'worker_error',
        timestamp: new Date().toISOString(),
        error: {
          code: 'worker_post_failed',
          message: `Failed to send message to worker: ${
            error instanceof Error ? error.message : 'Unknown'
          }`,
        },
      });
    }
  }

  /**
   * Handle messages coming back from the SharedWorker.
   */
  private handleWorkerMessage(message: WorkerToMainMessage): void {
    switch (message.type) {
      case 'chunk_encoded': {
        const chunkIndex = this.findChunkIndex(message.fileName);
        this.callbackRegistry.dispatch('onAudioEvent', {
          type: 'chunk_ready',
          timestamp: new Date().toISOString(),
          data: {
            chunkIndex,
            fileName: message.fileName,
            chunkData: message.chunkData,
          },
        });
        break;
      }

      case 'upload_success': {
        const chunkIndex = this.findChunkIndex(message.fileName);
        if (chunkIndex >= 0) {
          this.fileManager.markSuccess(chunkIndex);
        }
        this.dispatchUploadProgress();
        break;
      }

      case 'upload_failed': {
        const chunkIndex = this.findChunkIndex(message.fileName);
        if (chunkIndex >= 0) {
          this.fileManager.markFailure(chunkIndex, message.blob ?? new Blob(), message.error);
        }
        this.callbackRegistry.dispatch('onUploadEvent', {
          type: 'failed',
          timestamp: new Date().toISOString(),
          data: { fileName: message.fileName, error: message.error },
        });
        this.dispatchUploadProgress();
        break;
      }

      case 'all_uploads_complete': {
        if (this.allUploadsResolver) {
          this.allUploadsResolver();
          this.allUploadsResolver = null;
        }
        break;
      }

      case 'token_required': {
        this.callbackRegistry.dispatch('onTokenRequired', {
          resolve: (newToken: string) => {
            this.updateAuthToken(newToken);
          },
        });
        break;
      }
    }
  }

  // --- Main-thread fallback path ---
  // Uses ITransport so it works with both HTTP and IPC transport.

  private compressAndUploadOnMainThread(
    audioFrames: Float32Array,
    fileName: string,
    chunkIndex: number
  ): void {
    const uploadPromise = this.doMainThreadUpload(audioFrames, fileName, chunkIndex);
    this.pendingUploads.add(uploadPromise);
    uploadPromise.finally(() => this.pendingUploads.delete(uploadPromise));
  }

  private async doMainThreadUpload(
    audioFrames: Float32Array,
    fileName: string,
    chunkIndex: number
  ): Promise<void> {
    // Hoist mp3Blob so it's accessible in catch for retry storage
    let mp3Blob: Blob | null = null;

    try {
      // 1. Encode to MP3
      const encoded = encodeToMp3(audioFrames);

      if (!encoded) {
        this.fileManager.markFailure(chunkIndex, new Blob(), 'MP3 encoding failed');
        this.callbackRegistry.dispatch('onUploadEvent', {
          type: 'failed',
          timestamp: new Date().toISOString(),
          data: { fileName, error: 'MP3 encoding failed' },
        });
        return;
      }

      mp3Blob = encoded.blob;

      // 2. Chunk is now encoded — dispatch chunk_ready with the MP3 bytes
      //    so the consumer can offer download / local playback.
      this.callbackRegistry.dispatch('onAudioEvent', {
        type: 'chunk_ready',
        timestamp: new Date().toISOString(),
        data: { chunkIndex, fileName, chunkData: encoded.chunks },
      });

      // 3. Upload via ITransport (handles HTTP or IPC transparently)
      const fullUrl = this.uploadUrl.endsWith('/')
        ? `${this.uploadUrl}${fileName}`
        : `${this.uploadUrl}/${fileName}`;

      await this.transport.request({
        method: 'POST',
        url: fullUrl,
        headers: this.uploadHeaders,
        isUpload: true,
        uploadBlob: mp3Blob,
      });

      // 4. Success — transport.request() throws on failure, so reaching here means success
      this.fileManager.markSuccess(chunkIndex);
      this.dispatchUploadProgress();
    } catch (error: any) {
      this.fileManager.markFailure(
        chunkIndex,
        mp3Blob ?? new Blob(),
        error?.message ?? 'Upload failed'
      );
      this.callbackRegistry.dispatch('onUploadEvent', {
        type: 'failed',
        timestamp: new Date().toISOString(),
        data: { fileName, error: error?.message ?? 'Upload failed' },
      });
      this.dispatchUploadProgress();
    }
  }

  // --- Helpers ---

  /**
   * Find a chunk's index by fileName (for SharedWorker responses where we only get fileName back).
   */
  private findChunkIndex(fileName: string): number {
    const chunks = this.fileManager.getChunks();
    return chunks.findIndex((chunk) => chunk.fileName === fileName);
  }

  /**
   * Dispatch upload progress event via CallbackRegistry.
   */
  private dispatchUploadProgress(): void {
    const successCount = this.fileManager.getSuccessfulUploads().length;
    const totalCount = this.fileManager.getChunkCount();

    this.callbackRegistry.dispatch('onUploadEvent', {
      type: 'progress',
      timestamp: new Date().toISOString(),
      data: { successCount, totalCount },
    });
  }
}
