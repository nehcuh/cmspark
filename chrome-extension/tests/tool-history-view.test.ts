import test from "node:test"
import assert from "node:assert/strict"
import {
  viewToolHistory,
  liveChipLabel,
  doneChipLabel,
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
