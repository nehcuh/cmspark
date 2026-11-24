import assert from "node:assert/strict"
import * as dns from "node:dns"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { LlmConfig } from "../src/config"

test("chat sends per-thread cache affinity only on supported destination/protocol pairs", async t => {
  const dataDir = mkdtempSync(join(tmpdir(), "cmspark-cache-affinity-"))
  const prev = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dataDir
  t.after(() => {
    if (prev === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = prev
    rmSync(dataDir, { recursive: true, force: true })
  })
  const { initDataDir } = await import("../src/config")
  await initDataDir()
  const { chatCreate } = await import("../src/llm/adapter")
  const { SkillEngine } = await import("../src/skills/skill-engine")
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const { createProvider } = await import("../src/llm/provider")
  const threadManager = new ThreadManager()
  const first = threadManager.create("first")
  const second = threadManager.create("second")
  const skillEngine = new SkillEngine()
  skillEngine.bindThreadManager(threadManager)

  t.mock.method(dns.promises, "lookup", async (_: string, opts?: { all?: boolean }) =>
    opts?.all ? [{ address: "8.8.8.8", family: 4 }] : { address: "8.8.8.8", family: 4 })
  const requests: Array<{ body: Record<string, unknown>; headers: Headers }> = []
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const body = JSON.parse(await req.text())
    requests.push({ body, headers: req.headers })
    const messagesAPI = new URL(req.url).pathname.endsWith("/messages")
    if (body.stream === false) return Response.json({ content: [{ type: "text", text: "OK" }] })
    const frames = messagesAPI
      ? [{ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }]
      : [{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }]
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    })
  })
  const magpie: LlmConfig = { base_url: "http://127.0.0.1:3425/v1", model_name: "grok/grok-4.7",
    protocol: "openai", api_key: "fixture", temperature: 0, context_window: 128000 }
  async function chat(threadId: string, config: LlmConfig) {
    const before = requests.length
    await chatCreate({
      threadId, config, threadManager, skillEngine, message: "Hello", skillIds: [],
      historyStore: { record: () => 0 } as any, sendToExtension() {},
      executeTool: async () => assert.fail("No tool call expected"),
    })
    assert.equal(requests.length, before + 1)
    return requests[before]
  }
  const initial = await chat(first.id, magpie)
  const key = initial.body.prompt_cache_key
  assert.match(String(key), /^[a-f0-9]{64}$/)
  assert.notEqual(key, first.id)
  assert.equal((await chat(first.id, magpie)).body.prompt_cache_key, key)
  assert.notEqual((await chat(second.id, magpie)).body.prompt_cache_key, key)
  assert.equal(initial.headers.has("x-session-affinity"), false)

  const grok = await chat(first.id, { ...magpie, base_url: "https://api.x.ai/v1", model_name: "grok-4.7" })
  assert.equal(grok.headers.get("x-grok-conv-id"), key)
  const relay = await chat(first.id, { ...magpie, base_url: "https://relay.example/v1" })
  assert.equal(relay.body.prompt_cache_key, undefined)
  assert.equal(relay.headers.has("x-grok-conv-id"), false)

  const claude: LlmConfig = { ...magpie, base_url: "https://api.anthropic.com/v1", model_name: "claude-sonnet-4-6", protocol: "anthropic" }
  assert.deepEqual((await chat(first.id, claude)).body.cache_control, { type: "ephemeral" })
  const viaMessages = await chat(first.id, { ...magpie, protocol: "anthropic" })
  assert.equal(viaMessages.body.cache_control, undefined)
  assert.equal(viaMessages.body.prompt_cache_key, undefined)
  assert.equal(viaMessages.headers.has("x-session-affinity"), false)

  await createProvider(claude).complete({ messages: [{ role: "user", content: "Title" }] })
  assert.equal(requests.at(-1)?.body.cache_control, undefined)
})
