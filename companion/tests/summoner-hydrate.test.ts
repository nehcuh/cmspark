import test from "node:test"
import assert from "node:assert/strict"
import { hydratePlaintext } from "../src/summoner/hydrate"

/** Wireframe dashed-box transcript: plaintext lines, not chat bubbles. */

test("25 user messages truncate to last 20 lines", () => {
  const messages = Array.from({ length: 25 }, (_, i) => ({
    role: "user",
    content: `msg-${i + 1}`,
  }))
  const lines = hydratePlaintext(messages)
  assert.equal(lines.length, 20)
  assert.equal(lines[0], "你: msg-6")
  assert.equal(lines[19], "你: msg-25")
})

test("tool role line starts with [工具]", () => {
  const named = hydratePlaintext([
    { role: "tool", tool_calls: [{ function: { name: "navigate" } }] },
  ])
  assert.equal(named.length, 1)
  assert.ok(named[0].startsWith("[工具]"))
  assert.equal(named[0], "[工具] navigate")

  const unnamed = hydratePlaintext([{ role: "tool" }])
  assert.equal(unnamed.length, 1)
  assert.ok(unnamed[0].startsWith("[工具]"))
  assert.equal(unnamed[0], "[工具]")
})

test("empty content is skipped", () => {
  const lines = hydratePlaintext([
    { role: "user", content: "" },
    { role: "user", content: "   " },
    { role: "assistant", content: "" },
    { role: "user" },
    { role: "user", content: "keep" },
  ])
  assert.deepEqual(lines, ["你: keep"])
})

test("user/assistant prefixes 你/助手", () => {
  const lines = hydratePlaintext([
    { role: "user", content: "hello" },
    { role: "assistant", content: "world" },
  ])
  assert.deepEqual(lines, ["你: hello", "助手: world"])
})

test("no mermaid/html wrapping — plaintext only", () => {
  const lines = hydratePlaintext([
    { role: "assistant", content: "```mermaid\ngraph TD\nA-->B\n```" },
    { role: "user", content: "<div class=\"bubble\">hi</div>" },
  ])
  assert.equal(Array.isArray(lines), true)
  assert.equal(lines.length, 2)
  assert.ok(lines.every((l) => typeof l === "string"))
  assert.ok(lines[0].startsWith("助手: "))
  assert.ok(lines[1].startsWith("你: "))
  // Dashed-box wireframe: return string[] lines, never wrap the transcript
  // in mermaid fences, HTML documents, or chat-bubble markup.
  const blob = lines.join("\n")
  assert.equal(blob.startsWith("```"), false)
  assert.equal(blob.startsWith("<"), false)
  assert.doesNotMatch(blob, /^```(?:mermaid|html)/)
  assert.doesNotMatch(blob, /^<(?:div|p|html|body|article)\b/i)
  assert.equal(lines.some((l) => /^<div\b/i.test(l)), false)
  assert.equal(lines.some((l) => l.includes('class="chat-bubble"')), false)
})
