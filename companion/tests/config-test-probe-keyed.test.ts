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
  })
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
