import test from "node:test"
import assert from "node:assert/strict"
import { buildTypeFallbackExpression } from "../src/background/type-fallback"
import { selectAllKeyPayloads, cdpModifiersFromKeys, windowsVirtualKeyCode } from "../src/background/cdp-keys"
import { INTERACTIVE_SEL } from "../src/background/find-element-by-text"

test("type fallback never assigns el.value outside INPUT/TEXTAREA branch", () => {
  const expr = buildTypeFallbackExpression("hello", '[role="textbox"]')
  assert.match(expr, /tag==='INPUT'/)
  assert.match(expr, /kind:'insertText'/)
  assert.match(expr, /reason:'unsupported'/)
  const ceBranch = expr.slice(expr.indexOf("if(ce)"))
  assert.equal(ceBranch.includes("el.value="), false)
})

test("fill_form Ctrl+A half carries windowsVirtualKeyCode", () => {
  const payloads = selectAllKeyPayloads()
  const ctrl = payloads.filter((p) => p.ctrlKey)
  assert.equal(ctrl.length, 2)
  for (const p of ctrl) {
    assert.equal(p.windowsVirtualKeyCode, 65)
    assert.equal(p.modifiers, 2)
  }
  const meta = payloads.filter((p) => p.metaKey)
  assert.equal(meta.length, 2)
  for (const p of meta) {
    assert.equal(p.windowsVirtualKeyCode, 65)
    assert.equal(p.modifiers, 4)
  }
})

test("CDP official modifiers: Meta=4 Shift=8", () => {
  assert.equal(cdpModifiersFromKeys({ metaKey: true }), 4)
  assert.equal(cdpModifiersFromKeys({ shiftKey: true }), 8)
  assert.equal(cdpModifiersFromKeys({ ctrlKey: true }), 2)
  assert.equal(windowsVirtualKeyCode("PageDown"), 34)
})

test("INTERACTIVE_SEL includes form fields so fill_form text does not unique-match only labels", () => {
  assert.match(INTERACTIVE_SEL, /input/)
  assert.match(INTERACTIVE_SEL, /textarea/)
  assert.match(INTERACTIVE_SEL, /contenteditable/)
  assert.match(INTERACTIVE_SEL, /role="textbox"/)
})
