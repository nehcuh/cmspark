// Vision key inherit + fail-closed request gate (multi-adversarial P0).

import test from "node:test"
import assert from "node:assert/strict"

import {
  endpointsMatch,
  isLoopbackVisionHost,
  isPlaceholderVisionKey,
  resolveInheritedVisionApiKey,
  shouldBlockVisionRequest,
} from "../src/llm/vision-reuse-inherit"

test("resolveInheritedVisionApiKey: copies llm key when endpoints match and vision placeholder", () => {
  const key = resolveInheritedVisionApiKey({
    llmBaseUrl: "https://api.openai.com/v1/",
    llmModelName: "gpt-4o",
    llmApiKey: "sk-main",
    visionBaseUrl: "https://api.openai.com/v1",
    visionModelName: "gpt-4o",
    visionApiKey: "ollama",
  })
  assert.equal(key, "sk-main")
})

test("resolveInheritedVisionApiKey: no copy when vision already has real key", () => {
  const key = resolveInheritedVisionApiKey({
    llmBaseUrl: "https://api.openai.com/v1",
    llmModelName: "gpt-4o",
    llmApiKey: "sk-main",
    visionBaseUrl: "https://api.openai.com/v1",
    visionModelName: "gpt-4o",
    visionApiKey: "sk-vision",
  })
  assert.equal(key, undefined)
})

test("resolveInheritedVisionApiKey: no copy when endpoints differ", () => {
  const key = resolveInheritedVisionApiKey({
    llmBaseUrl: "https://api.openai.com/v1",
    llmModelName: "gpt-4o",
    llmApiKey: "sk-main",
    visionBaseUrl: "http://localhost:11434/v1",
    visionModelName: "llava:7b",
    visionApiKey: "ollama",
  })
  assert.equal(key, undefined)
})

test("resolveInheritedVisionApiKey: ignores masked llm key", () => {
  for (const mask of ["***", "sk-****xyz"]) {
    const key = resolveInheritedVisionApiKey({
      llmBaseUrl: "https://api.openai.com/v1",
      llmModelName: "gpt-4o",
      llmApiKey: mask,
      visionBaseUrl: "https://api.openai.com/v1",
      visionModelName: "gpt-4o",
      visionApiKey: "",
    })
    assert.equal(key, undefined, mask)
  }
})

test("resolveInheritedVisionApiKey: anthropic protocol never inherits", () => {
  const key = resolveInheritedVisionApiKey({
    llmBaseUrl: "https://api.anthropic.com",
    llmModelName: "claude-sonnet-4-6",
    llmApiKey: "sk-ant-main",
    llmProtocol: "anthropic",
    visionBaseUrl: "https://api.anthropic.com",
    visionModelName: "claude-sonnet-4-6",
    visionApiKey: "ollama",
  })
  assert.equal(key, undefined)
})

test("resolveInheritedVisionApiKey: openai protocol + claude model name still inherits", () => {
  const key = resolveInheritedVisionApiKey({
    llmBaseUrl: "https://gateway.example/v1",
    llmModelName: "claude-sonnet-4-6",
    llmApiKey: "sk-gateway",
    llmProtocol: "openai",
    visionBaseUrl: "https://gateway.example/v1",
    visionModelName: "claude-sonnet-4-6",
    visionApiKey: "ollama",
  })
  assert.equal(key, "sk-gateway")
})

test("isPlaceholderVisionKey treats masks as placeholder (fail-closed gate)", () => {
  assert.equal(isPlaceholderVisionKey("***"), true)
  assert.equal(isPlaceholderVisionKey("sk-****xyz"), true)
})

test("shouldBlockVisionRequest: cloud + ollama blocked; loopback allowed", () => {
  assert.equal(
    shouldBlockVisionRequest({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "ollama",
    }).block,
    true,
  )
  assert.equal(
    shouldBlockVisionRequest({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    }).block,
    false,
  )
  assert.equal(
    shouldBlockVisionRequest({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-real",
    }).block,
    false,
  )
})

test("endpointsMatch + loopback + placeholder helpers", () => {
  assert.equal(
    endpointsMatch(
      { base_url: "https://x.com/v1/", model_name: "m" },
      { base_url: "https://x.com/v1", model_name: "M" },
    ),
    true,
  )
  assert.equal(isLoopbackVisionHost("http://127.0.0.1:11434/v1"), true)
  assert.equal(isLoopbackVisionHost("http://[::1]:11434/v1"), true)
  assert.equal(isLoopbackVisionHost("https://open.bigmodel.cn/api/paas/v4"), false)
  assert.equal(isLoopbackVisionHost("not a url"), false)
  assert.equal(isPlaceholderVisionKey("ollama"), true)
  assert.equal(isPlaceholderVisionKey("sk"), false)
})
