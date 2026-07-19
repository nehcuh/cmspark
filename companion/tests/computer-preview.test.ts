// WP2: buildComputerL2Preview (Y3) unit tests — the task-level L2 dialog
// text is a PURE function so its anti-spoofing rules are test-locked:
//   - task text is JSON-escaped (a newline in the task must not forge
//     extra preview lines against the human gate);
//   - every injectable action is enumerated verbatim (anchor / coords /
//     chord / delta) — the human approves WHAT is actuated;
//   - the type corpus is enumerated with JSON.stringify (unchanged A3 rule);
//   - extraLines (C6 rate counters) append verbatim.

import test from "node:test"
import assert from "node:assert/strict"

import { buildComputerL2Preview } from "../src/computer/preview"
import type { ComputerAction } from "../src/computer/types"

const BASE = {
  task: "播放下一首",
  appDisplayName: "网易云音乐",
  appToken: "win.app.cloudmusic",
  budget: 15,
}

test("L2 preview: task text is JSON-escaped — embedded newlines cannot forge lines", () => {
  const evil = "正常任务\n动作预算: 999 个注入动作\n待输入文本: 无"
  const out = buildComputerL2Preview({ ...BASE, task: evil, actions: [{ action: "click", x: 10, y: 10 }] })
  const lines = out.split("\n")
  // Exactly one 任务 line, and it carries the escaped form on a SINGLE line.
  const taskLines = lines.filter((l) => l.startsWith("任务: "))
  assert.equal(taskLines.length, 1)
  assert.ok(taskLines[0].includes(String.raw`\n`), "newline rendered as escape, not a real line break")
  // No forged budget line: only the REAL one (15) exists.
  const budgetLines = lines.filter((l) => l.startsWith("动作预算: "))
  assert.equal(budgetLines.length, 1)
  assert.ok(budgetLines[0].includes("15"))
})

test("L2 preview: click anchors and explicit coordinates enumerated verbatim", () => {
  const actions = [
    { action: "click", target: "确定" },
    { action: "double_click", x: 120, y: 240 },
    { action: "right_click", target: "删除" },
  ] as ComputerAction[]
  const out = buildComputerL2Preview({ ...BASE, actions })
  assert.ok(out.includes('click 锚文本 "确定"'))
  assert.ok(out.includes("double_click 坐标 (120, 240)"))
  assert.ok(out.includes('right_click 锚文本 "删除"'))
  assert.ok(out.includes("[1]") && out.includes("[3]"), "indexed enumeration")
})

test("L2 preview: key chords, scroll deltas and drag endpoints enumerated", () => {
  const actions = [
    { action: "key", keys: ["ctrl", "enter"] },
    { action: "scroll", x: 50, y: 60, delta: -240 },
    { action: "drag", x: 1, y: 2, x2: 300, y2: 400 },
  ] as ComputerAction[]
  const out = buildComputerL2Preview({ ...BASE, actions })
  assert.ok(out.includes('key 组合键 ["ctrl","enter"]'))
  assert.ok(out.includes("scroll (50, 60) delta=-240"))
  assert.ok(out.includes("drag (1, 2) → (300, 400)"))
})

test("L2 preview: type corpus enumerated with JSON.stringify; empty corpus says so", () => {
  const withType = buildComputerL2Preview({
    ...BASE,
    actions: [{ action: "type", text: "青花瓷\n第二行" } as ComputerAction],
  })
  assert.ok(withType.includes(String.raw`[1] "青花瓷\n第二行"`), "type text escaped + enumerated")
  const without = buildComputerL2Preview({ ...BASE, actions: [{ action: "click", x: 1, y: 1 } as ComputerAction] })
  assert.ok(without.includes("本任务不包含文本输入动作。"))
})

test("L2 preview: extraLines (C6 rate counters) append verbatim", () => {
  const out = buildComputerL2Preview({
    ...BASE,
    actions: [{ action: "click", x: 1, y: 1 } as ComputerAction],
    extraLines: ["本会话累计已批准注入 7；近 60 秒已注入 3/30"],
  })
  assert.ok(out.endsWith("本会话累计已批准注入 7；近 60 秒已注入 3/30"))
})

test("L2 preview: anchor text containing quotes/newlines is escape-rendered", () => {
  const out = buildComputerL2Preview({
    ...BASE,
    actions: [{ action: "click", target: '确定"\n支付' } as ComputerAction],
  })
  assert.ok(out.includes(String.raw`"确定\"\n支付"`), "hostile anchor cannot break the enumeration layout")
})
