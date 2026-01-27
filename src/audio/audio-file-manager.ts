import { AUDIO_EXTENSION_TYPE_MAP, OUTPUT_FORMAT } from './constants';
import { TAudioChunksInfo, UploadProgressCallback } from './types';
import { compressAudioToMp3 } from './utils';
import { uploadFileWithFormData } from '../utils/upload';

type TUploadAudioChunkParams = {
  audioFrames: Float32Array;
  fileName: string;
  chunkIndex: number;
};

export class AudioFileManager {
  public audioChunks: TAudioChunksInfo[] = [];
  private uploadPromises: Promise<any>[] = [];
  private successfulUploads: string[] = [];
  private totalRawSamples: number = 0;
  private totalRawFrames: number = 0;
  private totalInsertedSamples: number = 0;
  private totalInsertedFrames: number = 0;
  
  private sessionId: string = '';
  private uploadUrl: string = '';
  private uploadHeaders?: Record<string, string>;

  // Callback for progress
  private onUploadProgress?: UploadProgressCallback;

  initialiseClassInstance() {
    this.audioChunks = [];
    this.uploadPromises = [];
    this.successfulUploads = [];
    this.totalInsertedFrames = 0;
    this.totalInsertedSamples = 0;
    this.totalRawSamples = 0;
    this.totalRawFrames = 0;
  }

  constructor() {
    this.initialiseClassInstance();
  }

  setSessionInfo({
    sessionId,
    uploadUrl,
    uploadHeaders,
  }: {
    sessionId: string;
    uploadUrl: string;
    uploadHeaders?: Record<string, string>;
  }) {
    this.sessionId = sessionId;
    this.uploadUrl = uploadUrl;
    this.uploadHeaders = uploadHeaders;
  }
  
  setUploadProgressCallback(callback: UploadProgressCallback) {
      this.onUploadProgress = callback;
  }

  getRawSampleDetails(): {
    totalRawSamples: number;
    totalRawFrames: number;
  } {
    return {
      totalRawSamples: this.totalRawSamples,
      totalRawFrames: this.totalRawFrames,
    };
  }

  incrementTotalRawSamples(frames: Float32Array): void {
    this.totalRawSamples += frames.length;
    this.totalRawFrames += 1;
  }

  incrementInsertedSamples(samples: number, frames: number): void {
    this.totalInsertedSamples += samples;
    this.totalInsertedFrames += frames;
  }

  getInsertedSampleDetails(): {
    totalInsertedSamples: number;
    totalInsertedFrames: number;
  } {
    return {
      totalInsertedSamples: this.totalInsertedSamples,
      totalInsertedFrames: this.totalInsertedFrames,
    };
  }

  updateAudioInfo(audioChunks: TAudioChunksInfo): number {
    this.audioChunks.push(audioChunks);
    return this.audioChunks.length;
  }

  async uploadAudio({ audioFrames, fileName, chunkIndex }: TUploadAudioChunkParams) {
      // Compress and upload in main thread (SharedWorker complexity removed for MVP/Port)
      await this.uploadAudioChunkInMain({ audioFrames, fileName, chunkIndex });
  }

  private async uploadAudioChunkInMain({
    audioFrames,
    fileName,
    chunkIndex,
  }: TUploadAudioChunkParams): Promise<{
    success: boolean;
    fileName: string;
  }> {
    if (!this.uploadUrl) {
        console.error('Upload URL not set');
        return { success: false, fileName };
    }

    const compressedAudioBuffer = compressAudioToMp3(audioFrames);

    const audioBlob = new Blob(compressedAudioBuffer as BlobPart[], {
      type: AUDIO_EXTENSION_TYPE_MAP[OUTPUT_FORMAT],
    });

    // Notify info (optional)
    
    const uploadPromise = uploadFileWithFormData(this.uploadUrl, fileName, audioBlob, this.uploadHeaders)
      .then((response) => {
        if (response.success) {
          this.successfulUploads.push(fileName);

          if (chunkIndex !== -1 && this.audioChunks[chunkIndex]) {
            this.audioChunks[chunkIndex] = {
              ...this.audioChunks[chunkIndex],
              audioFrames: undefined,
              fileBlob: undefined,
              status: 'success',
              response: response.success,
            };
          }
          
          this.onUploadProgress?.([...this.successfulUploads], this.audioChunks.length);
        } else {
          if (chunkIndex !== -1 && this.audioChunks[chunkIndex]) {
            this.audioChunks[chunkIndex] = {
              ...this.audioChunks[chunkIndex],
              fileBlob: audioBlob,
              audioFrames: undefined,
              status: 'failure',
              response: response.error || 'Upload failed',
            };
          }
        }
        return response;
      });

    this.uploadPromises.push(uploadPromise);

    return {
      success: true,
      fileName,
    };
  }

  async waitForAllUploads(): Promise<void> {
    await Promise.allSettled(this.uploadPromises);
  }

  getSuccessfulUploads(): string[] {
    return [...this.successfulUploads];
  }

  getFailedUploads(): string[] {
    const failedUploads: string[] = [];
    this.audioChunks.forEach((chunk) => {
      if (chunk.status != 'success') {
        failedUploads.push(chunk.fileName);
      }
    });
    return failedUploads;
  }

  getTotalAudioChunks(): TAudioChunksInfo[] {
    return this.audioChunks;
  }

  async retryFailedUploads(): Promise<string[]> {
    const failedFiles = this.getFailedUploads();
    if (failedFiles.length === 0) {
      return [];
    }

    this.uploadPromises = []; // Reset for retry batch

    this.audioChunks.forEach((chunk, index) => {
      const { fileName, fileBlob, status, audioFrames } = chunk;

      if (status != 'success') {
        let failedFileBlob: Blob | undefined;

        if (status === 'failure') {
          failedFileBlob = fileBlob;
        } else if (status === 'pending' && audioFrames) {
             const compressedAudioBuffer = compressAudioToMp3(audioFrames);
             failedFileBlob = new Blob(compressedAudioBuffer as BlobPart[], {
               type: AUDIO_EXTENSION_TYPE_MAP[OUTPUT_FORMAT],
             });
        }

        if (failedFileBlob) {
          const uploadPromise = uploadFileWithFormData(this.uploadUrl, fileName, failedFileBlob, this.uploadHeaders)
            .then((response) => {
              if (response.success) {
                this.successfulUploads.push(fileName);
                this.audioChunks[index] = {
                  ...this.audioChunks[index],
                  audioFrames: undefined,
                  fileBlob: undefined,
                  status: 'success',
                  response: response.success,
                };
                 this.onUploadProgress?.([...this.successfulUploads], this.audioChunks.length);
              }
              return response;
            });

          this.uploadPromises.push(uploadPromise);
        }
      }
    });

    await this.waitForAllUploads();

    return this.getFailedUploads();
  }

  resetFileManagerInstance(): void {
    // Promises can't be cancelled but we ignore results
    this.uploadPromises.forEach((p) => p.catch(() => {}));
    this.initialiseClassInstance();
    this.sessionId = '';
    this.uploadUrl = '';
    this.uploadHeaders = undefined;
  }
}
