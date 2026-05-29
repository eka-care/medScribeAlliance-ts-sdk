/**
 * VadClient — wraps @ricky0123/vad-web MicVAD for voice activity detection.
 *
 * Responsibilities:
 * - Initialize microphone stream and MicVAD instance
 * - Process audio frames and detect clip points (silence-based chunking)
 * - Dispatch audio events via CallbackRegistry (frame_processed, user_speech, silence_warning)
 * - Start/pause/destroy VAD lifecycle
 *
 * This class does NOT handle:
 * - Audio buffering (AudioBufferManager)
 * - Chunk metadata (AudioFileManager)
 * - Compression or upload (WorkerManager)
 *
 * The ChunkedRecorder wires these together via the onClipPoint callback.
 */

import { MicVAD } from '@ricky0123/vad-web';
import { CallbackRegistry } from '../callbacks/callback-registry';
import { AudioEventType } from '../constants';
import {
  FRAME_SIZE,
  SHORT_SILENCE_THRESHOLD,
  LONG_SILENCE_THRESHOLD,
  PRE_SPEECH_PAD_FRAMES,
  SILENCE_WARNING_THRESHOLD_MS,
  SILENCE_WARNING_COOLDOWN_MS,
  SPEECH_DETECTION_THRESHOLD,
} from './constants';

export interface VadConfig {
  prefChunkLength: number;
  despChunkLength: number;
  maxChunkLength: number;
  samplingRate: number;
  frameSize?: number;
  preSpeechPadFrames?: number;
  shortSilenceThreshold?: number;
  longSilenceThreshold?: number;
}

export class VadClient {
  // VAD clipping state
  private vadPast: number[] = [];
  private lastClipIndex: number = 0;
  private silDurationAcc: number = 0;

  // Chunk length thresholds (in samples)
  private prefLengthSamples: number;
  private despLengthSamples: number;
  private maxLengthSamples: number;
  private shortThreshold: number;
  private longThreshold: number;
  private frameSize: number;
  private speechPadFrames: number;
  private samplingRate: number;

  // MicVAD instance
  private micVad: MicVAD | null = null;
  private micStream: MediaStream | null = null;
  private isLoading: boolean = true;
  private isRecording: boolean = false;

  // Silence warning state
  private noSpeechStartTime: number | null = null;
  private lastWarningTime: number | null = null;

  // Callback registry for dispatching audio events
  private callbackRegistry: CallbackRegistry;

  // Internal callbacks — set by ChunkedRecorder to wire VAD to audio pipeline
  private onClipPoint?: () => void;
  private onRawFrame?: (frame: Float32Array) => void;

  constructor(config: VadConfig, callbackRegistry: CallbackRegistry) {
    const sr = config.samplingRate;
    this.samplingRate = sr;
    this.prefLengthSamples = config.prefChunkLength * sr;
    this.despLengthSamples = config.despChunkLength * sr;
    this.maxLengthSamples = config.maxChunkLength * sr;
    this.shortThreshold = (config.shortSilenceThreshold ?? SHORT_SILENCE_THRESHOLD) * sr;
    this.longThreshold = (config.longSilenceThreshold ?? LONG_SILENCE_THRESHOLD) * sr;
    this.frameSize = config.frameSize ?? FRAME_SIZE;
    this.speechPadFrames = config.preSpeechPadFrames ?? PRE_SPEECH_PAD_FRAMES;
    this.callbackRegistry = callbackRegistry;
  }

  /**
   * Set the clip point callback — called by ChunkedRecorder to wire
   * clip detection to chunk creation.
   */
  setOnClipPoint(callback: () => void): void {
    this.onClipPoint = callback;
  }

  /**
   * Set the raw frame callback — called by ChunkedRecorder to wire
   * each VAD frame to AudioBufferManager (buffering) and AudioFileManager (sample tracking).
   * Only called while recording (frames during pause are skipped).
   */
  setOnRawFrame(callback: (frame: Float32Array) => void): void {
    this.onRawFrame = callback;
  }

  /**
   * Initialize the microphone stream and MicVAD instance.
   * @param deviceId - Optional specific microphone device ID
   */
  async init(deviceId?: string): Promise<void> {
    this.isLoading = true;
    this.stopMicStream();

    try {
      const stream = await this.getMicrophoneStream(deviceId);
      this.micStream = stream;

      const vad = await MicVAD.new({
        // @ts-ignore - stream is a valid option but not in all type definitions
        stream,
        frameSamples: this.frameSize,
        preSpeechPadFrames: this.speechPadFrames,
        onFrameProcessed: (probabilities: any, frame: Float32Array) => {
          this.handleFrameProcessed(probabilities, frame);
        },
        onSpeechStart: () => {
          this.callbackRegistry.dispatch('onAudioEvent', {
            type: AudioEventType.USER_SPEECH,
            timestamp: new Date().toISOString(),
            data: { isSpeaking: true },
          });
        },
        onSpeechEnd: () => {
          this.callbackRegistry.dispatch('onAudioEvent', {
            type: AudioEventType.USER_SPEECH,
            timestamp: new Date().toISOString(),
            data: { isSpeaking: false },
          });
        },
      });

      this.micVad = vad;
      this.isLoading = false;
    } catch (error) {
      this.stopMicStream();
      this.isLoading = false;
      throw error;
    }
  }

  /**
   * Start VAD processing (begin detecting speech/silence).
   */
  start(): void {
    try {
      if (this.micVad && typeof this.micVad.start === 'function') {
        this.micVad.start();
      }
      this.isRecording = true;
    } catch (error) {
      console.error('[ScribeSDK] Error starting VAD:', error);
      throw error;
    }
  }

  /**
   * Pause VAD processing (stop detecting, but keep mic stream alive).
   */
  pause(): void {
    try {
      if (this.micVad && typeof this.micVad.pause === 'function') {
        this.micVad.pause();
      }
      this.isRecording = false;
    } catch (error) {
      console.error('[ScribeSDK] Error pausing VAD:', error);
    }
  }

  /**
   * Destroy the MicVAD instance and release the mic stream.
   */
  destroy(): void {
    // Stop mic tracks first — synchronous and immediate.
    // This ensures the browser releases the mic indicator regardless
    // of whether MicVAD's internal cleanup completes synchronously.
    this.stopMicStream();

    try {
      if (this.micVad && typeof this.micVad.destroy === 'function') {
        this.micVad.destroy();
      }
    } catch (error) {
      console.error('[ScribeSDK] Error destroying VAD:', error);
    }
    this.isRecording = false;
  }

  /**
   * Full reset — destroy VAD and clear all clipping state.
   */
  reset(): void {
    this.destroy();
    this.vadPast = [];
    this.lastClipIndex = 0;
    this.silDurationAcc = 0;
    this.noSpeechStartTime = null;
    this.lastWarningTime = null;
    this.isLoading = true;
    this.micVad = null;
  }

  /**
   * Update chunk length thresholds (e.g., from discovery config).
   */
  updateChunkLengths(config: {
    prefChunkLength?: number;
    despChunkLength?: number;
    maxChunkLength?: number;
    samplingRate?: number;
  }): void {
    const sr = config.samplingRate ?? this.samplingRate;
    if (config.prefChunkLength !== undefined) {
      this.prefLengthSamples = config.prefChunkLength * sr;
    }
    if (config.despChunkLength !== undefined) {
      this.despLengthSamples = config.despChunkLength * sr;
    }
    if (config.maxChunkLength !== undefined) {
      this.maxLengthSamples = config.maxChunkLength * sr;
    }
  }

  isVadLoading(): boolean {
    return this.isLoading;
  }

  isVadRecording(): boolean {
    return this.isRecording;
  }

  // --- Private ---

  /**
   * Handle each frame from MicVAD.
   * Dispatches frame_processed via CallbackRegistry, then checks for clip points.
   */
  private handleFrameProcessed(
    probabilities: { isSpeech: number; notSpeech: number },
    frame: Float32Array
  ): void {
    try {
      // Dispatch frame_processed audio event via CallbackRegistry
      this.callbackRegistry.dispatch('onAudioEvent', {
        type: AudioEventType.FRAME_PROCESSED,
        timestamp: new Date().toISOString(),
        data: {
          isSpeech: probabilities.isSpeech,
          notSpeech: probabilities.notSpeech,
          frame,
          duration: frame.length / this.samplingRate,
        },
      });

      // Skip clipping logic and frame buffering if not recording
      if (!this.isRecording) {
        return;
      }

      // Pass raw frame to ChunkedRecorder for buffering + sample tracking.
      // This must happen BEFORE clip detection so the buffer has the frame
      // when a clip point triggers chunk creation.
      this.onRawFrame?.(frame);

      // Determine VAD decision
      const vadDecision = probabilities.isSpeech >= SPEECH_DETECTION_THRESHOLD ? 1 : 0;

      // Check for silence warnings
      this.checkSilence(vadDecision);

      // Process VAD frame for clip point detection
      const isClipPoint = this.processVadFrame(vadDecision);

      // VadClient only detects clip points — it does NOT handle buffering, chunking, or upload.
      // ChunkedRecorder sets this callback via setOnClipPoint() to wire
      // clip detection → chunk creation → WorkerManager (compression + upload).
      if (isClipPoint) {
        this.onClipPoint?.();
      }
    } catch (error) {
      console.error('[ScribeSDK] Error in frame processing:', error);
    }
  }

  /**
   * Core VAD clipping algorithm.
   * Determines if the current frame is a good point to clip the audio into a chunk.
   *
   * Logic (mutually exclusive — first match wins):
   * 1. After preferred length: clip at long silence
   * 2. After desperate length: clip at short silence
   * 3. After max length: force clip
   */
  private processVadFrame(vadDecision: number): boolean {
    let isClipPoint = false;

    // Track silence accumulation
    if (this.vadPast.length > 0) {
      if (vadDecision === 0) {
        this.silDurationAcc += 1;
      }
      if (vadDecision === 1) {
        this.silDurationAcc = 0;
      }
    }

    const samplesPassed = (this.vadPast.length - this.lastClipIndex) * this.frameSize;
    const silenceSamples = this.silDurationAcc * this.frameSize;

    // After preferred length — clip at long silence
    if (samplesPassed > this.prefLengthSamples && silenceSamples > this.longThreshold) {
      this.lastClipIndex = this.vadPast.length - Math.min(Math.floor(this.silDurationAcc / 2), 5);
      this.silDurationAcc = 0;
      isClipPoint = true;
    }
    // After desperate length — clip at short silence
    else if (samplesPassed > this.despLengthSamples && silenceSamples > this.shortThreshold) {
      this.lastClipIndex = this.vadPast.length - Math.min(Math.floor(this.silDurationAcc / 2), 5);
      this.silDurationAcc = 0;
      isClipPoint = true;
    }
    // After max length — force clip
    else if (samplesPassed >= this.maxLengthSamples) {
      this.lastClipIndex = this.vadPast.length;
      this.silDurationAcc = 0;
      isClipPoint = true;
    }

    this.vadPast.push(vadDecision);

    // Trim history after clip to prevent unbounded memory growth
    if (isClipPoint) {
      this.vadPast = this.vadPast.slice(this.lastClipIndex);
      this.lastClipIndex = 0;
    }

    return isClipPoint;
  }

  /**
   * Check for continuous silence and dispatch silence_warning via CallbackRegistry.
   */
  private checkSilence(vadDecision: number): void {
    const now = Date.now();

    if (vadDecision === 0) {
      // Silence
      if (this.noSpeechStartTime === null) {
        this.noSpeechStartTime = now;
      } else {
        const silenceDuration = now - this.noSpeechStartTime;
        if (silenceDuration >= SILENCE_WARNING_THRESHOLD_MS) {
          if (
            this.lastWarningTime === null ||
            now - this.lastWarningTime >= SILENCE_WARNING_COOLDOWN_MS
          ) {
            this.callbackRegistry.dispatch('onAudioEvent', {
              type: AudioEventType.SILENCE_WARNING,
              timestamp: new Date().toISOString(),
              data: { durationMs: silenceDuration },
            });
            this.lastWarningTime = now;
            this.noSpeechStartTime = now;
          }
        }
      }
    } else {
      // Speech detected — reset silence tracking
      this.noSpeechStartTime = null;
      this.lastWarningTime = null;
    }
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

  private stopMicStream(): void {
    try {
      this.micStream?.getTracks().forEach((track) => track.stop());
    } catch {
      // Ignore cleanup errors
    }
    this.micStream = null;
  }
}
