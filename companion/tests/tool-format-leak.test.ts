import test from "node:test"
import assert from "node:assert/strict"
import {
  detectTextToolIntentLeak,
  TOOL_FORMAT_LEAK_USER_HINT_ZH,
} from "../src/llm/tool-format-leak"

test("detectTextToolIntentLeak: DSML and mcp structured names", () => {
  assert.equal(detectTextToolIntentLeak(""), false)
  assert.equal(detectTextToolIntentLeak("正常分析 PPT 结构即可"), false)
  assert.equal(
    detectTextToolIntentLeak(
      "我先看一下\n\n<|DSML|tool_calls>\ninvoke name=list_tabs\n</tool_calls>",
    ),
    true,
  )
  assert.equal(
    detectTextToolIntentLeak("调用 mcp__filesystem__list_directory 看目录"),
    true,
  )
  assert.equal(detectTextToolIntentLeak('invoke name="shell_exec"'), true)
  assert.equal(detectTextToolIntentLeak("list_tabs()"), true)
})

test("TOOL_FORMAT_LEAK_USER_HINT_ZH is non-empty Chinese", () => {
  assert.ok(TOOL_FORMAT_LEAK_USER_HINT_ZH.includes("没有真正执行"))
  assert.ok(TOOL_FORMAT_LEAK_USER_HINT_ZH.length > 20)
})
