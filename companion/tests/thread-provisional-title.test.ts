import test from "node:test"
import assert from "node:assert/strict"
import { provisionalTitleFromUserText } from "../src/llm/adapter"
import { aliasFromFirstUserText } from "../src/threads/alias-commit"

test("provisionalTitleFromUserText trims and truncates", () => {
  assert.equal(provisionalTitleFromUserText("  hello  "), "hello")
  // F10: shares aliasFromFirstUserText semantics — 16-char cut + "…" suffix.
  assert.equal(provisionalTitleFromUserText("a".repeat(20)).length, 17)
  assert.ok(provisionalTitleFromUserText("a".repeat(20)).endsWith("…"))
})

test("provisionalTitleFromUserText empty", () => {
  assert.equal(provisionalTitleFromUserText(""), "")
  assert.equal(provisionalTitleFromUserText("   \n\t  "), "")
})

test("provisionalTitleFromUserText collapses whitespace and CJK", () => {
  const t = provisionalTitleFromUserText("配置两个\n技能包并下载")
  assert.match(t, /配置两个/)
  assert.ok(!t.includes("\n"))
})

test("F10: immediate title delegates to shared aliasFromFirstUserText", () => {
  for (const text of [
    "今天我们来讨论一下关于季度财报的几个关键问题和现金流安排",
    "请帮我分析一下这个代码库的整体架构和模块划分",
    "[文件 report.pdf] 帮我总结这份报告的要点和结论",
    "[文件 report.pdf]",
    "  hello  ",
    "",
  ]) {
    assert.equal(provisionalTitleFromUserText(text), aliasFromFirstUserText(text, 16))
  }
})
