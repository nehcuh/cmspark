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

import { buildComputerL2Preview, sanitizeComputerCaption, type ComputerTaskEvent } from "../src/computer/preview"
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

// --- WP4 P1:大预算任务的预览文本必然超过 code_preview 的 1200 截断 ----------
// (full_preview 独立字段的逐字完整性质测试在 security-confirmation 套件;
// 这里锁定「30 动作 + 2000 语料的枚举全文 > 1200」这一前提。)

test("P1 premise: 30 actions + 2000-char corpus produce a preview far beyond CODE_PREVIEW_LIMIT(1200)", () => {
  const actions: ComputerAction[] = []
  for (let i = 0; i < 29; i++) {
    actions.push({ action: "click", x: 100 + i, y: 200 + i } as ComputerAction)
  }
  actions.push({ action: "type", text: "汉".repeat(2000) } as ComputerAction)
  const out = buildComputerL2Preview({ ...BASE, actions })
  assert.ok(out.length > 1200, `preview length ${out.length} must exceed 1200`)
  // 注入枚举只含 actuation 动作(29 个 click → [29];type 不进枚举);
  // 语料在「待输入文本」区逐字枚举——两区尾部都在全文里。
  assert.ok(out.includes("[29]"))
  assert.ok(out.includes("汉".repeat(2000)))
})

// --- WP4 P3:sanitizeComputerCaption 字符类清洗(字面量一律显式 \uXXXX 转义,
// 杜绝不可见字符落进源文件) -------------------------------------------------

test("sanitizeComputerCaption: U+2028/U+2029/控制符 → 空格(不断行)", () => {
  assert.equal(sanitizeComputerCaption("甲\u2028乙"), "甲 乙")
  assert.equal(sanitizeComputerCaption("甲\u2029乙"), "甲 乙")
  assert.equal(sanitizeComputerCaption("甲\n乙"), "甲 乙")
  assert.equal(sanitizeComputerCaption("甲\r\n乙"), "甲 乙")
  assert.equal(sanitizeComputerCaption("甲\t乙"), "甲 乙")
})

test("sanitizeComputerCaption: 零宽/格式字符(U+200B–U+200F、FEFF、U+2060、bidi)→ 删除", () => {
  assert.equal(sanitizeComputerCaption("甲\u200B乙"), "甲乙")
  assert.equal(sanitizeComputerCaption("甲\u200C乙"), "甲乙")
  assert.equal(sanitizeComputerCaption("甲\u200D乙"), "甲乙")
  assert.equal(sanitizeComputerCaption("甲\u200E乙"), "甲乙") // U+200E LRM
  assert.equal(sanitizeComputerCaption("甲\uFEFF乙"), "甲乙") // FEFF BOM
  assert.equal(sanitizeComputerCaption("甲\u2060乙"), "甲乙") // U+2060 WORD JOINER
  assert.equal(sanitizeComputerCaption("甲\u202A乙\u202C"), "甲乙") // bidi 嵌入
})

test("sanitizeComputerCaption: 连续空格折叠 + 首尾 trim;非字符串输入安全", () => {
  assert.equal(sanitizeComputerCaption("  甲   乙  "), "甲 乙")
  assert.equal(sanitizeComputerCaption(undefined as any), "")
  assert.equal(sanitizeComputerCaption(null as any), "")
})

test("P3 property: 含 U+2028/零宽字符的 caption 载荷不产生第二行", () => {
  const forged = sanitizeComputerCaption("点击「确定\u2028\u200B」")
  assert.equal(forged.split("\n").length, 1)
  assert.equal(/[\u2028\u2029\u200B\uFEFF]/.test(forged), false)
})

// --- WP4:ComputerTaskEvent 事件字段形状(新增可选字段) ----------------------

test("ComputerTaskEvent: WP4 新增字段形状(started.budget / step 定位字段 / finished.evidenceDir)", () => {
  const started: ComputerTaskEvent = { event: "started", taskId: "t1", app: "A", task: "t", total: 3, budget: 15 }
  assert.equal(started.budget, 15)
  const step: ComputerTaskEvent = {
    event: "step",
    taskId: "t1",
    seq: 1,
    action: "click",
    caption: "点击「确定」",
    layer: "ocr",
    confidence: 0.9,
    durationMs: 123,
    locateAttempts: [{ layer: "ocr", outcome: "hit", confidence: 0.9, ms: 100 }],
    crossverified: true,
    crossverifyChannel: "pixel-region",
  }
  assert.equal(step.locateAttempts?.[0].layer, "ocr")
  assert.equal(step.crossverifyChannel, "pixel-region")
  const finished: ComputerTaskEvent = {
    event: "finished",
    taskId: "t1",
    ok: true,
    completed: 3,
    evidenceDir: "C:\\evidence\\t1",
  }
  assert.equal(finished.evidenceDir, "C:\\evidence\\t1")
})
