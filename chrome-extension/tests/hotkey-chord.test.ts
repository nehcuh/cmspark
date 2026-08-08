import test from "node:test"
import assert from "node:assert/strict"
import {
  parseHotkeyChord,
  eventMatchesChord,
  DICTATION_HOTKEY_DEFAULT_CHORD,
  formatChord,
  chordFromKeyboardEvent,
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

test("parseHotkeyChord normalizes KeyM and Digit1", () => {
  const m = parseHotkeyChord("Control+Shift+KeyM")
  assert.ok(m)
  assert.equal(m!.key, "m")
  assert.equal(
    eventMatchesChord(
      { key: "m", code: "KeyM", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false },
      m!,
    ),
    true,
  )
  const d = parseHotkeyChord("Control+Digit1")
  assert.ok(d)
  assert.equal(d!.key, "1")
})

test("chordFromKeyboardEvent captures Control+Shift+Space", () => {
  const raw = chordFromKeyboardEvent({
    key: " ",
    code: "Space",
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    metaKey: false,
  })
  assert.equal(raw, "Control+Shift+Space")
  assert.ok(parseHotkeyChord(raw!))
})

test("chordFromKeyboardEvent rejects bare Space and pure modifiers", () => {
  assert.equal(
    chordFromKeyboardEvent({
      key: " ",
      code: "Space",
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    }),
    null,
  )
  assert.equal(
    chordFromKeyboardEvent({
      key: "Control",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    }),
    null,
  )
})
