/**
 * Run-loop regression tests:
 * - leftover steers on normal finish convert to nextRun (not silently dropped)
 * - steer entries carry clientMessageId into the chat.user echo (D6/F1 adopt)
 * - supersede entry-heal INTERRUPTED filler is replaced in place by the real result
 * - overflow/length retries compact with phase mid_loop and only in auto mode
 * - pure-text length stop flags chat.done with truncated:true
 * - tool-format-leak hint chat.token is a full snapshot
 *
 * Mock seam: OpenAIProvider.prototype.streamChat (CanonicalStreamEvent).
 * Patching openai Completions.create on a dummy client misses the provider
 * class under tsx (dual package instance) — Lane A REJECT 2026-08-25.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-steer-overflow-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let rebuildMessagesFromHistory: typeof import("../src/llm/adapter").rebuildMessagesFromHistory
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let persistHealedToolRows: typeof import("../src/llm/tool-batch-heal").persistHealedToolRows
let runQueues: typeof import("../src/llm/run-queues")
let leakHint: string
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider

const logEvents: Array<{ level: string; event: string; data: Record<string, unknown> }> = []

let originalStreamChat: OpenAIProvider["streamChat"] | undefined
let originalComplete: OpenAIProvider["complete"] | undefined

type CreateHandler = (params: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>
let createHandlers: CreateHandler[] = []
let streamParams: StreamChatParams[] = []

function textStreamHandler(text: string, finishReason = "stop", hook?: () => void): CreateHandler {
  return async function* () {
    hook?.()
    yield { type: "token", text }
    yield { type: "done", finish_reason: finishReason }
  }
}

function toolCallStreamHandler(
  id: string,
  name: string,
  args: string,
  finishReason = "tool_calls",
): CreateHandler {
  return async function* () {
    yield { type: "tool_call_delta", index: 0, id, name, arguments: args }
    yield { type: "done", finish_reason: finishReason }
  }
}

function overflowThrowHandler(): CreateHandler {
  return (() => {
    throw new Error("context_length_exceeded: this model's maximum context length is 300 tokens")
  }) as unknown as CreateHandler
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  const heal = await import("../src/llm/tool-batch-heal")
  const openaiProv = await import("../src/llm/providers/openai")
  runQueues = await import("../src/llm/run-queues")
  leakHint = (await import("../src/llm/tool-format-leak")).TOOL_FORMAT_LEAK_USER_HINT_ZH

  chatCreate = adapter.chatCreate
  rebuildMessagesFromHistory = adapter.rebuildMessagesFromHistory
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  persistHealedToolRows = heal.persistHealedToolRows
  OpenAIProvider = openaiProv.OpenAIProvider

  await config.initDataDir()

  const loggerMod = await import("../src/logger")
  const originalLogger = {
    log: loggerMod.logger.log,
    info: loggerMod.logger.info,
    warn: loggerMod.logger.warn,
    error: loggerMod.logger.error,
  }
  loggerMod.logger.log = (level: string, event: string, data: Record<string, unknown> = {}, source?: string) => {
    logEvents.push({ level, event, data })
    originalLogger.log(level as any, event, data, source || "test")
  }
  loggerMod.logger.info = (event: string, data?: Record<string, unknown>, source?: string) => {
    logEvents.push({ level: "info", event, data: data || {} })
    originalLogger.info(event, data, source || "test")
  }
  loggerMod.logger.warn = (event: string, data?: Record<string, unknown>, source?: string) => {
    logEvents.push({ level: "warn", event, data: data || {} })
    originalLogger.warn(event, data, source || "test")
  }
  loggerMod.logger.error = (event: string, data?: Record<string, unknown>, source?: string) => {
    logEvents.push({ level: "error", event, data: data || {} })
    originalLogger.error(event, data, source || "test")
  }

  originalStreamChat = OpenAIProvider.prototype.streamChat
  originalComplete = OpenAIProvider.prototype.complete
  OpenAIProvider.prototype.streamChat = async function* (params: StreamChatParams) {
    streamParams.push(params)
    const h = createHandlers.shift()
    if (!h) throw new Error("unexpected streamChat call (no handler queued)")
    yield* h(params)
  }
  OpenAIProvider.prototype.complete = async function () {
    return { content: "标题" }
  }
})

after(() => {
  if (originalStreamChat) OpenAIProvider.prototype.streamChat = originalStreamChat
  if (originalComplete) OpenAIProvider.prototype.complete = originalComplete
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetState() {
  logEvents.length = 0
  createHandlers = []
  streamParams = []
  runQueues._resetRunQueuesForTests()
}

function buildMockParams(threadId: string, overrides: {
  executeTool?: (id: string, name: string, params: any) => Promise<any>
  contextCompaction?: "auto" | "prompt" | "off"
  contextWindow?: number
  signal?: AbortSignal
  manager?: InstanceType<typeof ThreadManager>
} = {}) {
  const manager = overrides.manager ?? new ThreadManager()
  const thread = manager.get(threadId) ?? manager.create("test", threadId)
  const skillEngine = new SkillEngine()

  const sentMessages: any[] = []

  return {
    threadId: thread.id,
    message: "hello",
    skillIds: [],
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: overrides.contextWindow ?? 4000,
      ...(overrides.contextCompaction ? { context_compaction: overrides.contextCompaction } : {}),
    },
    threadManager: manager,
    skillEngine,
    historyStore: { record: () => 0 } as any,
    sendToExtension: (data: any) => {
      sentMessages.push(data)
    },
    executeTool: overrides.executeTool || (async () => ({ success: true, data: {} })),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
    getSentMessages: () => sentMessages,
  }
}

test("steer arriving during the final streaming round converts to nextRun (not dropped)", async () => {
  resetState()
  const params = buildMockParams("test-sn-leftover")
  createHandlers = [
    textStreamHandler("回答", "stop", () => {
      runQueues.enqueueSteer(params.threadId, "请再补充测试")
    }),
  ]
  await chatCreate(params)

  assert.equal(runQueues.takeNextRun(params.threadId), "请再补充测试")
  assert.deepEqual(runQueues.takeSteer(params.threadId), [])
  const users = params.threadManager.getMessages(params.threadId).filter((m) => m.role === "user")
  assert.equal(users.length, 1)
})

test("abort finish leaves steer queue to the router and does not create nextRun", async () => {
  resetState()
  const controller = new AbortController()
  const params = buildMockParams("test-sn-abort", { signal: controller.signal })
  createHandlers = [
    async function* () {
      runQueues.enqueueSteer(params.threadId, "abort 期间的 steer")
      controller.abort()
      const err = new Error("aborted")
      err.name = "AbortError"
      throw err
    },
  ]
  try {
    await chatCreate(params)
  } catch {
    /* adapter may swallow AbortError */
  }

  assert.equal(runQueues.peekNextRunCount(params.threadId), 0)
  assert.equal(runQueues.takeSteer(params.threadId).length, 1)
})

test("leftover steer with full nextRun queue logs a warning and drops", async () => {
  resetState()
  const params = buildMockParams("test-sn-full")
  for (let i = 0; i < runQueues.MAX_NEXT_RUN; i++) {
    runQueues.enqueueNextRun(params.threadId, `queued-${i}`)
  }
  createHandlers = [
    textStreamHandler("回答", "stop", () => {
      runQueues.enqueueSteer(params.threadId, "塞不下的 steer")
    }),
  ]
  await chatCreate(params)

  const warn = logEvents.find((e) => e.event === "llm.steer_leftover_dropped")
  assert.ok(warn, "queue-full drop must be observable")
  assert.equal(warn!.level, "warn")
  assert.equal(warn!.data.count, 1)
  assert.equal(runQueues.peekNextRunCount(params.threadId), runQueues.MAX_NEXT_RUN)
  assert.deepEqual(runQueues.takeSteer(params.threadId), [])
})

test("steer consumed mid-run persists joined text and echoes first client_message_id", async () => {
  resetState()
  const params = buildMockParams("test-sn-cmid")
  runQueues.enqueueSteer(params.threadId, "先跑测试", "cm-steer-1")
  runQueues.enqueueSteer(params.threadId, "再跑 lint")
  createHandlers = [textStreamHandler("好的", "stop")]
  await chatCreate(params)

  const users = params.threadManager
    .getMessages(params.threadId)
    .filter((m) => m.role === "user")
    .map((m) => m.content)
  assert.deepEqual(users, ["hello", "先跑测试\n再跑 lint"])

  const echoes = params.getSentMessages().filter((m) => m.type === "chat.user")
  assert.equal(echoes.length, 2)
  assert.equal("client_message_id" in echoes[0], false, "main path without clientMessageId")
  assert.equal(echoes[1].content, "先跑测试\n再跑 lint")
  assert.equal(echoes[1].client_message_id, "cm-steer-1")
  assert.ok(echoes[1].message_id, "persisted companion id present")

  const reqUsers = streamParams[0].messages.filter((m) => m.role === "user")
  assert.ok(reqUsers.some((m) => typeof m.content === "string" && m.content === "先跑测试\n再跑 lint"))
})

test("real tool result replaces the successor's INTERRUPTED filler in place (no EOF orphan)", async () => {
  resetState()
  const manager = new ThreadManager()
  const thread = manager.create("test", "test-sn-filler")
  const params = buildMockParams(thread.id, {
    manager,
    executeTool: async () => {
      persistHealedToolRows(manager, thread.id)
      return { success: true, data: { tabs: [1, 2] } }
    },
  })
  createHandlers = [
    toolCallStreamHandler("call_A", "list_tabs", "{}"),
    textStreamHandler("完成", "stop"),
  ]
  await chatCreate(params)

  const disk = manager.getMessages(thread.id)
  const rowsForA = disk.filter((m) =>
    (m.tool_calls || []).some((tc: any) => tc.id === "call_A" && m.role === "tool"),
  )
  assert.equal(rowsForA.length, 1, "exactly one tool row for call_A — filler replaced, not appended")

  const asstIdx = disk.findIndex((m) => m.role === "assistant" && (m.tool_calls || []).length > 0)
  const toolIdx = disk.findIndex((m) => m === rowsForA[0])
  assert.ok(asstIdx >= 0)
  assert.equal(toolIdx, asstIdx + 1, "real row stays right after its assistant (in place)")

  const result = rowsForA[0].tool_calls![0].result as any
  assert.equal(result.success, true, "real result won")
  assert.notEqual(result.error_code, "INTERRUPTED")

  const rebuilt = rebuildMessagesFromHistory(disk)
  const rebuiltAsst = rebuilt.find((m) => m.role === "assistant" && (m as any).tool_calls)
  assert.ok(rebuiltAsst, "assistant round survives rebuild")
  assert.ok(
    rebuilt.some((m) => m.role === "tool" && (m as any).tool_call_id === "call_A"),
    "tool row pairs at rebuild",
  )
})

test("overflow retry uses mid_loop pin: live assistant+tool rows survive into the retry request", async () => {
  resetState()
  const params = buildMockParams("test-sn-ovf-auto", { contextWindow: 300 })
  createHandlers = [
    toolCallStreamHandler("call_A", "list_tabs", "{}"),
    overflowThrowHandler(),
    textStreamHandler("ok", "stop"),
  ]
  const bigExecuteTool = async () => ({ success: true, data: { blob: "x".repeat(4000) } })
  await chatCreate({ ...params, executeTool: bigExecuteTool })

  assert.equal(streamParams.length, 3, "one overflow retry happened")
  const retryMessages = streamParams[2].messages
  assert.ok(
    retryMessages.some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray((m as any).tool_calls) &&
        (m as any).tool_calls.some((tc: any) => tc.id === "call_A"),
    ),
    "mid_loop pin keeps the live assistant tool_calls row (pre_loop would drop it)",
  )
  assert.ok(
    retryMessages.some((m) => m.role === "tool" && (m as any).tool_call_id === "call_A"),
    "mid_loop pin keeps the live tool row",
  )
  const done = params.getSentMessages().find((m) => m.type === "chat.done")
  assert.ok(done, "run completes after the retry")
})

test("overflow with compaction=prompt skips the byte-level retry", async () => {
  resetState()
  const params = buildMockParams("test-sn-ovf-prompt", { contextCompaction: "prompt" })
  createHandlers = [overflowThrowHandler()]
  await chatCreate(params)

  assert.equal(streamParams.length, 1, "no retry — prompt mode never shrinks the request")
  const err = params.getSentMessages().find((m) => m.type === "chat.error")
  assert.ok(err && /上下文溢出/.test(err.error))
})

test("overflow with compaction=off skips the byte-level retry", async () => {
  resetState()
  const params = buildMockParams("test-sn-ovf-off", { contextCompaction: "off" })
  createHandlers = [overflowThrowHandler()]
  await chatCreate(params)

  assert.equal(streamParams.length, 1, "no retry — off mode never compacts")
  const err = params.getSentMessages().find((m) => m.type === "chat.error")
  assert.ok(err && /上下文溢出/.test(err.error))
})

test("length-truncated tool batch retries once in auto mode", async () => {
  resetState()
  const params = buildMockParams("test-sn-len-auto")
  createHandlers = [
    toolCallStreamHandler("call_A", "list_tabs", "{}", "length"),
    textStreamHandler("ok", "stop"),
  ]
  await chatCreate(params)

  assert.equal(streamParams.length, 2, "truncated tool batch retried once")
  assert.ok(params.getSentMessages().find((m) => m.type === "chat.done"))
})

test("length-truncated tool batch in prompt mode errors without retry", async () => {
  resetState()
  const params = buildMockParams("test-sn-len-prompt", { contextCompaction: "prompt" })
  createHandlers = [toolCallStreamHandler("call_A", "list_tabs", "{}", "length")]
  await chatCreate(params)

  assert.equal(streamParams.length, 1, "no byte-level retry in prompt mode")
  const err = params.getSentMessages().find((m) => m.type === "chat.error")
  assert.ok(err && /输出被截断/.test(err.error))
})

test("chat.done carries truncated:true on pure-text length stop", async () => {
  resetState()
  const params = buildMockParams("test-sn-truncated")
  createHandlers = [textStreamHandler("被截断的长回答", "length")]
  await chatCreate(params)

  const done = params.getSentMessages().find((m) => m.type === "chat.done")
  assert.ok(done)
  assert.equal(done.truncated, true)
})

test("chat.done omits truncated on normal stop", async () => {
  resetState()
  const params = buildMockParams("test-sn-not-truncated")
  createHandlers = [textStreamHandler("完整回答", "stop")]
  await chatCreate(params)

  const done = params.getSentMessages().find((m) => m.type === "chat.done")
  assert.ok(done)
  assert.equal("truncated" in done, false)
})

test("tool-format-leak hint chat.token carries accumulated content + hint", async () => {
  resetState()
  const leaked = "我将调用 list_tabs() 来获取标签页"
  const params = buildMockParams("test-sn-leak")
  createHandlers = [textStreamHandler(leaked, "stop")]
  await chatCreate(params)

  const tokens = params.getSentMessages().filter((m) => m.type === "chat.token")
  const last = tokens[tokens.length - 1]
  assert.equal(last.content, `${leaked}\n\n${leakHint}`, "full snapshot, not just the hint fragment")
  assert.ok(params.getSentMessages().some((m) => m.type === "chat.tool_format_warning"))
  const done = params.getSentMessages().find((m) => m.type === "chat.done")
  assert.equal(done?.tool_format_leak, true)
})
