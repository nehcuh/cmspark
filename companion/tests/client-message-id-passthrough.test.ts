/**
 * NIT 2 (pi dual-review): the F1 pass-through seams in message-router.ts had
 * no direct unit test — chat.create (~:444-447) and file.upload (~:855-858)
 * forward the frame's `clientMessageId` into chatCreate, which echoes it in
 * the `chat.user` broadcast as `client_message_id` (adapter.ts ~:400) so the
 * panel can adopt the persisted id onto the exact optimistic bubble.
 *
 * These tests drive handleMessage end-to-end and assert the echo contract at
 * both seams, plus the negative case: when the frame carries no
 * clientMessageId, the echo must not carry the key at all (legacy positional
 * adopt depends on its absence).
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cmid-passthrough-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let originalCreate: any = undefined
let completionsProto: any = undefined
let createImpl: () => Promise<never> = async () => {
  throw new Error("unset mock")
}

before(async () => {
  const mr = await import("../src/message-router")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  await cfg.initDataDir()

  // Multimodal main model → standalone images take the native path before
  // chatCreate runs the LLM call (same setup as file-upload-sidecar-keep).
  saveConfig({
    llm: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "gpt-4o",
      temperature: 0.5,
      context_window: 4000,
    },
  } as any)

  // Patch OpenAI completions.create to avoid real network calls.
  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://localhost:9999", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function () {
    return createImpl()
  }
})

after(() => {
  if (completionsProto && originalCreate) {
    completionsProto.create = originalCreate
  }
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  // Abort right after the chat.user echo: the echo is emitted BEFORE the LLM
  // call, so the seam under test is exercised while the turn ends instantly.
  createImpl = async () => {
    const e = new Error("simulated abort after user-message echo")
    e.name = "AbortError"
    throw e
  }
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

function makeSession(sent: any[]) {
  return {
    sendToExtension: (data: any) => sent.push(data),
    executeTool: async () => ({ success: true, data: {} }),
  } as any
}

function makeServices(tm: InstanceType<typeof ThreadManager>) {
  return { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any }
}

function chatCreateMsg(threadId: string, clientMessageId?: string) {
  return {
    type: "chat.create",
    thread_id: threadId,
    message: "hello",
    ...(clientMessageId ? { clientMessageId } : {}),
  }
}

function uploadMsg(threadId: string, clientMessageId?: string) {
  return {
    type: "file.upload",
    thread_id: threadId,
    message: "看下这张图",
    files: [{ name: "a.png", type: "image/png", content: PNG.toString("base64") }],
    ...(clientMessageId ? { clientMessageId } : {}),
  }
}

function findChatUserEcho(sent: any[], threadId: string) {
  return sent.find((m) => m.type === "chat.user" && m.thread_id === threadId)
}

test("chat.create: clientMessageId is echoed as chat.user client_message_id", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "cmid-chat-echo")
  const sent: any[] = []

  await handleMessage(
    chatCreateMsg(thread.id, "cm-chat-0001"),
    makeServices(tm),
    makeSession(sent),
  )

  const echo = findChatUserEcho(sent, thread.id)
  assert.ok(echo, "chat.user broadcast must be emitted")
  assert.equal(
    echo.client_message_id,
    "cm-chat-0001",
    "frame clientMessageId must pass through chat.create → chatCreate → chat.user",
  )
  // The echo must reference the persisted user message (adopt target).
  const persisted = tm.getMessages(thread.id).find((m) => m.role === "user")
  assert.ok(persisted, "user message must be persisted")
  assert.equal(echo.message_id, persisted.id)
})

test("chat.create: no clientMessageId → chat.user omits client_message_id entirely", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "cmid-chat-absent")
  const sent: any[] = []

  await handleMessage(chatCreateMsg(thread.id), makeServices(tm), makeSession(sent))

  const echo = findChatUserEcho(sent, thread.id)
  assert.ok(echo, "chat.user broadcast must be emitted")
  assert.ok(
    !("client_message_id" in echo),
    "echo must not carry the key when the frame had no clientMessageId (legacy adopt depends on absence)",
  )
})

test("file.upload: clientMessageId is echoed as chat.user client_message_id", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "cmid-upload-echo")
  const sent: any[] = []

  const resp = await handleMessage(
    uploadMsg(thread.id, "cm-upload-0001"),
    makeServices(tm),
    makeSession(sent),
  )

  assert.equal(resp.type, "file.uploaded")
  const echo = findChatUserEcho(sent, thread.id)
  assert.ok(echo, "chat.user broadcast must be emitted")
  assert.equal(
    echo.client_message_id,
    "cm-upload-0001",
    "frame clientMessageId must pass through file.upload → chatCreate → chat.user",
  )
  const persisted = tm.getMessages(thread.id).find((m) => m.role === "user")
  assert.ok(persisted, "user message must be persisted")
  assert.equal(echo.message_id, persisted.id)
})
