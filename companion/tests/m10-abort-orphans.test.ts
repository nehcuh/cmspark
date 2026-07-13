// Integration test for P2-2 M10 — abort orphan messages.
// See docs/p2-2-m10-abort-orphans-rfc-2026-07-13.md.
//
// Mirrors the m2-untrusted-marker fake-server pattern: the OpenAI SDK (v4)
// resolves fetch from node-fetch (captured at module load), so we stand up a
// real local HTTP server at base_url that returns crafted SSE to drive
// chatCreate through real tool-call rounds. We then abort a real
// AbortController and assert the persisted thread is left consistent (no
// assistant tool_calls without matching tool results).

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

test("abort during tool execution rolls back the partial round (no dangling tool_calls)", async () => {
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
  // Rollback via deleteMessagesFrom(savedAssistantId) must have removed the
  // persisted assistant message (2 tool_calls) and any partial tool result,
  // leaving only the user message — so the next turn won't 400.
  assert.equal(msgs.length, 1, `expected only the user message after rollback, got ${msgs.length}: ${JSON.stringify(msgs.map((m: any) => m.role))}`)
  assert.equal(msgs[0].role, "user")
  assert.ok(!msgs.some((m: any) => m.role === "assistant" && m.tool_calls?.length), "no assistant message with dangling tool_calls should remain")
  assert.ok(!msgs.some((m: any) => m.role === "tool"), "no orphan tool-result message should remain")
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
