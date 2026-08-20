// Protocol-aware connection probe (Anthropic P1)

import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import * as dns from "node:dns"
import {
  formatProbeHttpError,
  probeLlmConnection,
  probeNativeVision,
} from "../src/llm/connection-test"

function mockFetch(t: TestContext, impl: (...args: unknown[]) => unknown): void {
  t.mock.method(globalThis, "fetch", impl as (...args: unknown[]) => unknown)
}

/** Probe now DNS-gates names; fixtures use .example hosts that would NXDOMAIN. */
function mockDnsPublic(t: TestContext): void {
  t.mock.method(
    dns.promises,
    "lookup",
    async (_host: string, opts?: { all?: boolean }) => {
      const rec = [{ address: "8.8.8.8", family: 4 as const }]
      if (opts && opts.all) return rec
      return rec[0]
    },
  )
}

test("formatProbeHttpError distinguishes 401 / 404 / 400", () => {
  assert.match(formatProbeHttpError(401, "openai"), /鉴权/)
  assert.match(formatProbeHttpError(404, "anthropic"), /messages/)
  assert.match(formatProbeHttpError(404, "openai"), /OpenAI/)
  assert.match(formatProbeHttpError(400, "anthropic"), /格式/)
})

test("probe openai posts chat/completions with Bearer", async (t) => {
  mockDnsPublic(t)
  let fetchedUrl = ""
  let init: RequestInit | undefined
  mockFetch(t, async (url: unknown, i?: unknown) => {
    fetchedUrl = String(url)
    init = i as RequestInit
    return { ok: true, status: 200 }
  })
  const r = await probeLlmConnection({
    base_url: "https://api.deepseek.com/v1",
    api_key: "sk-test",
    model_name: "deepseek-v4-flash",
    protocol: "openai",
  })
  assert.equal(r.ok, true)
  assert.equal(fetchedUrl, "https://api.deepseek.com/v1/chat/completions")
  const headers = init?.headers as Record<string, string>
  assert.equal(headers["authorization"] || headers["Authorization"], "Bearer sk-test")
  assert.ok((headers["user-agent"] || headers["User-Agent"] || "").includes("cmspark-companion"))
})

test("probe anthropic posts /messages with x-api-key", async (t) => {
  mockDnsPublic(t)
  let fetchedUrl = ""
  let init: RequestInit | undefined
  mockFetch(t, async (url: unknown, i?: unknown) => {
    fetchedUrl = String(url)
    init = i as RequestInit
    return { ok: true, status: 200 }
  })
  const r = await probeLlmConnection({
    base_url: "https://gateway.example/v1",
    api_key: "sk-ant",
    model_name: "claude-sonnet-4-6",
    protocol: "anthropic",
    client_header_profile: "none",
  })
  assert.equal(r.ok, true)
  assert.equal(fetchedUrl, "https://gateway.example/v1/messages")
  const headers = init?.headers as Record<string, string>
  assert.equal(headers["x-api-key"], "sk-ant")
  assert.ok(headers["anthropic-version"])
})

test("probe anthropic + claude_code_compat injects UA on non-first-party", async (t) => {
  mockDnsPublic(t)
  let init: RequestInit | undefined
  mockFetch(t, async (_url: unknown, i?: unknown) => {
    init = i as RequestInit
    return { ok: true, status: 200 }
  })
  const r = await probeLlmConnection({
    base_url: "https://coding-plan.example/v1",
    api_key: "sk-x",
    model_name: "claude-sonnet-4-6",
    protocol: "anthropic",
    client_header_profile: "claude_code_compat",
    claude_code_compat_version: "2.1.220",
  })
  assert.equal(r.ok, true)
  const headers = init?.headers as Record<string, string>
  assert.equal(headers["user-agent"], "claude-cli/2.1.220 (external, cli)")
  assert.equal(headers["x-app"], "cli")
})

test("probe anthropic first-party + compat profile refuses before fetch", async (t) => {
  mockDnsPublic(t)
  let called = false
  mockFetch(t, () => {
    called = true
    throw new Error("must not fetch")
  })
  const r = await probeLlmConnection({
    base_url: "https://api.anthropic.com",
    api_key: "sk-x",
    model_name: "claude-sonnet-4-6",
    protocol: "anthropic",
    client_header_profile: "claude_code_compat",
  })
  assert.equal(r.ok, false)
  assert.equal(called, false)
  assert.match(r.error || "", /官方 Anthropic|兼容头/)
})

test("probe maps 401 to auth hint", async (t) => {
  mockDnsPublic(t)
  mockFetch(t, async () => ({ ok: false, status: 401 }))
  const r = await probeLlmConnection({
    base_url: "https://api.deepseek.com/v1",
    api_key: "sk-bad",
    model_name: "deepseek-v4-flash",
  })
  assert.equal(r.ok, false)
  assert.match(r.error || "", /鉴权/)
})

test("probe empty key fails without fetch", async (t) => {
  let called = false
  mockFetch(t, () => {
    called = true
  })
  const r = await probeLlmConnection({
    base_url: "https://api.deepseek.com/v1",
    api_key: "",
    model_name: "x",
  })
  assert.equal(r.ok, false)
  assert.equal(called, false)
  assert.match(r.error || "", /API Key/)
})

test("probeNativeVision DNS-to-IMDS does not fetch", async (t) => {
  t.mock.method(
    dns.promises,
    "lookup",
    async (_host: string, opts?: { all?: boolean }) => {
      const rec = [{ address: "169.254.169.254", family: 4 as const }]
      if (opts && opts.all) return rec
      return rec[0]
    },
  )
  let called = false
  mockFetch(t, () => {
    called = true
    throw new Error("must not fetch")
  })
  const ok = await probeNativeVision({
    base_url: "https://api.openai.com/v1",
    api_key: "sk-x",
    model_name: "gpt-4o",
  })
  assert.equal(ok, false)
  assert.equal(called, false)
})
