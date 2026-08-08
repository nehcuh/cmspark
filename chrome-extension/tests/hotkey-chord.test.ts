import test from "node:test"
import assert from "node:assert/strict"
import {
  parseHotkeyChord,
  eventMatchesChord,
  DICTATION_HOTKEY_DEFAULT_CHORD,
  formatChord,
} from "../src/sidepanel/voice/hotkey-chord"

test("parse default Control+Shift+Space", () => {
  const c = parseHotkeyChord(DICTATION_HOTKEY_DEFAULT_CHORD)
  assert.ok(c)
  assert.equal(c!.ctrl, true)
  assert.equal(c!.shift, true)
  assert.equal(c!.key, "space")
})

test("forbid bare key and Win+V", () => {
  assert.equal(parseHotkeyChord("Space"), null)
  assert.equal(parseHotkeyChord("Meta+V"), null)
  assert.equal(parseHotkeyChord("fn"), null)
})

test("eventMatchesChord space", () => {
  const c = parseHotkeyChord("Control+Shift+Space")!
  assert.equal(
    eventMatchesChord(
      { key: " ", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false },
      c,
    ),
    true,
  )
  assert.equal(
    eventMatchesChord(
      { key: " ", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
      c,
    ),
    false,
  )
})

test("formatChord round-trip label", () => {
  const c = parseHotkeyChord("Alt+Space")!
  assert.match(formatChord(c), /Alt/)
  assert.match(formatChord(c), /Space/i)
})
