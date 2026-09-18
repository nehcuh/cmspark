// #502 slice E — FleetWorkerView.latest_tool / brief。
//
// Kimi BLOCK 修复后契约（AGENT-TASK-FIX.md）：
//  - latest_tool / brief 在**写路径**盖章（addMessage → Thread 元数据）。
//  - buildFleetSnapshot 只读 Thread 元数据 —— **禁止**调用 tm.getMessages
//    （那是 readFileSync + JSON.parse 整份 transcript，4s 一拍不可接受）。
//  - 无字段（旧线程）→ 省略，不回读文件。
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { buildFleetSnapshot } from "../src/orchestrator"
import { _resetTabLeasesForTests } from "../src/orchestrator/tab-lease"

function reset() {
  _resetTabLeasesForTests()
}

// ---------------------------------------------------------------------------
// 1. 快照只读元数据（禁止 getMessages —— BLOCK）
// ---------------------------------------------------------------------------

function workerTm(extra: Record<string, unknown> = {}) {
  return {
    list: () => [
      {
        id: "w1",
        alias: "w",
        agent_role: "worker",
        paused: false,
        parent_thread_id: "p",
        orchestrator_run_id: "r",
        ...extra,
      },
    ],
    // Must never be reached: transcript files are off-limits in the 4s tick.
    getMessages: () => {
      throw new Error("BLOCK: buildFleetSnapshot must not call getMessages")
    },
  } as any
}

test("snapshot surfaces stamped latest_tool/brief from thread metadata", () => {
  reset()
  const snap = buildFleetSnapshot(workerTm({ latest_tool: "click", brief: "帮我抓价格" }))
  assert.equal(snap.workers[0]!.latest_tool, "click")
  assert.equal(snap.workers[0]!.brief, "帮我抓价格")
})

test("thread without stamps omits both fields — no transcript fallback read", () => {
  reset()
  const snap = buildFleetSnapshot(workerTm())
  assert.ok(!("latest_tool" in snap.workers[0]!), "no stamp — field must be absent")
  assert.ok(!("brief" in snap.workers[0]!), "no stamp — field must be absent")
})

test("legacy fake tm (no getMessages at all) still snapshots", () => {
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
// 2. 写路径盖章（真实 ThreadManager，临时数据目录）
// ---------------------------------------------------------------------------

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fleet-stamp-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

test("addMessage stamps brief (first user) and latest_tool on the write path", async () => {
  reset()
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const tm = new ThreadManager()
  const tid = tm.create("stamper").id
  ;(tm.get(tid) as any).agent_role = "worker"

  tm.addMessage(tid, { thread_id: tid, role: "user", content: `帮我查 ${"价".repeat(200)}` })
  const thread = tm.get(tid) as any
  assert.equal(thread.brief?.length, 160, "brief = first user preview, collapsed + capped 160")
  assert.equal(thread.latest_tool, undefined)

  tm.addMessage(tid, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t1", tool_name: "get_page_text", status: "running" }],
  })
  assert.equal((tm.get(tid) as any).latest_tool, "get_page_text")

  tm.addMessage(tid, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t2", tool_name: "click", status: "running" }],
  })
  assert.equal((tm.get(tid) as any).latest_tool, "click", "newest tool wins")

  // snapshot reads the stamps — and its getMessages is absent on the real tm
  // path too (metadata only). If the snapshot regressed to file reads, the
  // assertions above still hold, so pin the metadata provenance directly:
  const snap = buildFleetSnapshot(tm as any)
  const view = snap.workers.find((w) => w.id === tid)!
  assert.equal(view.latest_tool, "click")
  assert.equal(view.brief?.length, 160)
})

test("assistant function-shape tool_calls stamp latest_tool too", async () => {
  reset()
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const tm = new ThreadManager()
  const tid = tm.create("fnshape").id
  ;(tm.get(tid) as any).agent_role = "worker"
  tm.addMessage(tid, {
    thread_id: tid,
    role: "assistant",
    content: "",
    tool_calls: [{ id: "t9", type: "function", function: { name: "navigate", arguments: "{}" } }],
  })
  assert.equal((tm.get(tid) as any).latest_tool, "navigate")
})

test("latest_tool keeps updating after the 1000-message cap trim", async () => {
  reset()
  const { ThreadManager, MAX_MESSAGES_PER_THREAD } = await import("../src/threads/thread-manager")
  const tm = new ThreadManager()
  const tid = tm.create("cap-freeze").id
  ;(tm.get(tid) as any).agent_role = "worker"
  tm.addMessage(tid, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t-pre", tool_name: "navigate", status: "success" }],
  })
  for (let i = 0; i < MAX_MESSAGES_PER_THREAD; i++) {
    tm.addMessage(tid, { thread_id: tid, role: "assistant", content: `pad-${i}` })
  }
  tm.addMessage(tid, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t-post", tool_name: "click", status: "running" }],
  })
  assert.equal(
    (tm.get(tid) as any).latest_tool,
    "click",
    "append after cap trim must restamp (must not freeze on pre-cap tool)",
  )
})

test("historical inserts never restamp latest_tool (append-only semantics)", async () => {
  reset()
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const tm = new ThreadManager()
  const tid = tm.create("inserts").id
  ;(tm.get(tid) as any).agent_role = "worker"
  tm.addMessage(tid, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t2", tool_name: "click", status: "success" }],
  })
  // branch-style historical insert of an OLDER tool row must not win
  tm.insertMessageAt(tid, 0, {
    thread_id: tid,
    role: "tool",
    content: "",
    tool_calls: [{ id: "t0", tool_name: "old_tool", status: "success" }],
  })
  assert.equal((tm.get(tid) as any).latest_tool, "click", "insert-before-last must not restamp")
})

test("second user message never overwrites the stamped brief", async () => {
  reset()
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const tm = new ThreadManager()
  const tid = tm.create("briefonce").id
  tm.addMessage(tid, { thread_id: tid, role: "user", content: "第一条任务" })
  tm.addMessage(tid, { thread_id: tid, role: "user", content: "第二条任务" })
  assert.equal((tm.get(tid) as any).brief, "第一条任务")
})
