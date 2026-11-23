// M1: config.test success must echo the tested {base_url, model_name} so the
// panel can cache the probe bit under that key (its preflight/destHost then
// route exactly like the companion probe cache). fetch is stubbed — the probe
// itself is covered by llm-endpoint-url/connection-test suites.

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config import.

import test, { before } from "node:test"
import * as assert from "node:assert/strict"

let handleMessage: typeof import("../src/message-router").handleMessage
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir
let lookupNativeVisionProbe: typeof import("../src/llm/native-vision-probe-cache").lookupNativeVisionProbe
let clearNativeVisionProbe: typeof import("../src/llm/native-vision-probe-cache").clearNativeVisionProbe

const TEST_BASE_URL = "http://127.0.0.1:9/v1"
const TEST_MODEL = "my-intranet-vlm"

before(async () => {
  const mr = await import("../src/message-router")
  const cfg = await import("../src/config")
  const cache = await import("../src/llm/native-vision-probe-cache")
  handleMessage = mr.handleMessage
  saveConfig = cfg.saveConfig
  initDataDir = cfg.initDataDir
  lookupNativeVisionProbe = cache.lookupNativeVisionProbe
  clearNativeVisionProbe = cache.clearNativeVisionProbe
  await initDataDir()
  saveConfig({
    llm: {
      base_url: TEST_BASE_URL,
      api_key: "sk-probe-keyed-test",
      model_name: TEST_MODEL,
      protocol: "openai",
      temperature: 0.7,
      context_window: 128000,
    },
  }, { llmKey: true })
})

test("config.test echoes the tested {base_url, model_name} with the probe bit", async () => {
  clearNativeVisionProbe()
  const origFetch = globalThis.fetch
  // Both probes POST chat/completions; HTTP 200 = endpoint accepted the request.
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as any
  try {
    const r: any = await handleMessage({ type: "config.test" } as any, {} as any)
    assert.equal(r.type, "config.testResult")
    assert.equal(r.ok, true)
    assert.equal(r.native_vision, true)
    assert.equal(r.base_url, TEST_BASE_URL, "echo the tested base_url")
    assert.equal(r.model_name, TEST_MODEL, "echo the tested model_name")
    // Companion in-memory cache stays keyed the same way.
    assert.equal(lookupNativeVisionProbe(TEST_BASE_URL, TEST_MODEL), true)
    assert.equal(lookupNativeVisionProbe(TEST_BASE_URL, "other-model"), undefined)
  } finally {
    globalThis.fetch = origFetch
    clearNativeVisionProbe()
  }
})

test("config.test llm_override echoes the override key, not the saved one", async () => {
  clearNativeVisionProbe()
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as any
  try {
    const r: any = await handleMessage(
      {
        type: "config.test",
        llm_override: { base_url: "http://127.0.0.1:8/v1", model_name: "unsaved-ui-model" },
      } as any,
      {} as any,
    )
    assert.equal(r.type, "config.testResult")
    assert.equal(r.ok, true)
    assert.equal(r.base_url, "http://127.0.0.1:8/v1")
    assert.equal(r.model_name, "unsaved-ui-model")
    assert.equal(lookupNativeVisionProbe("http://127.0.0.1:8/v1", "unsaved-ui-model"), true)
    // Saved config was not clobbered by the override probe.
    assert.equal(lookupNativeVisionProbe(TEST_BASE_URL, TEST_MODEL), undefined)
  } finally {
    globalThis.fetch = origFetch
    clearNativeVisionProbe()
  }
})

test("config.test probes the saved vision model only when needed", async () => {
  const visionUrl = "http://127.0.0.1:8/v1"
  const vision = {
    enabled: true, base_url: visionUrl, model_name: "separate-vision", api_key: "sk-vision-test",
    timeout_ms: 30000, max_tokens: 1024, fallback: "metadata" as const, cache_ttl_seconds: 0,
  }
  const originalFetch = globalThis.fetch
  try {
    for (const { mainWorks, acceptsImage, enabled, mode, expectedFallback, protocol = "openai" } of [
      { mainWorks: true, acceptsImage: true, enabled: true, mode: "auto", expectedFallback: false },
      { mainWorks: true, acceptsImage: false, enabled: true, mode: "auto", expectedFallback: true },
      { mainWorks: true, acceptsImage: false, enabled: true, mode: "on", expectedFallback: false },
      { mainWorks: true, acceptsImage: true, enabled: true, mode: "auto", expectedFallback: false, protocol: "anthropic" },
      { mainWorks: true, acceptsImage: false, enabled: true, mode: "auto", expectedFallback: true, protocol: "anthropic" },
      { mainWorks: true, acceptsImage: true, enabled: true, mode: "off", expectedFallback: true },
      { mainWorks: true, acceptsImage: false, enabled: false, mode: "auto", expectedFallback: false },
      { mainWorks: false, acceptsImage: false, enabled: true, mode: "auto", expectedFallback: false },
    ]) {
      saveConfig({ vision: { ...vision, enabled } }, { visionKey: true })
      const requests: string[] = []
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(String(options?.body))
        if (String(url).startsWith(visionUrl)) {
          requests.push("separate vision")
          return Response.json({ choices: [{ message: { content: "A pixel." }, finish_reason: "stop" }] })
        }
        const isImage = Array.isArray(body.messages[0].content)
        if (isImage) {
          assert.equal(body.messages[0].content[1].type, protocol === "anthropic" ? "image" : "image_url")
        }
        requests.push(isImage ? "main image" : "main text")
        return new Response(null, { status: (isImage ? acceptsImage : mainWorks) ? 200 : 400 })
      }
      const result = await handleMessage({
        type: "config.test",
        test_vision_fallback: true,
        llm_override: { native_vision: mode, protocol },
      } as any, {} as any)
      assert.equal(result.ok, mainWorks)
      assert.deepEqual(requests, ["main text", ...(mainWorks ? ["main image"] : []), ...(expectedFallback ? ["separate vision"] : [])])
      assert.deepEqual(result.vision_fallback, expectedFallback ? { ok: true, model: "separate-vision" } : undefined)
    }
  } finally {
    globalThis.fetch = originalFetch
    clearNativeVisionProbe()
  }
})
