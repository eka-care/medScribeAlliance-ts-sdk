import * as lamejs from '@breezystack/lamejs';
import { BITRATE, SAMPLING_RATE } from './constants';

export const compressAudioToMp3 = (audio: Float32Array): Uint8Array[] => {
  try {
    const audioEncoder = new lamejs.Mp3Encoder(1, SAMPLING_RATE, BITRATE);

    // convert Float32Array to Int16Array
    const samples = new Int16Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
        // Clamp the values to -1 to 1 range before converting
        const s = Math.max(-1, Math.min(1, audio[i]));
        // Convert to 16-bit PCM
        samples[i] = s < 0 ? s * 32768 : s * 32767;
    }

    const mp3Data: Uint8Array[] = [];
    const encodedBuffer = audioEncoder.encodeBuffer(samples) as Uint8Array;
    
    // lamejs can return undefined or empty arrays? 
    // The types say Uint8Array but let's be safe if it returns something else, 
    // but the original code assumes Uint8Array.
    
    if (encodedBuffer && encodedBuffer.length > 0) {
        mp3Data.push(encodedBuffer);
    }

    const lastAudioBuffer = audioEncoder.flush() as Uint8Array;
    if (lastAudioBuffer && lastAudioBuffer.length > 0) {
        mp3Data.push(lastAudioBuffer);
    }

    return mp3Data;
  } catch (error) {
    console.error('Error compressing audio to MP3: lamejs: ', error);
    return [];
  }
};
