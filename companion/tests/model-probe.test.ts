// Tests for the startup model-validity probe (companion/src/server.ts probeChatModel).
//
// The probe warns (never throws) when the configured chat model is not advertised
// by the provider's /models endpoint — catching wrong/renamed/deprecated model ids
// (e.g. DeepSeek retiring deepseek-chat/deepseek-reasoner on 2026-07-24 in favor of
// deepseek-v4-pro / deepseek-v4-flash). It must be non-blocking and survive every
// failure mode (network, auth, malformed body) without crashing startup.
//
// fetch is mocked via the node:test context's t.mock.method, which auto-restores on
// test teardown (pass OR fail) — so an assertion failure mid-test can never leak a
// mocked fetch into later tests.

import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { probeChatModel } from "../src/server"

type ProbeConfig = Parameters<typeof probeChatModel>[0]

function makeConfig(over: Partial<ProbeConfig["llm"]> = {}): ProbeConfig {
  return {
    llm: {
      base_url: "https://api.deepseek.com/v1",
      api_key: "sk-test-key",
      model_name: "deepseek-v4-flash",
      ...over,
    },
  } as ProbeConfig
}

function captureWarn() {
  const events: Array<{ event: string; ctx: Record<string, unknown> }> = []
  return {
    events,
    warn: (event: string, ctx: Record<string, unknown>) => events.push({ event, ctx }),
  }
}

/** Mock globalThis.fetch for this test only; auto-restored on teardown (pass or fail). */
function mockFetch(t: TestContext, impl: (...args: unknown[]) => unknown): void {
  t.mock.method(globalThis, "fetch", impl as (...args: unknown[]) => unknown)
}

test("no api_key → probe skipped entirely (no fetch, no warn)", async (t) => {
  let called = false
  mockFetch(t, () => {
    called = true
    throw new Error("fetch must not be called without a key")
  })
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig({ api_key: "" }), warn)
  assert.equal(called, false, "fetch must not be called")
  assert.equal(events.length, 0)
})

test("configured model present in /models → hits {base_url}/models with Bearer key, no warn", async (t) => {
  let fetchedUrl = ""
  let fetchedInit: RequestInit | undefined
  mockFetch(t, async (url: unknown, init?: unknown) => {
    fetchedUrl = url as string
    fetchedInit = init as RequestInit
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] }),
    }
  })
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig(), warn)
  assert.equal(fetchedUrl, "https://api.deepseek.com/v1/models", "must call {base_url}/models")
  assert.equal(
    (fetchedInit?.headers as Record<string, string>)?.Authorization,
    "Bearer sk-test-key",
    "must send Bearer api_key",
  )
  assert.equal(events.length, 0)
})

test("configured model missing from /models → model_not_listed warning with samples", async (t) => {
  mockFetch(t, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }),
  }))
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig({ model_name: "deepseek-chat" }), warn)
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "startup.model_probe.model_not_listed")
  assert.equal(events[0].ctx.model_name, "deepseek-chat")
  assert.ok(Array.isArray(events[0].ctx.available_sample))
})

test("base_url trailing slash is normalized before appending /models", async (t) => {
  let fetchedUrl = ""
  mockFetch(t, async (url: unknown) => {
    fetchedUrl = url as string
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "deepseek-v4-flash" }] }) }
  })
  const { warn } = captureWarn()
  await probeChatModel(makeConfig({ base_url: "https://api.deepseek.com/v1//" }), warn)
  assert.equal(fetchedUrl, "https://api.deepseek.com/v1/models", "must collapse trailing slashes")
})

test("non-2xx response → http_error warning, no crash", async (t) => {
  mockFetch(t, async () => ({ ok: false, status: 401 }))
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig(), warn)
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "startup.model_probe.http_error")
  assert.equal(events[0].ctx.status, 401)
})

test("fetch rejects (network/timeout) → failed warning, probe does not throw", async (t) => {
  mockFetch(t, async () => {
    throw new Error("ETIMEDOUT")
  })
  const { events, warn } = captureWarn()
  await assert.doesNotReject(() => probeChatModel(makeConfig(), warn))
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "startup.model_probe.failed")
  assert.equal(events[0].ctx.error, "ETIMEDOUT")
})

test("empty/unexpected model list → no false-alarm warning", async (t) => {
  mockFetch(t, async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig(), warn)
  assert.equal(events.length, 0, "an empty/odd payload must not trigger a spurious mismatch")
})

test("non-JSON body → failed warning (res.json throw is caught)", async (t) => {
  mockFetch(t, async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("Unexpected token < in JSON")
    },
  }))
  const { events, warn } = captureWarn()
  await probeChatModel(makeConfig(), warn)
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "startup.model_probe.failed")
})
