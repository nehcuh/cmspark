// Integration test for abort / shouldStop tool-batch pairing.
//
// Mirrors the m2-untrusted-marker fake-server pattern: the OpenAI SDK (v4)
// resolves fetch from node-fetch (captured at module load), so we stand up a
// real local HTTP server at base_url that returns crafted SSE to drive
// chatCreate through real tool-call rounds. Abort must leave a schema-valid
// tape: assistant.tool_calls fully paired (completed rows kept, rest interrupted).

import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as http from "node:http"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-m10-abort-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let server: http.Server
let baseUrl: string

function sseChunk(delta: any, finish_reason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
}
const DONE = "data: [DONE]\n\n"

// Per-test server mode. The single request handler dispatches on this.
type Mode = "two-tool-calls" | "hold-content" | "hold-empty"
let mode: Mode

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY
  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const skillEngine = await import("../src/skills/skill-engine")
  const config = await import("../src/config")
  chatCreate = adapter.chatCreate
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  await config.initDataDir()

  server = http.createServer((_req, res) => {
    if (mode === "two-tool-calls") {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end([
        sseChunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "list_tabs", arguments: "{}" } }] }),
        sseChunk({ tool_calls: [{ index: 1, id: "call_B", type: "function", function: { name: "list_tabs", arguments: "{}" } }] }, "tool_calls"),
        DONE,
      ].join(""))
      return
    }
    if (mode === "hold-content") {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(sseChunk({ content: "partial reply text" }))
      // intentionally do NOT res.end(): SDK waits for more; the test aborts mid-stream.
      return
    }
    // "hold-empty": hold open, deliver nothing.
    res.writeHead(200, { "content-type": "text/event-stream" })
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
})

after(async () => {
  await new Promise<void>(r => server.close(() => r()))
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function makeManager(threadId: string) {
  const manager = new ThreadManager()
  const thread = manager.create("m10", threadId)
  return { manager, thread }
}

function chatParams(manager: any, thread: any, controller: AbortController, executeTool: any) {
  return {
    threadId: thread.id,
    message: "go",
    skillIds: [],
    config: { base_url: baseUrl, api_key: "sk-test", model_name: "test-model", temperature: 0.5, context_window: 100000 } as any,
    threadManager: manager,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
    sendToExtension: (_data: any) => {},
    executeTool,
    signal: controller.signal,
  }
}

test("abort during tool execution keeps assistant and fills interrupted rows", async () => {
  mode = "two-tool-calls"
  const { manager, thread } = makeManager("m10-rollback")
  const controller = new AbortController()
  let abortedOnce = false
  const executeTool = async () => {
    // First tool call triggers the abort (mimics an MCP tool throwing on signal abort).
    if (!abortedOnce) {
      abortedOnce = true
      controller.abort()
      const err = new Error("aborted")
      err.name = "AbortError"
      throw err
    }
    return { success: true, data: {} }
  }

  // chatCreate re-throws AbortError to the caller (message-router sends chat.aborted in prod).
  await chatCreate(chatParams(manager, thread, controller, executeTool)).catch(() => "aborted")

  const msgs = manager.getMessages(thread.id)
  // Keep the assistant + interrupted fillers for both calls (no rollback of the round).
  assert.equal(msgs[0].role, "user")
  const asst = msgs.find((m: any) => m.role === "assistant" && m.tool_calls?.length)
  assert.ok(asst, "assistant with tool_calls stays")
  const toolIds = msgs
    .filter((m: any) => m.role === "tool")
    .flatMap((m: any) => (m.tool_calls || []).map((tc: any) => tc.id))
  for (const tc of asst!.tool_calls as Array<{ id: string }>) {
    assert.ok(toolIds.includes(tc.id), `missing interrupted row for ${tc.id}`)
  }
  assert.ok(
    msgs
      .filter((m: any) => m.role === "tool")
      .every((m: any) => m.tool_calls?.[0]?.result?.success === false),
    "all fillers are failed/interrupted",
  )
})

test("abort during streaming persists non-empty partial reply as text-only", async () => {
  mode = "hold-content"
  const { manager, thread } = makeManager("m10-partial")
  const controller = new AbortController()

  // Abort deterministically on the first chat.token — that event fires exactly
  // when the SDK has parsed a content delta, so assistantContent is non-empty
  // when the abort propagates. (Polling a server-write flag races the SDK parse.)
  const params = chatParams(manager, thread, controller, async () => ({ success: true, data: {} }))
  params.sendToExtension = (data: any) => {
    if (data.type === "chat.token" && !controller.signal.aborted) {
      controller.abort()
    }
  }

  await chatCreate(params).catch(() => "aborted")

  const msgs = manager.getMessages(thread.id)
  // user + text-only assistant partial.
  assert.equal(msgs.length, 2, `expected user + partial assistant, got ${msgs.length}: ${JSON.stringify(msgs.map((m: any) => m.role))}`)
  const assistant = msgs.find((m: any) => m.role === "assistant")
  assert.ok(assistant, "partial assistant message should be persisted")
  assert.equal(assistant!.content, "partial reply text")
  assert.ok(!assistant!.tool_calls?.length, "partial assistant must be text-only (no dangling tool_calls)")
})

test("abort before any streamed content persists nothing extra", async () => {
  mode = "hold-empty"
  const { manager, thread } = makeManager("m10-empty")
  const controller = new AbortController()

  const chatPromise = chatCreate(chatParams(manager, thread, controller, async () => ({ success: true, data: {} }))).catch(() => "aborted")

  // Let the stream request land, then abort with no content delivered.
  await new Promise<void>(resolve => setTimeout(resolve, 40))
  controller.abort()
  await chatPromise

  const msgs = manager.getMessages(thread.id)
  // Only the user message — no partial, no assistant.
  assert.equal(msgs.length, 1, `expected only user message, got ${msgs.length}: ${JSON.stringify(msgs.map((m: any) => m.role))}`)
  assert.equal(msgs[0].role, "user")
})

// Inter-tool abort: keep the successful first tool, fill the rest as interrupted.
test("P0-B: inter-tool abort between tools keeps success and fills interrupted", async () => {
  mode = "two-tool-calls"
  const { manager, thread } = makeManager("m10-inter-tool")
  const controller = new AbortController()
  let callCount = 0
  const executeTool = async () => {
    callCount++
    // Complete first tool, then abort before the second loop iteration sees signal.
    if (callCount === 1) {
      // Schedule abort so the next for-loop check sees signal.aborted.
      controller.abort()
      return { success: true, data: { tabs: [] } }
    }
    return { success: true, data: {} }
  }

  await chatCreate(chatParams(manager, thread, controller, executeTool)).catch(() => "aborted")

  const msgs = manager.getMessages(thread.id)
  assert.equal(msgs[0].role, "user")
  const asst = msgs.find((m: any) => m.role === "assistant" && m.tool_calls?.length)
  assert.ok(asst)
  const tools = msgs.filter((m: any) => m.role === "tool")
  assert.equal(tools.length, 2, `expected 2 tool rows, got ${tools.length}`)
  const byId = new Map<string, any>(tools.flatMap((m: any) => (m.tool_calls || []).map((tc: any) => [tc.id, tc])))
  assert.equal(byId.get("call_A")?.result?.success, true)
  assert.equal(byId.get("call_B")?.result?.success, false)
  assert.equal(byId.get("call_B")?.result?.error_code, "INTERRUPTED")
})

// P0-B: multi-tool shouldStop (non_recoverable) keeps the failed row, fills the
// rest, and still must not emit chat.done after chat.error.
test("P0-B: multi-tool shouldStop/non_recoverable → keep failed row; no chat.done after chat.error", async () => {
  mode = "two-tool-calls"
  const { manager, thread } = makeManager("m10-shouldstop")
  const controller = new AbortController()
  const wire: any[] = []
  let callCount = 0
  const executeTool = async () => {
    callCount++
    // First tool fails non_recoverable (classifyError default for unknown errors).
    if (callCount === 1) {
      return { success: false, error: "permission denied: cannot access host filesystem" }
    }
    return { success: true, data: {} }
  }

  const params = chatParams(manager, thread, controller, executeTool)
  params.sendToExtension = (data: any) => { wire.push(data) }

  await chatCreate(params)

  const msgs = manager.getMessages(thread.id)
  assert.equal(msgs[0].role, "user")
  const asst = msgs.find((m: any) => m.role === "assistant" && m.tool_calls?.length)
  assert.ok(asst, "assistant with tool_calls stays after shouldStop")
  const tools = msgs.filter((m: any) => m.role === "tool")
  assert.equal(tools.length, 2)
  const byId = new Map<string, any>(tools.flatMap((m: any) => (m.tool_calls || []).map((tc: any) => [tc.id, tc])))
  assert.equal(byId.get("call_A")?.result?.success, false)
  assert.equal(byId.get("call_B")?.result?.error_code, "INTERRUPTED")

  const errors = wire.filter((m) => m.type === "chat.error")
  const dones = wire.filter((m) => m.type === "chat.done")
  assert.ok(errors.length >= 1, "shouldStop must emit chat.error")
  assert.equal(dones.length, 0, "terminal chat.error must NOT be followed by chat.done")
})
