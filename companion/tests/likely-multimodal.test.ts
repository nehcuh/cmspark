import test from "node:test"
import assert from "node:assert/strict"
import { likelyMultimodal, resolveNativeVision, visionConfigForAnalyze } from "../src/llm/likely-multimodal"

test("likelyMultimodal: known multimodal families true", () => {
  for (const m of [
    "gpt-4o", "gpt-4.1", "gpt-4-turbo", "claude-sonnet-4-6", "claude-opus-4-7",
    "gemini-2.0-flash", "glm-4v", "glm-4.6v", "qwen2.5-vl", "qwen2.5vl:3b",
    "llava:7b", "grok/grok-4.7@500k", "grok-4.7", "pixtral-12b", "foo-vision-bar", "kimi-vl", "moonshot-v1-vision",
  ]) {
    assert.equal(likelyMultimodal(m), true, m)
  }
})

test("likelyMultimodal: text-only and unknown false (fail closed)", () => {
  for (const m of [
    "deepseek-chat", "deepseek-v4-flash", "kimi-k2", "moonshot-v1-128k",
    "my-coder-7b", "grok-4.7-text", "some-reasoner", "", "foo-bar-7b", "llama3.1",
  ]) {
    assert.equal(likelyMultimodal(m), false, m)
  }
})

test("resolveNativeVision: on/off override heuristic", () => {
  assert.equal(resolveNativeVision({ modelName: "foo-bar-7b", mode: "on" }), true)
  assert.equal(resolveNativeVision({ modelName: "gpt-4o", mode: "off" }), false)
  // Unkeyed detected must not flip routing (C1 — panel lock-step).
  assert.equal(resolveNativeVision({ modelName: "foo-bar-7b", mode: "auto", detected: true }), false)
  assert.equal(resolveNativeVision({ modelName: "foo-bar-7b", mode: "auto", detected: false }), false)
})

test("official DeepSeek Flash aliases support images while Pro and unprobed gateway aliases remain text-only", () => {
  for (const modelName of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
    for (const baseUrl of ["https://api.deepseek.com/v1", "https://api.deepseek.com/anthropic"]) {
      assert.equal(resolveNativeVision({ baseUrl, modelName }), true)
      assert.equal(resolveNativeVision({ baseUrl, modelName, mode: "off" }), false)
    }
    assert.equal(resolveNativeVision({ baseUrl: "https://gateway.invalid/v1", modelName }), false)
  }
  assert.equal(resolveNativeVision({ baseUrl: "https://api.deepseek.com", modelName: "deepseek-v4-pro" }), false)
})

test("visionConfigForAnalyze prefers main LLM when native", () => {
  const cfg = visionConfigForAnalyze(
    { base_url: "http://10.1.1.1/v1", api_key: "sk-x", model_name: "gpt-4o", protocol: "openai" },
    { enabled: true, base_url: "http://127.0.0.1:11434/v1", api_key: "ollama", model_name: "llava:7b" },
  )
  assert.ok(cfg)
  assert.equal(cfg!.base_url, "http://10.1.1.1/v1")
  assert.equal(cfg!.model_name, "gpt-4o")
})

test("visionConfigForAnalyze keeps vision rail when main is text-only", () => {
  const cfg = visionConfigForAnalyze(
    { base_url: "https://api.deepseek.com/v1", api_key: "sk-x", model_name: "deepseek-v4-pro" },
    { enabled: true, base_url: "http://127.0.0.1:11434/v1", api_key: "ollama", model_name: "llava:7b" },
  )
  assert.ok(cfg)
  assert.equal(cfg!.model_name, "llava:7b")
})

test("catalog image input matches the actual supported endpoint", () => {
  assert.equal(likelyMultimodal("glm-5.4", "https://api.z.ai/api/coding/paas/v4"), true)
  assert.equal(likelyMultimodal("glm-5.4", "https://open.bigmodel.cn/api/anthropic"), true)
  assert.equal(likelyMultimodal("glm-5.4", "https://open.bigmodel.cn/api/paas/v4"), false)
  assert.equal(likelyMultimodal("qwen4-max", "https://dashscope.aliyuncs.com/compatible-mode/v1"), true)
  assert.equal(likelyMultimodal("gpt-6-luna", "https://api.openai.com/v1"), true)
  assert.equal(likelyMultimodal("gpt-6-luna", "https://relay.example/v1"), false)
})
