import "./helpers/require-isolated-config-825"
import test from "node:test"
import assert from "node:assert/strict"
import { chatCreate } from "../src/llm/adapter"
import { initDataDir, type LlmConfig } from "../src/config"
import { HistoryStore } from "../src/history/store"
import { ThreadManager } from "../src/threads/thread-manager"
import { SkillEngine } from "../src/skills/skill-engine"
import { streamChatWithRecovery } from "../src/llm/reasoning-recovery"
import type { CanonicalStreamEvent, LlmProvider, StreamChatParams } from "../src/llm/provider"

const config: LlmConfig = {
  protocol: "anthropic", base_url: "http://127.0.0.1:3425", model_name: "grok/grok-4.7@500k",
  api_key: "fixture", context_window: 500000, temperature: 0.2, max_tokens: 32768, reasoning_effort: "high",
}
const think = (thinking: string) => ({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } })
const token = (text: string) => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text } })
const end = (stop_reason: string) => ({ type: "message_delta", delta: { stop_reason }, usage: { output_tokens: 32768 } })

test("chat completions preserve prefix-shaped deltas and append only the suffix of full snapshots", async t => {
  const { OpenAIProvider } = await import("../src/llm/providers/openai")
  const provider = new OpenAIProvider({ ...config, protocol: "openai" })
  const pieces = ["I think ", "I think that ", "I think that means "]
  for (const field of ["delta", "message"]) {
    const expected = field === "delta" ? pieces.join("") : "改写"
    const choices = [...pieces.map(s => ({ [field]: { reasoning_content: s } })),
      { message: { reasoning_content: expected }, delta: { content: "done" }, finish_reason: "stop" }]
    const mock = t.mock.method((provider as any).client.chat.completions, "create", async function* () {
      for (const choice of choices) yield { choices: [choice] }
    })
    try {
      let reasoning = ""
      for await (const ev of provider.streamChat({messages: [{role: "user", content: "fixture"}]})) {
        if (ev.type === "reasoning") reasoning = ev.replace ? ev.text : reasoning + ev.text
      }
      assert.equal(reasoning, expected)
    } finally { mock.mock.restore() }
  }
})

test("reasoning-only exhaustion through chatCreate retries once, with clean history and unchanged cap", async t => {
  await initDataDir()
  for (const succeeds of [true, false]) {
    const tm = new ThreadManager()
    const thread = tm.create("owned reasoning fixture")
    const engine = new SkillEngine()
    engine.bindThreadManager(tm)
    const calls: any[] = []
    const sent: any[] = []
    const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const frames = calls.length === 2 && succeeds ? [token("final answer"), end("end_turn")]
        : [think("failed"), think("failed trace"), think("failed trace fragment"), end("max_tokens")]
      return new Response(frames.map(f => "data: " + JSON.stringify(f) + "\n\n").join(""))
    })
    try {
      await chatCreate({ threadId: thread.id, message: "fixture question", skillIds: [], knowledgeIds: [],
        config, threadManager: tm, skillEngine: engine, historyStore: new HistoryStore(),
        executeTool: async () => { throw Error("unexpected tool") }, sendToExtension: f => sent.push(f) })
      assert.equal(calls.length, 2)
      assert.deepEqual(calls.map(b => b.output_config.effort), ["high", "medium"])
      assert.deepEqual(calls.map(b => b.max_tokens), [32768, 32768])
      assert.deepEqual(calls[0].messages, calls[1].messages)
      assert.notEqual(calls[0].system, calls[1].system)
      assert.equal(sent.filter(f => f.type === "chat.reasoning" && f.retrying).length, 1)
      assert.ok(sent.some(f => f.type === "chat.reasoning" && f.content === "failedfailed tracefailed trace fragment"))
      const assistants = tm.getMessages(thread.id).filter(m => m.role === "assistant")
      assert.deepEqual(assistants.map(m => m.content), succeeds ? ["final answer"] : [])
      assert.ok(assistants.every(m => !m.reasoning_content))
      assert.equal(sent.some(f => f.type === "chat.error"), !succeeds)
    } finally { mock.mock.restore() }
  }
})

test("repeated reasoning cancels upstream and retains completed tool results on retry", async () => {
  const calls: StreamChatParams[] = []
  let readPastLoop = false
  const provider: LlmProvider = {
    async *streamChat(args) {
      calls.push(args)
      if (calls.length === 1) {
        yield { type: "reasoning", text: "same sentence again. ".repeat(520) }
        readPastLoop = true
      } else {
        yield { type: "token", text: "answer" }
        yield { type: "done", finish_reason: "stop" }
      }
    }, complete: async () => { throw Error("unexpected") },
  }
  const input: StreamChatParams = { messages: [{ role: "assistant", tool_calls: [{ id: "1", type: "function", function: { name: "fixture", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", content: "completed" }] }
  const events = []
  for await (const event of streamChatWithRecovery(provider, input, config)) events.push(event)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].signal?.aborted, true)
  assert.equal(readPastLoop, false)
  assert.deepEqual(calls[1].messages.slice(1), input.messages)
  assert.deepEqual(events.map(e => e.type), ["reasoning_reset", "token", "done"])
})

test("partial answers, context overflow, incomplete tools and user cancellation retain their original handling", async () => {
  for (const [first, reason] of [
    [{ type: "token", text: "partial" }, "length"],
    [{ type: "tool_call_delta", index: 0, name: "read" }, "max_tokens"],
    [{ type: "token", text: "partial" }, "model_context_window_exceeded"],
  ] as const) {
    let attempts = 0
    const provider: LlmProvider = { async *streamChat() { attempts++; yield first; yield { type: "done", finish_reason: reason } }, complete: async () => ({ content: "" }) }
    const events: CanonicalStreamEvent[] = []
    for await (const e of streamChatWithRecovery(provider, { messages: [] }, config)) if (e.type !== "reasoning_reset") events.push(e)
    assert.equal(attempts, 1)
    assert.equal(events.at(-1)?.type, "done")
  }
  const cancel = new AbortController()
  let attempts = 0
  const provider: LlmProvider = { async *streamChat() {
    attempts++; yield { type: "reasoning", text: "trace" }; cancel.abort(); yield { type: "done", finish_reason: "max_tokens" }
  }, complete: async () => ({ content: "" }) }
  await assert.rejects(async () => { for await (const _ of streamChatWithRecovery(provider, { messages: [], signal: cancel.signal }, config)) {} }, { name: "AbortError" })
  assert.equal(attempts, 1)
})

test("Claude tool follow-up replays signed thinking and redacted blocks only from its completed live step", async () => {
  const { parseAnthropicSseStream } = await import("../src/llm/providers/anthropic")
  const { liveAnthropicBlocks, convertMessagesToAnthropic } = await import("../src/llm/providers/anthropic-convert")
  const frames = [
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    think("synthetic reasoning"),
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque" } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call", name: "read", input: {} } },
    end("tool_use"),
  ]
  const bytes = new Response(frames.map(f => "data: " + JSON.stringify(f) + "\n\n").join("")).body!
  let done
  for await (const ev of parseAnthropicSseStream(bytes)) if (ev.type === "done") done = ev
  assert.ok(done?.liveBlocks)
  const msg = { role: "assistant" as const, tool_calls: [{ type: "function" as const, id: "call", function: { name: "read", arguments: "{}" } }],
    [liveAnthropicBlocks]: done.liveBlocks }
  assert.deepEqual(convertMessagesToAnthropic([msg]).messages[0].content, [
    { type: "thinking", thinking: "synthetic reasoning", signature: "signed" }, { type: "redacted_thinking", data: "opaque" },
    { type: "tool_use", id: "call", name: "read", input: {} },
  ])
  assert.ok(!JSON.stringify(msg).includes("signed"))
})

test("GPT-6 uses Responses with tools, preserves opaque items, and recovers from hidden reasoning", async t => {
  const { OpenAIProvider } = await import("../src/llm/providers/openai")
  const { liveResponseItems } = await import("../src/llm/providers/openai-responses")
  const dns = await import("node:dns")
  t.mock.method(dns.promises, "lookup", async () => [{ address: "8.8.8.8", family: 4 }])
  const cfg: LlmConfig = { ...config, protocol: "openai", base_url: "https://api.openai.com/v1", model_name: "gpt-6.2-sol" }
  const bodies: any[] = []
  const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] }
  const fn = { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", arguments: "{}" }
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses")
    bodies.push(JSON.parse(String(init.body)))
    const incomplete = bodies.length === 1
    const frames = [{ type: incomplete ? "response.incomplete" : "response.completed",
      response: { status: incomplete ? "incomplete" : "completed", incomplete_details: incomplete ? { reason: "max_output_tokens" } : undefined,
        output: incomplete ? [] : [reasoning, fn], usage: { input_tokens: 30, output_tokens: 512, total_tokens: 542, output_tokens_details: { reasoning_tokens: 510 } } } }]
    return new Response(frames.map(f => "data: " + JSON.stringify(f) + "\n\n").join(""), { headers: { "Content-Type": "text/event-stream" } })
  })
  const provider = new OpenAIProvider(cfg)
  const params: StreamChatParams = { messages: [{ role: "user", content: "read fixture" }], tools: [{
    type: "function", function: { name: "read", description: "fixture", parameters: { type: "object" } },
  }], max_tokens: 512 }
  let done
  const events = []
  for await (const ev of streamChatWithRecovery(provider, params, cfg)) {
    events.push(ev.type)
    if (ev.type === "done") done = ev
  }
  assert.ok(done?.responseItems)
  assert.ok(events.includes("tool_call_delta"))
  assert.deepEqual(bodies.map(b => b.reasoning.effort), ["high", "medium"])
  assert.ok(bodies.every(b => b.store === false && b.max_output_tokens === 512 && b.tools[0].strict === false))
  const messages: StreamChatParams["messages"] = [...params.messages, { role: "assistant", [liveResponseItems]: done.responseItems },
    { role: "tool", tool_call_id: "call_1", content: "result" }]
  for await (const _ of provider.streamChat({ ...params, messages })) {}
  assert.deepEqual(bodies[2].input.slice(1), [reasoning, fn, { type: "function_call_output", call_id: "call_1", output: "result" }])
})

test("an empty success after a reasoning-only limit is terminal", async () => {
  let attempts = 0
  const provider: LlmProvider = { async *streamChat() {
    if (++attempts === 1) {
      yield { type: "reasoning", text: "trace" }
      yield { type: "done", finish_reason: "max_tokens" }
    } else yield { type: "done", finish_reason: "stop" }
  }, complete: async () => ({ content: "" }) }
  await assert.rejects(async () => { for await (const _ of streamChatWithRecovery(provider, { messages: [] }, config)) {} }, /已停止/)
  assert.equal(attempts, 2)
})
