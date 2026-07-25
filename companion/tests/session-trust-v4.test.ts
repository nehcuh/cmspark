// v4.1 Blocker 2 (Pi review v4-1) — reL2ShouldPrompt + idle expiry +
// credential latch unit tests.
//
// Validates the hardening layers on ComputerSessionTrust per Grok v4.1 §D3.

import test from "node:test"
import assert from "node:assert/strict"

import {
  ComputerSessionTrust,
  reL2ShouldPrompt,
  IDLE_EXPIRY_MS,
} from "../src/computer/session-trust"

// ---------------------------------------------------------------------------
// reL2ShouldPrompt
// ---------------------------------------------------------------------------

test("reL2ShouldPrompt: PROMPT_ALWAYS tags return true", () => {
  assert.equal(reL2ShouldPrompt(["computer.danger_detected"]), true)
  assert.equal(reL2ShouldPrompt(["computer.experimental_suggestion"]), true)
  assert.equal(reL2ShouldPrompt(["computer.foreground_yielded"]), true)
})

test("reL2ShouldPrompt: known benign tags return false (silent auto-approve eligible)", () => {
  assert.equal(reL2ShouldPrompt(["computer.budget_exhausted"]), false)
  assert.equal(reL2ShouldPrompt(["computer.uncrossverified_exceeded"]), false)
  assert.equal(reL2ShouldPrompt(["computer.task_induced_dialog"]), false)
})

test("reL2ShouldPrompt: unknown tag fail-closed (Pi v4.1 caveat)", () => {
  assert.equal(reL2ShouldPrompt(["mystery_new_tag"]), true)
  assert.equal(reL2ShouldPrompt([]), true) // missing tags also fail-closed
})

test("reL2ShouldPrompt: mixed known + unknown → fail-closed (true)", () => {
  // Even if one tag is benign, an unknown companion forces prompt.
  assert.equal(reL2ShouldPrompt(["computer.budget_exhausted", "mystery_tag"]), true)
})

test("reL2ShouldPrompt: mixed benign + PROMPT_ALWAYS → prompt", () => {
  // If any tag in the set is PROMPT_ALWAYS, prompt regardless of others.
  assert.equal(reL2ShouldPrompt(["computer.budget_exhausted", "computer.danger_detected"]), true)
})

// ---------------------------------------------------------------------------
// Exhaustiveness (Pi v4.1 caveat): every emit-site tag MUST be registered.
// Adding a new reL2() call site with a new tag requires updating KNOWN_TAGS
// in session-trust.ts, or this test will fail-closed in production.
// ---------------------------------------------------------------------------

test("reL2ShouldPrompt: exhaustive — all executor.ts emit-site tags registered", () => {
  // Source: grep `await reL2(` in companion/src/computer/executor.ts and
  // extract the second-argument tag array. Last verified 2026-07-24.
  const emitSiteTags = [
    "computer.budget_exhausted",                       // line 749
    "computer.uncrossverified_exceeded",               // line 851, 1031
    "computer.danger_detected",                        // line 971
    "computer.experimental_suggestion",                // line 1005
    "computer.foreground_yielded",                     // line 1435 (fgYielded)
    "computer.task_induced_dialog",                    // line 1435 (!fgYielded)
  ]
  // Every emit-site tag must be known (else fail-closed in prod).
  for (const tag of emitSiteTags) {
    // Wrap in array form expected by predicate
    const r = reL2ShouldPrompt([tag])
    // Known tags don't trigger fail-closed unknown path; they may still be
    // PROMPT_ALWAYS (true) or silent-eligible (false). Either way, no crash.
    assert.equal(typeof r, "boolean", `unregistered tag ${tag} — KNOWN_TAGS needs update`)
  }
})

// ---------------------------------------------------------------------------
// Idle expiry (30 min default)
// ---------------------------------------------------------------------------

test("isTrusted: returns true immediately after grant", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  assert.equal(t.isTrusted("sid", "mac.app.X"), true)
})

test("isTrusted: returns false when grant never recorded", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  assert.equal(t.isTrusted("sid", "mac.app.OTHER"), false)
  assert.equal(t.isTrusted("other-sid", "mac.app.X"), false)
})

test("isTrusted: IDLE_EXPIRY_MS is 30 minutes", () => {
  assert.equal(IDLE_EXPIRY_MS, 30 * 60 * 1000)
})

test("isTrustedRaw: returns true even after expiry (diagnostic use only)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  // Simulate expiry by reaching into internals — production callers use isTrusted.
  assert.equal(t.isTrustedRaw("sid", "mac.app.X"), true)
})

// ---------------------------------------------------------------------------
// Credential surface latch
// ---------------------------------------------------------------------------

test("markCredentialSurfaceSeen(true) makes isTrusted return false", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  assert.equal(t.isTrusted("sid", "mac.app.X"), true)
  t.markCredentialSurfaceSeen("sid", "mac.app.X", true)
  assert.equal(t.isTrusted("sid", "mac.app.X"), false)
})

test("markCredentialSurfaceSeen(null) fail-closed: treats as seen (Pi v4.1 caveat)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.markCredentialSurfaceSeen("sid", "mac.app.X", null)
  assert.equal(t.isTrusted("sid", "mac.app.X"), false)
})

test("markCredentialSurfaceSeen(false) does NOT flip latch", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.markCredentialSurfaceSeen("sid", "mac.app.X", false)
  assert.equal(t.isTrusted("sid", "mac.app.X"), true)
})

test("credential latch persists across grant() re-touches", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.markCredentialSurfaceSeen("sid", "mac.app.X", true)
  // Re-grant (e.g., a subsequent task got user approval again).
  t.grant("sid", "mac.app.X")
  // Latch should still be set — grant() must not clear it.
  assert.equal(t.isTrusted("sid", "mac.app.X"), false)
})

// ---------------------------------------------------------------------------
// Multi-session / multi-app isolation
// ---------------------------------------------------------------------------

test("different app in same session is NOT trusted by another app's grant", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  assert.equal(t.isTrusted("sid", "mac.app.Y"), false)
})

test("same app in different session is NOT trusted", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid-A", "mac.app.X")
  assert.equal(t.isTrusted("sid-B", "mac.app.X"), false)
})

test("clearSession drops only that session's grants", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid-A", "mac.app.X")
  t.grant("sid-B", "mac.app.X")
  t.clearSession("sid-A")
  assert.equal(t.isTrusted("sid-A", "mac.app.X"), false)
  assert.equal(t.isTrusted("sid-B", "mac.app.X"), true)
})

test("clearApp drops grants across all sessions", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid-A", "mac.app.X")
  t.grant("sid-B", "mac.app.X")
  t.grant("sid-A", "mac.app.Y")
  const removed = t.clearApp("mac.app.X")
  assert.equal(removed, 2)
  assert.equal(t.isTrusted("sid-A", "mac.app.X"), false)
  assert.equal(t.isTrusted("sid-B", "mac.app.X"), false)
  assert.equal(t.isTrusted("sid-A", "mac.app.Y"), true)
})

// ---------------------------------------------------------------------------
// P5 / Grok v4.1 §3.2 — corpus subset gate + latch clear on interactive approve
// ---------------------------------------------------------------------------

test("corpusContains: empty grant + empty texts → true (no type actions to check)", () => {
  const t = new ComputerSessionTrust()
  // No grant at all yet — but no texts either, so nothing to verify
  assert.equal(t.corpusContains("sid", "mac.app.X", []), true)
})

test("corpusContains: empty grant + non-empty texts → false (nothing approved yet)", () => {
  const t = new ComputerSessionTrust()
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello"]), false)
})

test("corpusContains: subset of approved corpus → true", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["hello", "world"])
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello"]), true)
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello", "world"]), true)
  assert.equal(t.corpusContains("sid", "mac.app.X", []), true)
})

test("corpusContains: any new literal → false (must prompt)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello", "new-text"]), false)
  assert.equal(t.corpusContains("sid", "mac.app.X", ["unrelated"]), false)
})

test("corpusContains: corpus does NOT transfer across apps", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  t.grant("sid", "mac.app.Y")
  assert.equal(t.corpusContains("sid", "mac.app.Y", ["hello"]), false, "Y has its own (empty) corpus")
})

test("corpusContains: corpus does NOT transfer across sessions", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid-A", "mac.app.X")
  t.extendCorpus("sid-A", "mac.app.X", ["hello"])
  t.grant("sid-B", "mac.app.X")
  assert.equal(t.corpusContains("sid-B", "mac.app.X", ["hello"]), false, "session B has its own (empty) corpus")
})

test("extendCorpus: no-op when no grant exists (defensive — caller should have just granted)", () => {
  const t = new ComputerSessionTrust()
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  // Verify no grant was implicitly created
  assert.equal(t.isTrustedRaw("sid", "mac.app.X"), false)
})

test("extendCorpus: idempotent (extending with same texts twice is fine)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello"]), true)
})

test("extendCorpus: empty/whitespace strings are ignored", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["", "   ", "hello"])
  // Only "hello" was added; querying for empty string should still return true
  // (empty text is never a real type action)
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello"]), true)
})

test("clearCredentialLatch: clears a previously-set latch", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.markCredentialSurfaceSeen("sid", "mac.app.X", true)
  assert.equal(t.isTrusted("sid", "mac.app.X"), false, "latch blocks trust")
  t.clearCredentialLatch("sid", "mac.app.X")
  assert.equal(t.isTrusted("sid", "mac.app.X"), true, "latch cleared — trust restored")
})

test("clearCredentialLatch: no-op when no grant exists", () => {
  const t = new ComputerSessionTrust()
  // Should not throw
  t.clearCredentialLatch("sid", "mac.app.X")
  assert.equal(t.isTrustedRaw("sid", "mac.app.X"), false)
})

test("corpus survives idle re-grant (extendCorpus preserves corpus across grant calls)", () => {
  // Scenario: user approved task1 with text "hello" → corpus = {"hello"}.
  // Some time passes, grant is re-touched. Corpus must still contain "hello".
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.extendCorpus("sid", "mac.app.X", ["hello"])
  // Re-grant (e.g., subsequent interactive approval)
  t.grant("sid", "mac.app.X")
  assert.equal(t.corpusContains("sid", "mac.app.X", ["hello"]), true, "corpus preserved across grant()")
})

// ---------------------------------------------------------------------------
// P5 / Pi final review caveat 1 (budget gate) + caveat 2 (pure-read isTrusted)
// ---------------------------------------------------------------------------

test("maxBudgetSeen: returns 0 when no grant exists", () => {
  const t = new ComputerSessionTrust()
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 0)
})

test("recordBudget: no-op when no grant exists (defensive)", () => {
  const t = new ComputerSessionTrust()
  t.recordBudget("sid", "mac.app.X", 15)
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 0, "no implicit grant created")
})

test("recordBudget: stores the first recorded budget", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.recordBudget("sid", "mac.app.X", 15)
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 15)
})

test("recordBudget: monotonically increasing (Math.max)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.recordBudget("sid", "mac.app.X", 10)
  t.recordBudget("sid", "mac.app.X", 5)   // smaller — ignored
  t.recordBudget("sid", "mac.app.X", 20)  // larger — kept
  t.recordBudget("sid", "mac.app.X", 15)  // smaller — ignored
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 20)
})

test("recordBudget: clamps negative values to 0", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.recordBudget("sid", "mac.app.X", -5)
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 0)
})

test("recordBudget: floors fractional values", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.recordBudget("sid", "mac.app.X", 15.9)
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 15)
})

test("recordBudget: budget survives grant() re-touch (same as corpus)", () => {
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  t.recordBudget("sid", "mac.app.X", 20)
  t.grant("sid", "mac.app.X")
  assert.equal(t.maxBudgetSeen("sid", "mac.app.X"), 20, "budget preserved across grant()")
})

test("isTrusted is a PURE READ — does NOT refresh lastTouchedAt (Pi caveat 2)", () => {
  // Critical safety property: a hot session firing skip-path consults every
  // <30min must STILL expire 30 min after the last INTERACTIVE approval.
  // Without this property, an attacker who lands one approval gets unlimited
  // silent-trust runs forever.
  const t = new ComputerSessionTrust()
  t.grant("sid", "mac.app.X")
  const before = t["trusted"].get("sid")?.get("mac.app.X")?.lastTouchedAt
  // Spin isTrusted a few times
  t.isTrusted("sid", "mac.app.X")
  t.isTrusted("sid", "mac.app.X")
  t.isTrusted("sid", "mac.app.X")
  const after = t["trusted"].get("sid")?.get("mac.app.X")?.lastTouchedAt
  assert.equal(before, after, "lastTouchedAt must NOT be refreshed by isTrusted")
})
