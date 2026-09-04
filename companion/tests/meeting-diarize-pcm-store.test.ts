// #260 — in-memory PCM upload session store (embedding diarize front door).

import test from "node:test"
import assert from "node:assert/strict"

import {
  appendPcmChunk,
  consumeFinalizedPcm,
  createPcmSession,
  finalizePcmSession,
  pcmSessionCount,
  resetPcmSessionsForTests,
  DIARIZE_PCM_MAX_CHUNK_BYTES,
} from "../src/meeting/diarize-pcm-store"

function b64(bytes: number[]): string {
  return Buffer.from(Int16Array.from(bytes.map((v) => v * 16384)).buffer).toString("base64")
}

test("create → ok with session id dpcm_*", () => {
  resetPcmSessionsForTests()
  const r = createPcmSession({ segments: 3, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(r.ok)
  assert.match(r.value, /^dpcm_[0-9a-f]{16}$/)
  resetPcmSessionsForTests()
})

test("create rejects bad segments / sample rate / format", () => {
  resetPcmSessionsForTests()
  assert.equal(createPcmSession({ segments: 0, sampleRate: 16000, format: "pcm_s16le" }).ok, false)
  assert.equal(createPcmSession({ segments: 2001, sampleRate: 16000, format: "pcm_s16le" }).ok, false)
  assert.equal(createPcmSession({ segments: 2, sampleRate: 44100, format: "pcm_s16le" }).ok, false)
  assert.equal(createPcmSession({ segments: 2, sampleRate: 16000, format: "wav" }).ok, false)
  resetPcmSessionsForTests()
})

test("upload chunks accumulate per segment until finalize", () => {
  resetPcmSessionsForTests()
  const s = createPcmSession({ segments: 1, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(s.ok)
  const id = s.value
  const chunk = Buffer.from(Int16Array.from([1000, -1000]).buffer).toString("base64")
  const r1 = appendPcmChunk(id, 0, 0, chunk)
  assert.ok(r1.ok)
  if (r1.ok) assert.equal(r1.value.received, 4)
  const r2 = appendPcmChunk(id, 0, 1, chunk)
  assert.ok(r2.ok)
  if (r2.ok) assert.equal(r2.value.received, 8)
  resetPcmSessionsForTests()
})

test("seq must be contiguous per segment (seq_gap)", () => {
  resetPcmSessionsForTests()
  const s = createPcmSession({ segments: 1, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(s.ok)
  const id = s.value
  const chunk = Buffer.from(Int16Array.from([100, -100]).buffer).toString("base64")
  assert.ok(appendPcmChunk(id, 0, 0, chunk).ok)
  const gap = appendPcmChunk(id, 0, 2, chunk)
  assert.equal(gap.ok, false)
  if (!gap.ok) assert.equal(gap.code, "seq_gap")
  assert.ok(appendPcmChunk(id, 0, 1, chunk).ok)
  resetPcmSessionsForTests()
})

test("chunk caps: empty / oversize rejected; unknown session rejected", () => {
  resetPcmSessionsForTests()
  const s = createPcmSession({ segments: 1, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(s.ok)
  const id = s.value
  const empty = appendPcmChunk(id, 0, 0, "")
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.equal(empty.code, "empty_chunk")
  const big = Buffer.alloc(DIARIZE_PCM_MAX_CHUNK_BYTES + 2).toString("base64")
  const over = appendPcmChunk(id, 0, 0, big)
  assert.equal(over.ok, false)
  if (!over.ok) assert.equal(over.code, "chunk_too_large")
  const missing = appendPcmChunk("dpcm_deadbeefdeadbeef", 0, 0, "AAAA")
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.code, "session_not_found")
  const badIndex = appendPcmChunk(id, 5, 0, "AAAA")
  assert.equal(badIndex.ok, false)
  if (!badIndex.ok) assert.equal(badIndex.code, "invalid_index")
  resetPcmSessionsForTests()
})

test("full round trip: chunks → finalize(total_seqs) → consume → decoded floats", () => {
  resetPcmSessionsForTests()
  const s = createPcmSession({ segments: 2, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(s.ok)
  const id = s.value
  const chunkOf = (vals: number[]) => Buffer.from(Int16Array.from(vals).buffer).toString("base64")
  assert.ok(appendPcmChunk(id, 0, 0, chunkOf([16384, -16384])).ok)
  assert.ok(appendPcmChunk(id, 0, 1, chunkOf([8192])).ok)
  assert.ok(appendPcmChunk(id, 1, 0, chunkOf([-32768])).ok)

  const mismatch = finalizePcmSession(id, [1, 1])
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) assert.equal(mismatch.code, "total_seqs_mismatch")

  const fin = finalizePcmSession(id, [2, 1])
  assert.ok(fin.ok)

  const pcm = consumeFinalizedPcm(id)
  assert.ok(pcm)
  assert.equal(pcm!.length, 2)
  assert.equal(pcm![0]!.length, 3)
  assert.ok(Math.abs(pcm![0]![0]! - 0.5) < 1e-6)
  assert.ok(Math.abs(pcm![0]![1]! + 0.5) < 1e-6)
  assert.ok(Math.abs(pcm![0]![2]! - 0.25) < 1e-6)
  assert.ok(Math.abs(pcm![1]![0]! + 1) < 1e-6)

  // one-shot: second consume fails
  assert.equal(consumeFinalizedPcm(id), null)
  assert.equal(pcmSessionCount(), 0)
})

test("finalize rejects empty segment and odd byte length", () => {
  resetPcmSessionsForTests()
  const s = createPcmSession({ segments: 2, sampleRate: 16000, format: "pcm_s16le" })
  assert.ok(s.ok)
  const id = s.value
  const one = Buffer.from(Int16Array.from([1]).buffer).toString("base64")
  assert.ok(appendPcmChunk(id, 0, 0, one).ok)
  const empty = finalizePcmSession(id, [1, 0])
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.equal(empty.code, "empty_segment")
  resetPcmSessionsForTests()
})

test("TTL sweep drops stale sessions", () => {
  resetPcmSessionsForTests()
  const t0 = 1_000_000
  const s = createPcmSession({ segments: 1, sampleRate: 16000, format: "pcm_s16le" }, t0)
  assert.ok(s.ok)
  assert.equal(pcmSessionCount(), 1)
  // 11 minutes later → swept on next create
  createPcmSession({ segments: 1, sampleRate: 16000, format: "pcm_s16le" }, t0 + 11 * 60 * 1000)
  assert.equal(pcmSessionCount(), 1) // old one gone, new one present
  resetPcmSessionsForTests()
})
