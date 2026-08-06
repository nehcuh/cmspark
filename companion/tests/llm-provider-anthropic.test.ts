/**
 * Anthropic provider + convert contract tests (P0 / NODE2 / L11).
 * Fixtures only — no real gateway.
 */

import test from "node:test"
import assert from "node:assert/strict"
import type { LlmConfig } from "../src/config"
import { createProvider } from "../src/llm/provider"
import type {
  CanonicalChatMessage,
  CanonicalStreamEvent,
  CanonicalToolDefinition,
} from "../src/llm/provider"
import {
  buildAnthropicRequestBody,
  computeMaxTokens,
  convertMessagesToAnthropic,
  convertToolsToAnthropic,
  resolveAnthropicMessagesUrl,
  sanitizeToolCallId,
} from "../src/llm/providers/anthropic-convert"
import {
  AnthropicProvider,
  mapAnthropicCompleteResponse,
  parseAnthropicSseStream,
  sseStringToStream,
} from "../src/llm/providers/anthropic"
import { HeaderPolicyError } from "../src/llm/providers/headers"

// ── helpers ────────────────────────────────────────────────────────────────

function baseLlm(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    base_url: "https://relay.example.com/v1",
    api_key: "test-key",
    model_name: "claude-test",
    temperature: 0.2,
    context_window: 128000,
    protocol: "anthropic",
    auth_style: "auto",
    client_header_profile: "none",
    ...over,
  }
}

async function collectEvents(
  iter: AsyncIterable<CanonicalStreamEvent>,
): Promise<CanonicalStreamEvent[]> {
  const out: CanonicalStreamEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

const sampleTools: CanonicalToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_page_text",
      description: "Read page text",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "Tab id" },
        },
        required: ["tabId"],
      },
    },
  },
]

// ── max_tokens (M4) ────────────────────────────────────────────────────────

test("computeMaxTokens: min(8192, max(256, floor(cw/8)))", () => {
  assert.equal(computeMaxTokens(128000), 8192) // floor(16000) capped
  assert.equal(computeMaxTokens(8192), 1024)
  assert.equal(computeMaxTokens(1000), 256) // floor(125)=125 → max 256
  assert.equal(computeMaxTokens(2048), 256)
  assert.equal(computeMaxTokens(4096), 512)
  // invalid window falls back to 8192 → floor(8192/8)=1024
  assert.equal(computeMaxTokens(0), 1024)
  assert.equal(computeMaxTokens(-1), 1024)
})

// ── tool id sanitize ───────────────────────────────────────────────────────

test("sanitizeToolCallId: OpenAI call_ ids pass through", () => {
  assert.equal(sanitizeToolCallId("call_abc123"), "call_abc123")
  assert.equal(sanitizeToolCallId("toolu_01ABC"), "toolu_01ABC")
})

test("sanitizeToolCallId: strips illegal chars deterministically", () => {
  assert.equal(sanitizeToolCallId("call/with spaces!"), "call_with_spaces_")
  assert.equal(sanitizeToolCallId("a@b#c"), "a_b_c")
  // same input → same output (pairing)
  const a = sanitizeToolCallId("x.y.z")
  const b = sanitizeToolCallId("x.y.z")
  assert.equal(a, b)
  assert.match(a, /^[a-zA-Z0-9_-]+$/)
})

test("sanitizeToolCallId: empty / null → tool_call", () => {
  assert.equal(sanitizeToolCallId(""), "tool_call")
  assert.equal(sanitizeToolCallId(null), "tool_call")
  assert.equal(sanitizeToolCallId(undefined), "tool_call")
})

// ── tools → input_schema ───────────────────────────────────────────────────

test("convertToolsToAnthropic: function.parameters → input_schema", () => {
  const tools = convertToolsToAnthropic(sampleTools)
  assert.ok(tools)
  assert.equal(tools!.length, 1)
  assert.equal(tools![0].name, "get_page_text")
  assert.equal(tools![0].description, "Read page text")
  assert.equal(tools![0].input_schema.type, "object")
  assert.deepEqual(tools![0].input_schema.required, ["tabId"])
  assert.ok(tools![0].input_schema.properties)
  // OpenAI field "parameters" must NOT appear as sibling name "parameters"
  assert.equal((tools![0] as { parameters?: unknown }).parameters, undefined)
})

test("convertToolsToAnthropic: empty / undefined → undefined", () => {
  assert.equal(convertToolsToAnthropic(undefined), undefined)
  assert.equal(convertToolsToAnthropic([]), undefined)
})

// ── messages convert ───────────────────────────────────────────────────────

test("convertMessagesToAnthropic: system hoist to top-level", () => {
  const { system, messages } = convertMessagesToAnthropic([
    { role: "system", content: "You are helpful." },
    { role: "system", content: "Be brief." },
    { role: "user", content: "Hi" },
  ])
  assert.equal(system, "You are helpful.\n\nBe brief.")
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, "user")
  assert.equal(messages[0].content, "Hi")
})

test("convertMessagesToAnthropic: merges consecutive user messages (omit notice + user)", () => {
  const { messages } = convertMessagesToAnthropic([
    { role: "system", content: "sys" },
    {
      role: "user",
      content: "[context_omitted] Earlier 3 messages omitted (turn-safe). Full history retained on disk.",
    },
    { role: "user", content: "What next?" },
  ])
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, "user")
  assert.match(String(messages[0].content), /context_omitted/)
  assert.match(String(messages[0].content), /What next/)
})

test("convertMessagesToAnthropic: assistant tool_calls → tool_use blocks", () => {
  const { messages } = convertMessagesToAnthropic([
    { role: "user", content: "Read tab" },
    {
      role: "assistant",
      content: "I'll read it.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_page_text", arguments: '{"tabId":3}' },
        },
      ],
    },
  ])
  assert.equal(messages.length, 2)
  const asst = messages[1]
  assert.equal(asst.role, "assistant")
  assert.ok(Array.isArray(asst.content))
  const blocks = asst.content as Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>
  assert.equal(blocks[0].type, "text")
  assert.equal(blocks[0].text, "I'll read it.")
  assert.equal(blocks[1].type, "tool_use")
  assert.equal(blocks[1].id, "call_1")
  assert.equal(blocks[1].name, "get_page_text")
  assert.deepEqual(blocks[1].input, { tabId: 3 })
})

test("convertMessagesToAnthropic: contiguous tool results merge into one user message", () => {
  const { messages } = convertMessagesToAnthropic([
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_a",
          type: "function",
          function: { name: "list_tabs", arguments: "{}" },
        },
        {
          id: "call_b",
          type: "function",
          function: { name: "get_page_text", arguments: '{"tabId":1}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_a",
      content: '{"tabs":[]}',
    },
    {
      role: "tool",
      tool_call_id: "call_b",
      content: '{"text":"hi"}',
    },
  ])
  // user + assistant + one merged user(tool_results)
  assert.equal(messages.length, 3)
  const tr = messages[2]
  assert.equal(tr.role, "user")
  assert.ok(Array.isArray(tr.content))
  const blocks = tr.content as Array<{ type: string; tool_use_id: string }>
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, "tool_result")
  assert.equal(blocks[0].tool_use_id, "call_a")
  assert.equal(blocks[1].tool_use_id, "call_b")
})

test("convertMessagesToAnthropic: drops reasoning_content on wire (M7)", () => {
  const { messages } = convertMessagesToAnthropic([
    { role: "user", content: "think" },
    {
      role: "assistant",
      content: "answer",
      reasoning_content: "secret chain of thought",
    },
  ])
  const wire = JSON.stringify(messages)
  assert.equal(wire.includes("reasoning_content"), false)
  assert.equal(wire.includes("secret chain of thought"), false)
  const asst = messages[1]
  assert.ok(Array.isArray(asst.content))
  const blocks = asst.content as Array<{ type: string; text?: string }>
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, "answer")
})

test("convertMessagesToAnthropic: id sanitize aligns tool_use and tool_result", () => {
  const badId = "call/bad id!"
  const { messages } = convertMessagesToAnthropic([
    { role: "user", content: "x" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: badId,
          type: "function",
          function: { name: "list_tabs", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: badId, content: "ok" },
  ])
  const asstBlocks = messages[1].content as Array<{ type: string; id?: string }>
  const toolBlocks = messages[2].content as Array<{ type: string; tool_use_id?: string }>
  const useId = asstBlocks.find((b) => b.type === "tool_use")!.id
  const resultId = toolBlocks.find((b) => b.type === "tool_result")!.tool_use_id
  assert.equal(useId, resultId)
  assert.match(useId!, /^[a-zA-Z0-9_-]+$/)
  assert.equal(useId, sanitizeToolCallId(badId))
})

// ── base_url resolve ───────────────────────────────────────────────────────

test("resolveAnthropicMessagesUrl: no double /v1/v1", () => {
  assert.equal(
    resolveAnthropicMessagesUrl("https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1/messages",
  )
  assert.equal(
    resolveAnthropicMessagesUrl("https://api.anthropic.com/v1/"),
    "https://api.anthropic.com/v1/messages",
  )
  assert.equal(
    resolveAnthropicMessagesUrl("https://api.anthropic.com"),
    "https://api.anthropic.com/v1/messages",
  )
  assert.equal(
    resolveAnthropicMessagesUrl("https://relay.example.com/v1/messages"),
    "https://relay.example.com/v1/messages",
  )
  assert.equal(
    resolveAnthropicMessagesUrl("https://relay.example.com/custom/v1"),
    "https://relay.example.com/custom/v1/messages",
  )
})

// ── build body ─────────────────────────────────────────────────────────────

test("buildAnthropicRequestBody includes max_tokens and stream flag", () => {
  const body = buildAnthropicRequestBody({
    model: "claude-test",
    contextWindow: 32000,
    messages: [{ role: "user", content: "hi" }],
    tools: sampleTools,
    temperature: 0.1,
    stream: true,
  })
  assert.equal(body.model, "claude-test")
  assert.equal(body.max_tokens, computeMaxTokens(32000))
  assert.equal(body.stream, true)
  assert.equal(body.temperature, 0.1)
  assert.ok(body.tools && body.tools.length === 1)
  assert.equal(body.messages[0].role, "user")
})

// ── SSE fixtures ───────────────────────────────────────────────────────────

const TEXT_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"usage":{"input_tokens":10,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join("\n")

test("SSE: text deltas → token events + usage + done", async () => {
  const events = await collectEvents(parseAnthropicSseStream(sseStringToStream(TEXT_SSE)))
  const tokens = events.filter((e) => e.type === "token") as Array<{ type: "token"; text: string }>
  assert.deepEqual(
    tokens.map((t) => t.text),
    ["Hello", " world"],
  )
  const usage = events.filter((e) => e.type === "usage")
  assert.ok(usage.length >= 1)
  const done = events.filter((e) => e.type === "done")
  assert.equal(done.length, 1)
  assert.equal((done[0] as { finish_reason?: string }).finish_reason, "end_turn")
})

const TOOL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Calling tool"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_page_text","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"tab"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"Id\\":9}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join("\n")

test("SSE: tool_use block → tool_call_delta with sequential tool index 0", async () => {
  const events = await collectEvents(parseAnthropicSseStream(sseStringToStream(TOOL_SSE)))
  const tcs = events.filter((e) => e.type === "tool_call_delta") as Array<{
    type: "tool_call_delta"
    index: number
    id?: string
    name?: string
    arguments?: string
  }>
  assert.ok(tcs.length >= 1)
  // First tool_call should be index 0 (not content-block index 1)
  assert.equal(tcs[0].index, 0)
  assert.equal(tcs[0].id, "toolu_01")
  assert.equal(tcs[0].name, "get_page_text")
  const argParts = tcs.filter((t) => t.arguments != null).map((t) => t.arguments)
  assert.equal(argParts.join(""), '{"tabId":9}')
  const done = events.find((e) => e.type === "done") as { finish_reason?: string }
  assert.equal(done.finish_reason, "tool_use")
})

const THINKING_SSE = [
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step one"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" step two"}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"final"}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join("\n")

test("SSE: thinking deltas → reasoning events (M6)", async () => {
  const events = await collectEvents(parseAnthropicSseStream(sseStringToStream(THINKING_SSE)))
  const reasoning = events.filter((e) => e.type === "reasoning") as Array<{
    type: "reasoning"
    text: string
  }>
  assert.deepEqual(
    reasoning.map((r) => r.text),
    ["step one", " step two"],
  )
  const tokens = events.filter((e) => e.type === "token") as Array<{ text: string }>
  assert.deepEqual(
    tokens.map((t) => t.text),
    ["final"],
  )
})

test("mapAnthropicCompleteResponse maps text + thinking + usage", () => {
  const r = mapAnthropicCompleteResponse({
    content: [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "  done  " },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 3, output_tokens: 4 },
  })
  assert.equal(r.content, "done")
  assert.equal(r.reasoning, "hmm")
  assert.equal(r.finish_reason, "end_turn")
  assert.deepEqual(r.usage, {
    prompt_tokens: 3,
    completion_tokens: 4,
    total_tokens: 7,
  })
})

// ── multi-turn tool mock via fetch ─────────────────────────────────────────

test("AnthropicProvider multi-turn tool mock: stream tool_use then complete after tool_result", async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  const capturedBodies: unknown[] = []

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    call++
    const url = String(input)
    assert.match(url, /\/messages$/)
    const headers = init?.headers as Record<string, string>
    assert.ok(headers["x-api-key"] === "test-key" || headers["X-Api-Key"] === "test-key" ||
      // buildRequestHeaders lowercases keys
      Object.entries(headers).some(([k, v]) => k.toLowerCase() === "x-api-key" && v === "test-key"))
    assert.ok(
      Object.entries(headers).some(
        ([k, v]) => k.toLowerCase() === "anthropic-version" && v.length > 0,
      ),
    )
    // values of secrets must not be asserted via logs — only presence of header names

    const body = JSON.parse(String(init?.body || "{}"))
    capturedBodies.push(body)

    if (call === 1) {
      assert.equal(body.stream, true)
      assert.ok(body.tools?.length >= 1)
      assert.equal(body.tools[0].input_schema.type, "object")
      return new Response(sseStringToStream(TOOL_SSE), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }

    // second turn: non-stream complete after tool results in messages
    assert.equal(body.stream, false)
    // Expect tool_result present
    const flat = JSON.stringify(body.messages)
    assert.ok(flat.includes("tool_result") || flat.includes("toolu_01") || flat.includes("call_"))
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "Tab text is hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch

  try {
    const provider = new AnthropicProvider(baseLlm())

    // Round 1: stream with tools
    const events = await collectEvents(
      provider.streamChat({
        messages: [{ role: "user", content: "Read the page" }],
        tools: sampleTools,
      }),
    )
    const tcs = events.filter((e) => e.type === "tool_call_delta")
    assert.ok(tcs.length >= 1)

    // Round 2: complete after tool result (multi-turn)
    const history: CanonicalChatMessage[] = [
      { role: "user", content: "Read the page" },
      {
        role: "assistant",
        content: "Calling tool",
        tool_calls: [
          {
            id: "toolu_01",
            type: "function",
            function: { name: "get_page_text", arguments: '{"tabId":9}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "toolu_01",
        content: JSON.stringify({ success: true, data: { text: "hello" } }),
      },
    ]
    const result = await provider.complete({ messages: history })
    assert.equal(result.content, "Tab text is hello")
    assert.equal(result.usage?.total_tokens, 58)
    assert.equal(call, 2)

    // Second request body should have merged tool_result under user role
    const body2 = capturedBodies[1] as {
      messages: Array<{ role: string; content: unknown }>
    }
    const last = body2.messages[body2.messages.length - 1]
    assert.equal(last.role, "user")
    assert.ok(Array.isArray(last.content))
    const tr = (last.content as Array<{ type: string; tool_use_id: string }>).find(
      (b) => b.type === "tool_result",
    )
    assert.ok(tr)
    assert.equal(tr!.tool_use_id, "toolu_01")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("AnthropicProvider: AbortSignal aborts fetch", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error("aborted")
        err.name = "AbortError"
        reject(err)
        return
      }
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted")
        err.name = "AbortError"
        reject(err)
      })
    })
  }) as typeof fetch

  try {
    const provider = new AnthropicProvider(baseLlm())
    const ac = new AbortController()
    const p = provider.complete({
      messages: [{ role: "user", content: "hi" }],
      signal: ac.signal,
    })
    ac.abort()
    await assert.rejects(p, (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.equal((err as Error).name, "AbortError")
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("AnthropicProvider: L7 first-party + claude_code_compat refuses before fetch", async () => {
  let fetched = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetched = true
    return new Response("{}", { status: 200 })
  }) as typeof fetch

  try {
    const provider = new AnthropicProvider(
      baseLlm({
        base_url: "https://api.anthropic.com",
        client_header_profile: "claude_code_compat",
      }),
    )
    await assert.rejects(
      () =>
        provider.complete({
          messages: [{ role: "user", content: "hi" }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof HeaderPolicyError)
        return true
      },
    )
    assert.equal(fetched, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ── cross-protocol resume (Pi M7) ──────────────────────────────────────────

test("cross-protocol resume: openai-shaped tool_calls + tool rows rebuild anthropic tool_use/tool_result with aligned ids", () => {
  // Thread written under OpenAI protocol (internal shape)
  const openaiThread: CanonicalChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "click the button" },
    {
      role: "assistant",
      content: null,
      reasoning_content: "I should click",
      tool_calls: [
        {
          id: "call_openai_xyz",
          type: "function",
          function: {
            name: "click",
            arguments: '{"selector":"#btn"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_openai_xyz",
      content: JSON.stringify({ success: true }),
    },
    { role: "user", content: "now screenshot" },
  ]

  const wire = convertMessagesToAnthropic(openaiThread)
  assert.equal(wire.system, "sys")
  assert.equal(wire.messages.length, 4) // user, asst, tool-user, user

  const asst = wire.messages[1]
  assert.equal(asst.role, "assistant")
  const use = (asst.content as Array<{ type: string; id?: string; name?: string }>).find(
    (b) => b.type === "tool_use",
  )
  assert.ok(use)
  assert.equal(use!.id, "call_openai_xyz")
  assert.equal(use!.name, "click")

  const toolUser = wire.messages[2]
  assert.equal(toolUser.role, "user")
  const result = (
    toolUser.content as Array<{ type: string; tool_use_id?: string }>
  ).find((b) => b.type === "tool_result")
  assert.ok(result)
  assert.equal(result!.tool_use_id, use!.id)

  // reasoning must not leak
  assert.equal(JSON.stringify(wire).includes("I should click"), false)
  assert.equal(JSON.stringify(wire).includes("reasoning_content"), false)
})

test("cross-protocol resume: sanitized illegal openai id still pairs after switch to anthropic", () => {
  const id = "call:with:colons"
  const thread: CanonicalChatMessage[] = [
    { role: "user", content: "u" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: "list_tabs", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: id, content: "[]" },
  ]
  const body = buildAnthropicRequestBody({
    model: "claude-test",
    contextWindow: 8000,
    messages: thread,
    stream: false,
  })
  const s = JSON.stringify(body)
  const expected = sanitizeToolCallId(id)
  assert.ok(s.includes(expected))
  // count occurrences: once in tool_use, once in tool_result
  const re = new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  const matches = s.match(re)
  assert.ok(matches && matches.length >= 2)
})

// ── createProvider factory ─────────────────────────────────────────────────

test("createProvider: protocol openai → OpenAIProvider, anthropic → AnthropicProvider", () => {
  const o = createProvider(baseLlm({ protocol: "openai" }))
  const a = createProvider(baseLlm({ protocol: "anthropic" }))
  assert.equal(o.constructor.name, "OpenAIProvider")
  assert.equal(a.constructor.name, "AnthropicProvider")
  // default protocol
  const d = createProvider({
    base_url: "https://api.deepseek.com",
    api_key: "k",
    model_name: "m",
    temperature: 0.7,
    context_window: 64000,
  })
  assert.equal(d.constructor.name, "OpenAIProvider")
})

// ── header values never in provider log payload (spot-check via body only) ──

test("streamChat request body does not embed api_key; headers built via policy", async () => {
  const originalFetch = globalThis.fetch
  let seenAuthHeader = false
  globalThis.fetch = (async (_i: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === "x-api-key") {
        seenAuthHeader = true
        assert.equal(v, "super-secret-key")
      }
    }
    // body must not contain the key
    assert.equal(String(init?.body || "").includes("super-secret-key"), false)
    return new Response(sseStringToStream(TEXT_SSE), { status: 200 })
  }) as typeof fetch

  try {
    const provider = new AnthropicProvider(baseLlm({ api_key: "super-secret-key" }))
    await collectEvents(
      provider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    )
    assert.equal(seenAuthHeader, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
