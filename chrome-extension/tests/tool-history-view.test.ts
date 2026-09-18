import test from "node:test"
import assert from "node:assert/strict"
import {
  viewToolHistory,
  liveChipLabel,
  doneChipLabel,
  groupToolTurnRows,
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
