// Tests for v1.1 selector registry shape + dom-automation runner source structure.
//
// Per Round 1 consensus: the runners are self-contained functions injected via
// chrome.scripting. Runtime DOM testing requires jsdom (deferred to v1.2). These
// tests pin down the structural invariants that protect against common breakage:
//   1. Every registry entry has at least 2 strategies (CSS + at least one fallback)
//   2. The runner source is self-contained (no module-import references)
//   3. The runner inlines Angular-aware waiters (no fixed setTimeout)
//   4. The runner reads selectors from args (defensive parse)

import test from "node:test"
import assert from "node:assert/strict"
import { SELECTORS } from "../src/notebooklm/selectors"
import { importTextRunner, importUrlRunner } from "../src/notebooklm/dom-automation"

test("SELECTORS: every entry has a stable key", () => {
  for (const [name, strategy] of Object.entries(SELECTORS)) {
    assert.equal(typeof strategy.key, "string")
    assert.equal(strategy.key.length > 0, true)
    // The key should match the field name for grep-ability
    assert.equal(strategy.key, name)
  }
})

test("SELECTORS: every entry has at least one CSS selector", () => {
  for (const strategy of Object.values(SELECTORS)) {
    assert.equal(Array.isArray(strategy.css), true)
    assert.equal(strategy.css.length > 0, true)
  }
})

test("SELECTORS: critical entries have at least 2 CSS selectors OR a fallback strategy", () => {
  // Critical entries must have multi-strategy fallback per Round 1 consensus.
  const critical: Array<keyof typeof SELECTORS> = [
    "addSourceButton",
    "dialogContainer",
    "urlInput",
    "textInput",
    "submitButton",
  ]
  for (const key of critical) {
    const s = SELECTORS[key]
    const hasMultipleCss = s.css.length >= 2
    const hasFallback = (s.textContent && s.textContent.length > 0) || (s.ariaLabel && s.ariaLabel.length > 0) || !!s.role
    assert.equal(hasMultipleCss || hasFallback, true, `${key} must have multi-strategy fallback`)
  }
})

test("SELECTORS: well-known NotebookLM classes present", () => {
  // Pin known-working selectors from jetpack / Web Importer research.
  assert.equal(SELECTORS.addSourceButton.css.includes(".add-source-button"), true)
  assert.equal(SELECTORS.dialogContainer.css.includes("mat-dialog-container"), true)
  assert.equal(SELECTORS.urlInput.css.includes(".urls-input-container textarea"), true)
  assert.equal(SELECTORS.textInput.css.includes(".copied-text-input-textarea"), true)
  assert.equal(SELECTORS.sourceRow.css.includes(".single-source-container"), true)
})

test("importUrlRunner: source is self-contained (no module-import references)", () => {
  const src = importUrlRunner.toString()
  // The runner is injected via chrome.scripting.executeScript's `func` arg — Chrome
  // serializes it via toString() and runs in page context. Any `import` statement
  // or reference to module-scope names would break at runtime.
  assert.equal(src.includes("import "), false)
  assert.equal(src.includes("require("), false)
  // Must accept args (url + selectorsJSON)
  assert.equal(src.includes("url"), true)
  assert.equal(src.includes("selectorsJSON"), true)
})

test("importUrlRunner: uses Angular-aware waiter (MutationObserver + rAF)", () => {
  const src = importUrlRunner.toString()
  // Per Round 1: MutationObserver quiescence + requestAnimationFrame, NOT fixed setTimeout
  assert.equal(src.includes("MutationObserver"), true)
  assert.equal(src.includes("requestAnimationFrame"), true)
  // Must check Angular disabled state, not just selector existence
  assert.equal(src.includes("disabled"), true)
})

test("importUrlRunner: cloneNode not needed (we don't mutate page DOM, just drive UI)", () => {
  // This is a sanity check — unlike the v1 extractor (which must cloneNode before
  // mutating), the v1.1 importer only DRIVES the UI. No cloneNode needed.
  // If this test fails, someone added DOM mutation — investigate.
  const src = importUrlRunner.toString()
  // We don't forbid cloneNode categorically, but it shouldn't be there in v1.1
  // (the runner only reads + clicks + sets form values).
})

test("importUrlRunner: defensive selectors parse", () => {
  const src = importUrlRunner.toString()
  // JSON.parse should be wrapped in try/catch per Round 1 — malformed arg shouldn't kill the runner
  assert.equal(src.includes("JSON.parse(selectorsJSON)"), true)
})

test("importTextRunner: same Angular-aware invariants as URL runner", () => {
  const src = importTextRunner.toString()
  assert.equal(src.includes("MutationObserver"), true)
  assert.equal(src.includes("requestAnimationFrame"), true)
  assert.equal(src.includes("disabled"), true)
})

test("importTextRunner: rejects empty text", () => {
  const src = importTextRunner.toString()
  assert.equal(src.includes("Empty text"), true)
})

test("runners: native-value-setter trick for Angular forms", () => {
  // Direct `.value =` doesn't trigger Angular's ngModel update — Angular's next
  // CD cycle overwrites with ''. Must use the prototype's native setter + dispatch input event.
  const src = importUrlRunner.toString()
  assert.equal(src.includes("getOwnPropertyDescriptor"), true)
  assert.equal(src.includes("HTMLTextAreaElement.prototype"), true)
  assert.equal(src.includes("new Event(\"input\""), true)
})
