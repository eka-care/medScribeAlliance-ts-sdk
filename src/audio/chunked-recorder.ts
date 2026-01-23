import { IRecorder } from './recorder.interface';
import { CreateSessionResponse } from '../types';
import { VadWebClient } from './vad-web';
import { AudioFileManager } from './audio-file-manager';
import { AudioBufferManager } from './audio-buffer-manager';
import {
  PREF_CHUNK_LENGTH,
  DESP_CHUNK_LENGTH,
  MAX_CHUNK_LENGTH,
  SAMPLING_RATE,
  AUDIO_BUFFER_SIZE_IN_S,
  FRAME_RATE,
} from './constants';
import { EventEmitter } from '../utils/events';

export class ChunkedRecorder implements IRecorder {
  private vadClient: VadWebClient;
  private fileManager: AudioFileManager;
  private bufferManager: AudioBufferManager;
  private eventEmitter?: EventEmitter;

  constructor(eventEmitter?: EventEmitter) {
    this.eventEmitter = eventEmitter;
    this.bufferManager = new AudioBufferManager(SAMPLING_RATE, AUDIO_BUFFER_SIZE_IN_S);
    this.fileManager = new AudioFileManager();

    // TODO: set max_chunk_length from discovery
    // Initialize VAD with default constants
    this.vadClient = new VadWebClient(
      PREF_CHUNK_LENGTH,
      DESP_CHUNK_LENGTH,
      MAX_CHUNK_LENGTH,
      SAMPLING_RATE,
      this.fileManager,
      this.bufferManager
    );

    // Setup callbacks
    if (this.eventEmitter) {
        this.fileManager.setUploadProgressCallback((success, total) => {
             // Emit progress?
             // this.eventEmitter.emit(...)
        });
        
        this.vadClient.setCallbacks(
             (args) => {
                 // On VAD frames/warning
                 // this.eventEmitter.emit('warning', args.message);
             },
             (args) => {
                 // On Frame Processed (too frequent for general events usually)
             },
             (isSpeech) => {
                 // on user speech toggle
             }
        );
    }
  }

  initialize(session: CreateSessionResponse): void {
    if (!session.upload_url) {
      throw new Error('Upload URL is required for chunked recording');
    }
    this.fileManager.setSessionInfo({
      sessionId: session.session_id,
      uploadUrl: session.upload_url,
    });
  }

  async start(deviceId?: string): Promise<void> {
    await this.vadClient.initVad(deviceId);

    // TODO: handle vad errors
    this.vadClient.startVad();
  }

  async stop(): Promise<{ failedUploads: string[]; totalFiles?: number }> {
    this.vadClient.resetVadWebInstance();
    
    // Wait for pending uploads and retry failures
    await this.fileManager.waitForAllUploads();
    const failed = await this.fileManager.retryFailedUploads();
    const total = this.fileManager.getTotalAudioChunks().length;
    
    return {
      failedUploads: failed,
      totalFiles: total,
    };
  }

  reset(): void {
    this.vadClient.resetVadWebInstance();
    this.fileManager.resetFileManagerInstance();
    this.bufferManager.resetBufferState();
  }
}
