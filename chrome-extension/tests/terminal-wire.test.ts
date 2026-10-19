// #432 terminal wire contract tests（fail-closed parse / b64 CJK 安全 / 帧族判定）
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
declare const __dirname: string

import {
  isTerminalFrame,
  parseTerminalServerFrame,
  parseTerminalMetrics,
  terminalLaunchLabel,
  terminalB64Decode,
  terminalB64Encode,
  TERMINAL_FRAME_B64_MAX,
  TERMINAL_FRAME_PAYLOAD_MAX,
} from "../src/terminal/wire"

test("b64 roundtrip is UTF-8 safe (CJK / emoji / control)", () => {
  const samples = ["ls -la\n", "中文目录/文件.txt", "🚀 \x1b[31mred\x1b[0m", ""]
  for (const s of samples) {
    assert.equal(new TextDecoder().decode(terminalB64Decode(terminalB64Encode(s))), s)
  }
})

test("parse terminal.opened requires platform; pid optional (#584: ConPTY pid 异步就绪时如实缺省)", () => {
  assert.deepEqual(parseTerminalServerFrame({ type: "terminal.opened", id: "t1", pid: 42, platform: "darwin" }), {
    type: "terminal.opened",
    id: "t1",
    pid: 42,
    platform: "darwin",
  })
  // #584: pid 缺省（ConPTY 子进程未就绪）不再丢帧。
  assert.deepEqual(parseTerminalServerFrame({ type: "terminal.opened", id: "t1", platform: "win32" }), {
    type: "terminal.opened",
    id: "t1",
    platform: "win32",
  })
  // pid 存在但不是整数 → 仍拒（类型污染防线不变）。
  assert.equal(parseTerminalServerFrame({ type: "terminal.opened", id: "t1", pid: "x", platform: "darwin" }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.opened", id: "", pid: 1, platform: "darwin" }), null)
})

test("parse terminal.data requires integer seq + b64; unknown types rejected", () => {
  const ok = parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 0, b64: "aGk=" })
  assert.equal(ok?.type, "terminal.data")
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: -1, b64: "aGk=" }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 1.5, b64: "aGk=" }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 0 }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.evil", id: "t" }), null)
  assert.equal(parseTerminalServerFrame("terminal.data"), null)
  assert.equal(parseTerminalServerFrame(null), null)
})

test("terminal.closed carries optional code/signal/error without hard gate", () => {
  assert.deepEqual(parseTerminalServerFrame({ type: "terminal.closed", id: "t", code: "unsupported" }), {
    type: "terminal.closed",
    id: "t",
    code: "unsupported",
  })
  const f = parseTerminalServerFrame({ type: "terminal.closed", id: "t", code: 0, error: "x" })
  assert.equal(f?.type, "terminal.closed")
})

test("isTerminalFrame narrow-matches the family + open_tab verb", () => {
  assert.equal(isTerminalFrame({ type: "terminal.data" }), true)
  assert.equal(isTerminalFrame({ type: "terminal.open_tab" }), true)
  assert.equal(isTerminalFrame({ type: "knowledge.graph" }), false)
  assert.equal(isTerminalFrame({}), false)
  assert.equal(isTerminalFrame(null), false)
})

test("payload cap constant is the spec'd 16KiB", () => {
  assert.equal(TERMINAL_FRAME_PAYLOAD_MAX, 16 * 1024)
})

test("terminal.error parses without session id (busy/disconnected class)", () => {
  assert.deepEqual(parseTerminalServerFrame({ type: "terminal.error", code: "busy", error: "已有终端会话" }), {
    type: "terminal.error",
    id: "",
    code: "busy",
    error: "已有终端会话",
  })
  assert.equal(parseTerminalServerFrame({ type: "terminal.error", code: "busy" }), null)
  // 其他族仍要求 id
  assert.equal(parseTerminalServerFrame({ type: "terminal.pause" }), null)
})

test("terminal.data rejects b64 beyond cap (pi NIT-4)", () => {
  const huge = "A".repeat(TERMINAL_FRAME_B64_MAX + 2)
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 1, b64: huge }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 1, b64: "!!!!" }), null)
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 1, b64: "A".repeat(TERMINAL_FRAME_B64_MAX) }), null)
  const okB64 = btoa("x".repeat(TERMINAL_FRAME_PAYLOAD_MAX))
  assert.equal(parseTerminalServerFrame({ type: "terminal.data", id: "t", seq: 1, b64: okB64 })?.type, "terminal.data")
})

test("actual Companion review frames retain prompt, scoped error and receipt", () => {
  // Produced by companion/scripts/record-terminal-review-fixture.cjs, not a guessed wire shape.
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/terminal-review-v1.json"), "utf8"))
  const opened = parseTerminalServerFrame(fixture.opened)
  assert.equal(opened?.type, "terminal.opened")
  if (opened?.type !== "terminal.opened") throw new Error("opened fixture failed")
  assert.equal(opened.review_id, fixture.report.review_id)
  assert.ok(opened.review_prompt?.includes(fixture.report.head))
  const rejected = parseTerminalServerFrame(fixture.rejected)
  assert.equal(rejected?.id, fixture.opened.id)
  assert.equal(parseTerminalServerFrame(fixture.received)?.type, "terminal.review.received")
})

test("#724 launch source is optional, finite, and never Agent readiness", () => {
  for (const launch_kind of ["local_shell", "embedded_agent"]) {
    const actual = parseTerminalServerFrame({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind }) as any
    assert.equal(actual.launch_kind, launch_kind)
  }
  for (const launch_kind of [undefined, "FORGED", 42]) {
    const actual = parseTerminalServerFrame({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind }) as any
    assert.equal(actual.launch_kind, undefined)
  }
})

test("#724 optional diagnostics project exactly eight finite fields and reject uncertain values", () => {
  const metrics = { seq: 0, output_bytes: 0, unacked_frames: 0, unacked_bytes: 0, ack_frames: 0, pause_count: 0, paused: false, last_output_age_ms: null }
  assert.deepEqual(parseTerminalMetrics({ ...metrics, CONTENT: "not for logs" }), metrics)
  assert.equal(Object.keys(parseTerminalMetrics(metrics)!).length, 8)
  for (const patch of [{ seq: -1 }, { output_bytes: Infinity }, { ack_frames: Number.MAX_SAFE_INTEGER + 1 }, { pause_count: NaN }, { unacked_bytes: 256 * 1024 + 1 }, { unacked_frames: 256 * 1024 + 1 }, { paused: 1 }, { last_output_age_ms: undefined }, { last_output_age_ms: -1 }]) assert.equal(parseTerminalMetrics({ ...metrics, ...patch }), null)
  assert.equal(parseTerminalMetrics(undefined), null)
  assert.ok(terminalLaunchLabel(null).includes("未知"))
  assert.ok(terminalLaunchLabel("local_shell").includes("非编程 Agent"))
  assert.ok(terminalLaunchLabel("embedded_agent").includes("核实"))
  assert.equal(terminalLaunchLabel("embedded_agent").includes("正在运行"), false)
})
