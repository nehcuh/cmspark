import test from "node:test"
import assert from "node:assert/strict"
import { shouldApplyStreamEvent } from "../src/sidepanel/hooks/useWebSocket"

test("shouldApplyStreamEvent: missing thread_id fail-closed (P1)", () => {
  assert.equal(shouldApplyStreamEvent(undefined, "thread-a"), false)
  assert.equal(shouldApplyStreamEvent(null, "thread-a"), false)
  assert.equal(shouldApplyStreamEvent("", "thread-a"), false)
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

test("shouldApplyStreamEvent: missing thread_id rejected when active is null", () => {
  assert.equal(shouldApplyStreamEvent(undefined, null), false)
})

test("shouldApplyStreamEvent: upload-error style foreign thread is rejected", () => {
  assert.equal(shouldApplyStreamEvent("upload-thread-a", "active-thread-b"), false)
  assert.equal(shouldApplyStreamEvent("upload-thread-a", "upload-thread-a"), true)
})
