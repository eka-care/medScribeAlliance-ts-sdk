/**
 * AudioFileManager — tracks audio chunk metadata throughout a recording session.
 *
 * Responsibilities:
 * - Track chunk metadata (fileName, timestamps, status)
 * - Track total raw samples/frames received from VAD
 * - Track total inserted samples/frames (committed to chunks)
 * - Mark chunks as success/failure after upload
 * - Provide lists of successful/failed uploads
 *
 * This class does NOT handle upload logic — that's delegated to WorkerManager.
 * File naming: {sequence_number}.{extension} (1-based), e.g. "1.mp3".
 */

import { AudioChunkInfo } from '../types';
import { OUTPUT_FORMAT } from './constants';

export class AudioFileManager {
  private chunks: AudioChunkInfo[] = [];
  private successfulUploads: string[] = [];
  private totalRawSamples: number = 0;
  private totalRawFrames: number = 0;
  private totalInsertedSamples: number = 0;
  private totalInsertedFrames: number = 0;

  /**
   * Track raw samples received from VAD (before chunking).
   */
  incrementRawSamples(frame: Float32Array): void {
    this.totalRawSamples += frame.length;
    this.totalRawFrames += 1;
  }

  /**
   * Track samples/frames committed to a chunk.
   */
  incrementInsertedSamples(samples: number, frames: number): void {
    this.totalInsertedSamples += samples;
    this.totalInsertedFrames += frames;
  }

  getRawSampleDetails(): { totalRawSamples: number; totalRawFrames: number } {
    return {
      totalRawSamples: this.totalRawSamples,
      totalRawFrames: this.totalRawFrames,
    };
  }

  getInsertedSampleDetails(): { totalInsertedSamples: number; totalInsertedFrames: number } {
    return {
      totalInsertedSamples: this.totalInsertedSamples,
      totalInsertedFrames: this.totalInsertedFrames,
    };
  }

  /**
   * Generate the next chunk file name.
   * Format: {sequence_number}.{extension} (1-based index), e.g. "1.mp3".
   */
  getNextFileName(): string {
    const index = this.chunks.length + 1;
    return `${index}.${OUTPUT_FORMAT}`;
  }

  /**
   * Add a new chunk to the tracking list.
   * Returns the chunk index (zero-based).
   */
  addChunk(chunk: AudioChunkInfo): number {
    this.chunks.push(chunk);
    return this.chunks.length - 1;
  }

  /**
   * Mark a chunk as successfully uploaded.
   */
  markSuccess(chunkIndex: number, response?: string): void {
    try {
      if (chunkIndex < 0 || chunkIndex >= this.chunks.length) {
        return;
      }

      const chunk = this.chunks[chunkIndex];
      this.chunks[chunkIndex] = {
        fileName: chunk.fileName,
        timestamp: chunk.timestamp,
        response,
        status: 'success',
      };

      if (!this.successfulUploads.includes(chunk.fileName)) {
        this.successfulUploads.push(chunk.fileName);
      }
    } catch (error) {
      console.error('[ScribeSDK] Error marking chunk success:', error);
    }
  }

  /**
   * Mark a chunk as failed upload. Stores the blob for potential retry.
   */
  markFailure(chunkIndex: number, fileBlob: Blob, errorMessage?: string): void {
    try {
      if (chunkIndex < 0 || chunkIndex >= this.chunks.length) {
        return;
      }

      const chunk = this.chunks[chunkIndex];
      this.chunks[chunkIndex] = {
        fileName: chunk.fileName,
        timestamp: chunk.timestamp,
        response: errorMessage,
        status: 'failure',
        fileBlob,
      };
    } catch (error) {
      console.error('[ScribeSDK] Error marking chunk failure:', error);
    }
  }

  /**
   * Get all chunks.
   */
  getChunks(): AudioChunkInfo[] {
    return this.chunks;
  }

  /**
   * Get the total number of chunks.
   */
  getChunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Get list of successfully uploaded file names.
   */
  getSuccessfulUploads(): string[] {
    return [...this.successfulUploads];
  }

  /**
   * Get list of file names that failed to upload.
   */
  getFailedUploads(): string[] {
    return this.chunks
      .filter((chunk) => chunk.status === 'failure')
      .map((chunk) => chunk.fileName);
  }

  /**
   * Get chunks that are in failure state (have blobs for retry).
   */
  getFailedChunksWithBlobs(): Array<{ chunkIndex: number; fileName: string; fileBlob: Blob }> {
    const failed: Array<{ chunkIndex: number; fileName: string; fileBlob: Blob }> = [];
    this.chunks.forEach((chunk, index) => {
      if (chunk.status === 'failure' && chunk.fileBlob) {
        failed.push({ chunkIndex: index, fileName: chunk.fileName, fileBlob: chunk.fileBlob });
      }
    });
    return failed;
  }

  /**
   * Mark all chunks still in 'pending' as failed.
   * Called after waitForAllUploads() returns (including timeout)
   * to ensure no chunk is silently lost.
   */
  markPendingAsFailed(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].status === 'pending') {
        this.chunks[i] = {
          fileName: this.chunks[i].fileName,
          timestamp: this.chunks[i].timestamp,
          response: 'Upload did not complete (timed out or worker unresponsive)',
          status: 'failure',
          fileBlob: new Blob(),
        };
      }
    }
  }

  /**
   * Full reset — clears all state.
   */
  resetInstance(): void {
    this.chunks = [];
    this.successfulUploads = [];
    this.totalRawSamples = 0;
    this.totalRawFrames = 0;
    this.totalInsertedSamples = 0;
    this.totalInsertedFrames = 0;
  }
}
