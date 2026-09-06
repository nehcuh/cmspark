// #432 terminal wire contract tests（fail-closed parse / b64 CJK 安全 / 帧族判定）
import test from "node:test"
import assert from "node:assert/strict"

import {
  isTerminalFrame,
  parseTerminalServerFrame,
  terminalB64Decode,
  terminalB64Encode,
  TERMINAL_FRAME_PAYLOAD_MAX,
} from "../src/terminal/wire"

test("b64 roundtrip is UTF-8 safe (CJK / emoji / control)", () => {
  const samples = ["ls -la\n", "中文目录/文件.txt", "🚀 \x1b[31mred\x1b[0m", ""]
  for (const s of samples) {
    assert.equal(new TextDecoder().decode(terminalB64Decode(terminalB64Encode(s))), s)
  }
})

test("parse terminal.opened requires pid+platform", () => {
  assert.deepEqual(parseTerminalServerFrame({ type: "terminal.opened", id: "t1", pid: 42, platform: "darwin" }), {
    type: "terminal.opened",
    id: "t1",
    pid: 42,
    platform: "darwin",
  })
  assert.equal(parseTerminalServerFrame({ type: "terminal.opened", id: "t1", platform: "darwin" }), null)
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
