import { SAMPLING_RATE } from './constants';

export class AudioBufferManager {
  private buffer!: Float32Array;
  private currentSampleLength: number = 0;
  private currentFrameLength: number = 0;
  private samplingRate: number = 0;
  private incrementalAllocationSize: number = 0;

  /**
   * Class that creates an audio buffer to store frame data
   * @param samplingRate - The sampling rate of the audio in Hz
   * @param allocationTimeInSeconds - The size of each incremental allocation in seconds
   */
  constructor(samplingRate: number, allocationTimeInSeconds: number) {
    this.samplingRate = samplingRate;

    // Calculate the size of each incremental allocation in samples
    this.incrementalAllocationSize = Math.floor(samplingRate * allocationTimeInSeconds);

    // Initialize buffer with the first allocation block
    this.buffer = new Float32Array(this.incrementalAllocationSize);
    this.currentSampleLength = 0;
  }

  /**
   * Append audio frame to the buffer
   * @param audioFrame - Float32Array containing audio samples to append
   * @returns The current position in the buffer after appending
   */
  public append(audioFrame: Float32Array): number {
    // Check if we need to allocate more memory
    if (this.currentSampleLength + audioFrame.length > this.buffer.length) {
      this.expandBuffer();
    }

    // Copy the new frame into the buffer
    this.buffer.set(audioFrame, this.currentSampleLength);
    this.currentSampleLength += audioFrame.length; // for 1 frame increase by 1024
    this.currentFrameLength += 1; // for 1 frame increase by 1

    return this.currentSampleLength;
  }

  /**
   * Get the current audio data as a Float32Array
   */
  public getAudioData(): Float32Array {
    return this.buffer.slice(0, this.currentSampleLength);
  }

  /**
   * Get the current length of audio data in samples
   * @returns The number of samples currently in the buffer
   */
  public getCurrentSampleLength(): number {
    return this.currentSampleLength;
  }

  /**
   * Get the current length of audio data in samples
   * @returns The number of samples currently in the buffer
   */
  public getCurrentFrameLength(): number {
    return this.currentFrameLength;
  }

  /**
   * Get the current length of audio data in seconds
   * @returns The duration of audio currently in the buffer in seconds
   */
  public getDurationInSeconds(): number {
    return this.currentSampleLength / this.samplingRate;
  }

  /**
   * Expand the buffer by allocating a new block of memory
   * @private
   */
  private expandBuffer(): void {
    const newSize = this.buffer.length + this.incrementalAllocationSize;
    const newBuffer = new Float32Array(newSize);

    // Copy existing data to the new buffer
    newBuffer.set(this.buffer, 0);

    // Replace old buffer with new one
    this.buffer = newBuffer;
  }

  /**
   * Calculate timestamps for an audio chunk
   */
  calculateChunkTimestamps(rawSamplesLength: number): {
    start: string;
    end: string;
  } {
    const start = rawSamplesLength / SAMPLING_RATE - this.getDurationInSeconds();
    const end = start + this.getDurationInSeconds();

    // Format start time as MM:SS.ffffff
    const startMinutes = Math.floor(start / 60)
      .toString()
      .padStart(2, '0');
    const startSeconds = (start % 60).toFixed(6).toString().padStart(2, '0');
    const formattedStartTime = `${startMinutes}:${startSeconds}`;

    // Format end time as MM:SS.ffffff
    const endMinutes = Math.floor(end / 60)
      .toString()
      .padStart(2, '0');
    const endSeconds = (end % 60).toFixed(6).toString().padStart(2, '0');
    const formattedEndTime = `${endMinutes}:${endSeconds}`;

    // Return timestamp object
    return {
      start: formattedStartTime,
      end: formattedEndTime,
    };
  }

  public resetBufferState() {
    // Zero out the existing buffer instead of allocating new memory
    this.currentSampleLength = 0;
    this.currentFrameLength = 0;
  }

  public resetBufferManagerInstance() {
    this.buffer = new Float32Array(this.incrementalAllocationSize);
    this.currentSampleLength = 0;
    this.currentFrameLength = 0;
  }
}
