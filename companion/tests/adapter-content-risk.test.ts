/**
 * #430: 服务商内容风控 400（Content Exists Risk）识别 + 一次性隔离恢复。
 * - isContentRiskError 分类器（DeepSeek/Aliyun/Azure 形态；不误伤 401/500/超时/结构 400）
 * - findLastLargeToolResultIndex / quarantinePersistedToolRow 纯函数
 * - 集成：风控 → 隔离最近大型工具结果重试一次（内存 + 持久化行同步隔离）→ 成功续跑
 * - 集成：二次命中 → 立即致命（无 5 次风暴）；无可隔离对象 → 立即致命
 *
 * Mock seam: OpenAIProvider.prototype.streamChat（同 adapter-steer-overflow.test.ts）。
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-content-risk-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let findLastLargeToolResultIndex: typeof import("../src/llm/adapter").findLastLargeToolResultIndex
let quarantinePersistedToolRow: typeof import("../src/llm/adapter").quarantinePersistedToolRow
let isContentRiskError: typeof import("../src/llm/overflow").isContentRiskError
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider

const logEvents: Array<{ level: string; event: string; data: Record<string, unknown> }> = []

type CreateHandler = (params: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>
let createHandlers: CreateHandler[] = []
let streamParams: StreamChatParams[] = []
let originalStreamChat: InstanceType<typeof OpenAIProvider>["streamChat"] | undefined
let originalComplete: InstanceType<typeof OpenAIProvider>["complete"] | undefined

function textStreamHandler(text: string, finishReason = "stop"): CreateHandler {
  return async function* () {
    yield { type: "token", text }
    yield { type: "done", finish_reason: finishReason }
  }
}

function toolCallStreamHandler(id: string, name: string, args: string): CreateHandler {
  return async function* () {
    yield { type: "tool_call_delta", index: 0, id, name, arguments: args }
    yield { type: "done", finish_reason: "tool_calls" }
  }
}

function riskThrowHandler(): CreateHandler {
  return (() => {
    throw new Error("400 Content Exists Risk")
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
  const overflow = await import("../src/llm/overflow")
  const openaiProv = await import("../src/llm/providers/openai")

  chatCreate = adapter.chatCreate
  findLastLargeToolResultIndex = adapter.findLastLargeToolResultIndex
  quarantinePersistedToolRow = adapter.quarantinePersistedToolRow
  isContentRiskError = overflow.isContentRiskError
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  OpenAIProvider = openaiProv.OpenAIProvider

  await config.initDataDir()

  const loggerMod = await import("../src/logger")
  const originalLogger = {
    log: loggerMod.logger.log,
    warn: loggerMod.logger.warn,
    error: loggerMod.logger.error,
  }
  loggerMod.logger.log = (level: string, event: string, data: Record<string, unknown> = {}, source?: string) => {
    logEvents.push({ level, event, data })
    originalLogger.log(level as any, event, data, source || "test")
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
}

function buildMockParams(threadId: string, overrides: {
  executeTool?: (id: string, name: string, params: any) => Promise<any>
} = {}) {
  const manager = new ThreadManager()
  const thread = manager.create("test", threadId)
  const sentMessages: any[] = []
  return {
    threadId: thread.id,
    message: "帮我总结这个页面",
    skillIds: [],
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 4000,
    },
    threadManager: manager,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
    sendToExtension: (data: any) => {
      sentMessages.push(data)
    },
    executeTool: overrides.executeTool || (async () => ({ success: true, data: {} })),
    getSentMessages: () => sentMessages,
  }
}

// --- 纯函数：分类器 ---

test("isContentRiskError matches known provider moderation shapes", () => {
  assert.equal(isContentRiskError("400 Content Exists Risk"), true) // DeepSeek（4zi17x 实证）
  assert.equal(isContentRiskError("400 data_inspection_failed: Input data may contain inappropriate content"), true) // Aliyun
  assert.equal(isContentRiskError("400 The response was filtered due to the prompt triggering content management policy"), true) // Azure
})

test("isContentRiskError does not misfire on transient/auth/structural errors", () => {
  assert.equal(isContentRiskError("401 Unauthorized"), false)
  assert.equal(isContentRiskError("403 Forbidden"), false)
  assert.equal(isContentRiskError("500 Internal Server Error"), false)
  assert.equal(isContentRiskError("429 Too Many Requests"), false)
  assert.equal(isContentRiskError("fetch failed: ETIMEDOUT"), false)
  assert.equal(isContentRiskError("400 Invalid tool_calls: missing id"), false) // 结构 400 仍走旧路径
  assert.equal(isContentRiskError("context_length_exceeded"), false)
})

// --- 纯函数：隔离定位 ---

test("findLastLargeToolResultIndex picks the LAST large tool row only", () => {
  const big = "x".repeat(600)
  const msgs = [
    { role: "user", content: big }, // 用户长文不算（隔离用户消息会改用户原话）
    { role: "tool", content: "small" },
    { role: "assistant", content: big },
    { role: "tool", content: big },
    { role: "tool", content: "y".repeat(700) },
  ]
  assert.equal(findLastLargeToolResultIndex(msgs), 4)
  assert.equal(findLastLargeToolResultIndex([{ role: "tool", content: "tiny" }]), -1)
  assert.equal(findLastLargeToolResultIndex([]), -1)
})

test("quarantinePersistedToolRow patches content and embedded result", () => {
  const big = "z".repeat(800)
  const rows: any[] = [
    { id: "m1", role: "tool", content: big, tool_calls: [{ id: "c1", tool_name: "get_page_text", result: { text: big } }] },
  ]
  const tm = {
    getMessages: () => rows,
    updateMessage: (_tid: string, mid: string, u: any) => {
      const r = rows.find((x) => x.id === mid)
      Object.assign(r, u)
    },
  }
  // 全等失配（内存行是 wrapUntrusted 后的串）→ 回退最后大型工具行
  assert.equal(quarantinePersistedToolRow(tm, "t", "wrapped-not-equal"), true)
  assert.ok(rows[0].content.includes("内容风控") || rows[0].content.includes("已被移除"))
  assert.deepEqual(rows[0].tool_calls[0].result, { quarantined: true, reason: "content_risk" })
})

// --- 集成：一次性隔离恢复成功 ---

test("content risk 400 quarantines the last large tool result and retries ONCE, then continues", async () => {
  resetState()
  const bigPageText = "PAGE ".repeat(300) // 1500 chars
  const params = buildMockParams("test-risk-recover", {
    executeTool: async (_id, name) =>
      name === "get_page_text"
        ? { success: true, data: { text: bigPageText } }
        : { success: true, data: { ok: true } },
  })
  createHandlers = [
    toolCallStreamHandler("call_prop_1", "run_progress_propose", JSON.stringify({ items: [{ text: "总结页面" }] })),
    toolCallStreamHandler("call_risk_1", "get_page_text", JSON.stringify({ tabId: 1 })),
    riskThrowHandler(),
    textStreamHandler("基于其余信息继续完成", "stop"),
  ]
  await chatCreate(params)

  // 恰好 4 次 API 调用：propose → tool 轮 → 风控挂 → 隔离后重试成功（无 5 次风暴）
  assert.equal(streamParams.length, 4)
  assert.ok(logEvents.some((e) => e.event === "llm.content_risk_quarantine"))

  // 第三次调用的 payload：大型工具结果已被占位替换，原网页文本不再出现
  const third = streamParams[3].messages as any[]
  const toolRows = third.filter((m) => m.role === "tool")
  assert.ok(toolRows.some((m) => typeof m.content === "string" && m.content.includes("已被移除")))
  const carriers = third.filter((m) => typeof m.content === "string" && m.content.includes(bigPageText.slice(0, 100))).map((m) => m.role + ":" + String(m.content).length)
  assert.ok(carriers.length === 0, `page text still present in: ${carriers.join(",")}`)

  // 持久化行同步隔离（下次 run 重建不再带出触发内容）
  const persisted = params.threadManager.getMessages(params.threadId)
  const persistedTool = persisted.filter((m: any) => m.role === "tool")
  assert.ok(persistedTool.length > 0)
  assert.ok(persistedTool.every((m: any) => !String(m.content).includes(bigPageText.slice(0, 100))))

  // 对话正常完成
  assert.ok(params.getSentMessages().some((m) => m.type === "chat.done"))
})

// --- 集成：二次命中立即致命 ---

test("second content risk hit is immediately fatal (no 5x retry storm)", async () => {
  resetState()
  const bigPageText = "PAGE ".repeat(300)
  const params = buildMockParams("test-risk-fatal", {
    executeTool: async (_id, name) =>
      name === "get_page_text"
        ? { success: true, data: { text: bigPageText } }
        : { success: true, data: { ok: true } },
  })
  createHandlers = [
    toolCallStreamHandler("call_prop_2", "run_progress_propose", JSON.stringify({ items: [{ text: "总结页面" }] })),
    toolCallStreamHandler("call_risk_2", "get_page_text", JSON.stringify({ tabId: 1 })),
    riskThrowHandler(),
    riskThrowHandler(),
  ]
  await chatCreate(params)

  assert.equal(streamParams.length, 4) // 第二次风控后不再重试
  const errors = params.getSentMessages().filter((m) => m.type === "chat.error")
  assert.ok(errors.some((m) => String(m.error).includes("内容风控")), "fatal copy mentions 内容风控")
  assert.ok(logEvents.some((e) => e.event === "llm.content_risk_fatal"))
  // 不得落入 recoverable 计数路径
  assert.ok(!logEvents.some((e) => e.event === "llm.recoverable_api_error"))
})

// --- 集成：无可隔离对象立即致命 ---

test("content risk with no large tool result fails fast (single call, no retry)", async () => {
  resetState()
  const params = buildMockParams("test-risk-no-target")
  createHandlers = [riskThrowHandler()]
  await chatCreate(params)

  assert.equal(streamParams.length, 1)
  assert.ok(logEvents.some((e) => e.event === "llm.content_risk_no_quarantine_target"))
  const errors = params.getSentMessages().filter((m) => m.type === "chat.error")
  assert.ok(errors.some((m) => String(m.error).includes("内容风控")))
})
