import test from "node:test"
import assert from "node:assert/strict"
import {
  MEETING_LIVE_HARD_CAP_MS,
  MEETING_LIVE_SOFT_CAP_MS,
  MEETING_AUDIO_IMPORT_MAX_DURATION_SEC,
  MEETING_STOP_FAILSAFE_MS,
  MEETING_DISCONNECT_FINALIZE_MS,
  clampMeetingHardCapMs,
  formatMeetingElapsed,
  meetingLiveInterimHint,
  meetingMinutesSendPlan,
  MEETING_MINUTES_WATCHDOG_MS,
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

test("meetingLiveInterimHint: stopping must not keep the 正在听 8s copy", () => {
  assert.equal(MEETING_STOP_FAILSAFE_MS, 20_000)
  assert.equal(MEETING_DISCONNECT_FINALIZE_MS, 5_000)
  assert.ok(
    MEETING_DISCONNECT_FINALIZE_MS < MEETING_STOP_FAILSAFE_MS,
    "disconnect debounce must fire before stop failsafe",
  )
  assert.equal(
    meetingLiveInterimHint({
      phase: "stopping",
      interimText: "",
      nearRealtime: true,
      refinePending: 0,
    }),
    "正在结束…等待最后一段识别",
  )
  assert.match(
    meetingLiveInterimHint({
      phase: "recording",
      interimText: "",
      nearRealtime: true,
      refinePending: 0,
    }),
    /正在听/,
  )
})

test("meetingMinutesSendPlan defers when Companion is down (do not stick 生成中)", () => {
  assert.equal(meetingMinutesSendPlan(true), "send")
  assert.equal(meetingMinutesSendPlan(false), "defer-reconnect")
  assert.equal(MEETING_MINUTES_WATCHDOG_MS, 90_000)
})
