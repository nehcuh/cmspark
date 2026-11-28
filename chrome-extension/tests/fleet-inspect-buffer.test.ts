// #502 slice E Task 3 — Inspect 抽屉（不切线程）。
//
// 契约（plan 2026-09-18-502-e-fleet-inspect Task 3 / spec §6）：
//  - Inspect 走独立 inspectedWorkerId buffer：chat.token 命中被查 worker 时
//    更新旁观输出，不向主对话气泡写入 worker token。
//  - shouldApplyStreamEvent 门不变（stream-thread-gate 继续绿）。
//  - tool.start 可更新 inspect 的最近工具名；tool.progress 一律不进 inspect
//    （stdout_tail 可能含密钥）。
//  - Inspect 展开不 SET_ACTIVE_THREAD / 不 thread.select；「进入子任务」保持原行为。
//  - token 窗：本轮输出，等宽 11px，默认收起。
import { mountPanel } from "./helpers/mount-sidepanel"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  shouldApplyStreamEvent,
  shouldUpdateInspectBuffer,
  inspectTailSlice,
} from "../src/sidepanel/hooks/useWebSocket"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

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

test("inspected worker frames update its drawer and leave the selected transcript intact", () => {
  const panel = mountPanel({ ...initialState, inspectedWorkerId: "worker" })
  panel.select("A")
  panel.receive({ type: "chat.token", thread_id: "A", content: "selected" })
  panel.receive({ type: "chat.token", thread_id: "worker", content: "x".repeat(900) + "tail" })
  panel.receive({ type: "tool.start", thread_id: "worker", tool_name: "read", tool_call_id: "call" })
  panel.receive({ type: "tool.progress", thread_id: "worker", tool_call_id: "call", stdout_tail: "progress" })
  assert.equal(panel.state().inspectTokenTail, "x".repeat(796) + "tail")
  assert.equal(panel.state().inspectLatestTool, "read")
  assert.equal(panel.state().streamingContent, "selected")
  assert.equal(panel.state().messages.length, 0)
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
  for (const a of ["SET_INSPECT_WORKER", "CLEAR_INSPECT"]) {
    assert.ok(src.includes(`case "${a}"`), `reducer must handle ${a}`)
  }
})

test("MAJOR-M1: closing the fleet portal clears inspect state — tokens stop buffering", () => {
  // Real reducer (not source lock): every close path (Escape / backdrop /
  // onClose / enterWorker) dispatches SET_FLEET_LIST_OPEN false — that single
  // choke point must drop the inspected worker and its buffer.
  let s = agentReducer(initialState, { type: "SET_INSPECT_WORKER", workerId: "w1" })
  s = { ...s, inspectTokenTail: "部分输出", inspectLatestTool: "read" }
  assert.equal(s.inspectedWorkerId, "w1")

  s = agentReducer(s, { type: "SET_FLEET_LIST_OPEN", open: false })
  assert.equal(s.inspectedWorkerId, null)
  assert.equal(s.inspectTokenTail, "")
  assert.equal(s.inspectLatestTool, "")
  // with no inspected worker, chat.token can no longer feed the buffer
  assert.equal(shouldUpdateInspectBuffer("w1", s.inspectedWorkerId), false)

  // opening the portal must NOT clobber anything (no-op direction preserved)
  const open = agentReducer(
    { ...initialState, inspectedWorkerId: "w2", inspectTokenTail: "tail" },
    { type: "SET_FLEET_LIST_OPEN", open: true },
  )
  assert.equal(open.inspectedWorkerId, "w2")
  assert.equal(open.inspectTokenTail, "tail")
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
