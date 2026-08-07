// Path B Spike S5 — pure STT session reassembly

import test from "node:test"
import assert from "node:assert/strict"
import { SttSessionCore } from "../src/voice/stt-session-core"
import { STT_MAX_CHUNK_BYTES, STT_MAX_SESSION_BYTES } from "../src/voice/session-caps"

test("start + contiguous chunks + end", () => {
  const core = new SttSessionCore(() => 1_000_000)
  const s = core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(s.ok, true)
  assert.equal(core.appendChunk("a", 0, Buffer.from("hello")).ok, true)
  assert.equal(core.appendChunk("a", 1, Buffer.from(" world")).ok, true)
  const end = core.end("a", 2)
  assert.equal(end.ok, true)
  assert.equal(end.audio?.toString(), "hello world")
})

test("session_busy while receiving", () => {
  const core = new SttSessionCore()
  assert.equal(
    core.start({
      sessionId: "a",
      modelId: "medium",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    }).ok,
    true,
  )
  const r = core.start({
    sessionId: "b",
    modelId: "small",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "session_busy")
})

test("invalid model rejected", () => {
  const core = new SttSessionCore()
  const r = core.start({
    sessionId: "a",
    modelId: "tiny",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "invalid_model")
})

test("seq gap and duplicate", () => {
  const core = new SttSessionCore()
  core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(core.appendChunk("a", 0, Buffer.from("x")).ok, true)
  const gap = core.appendChunk("a", 2, Buffer.from("y"))
  assert.equal(gap.ok, false)
  if (!gap.ok) assert.equal(gap.code, "seq_gap")
  const dup = core.appendChunk("a", 0, Buffer.from("z"))
  assert.equal(dup.ok, false)
  if (!dup.ok) assert.equal(dup.code, "seq_duplicate")
})

test("chunk oversize", () => {
  const core = new SttSessionCore()
  core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  const big = Buffer.alloc(STT_MAX_CHUNK_BYTES + 1)
  const r = core.appendChunk("a", 0, big)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "payload_too_large")
})

test("session budget", () => {
  const core = new SttSessionCore()
  core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  // Fill under budget with full chunks, then overflow with remaining+1
  const chunk = Buffer.alloc(STT_MAX_CHUNK_BYTES, 1)
  let seq = 0
  let total = 0
  while (total + chunk.length <= STT_MAX_SESSION_BYTES) {
    assert.equal(core.appendChunk("a", seq, chunk).ok, true)
    total += chunk.length
    seq++
  }
  const remaining = STT_MAX_SESSION_BYTES - total
  const over = core.appendChunk("a", seq, Buffer.alloc(remaining + 1, 2))
  assert.equal(over.ok, false)
  if (!over.ok) assert.equal(over.code, "payload_too_large")
})

test("abort clears session; late chunk no-op style error", () => {
  const core = new SttSessionCore()
  core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(core.appendChunk("a", 0, Buffer.from("x")).ok, true)
  assert.equal(core.abort("a").ok, true)
  assert.equal(core.getActive(), null)
  const late = core.appendChunk("a", 1, Buffer.from("y"))
  assert.equal(late.ok, false)
  if (!late.ok) assert.equal(late.code, "session_unknown")
})

test("totalSeq mismatch", () => {
  const core = new SttSessionCore()
  core.start({
    sessionId: "a",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  core.appendChunk("a", 0, Buffer.from("x"))
  const end = core.end("a", 2)
  assert.equal(end.ok, false)
  if (!end.ok) assert.equal(end.code, "total_seq_mismatch")
})
