import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-usage-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let generateThreadTitle: typeof import("../src/llm/adapter").generateThreadTitle
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig

// Track logger calls for verification
const logEvents: Array<{ level: string; event: string; data: Record<string, unknown> }> = []

let originalCreate: any = undefined
let completionsProto: any = undefined

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")

  chatCreate = adapter.chatCreate
  generateThreadTitle = adapter.generateThreadTitle
  ThreadManager = threadManager.ThreadManager
  saveConfig = config.saveConfig
  SkillEngine = skillEngine.SkillEngine

  await config.initDataDir()

  // Patch logger to capture events (adapter uses logger.info/warn/error, not logger.log).
  const loggerMod = await import("../src/logger")
  const originalLogger = {
    log: loggerMod.logger.log,
    debug: loggerMod.logger.debug,
    info: loggerMod.logger.info,
    warn: loggerMod.logger.warn,
    error: loggerMod.logger.error,
  }
  loggerMod.logger.log = (level: string, event: string, data: Record<string, unknown> = {}, source?: string) => {
    logEvents.push({ level, event, data })
    originalLogger.log(level as any, event, data, source || "test")
  }
  loggerMod.logger.debug = (event: string, data?: Record<string, unknown>, source?: string) => {
    logEvents.push({ level: "debug", event, data: data || {} })
    originalLogger.debug(event, data, source || "test")
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

  // Patch OpenAI completions.create to avoid real network calls.
  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://localhost:9999", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function (params: any, _options?: any) {
    const requestLog = logEvents.find(e => e.event === "openai.mock.create")
    if (!requestLog) {
      // Mark that create was called so tests can inspect call count if needed.
      logEvents.push({ level: "debug", event: "openai.mock.create", data: { stream: params.stream } })
    }

    if (params.stream) {
      return mockStream()
    }
    return mockNonStream()
  }
})

after(() => {
  if (completionsProto && originalCreate) {
    completionsProto.create = originalCreate
  }
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// Mutable mock state so each test can configure the desired response.
let mockStreamChunks: any[] = []
let mockNonStreamResponse: any = {}

async function* mockStream() {
  for (const chunk of mockStreamChunks) {
    yield chunk
  }
}

async function mockNonStream() {
  return mockNonStreamResponse
}

function buildMockParams(overrides: {
  executeTool?: (id: string, name: string, params: any) => Promise<any>
} = {}) {
  const manager = new ThreadManager()
  const thread = manager.create("usage test", "test-usage-01")
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
      context_window: 4000,
    },
    threadManager: manager,
    skillEngine,
    historyStore: { record: () => 0 } as any,
    sendToExtension: (data: any) => {
      sentMessages.push(data)
    },
    executeTool: overrides.executeTool || (async () => ({ success: true, data: {} })),
    getSentMessages: () => sentMessages,
  }
}

function clearLogEvents() {
  logEvents.length = 0
}

// --- chatCreate streaming usage tests ---

test("chatCreate logs llm.usage when terminal chunk carries usage", async () => {
  clearLogEvents()
  mockStreamChunks = [
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: { content: " there" } }] },
    {
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    },
  ]

  const params = buildMockParams()
  await chatCreate(params)

  const usageEvents = logEvents.filter(e => e.event === "llm.usage")
  assert.equal(usageEvents.length, 1, "Should log exactly one llm.usage event")

  const event = usageEvents[0]
  assert.equal(event.level, "info")
  assert.equal(event.data.thread_id, params.threadId)
  assert.equal(event.data.model, "test-model")
  assert.equal(event.data.kind, "chat")
  assert.equal(event.data.round, 1)
  assert.equal(event.data.prompt_tokens, 10)
  assert.equal(event.data.completion_tokens, 2)
  assert.equal(event.data.total_tokens, 12)
})

test("chatCreate does not throw or log usage when terminal chunk lacks usage", async () => {
  clearLogEvents()
  mockStreamChunks = [
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: { content: " there" } }] },
    { choices: [] },
  ]

  const params = buildMockParams()
  await assert.doesNotReject(async () => chatCreate(params))

  const usageEvents = logEvents.filter(e => e.event === "llm.usage")
  assert.equal(usageEvents.length, 0, "Should not log llm.usage without usage data")
})

test("chatCreate includes reasoning_tokens when present in usage details", async () => {
  clearLogEvents()
  mockStreamChunks = [
    { choices: [{ delta: { content: "Answer" } }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    },
  ]

  const params = buildMockParams()
  await chatCreate(params)

  const event = logEvents.find(e => e.event === "llm.usage")
  assert.ok(event)
  assert.equal(event!.data.reasoning_tokens, 3)
})

// --- generateThreadTitle usage tests ---

test("generateThreadTitle logs llm.usage when response carries usage", async () => {
  clearLogEvents()
  mockNonStreamResponse = {
    choices: [{ message: { content: "示例标题" } }],
    usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
  }

  const manager = new ThreadManager()
  const thread = manager.create("", "test-title-01")
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello world this is a long message" })
  manager.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "this is a long assistant response for title generation" })

  const sentMessages: any[] = []
  await generateThreadTitle({
    threadId: thread.id,
    threadManager: manager,
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "title-model",
      temperature: 0.3,
      context_window: 4000,
    },
    sendToExtension: (data: any) => sentMessages.push(data),
  })

  const usageEvents = logEvents.filter(e => e.event === "llm.usage")
  assert.equal(usageEvents.length, 1, "Should log exactly one llm.usage event for title")

  const event = usageEvents[0]
  assert.equal(event.level, "info")
  assert.equal(event.data.thread_id, thread.id)
  assert.equal(event.data.model, "title-model")
  assert.equal(event.data.kind, "title")
  assert.equal(event.data.prompt_tokens, 50)
  assert.equal(event.data.completion_tokens, 5)
  assert.equal(event.data.total_tokens, 55)
})

test("generateThreadTitle does not log usage when response lacks usage", async () => {
  clearLogEvents()
  mockNonStreamResponse = {
    choices: [{ message: { content: "无 usage" } }],
  }

  const manager = new ThreadManager()
  const thread = manager.create("", "test-title-02")
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello world this is a long message" })
  manager.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "this is a long assistant response for title generation" })

  await assert.doesNotReject(async () =>
    generateThreadTitle({
      threadId: thread.id,
      threadManager: manager,
      config: {
        base_url: "http://localhost:9999",
        api_key: "sk-test",
        model_name: "title-model",
        temperature: 0.3,
        context_window: 4000,
      },
      sendToExtension: () => {},
    })
  )

  const usageEvents = logEvents.filter(e => e.event === "llm.usage")
  assert.equal(usageEvents.length, 0, "Should not log llm.usage without usage data")
})
