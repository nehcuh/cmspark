import test from "node:test"
import assert from "node:assert/strict"
import { provisionalTitleFromUserText } from "../src/llm/adapter"

test("provisionalTitleFromUserText trims and truncates", () => {
  assert.equal(provisionalTitleFromUserText("  hello  "), "hello")
  assert.equal(provisionalTitleFromUserText("a".repeat(20)).length, 16)
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
