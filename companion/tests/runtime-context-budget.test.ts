import test from "node:test"
import assert from "node:assert/strict"
import { sanitizeRuntimeContextBudget } from "../src/threads/runtime-context-budget"

test("sanitizeRuntimeContextBudget accepts m1/m2 and caps summary", () => {
  const s = sanitizeRuntimeContextBudget({
    last_at: "2026-08-06T00:00:00.000Z",
    mode: "m2",
    dropped_count: 4,
    tokens_before: 9000,
    tokens_after: 3000,
    rolling_summary: "x".repeat(3000) + "\x00bad",
    summary_sha256: "abcdef0123456789",
    summary_bytes: 12,
    phase: "pre_loop",
  })
  assert.ok(s)
  assert.equal(s!.mode, "m2")
  assert.equal(s!.dropped_count, 4)
  assert.ok(s!.rolling_summary!.length <= 2000)
  assert.doesNotMatch(s!.rolling_summary!, /\x00/)
  assert.equal(s!.summary_sha256, "abcdef0123456789")
  assert.equal(s!.phase, "pre_loop")
})

test("sanitizeRuntimeContextBudget rejects junk", () => {
  assert.equal(sanitizeRuntimeContextBudget(null), null)
  assert.equal(sanitizeRuntimeContextBudget({ mode: "nope" }), null)
  assert.equal(sanitizeRuntimeContextBudget("x"), null)
})
