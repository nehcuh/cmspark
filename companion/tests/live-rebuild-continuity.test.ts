// #504 (adversarial H1): same-process continuation must keep tool-output
// fidelity even though the default archive tier (#502 B) stubs disk rows.
// Drives production chatCreate twice against a real local LLM endpoint:
//   run 1 executes a tool whose body would be stubbed on disk;
//   run 2 (same ThreadManager instance = same process) must see the FULL body
//   via the live mirror, while the disk row stays stubbed;
//   a fresh ThreadManager instance on the same disk (process restart analog)
//   falls back to the archived stubs — the documented B-tier boundary.
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as http from "node:http"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-live-rebuild-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let rebuildMessagesFromHistory: typeof import("../src/llm/adapter").rebuildMessagesFromHistory
let saveConfig: typeof import("../src/config").saveConfig
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let server: http.Server
let baseUrl: string

type ResponseSpec = { status: number; headers: Record<string, string>; body: string }
let responder: (body: any, streamCallIndex: number) => ResponseSpec
let capturedBodies: any[]
let streamCall: number

function sseChunk(delta: any, finish_reason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
}
const DONE = "data: [DONE]\n\n"

function sse(chunks: string[]): ResponseSpec {
  return { status: 200, headers: { "content-type": "text/event-stream" }, body: chunks.join("") }
}
function json(obj: any): ResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }
}

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY
  const adapter = await import("../src/llm/adapter")
  const threadManagerMod = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  chatCreate = adapter.chatCreate
  rebuildMessagesFromHistory = adapter.rebuildMessagesFromHistory
  saveConfig = config.saveConfig
  ThreadManager = threadManagerMod.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  await config.initDataDir()

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      let body: any = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { /* ignore */ }
      capturedBodies.push(body)
      let idx = -1
      if (body.stream) { streamCall++; idx = streamCall }
      const spec = responder ? responder(body, idx) : json({ choices: [{ message: { content: "T" } }] })
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

function resetCapture() {
  capturedBodies = []
  streamCall = 0
}

const FULL_BODY = "FULL-FIDELITY-BODY-9f2a-from-segment-one"

async function runOnce(opts: {
  manager: InstanceType<typeof ThreadManager>
  threadId: string
  message: string
  executeTool?: (id: string, name: string, p: any) => Promise<any>
}) {
  await chatCreate({
    threadId: opts.threadId,
    message: opts.message,
    skillIds: [],
    config: { base_url: baseUrl, api_key: "sk-test", model_name: "test-model", temperature: 0.5, context_window: 100000 } as any,
    threadManager: opts.manager,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
    sendToExtension: () => {},
    executeTool: opts.executeTool ?? (async () => ({ success: true })),
  })
}

test("#504: same-process second run sees the full tool body via the live mirror (default tier)", async () => {
  saveConfig({ persist_full_tool_history: false })
  resetCapture()
  let withToolRound = true
  responder = (body, idx) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    if (idx === 1 && withToolRound) {
      return sse([
        sseChunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_live_1", type: "function", function: { name: "get_page_text", arguments: "{}" } }] }),
        sseChunk({}, "tool_calls"),
        DONE,
      ])
    }
    return sse([sseChunk({ role: "assistant", content: "done" }), sseChunk({}, "stop"), DONE])
  }

  const manager = new ThreadManager()
  const thread = manager.create("live-rebuild", "live-01")
  manager.update(thread.id, { run_progress: null })

  // Run 1 (segment one): tool body exists in full only in memory.
  await runOnce({
    manager,
    threadId: thread.id,
    message: "read the page",
    executeTool: async () => ({ success: true, data: { text: FULL_BODY } }),
  })

  // Disk stayed stubbed (B tier default): the body is NOT on disk.
  const diskRows = manager.getMessages(thread.id)
  const diskToolRow = diskRows.find(
    (m: any) => m.role === "tool" && (m.tool_calls || []).some((tc: any) => tc.id === "call_live_1"),
  ) as any
  assert.ok(diskToolRow, "tool row persisted")
  const diskTc = diskToolRow.tool_calls.find((tc: any) => tc.id === "call_live_1")
  assert.equal(diskTc.result?.redacted, true, "default tier stubs the success body on disk")
  assert.ok(!JSON.stringify(diskToolRow).includes(FULL_BODY), "full body never lands on disk")
  const diskAssistantRow = diskRows.find(
    (m: any) => m.role === "assistant" && (m.tool_calls || []).some((tc: any) => tc.id === "call_live_1"),
  ) as any
  assert.match(
    String(diskAssistantRow.tool_calls.find((tc: any) => tc.id === "call_live_1").function.arguments),
    /"redacted"/,
    "assistant arguments stubbed on disk",
  )

  // Run 2 (continuation, same process/manager): rebuild must substitute the
  // remembered full body and the raw arguments.
  resetCapture()
  withToolRound = false
  await runOnce({ manager, threadId: thread.id, message: "continue" })

  const run2Body = capturedBodies.find(b => b.stream)
  assert.ok(run2Body, "run 2 issued a streaming request")
  const toolMsg = run2Body.messages.find((m: any) => m.role === "tool")
  assert.ok(toolMsg, "run 2 replays the tool result")
  assert.ok(
    String(toolMsg.content).includes(FULL_BODY),
    "run 2 sees the FULL body from the live mirror, not the disk stub",
  )
  const replayedAssistant = run2Body.messages.find(
    (m: any) => m.role === "assistant" && (m.tool_calls || []).some((tc: any) => tc.id === "call_live_1"),
  )
  assert.ok(replayedAssistant, "run 2 replays the assistant tool_calls row")
  assert.equal(
    replayedAssistant.tool_calls.find((tc: any) => tc.id === "call_live_1").function.arguments,
    "{}",
    "assistant arguments come from the live mirror (raw '{}'), not the disk stub",
  )
})

test("#504: fresh ThreadManager on the same disk (process-restart analog) falls back to stubs", async () => {
  resetCapture()
  responder = (body) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    return sse([sseChunk({ role: "assistant", content: "ok" }), sseChunk({}, "stop"), DONE])
  }

  const restarted = new ThreadManager()
  await runOnce({ manager: restarted, threadId: "live-01", message: "continue after restart" })

  const body = capturedBodies.find(b => b.stream)
  assert.ok(body, "request issued")
  const toolMsg = body.messages.find(
    (m: any) => m.role === "tool" && m.tool_call_id === "call_live_1",
  )
  assert.ok(toolMsg, "tool row replayed from disk")
  assert.ok(!String(toolMsg.content).includes(FULL_BODY), "no mirror after restart — stub only")
  assert.match(String(toolMsg.content), /"redacted"/, "stub envelope replayed")
})

test("#504: rebuildMessagesFromHistory live substitution (pure function)", () => {
  const history = [
    { id: "a1", role: "assistant", content: "", tool_calls: [{ id: "tc1", function: { name: "get_page_text", arguments: '{"redacted":true,"len":7}' } }] },
    { id: "t1", role: "tool", tool_calls: [{ id: "tc1", tool_name: "get_page_text", result: { success: true, redacted: true, len: 10, sha256: "x" } }] },
  ]
  const live = {
    toolResults: new Map([["tc1", { result: { success: true, data: { text: FULL_BODY } }, tool_name: "get_page_text" }]]),
    assistantToolCalls: new Map([["a1", [{ id: "tc1", name: "get_page_text", arguments: '{"tabId":3}' }]]]),
  }

  const withLive = rebuildMessagesFromHistory(history, live)
  const toolOut = withLive.find(m => m.role === "tool")
  assert.ok(String(toolOut?.content).includes(FULL_BODY), "live result substituted")
  const asstOut: any = withLive.find(m => m.role === "assistant" && m.tool_calls?.length)
  assert.equal(asstOut.tool_calls[0].function.arguments, '{"tabId":3}', "live arguments substituted")

  const withoutLive = rebuildMessagesFromHistory(history)
  const toolDisk = withoutLive.find(m => m.role === "tool")
  assert.ok(!String(toolDisk?.content).includes(FULL_BODY), "disk stub without mirror")
})

test("#504: live mirror caps and delete() cleanup", () => {
  const manager = new ThreadManager()
  const thread = manager.create("mirror-cap", "mirror-01")
  for (let i = 0; i < 1205; i++) {
    manager.rememberLiveToolResult(thread.id, `tc_${i}`, { result: { i } })
  }
  const mirror = manager.getLiveMirror(thread.id)
  assert.equal(mirror?.toolResults.size, 1200, "tool results capped")
  assert.ok(!mirror?.toolResults.has("tc_0"), "oldest evicted")
  assert.ok(mirror?.toolResults.has("tc_1204"), "newest kept")

  manager.delete(thread.id)
  assert.equal(manager.getLiveMirror(thread.id), undefined, "delete clears the mirror")
})
