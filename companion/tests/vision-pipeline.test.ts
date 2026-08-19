// Vision pipeline response guards (LM Studio non-standard error bodies) +
// base_url /v1 normalization. Regression: a bare host:port vision base_url
// crashed on `choices[0]` with "Cannot read properties of undefined".

import test from "node:test"
import assert from "node:assert/strict"

import {
  analyzeImage,
  extractServerErrorMessage,
  formatVisionFallbackDims,
  formatVisionFallbackSubject,
  normalizeVisionBaseUrl,
  visionImageDataUrl,
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
      {
        // Real PNG so visionImageDataUrl does not fail-closed before the mock.
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        width: 1053,
        height: 481,
        url: "",
        title: "shot",
      },
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

test("analyzeImage: description cache is scoped to base_url + model_name", async () => {
  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummy = new OpenAI({ baseURL: "http://127.0.0.1:9", apiKey: "ollama" })
  const proto = Object.getPrototypeOf(dummy.chat.completions)
  const original = proto.create
  proto.create = async (body: any) => ({
    choices: [{ message: { content: `desc-from-${body.model}` } }],
  })
  // Distinct image so this test never collides with other cache entries.
  const png = Buffer.concat([
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
    Buffer.from("cache-scope-probe"),
  ])
  const img = { base64: png.toString("base64"), width: 1, height: 1, url: "", title: "p" }
  const baseCfg = {
    enabled: true,
    base_url: "http://127.0.0.1:1234",
    api_key: "ollama",
    model_name: "model-a",
    timeout_ms: 5000,
    max_tokens: 16,
    fallback: "metadata",
    cache_ttl_seconds: 300,
  } as any
  try {
    const r1 = await analyzeImage(img, baseCfg)
    assert.equal(r1.description, "desc-from-model-a")
    assert.equal(r1.cached, false)
    // Same image, different model → must NOT hit model-a's cached description.
    const r2 = await analyzeImage(img, { ...baseCfg, model_name: "model-b" })
    assert.equal(r2.description, "desc-from-model-b")
    assert.equal(r2.cached, false)
    // Same model + endpoint → cache hit, model_used names the producer.
    const r3 = await analyzeImage(img, baseCfg)
    assert.equal(r3.description, "desc-from-model-a")
    assert.equal(r3.cached, true)
    assert.equal(r3.model_used, "model-a")
    // Same model on a different endpoint → separate entry.
    const r4 = await analyzeImage(img, { ...baseCfg, base_url: "http://127.0.0.1:1235" })
    assert.equal(r4.cached, false)
    assert.equal(r4.description, "desc-from-model-a")
  } finally {
    proto.create = original
  }
})

test("formatVisionFallbackDims: omit NxNpx when width/height unknown (no 0x0 lie)", () => {
  assert.equal(formatVisionFallbackDims(1053, 481), ", 1053x481px")
  assert.equal(formatVisionFallbackDims(0, 0), "")
  assert.equal(formatVisionFallbackDims(320, 0), "")
  assert.equal(formatVisionFallbackDims(undefined, 200), "")
})

test("formatVisionFallbackSubject: omit empty (url) and 0x0px", () => {
  assert.equal(formatVisionFallbackSubject("shot", "https://ex", 10, 8), 'Screenshot of "shot" (https://ex), 10x8px')
  assert.equal(formatVisionFallbackSubject("cat.gif", "", 0, 0), 'Screenshot of "cat.gif"')
})

test("visionImageDataUrl: sniff real raster mime; refuse svg/garbage instead of wrapping as jpeg", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00])
  const webp = Buffer.from("RIFF\x0c\x00\x00\x00WEBPVP8L", "binary")
  assert.match(visionImageDataUrl({ base64: png.toString("base64") })!, /^data:image\/png;base64,/)
  assert.match(visionImageDataUrl({ base64: gif.toString("base64") })!, /^data:image\/gif;base64,/)
  assert.match(visionImageDataUrl({ base64: webp.toString("base64") })!, /^data:image\/webp;base64,/)
  assert.equal(visionImageDataUrl({ base64: "not-a-raster" }), null)
})

test("analyzeImage: data URL mime follows sniffed bytes (PNG is not labeled jpeg)", async () => {
  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummy = new OpenAI({ baseURL: "http://127.0.0.1:9", apiKey: "ollama" })
  const proto = Object.getPrototypeOf(dummy.chat.completions)
  const original = proto.create
  let seenUrl = ""
  proto.create = async (body: any) => {
    const part = body?.messages?.[0]?.content?.find((c: any) => c.type === "image_url")
    seenUrl = part?.image_url?.url || ""
    return { choices: [{ message: { content: "ok" } }] }
  }
  const png = Buffer.concat([
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
    Buffer.from("mime-probe"),
  ])
  try {
    await analyzeImage(
      { base64: png.toString("base64"), width: 1, height: 1, url: "", title: "p" },
      {
        enabled: true,
        base_url: "http://127.0.0.1:1234",
        api_key: "ollama",
        model_name: "m",
        timeout_ms: 5000,
        max_tokens: 16,
        fallback: "metadata",
        cache_ttl_seconds: 0,
      } as any,
    )
    assert.match(seenUrl, /^data:image\/png;base64,/)
  } finally {
    proto.create = original
  }
})
