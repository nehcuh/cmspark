/**
 * Mtg2 audio segment helper (pure + mock AudioContext).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  fileToWavSegments,
  uint8ToBase64,
  MEETING_AUDIO_IMPORT_MAX_FILE_BYTES,
} from "../src/sidepanel/voice/meeting-audio-import"
import { LOCAL_STT_SAMPLE_RATE } from "../src/sidepanel/voice/local-stt-detect"

test("uint8ToBase64 round-trip small", () => {
  const u = new Uint8Array([1, 2, 3, 250])
  const b64 = uint8ToBase64(u)
  assert.equal(typeof b64, "string")
  assert.ok(b64.length > 0)
})

test("fileToWavSegments rejects empty blob", async () => {
  const r = await fileToWavSegments(new Blob([]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "empty")
})

test("fileToWavSegments rejects oversize", async () => {
  const big = new Blob([new Uint8Array(MEETING_AUDIO_IMPORT_MAX_FILE_BYTES + 1)])
  const r = await fileToWavSegments(big)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "too_large")
})

test("fileToWavSegments with mock AudioContext produces segments", async () => {
  // 2.0s of silence at 16k mono as fake decode
  const samples = LOCAL_STT_SAMPLE_RATE * 2
  const channel = new Float32Array(samples)

  class FakeCtx {
    decodeAudioData = async () => ({
      length: samples,
      numberOfChannels: 1,
      sampleRate: LOCAL_STT_SAMPLE_RATE,
      duration: 2,
      getChannelData: () => channel,
    })
    close = async () => {}
  }

  const blob = new Blob([new Uint8Array([0, 1, 2, 3])])
  const r = await fileToWavSegments(blob, {
    audioContextFactory: () => new FakeCtx() as any,
    segmentMs: 1000, // 1s segments → ~2 segs
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(r.segments.length >= 2)
    assert.ok(r.segments[0]!.wav.length > 44)
    // RIFF header
    assert.equal(r.segments[0]!.wav[0], 0x52)
  }
})
