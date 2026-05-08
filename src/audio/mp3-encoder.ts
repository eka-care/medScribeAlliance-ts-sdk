/**
 * Mp3Encoder — pure function that compresses Float32Array audio frames to MP3.
 *
 * Uses @breezystack/lamejs for encoding.
 * This is a stateless utility — no side effects, no transport calls.
 * Can run on main thread or inside a SharedWorker.
 */

import * as lamejs from '@breezystack/lamejs';
import { BITRATE, SAMPLING_RATE, CHANNELS, AUDIO_EXTENSION_TYPE_MAP, OUTPUT_FORMAT } from './constants';

/**
 * Compress raw PCM audio (Float32Array) into an MP3 Blob.
 *
 * @param audioFrames - Raw PCM audio samples (Float32 range: -1.0 to 1.0)
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @param bitrate - MP3 bitrate in kbps (default: 128)
 * @returns MP3 Blob ready for upload, or null if encoding fails
 */
export function encodeToMp3(
  audioFrames: Float32Array,
  sampleRate: number = SAMPLING_RATE,
  bitrate: number = BITRATE
): Blob | null {
  try {
    const encoder = new lamejs.Mp3Encoder(CHANNELS, sampleRate, bitrate);

    // Convert Float32Array to Int16Array (PCM 16-bit)
    const samples = new Int16Array(audioFrames.length);
    for (let i = 0; i < audioFrames.length; i++) {
      const clamped = Math.max(-1, Math.min(1, audioFrames[i]));
      samples[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }

    const mp3Chunks: Uint8Array[] = [];

    const encoded = encoder.encodeBuffer(samples) as Uint8Array;
    if (encoded && encoded.length > 0) {
      mp3Chunks.push(encoded);
    }

    const flushed = encoder.flush() as Uint8Array;
    if (flushed && flushed.length > 0) {
      mp3Chunks.push(flushed);
    }

    if (mp3Chunks.length === 0) {
      return null;
    }

    return new Blob(mp3Chunks, { type: AUDIO_EXTENSION_TYPE_MAP[OUTPUT_FORMAT] });
  } catch (error) {
    console.error('[ScribeSDK] MP3 encoding failed:', error);
    return null;
  }
}
