import test, { afterEach, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as dns from "node:dns"
import { readFileSync } from "node:fs"
import path from "node:path"
import { effectiveReasoningEffort, isReasoningEffort, reasoningSupport, reasoningWireEffort } from "../src/llm/reasoning-effort"
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
  assert.equal(readFileSync(path.resolve("src/llm/reasoning-effort.ts"), "utf8"), readFileSync(path.resolve("../chrome-extension/src/sidepanel/utils/reasoning-effort.ts"), "utf8"))
  assert.equal(effectiveReasoningEffort(undefined), "medium")
  assert.equal(effectiveReasoningEffort("bogus"), "medium")
  assert.equal(isReasoningEffort("MAX"), false)
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
