import test from "node:test"
import assert from "node:assert/strict"
import {
  sanitizeThreadHandoff,
  formatHandoffForNotice,
  collectReasoningSlices,
  parseHandoffJson,
  shouldRunH1,
  HANDOFF_CAPS,
} from "../src/llm/context-handoff"
import {
  isOmitNotice,
  buildHandoffNotice,
  attachHandoffNoticeToMessages,
  buildOmitNotice,
  HANDOFF_PREFIX,
  retainMidLoopRollingSummary,
} from "../src/llm/context-budget"
import type { CanonicalChatMessage } from "../src/llm/provider"

test("sanitizeThreadHandoff trims caps and drops secrets", () => {
  const h = sanitizeThreadHandoff({
    goals: ["a".repeat(200), "ok goal"],
    decisions: ["use postgres because latency"],
    constraints: ["Bearer sk-abcdefghijklmnop"],
    open_todos: [],
    artifacts: ["file.ts"],
  })
  assert.ok(h)
  assert.equal(h!.goals[0].length, HANDOFF_CAPS.goals.len)
  assert.ok(h!.goals.includes("ok goal") || h!.goals.some((g) => g.startsWith("a")))
  assert.equal(h!.constraints[0], "[redacted]")
  assert.deepEqual(h!.artifacts, ["file.ts"])
})

test("sanitize empty → null", () => {
  assert.equal(sanitizeThreadHandoff({ goals: [], decisions: [] }), null)
  assert.equal(sanitizeThreadHandoff(null), null)
})

test("formatHandoffForNotice priority overflow drops later sections", () => {
  const h = sanitizeThreadHandoff({
    goals: ["G1"],
    constraints: ["C1"],
    decisions: ["D1"],
    open_todos: ["T1"],
    artifacts: ["A1"],
    updated_at: new Date().toISOString(),
  })!
  const full = formatHandoffForNotice(h, 2000)
  assert.match(full, /目标/)
  assert.match(full, /约束/)
  const tiny = formatHandoffForNotice(h, 40)
  assert.ok(tiny.length <= 40)
  assert.match(tiny, /目标/)
})

test("buildHandoffNotice prefix + isOmitNotice", () => {
  const n = buildHandoffNotice(3, "【目标】\n- ship H1")
  const c = typeof n.content === "string" ? n.content : ""
  assert.ok(c.startsWith(HANDOFF_PREFIX))
  assert.equal(isOmitNotice(n), true)
  assert.equal(isOmitNotice(buildOmitNotice(1)), true)
})

test("attachHandoffNotice replaces existing omit notice (single notice)", () => {
  const msgs: CanonicalChatMessage[] = [
    { role: "system", content: "sys" },
    buildOmitNotice(2),
    { role: "user", content: "hi" },
  ]
  const out = attachHandoffNoticeToMessages(msgs, 5, "【目标】\n- x")
  const notices = out.filter(isOmitNotice)
  assert.equal(notices.length, 1)
  const c = typeof notices[0].content === "string" ? notices[0].content : ""
  assert.ok(c.startsWith(HANDOFF_PREFIX))
  assert.match(c, /5 messages/)
})

test("collectReasoningSlices scrubs and caps", () => {
  const msgs: CanonicalChatMessage[] = [
    {
      role: "assistant",
      content: "done",
      reasoning_content: "I will use sk-abcdefghijklmnop key maybe",
    } as any,
  ]
  const s = collectReasoningSlices(msgs, 500)
  assert.ok(s.includes("[redacted-secret]") || s.includes("redacted"))
})

test("parseHandoffJson unwraps fence and sanitizes", () => {
  const h = parseHandoffJson(
    '```json\n{"goals":["ship"],"decisions":[],"constraints":["no secrets sk-abcdefghijk"],"open_todos":[],"artifacts":[]}\n```',
  )
  assert.ok(h)
  assert.deepEqual(h!.goals, ["ship"])
  assert.equal(h!.constraints[0], "[redacted]")
})

test("parseHandoffJson garbage → null", () => {
  assert.equal(parseHandoffJson("not json"), null)
  assert.equal(parseHandoffJson("{}"), null) // empty lists
})

test("shouldRunH1 mirrors M2 gates", () => {
  const base = {
    messages: [],
    droppedCount: 0,
    droppedMessages: [{ role: "user" as const, content: "a" }, { role: "assistant" as const, content: "b" }, { role: "user" as const, content: "c" }],
    tokensBefore: 1000,
    tokensAfter: 400,
    compacted: true,
  }
  assert.equal(shouldRunH1(base as any, true, "pre_loop"), true)
  assert.equal(shouldRunH1(base as any, true, "mid_loop"), false)
  assert.equal(shouldRunH1(base as any, false, "pre_loop"), false)
  assert.equal(shouldRunH1({ ...base, compacted: false } as any, true, "pre_loop"), false)
})

test("retainMidLoop re-attaches h1 when prior handoff formatted", () => {
  const base: CanonicalChatMessage[] = [
    { role: "system", content: "s" },
    buildOmitNotice(4),
    { role: "user", content: "u" },
  ]
  const r = retainMidLoopRollingSummary({
    phase: "mid_loop",
    mode: "m1",
    messages: base,
    droppedCount: 4,
    prevMeta: {
      mode: "h1",
      rolling_summary: "【目标】\n- keep",
      handoff: {
        updated_at: new Date().toISOString(),
        goals: ["keep"],
        decisions: [],
        constraints: [],
        open_todos: [],
        artifacts: [],
      },
    },
  })
  assert.equal(r.mode, "h1")
  assert.equal(r.reattached, true)
  const n = r.messages.find(isOmitNotice)
  const c = typeof n?.content === "string" ? n.content : ""
  assert.ok(c.startsWith(HANDOFF_PREFIX))
})

test("retainMidLoop formats structured handoff when rolling_summary empty (Pi nit)", () => {
  const base: CanonicalChatMessage[] = [
    { role: "system", content: "s" },
    buildOmitNotice(2),
    { role: "user", content: "u" },
  ]
  const r = retainMidLoopRollingSummary({
    phase: "mid_loop",
    mode: "m1",
    messages: base,
    droppedCount: 2,
    prevMeta: {
      mode: "h1",
      // no rolling_summary — must re-format from handoff object
      handoff: {
        updated_at: new Date().toISOString(),
        goals: ["recover from meta"],
        decisions: [],
        constraints: [],
        open_todos: [],
        artifacts: [],
      },
    },
  })
  assert.equal(r.mode, "h1")
  assert.equal(r.reattached, true)
  const n = r.messages.find(isOmitNotice)
  const c = typeof n?.content === "string" ? n.content : ""
  assert.ok(c.startsWith(HANDOFF_PREFIX))
  assert.match(c, /recover from meta/)
})
