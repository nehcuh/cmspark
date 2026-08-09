/**
 * P2 ARCH-PROTO-2: unknown WS types fail-closed under CMSPARK_WS_STRICT / production
 */
import test from "node:test"
import assert from "node:assert/strict"

// Import after pinning env for data dir isolation is optional for pure validate
import { validateWsMessage } from "../src/server"

test("unknown type allowed when not strict", () => {
  const prev = process.env.CMSPARK_WS_STRICT
  const nodeEnv = process.env.NODE_ENV
  delete process.env.CMSPARK_WS_STRICT
  process.env.NODE_ENV = "development"
  try {
    const r = validateWsMessage({ type: "totally.unknown.experimental", foo: 1 })
    assert.equal(r.valid, true)
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_WS_STRICT
    else process.env.CMSPARK_WS_STRICT = prev
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  }
})

test("unknown type rejected when CMSPARK_WS_STRICT=1", () => {
  const prev = process.env.CMSPARK_WS_STRICT
  process.env.CMSPARK_WS_STRICT = "1"
  try {
    const r = validateWsMessage({ type: "totally.unknown.experimental", foo: 1 })
    assert.equal(r.valid, false)
    assert.match(r.error || "", /Unknown message type/)
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_WS_STRICT
    else process.env.CMSPARK_WS_STRICT = prev
  }
})

test("voice.stt.start requires privacy_ack_v2 at validate layer", () => {
  const r = validateWsMessage({
    type: "voice.stt.start",
    v: 1,
    sessionId: "abcdefgh",
    modelId: "medium",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
  })
  assert.equal(r.valid, false)
  assert.match(r.error || "", /privacy_ack_v2/)
})
