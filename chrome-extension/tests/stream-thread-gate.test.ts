// P0-B: pure helper tests for stream event thread gating.
// chat.token/done/error/aborted for non-active thread_id must not mutate active UI.

import test from "node:test"
import assert from "node:assert/strict"
import { shouldApplyStreamEvent } from "../src/sidepanel/hooks/useWebSocket"

test("shouldApplyStreamEvent: missing thread_id applies (legacy/compat)", () => {
  assert.equal(shouldApplyStreamEvent(undefined, "thread-a"), true)
  assert.equal(shouldApplyStreamEvent(null, "thread-a"), true)
  assert.equal(shouldApplyStreamEvent("", "thread-a"), true)
})

test("shouldApplyStreamEvent: matching thread_id applies", () => {
  assert.equal(shouldApplyStreamEvent("thread-a", "thread-a"), true)
})

test("shouldApplyStreamEvent: non-active thread_id is rejected", () => {
  assert.equal(shouldApplyStreamEvent("thread-b", "thread-a"), false)
  assert.equal(shouldApplyStreamEvent("thread-a", "thread-b"), false)
})

test("shouldApplyStreamEvent: activeThread null rejects set thread_id", () => {
  assert.equal(shouldApplyStreamEvent("thread-a", null), false)
  assert.equal(shouldApplyStreamEvent("thread-a", undefined), false)
})

test("shouldApplyStreamEvent: missing thread_id applies even when active is null", () => {
  // Legacy events without thread_id still apply so pre-thread_id wire stays usable.
  assert.equal(shouldApplyStreamEvent(undefined, null), true)
})
