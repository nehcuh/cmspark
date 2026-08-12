import test from "node:test"
import assert from "node:assert/strict"
import {
  clampMeetingTemplate,
  MEETING_TEMPLATE_MAX_CHARS,
  MEETING_MINUTES_TEMPLATE_STORAGE_KEY,
} from "../src/sidepanel/voice/meeting-template-storage"

test("clampMeetingTemplate respects max", () => {
  assert.equal(clampMeetingTemplate("ab").length, 2)
  assert.equal(clampMeetingTemplate("x".repeat(MEETING_TEMPLATE_MAX_CHARS + 10)).length, MEETING_TEMPLATE_MAX_CHARS)
  assert.equal(MEETING_MINUTES_TEMPLATE_STORAGE_KEY, "meeting_minutes_template_v1")
})
