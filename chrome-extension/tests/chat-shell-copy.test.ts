import test from "node:test"
import assert from "node:assert/strict"
import { chatShellEmpty, CHAT_SHELL_PAGE_CHIP_PREFIX, CHAT_SHELL_CHIPS } from "../src/sidepanel/chat-shell-copy"

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
