// Structural tests for extractor.ts.
//
// The runner function `extractPageContentRunner` is injected into the live page via
// chrome.scripting; testing it requires jsdom (out of scope for v1). These tests
// pin down the constants and the function-source shape — guarantees that:
//   1. The selector list is non-empty and ordered most-specific-first.
//   2. The runner source string includes the safety invariants flagged in Round 2
//      (cloneNode before mutate; strip auth-bearing noise; cap text length).
//   3. Default MAX_TEXT_LENGTH is within NotebookLM's per-source budget.
//
// Real-article HTML snapshot tests are deferred to v1.1 (requires jsdom).

import test from "node:test"
import assert from "node:assert/strict"
import {
  EXTRACTOR_SELECTORS,
  MAX_TEXT_LENGTH,
  extractPageContentRunner,
} from "../src/notebooklm/extractor"

test("EXTRACTOR_SELECTORS: most-specific-first ordering", () => {
  // article/main/[role=main] must come before body-fallback class hints.
  assert.equal(EXTRACTOR_SELECTORS[0], "article")
  assert.equal(EXTRACTOR_SELECTORS[1], "main")
  assert.equal(EXTRACTOR_SELECTORS.length >= 5, true)
})

test("EXTRACTOR_SELECTORS: every entry is a valid CSS selector shape", () => {
  for (const sel of EXTRACTOR_SELECTORS) {
    assert.equal(typeof sel, "string")
    assert.equal(sel.length > 0, true)
    assert.equal(sel.includes("\n"), false)
  }
})

test("MAX_TEXT_LENGTH: sensible default (well under NotebookLM ~500KB)", () => {
  assert.equal(MAX_TEXT_LENGTH >= 50_000, true)
  assert.equal(MAX_TEXT_LENGTH <= 500_000, true)
})

test("runner source: includes cloneNode safety (Round 2 invariant)", () => {
  const src = extractPageContentRunner.toString()
  // Must clone before mutating — never touch live DOM.
  assert.equal(src.includes("cloneNode(true)"), true)
  // Must strip auth-bearing noise.
  assert.equal(src.includes("script"), true)
  assert.equal(src.includes("nav"), true)
})

test("runner source: truncation tail marker", () => {
  const src = extractPageContentRunner.toString()
  assert.equal(src.includes("truncated"), true)
  assert.equal(src.includes("maxLen"), true)
})

test("runner source: picks canonical URL, falls back to location.href", () => {
  const src = extractPageContentRunner.toString()
  assert.equal(src.includes('link[rel="canonical"]'), true)
  assert.equal(src.includes("location.href"), true)
})

test("runner source: never references extension/module scope", () => {
  const src = extractPageContentRunner.toString()
  // The runner is stringified and injected; it must not close over imports.
  assert.equal(src.includes("require("), false)
  assert.equal(src.includes("import "), false)
})
