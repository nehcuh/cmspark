// #502 slice E Task 3 — Inspect 抽屉（不切线程）。
//
// 契约（plan 2026-09-18-502-e-fleet-inspect Task 3 / spec §6）：
//  - Inspect 走独立 inspectedWorkerId buffer：chat.token 命中被查 worker 时
//    只 SET_INSPECT_TAIL，绝不 SET_STREAMING（主对话气泡不被 worker token 污染）。
//  - shouldApplyStreamEvent 门不变（stream-thread-gate 继续绿）。
//  - tool.start 可更新 inspect 的最近工具名；tool.progress 一律不进 inspect
//    （stdout_tail 可能含密钥）。
//  - Inspect 展开不 SET_ACTIVE_THREAD / 不 thread.select；「进入子任务」保持原行为。
//  - token 窗：本轮输出，等宽 11px，默认收起。
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  shouldApplyStreamEvent,
  shouldUpdateInspectBuffer,
  inspectTailSlice,
} from "../src/sidepanel/hooks/useWebSocket"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------

test("shouldApplyStreamEvent behavior unchanged (gate not widened)", () => {
  // Same truth table as stream-thread-gate — re-pinned here so this slice can
  // never regress it while touching the same switch.
  assert.equal(shouldApplyStreamEvent(undefined, "t1"), false)
  assert.equal(shouldApplyStreamEvent("", "t1"), false)
  assert.equal(shouldApplyStreamEvent("t1", null), false)
  assert.equal(shouldApplyStreamEvent("t1", "t2"), false)
  assert.equal(shouldApplyStreamEvent("t1", "t1"), true)
})

test("shouldUpdateInspectBuffer: only the inspected worker's frames apply", () => {
  assert.equal(shouldUpdateInspectBuffer(undefined, "w1"), false)
  assert.equal(shouldUpdateInspectBuffer("", "w1"), false)
  assert.equal(shouldUpdateInspectBuffer("w1", null), false)
  assert.equal(shouldUpdateInspectBuffer("w1", ""), false)
  assert.equal(shouldUpdateInspectBuffer("w1", "w2"), false)
  assert.equal(shouldUpdateInspectBuffer("w1", "w1"), true)
})

test("inspectTailSlice keeps the last ~800 chars, tolerates junk", () => {
  assert.equal(inspectTailSlice(undefined), "")
  assert.equal(inspectTailSlice(42 as any), "")
  assert.equal(inspectTailSlice(""), "")
  assert.equal(inspectTailSlice("短输出"), "短输出")
  const long = "x".repeat(900)
  const tail = inspectTailSlice(long)
  assert.equal(tail.length, 800)
  assert.ok(tail.startsWith("x") && long.endsWith(tail))
  assert.equal(inspectTailSlice(long, 10).length, 10)
})

// ---------------------------------------------------------------------------
// 2. useWebSocket wiring (source lock)
// ---------------------------------------------------------------------------

test("chat.token inspect branch sits BEFORE the gate and never SET_STREAMING", () => {
  const src = read("src/sidepanel/hooks/useWebSocket.ts")
  const start = src.indexOf('case "chat.token": {')
  const end = src.indexOf('case "chat.reasoning": {')
  assert.ok(start > 0 && end > start, "chat.token case must exist")
  const block = src.slice(start, end)
  // inspect buffer update present ...
  assert.match(block, /shouldUpdateInspectBuffer\(/)
  assert.match(block, /SET_INSPECT_TAIL/)
  // ... and sits before the unchanged gate
  const inspectIdx = block.indexOf("shouldUpdateInspectBuffer(")
  const gateIdx = block.indexOf("shouldApplyStreamEvent(")
  assert.ok(inspectIdx > 0 && gateIdx > inspectIdx, "inspect update must precede the active-thread gate")
  // the inspect branch itself must not touch the main transcript stream
  const inspectBranch = block.slice(inspectIdx, gateIdx)
  assert.ok(
    !inspectBranch.includes("SET_STREAMING"),
    "inspect branch must never dispatch SET_STREAMING",
  )
  // the gate is still there, exactly once, un-widened
  const gates = block.match(/shouldApplyStreamEvent\(/g) || []
  assert.equal(gates.length, 1)
})

test("tool.start updates the inspect latest tool before the gate; tool.progress never feeds inspect", () => {
  const src = read("src/sidepanel/hooks/useWebSocket.ts")
  const tsStart = src.indexOf('case "tool.start": {')
  const tsEnd = src.indexOf('case "tool.result": {')
  assert.ok(tsStart > 0 && tsEnd > tsStart)
  const startBlock = src.slice(tsStart, tsEnd)
  assert.match(startBlock, /shouldUpdateInspectBuffer\(/)
  assert.match(startBlock, /SET_INSPECT_LATEST_TOOL/)
  const inspectIdx = startBlock.indexOf("shouldUpdateInspectBuffer(")
  const gateIdx = startBlock.indexOf("shouldApplyStreamEvent(")
  assert.ok(inspectIdx > 0 && gateIdx > inspectIdx, "inspect update must precede the active-thread gate")

  const tpStart = src.indexOf('case "tool.progress": {')
  const tpEnd = src.indexOf('case "tool.vision_start": {')
  assert.ok(tpStart > 0 && tpEnd > tpStart)
  const progressBlock = src.slice(tpStart, tpEnd)
  assert.ok(!progressBlock.includes("INSPECT"), "tool.progress must never feed the inspect buffer (tails may carry secrets)")
})

// ---------------------------------------------------------------------------
// 3. Store contract
// ---------------------------------------------------------------------------

test("agentStore carries inspect state + actions", () => {
  const src = read("src/sidepanel/store/agentStore.tsx")
  assert.match(src, /inspectedWorkerId:\s*string \| null/)
  assert.match(src, /inspectTokenTail:\s*string/)
  assert.match(src, /inspectLatestTool:\s*string/)
  // initial state
  assert.match(src, /inspectedWorkerId:\s*null/)
  assert.match(src, /inspectTokenTail:\s*""/)
  assert.match(src, /inspectLatestTool:\s*""/)
  // reducer actions
  for (const a of ["SET_INSPECT_WORKER", "SET_INSPECT_TAIL", "SET_INSPECT_LATEST_TOOL", "CLEAR_INSPECT"]) {
    assert.ok(src.includes(`case "${a}"`), `reducer must handle ${a}`)
  }
})

// ---------------------------------------------------------------------------
// 4. FleetWorkerList wiring (source lock)
// ---------------------------------------------------------------------------

test("inspect expand does NOT switch the active thread; enter-worker still does", () => {
  const src = read("src/sidepanel/components/FleetWorkerList.tsx")
  // the inspect toggle handler
  const toggleIdx = src.indexOf("const inspectWorker =")
  assert.ok(toggleIdx > 0, "inspectWorker toggle must exist")
  const toggle = src.slice(toggleIdx, src.indexOf("const stopBuilt", toggleIdx) > 0 ? src.indexOf("const stopBuilt", toggleIdx) : toggleIdx + 400)
  assert.ok(!toggle.includes("SET_ACTIVE_THREAD"), "inspect toggle must not switch threads")
  assert.ok(!toggle.includes("thread.select"), "inspect toggle must not send thread.select")
  assert.match(toggle, /SET_INSPECT_WORKER/)
  assert.match(toggle, /CLEAR_INSPECT/)
  // the enter-worker handler keeps switching (existing behavior unchanged)
  const enterIdx = src.indexOf("const enterWorker =")
  const enter = src.slice(enterIdx, src.indexOf("}", src.indexOf("thread.select", enterIdx)))
  assert.match(enter, /SET_ACTIVE_THREAD/)
  assert.match(enter, /thread\.select/)
})

test("inspect panel: brief fallback, live tool, mono 11px tail under 本轮输出, default collapsed", () => {
  const src = read("src/sidepanel/components/FleetWorkerList.tsx")
  // brief prefers snapshot brief, falls back to worker_role_label
  assert.match(src, /w\.brief/)
  assert.match(src, /worker_role_label/)
  // token window under 本轮输出, default collapsed
  assert.match(src, /本轮输出/)
  assert.match(src, /useState\(false\)/)
  // mono 11px tail
  const tailIdx = src.indexOf("inspectTail:")
  assert.ok(tailIdx > 0, "inspectTail style must exist")
  const tailStyle = src.slice(tailIdx, src.indexOf("},", tailIdx))
  assert.match(tailStyle, /tokens\.fontMono/)
  assert.match(tailStyle, /fontSize:\s*11/)
  // the panel renders the buffered tail from the store
  assert.match(src, /inspectTokenTail/)
  assert.match(src, /inspectLatestTool/)
})
