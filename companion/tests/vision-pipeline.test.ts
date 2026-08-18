// Vision pipeline response guards (LM Studio non-standard error bodies) +
// base_url /v1 normalization. Regression: a bare host:port vision base_url
// crashed on `choices[0]` with "Cannot read properties of undefined".

import test from "node:test"
import assert from "node:assert/strict"

import {
  analyzeImage,
  extractServerErrorMessage,
  normalizeVisionBaseUrl,
} from "../src/llm/vision-pipeline"

test("normalizeVisionBaseUrl: bare host:port gets /v1 (LM Studio root paste)", () => {
  assert.equal(normalizeVisionBaseUrl("http://127.0.0.1:1234"), "http://127.0.0.1:1234/v1")
  assert.equal(normalizeVisionBaseUrl("http://localhost:11434/"), "http://localhost:11434/v1")
})

test("normalizeVisionBaseUrl: scheme-less paste defaults to http", () => {
  assert.equal(normalizeVisionBaseUrl("127.0.0.1:1234"), "http://127.0.0.1:1234/v1")
  assert.equal(normalizeVisionBaseUrl("localhost:1234/v1"), "http://localhost:1234/v1")
})

test("normalizeVisionBaseUrl: stray query/fragment never swallows /v1", () => {
  assert.equal(normalizeVisionBaseUrl("http://127.0.0.1:1234?x=1"), "http://127.0.0.1:1234/v1")
  assert.equal(normalizeVisionBaseUrl("http://127.0.0.1:1234#frag"), "http://127.0.0.1:1234/v1")
  // userinfo survives the rebuild
  assert.equal(
    normalizeVisionBaseUrl("http://user:pass@127.0.0.1:1234"),
    "http://user:pass@127.0.0.1:1234/v1",
  )
})

test("normalizeVisionBaseUrl: URLs with a path pass through unchanged", () => {
  assert.equal(normalizeVisionBaseUrl("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1")
  assert.equal(normalizeVisionBaseUrl("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1")
  assert.equal(
    normalizeVisionBaseUrl("https://gateway.example.com/openai"),
    "https://gateway.example.com/openai",
  )
  assert.equal(
    normalizeVisionBaseUrl("https://host/openai/deployments/gpt-4o"),
    "https://host/openai/deployments/gpt-4o",
  )
})

test("normalizeVisionBaseUrl: empty / unparsable input passes through", () => {
  assert.equal(normalizeVisionBaseUrl(""), "")
  assert.equal(normalizeVisionBaseUrl("   "), "")
})

test("extractServerErrorMessage: LM Studio double-encoded engine error", () => {
  const body =
    'Engine protocol predict request returned 400: {"error":{"code":400,"message":"Failed to load image or audio file","type":"invalid_request_error"}}'
  assert.equal(extractServerErrorMessage(body), "Failed to load image or audio file")
})

test('extractServerErrorMessage: flat {"error":"…"} JSON string extracts the message', () => {
  assert.equal(
    extractServerErrorMessage('{"error":"plain flat string error"}'),
    "plain flat string error",
  )
})

test("extractServerErrorMessage: multi-JSON / unparseable bodies fall back to raw text", () => {
  const multi = 'warn {"retry":1} then {"error":{"message":"real"}}'
  assert.equal(extractServerErrorMessage(multi), multi)
})

test("extractServerErrorMessage: server text is capped before hitting the transcript", () => {
  const huge = "x".repeat(1000)
  const out = extractServerErrorMessage(huge)!
  assert.equal(out.length, 301)
  assert.ok(out.endsWith("…"))
})

test("extractServerErrorMessage: plain string and object shapes", () => {
  assert.equal(extractServerErrorMessage("Unexpected endpoint or method. (POST /chat/completions)"), "Unexpected endpoint or method. (POST /chat/completions)")
  assert.equal(extractServerErrorMessage({ message: "boom" }), "boom")
  assert.equal(extractServerErrorMessage(undefined), undefined)
  assert.equal(extractServerErrorMessage(null), undefined)
  assert.equal(extractServerErrorMessage({}), undefined)
})

test("analyzeImage: 2xx error body without choices → readable fallback, never throws", async () => {
  // Prototype-patch pattern from file-upload-sidecar-keep.test.ts — no mock framework.
  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummy = new OpenAI({ baseURL: "http://127.0.0.1:9", apiKey: "ollama" })
  const proto = Object.getPrototypeOf(dummy.chat.completions)
  const original = proto.create
  proto.create = async () => ({
    // LM Studio engine-error shape: no `choices`, `error` as double-encoded string
    error:
      'Engine protocol predict request returned 400: {"error":{"message":"Failed to load image or audio file"}}',
  })
  try {
    const r = await analyzeImage(
      { base64: "Y21zcGFyay1jaG9pY2VsZXNzLXJlZ3Jlc3Npb24=", width: 1053, height: 481, url: "", title: "shot" },
      {
        enabled: true,
        base_url: "http://127.0.0.1:1234",
        api_key: "ollama",
        model_name: "m",
        timeout_ms: 5000,
        max_tokens: 16,
        fallback: "metadata",
        cache_ttl_seconds: 300,
      } as any,
    )
    assert.equal(r.model_used, "none")
    assert.match(r.description, /Failed to load image or audio file/)
    assert.match(r.description, /1053x481px/)
  } finally {
    proto.create = original
  }
})
