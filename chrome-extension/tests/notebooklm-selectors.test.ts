import test from "node:test"
import assert from "node:assert/strict"
import { SELECTORS } from "../src/notebooklm/selectors"

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
