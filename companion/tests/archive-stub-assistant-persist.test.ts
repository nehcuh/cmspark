// #510 (adversarial M6): the assistant-row archive tier is pinned BEHAVIOURALLY.
//
// Before this file the only guard was a source regex
// (`redactAssistantToolCallsForPersistence(…persist_full_tool_history…`) in
// archive-stub-args.test.ts — a type-safe mutation like
// `persistFull: … === true && false` kept the regex and the whole suite green.
// Here production chatCreate (real stream → persistAssistantDraft → disk)
// drives a tool-call round in BOTH tiers and asserts the persisted assistant
// row's tool_calls[].function.arguments per tier. The tier-kill mutation makes
// this file red (full tier would emit the stub envelope).
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as http from "node:http"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-archive-asst-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let saveConfig: typeof import("../src/config").saveConfig
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let server: http.Server
let baseUrl: string
let streamIdx = 0

type ResponseSpec = { status: number; headers: Record<string, string>; body: string }

function sseChunk(delta: any, finish_reason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
}
const DONE = "data: [DONE]\n\n"

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY
  const adapter = await import("../src/llm/adapter")
  const threadManagerMod = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  chatCreate = adapter.chatCreate
  saveConfig = config.saveConfig
  ThreadManager = threadManagerMod.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  await config.initDataDir()

  const responder = (body: any, streamIdx: number): ResponseSpec => {
    if (!body.stream) {
      return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ choices: [{ message: { content: "T" } }] }) }
    }
    if (streamIdx === 1) {
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: [
          sseChunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_asst_1", type: "function", function: { name: "get_page_text", arguments: '{"tabId":1}' } }] }),
          sseChunk({}, "tool_calls"),
          DONE,
        ].join(""),
      }
    }
    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [sseChunk({ role: "assistant", content: "done" }), sseChunk({}, "stop"), DONE].join(""),
    }
  }
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      let body: any = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { /* ignore */ }
      if (body.stream) streamIdx++
      const spec = responder(body, streamIdx)
      res.writeHead(spec.status, spec.headers)
      res.end(spec.body)
    })
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
})

after(async () => {
  await new Promise<void>(r => server.close(() => r()))
  fs.rmSync(tempHome, { recursive: true, force: true })
})

async function runToolRound(threadId: string): Promise<InstanceType<typeof ThreadManager>> {
  streamIdx = 0
  const manager = new ThreadManager()
  const thread = manager.create("asst-tier", threadId)
  manager.update(thread.id, { run_progress: null })
  await chatCreate({
    threadId: thread.id,
    message: "read it",
    skillIds: [],
    config: { base_url: baseUrl, api_key: "sk-test", model_name: "test-model", temperature: 0.5, context_window: 100000 } as any,
    threadManager: manager,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
    sendToExtension: () => {},
    executeTool: async () => ({ success: true, data: { text: "ok" } }),
  })
  return manager
}

function persistedAssistantToolCall(manager: InstanceType<typeof ThreadManager>, threadId: string): any {
  const rows = manager.getMessages(threadId) as any[]
  const asst = rows.find(
    (m) => m.role === "assistant" && (m.tool_calls || []).some((tc: any) => tc.id === "call_asst_1"),
  )
  assert.ok(asst, "assistant row with the tool call persisted")
  return asst.tool_calls.find((tc: any) => tc.id === "call_asst_1")
}

test("#510 default tier: persisted assistant arguments are the {redacted,len} stub", async () => {
  saveConfig({ persist_full_tool_history: false })
  const manager = await runToolRound("asst-default")
  const tc = persistedAssistantToolCall(manager, "asst-default")
  assert.equal(tc.function.name, "get_page_text", "name survives both tiers")
  assert.deepEqual(
    JSON.parse(tc.function.arguments),
    { redacted: true, len: '{"tabId":1}'.length },
    "default tier stubs assistant arguments",
  )
})

test("#510 full tier: persisted assistant arguments keep the body (tier actually wired)", async () => {
  saveConfig({ persist_full_tool_history: true })
  const manager = await runToolRound("asst-full")
  const tc = persistedAssistantToolCall(manager, "asst-full")
  // A tier-kill mutation (persistFull && false) would emit the stub envelope
  // here and this deepEqual fails — the source-regex gap from the review.
  assert.deepEqual(JSON.parse(tc.function.arguments), { tabId: 1 })
})
