// Tests for the extension-side dangerous-API advisory detection (audit H9).
//
// These tests pin the ADVISORY contract: detectDangerousApis flags statically-
// matchable risky tokens to annotate the `evaluate` tool result. It does NOT
// gate execution (the companion confirmation does), and it CANNOT resolve
// runtime dispatch — the dynamic cases below are asserted to be MISSED by
// design, so no one later mistakes an empty result for "safe".

import test from "node:test"
import assert from "node:assert/strict"
import { detectDangerousApis, DANGEROUS_API_PATTERNS } from "../src/background/dangerous-apis"

function has(code: string, name: string): boolean {
  return detectDangerousApis(code).includes(name)
}

test("returns an empty array for benign code", () => {
  // Empty result means "no statically-matchable risky token", NOT "safe".
  assert.deepEqual(detectDangerousApis("1 + 1"), [])
  assert.deepEqual(detectDangerousApis("document.querySelector('#app')"), [])
})

test("detects direct dangerous calls", () => {
  assert.equal(has("fetch('/api')", "fetch"), true)
  assert.equal(has("eval('x')", "eval"), true)
  assert.equal(has("new Function('return 1')", "Function"), true)
  assert.equal(has("Reflect.apply(fn, this, [])", "Reflect.apply"), true)
  assert.equal(has("Reflect.construct(Klass, [])", "Reflect.construct"), true)
  assert.equal(has("localStorage.getItem('k')", "localStorage"), true)
  assert.equal(has("document.cookie", "document.cookie"), true)
  assert.equal(has("new WebSocket('ws://x')", "WebSocket"), true)
})

test("detects string-arg timer code generation", () => {
  assert.equal(has("setTimeout('evil()', 10)", "setTimeout-string"), true)
  assert.equal(has("setInterval('evil()', 10)", "setInterval-string"), true)
  // Number/function-arg timers are NOT code generation — must not flag.
  assert.equal(has("setTimeout(() => {}, 10)", "setTimeout-string"), false)
  assert.equal(has("setInterval(fn, 1000)", "setInterval-string"), false)
})

test("detects bracket-notation attempts to dodge the direct patterns", () => {
  assert.equal(has("window['fetch']('/api')", "bracket-fetch"), true)
  assert.equal(has("window['localStorage']", "bracket-localStorage"), true)
  assert.equal(has("globalThis['cookie']", "bracket-cookie"), true)
})

// Regression guard (audit H9): `bracket-open` MUST require the call `\s*\(`.
// `open` is too generic a token to flag on a bare property reference — without
// the call suffix it would false-positive on `obj['open'] = handler`. The
// pattern is byte-identical to companion/src/security.ts and the pre-H9 inline
// list; this test pins that so a future refactor can't silently drop the suffix.
test("bracket-open requires a call (regression: suffix must not be dropped)", () => {
  assert.equal(has("window['open']('https://evil')", "bracket-open"), true)
  assert.equal(has("win['open']('x')", "bracket-open"), true)
  // Bare reference / assignment — must NOT be flagged.
  assert.equal(has("obj['open']", "bracket-open"), false)
  assert.equal(has("obj['open'] = fn", "bracket-open"), false)
})

test("deduplicates within a single scan", () => {
  // Two `fetch(` calls → 'fetch' appears once.
  const matches = detectDangerousApis("fetch('/a'); fetch('/b')")
  assert.equal(matches.filter((m) => m === "fetch").length, 1)
})

// ── The documented static-analysis limit (audit H9) ──────────────────────────
// Regex cannot resolve runtime dispatch. These dynamic forms MUST be missed by
// detectDangerousApis — they are the reason the result is advisory-only and the
// companion confirmation is authoritative. If a future change "fixes" these,
// that's a false positive, not a fix: the assembled string is unknowable without
// executing the code.

test("LIMIT: cannot detect eval assembled at runtime (advisory-only by design)", () => {
  // The audit's example regression case. No static analyzer (regex OR AST) can
  // resolve 'ev'+'al' without running the code. Assert it is NOT flagged.
  assert.equal(has("window['ev'+'al']('x')", "eval"), false)
  assert.deepEqual(detectDangerousApis("window['ev'+'al']('x')"), [])
})

test("LIMIT: cannot detect dynamic property access to eval/Function", () => {
  assert.equal(has("globalThis[dynamicName]('x')", "eval"), false)
  assert.equal(has("(0, eval)('x')", "eval"), false)
})

test("DANGEROUS_API_PATTERNS is non-empty and well-formed", () => {
  // Sanity: the pattern table exists and every entry has a compiled regex.
  assert.equal(DANGEROUS_API_PATTERNS.length >= 20, true)
  for (const { name, pattern } of DANGEROUS_API_PATTERNS) {
    assert.equal(typeof name === "string" && name.length > 0, true)
    assert.equal(pattern instanceof RegExp, true)
  }
})
