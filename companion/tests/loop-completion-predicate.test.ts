/**
 * #387 L-1: completion predicate — machine two-layer + claim⊆tick cross-check.
 * Acceptance: 空口声明完成被拒；全 tick 无声明触发索要轮；五分类归属正确；
 * 不改现有勾选/不信任模型语义（纯函数，零执行）。
 *
 * 残余风险（PR #394 grok MAJOR-1，选修法 1——不发明页面谓词）：
 * 「点了提交≠表单过」的强形式本票不拦也拦不了（票面 NEVER：HTTP/DOM 谓词
 * 毕业）。`tool: "click"` 的 success tick 只证明点击工具调用成功，不证明
 * 表单过关；谓词会对这样的项输出 complete。claim⊆tick 拦的是弱形式——
 * claim 引用【未 tick】的提交项。L-2 (#388) 不得把 complete 展示成
 * 「任务已完成」；默认档以用户终审兜底（FINAL-SYNTHESIS §分歧 3）。
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  buildClaimRejectionSteer,
  evaluateCompletion,
  evidenceItems,
  type CompletionInput,
} from "../src/loop/completion-predicate"
import type { RunProgress, RunProgressItem } from "../src/threads/run-progress"

function item(
  over: Partial<RunProgressItem> & Pick<RunProgressItem, "id" | "text" | "source">,
): RunProgressItem {
  return { done: false, ...over }
}

function progress(items: RunProgressItem[]): RunProgress {
  return { items }
}

function base(over: Partial<CompletionInput>): CompletionInput {
  return { runProgress: progress([]), closingTurnToolCalls: 0, pendingConfirms: 0, ...over }
}

test("evidenceItems excludes model_draft rows", () => {
  const p = progress([
    item({ id: "live:0", text: "fill form", source: "seed", done: true }),
    item({ id: "live:1", text: "draft note", source: "model_draft", done: true }),
  ])
  const ev = evidenceItems(p)
  assert.deepEqual(ev.map((i) => i.id), ["live:0"])
  assert.equal(evidenceItems(null).length, 0)
  assert.equal(evidenceItems(undefined).length, 0)
})

test("空口声明完成被拒: claim referencing unticked items → claim-rejected", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([
        item({ id: "live:0", text: "fill form", source: "seed", done: true }),
        item({ id: "live:1", text: "submit form", source: "seed", done: false }),
      ]),
      claim: { itemIds: ["live:0", "live:1"] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.deepEqual(v.invalidClaimIds, ["live:1"])
  assert.ok(v.reasons.includes("unticked-items"))
  assert.match(v.steer, /live:1/)
  assert.match(v.steer, /submit form/)
})

test("空口声明完成被拒: claim with empty itemIds is prose self-assessment", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "done thing", source: "seed", done: true })]),
      claim: { itemIds: [] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.match(v.steer, /rejected/)
})

test("claim on empty progress (no evidence items) is rejected", () => {
  const v = evaluateCompletion(base({ claim: { itemIds: ["live:0"] } }))
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.ok(v.reasons.includes("no-evidence-items"))
  assert.deepEqual(v.invalidClaimIds, ["live:0"])
})

test("claim 引用未 tick 的提交项被拦（勾假的弱形式）", () => {
  // 弱形式：点击可能发生过，但没有成功的绑定 tool_result tick 该项，
  // claim 引用它必被拒。强形式（click success tick ≠ 表单过关）见文件头
  // 残余风险说明——本票 NEVER 页面谓词。
  const v = evaluateCompletion(
    base({
      runProgress: progress([
        item({ id: "live:0", text: "填写表单字段", source: "seed", done: true, tool: "fill_form" }),
        item({ id: "live:1", text: "提交表单并确认成功", source: "seed", done: false, tool: "click" }),
      ]),
      claim: { itemIds: ["live:1"] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.deepEqual(v.invalidClaimIds, ["live:1"])
  assert.match(v.steer, /live:1/)
  assert.match(v.steer, /not evidence/i)
})

test("claim referencing unknown ids is rejected with those ids listed", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "seed", done: true })]),
      claim: { itemIds: ["live:0", "ghost:9"] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.deepEqual(v.invalidClaimIds, ["ghost:9"])
})

test("全 tick 无声明 → request-claim (索要轮逻辑)", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([
        item({ id: "live:0", text: "a", source: "seed", done: true }),
        item({ id: "live:1", text: "b", source: "user", done: true }),
      ]),
    }),
  )
  assert.equal(v.kind, "request-claim")
  if (v.kind !== "request-claim") return
  assert.deepEqual(v.tickedIds, ["live:0", "live:1"])
  assert.match(v.steer, /live:0/)
  assert.match(v.steer, /claim/i)
})

test("complete: all ticked ∧ closing turn clean ∧ claim ⊆ tick", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([
        item({ id: "live:0", text: "a", source: "seed", done: true }),
        item({ id: "live:1", text: "b", source: "seed", done: true }),
      ]),
      claim: { itemIds: ["live:0"] }, // strict subset is fine (claim ⊆ tick)
    }),
  )
  assert.equal(v.kind, "complete")
  if (v.kind !== "complete") return
  assert.deepEqual(v.tickedIds, ["live:0", "live:1"])
})

test("user hand-ticked everything counts as evidence tick (人是权威)", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "user", done: true })]),
      claim: { itemIds: ["live:0"] },
    }),
  )
  assert.equal(v.kind, "complete")
})

test("incomplete: closing turn still issued tool_calls", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "seed", done: true })]),
      closingTurnToolCalls: 2,
    }),
  )
  assert.equal(v.kind, "incomplete")
  if (v.kind !== "incomplete") return
  assert.deepEqual(v.reasons, ["closing-turn-tool-calls"])
})

test("incomplete: pending confirm/nonce blocks completion", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "seed", done: true })]),
      pendingConfirms: 1,
    }),
  )
  assert.equal(v.kind, "incomplete")
  if (v.kind !== "incomplete") return
  assert.deepEqual(v.reasons, ["pending-confirm"])
})

test("incomplete: no claim and unticked items remain (no verdict leap)", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([
        item({ id: "live:0", text: "a", source: "seed", done: true }),
        item({ id: "live:1", text: "b", source: "seed", done: false }),
      ]),
    }),
  )
  assert.equal(v.kind, "incomplete")
  if (v.kind !== "incomplete") return
  assert.deepEqual(v.untickedIds, ["live:1"])
})

test("draft-only progress never completes (model_draft 不信任语义不变)", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "model_draft", done: true })]),
      claim: { itemIds: ["live:0"] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.ok(v.reasons.includes("no-evidence-items"))
  assert.deepEqual(v.invalidClaimIds, ["live:0"])
})

test("claim with pending confirm still rejected even when all ticked", () => {
  const v = evaluateCompletion(
    base({
      runProgress: progress([item({ id: "live:0", text: "a", source: "seed", done: true })]),
      pendingConfirms: 1,
      claim: { itemIds: ["live:0"] },
    }),
  )
  assert.equal(v.kind, "claim-rejected")
  if (v.kind !== "claim-rejected") return
  assert.ok(v.reasons.includes("pending-confirm"))
  assert.match(v.steer, /confirm/)
})

test("buildClaimRejectionSteer names every unticked item id and text", () => {
  const steer = buildClaimRejectionSteer({
    unticked: [
      item({ id: "live:2", text: "核对结果", source: "seed" }),
      item({ id: "live:3", text: "导出文件", source: "seed" }),
    ],
    invalidClaimIds: ["live:3"],
    reasons: ["unticked-items"],
  })
  assert.match(steer, /live:2/)
  assert.match(steer, /核对结果/)
  assert.match(steer, /live:3/)
  assert.match(steer, /导出文件/)
})
