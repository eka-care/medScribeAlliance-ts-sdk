import { MicVAD } from '@ricky0123/vad-web';
import {
  FRAME_SIZE,
  LONG_SILENCE_THRESHOLD,
  OUTPUT_FORMAT,
  PRE_SPEECH_PAD_FRAMES,
  SHORT_SILENCE_THRESHOLD,
} from './constants';
import { ErrorCode, HttpStatus } from '../constants';
import { TAudioChunksInfo, TVadFrameProcessedCallback, TVadFramesCallback, TUserSpeechCallback } from './types';
import { AudioBufferManager } from './audio-buffer-manager';
import { AudioFileManager } from './audio-file-manager';
// We will import AudioFileManager after we define it, or use a forward ref / interface if possible.
// For now, I'll assume AudioFileManager is available or use `any` for the manager 
// to avoid circular dependency issues if they exist, but best is to import the class or interface.
// Since AudioFileManager depends on VAD? No, VAD depends on AudioFileManager.

export class VadWebClient {
  private vad_past: number[];
  private last_clip_index: number;
  private clip_points: number[];
  private sil_duration_acc: number;
  private pref_length_samples: number;
  private desp_length_samples: number;
  private max_length_samples: number;
  private shor_thsld: number;
  private long_thsld: number;
  private frame_size: number;
  private speech_pad_frames: number;
  private micVad: MicVAD | any; // Type 'MicVAD' is not exported directly sometimes, using any as fallback or the imported class
  private micStream: MediaStream | null = null;
  private is_vad_loading: boolean = true;
  private noSpeechStartTime: number | null = null;
  private recording_started: boolean = false;
  private lastWarningTime: number | null = null;
  private warningCooldownPeriod: number = 2000; // 2 seconds cooldown after warning

  // Callbacks
  private onVadFramesCallback?: TVadFramesCallback;
  private onVadFrameProcessedCallback?: TVadFrameProcessedCallback;
  private onUserSpeechCallback?: TUserSpeechCallback;

  // Dependencies
  private audioFileManager?: AudioFileManager;
  private audioBufferManager?: AudioBufferManager;

  constructor(
    pref_length: number, 
    desp_length: number, 
    max_length: number, 
    sr: number,
    audioFileManager?: AudioFileManager,
    audioBufferManager?: AudioBufferManager
  ) {
    this.vad_past = [];
    this.last_clip_index = 0;
    this.clip_points = [0];
    this.sil_duration_acc = 0;
    this.pref_length_samples = pref_length * sr;
    this.desp_length_samples = desp_length * sr;
    this.max_length_samples = max_length * sr;
    this.shor_thsld = SHORT_SILENCE_THRESHOLD * sr;
    this.long_thsld = LONG_SILENCE_THRESHOLD * sr;
    this.frame_size = FRAME_SIZE;
    this.speech_pad_frames = PRE_SPEECH_PAD_FRAMES;
    this.micVad = {} as MicVAD;
    
    this.audioFileManager = audioFileManager;
    this.audioBufferManager = audioBufferManager;
  }

  setDependencies(audioFileManager: AudioFileManager, audioBufferManager: AudioBufferManager) {
    this.audioFileManager = audioFileManager;
    this.audioBufferManager = audioBufferManager;
  }

  setCallbacks(
    onVadFrames?: TVadFramesCallback,
    onVadFrameProcessed?: TVadFrameProcessedCallback,
    onUserSpeech?: TUserSpeechCallback
  ) {
    this.onVadFramesCallback = onVadFrames;
    this.onVadFrameProcessedCallback = onVadFrameProcessed;
    this.onUserSpeechCallback = onUserSpeech;
  }

  private stopMicStream() {
    try {
      this.micStream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    } finally {
      this.micStream = null;
    }
  }

  /**
   * Check for continuous silence and trigger periodic warnings
   * @param isSpeech - vad probability (0 or 1)
   */
  checkNoSpeech(isSpeech: number) {
    if (!this.recording_started) return;

    const now = Date.now();
    const silenceThreshold = 10000; // 10 seconds

    if (isSpeech === 0) {
      if (this.noSpeechStartTime === null) {
        this.noSpeechStartTime = now;
      } else {
        const silenceDuration = now - this.noSpeechStartTime;

        // Check if we should show a warning (every 10 seconds of silence)
        if (silenceDuration >= silenceThreshold) {
          // Check if enough time has passed since the last warning (cooldown period)
          if (
            this.lastWarningTime === null ||
            now - this.lastWarningTime >= this.warningCooldownPeriod
          ) {
            if (this.onVadFramesCallback) {
              this.onVadFramesCallback({
                message:
                  'No audio detected for a while. Please talk or stop the recording if done.',
                error_code: ErrorCode.AUDIO_QUALITY_POOR, // utilizing nearest error code
                status_code: HttpStatus.BAD_REQUEST, // utilizing appropriate status code
              });
            }
            this.lastWarningTime = now;
            // Reset the silence timer to start counting the next 10 seconds
            this.noSpeechStartTime = now;
          }
        }
      }
    } else {
      // Reset timers when speech is detected
      this.noSpeechStartTime = null;
      this.lastWarningTime = null;
      if (this.onVadFramesCallback) {
        this.onVadFramesCallback({
          message: 'Audio captured. Recording continues.',
          status_code: HttpStatus.OK,
        });
      }
    }
  }

  getMicVad(): MicVAD {
    return this.micVad;
  }

  isVadLoading(): boolean {
    return this.is_vad_loading;
  }

  processVadFrame(vad_frame: number): [boolean, number] {
    let is_clip_point_frame: boolean = false;

    if (this.vad_past.length > 0) {
      if (vad_frame === 0) {
        this.sil_duration_acc += 1;
      }
      if (vad_frame === 1) {
        this.sil_duration_acc = 0;
      }
    }

    const sample_passed: number = this.vad_past.length - this.last_clip_index;

    if (sample_passed > this.pref_length_samples) {
      if (this.sil_duration_acc > this.long_thsld) {
        this.last_clip_index =
          this.vad_past.length - Math.min(Math.floor(this.sil_duration_acc / 2), 5);
        this.clip_points.push(this.last_clip_index);
        this.sil_duration_acc = 0;
        is_clip_point_frame = true;
      }
    }

    if (sample_passed > this.desp_length_samples) {
      if (this.sil_duration_acc > this.shor_thsld) {
        this.last_clip_index =
          this.vad_past.length - Math.min(Math.floor(this.sil_duration_acc / 2), 5);
        this.clip_points.push(this.last_clip_index);
        this.sil_duration_acc = 0;
        is_clip_point_frame = true;
      }
    }

    if (sample_passed >= this.max_length_samples) {
      this.last_clip_index = this.vad_past.length;
      this.clip_points.push(this.last_clip_index);
      this.sil_duration_acc = 0;
      is_clip_point_frame = true;
    }

    this.vad_past.push(vad_frame);

    if (is_clip_point_frame) {
      return [true, this.clip_points[this.clip_points.length - 1]];
    }

    return [false, this.clip_points[this.clip_points.length - 1]];
  }

  async initVad(deviceId?: string): Promise<boolean> {
    this.is_vad_loading = true;

    this.stopMicStream();

    let selectedMicrophoneStream: MediaStream;
    try {
      selectedMicrophoneStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (e: any) {
      if (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError') {
        selectedMicrophoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw e;
      }
    }

    this.micStream = selectedMicrophoneStream;

    try {
      const vad = await MicVAD.new({
        // @ts-ignore
        stream: selectedMicrophoneStream,
        frameSamples: this.frame_size,
        preSpeechPadFrames: this.speech_pad_frames,
        onFrameProcessed: (prob: any, frames: Float32Array) => {
          if (this.onVadFrameProcessedCallback) {
            this.onVadFrameProcessedCallback({ probabilities: prob, frame: frames });
          }

          if (!this.recording_started) {
            return;
          }

          this.audioFileManager?.incrementTotalRawSamples(frames);
          this.audioBufferManager?.append(frames);

          const { isSpeech } = prob;
          let vad_dec = 0;
          if (isSpeech >= 0.5) {
            vad_dec = 1;
          }

          this.checkNoSpeech(vad_dec);

          const vadResponse = this.processVadFrame(vad_dec);
          const is_clip_point = vadResponse[0];

          if (is_clip_point) {
            const activeAudioChunk = this.audioBufferManager?.getAudioData();
            if (activeAudioChunk) {
               this.processAudioChunk({ audioFrames: activeAudioChunk });
            }
          }
        },
        onSpeechStart: () => {
          this.onUserSpeechCallback?.(true);
        },
        onSpeechEnd: () => {
          this.onUserSpeechCallback?.(false);
        },
      });

      this.is_vad_loading = false;
      this.micVad = vad;
      return !this.is_vad_loading;
    } catch (e) {
      this.stopMicStream();
      this.is_vad_loading = false;
      throw e;
    }
  }

  async reinitializeVad(deviceId?: string) {
    const response = await this.initVad(deviceId);
    return response;
  }

  async processAudioChunk({ audioFrames }: { audioFrames?: Float32Array }) {
    if (!audioFrames || !this.audioFileManager || !this.audioBufferManager) return;

    const filenumber = (this.audioFileManager.audioChunks.length || 0) + 1;
    const fileName = `${filenumber}.${OUTPUT_FORMAT}`;

    const rawSampleDetails = this.audioFileManager.getRawSampleDetails();
    const chunkTimestamps = this.audioBufferManager.calculateChunkTimestamps(rawSampleDetails.totalRawSamples);

    try {
      const chunkInfo: TAudioChunksInfo = {
        fileName,
        timestamp: {
          st: chunkTimestamps.start,
          et: chunkTimestamps.end,
        },
        status: 'pending',
        audioFrames,
      };

      const audioChunkLength = this.audioFileManager.updateAudioInfo(chunkInfo);

      this.audioFileManager.incrementInsertedSamples(
        this.audioBufferManager.getCurrentSampleLength(),
        this.audioBufferManager.getCurrentFrameLength()
      );
      this.audioBufferManager.resetBufferState();

      await this.audioFileManager.uploadAudio({
        audioFrames,
        fileName,
        chunkIndex: audioChunkLength - 1,
      });
    } catch (error) {
      console.error('Error uploading audio chunk:', error);
    }
  }

  startVad() {
    if (this.micVad && typeof this.micVad.start === 'function') {
      this.micVad.start();
    }
    this.recording_started = true;
  }

  pauseVad() {
    if (this.micVad && typeof this.micVad.pause === 'function') {
      this.micVad.pause();
    }
    this.recording_started = false;
  }

  destroyVad() {
    if (this.micVad && typeof this.micVad.destroy === 'function') {
      this.micVad.destroy();
    }
    this.stopMicStream();
    this.recording_started = false;
  }

  resetVadWebInstance() {
    if (this.micVad && typeof this.micVad.destroy === 'function') {
      this.micVad.destroy();
    }
    this.stopMicStream();

    this.vad_past = [];
    this.last_clip_index = 0;
    this.clip_points = [0];
    this.sil_duration_acc = 0;
    this.noSpeechStartTime = null;
    this.lastWarningTime = null;
    this.recording_started = false;
    this.is_vad_loading = true;
  }
  
  configureVadConstants({
    pref_length,
    desp_length,
    max_length,
    sr,
    frame_size,
    pre_speech_pad_frames,
    short_thsld,
    long_thsld,
  }: {
    pref_length: number;
    desp_length: number;
    max_length: number;
    sr: number;
    frame_size: number;
    pre_speech_pad_frames: number;
    short_thsld: number;
    long_thsld: number;
  }) {
    this.pref_length_samples = pref_length * sr;
    this.desp_length_samples = desp_length * sr;
    this.max_length_samples = max_length * sr;
    this.shor_thsld = short_thsld * sr;
    this.long_thsld = long_thsld * sr;
    this.frame_size = frame_size;
    this.speech_pad_frames = pre_speech_pad_frames;
  }
}
