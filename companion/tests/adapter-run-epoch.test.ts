/**
 * The epoch gate must be observed through chatCreate, not only through the
 * helper. A string check stays green if the condition is inverted.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-epoch-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider

type CreateHandler = (params: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>
let createHandlers: CreateHandler[] = []
let originalStreamChat: InstanceType<typeof OpenAIProvider>["streamChat"] | undefined

function toolCallStream(id: string, name: string, args: string): CreateHandler {
  return async function* () {
    yield { type: "tool_call_delta", index: 0, id, name, arguments: args }
    yield { type: "done", finish_reason: "tool_calls" }
  }
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
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
  OpenAIProvider.prototype.streamChat = function () {
    const h = createHandlers.shift()
    if (!h) {
      return (async function* () {
        yield { type: "token" as const, text: "ok" }
        yield { type: "done" as const, finish_reason: "stop" as const }
      })()
    }
    return h({} as StreamChatParams)
  }
})

after(() => {
  if (originalStreamChat) OpenAIProvider.prototype.streamChat = originalStreamChat
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function params(
  threadId: string,
  message: string,
  extra: {
    threadManager: InstanceType<typeof ThreadManager>
    skillEngine: InstanceType<typeof SkillEngine>
    executeTool: (id: string, name: string) => Promise<unknown>
    signal?: AbortSignal
  },
) {
  return {
    threadId,
    message,
    skillIds: [] as string[],
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0,
      context_window: 8000,
    },
    threadManager: extra.threadManager,
    skillEngine: extra.skillEngine,
    historyStore: { record: () => 0 },
    sendToExtension: () => {},
    executeTool: extra.executeTool,
    signal: extra.signal,
  } as any
}

test("a later chatCreate keeps its terminal when the earlier finally runs afterwards", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("test", "epoch-overlap")
  const skillEngine = new SkillEngine()
  const ctrl = new AbortController()
  createHandlers = [
    toolCallStream("a", "run_progress_propose", JSON.stringify({ items: [{ text: "先走一步" }] })),
    async function* () {
      yield { type: "token", text: "后一次已经写完" }
      yield { type: "done", finish_reason: "stop" }
    },
  ]
  await chatCreate(params(thread.id, "前一次", {
    threadManager: manager,
    skillEngine,
    signal: ctrl.signal,
    executeTool: async (_id: string, name: string) => {
      if (name !== "run_progress_propose") return { success: true, data: {} }
      await chatCreate(params(thread.id, "后一次", {
        threadManager: manager,
        skillEngine,
        executeTool: async () => ({ success: true, data: {} }),
      }))
      ctrl.abort()
      return { success: true, data: { ok: true } }
    },
  }) as any).catch((err: { name?: string }) => {
    if (err?.name !== "AbortError") throw err
  })
  const saved = manager.get(thread.id) as { last_run_terminal?: string | null }
  assert.equal(
    saved.last_run_terminal,
    null,
    "后一次正常结束写成 null 之后，前一次的 aborted finally 不得覆盖",
  )
})

test("an aborted chatCreate with no successor still records aborted", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("test", "epoch-abort")
  const ctrl = new AbortController()
  createHandlers = [
    toolCallStream("a", "run_progress_propose", JSON.stringify({ items: [{ text: "只此一次" }] })),
  ]
  await chatCreate(params(thread.id, "单独中止", {
    threadManager: manager,
    skillEngine: new SkillEngine(),
    signal: ctrl.signal,
    executeTool: async () => {
      ctrl.abort()
      return { success: true, data: { ok: true } }
    },
  }) as any).catch((err: { name?: string }) => {
    if (err?.name !== "AbortError") throw err
  })
  const saved = manager.get(thread.id) as { last_run_terminal?: string | null }
  assert.equal(saved.last_run_terminal, "aborted")
})
