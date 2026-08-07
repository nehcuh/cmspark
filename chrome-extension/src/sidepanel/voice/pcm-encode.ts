/**
 * Path B — pure PCM / WAV helpers (Spike S2).
 * Uses Uint8Array only (no Node Buffer) for Side Panel / tests.
 */

import {
  LOCAL_STT_CHANNELS,
  LOCAL_STT_SAMPLE_RATE,
} from "./local-stt-detect"

/** Linear resample Float32 mono to target rate. */
export function resampleFloat32Mono(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error("invalid sample rate")
  }
  if (fromRate === toRate || input.length === 0) {
    return new Float32Array(input)
  }
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const out = new Float32Array(outLen)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = src - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

function writeU32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}
function writeU16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

/** Clamp float samples to int16 LE bytes (mono). */
export function float32ToS16lePcm(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < input.length; i++) {
    let s = input[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(i * 2, v, true)
  }
  return out
}

/** Build a minimal WAV (PCM s16le) container around raw PCM. */
export function wrapPcmS16leAsWav(
  pcm: Uint8Array,
  sampleRate = LOCAL_STT_SAMPLE_RATE,
  channels = LOCAL_STT_CHANNELS,
): Uint8Array {
  const dataSize = pcm.length
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  header.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  writeU32LE(view, 4, 36 + dataSize)
  header.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
  header.set([0x66, 0x6d, 0x74, 0x20], 12) // fmt
  writeU32LE(view, 16, 16)
  writeU16LE(view, 20, 1)
  writeU16LE(view, 22, channels)
  writeU32LE(view, 24, sampleRate)
  writeU32LE(view, 28, sampleRate * channels * 2)
  writeU16LE(view, 32, channels * 2)
  writeU16LE(view, 34, 16)
  header.set([0x64, 0x61, 0x74, 0x61], 36) // data
  writeU32LE(view, 40, dataSize)
  const out = new Uint8Array(44 + dataSize)
  out.set(header, 0)
  out.set(pcm, 44)
  return out
}

/**
 * Full pipeline: arbitrary-rate mono float → 16 kHz s16le WAV.
 * Spike S2 lock for Extension → Companion without ffmpeg.
 */
export function encodeMonoFloatToWav16k(
  input: Float32Array,
  fromRate: number,
): Uint8Array {
  const resampled = resampleFloat32Mono(input, fromRate, LOCAL_STT_SAMPLE_RATE)
  const pcm = float32ToS16lePcm(resampled)
  return wrapPcmS16leAsWav(pcm, LOCAL_STT_SAMPLE_RATE, LOCAL_STT_CHANNELS)
}

/** Split raw bytes into ordered chunks ≤ maxRaw each (for voice.stt.chunk). */
export function splitIntoChunks(
  data: Uint8Array,
  maxRaw = 256 * 1024,
): Uint8Array[] {
  if (maxRaw < 1) throw new Error("maxRaw must be >= 1")
  if (data.length === 0) return []
  const out: Uint8Array[] = []
  for (let off = 0; off < data.length; off += maxRaw) {
    out.push(data.subarray(off, Math.min(off + maxRaw, data.length)))
  }
  return out
}
