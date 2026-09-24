/**
 * Parallel workers + parent share one gateway. A socket drop ("Premature close"
 * / "Connection error.") must retry the same request without a ⚠️ toast and
 * without a synthetic "try a different approach" user turn (thread 8olhpa).
 * The toast appears only after the continuous-failure limit.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-transient-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider

type CreateHandler = (params: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>
let createHandlers: CreateHandler[] = []
let streamParams: StreamChatParams[] = []
let originalStreamChat: InstanceType<typeof OpenAIProvider>["streamChat"] | undefined
let originalComplete: InstanceType<typeof OpenAIProvider>["complete"] | undefined

function textStream(text: string): CreateHandler {
  return async function* () {
    yield { type: "token", text }
    yield { type: "done", finish_reason: "stop" }
  }
}

function prematureClose(): CreateHandler {
  return (() => {
    throw new Error("Premature close")
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
  const openaiProv = await import("../src/llm/providers/openai")

  chatCreate = adapter.chatCreate
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  OpenAIProvider = openaiProv.OpenAIProvider

  await config.initDataDir()

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

function buildParams() {
  const manager = new ThreadManager()
  const thread = manager.create("transient")
  const sent: any[] = []
  return {
    threadId: thread.id,
    message: "继续核验",
    skillIds: [] as string[],
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
      sent.push(data)
    },
    executeTool: async () => ({ success: true, data: {} }),
    getSent: () => sent,
  }
}

test("Premature close retries the same request and does not toast", async () => {
  createHandlers = [prematureClose(), textStream("核验结论")]
  streamParams = []
  const params = buildParams()
  await chatCreate(params)

  const errors = params.getSent().filter((m) => m.type === "chat.error")
  assert.equal(errors.length, 0, JSON.stringify(errors))
  assert.equal(streamParams.length, 2)
  const retryUsers = streamParams[1].messages.filter((m) => m.role === "user")
  assert.ok(retryUsers.every((m) => !String(m.content).includes("Premature close")))
  assert.ok(retryUsers.every((m) => !String(m.content).includes("different approach")))
  const done = params.getSent().find((m) => m.type === "chat.done")
  assert.ok(done)
  const saved = params.threadManager.getMessages(params.threadId).filter((m) => m.role === "assistant")
  assert.ok(saved.some((m) => m.content?.includes("核验结论")))
})

test("five Premature closes toast once, in Chinese, at the limit", async () => {
  createHandlers = [prematureClose(), prematureClose(), prematureClose(), prematureClose(), prematureClose()]
  streamParams = []
  const params = buildParams()
  await chatCreate(params)

  assert.equal(streamParams.length, 5)
  const errors = params.getSent().filter((m) => m.type === "chat.error")
  assert.equal(errors.length, 1)
  assert.match(errors[0].error, /连续失败 5 次/)
  assert.match(errors[0].error, /Premature close/)
  assert.equal(
    streamParams.some((p) =>
      p.messages.some((m) => m.role === "user" && String(m.content).includes("different approach")),
    ),
    false,
  )
})
