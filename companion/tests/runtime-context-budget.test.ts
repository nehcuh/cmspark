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

test("sanitizeRuntimeContextBudget accepts h1 + handoff", () => {
  const s = sanitizeRuntimeContextBudget({
    last_at: "2026-08-07T00:00:00.000Z",
    mode: "h1",
    dropped_count: 6,
    tokens_before: 10000,
    tokens_after: 2000,
    rolling_summary: "【目标】\n- x",
    handoff: {
      goals: ["ship nits"],
      decisions: [],
      constraints: ["Bearer sk-abcdefghijklmnop"],
      open_todos: [],
      artifacts: ["a.ts"],
    },
  })
  assert.ok(s)
  assert.equal(s!.mode, "h1")
  assert.ok(s!.handoff)
  assert.deepEqual(s!.handoff!.goals, ["ship nits"])
  assert.equal(s!.handoff!.constraints[0], "[redacted]")
})

test("sanitizeRuntimeContextBudget rejects junk", () => {
  assert.equal(sanitizeRuntimeContextBudget(null), null)
  assert.equal(sanitizeRuntimeContextBudget({ mode: "nope" }), null)
  assert.equal(sanitizeRuntimeContextBudget("x"), null)
})
