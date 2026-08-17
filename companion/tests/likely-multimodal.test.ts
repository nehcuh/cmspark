import test from "node:test"
import assert from "node:assert/strict"
import { likelyMultimodal } from "../src/llm/likely-multimodal"

test("likelyMultimodal: known multimodal families true", () => {
  for (const m of [
    "gpt-4o", "gpt-4.1", "gpt-4-turbo", "claude-sonnet-4-6", "claude-opus-4-7",
    "gemini-2.0-flash", "glm-4v", "glm-4.6v", "qwen2.5-vl", "qwen2.5vl:3b",
    "llava:7b", "pixtral-12b", "foo-vision-bar", "kimi-vl", "moonshot-v1-vision",
  ]) {
    assert.equal(likelyMultimodal(m), true, m)
  }
})

test("likelyMultimodal: text-only and unknown false (fail closed)", () => {
  for (const m of [
    "deepseek-chat", "deepseek-v4-flash", "kimi-k2", "moonshot-v1-128k",
    "my-coder-7b", "some-reasoner", "", "foo-bar-7b", "llama3.1",
  ]) {
    assert.equal(likelyMultimodal(m), false, m)
  }
})
