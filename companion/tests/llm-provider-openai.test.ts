/**
 * OpenAI provider wire-shape tests.
 * The internal tool-message `name` (fail-closed shrink labeling) must never
 * reach the OpenAI wire — strict gateways 400 on unknown fields.
 *
 * Mock seam: the provider instance's client.chat.completions.create — the
 * openai SDK (node-fetch shim) bypasses globalThis.fetch, and the create()
 * params are exactly what the SDK serializes into the request body.
 */

import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as dns from "node:dns"
import type { LlmConfig } from "../src/config"
import type { CanonicalChatMessage, CanonicalStreamEvent } from "../src/llm/provider"
import { OpenAIProvider } from "../src/llm/providers/openai"

const origDnsLookup = dns.promises.lookup
beforeEach(() => {
  dns.promises.lookup = (async (_host: string, opts?: { all?: boolean }) => {
    const rec = [{ address: "8.8.8.8", family: 4 as const }]
    if (opts && opts.all) return rec
    return rec[0]
  }) as unknown as typeof origDnsLookup
})
afterEach(() => {
  dns.promises.lookup = origDnsLookup
})

function baseLlm(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    base_url: "https://relay.example.com/v1",
    api_key: "test-key",
    model_name: "gpt-test",
    temperature: 0.2,
    context_window: 128000,
    protocol: "openai",
    ...over,
  }
}

const toolThread: CanonicalChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "go" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "evaluate", arguments: "{}" },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_1",
    // internal-only shrink label — must not leak onto the wire
    name: "evaluate",
    content: "[evaluate: len=12]",
  },
]

function captureCreate(provider: OpenAIProvider, impl: (params: any) => unknown): any[] {
  const captured: any[] = []
  const client = (provider as unknown as { client: any }).client
  client.chat.completions.create = async (params: any) => {
    captured.push(params)
    return impl(params)
  }
  return captured
}

test("streamChat strips internal name from tool messages on the wire", async () => {
  const provider = new OpenAIProvider(baseLlm())
  const captured = captureCreate(provider, async function* () {
    yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
  })

  const events: CanonicalStreamEvent[] = []
  for await (const e of provider.streamChat({ messages: toolThread })) events.push(e)

  assert.equal(captured.length, 1)
  const wireTool = captured[0].messages.find((m: any) => m.role === "tool")
  assert.ok(wireTool, "tool message present")
  assert.equal("name" in wireTool, false, "internal name must not reach the wire")
  assert.equal(wireTool.tool_call_id, "call_1")
  assert.equal(wireTool.content, "[evaluate: len=12]")
  assert.deepEqual(Object.keys(wireTool).sort(), ["content", "role", "tool_call_id"])
})

test("complete strips internal name from tool messages on the wire", async () => {
  const provider = new OpenAIProvider(baseLlm())
  const captured = captureCreate(provider, () => ({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  }))

  const result = await provider.complete({ messages: toolThread })
  assert.equal(result.content, "ok")

  assert.equal(captured.length, 1)
  const wireTool = captured[0].messages.find((m: any) => m.role === "tool")
  assert.ok(wireTool, "tool message present")
  assert.equal("name" in wireTool, false, "internal name must not reach the wire")
  assert.equal(wireTool.tool_call_id, "call_1")
})

test("complete honors params.max_tokens and falls back to config max_tokens", async () => {
  const provider = new OpenAIProvider(baseLlm({ max_tokens: 32768 }))
  const captured = captureCreate(provider, () => ({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  }))

  await provider.complete({ messages: [{ role: "user", content: "hi" }], max_tokens: 512 })
  assert.equal(captured[0].max_tokens, 512, "explicit params.max_tokens wins")

  await provider.complete({ messages: [{ role: "user", content: "hi" }] })
  assert.equal(captured[1].max_tokens, 32768, "falls back to config.llm.max_tokens")
})

test("complete sends no cap when neither params nor config sets max_tokens", async () => {
  const provider = new OpenAIProvider(baseLlm())
  const captured = captureCreate(provider, () => ({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  }))

  await provider.complete({ messages: [{ role: "user", content: "hi" }] })
  assert.equal("max_tokens" in captured[0], false)
})

test("streamChat passes through messages without internal-only fields unchanged", async () => {
  const provider = new OpenAIProvider(baseLlm())
  const plain: CanonicalChatMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ]
  const captured = captureCreate(provider, async function* () {
    yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
  })

  for await (const _e of provider.streamChat({ messages: plain })) {
    /* drain */
  }

  assert.deepEqual(captured[0].messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ])
})
