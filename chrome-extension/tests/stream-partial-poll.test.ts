import test from "node:test"
import assert from "node:assert/strict"
import {
  backoffPartialPollMs,
  nextPartialPollMs,
  STREAM_PARTIAL_POLL_DEFAULT_MS,
  STREAM_PARTIAL_POLL_MAX_MS,
  STREAM_PARTIAL_POLL_MIN_MS,
} from "../src/sidepanel/voice/stream-partial-poll"

test("nextPartialPollMs default when missing", () => {
  assert.equal(nextPartialPollMs(null), STREAM_PARTIAL_POLL_DEFAULT_MS)
  assert.equal(nextPartialPollMs(undefined), STREAM_PARTIAL_POLL_DEFAULT_MS)
  assert.equal(nextPartialPollMs(0), STREAM_PARTIAL_POLL_DEFAULT_MS)
})

test("nextPartialPollMs paces from infer wall", () => {
  // 2s infer → 2300ms poll
  assert.equal(nextPartialPollMs(2000), 2300)
  // clamp to min
  assert.equal(nextPartialPollMs(500), STREAM_PARTIAL_POLL_MIN_MS)
  // clamp to max
  assert.equal(nextPartialPollMs(20_000), STREAM_PARTIAL_POLL_MAX_MS)
})

test("backoffPartialPollMs grows then clamps", () => {
  const a = backoffPartialPollMs(1400)
  assert.ok(a > 1400)
  assert.equal(backoffPartialPollMs(STREAM_PARTIAL_POLL_MAX_MS), STREAM_PARTIAL_POLL_MAX_MS)
})
