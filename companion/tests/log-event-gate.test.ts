// Unit tests for inbound log.event rate limit (echo-loop backstop).

import test from "node:test"
import assert from "node:assert/strict"
import {
  allowInboundLogEvent,
  LOG_EVENT_MAX_PER_SEC,
  seedLogEventBucketForTests,
} from "../src/log-event-gate.js"

/** Minimal stand-in for a WebSocket identity (WeakMap key only). */
function fakeWs(): object {
  return {}
}

test("allows up to LOG_EVENT_MAX_PER_SEC events in the same second", () => {
  const ws = fakeWs() as any
  const t0 = 1_000_000
  seedLogEventBucketForTests(ws, { tokens: LOG_EVENT_MAX_PER_SEC, lastRefillMs: t0 })

  let allowed = 0
  for (let i = 0; i < LOG_EVENT_MAX_PER_SEC + 5; i++) {
    if (allowInboundLogEvent(ws, t0)) allowed++
  }
  assert.equal(allowed, LOG_EVENT_MAX_PER_SEC)
})

test("refills tokens after one second", () => {
  const ws = fakeWs() as any
  const t0 = 2_000_000
  seedLogEventBucketForTests(ws, { tokens: 0, lastRefillMs: t0 })

  assert.equal(allowInboundLogEvent(ws, t0), false)
  // After 1s, full refill
  assert.equal(allowInboundLogEvent(ws, t0 + 1000), true)
})

test("independent buckets per connection", () => {
  const a = fakeWs() as any
  const b = fakeWs() as any
  const t0 = 3_000_000
  seedLogEventBucketForTests(a, { tokens: 0, lastRefillMs: t0 })
  seedLogEventBucketForTests(b, { tokens: LOG_EVENT_MAX_PER_SEC, lastRefillMs: t0 })

  assert.equal(allowInboundLogEvent(a, t0), false)
  assert.equal(allowInboundLogEvent(b, t0), true)
})

test("new connection starts with a full bucket", () => {
  const ws = fakeWs() as any
  const t0 = 4_000_000
  let allowed = 0
  for (let i = 0; i < LOG_EVENT_MAX_PER_SEC; i++) {
    if (allowInboundLogEvent(ws, t0)) allowed++
  }
  assert.equal(allowed, LOG_EVENT_MAX_PER_SEC)
  assert.equal(allowInboundLogEvent(ws, t0), false)
})
