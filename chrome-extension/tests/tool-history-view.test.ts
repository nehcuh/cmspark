import test from "node:test"
import assert from "node:assert/strict"
import {
  viewToolHistory,
  liveChipLabel,
  doneChipLabel,
  groupToolTurnRows,
  shouldRenderInlineToolCards,
  pendingConfirmIdsFromTools,
  pendingConfirmToolNamesForThread,
  confirmationMatchesActiveThread,
  confirmationOwnerThreadId,
} from "../src/sidepanel/components/tool-history-view"

const nav = { id: "1", tool_name: "navigate", status: "success" }
const click = { id: "2", tool_name: "click", status: "success" }
const run = { id: "3", tool_name: "get_page_text", status: "running" }
const err = { id: "4", tool_name: "click", status: "error", error: "x" }

test("empty", () => {
  assert.equal(viewToolHistory([], { threadBusy: false }).kind, "empty")
})

test("live: completed chip + current running", () => {
  const v = viewToolHistory([nav, click, run], { threadBusy: true })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.completed.length, 2)
  assert.equal(v.current.id, "3")
  assert.equal(v.failed, 0)
})

test("L2 pending is current, never folded", () => {
  const v = viewToolHistory([nav, click], {
    threadBusy: true,
    pendingConfirmIds: new Set(["2"]),
  })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.current.id, "2")
  assert.equal(v.completed.length, 1)
})

test("done after turn: one audit chip", () => {
  const v = viewToolHistory([nav, click, err], { threadBusy: false })
  assert.equal(v.kind, "done")
  if (v.kind !== "done") return
  assert.equal(v.tools.length, 3)
  assert.equal(v.failed, 1)
})

test("busy turn with last tool still resultless stays live", () => {
  const last = { id: "9", tool_name: "click" }
  const v = viewToolHistory([nav, last], { threadBusy: true })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.current.id, "9")
  assert.equal(v.completed.length, 1)
})

test("single success tool still folds into done chip", () => {
  const v = viewToolHistory([nav], { threadBusy: false })
  assert.equal(v.kind, "done")
  if (v.kind !== "done") return
  assert.equal(v.tools.length, 1)
  assert.equal(v.failed, 0)
})

test("failure counted via error field even without status", () => {
  const implicit = { id: "5", tool_name: "click", error: "boom" }
  const v = viewToolHistory([nav, implicit], { threadBusy: false })
  assert.equal(v.kind, "done")
  if (v.kind !== "done") return
  assert.equal(v.failed, 1)
})

test("copy helpers", () => {
  assert.equal(liveChipLabel(6, 0), "已完成 6 步 · 展开")
  assert.equal(liveChipLabel(6, 1), "已完成 6 步 · 1 失败 · 展开")
  assert.equal(doneChipLabel(8, 0), "8 步浏览器操作 · 0 失败 · 展开审计")
  assert.equal(doneChipLabel(8, 1), "8 步浏览器操作 · 1 失败 · 展开审计")
})

// The store model is ONE role=tool row per tool (live tool.start and hydrated
// persistence agree). A turn's chip therefore groups consecutive tool rows;
// any other row starts a new block (spec §2.3: never merge separate turns).
const toolRow = (id: string, tool_name: string, status: string) => ({
  id,
  role: "tool",
  tool_calls: [{ id, tool_name, status }],
})

test("groupToolTurnRows merges consecutive tool rows into one block", () => {
  const items = groupToolTurnRows([
    { id: "u1", role: "user", content: "hi" },
    toolRow("1", "navigate", "success"),
    toolRow("2", "click", "success"),
    { id: "a1", role: "assistant", content: "answer" },
  ])
  assert.deepEqual(
    items.map((i) => i.kind),
    ["row", "tools", "row"],
  )
  const block = items[1]
  if (block.kind !== "tools") return
  assert.equal(block.msgs.length, 2)
  const tools = block.msgs.flatMap((m: any) => m.tool_calls)
  const v = viewToolHistory(tools, { threadBusy: false })
  assert.equal(v.kind, "done")
  if (v.kind !== "done") return
  assert.equal(v.tools.length, 2)
})

test("groupToolTurnRows splits turns at assistant text rows", () => {
  const items = groupToolTurnRows([
    toolRow("1", "navigate", "success"),
    { id: "a1", role: "assistant", content: "mid-turn text" },
    toolRow("2", "click", "success"),
  ])
  assert.deepEqual(
    items.map((i) => i.kind),
    ["tools", "row", "tools"],
  )
})

test("groupToolTurnRows: tool row without tool_calls stays a plain row", () => {
  const items = groupToolTurnRows([{ id: "t0", role: "tool" }])
  assert.deepEqual(
    items.map((i) => i.kind),
    ["row"],
  )
  assert.deepEqual(groupToolTurnRows([]), [])
})

test("shouldRenderInlineToolCards: only flat-shape assistant rows render inline cards", () => {
  // role=tool rows are consumed by the per-turn block — never inline again
  assert.equal(
    shouldRenderInlineToolCards({ role: "tool", tool_calls: [toolRow("1", "click", "success").tool_calls[0]] }),
    false,
  )
  // hydrated assistant rows carry OpenAI function shape — the block owns them
  assert.equal(
    shouldRenderInlineToolCards({
      role: "assistant",
      tool_calls: [{ id: "c1", type: "function", function: { name: "click", arguments: "{}" } }],
    }),
    false,
  )
  // flat live shape (tool_name, no function envelope) stays inline
  assert.equal(
    shouldRenderInlineToolCards({ role: "assistant", tool_calls: [toolRow("1", "click", "success").tool_calls[0]] }),
    true,
  )
  // no tool_calls at all → nothing to render inline
  assert.equal(shouldRenderInlineToolCards({ role: "assistant" }), false)
})

// Kimi MAJOR-1: prehistoric hydrated threads carry ONLY assistant rows with
// function-shape tool_calls (no role=tool rows). Suppressing inline cards
// alone would drop the audit chip — grouping must convert such rows.
const fnAssistant = (id: string, name: string, content = "") => ({
  id: `a-${id}`,
  role: "assistant",
  content,
  tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
})

test("groupToolTurnRows converts uncovered function-shape assistant rows into tools blocks", () => {
  const items = groupToolTurnRows([
    { id: "u1", role: "user", content: "hi" },
    fnAssistant("c1", "navigate"),
    fnAssistant("c2", "click"),
    { id: "a2", role: "assistant", content: "final answer" },
  ])
  // each uncovered assistant becomes one block; text-only rows stay rows
  assert.deepEqual(
    items.map((i) => i.kind),
    ["row", "tools", "tools", "row"],
  )
  const block = items[1]
  if (block.kind !== "tools") return
  const tools = block.msgs.flatMap((m: any) => m.tool_calls)
  // function name survives as flat tool_name for ToolCallCard
  assert.equal(tools[0].tool_name, "navigate")
})

test("groupToolTurnRows keeps covered marker assistant as a plain row", () => {
  const items = groupToolTurnRows([
    fnAssistant("c1", "navigate"),
    toolRow("c1", "navigate", "success"),
  ])
  assert.deepEqual(
    items.map((i) => i.kind),
    ["row", "tools"],
  )
})

test("groupToolTurnRows: uncovered assistant with text keeps the text row before its block", () => {
  const items = groupToolTurnRows([fnAssistant("c1", "navigate", "先看一下页面")])
  assert.deepEqual(
    items.map((i) => i.kind),
    ["row", "tools"],
  )
})

// ---------------------------------------------------------------------------
// #507 / #508 — L2 confirm correlation is thread-scoped + name→id is a
// tested pure function (empty names must yield empty ids).
// ---------------------------------------------------------------------------

test("#507 confirmationOwnerThreadId prefers worker_id then thread_id", () => {
  assert.equal(confirmationOwnerThreadId({ worker_id: "w1", thread_id: "t1" }), "w1")
  assert.equal(confirmationOwnerThreadId({ thread_id: "t1" }), "t1")
  assert.equal(confirmationOwnerThreadId({ tool_name: "click" }), null)
})

test("#507 foreign worker pending does not match the idle thread", () => {
  const workerClick = { tool_name: "click", worker_id: "worker-1", parent_thread_id: "parent-a" }
  assert.equal(confirmationMatchesActiveThread(workerClick, "parent-a"), false)
  assert.equal(confirmationMatchesActiveThread(workerClick, "worker-1"), true)
  const namesOnIdle = pendingConfirmToolNamesForThread([workerClick], "parent-a")
  assert.equal(namesOnIdle.size, 0)
  const namesOnWorker = pendingConfirmToolNamesForThread([workerClick], "worker-1")
  assert.equal(namesOnWorker.has("click"), true)
})

test("#507 same-thread untagged confirm still matches (legacy main-thread L2)", () => {
  const main = { tool_name: "evaluate" }
  assert.equal(confirmationMatchesActiveThread(main, "thread-a"), true)
  assert.equal(pendingConfirmToolNamesForThread([main], "thread-a").has("evaluate"), true)
})

test("#508 pendingConfirmIdsFromTools: empty names → empty ids (the silent mutation)", () => {
  const ids = pendingConfirmIdsFromTools([nav, click], new Set())
  assert.equal(ids.size, 0)
})

test("#508 pendingConfirmIdsFromTools: matching names collect those ids", () => {
  const ids = pendingConfirmIdsFromTools([nav, click], new Set(["click"]))
  assert.equal(ids.has("2"), true)
  assert.equal(ids.has("1"), false)
})

test("#507 historical completed click stays done without pending ids even if names would match", () => {
  // Cross-thread / earlier-turn: ChatView passes EMPTY_CONFIRM_NAMES to
  // non-frontier blocks, so pendingConfirmIds is empty and view stays done.
  const v = viewToolHistory([nav, click], {
    threadBusy: false,
    pendingConfirmIds: pendingConfirmIdsFromTools([nav, click], new Set()),
  })
  assert.equal(v.kind, "done")
})

test("#507 current-frontier L2 pending still goes live (#502 A)", () => {
  const pendingIds = pendingConfirmIdsFromTools([nav, click], new Set(["click"]))
  const v = viewToolHistory([nav, click], { threadBusy: true, pendingConfirmIds: pendingIds })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.current.id, "2")
  assert.equal(v.completed.length, 1)
})

// --- #502 A: covered rounds' thinking folds into the audit block (no per-round header) ---

test("covered round's reasoning folds into its tools block and marks the row", () => {
  const items = groupToolTurnRows([
    { id: "u1", role: "user", content: "go" },
    { id: "a1", role: "assistant", content: "", reasoning_content: "先看页面结构", tool_calls: [{ id: "c1", type: "function", function: { name: "navigate", arguments: "{}" } }] },
    toolRow("c1", "navigate", "success"),
    { id: "a2", role: "assistant", content: "done", reasoning_content: "收尾思考" },
  ])
  assert.deepEqual(items.map((i) => i.kind), ["row", "row", "tools", "row"])
  const covered = items[1]
  if (covered.kind !== "row") return assert.ok(false, "covered assistant must stay a row")
  assert.equal(covered.reasoningFolded, true, "covered round marked folded")
  const block = items[2]
  if (block.kind !== "tools") return assert.ok(false, "tool rows must group")
  assert.deepEqual(block.reasonings, ["先看页面结构"])
  const finalRow = items[3]
  if (finalRow.kind !== "row") return assert.ok(false, "final answer stays a row")
  assert.equal(finalRow.reasoningFolded === true, false, "final answer reasoning is NOT folded")
})

test("multi-round turn: each block carries only its own round's reasoning", () => {
  const items = groupToolTurnRows([
    { id: "a1", role: "assistant", content: "", reasoning_content: "R1", tool_calls: [{ id: "c1", type: "function", function: { name: "click", arguments: "{}" } }] },
    toolRow("c1", "click", "success"),
    { id: "a2", role: "assistant", content: "", reasoning_content: "R2", tool_calls: [{ id: "c2", type: "function", function: { name: "click", arguments: "{}" } }] },
    toolRow("c2", "click", "success"),
  ])
  assert.deepEqual(items.map((i) => i.kind), ["row", "tools", "row", "tools"])
  const b1 = items[1]
  const b2 = items[3]
  if (b1.kind !== "tools" || b2.kind !== "tools") return assert.ok(false, "two blocks")
  assert.deepEqual(b1.reasonings, ["R1"])
  assert.deepEqual(b2.reasonings, ["R2"])
  if (items[0].kind !== "row" || items[2].kind !== "row") return assert.ok(false, "rows")
  assert.equal(items[0].reasoningFolded, true)
  assert.equal(items[2].reasoningFolded, true)
})

test("covered assistant without reasoning: no reasonings attached, no folded flag", () => {
  const items = groupToolTurnRows([
    fnAssistant("c1", "navigate"),
    toolRow("c1", "navigate", "success"),
  ])
  const row = items[0]
  const block = items[1]
  if (row.kind !== "row" || block.kind !== "tools") return assert.ok(false, "shapes")
  assert.equal(row.reasoningFolded === true, false)
  assert.equal(block.reasonings, undefined)
})

test("uncovered function assistant with ONLY reasoning folds it into the synthetic block", () => {
  const items = groupToolTurnRows([
    { id: "a9", role: "assistant", content: "", reasoning_content: "孤立思考", tool_calls: [{ id: "c9", type: "function", function: { name: "click", arguments: "{}" } }] },
    { id: "a10", role: "assistant", content: "final" },
  ])
  // reasoning alone no longer keeps the row alive — it lives in the block's audit
  assert.deepEqual(items.map((i) => i.kind), ["tools", "row"])
  const block = items[0]
  if (block.kind !== "tools") return assert.ok(false, "synthetic block")
  assert.deepEqual(block.reasonings, ["孤立思考"])
})
