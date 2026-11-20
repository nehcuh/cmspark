import test from "node:test"
import assert from "node:assert/strict"
import { chatOutputBudget, isChatOutputLimit } from "../src/llm/output-budget"
import { classifyGenerationLimit } from "../src/llm/overflow"
import { applyContextBudget } from "../src/llm/context-budget"
import type { CanonicalChatMessage } from "../src/llm/provider"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as dns from "node:dns"
import { OpenAIProvider } from "../src/llm/providers/openai"
import { AnthropicProvider } from "../src/llm/providers/anthropic"
import { isContextOverflowError } from "../src/llm/overflow"

const known = { protocol: "openai" as const, base_url: "https://api.openai.com/v1", model_name: "gpt-5.2", reasoning_effort: "high" as const }
const deepseek = { ...known, base_url: "https://api.deepseek.com/v1", model_name: "deepseek-v4-pro" }
const claude = { ...known, protocol: "anthropic" as const, base_url: "https://api.anthropic.com", model_name: "claude-sonnet-4-6" }

test("chat budget selects by exact provider, protocol, model, and current effort", () => {
  assert.deepEqual(chatOutputBudget(512000, known), { contextWindow: 400000, preferred: 64000, ceiling: 128000, documented: true })
  assert.equal(chatOutputBudget(512000, deepseek).preferred, 65536)
  assert.equal(chatOutputBudget(512000, { ...deepseek, reasoning_effort: "xhigh" }).preferred, 131072)
  assert.equal(chatOutputBudget(512000, { ...known, reasoning_effort: "low" }).preferred, 32768)
  assert.equal(chatOutputBudget(512000, { ...claude, max_tokens: 393216 }).ceiling, 128000)
  assert.equal(chatOutputBudget(512000, { ...known, max_tokens: 32768 }).ceiling, 32768)
  assert.equal(chatOutputBudget(16000, known).preferred, 8000)
  for (const config of [
    { ...known, base_url: "https://proxy.example/v1" },
    { ...known, model_name: "gpt-5.2-custom" },
    { ...known, protocol: "anthropic" as const },
    { ...known, base_url: "https://api.openai.com/v1?auth=fixture" },
  ]) {
    assert.deepEqual(chatOutputBudget(512000, { ...config, max_tokens: 200000 }), { contextWindow: 512000, preferred: 32768, ceiling: 32768, documented: false })
  }
  assert.equal(chatOutputBudget(512000, { ...known, max_tokens: 0 }).preferred, 64000)
  assert.equal(chatOutputBudget(512000, { ...known, max_tokens: -1 }).preferred, 64000)
})

test("editable budget accepts auto or bounded whole tokens", () => {
  for (const value of [0, 1, 32768, 393216]) assert.equal(isChatOutputLimit(value), true)
  for (const value of [null, "", "32768", 0.5, -1, Infinity, NaN, 393217]) assert.equal(isChatOutputLimit(value), false)
})

test("only precise stops or reported usage reaching the sent limit claim an output budget stop", () => {
  assert.equal(classifyGenerationLimit("max_tokens"), "output_budget")
  assert.equal(classifyGenerationLimit("max_output_tokens"), "output_budget")
  assert.equal(classifyGenerationLimit("model_context_window_exceeded", { sentTokens: 64, completionTokens: 64 }), "context_window")
  assert.equal(classifyGenerationLimit("length", { officialOpenAI: true }), "output_budget")
  assert.equal(classifyGenerationLimit("length", { sentTokens: 64, completionTokens: 64 }), "output_budget")
  assert.equal(classifyGenerationLimit("length", { sentTokens: 64, completionTokens: 12 }), "length")
  assert.equal(classifyGenerationLimit("stop"), undefined)
  assert.equal(isContextOverflowError("HTTP 429: tokens per minute quota / token limit"), false)
  assert.equal(isContextOverflowError("model_context_window_exceeded"), true)
})

test("automatic compaction accounts for a documented model's reserved output", () => {
  const messages: CanonicalChatMessage[] = []
  for (let i = 0; i < 6; i++) {
    messages.push({ role: "user", content: "u".repeat(12000) }, { role: "assistant", content: "a".repeat(12000) })
  }
  assert.equal(applyContextBudget(messages, 48000, []).compacted, false)
  const reserved = applyContextBudget(messages, 48000, [], { outputTokens: 20000 })
  assert.equal(reserved.compacted, true)
  assert.ok(reserved.tokensAfter < reserved.tokensBefore)
})

test("budget and wire semantics survive actual provider parsers with in-memory HTTP", async (t) => {
  t.mock.method(dns.promises, "lookup", async (_: string, opts?: { all?: boolean }) =>
    opts?.all ? [{ address: "8.8.8.8", family: 4 }] : { address: "8.8.8.8", family: 4 })
  const requests: Array<Record<string, unknown>> = []
  const events = (frames: unknown[]) => frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("")
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    assert.ok(url.protocol === "https:")
    const request = JSON.parse(input instanceof Request ? await input.text() : String(init?.body))
    requests.push(request)
    if (url.hostname === "api.openai.com") {
      assert.equal(url.pathname, "/v1/chat/completions")
      const frames = [
        { choices: [{ delta: { content: "partial" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 64000, total_tokens: 64012 } },
      ]
      return new Response(events(frames) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })
    }
    assert.equal(url.hostname, "api.anthropic.com")
    assert.equal(url.pathname, "/v1/messages")
    return new Response(events([
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      { type: "message_delta", delta: { stop_reason: "model_context_window_exceeded" }, usage: { output_tokens: 64001 } },
      { type: "message_stop" },
    ]), { headers: { "Content-Type": "text/event-stream" } })
  })
  const config = { api_key: "fixture-only", temperature: 0.4, context_window: 512000 }
  const messages: CanonicalChatMessage[] = [{ role: "user", content: "fixture" }]
  const openai = new OpenAIProvider({ ...known, ...config })
  const openaiEvents = []
  for await (const ev of openai.streamChat({ messages, max_tokens: 64000 })) openaiEvents.push(ev)
  assert.deepEqual(openaiEvents[0], { type: "token", text: "partial" })
  assert.deepEqual(openaiEvents.at(-1), { type: "done", finish_reason: "length" })
  assert.equal(requests[0].reasoning_effort, "high")
  assert.equal(requests[0].max_completion_tokens, 64000)
  assert.equal("max_tokens" in requests[0], false)

  const opus = new AnthropicProvider({ ...claude, ...config, model_name: "claude-opus-4-7" })
  const anthropicEvents = []
  for await (const ev of opus.streamChat({ messages, max_tokens: 128000 })) anthropicEvents.push(ev)
  assert.deepEqual(anthropicEvents[0], { type: "token", text: "partial" })
  assert.deepEqual(anthropicEvents.at(-1), { type: "done", finish_reason: "model_context_window_exceeded" })
  assert.equal(requests[1].max_tokens, 128000)
  assert.deepEqual(requests[1].output_config, { effort: "high" })
  assert.equal("temperature" in requests[1], false)
})

test("settings get normalizes legacy numeric budgets to the same explicit runtime setting", async (t) => {
  const { getConfig, clearConfigCache } = await import("../src/config")
  const { handleConfigFamily } = await import("../src/message-router/handlers/config")
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "cmspark-872-legacy-config-"))
  const originalConfigDir = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = configDir
  t.after(async () => {
    if (originalConfigDir === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = originalConfigDir
    clearConfigCache()
    await fs.rm(configDir, { recursive: true, force: true })
  })
  for (const [saved, editable, effective] of [[500000, 393216, 128000], [1000.5, 1000, 1000]]) {
    await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({
      llm: { ...known, max_tokens: saved },
    }))
    clearConfigCache()
    assert.equal((await handleConfigFamily("config.get", {})).config.llm.max_tokens, editable)
    assert.equal(chatOutputBudget(500000, getConfig().llm).preferred, effective)
  }
})

test("settings router persists an explicit budget and resets it to automatic", async () => {
  const { initDataDir, getConfig, clearConfigCache } = await import("../src/config")
  const { handleConfigFamily } = await import("../src/message-router/handlers/config")
  await initDataDir()
  const baseline = await handleConfigFamily("config.get", {})
  assert.equal(baseline.config.llm.max_tokens, 0)
  const explicit = await handleConfigFamily("config.set", {
    id: "settings-save:owned-budget", config_revision: baseline.config_revision, config: { max_tokens: 64000 },
  })
  assert.equal(explicit.id, "settings-save:owned-budget")
  assert.equal(explicit.config.llm.max_tokens, 64000)
  clearConfigCache()
  assert.equal(getConfig().llm.max_tokens, 64000)
  assert.equal((await handleConfigFamily("config.set", { config: { max_tokens: -1 } })).error, "INVALID_CHAT_OUTPUT_LIMIT")
  const automatic = await handleConfigFamily("config.set", { config: { max_tokens: 0 } })
  assert.equal(automatic.config.llm.max_tokens, 0)
  assert.equal(automatic.config.vision.max_tokens, baseline.config.vision.max_tokens)
})
