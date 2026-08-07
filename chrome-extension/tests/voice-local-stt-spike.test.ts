// Path B Spike S0–S2 pure tests — detect + budget + pcm-encode

import test from "node:test"
import assert from "node:assert/strict"
import {
  detectLocalMediaCapture,
  estimatePcmS16leBytes,
  pcmWithinSessionBudget,
  LOCAL_STT_MAX_PCM_BYTES,
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_SAMPLE_RATE,
} from "../src/sidepanel/voice/local-stt-detect"
import {
  encodeMonoFloatToWav16k,
  float32ToS16lePcm,
  resampleFloat32Mono,
  splitIntoChunks,
  wrapPcmS16leAsWav,
} from "../src/sidepanel/voice/pcm-encode"

test("S0: detectLocalMediaCapture missing pieces", () => {
  assert.equal(detectLocalMediaCapture({}).ok, false)
  assert.equal(
    detectLocalMediaCapture({ navigator: {} as any }).ok,
    false,
  )
  assert.equal(
    detectLocalMediaCapture({
      navigator: { mediaDevices: {} },
      MediaRecorder: function () {},
    } as any).ok,
    false,
  )
})

test("S0: detectLocalMediaCapture ok when gUM + MediaRecorder present", () => {
  const d = detectLocalMediaCapture({
    navigator: {
      mediaDevices: { getUserMedia: async () => ({}) },
    },
    MediaRecorder: function MediaRecorder() {},
  } as any)
  assert.equal(d.ok, true)
})

test("S1: 45s PCM estimate under session budget", () => {
  const bytes = estimatePcmS16leBytes(LOCAL_STT_MAX_RECORD_MS)
  assert.equal(bytes, 1_440_000)
  assert.ok(pcmWithinSessionBudget(LOCAL_STT_MAX_RECORD_MS))
  assert.ok(bytes <= LOCAL_STT_MAX_PCM_BYTES)
  assert.equal(pcmWithinSessionBudget(120_000), false)
})

test("S2: resample identity at same rate", () => {
  const a = new Float32Array([0, 0.5, -0.5, 1])
  const b = resampleFloat32Mono(a, 16000, 16000)
  assert.equal(b.length, a.length)
  assert.equal(b[1], 0.5)
})

test("S2: resample halves length when down 2x", () => {
  const a = new Float32Array(8)
  for (let i = 0; i < 8; i++) a[i] = i / 8
  const b = resampleFloat32Mono(a, 32000, 16000)
  assert.equal(b.length, 4)
})

test("S2: float32ToS16lePcm length and silence", () => {
  const pcm = float32ToS16lePcm(new Float32Array(4))
  assert.equal(pcm.length, 8)
  assert.equal(pcm[0], 0)
  assert.equal(pcm[1], 0)
})

test("S2: WAV header magic + data size", () => {
  const pcm = float32ToS16lePcm(new Float32Array(10))
  const wav = wrapPcmS16leAsWav(pcm, LOCAL_STT_SAMPLE_RATE, 1)
  assert.equal(wav.length, 44 + 20)
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF")
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE")
  const dataSize = new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(40, true)
  assert.equal(dataSize, 20)
})

test("S2: encodeMonoFloatToWav16k from 48k", () => {
  // 48000 samples = 1s @ 48k → ~16000 samples @ 16k
  const input = new Float32Array(48000)
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 40) * 0.1
  const wav = encodeMonoFloatToWav16k(input, 48000)
  assert.ok(wav.length > 44)
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF")
  // PCM body ≈ 16000 * 2
  assert.ok(wav.length >= 44 + 15000 * 2)
  assert.ok(wav.length <= 44 + 17000 * 2)
})

test("S2: splitIntoChunks contiguous", () => {
  const data = new Uint8Array(1000)
  data[0] = 1
  data[999] = 2
  const parts = splitIntoChunks(data, 300)
  assert.equal(parts.length, 4)
  assert.equal(parts[0].length, 300)
  assert.equal(parts[3].length, 100)
  assert.equal(parts[0][0], 1)
  assert.equal(parts[3][99], 2)
})
