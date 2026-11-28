import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as dns from "node:dns"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { effectiveReasoningEffort, isReasoningEffort, modelSpec, modelSuggestions, reasoningSupport, reasoningWireEffort } from "../src/llm/reasoning-effort"
import { OpenAIProvider } from "../src/llm/providers/openai"
import { AnthropicProvider } from "../src/llm/providers/anthropic"
import type { LlmConfig } from "../src/config"

const originalLookup = dns.promises.lookup
beforeEach(() => { dns.promises.lookup = (async (_: string, opts?: { all?: boolean }) => opts?.all ? [{ address: "8.8.8.8", family: 4 }] : { address: "8.8.8.8", family: 4 }) as typeof originalLookup })
afterEach(() => { dns.promises.lookup = originalLookup })
const levels = ["low", "medium", "high", "xhigh"] as const
const message = [{ role: "user" as const, content: "owned fixture" }]
const cfg = (base_url: string, model_name: string, protocol: "openai" | "anthropic", reasoning_effort?: typeof levels[number]): LlmConfig => ({ base_url, model_name, protocol, reasoning_effort, api_key: "owned-test-key", temperature: 0.4, context_window: 128000, max_tokens: 512 })

test("#789 model capability and UI mirror stay exact", () => {
  execFileSync(process.execPath, [path.resolve("scripts/generate-client-contracts.mjs"), "--check"])
  assert.equal(effectiveReasoningEffort(undefined), "medium")
  assert.equal(effectiveReasoningEffort("bogus"), "medium")
  assert.equal(isReasoningEffort("MAX"), false)
  for (const url of ["https://open.bigmodel.cn/api/paas/v4", "https://api.z.ai/api/paas/v4", "https://relay.example/api/coding/paas/v4"]) {
    assert.equal(modelSuggestions("openai", url).includes("glm-5.4"), false)
    assert.equal(reasoningSupport("openai", url, "glm-5.4"), "unsupported")
  }
  assert.ok(modelSuggestions("anthropic", "https://open.bigmodel.cn/api/anthropic").includes("glm-5.4"))
  const qwen = (effort: string) => modelSpec("openai", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen4-max", effort)
  assert.equal(qwen("none")?.output, 131072)
  assert.equal(qwen("xhigh")?.output, 262144)
  for (const model of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"])
    assert.equal(modelSpec("openai", "https://api.openai.com/v1", model)?.responsesForTools, true)
  for (const invalid of ["http://api.deepseek.com/v1", "https://api.deepseek.com.evil/v1", "https://user@api.deepseek.com/v1", "https://api.deepseek.com:444/v1", "https://api.deepseek.com/v1?x=1"]) assert.equal(reasoningSupport("openai", invalid, "deepseek-v4-pro"), "unsupported")
  assert.equal(reasoningSupport("openai", "https://relay.example/v1", "deepseek-v4-pro"), "unsupported")
  assert.equal(reasoningSupport("openai", "https://api.openai.com/v1", "gpt-5.2-evil"), "unsupported")
  assert.equal(reasoningSupport("anthropic", "https://api.anthropic.com", "claude-sonnet-4-5"), "unsupported")
})

test("#789 OpenAI-compatible actual provider stream and complete emit documented per-model effort", async () => {
  for (const level of levels) {
    for (const [url, model, expected] of [["https://api.deepseek.com/v1", "deepseek-v4-flash", level === "low" ? "low" : level === "xhigh" ? "max" : "high"], ["https://api.openai.com/v1", "gpt-5.2", level]] as const) {
      const p = new OpenAIProvider(cfg(url, model, "openai", level))
      const seen: any[] = []
      ;(p as any).client.chat.completions.create = async (body: any) => { seen.push(body); return body.stream ? (async function* () { yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] } })() : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } }
      for await (const _ of p.streamChat({ messages: message, max_tokens: 256 })) {}
      await p.complete({ messages: message, max_tokens: 256 })
      assert.equal(seen.length, 2)
      for (const body of seen) {
        assert.equal(body.reasoning_effort, expected)
        if (model === "gpt-5.2") { assert.equal("temperature" in body, false); assert.equal(body.max_completion_tokens, 256); assert.equal("max_tokens" in body, false) }
        else { assert.equal(body.temperature, 0.4); assert.equal(body.max_tokens, 256) }
      }
    }
  }
  const p = new OpenAIProvider(cfg("https://relay.example/v1", "deepseek-v4-pro", "openai", "xhigh"))
  let wire: any
  ;(p as any).client.chat.completions.create = async (body: any) => { wire = body; return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } }
  await p.complete({ messages: message })
  assert.equal("reasoning_effort" in wire, false)
  assert.equal(wire.temperature, 0.4)
})

test("#789 Anthropic actual provider sends supported effort on stream and complete", async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-7"]) for (const level of levels) {
      const bodies: any[] = []
      globalThis.fetch = (async (_: any, init: any) => { const b = JSON.parse(init.body); bodies.push(b); return b.stream ? new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200 }) : new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 }) }) as typeof fetch
      const p = new AnthropicProvider(cfg("https://api.anthropic.com", model, "anthropic", level))
      for await (const _ of p.streamChat({ messages: message })) {}
      await p.complete({ messages: message })
      const expected = level === "xhigh" && model === "claude-sonnet-4-6" ? "max" : level
      assert.equal(bodies.length, 2)
      for (const body of bodies) assert.deepEqual(body.output_config, { effort: expected })
    }
  } finally { globalThis.fetch = originalFetch }
})

test("#789 unsupported mapping never guesses a wire value", () => {
  for (const level of levels) assert.equal(reasoningWireEffort("unsupported", level), undefined)
})

test("Kimi K3 and non-reasoning GPT-4o use their documented wire limits on both request paths", async () => {
  for (const [url, model, expectedLimit, expectedEffort] of [
    ["https://api.moonshot.cn/v1", "kimi-k3.1-pro", 200000, "max"],
    ["https://api.openai.com/v1", "gpt-4o", 16384, undefined],
  ] as const) {
    const provider = new OpenAIProvider(cfg(url, model, "openai", "xhigh"))
    const bodies: any[] = []
    ;(provider as any).client.chat.completions.create = async (body: any) => {
      bodies.push(body)
      return body.stream ? (async function* () { yield { choices: [{ delta: {}, finish_reason: "stop" }] } })()
        : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }
    }
    for await (const _ of provider.streamChat({ messages: message, max_tokens: 200000 })) {}
    await provider.complete({ messages: message, max_tokens: 200000 })
    assert.equal(bodies.length, 2)
    for (const body of bodies) {
      assert.equal(body.reasoning_effort, expectedEffort)
      assert.equal(body.max_completion_tokens, expectedLimit)
      assert.equal(body.max_tokens, undefined)
      assert.equal(body.temperature, model === "gpt-4o" ? 0.4 : undefined)
    }
  }
})

test("both request paths honor each model's selectable native levels", async (t) => {
  const { effortLevels } = await import("../src/llm/reasoning-effort")
  const cases = [
    ["openai", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen4-max", "none low high xhigh"],
    ["anthropic", "https://dashscope-intl.aliyuncs.com/apps/anthropic", "qwen4-max", "none low high xhigh"],
    ["openai", "https://api.z.ai/api/coding/paas/v4", "glm-5.4", "low high max"],
    ["anthropic", "https://open.bigmodel.cn/api/anthropic", "glm-5.4", "low high max"],
    ["openai", "https://api.openai.com/v1", "gpt-6-luna", "none low medium high xhigh max"],
    ["openai", "https://api.openai.com/v1", "gpt-6.2-sol", "low medium high xhigh max"],
    ["anthropic", "https://api.anthropic.com", "claude-opus-4-7", "low medium high xhigh max"],
    ["openai", "https://api.x.ai/v1", "grok-4.7", "low medium high xhigh"],
    ["anthropic", "http://127.0.0.1:3425", "grok/grok-4.7@500k", "low medium high xhigh"],
    ["openai", "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-4-argon", "low medium high"],
    ["openai", "https://api.moonshot.cn/v1", "kimi-k3.1-pro", "low high max"],
    ["openai", "https://open.bigmodel.cn/api/paas/v4", "glm-5.3-flash", "low high max"],
    ["openai", "https://api.z.ai/api/paas/v4", "glm-5.2", "none high max"],
    ["openai", "https://api.minimax.io/v1", "MiniMax-M3.1-Flash", "low medium high xhigh max"],
    ["anthropic", "https://api.minimaxi.com/anthropic", "MiniMax-M3", "none high"],
    ["openai", "https://api.deepseek.com/v1", "deepseek-flash", "none low high max"],
  ] as const
  const bodies: any[] = []
  t.mock.method(globalThis, "fetch", async (input: any, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    const anthropic = String(input).endsWith("/messages")
    if (body.stream) return new Response(anthropic ? 'data: {"type":"message_stop"}\n\n' : 'data: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } })
    return Response.json(anthropic ? { content: [{ type: "text", text: "ok" }] } : { choices: [{ message: { content: "ok" } }] })
  })
  for (const [protocol, url, model, expected] of cases) {
    const supported = effortLevels[reasoningSupport(protocol, url, model)]
    assert.equal(supported.join(" "), expected, model)
    for (const level of supported) {
      const config = { ...cfg(url, model, protocol), reasoning_effort: level }
      const provider = protocol === "anthropic" ? new AnthropicProvider(config) : new OpenAIProvider(config)
      for await (const _ of provider.streamChat({ messages: message })) {}
      await provider.complete({ messages: message })
      for (const body of bodies.splice(0)) {
        assert.equal(body.model, model)
        if (model === "qwen4-max" && level === "none") {
          if (protocol === "openai") assert.equal(body.enable_thinking, false)
          else assert.deepEqual(body.thinking, { type: "disabled" })
          assert.equal(body.reasoning_effort, undefined)
        } else if (model === "MiniMax-M3") {
          assert.deepEqual(body.thinking, { type: level === "none" ? "disabled" : "adaptive" })
          assert.equal(body.output_config, undefined)
        } else if (protocol === "anthropic") assert.deepEqual(body.output_config, { effort: level })
        else assert.equal(body.reasoning_effort, level)
      }
    }
  }
})
