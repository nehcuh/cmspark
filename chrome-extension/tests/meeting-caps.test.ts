import test from "node:test"
import assert from "node:assert/strict"
import {
  MEETING_LIVE_HARD_CAP_MS,
  MEETING_LIVE_SOFT_CAP_MS,
  MEETING_AUDIO_IMPORT_MAX_DURATION_SEC,
  clampMeetingHardCapMs,
  formatMeetingElapsed,
} from "../src/sidepanel/voice/meeting-caps"

test("meeting live caps are 2h soft / 3h hard", () => {
  assert.equal(MEETING_LIVE_SOFT_CAP_MS, 2 * 60 * 60_000)
  assert.equal(MEETING_LIVE_HARD_CAP_MS, 3 * 60 * 60_000)
  assert.equal(MEETING_AUDIO_IMPORT_MAX_DURATION_SEC, 3 * 3600)
})

test("formatMeetingElapsed h:mm:ss after one hour", () => {
  assert.equal(formatMeetingElapsed(65_000), "1:05")
  assert.equal(formatMeetingElapsed(3_661_000), "1:01:01")
  assert.equal(formatMeetingElapsed(0), "0:00")
})

test("clampMeetingHardCapMs", () => {
  assert.equal(clampMeetingHardCapMs(1000), 60_000)
  assert.equal(clampMeetingHardCapMs(MEETING_LIVE_HARD_CAP_MS), MEETING_LIVE_HARD_CAP_MS)
  assert.equal(clampMeetingHardCapMs(99 * 60 * 60_000), MEETING_LIVE_HARD_CAP_MS)
})
