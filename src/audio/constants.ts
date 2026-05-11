/**
 * Audio pipeline constants.
 *
 * Chunk length values define VAD clipping behavior:
 * - PREF: preferred chunk length — VAD tries to clip here if there's a long silence
 * - DESP: desperate chunk length — VAD clips at any short silence
 * - MAX: hard limit — force clip regardless of speech
 *
 * These are defaults. The actual max_chunk_duration_seconds comes from discovery
 * and overrides DESP/MAX when available.
 */

export const PREF_CHUNK_LENGTH = 10;
export const DESP_CHUNK_LENGTH = 20;
export const MAX_CHUNK_LENGTH = 25;

// Audio encoding
export const FRAME_SIZE = 1024;
export const SAMPLING_RATE = 16000;
export const DURATION_PER_FRAME = FRAME_SIZE / SAMPLING_RATE;
export const FRAME_RATE = SAMPLING_RATE / FRAME_SIZE;
export const BITRATE = 128;
export const CHANNELS = 1;
export const OUTPUT_FORMAT = 'mp3';

// VAD thresholds
export const SILENCE_THRESHOLD = 0.01;
export const SHORT_SILENCE_THRESHOLD = 0.1;
export const LONG_SILENCE_THRESHOLD = 0.5;
export const SPEECH_DETECTION_THRESHOLD = 0.5;
export const PRE_SPEECH_PAD_FRAMES = 20;

// Buffer allocation: DESP_CHUNK_LENGTH + 5s headroom
export const AUDIO_BUFFER_SIZE_IN_S = DESP_CHUNK_LENGTH + 5;

// Silence warning: trigger after 10s of continuous silence
export const SILENCE_WARNING_THRESHOLD_MS = 10000;
export const SILENCE_WARNING_COOLDOWN_MS = 2000;

// Audio MIME types
export const AUDIO_EXTENSION_TYPE_MAP: Record<string, string> = {
  m4a: 'audio/m4a',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};
