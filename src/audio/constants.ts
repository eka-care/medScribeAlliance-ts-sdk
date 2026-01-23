export const PREF_CHUNK_LENGTH = 10;
export const DESP_CHUNK_LENGTH = 20;
export const MAX_CHUNK_LENGTH = 25;
export const FRAME_SIZE = 1024;
export const SAMPLING_RATE = 16000;
export const DURATION_PER_FRAME = FRAME_SIZE / SAMPLING_RATE;
export const SILENCE_THRESHOLD = 0.01;
export const FRAME_RATE = SAMPLING_RATE / FRAME_SIZE;
export const SHORT_SILENCE_THRESHOLD = 0.1;
export const LONG_SILENCE_THRESHOLD = 0.5;
export const SPEECH_DETECTION_THRESHOLD = 0.5;
export const PRE_SPEECH_PAD_FRAMES = 20;
export const BITRATE = 128;
export const QUALITY = 0;
export const CHANNELS = 1;
export const AUDIO_BUFFER_SIZE_IN_S = DESP_CHUNK_LENGTH + 5;
export const OUTPUT_FORMAT = 'mp3';

export const AUDIO_EXTENSION_TYPE_MAP: Record<string, string> = {
  m4a: 'audio/m4a',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};
