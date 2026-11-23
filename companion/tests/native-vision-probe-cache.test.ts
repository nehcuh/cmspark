import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  rememberNativeVisionProbe,
  lookupNativeVisionProbe,
  clearNativeVisionProbe,
} from "../src/llm/native-vision-probe-cache"
import { resolveNativeVision, visionConfigForAnalyze } from "../src/llm/likely-multimodal"
import { analyzeImage } from "../src/llm/vision-pipeline"

test("probe cache hits only the same url+model", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.1.1.1/v1/", "custom-vlm", true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm"), true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1/", "other-model"), undefined)
  assert.equal(lookupNativeVisionProbe("http://10.2.2.2/v1", "custom-vlm"), undefined)
  clearNativeVisionProbe()
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm"), undefined)
})

test("probe cache keeps model name case (no cross-model poisoning)", () => {
  clearNativeVisionProbe()
  // vLLM-style case-sensitive served-model-name: probing "MyModel" must NOT
  // answer a lookup for a different model "mymodel".
  rememberNativeVisionProbe("http://10.1.1.1/v1", "MyModel", true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "MyModel"), true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "mymodel"), undefined)
  clearNativeVisionProbe()
})

test("probe cache normalizes scheme/host case but keeps URL path case", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("HTTP://10.1.1.1:8000/V1/", "m", true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1:8000/V1", "m"), true)
  // A case-sensitive gateway path is a different endpoint.
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1:8000/v1", "m"), undefined)
  clearNativeVisionProbe()
})

test("resolveNativeVision auto uses in-memory probe for unknown model names", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.251.241.12/v1", "my-intranet-vlm", true)
  assert.equal(
    resolveNativeVision({
      modelName: "my-intranet-vlm",
      baseUrl: "http://10.251.241.12/v1",
      mode: "auto",
    }),
    true,
  )
  assert.equal(
    resolveNativeVision({
      modelName: "my-intranet-vlm",
      baseUrl: "https://api.deepseek.com/v1",
      mode: "auto",
    }),
    false,
  )
  clearNativeVisionProbe()
})

test("visionConfigForAnalyze uses probe cache not disk flags", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm", true)
  const cfg = visionConfigForAnalyze(
    {
      base_url: "http://10.1.1.1/v1",
      api_key: "sk-x",
      model_name: "custom-vlm",
      protocol: "openai",
    },
    { enabled: true, base_url: "http://127.0.0.1:11434/v1", api_key: "ollama", model_name: "llava:7b" },
  )
  assert.ok(cfg)
  assert.equal(cfg!.model_name, "custom-vlm")
  clearNativeVisionProbe()
})

test("an Anthropic main model handles screenshots through its actual provider", async () => {
  const originalFetch = globalThis.fetch
  let request: any
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(String(options?.body)), headers: options?.headers }
    return Response.json({ content: [{ type: "text", text: "A pixel" }], stop_reason: "end_turn" })
  }
  try {
    const config = visionConfigForAnalyze({
      base_url: "http://127.0.0.1:9/v1", api_key: "fixture-key", model_name: "claude-test",
      protocol: "anthropic", native_vision: "on", anthropic_version: "2023-06-01",
    })
    assert.ok(config)
    const result = await analyzeImage({
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      width: 1, height: 1, title: "test", url: "",
    }, config as any)
    assert.equal(result.description, "A pixel")
    assert.equal(request.url, "http://127.0.0.1:9/v1/messages")
    assert.equal(request.body.model, "claude-test")
    assert.equal(request.body.messages[0].content[0].type, "image")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a negative image probe overrides the model-name heuristic in auto mode", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://127.0.0.1:9/v1", "gpt-4o", false)
  const opts = { baseUrl: "http://127.0.0.1:9/v1", modelName: "gpt-4o" }
  assert.equal(resolveNativeVision(opts), false)
  assert.equal(resolveNativeVision({ ...opts, mode: "on" }), true)
  clearNativeVisionProbe()
})

test("config.test remembers probe in memory and does not saveConfig the bit", () => {
  const src = readFileSync(join(process.cwd(), "src/message-router/handlers/config.ts"), "utf8")
  assert.match(src, /rememberNativeVisionProbe/)
  assert.match(src, /delete normalized\.llm\.native_vision_detected/)
  assert.equal(/saveConfig\(\s*\{\s*llm:[\s\S]{0,80}native_vision_detected/.test(src), false)
})
