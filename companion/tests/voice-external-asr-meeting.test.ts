import assert from "node:assert/strict"
import test from "node:test"
import { meetingExternalRefusal } from "../src/voice/external-asr-meeting"

test("meeting audio is not sent when the engine is external", () => {
  assert.deepEqual(meetingExternalRefusal("external"), { code: "meeting_external_unsupported" })
  assert.equal(meetingExternalRefusal("local"), null)
  assert.equal(meetingExternalRefusal("system"), null)
  assert.equal(meetingExternalRefusal("browser"), null)
})
