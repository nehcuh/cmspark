/**
 * Mtg1 mutual exclusion flags in agentStore (meeting vs dictation).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

test("initialState: meeting/dictation capture flags false", () => {
  assert.equal(initialState.meetingCaptureActive, false)
  assert.equal(initialState.dictationCaptureActive, false)
})

test("SET_MEETING_CAPTURE_ACTIVE toggles", () => {
  const on = agentReducer(initialState, { type: "SET_MEETING_CAPTURE_ACTIVE", active: true })
  assert.equal(on.meetingCaptureActive, true)
  assert.equal(on.dictationCaptureActive, false)
  const off = agentReducer(on, { type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
  assert.equal(off.meetingCaptureActive, false)
})

test("SET_DICTATION_CAPTURE_ACTIVE toggles", () => {
  const on = agentReducer(initialState, { type: "SET_DICTATION_CAPTURE_ACTIVE", active: true })
  assert.equal(on.dictationCaptureActive, true)
  const off = agentReducer(on, { type: "SET_DICTATION_CAPTURE_ACTIVE", active: false })
  assert.equal(off.dictationCaptureActive, false)
})
