// Vision reuse pure-logic matrix (multi-adversarial P0 DoD).

import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_VISION_BASE_URL,
  DEFAULT_VISION_MODEL,
  VISION_COPY,
  applyVisionReuseFromMain,
  bannerBodyForHost,
  extractHostname,
  isCustomVisionConfig,
  isVisionKeyPlaceholder,
  isVisionReusingMain,
  likelyMultimodal,
  normalizeEndpointUrl,
  shouldOfferVisionReuse,
} from "../src/sidepanel/components/vision-reuse-logic"

// --- likelyMultimodal include ---

test("likelyMultimodal: known multimodal families true", () => {
  for (const m of [
    "gpt-4o",
    "gpt-4.1",
    "gpt-4-turbo",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "gemini-2.0-flash",
    "kimi-vl",
    "glm-4v",
    "glm-4.6v",
    "qwen2.5-vl",
    "qwen2.5vl:3b",
    "llava:7b",
    "pixtral-12b",
    "foo-vision-bar",
  ]) {
    assert.equal(likelyMultimodal(m), true, m)
  }
})

// --- likelyMultimodal exclude ---

test("likelyMultimodal: text-only and unknown false (fail closed)", () => {
  for (const m of [
    "deepseek-chat",
    "deepseek-v4-flash",
    "deepseek-reasoner",
    "kimi-k2",
    "moonshot-v1-128k",
    "my-coder-7b",
    "some-reasoner",
    "",
    "foo-bar-7b",
    "llama3.1",
  ]) {
    assert.equal(likelyMultimodal(m), false, m)
  }
})

// --- shouldOfferVisionReuse ---

test("shouldOfferVisionReuse: anthropic protocol hard-blocks even for claude", () => {
  assert.equal(
    shouldOfferVisionReuse({
      model_name: "claude-sonnet-4-6",
      protocol: "anthropic",
      base_url: "https://api.anthropic.com",
    }),
    false,
  )
})

test("shouldOfferVisionReuse: openai protocol + claude gateway allows", () => {
  assert.equal(
    shouldOfferVisionReuse({
      model_name: "claude-sonnet-4-6",
      protocol: "openai",
      base_url: "https://gateway.example/v1",
    }),
    true,
  )
})

test("shouldOfferVisionReuse: deepseek never", () => {
  assert.equal(
    shouldOfferVisionReuse({ model_name: "deepseek-chat", protocol: "openai" }),
    false,
  )
})

// --- apply / equality ---

test("applyVisionReuseFromMain: maps url/model and copies key when present", () => {
  const r = applyVisionReuseFromMain({
    base_url: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    api_key: "sk-test",
    protocol: "openai",
  })
  assert.equal(r.patch.vision_base_url, "https://api.openai.com/v1")
  assert.equal(r.patch.vision_model_name, "gpt-4o")
  assert.equal(r.patch.vision_api_key, "sk-test")
  assert.equal(r.needsKeyPaste, false)
  assert.equal(r.destinationHost, "api.openai.com")
})

test("applyVisionReuseFromMain: empty key → needsKeyPaste, no vision_api_key in patch", () => {
  const r = applyVisionReuseFromMain({
    base_url: "https://api.openai.com/v1",
    model_name: "gpt-4o",
    api_key: "",
  })
  assert.equal(r.needsKeyPaste, true)
  assert.equal(r.patch.vision_api_key, undefined)
})

test("applyVisionReuseFromMain: masked display key → needsKeyPaste, do not copy mask", () => {
  for (const mask of ["***", "sk-****xyz"]) {
    const r = applyVisionReuseFromMain({
      base_url: "https://api.openai.com/v1",
      model_name: "gpt-4o",
      api_key: mask,
    })
    assert.equal(r.needsKeyPaste, true, mask)
    assert.equal(r.patch.vision_api_key, undefined, mask)
  }
})

test("isVisionReusingMain: trailing slash normalized", () => {
  assert.equal(
    isVisionReusingMain(
      { base_url: "https://api.openai.com/v1/", model_name: "gpt-4o" },
      { vision_base_url: "https://api.openai.com/v1", vision_model_name: "gpt-4o" },
    ),
    true,
  )
})

test("isCustomVisionConfig: default ollama not custom; separate cloud is", () => {
  assert.equal(
    isCustomVisionConfig(
      { base_url: "https://api.deepseek.com/v1", model_name: "deepseek-chat" },
      {
        vision_base_url: DEFAULT_VISION_BASE_URL,
        vision_model_name: DEFAULT_VISION_MODEL,
      },
    ),
    false,
  )
  assert.equal(
    isCustomVisionConfig(
      { base_url: "https://api.deepseek.com/v1", model_name: "deepseek-chat" },
      {
        vision_base_url: "https://open.bigmodel.cn/api/paas/v4",
        vision_model_name: "glm-4.6v",
      },
    ),
    true,
  )
})

test("extractHostname + banner body include host", () => {
  assert.equal(extractHostname("https://api.openai.com/v1"), "api.openai.com")
  const body = bannerBodyForHost("api.openai.com")
  assert.ok(body.includes("api.openai.com"))
  assert.ok(body.includes("转成文字") || body.includes("文字"))
})

test("copy honesty: no Ollama-required framing", () => {
  assert.ok(!/需要\s*Ollama/.test(VISION_COPY.sectionHelp))
  assert.ok(!/必须.*Ollama/.test(VISION_COPY.sectionHelp))
  assert.ok(VISION_COPY.sectionHelp.includes("转文字"))
  assert.ok(VISION_COPY.sectionHelp.includes("粘贴/选/拖"))
  assert.ok(VISION_COPY.railDifferentiator.includes("Qwen3-VL"))
  assert.ok(VISION_COPY.fallbackPassthrough.includes("视觉轨"))
  assert.ok(VISION_COPY.fallbackPassthrough.includes("原生看图"))
})

test("normalizeEndpointUrl and placeholder key helpers", () => {
  assert.equal(normalizeEndpointUrl("https://x.com/v1/"), "https://x.com/v1")
  assert.equal(isVisionKeyPlaceholder(""), true)
  assert.equal(isVisionKeyPlaceholder("ollama"), true)
  assert.equal(isVisionKeyPlaceholder("sk-real"), false)
})
