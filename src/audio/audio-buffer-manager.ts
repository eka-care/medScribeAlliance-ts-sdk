/**
 * AudioBufferManager — accumulates audio frames into a growable Float32Array buffer.
 *
 * Responsibilities:
 * - Append incoming audio frames from VAD
 * - Track sample count, frame count, and duration
 * - Provide the accumulated audio data for chunk processing
 * - Calculate chunk timestamps based on raw sample position
 * - Reset buffer state after a chunk is clipped (without re-allocating)
 */

export class AudioBufferManager {
  private buffer: Float32Array;
  private currentSampleLength: number = 0;
  private currentFrameLength: number = 0;
  private samplingRate: number;
  private incrementalAllocationSize: number;

  /**
   * @param samplingRate - The sampling rate of the audio in Hz
   * @param allocationTimeInSeconds - The size of each incremental allocation in seconds
   */
  constructor(samplingRate: number, allocationTimeInSeconds: number) {
    this.samplingRate = samplingRate;
    this.incrementalAllocationSize = Math.floor(samplingRate * allocationTimeInSeconds);
    this.buffer = new Float32Array(this.incrementalAllocationSize);
  }

  /**
   * Append an audio frame to the buffer.
   * Expands the buffer if needed.
   */
  append(audioFrame: Float32Array): number {
    try {
      if (this.currentSampleLength + audioFrame.length > this.buffer.length) {
        this.expandBuffer();
      }

      this.buffer.set(audioFrame, this.currentSampleLength);
      this.currentSampleLength += audioFrame.length;
      this.currentFrameLength += 1;

      return this.currentSampleLength;
    } catch (error) {
      console.error('[ScribeSDK] Error appending audio frame:', error);
      return this.currentSampleLength;
    }
  }

  /**
   * Get the current audio data as a new Float32Array (copy, not reference).
   */
  getAudioData(): Float32Array {
    return this.buffer.slice(0, this.currentSampleLength);
  }

  getCurrentSampleLength(): number {
    return this.currentSampleLength;
  }

  getCurrentFrameLength(): number {
    return this.currentFrameLength;
  }

  /**
   * Get the current duration of buffered audio in seconds.
   */
  getDurationInSeconds(): number {
    return this.currentSampleLength / this.samplingRate;
  }

  /**
   * Calculate timestamps for the current chunk relative to the overall recording.
   *
   * @param totalRawSamples - Total raw samples received since recording started
   * @returns start and end timestamps formatted as MM:SS.ffffff
   */
  calculateChunkTimestamps(totalRawSamples: number): { start: string; end: string } {
    try {
      const chunkDuration = this.getDurationInSeconds();
      const endSeconds = totalRawSamples / this.samplingRate;
      const startSeconds = endSeconds - chunkDuration;

      return {
        start: this.formatTimestamp(Math.max(0, startSeconds)),
        end: this.formatTimestamp(endSeconds),
      };
    } catch (error) {
      console.error('[ScribeSDK] Error calculating chunk timestamps:', error);
      return { start: '00:00.000000', end: '00:00.000000' };
    }
  }

  /**
   * Reset sample/frame counters without re-allocating the buffer.
   * Called after a chunk is clipped and sent for processing.
   */
  resetBufferState(): void {
    this.currentSampleLength = 0;
    this.currentFrameLength = 0;
  }

  /**
   * Full reset — re-allocates buffer memory.
   * Called when recording is completely stopped/reset.
   */
  resetInstance(): void {
    this.buffer = new Float32Array(this.incrementalAllocationSize);
    this.currentSampleLength = 0;
    this.currentFrameLength = 0;
  }

  private expandBuffer(): void {
    const newSize = this.buffer.length + this.incrementalAllocationSize;
    const newBuffer = new Float32Array(newSize);
    newBuffer.set(this.buffer, 0);
    this.buffer = newBuffer;
  }

  private formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toFixed(6).padStart(9, '0');
    return `${minutes}:${secs}`;
  }
}
