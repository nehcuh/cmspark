import test from "node:test"
import assert from "node:assert/strict"
import { formatMeetingDiarizeStatus } from "../src/sidepanel/voice/meeting-diarize-copy"

test("formatMeetingDiarizeStatus echoes K for auto audio cluster", () => {
  assert.match(formatMeetingDiarizeStatus("audio_cluster", 3), /已自动标/)
  assert.match(formatMeetingDiarizeStatus("audio_cluster", 3), /K=3/)
  assert.equal(/K=/.test(formatMeetingDiarizeStatus("audio_cluster", null)), false)
})

test("formatMeetingDiarizeStatus text_gap keeps weak-label copy and optional K", () => {
  assert.match(formatMeetingDiarizeStatus("text_gap", 2), /弱标/)
  assert.match(formatMeetingDiarizeStatus("text_gap", 2), /K=2/)
})
