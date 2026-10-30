import type { LiveVoiceName } from '../types/nova.ts';

export const ALLOWED_LIVE_VOICES: readonly LiveVoiceName[] = [
  'Zephyr',
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
];

export const LIVE_VOICE_DESCRIPTIONS: Record<LiveVoiceName, string> = {
  Zephyr: 'Warm & natural',
  Kore: 'Calm & clear',
  Puck: 'Upbeat & expressive',
  Charon: 'Deep & steady',
  Fenrir: 'Rich & resonant',
};

export function normalizeLiveVoice(raw: unknown): LiveVoiceName {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const match = ALLOWED_LIVE_VOICES.find(
      (v) => v.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) return match;
  }
  return 'Zephyr';
}

/**
 * Downsamples Float32 Web Audio samples [-1, 1] from any hardware sampleRate
 * (e.g. 48000 Hz or 44100 Hz) to 16-bit little-endian signed PCM at 16000 Hz.
 */
export function downsampleFloat32ToInt16Pcm(
  samples: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Int16Array {
  if (!samples || samples.length === 0) {
    return new Int16Array(0);
  }

  if (inputSampleRate <= 0 || inputSampleRate === targetSampleRate) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.min(
      samples.length,
      Math.round((offsetResult + 1) * ratio)
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += samples[i];
      count++;
    }
    const avg = count > 0 ? accum / count : samples[Math.min(offsetBuffer, samples.length - 1)];
    const clamped = Math.max(-1, Math.min(1, avg));
    out[offsetResult] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return out;
}

/**
 * Encodes a signed Int16Array as little-endian raw PCM bytes in Base64.
 */
export function int16PcmToBase64(pcm: Int16Array): string {
  if (pcm.length === 0) return '';
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);

  if (typeof btoa === 'function') {
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString('base64');
}

/**
 * Decodes Base64 16-bit little-endian raw PCM (e.g. 24000 Hz from Gemini Live)
 * into normalized Float32Array samples [-1, 1] for Web Audio playback.
 */
export function base64ToFloat32Pcm(base64: string): Float32Array {
  if (!base64) return new Float32Array(0);

  let bytes: Uint8Array;
  if (typeof atob === 'function') {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    const buf = Buffer.from(base64, 'base64');
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true); // little-endian 16-bit PCM
    float32[i] = int16 / 32768;
  }

  return float32;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.min(1, rms * 4.2);
}
