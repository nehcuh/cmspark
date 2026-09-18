// #502 slice E — FleetWorkerView.latest_tool（worker 线程最后一个工具名）。
//
// 契约（plan 2026-09-18-502-e Task 1）：
//  - 从线程 messages 倒序找 role=tool 行（扁平 tool_calls[].tool_name）或
//    assistant 行（OpenAI function 形 tool_calls[].function.name）的名字。
//  - 没有任何工具 → 字段整个省略（不是空串）。
//  - 旧 fake tm（无 messages 读取器）不得炸快照 —— 现有 fleet 测试的 tm 只有 list()。
import test from "node:test"
import assert from "node:assert/strict"
import { buildFleetSnapshot } from "../src/orchestrator"
import { _resetTabLeasesForTests } from "../src/orchestrator/tab-lease"

function reset() {
  _resetTabLeasesForTests()
}

function workerTm(messages: any[]) {
  return {
    list: () => [
      {
        id: "w1",
        alias: "w",
        agent_role: "worker",
        paused: false,
        parent_thread_id: "p",
        orchestrator_run_id: "r",
      },
    ],
    getMessages: (id: string) => (id === "w1" ? messages : []),
  } as any
}

test("latest_tool = last tool_name across tool rows (reverse scan)", () => {
  reset()
  const tm = workerTm([
    { role: "user", content: "查一下" },
    {
      role: "assistant",
      tool_calls: [{ id: "t1", type: "function", function: { name: "get_page_text", arguments: "{}" } }],
    },
    { role: "tool", tool_calls: [{ id: "t1", tool_name: "get_page_text", status: "success" }] },
    { role: "tool", tool_calls: [{ id: "t2", tool_name: "click", status: "running" }] },
  ])
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.latest_tool, "click")
})

test("final assistant text after tools does not shadow the last tool", () => {
  reset()
  const tm = workerTm([
    { role: "user", content: "查一下" },
    { role: "tool", tool_calls: [{ id: "t1", tool_name: "get_page_text", status: "success" }] },
    { role: "assistant", content: "查完了" },
  ])
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.latest_tool, "get_page_text")
})

test("assistant function-shape tool_calls are readable when no role=tool rows persist", () => {
  reset()
  const tm = workerTm([
    { role: "user", content: "去" },
    {
      role: "assistant",
      tool_calls: [{ id: "t9", type: "function", function: { name: "navigate", arguments: "{}" } }],
    },
  ])
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.latest_tool, "navigate")
})

test("thread with no tools omits latest_tool entirely", () => {
  reset()
  const tm = workerTm([{ role: "user", content: "在吗" }])
  const snap = buildFleetSnapshot(tm)
  assert.ok(!("latest_tool" in snap.workers[0]!), "no tool ran — field must be absent, not empty")
})

test("tm without a messages reader still snapshots (legacy fakes)", () => {
  reset()
  const tm = {
    list: () => [
      { id: "w1", alias: "w", agent_role: "worker", paused: false, parent_thread_id: "p" },
    ],
  } as any
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.id, "w1")
  assert.ok(!("latest_tool" in snap.workers[0]!))
})

// ---------------------------------------------------------------------------
// #502 E Task 3 — brief (Inspect 任务简报，首条 user 内容，截 160)
// ---------------------------------------------------------------------------

test("brief = first user message content", () => {
  reset()
  const tm = workerTm([
    { role: "user", content: "帮我抓取这页的价格表" },
    { role: "tool", tool_calls: [{ id: "t1", tool_name: "click", status: "success" }] },
  ])
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.brief, "帮我抓取这页的价格表")
})

test("brief is whitespace-collapsed and capped at 160 chars", () => {
  reset()
  const long = `抓 ${"价".repeat(200)}`
  const tm = workerTm([{ role: "user", content: `   ${long}\n\n  ` }])
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.workers[0]!.brief?.length, 160)
})

test("brief omitted when the worker thread has no user message", () => {
  reset()
  const tm = workerTm([{ role: "assistant", content: "在" }])
  const snap = buildFleetSnapshot(tm)
  assert.ok(!("brief" in snap.workers[0]!), "no user message — brief must be absent")
})
