/**
 * SingleRecorder — implements IRecorder for single-file (non-chunked) recording.
 *
 * Uses the browser's MediaRecorder API to record audio as a single file.
 * On stop, the complete recording is uploaded via ITransport (not raw fetch).
 *
 * This recorder is simpler than ChunkedRecorder — no VAD, no chunking, no SharedWorker.
 * Best for short recordings or when the server expects a single file upload.
 */

import type { IRecorder, RecorderConfig, StopRecordingResult } from '../types/recording';
import type { CreateSessionResponse } from '../types/session';
import type { ITransport } from '../types/transport';
import { CallbackRegistry } from '../callbacks/callback-registry';

export class SingleRecorder implements IRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private micStream: MediaStream | null = null;
  private _isPaused: boolean = false;

  private uploadUrl: string = '';
  private uploadHeaders: Record<string, string> = {};
  private callbackRegistry: CallbackRegistry;
  private transport: ITransport;

  constructor(callbackRegistry: CallbackRegistry, transport: ITransport) {
    this.callbackRegistry = callbackRegistry;
    this.transport = transport;
  }

  /**
   * Configure recorder with session details (upload URL, headers).
   */
  initialize(session: CreateSessionResponse, config: RecorderConfig): void {
    if (!session.upload_url) {
      throw new Error('Upload URL is required for single recording');
    }
    this.uploadUrl = session.upload_url;
    this.uploadHeaders = config.uploadHeaders;
  }

  /**
   * Start recording via MediaRecorder API.
   */
  async start(deviceId?: string): Promise<void> {
    try {
      this.audioChunks = [];
      const stream = await this.getMicrophoneStream(deviceId);
      this.micStream = stream;

      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      this._isPaused = false;
    } catch (error) {
      this.callbackRegistry.dispatch('onError', {
        type: 'vad_error',
        timestamp: new Date().toISOString(),
        error: {
          code: 'recorder_start_failed',
          message: error instanceof Error ? error.message : 'Failed to start MediaRecorder',
        },
      });
      throw error;
    }
  }

  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this._isPaused = true;
    }
  }

  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this._isPaused = false;
    }
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Stop recording, assemble the final blob, and upload via ITransport.
   */
  async stop(): Promise<StopRecordingResult> {
    this._isPaused = false;

    if (!this.mediaRecorder) {
      return { failedUploads: [], totalFiles: 0 };
    }

    try {
      // Wait for MediaRecorder to finish
      const audioBlob = await this.stopMediaRecorder();
      const fileName = `audio_0.${this.getFileExtension()}`;

      // Upload via ITransport (not raw fetch — works with HTTP and IPC)
      const fullUrl = this.uploadUrl.endsWith('/')
        ? `${this.uploadUrl}${fileName}`
        : `${this.uploadUrl}/${fileName}`;

      try {
        await this.transport.request({
          method: 'POST',
          url: fullUrl,
          headers: this.uploadHeaders,
          isUpload: true,
          uploadBlob: audioBlob,
        });

        this.callbackRegistry.dispatch('onUploadEvent', {
          type: 'progress',
          timestamp: new Date().toISOString(),
          data: { successCount: 1, totalCount: 1 },
        });

        return { failedUploads: [], totalFiles: 1 };
      } catch (error: any) {
        this.callbackRegistry.dispatch('onUploadEvent', {
          type: 'failed',
          timestamp: new Date().toISOString(),
          data: { fileName, error: error?.message ?? 'Upload failed' },
        });

        return { failedUploads: [fileName], totalFiles: 1 };
      }
    } catch (error) {
      console.error('[ScribeSDK] Error stopping single recorder:', error);
      return { failedUploads: [], totalFiles: 0 };
    } finally {
      this.releaseMicStream();
    }
  }

  /**
   * Full reset — stop everything and clear state.
   */
  reset(): void {
    this._isPaused = false;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      // Ignore — may already be stopped
    }
    this.releaseMicStream();
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  // --- Private ---

  /**
   * Stop MediaRecorder and return the assembled Blob.
   * Returns a promise that resolves when the 'stop' event fires.
   */
  private stopMediaRecorder(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('MediaRecorder is not initialized'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        try {
          const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          resolve(audioBlob);
        } catch (error) {
          reject(error);
        }
      };

      this.mediaRecorder.onerror = (event: Event) => {
        reject(new Error(`MediaRecorder error: ${(event as any)?.error?.message ?? 'Unknown'}`));
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Get microphone stream, falling back to default device on constraint errors.
   */
  private async getMicrophoneStream(deviceId?: string): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (error: any) {
      if (error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError') {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw error;
    }
  }

  private releaseMicStream(): void {
    try {
      this.micStream?.getTracks().forEach((track) => track.stop());
    } catch {
      // Ignore cleanup errors
    }
    this.micStream = null;
  }

  /**
   * Determine file extension from MediaRecorder's MIME type.
   */
  private getFileExtension(): string {
    const mimeType = this.mediaRecorder?.mimeType || '';
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
  }
}
