/**
 * Dictation+ D2 hold_state control plane.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  handleDictationHoldState,
  isDictationHoldActive,
  resetDictationHoldStateForTests,
} from "../src/voice/dictation-hotkey"

const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

test("hold_state origin denied", () => {
  resetDictationHoldStateForTests()
  const r = handleDictationHoldState(
    { type: "voice.dictation.hold_state", v: 1, active: true },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(r.code, "origin_denied")
  assert.equal(isDictationHoldActive(), false)
})

test("hold_state toggles active", () => {
  resetDictationHoldStateForTests()
  let seen: boolean | null = null
  const on = handleDictationHoldState(
    { type: "voice.dictation.hold_state", v: 1, active: true, chord: "Ctrl+Shift+Space" },
    { origin: EXT },
    { onHoldChange: (a) => { seen = a } },
  )
  assert.equal(on.ok, true)
  assert.equal(isDictationHoldActive(), true)
  assert.equal(seen, true)
  const off = handleDictationHoldState(
    { type: "voice.dictation.hold_state", v: 1, active: false },
    { origin: EXT },
  )
  assert.equal(off.active, false)
  assert.equal(isDictationHoldActive(), false)
})
