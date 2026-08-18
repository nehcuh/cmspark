/**
 * F9: file.upload chatCreate failure must NOT delete image sidecars when the
 * user message (with attachment metadata) was already persisted — otherwise
 * the on-disk message's image references dangle forever. Sidecars are only
 * cleaned up when the message never made it to disk.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-upload-sidecar-keep-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let attachmentsDir: typeof import("../src/threads/image-sidecar").attachmentsDir

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
  const sidecar = await import("../src/threads/image-sidecar")
  handleMessage = mr.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  attachmentsDir = sidecar.attachmentsDir
  await cfg.initDataDir()

  // Multimodal main model → standalone images take the native path (sidecars
  // written, no vision-rail analysis) before chatCreate runs the LLM call.
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

function uploadMsg(threadId: string) {
  return {
    type: "file.upload",
    thread_id: threadId,
    message: "看下这张图",
    files: [{ name: "a.png", type: "image/png", content: PNG.toString("base64") }],
  }
}

test("F9: LLM abort after user message persisted keeps image sidecar", async () => {
  createImpl = async () => {
    const e = new Error("simulated supersede abort")
    e.name = "AbortError"
    throw e
  }

  const tm = new ThreadManager()
  const thread = tm.create("", "f9-keep")
  const sent: any[] = []
  const resp = await handleMessage(
    uploadMsg(thread.id),
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any },
    makeSession(sent),
  )

  assert.equal(resp.type, "file.uploaded")
  assert.ok(
    sent.some((m) => m.type === "chat.aborted"),
    "abort must surface as chat.aborted",
  )

  const msgs = tm.getMessages(thread.id)
  const userMsg = msgs.find((m) => m.role === "user")
  assert.ok(userMsg, "user message must be persisted before the LLM call")
  assert.equal(userMsg.attachments?.length, 1)

  const sidecarPath = path.join(
    attachmentsDir(getConfigDir(), thread.id),
    `${userMsg.id}-0.png`,
  )
  assert.ok(fs.existsSync(sidecarPath), "sidecar must survive when its message is on disk")
  assert.deepEqual(fs.readFileSync(sidecarPath), PNG)
})

test("F9: chatCreate failure before persistence still deletes orphan sidecar", async () => {
  // Unreachable in this test (addMessage throws before any LLM call) but keep
  // the mock well-defined.
  createImpl = async () => {
    throw new Error("llm must not be reached")
  }

  class ThrowingTM extends ThreadManager {
    override addMessage(..._args: any[]): any {
      throw new Error("disk full")
    }
  }
  const tm = new ThrowingTM()
  const thread = tm.create("", "f9-drop")
  const sent: any[] = []
  const resp = await handleMessage(
    uploadMsg(thread.id),
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any },
    makeSession(sent),
  )

  assert.equal(resp.type, "file.uploaded")
  assert.ok(
    sent.some((m) => m.type === "chat.error"),
    "failure must surface as chat.error",
  )
  assert.equal(
    tm.getMessages(thread.id).filter((m) => m.role === "user").length,
    0,
    "user message never persisted",
  )

  const dir = attachmentsDir(getConfigDir(), thread.id)
  const leftovers = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /-0\.png$/.test(f))
    : []
  assert.deepEqual(leftovers, [], "orphan sidecar must be deleted")
})
