import test from "node:test"
import assert from "node:assert/strict"
import { chatShellEmpty, CHAT_SHELL_PAGE_CHIP_PREFIX, CHAT_SHELL_CHIPS, truncationHonestyChip } from "../src/sidepanel/chat-shell-copy"

test("no page: title 要我帮你做什么, no chips, no pageChip", () => {
  const e = chatShellEmpty(null)
  assert.equal(e.title, "要我帮你做什么？")
  assert.equal(e.pageChip, null)
  assert.equal(e.chips.length, 0)
})

test("page: 要对这页做什么 + 当前页 prefix + 3 static fills", () => {
  const e = chatShellEmpty("vibesop 交互报告")
  assert.equal(e.title, "要对这页做什么？")
  assert.equal(e.pageChip, `${CHAT_SHELL_PAGE_CHIP_PREFIX}vibesop 交互报告`)
  assert.equal(e.chips.length, 3)
  assert.deepEqual(e.chips.map((c) => c.label), CHAT_SHELL_CHIPS.map((c) => c.label))
  assert.ok(!e.pageChip!.includes("正在看"))
  assert.ok(!e.pageChip!.includes("分享"))
  for (const c of e.chips) {
    assert.ok(!c.fill.includes("vibesop"))
  }
})

test("truncationHonestyChip: empty content + reasoning vs truncated", () => {
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", truncated: true }),
    "思考用尽输出上限",
  )
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", finish_reason: "length" }),
    "思考用尽输出上限",
  )
  assert.equal(
    truncationHonestyChip({ content: "partial", truncated: true }),
    "输出被截断",
  )
  assert.equal(truncationHonestyChip({ content: "ok" }), null)
  assert.equal(
    truncationHonestyChip({
      content: "",
      reasoning_content: "thinking",
      finish_reason: "aborted",
    }),
    "已停止生成",
  )
})

test("#295 truncationHonestyChip: tool_calls rounds never get a chip", () => {
  const toolCalls = [{ id: "tc1", type: "function", function: { name: "list_tabs", arguments: "{}" } }]
  // Normal agent intermediate round (98% of the old false positives).
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", tool_calls: toolCalls }),
    null,
  )
  // Even with truncation evidence present, a tool round is not a "reply".
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", tool_calls: toolCalls, finish_reason: "length" }),
    null,
  )
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", tool_calls: toolCalls, truncated: true }),
    null,
  )
})

test("#295 truncationHonestyChip: empty reply without length evidence is neutral, never 额度", () => {
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking" }),
    "模型未返回内容",
  )
  assert.equal(
    truncationHonestyChip({ content: "", reasoning_content: "thinking", finish_reason: "stop" }),
    "模型未返回内容",
  )
  // NEVER: 额度 (billing quota) wording for a max_tokens/output-limit event.
  assert.ok(!JSON.stringify(String(truncationHonestyChip({ content: "", reasoning_content: "t", finish_reason: "length" }))).includes("额度"))
})
