// Tests for the shared modal-dialog focus logic (audit M18 / extracted from H10).
//
// The focus-trap algorithm is split into PURE helpers so it can be verified
// without a DOM renderer (and without pulling a DOM shim dep — see the note on
// @types/node pollution below). The thin keydown shell inside the hook is
// identical to the effect that shipped in SecurityConfirmationDialog (PR #19,
// manually verified); these tests lock the selectable logic it delegates to.
//
// Why no DOM shim: a real-DOM integration test would need happy-dom/jsdom, but
// happy-dom transitively pulls `@types/node` (via `import {URLSearchParams}
// from 'url'`), and this project intentionally ships WITHOUT @types/node — its
// presence pollutes global type resolution and trips spurious errors in
// unrelated tests. So we test the pure logic instead and guard the selector
// string directly (same philosophy as the bracket-open regression guard).

import test from "node:test"
import assert from "node:assert/strict"
import {
  getFocusableEdges,
  computeTabWrap,
  FOCUSABLE_SELECTOR,
} from "../src/sidepanel/hooks/useModalDialog"

// A focusable "element" is just an identity token to computeTabWrap — it only
// ever compares by reference. Plain objects (cast through any into the
// lib.dom-typed helper) are enough; no real DOM needed.
function el(id: string): any {
  return { id }
}

// Minimal fake root: its querySelectorAll returns whatever list we hand it.
// getFocusableEdges only calls .querySelectorAll(selector) and reads [0]/[last].
function fakeRoot(list: any[]): any {
  return { querySelectorAll: () => list }
}

// ── getFocusableEdges ────────────────────────────────────────────────────────

test("getFocusableEdges returns first and last in list order", () => {
  const a = el("a"), b = el("b"), c = el("c")
  const edges = getFocusableEdges(fakeRoot([a, b, c]))
  assert.equal(edges?.first, a)
  assert.equal(edges?.last, c)
})

test("getFocusableEdges handles a single focusable element", () => {
  const only = el("only")
  const edges = getFocusableEdges(fakeRoot([only]))
  assert.equal(edges?.first, only)
  assert.equal(edges?.last, only)
})

test("getFocusableEdges returns null when the list is empty", () => {
  assert.equal(getFocusableEdges(fakeRoot([])), null)
})

// ── computeTabWrap ───────────────────────────────────────────────────────────

test("computeTabWrap wraps FORWARD (Tab) at the last element → 'first'", () => {
  const first = el("a"), last = el("b")
  assert.equal(computeTabWrap(last, first, last, false), "first")
})

test("computeTabWrap wraps BACKWARD (Shift+Tab) at the first element → 'last'", () => {
  const first = el("a"), last = el("b")
  assert.equal(computeTabWrap(first, first, last, true), "last")
})

test("computeTabWrap returns null for mid-cycle Tabs (browser handles natively)", () => {
  const first = el("a"), last = el("b")
  // On first, Tab forward → go to last natively (no wrap)
  assert.equal(computeTabWrap(first, first, last, false), null)
  // On last, Shift+Tab backward → go to first natively (no wrap)
  assert.equal(computeTabWrap(last, first, last, true), null)
})

test("computeTabWrap returns null when focus is elsewhere (not at an edge)", () => {
  const first = el("a"), last = el("b")
  const elsewhere = el("middle")
  // Neither edge has focus in either direction → native handling
  assert.equal(computeTabWrap(elsewhere, first, last, false), null)
  assert.equal(computeTabWrap(elsewhere, first, last, true), null)
  // activeElement null (e.g. nothing focused) → native handling, no false wrap
  assert.equal(computeTabWrap(null, first, last, false), null)
})

test("computeTabWrap is symmetric: only the (active, shiftKey) combo at an edge wraps", () => {
  // Exhaustive table over the 2×2×2 (active∈{first,last}) × shiftKey space.
  const first = el("a"), last = el("b")
  //               active  shift  expected
  assert.equal(computeTabWrap(first, first, last, false), null) // first + Tab → native
  assert.equal(computeTabWrap(first, first, last, true), "last") // first + Shift → wrap to last
  assert.equal(computeTabWrap(last, first, last, false), "first") // last + Tab → wrap to first
  assert.equal(computeTabWrap(last, first, last, true), null) // last + Shift → native
})

// ── FOCUSABLE_SELECTOR regression guard ──────────────────────────────────────
// The selector is the bug-prone part (the audit's bracket-open episode showed
// a one-char regex change slipping through). Pin its exact value so any edit
// is a deliberate, review-visible diff — and document the contract it encodes.

test("FOCUSABLE_SELECTOR is pinned to the documented element set (regression guard)", () => {
  // If this string changes, the diff must justify it. Covers: native focusables
  // (button/input/textarea/select/a[href]) + positive tabindex, EXCLUDING -1.
  assert.equal(
    FOCUSABLE_SELECTOR,
    'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
  )
})
