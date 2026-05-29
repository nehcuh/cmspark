import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-"))

let initDataDir: typeof import("../src/config").initDataDir
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let isTrustedDomain: typeof import("../src/security").isTrustedDomain
let detectDangerousApis: typeof import("../src/security").detectDangerousApis
let checkHighRiskExecution: typeof import("../src/security").checkHighRiskExecution
let classifyError: typeof import("../src/security").classifyError
let handleMessage: typeof import("../src/message-router").handleMessage
let createToolResultMessage: typeof import("../src/llm/adapter").createToolResultMessage
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let redactLogData: typeof import("../src/logger").redactLogData
let logEvent: typeof import("../src/logger").logEvent
let getLogFilePath: typeof import("../src/logger").getLogFilePath

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const config = await import("../src/config")
  const threadManager = await import("../src/threads/thread-manager")
  const security = await import("../src/security")
  const messageRouter = await import("../src/message-router")
  const adapter = await import("../src/llm/adapter")
  const securityConfirmation = await import("../src/security-confirmation")
  const logger = await import("../src/logger")

  initDataDir = config.initDataDir
  getConfig = config.getConfig
  saveConfig = config.saveConfig
  ThreadManager = threadManager.ThreadManager
  isTrustedDomain = security.isTrustedDomain
  detectDangerousApis = security.detectDangerousApis
  checkHighRiskExecution = security.checkHighRiskExecution
  classifyError = security.classifyError
  handleMessage = messageRouter.handleMessage
  createToolResultMessage = adapter.createToolResultMessage
  SecurityConfirmationManager = securityConfirmation.SecurityConfirmationManager
  redactLogData = logger.redactLogData
  logEvent = logger.logEvent
  getLogFilePath = logger.getLogFilePath

  await initDataDir()
})

test("tool result messages persist with OpenAI-compatible tool call linkage", () => {
  const manager = new ThreadManager()
  const thread = manager.create("Tool result regression", "tool01")
  const toolCall = {
    id: "call_123",
    function: { name: "get_page_text", arguments: "{\"tabId\":303}" },
  }
  const result = { success: true, data: { text: "hello" } }

  manager.addMessage(thread.id, createToolResultMessage(thread.id, toolCall, result, { tabId: 303 }))

  const [message] = manager.getMessages(thread.id)
  assert.equal(message.role, "tool")
  assert.equal(message.thread_id, thread.id)
  assert.equal(message.content, JSON.stringify(result))
  assert.deepEqual(message.tool_calls?.[0], {
    id: "call_123",
    tool_name: "get_page_text",
    params: { tabId: 303 },
    result,
  })
})

test("thread.update route persists pinned tabs through the message router", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("Router update regression", "upd123")

  const response = await handleMessage(
    { type: "thread.update", thread_id: thread.id, updates: { pinned_tabs: [303] } },
    { threadManager: manager, skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "thread.updated")
  assert.deepEqual(response.thread.pinned_tabs, [303])
  assert.deepEqual(new ThreadManager().get(thread.id)?.pinned_tabs, [303])
})

test("config.set persists trusted domains without saving masked API keys", async () => {
  saveConfig({ llm: { api_key: "real-key" } as any, trusted_domains: [] })

  const response = await handleMessage(
    {
      type: "config.set",
      config: {
        base_url: "https://example.test/v1",
        api_key: "***",
        model_name: "model-x",
        temperature: 0.2,
        context_window: 4096,
        trusted_domains: ["example.com", "*.company.com"],
      },
    },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "config.updated")
  assert.deepEqual(getConfig().trusted_domains, ["example.com", "*.company.com"])
  assert.equal(getConfig().llm.api_key, "real-key")
  assert.equal(response.config.llm.api_key, "***")

  await handleMessage(
    { type: "config.set", config: { trusted_domains: [] } },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.deepEqual(getConfig().trusted_domains, [])
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("ThreadManager.update persists pinned tab state", () => {
  const manager = new ThreadManager()
  const thread = manager.create("Pinned tabs regression", "pin123")

  const updated = manager.update(thread.id, { pinned_tabs: [101, 202] })

  assert.deepEqual(updated?.pinned_tabs, [101, 202])
  const reloaded = new ThreadManager()
  assert.deepEqual(reloaded.get(thread.id)?.pinned_tabs, [101, 202])
})

test("trusted domain matching supports exact, wildcard, and global patterns", () => {
  saveConfig({ trusted_domains: ["example.com", "*.company.com"] })

  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("company.com"), true)
  assert.equal(isTrustedDomain("evil.com"), false)

  saveConfig({ trusted_domains: ["*"] })
  assert.equal(isTrustedDomain("*"), true)
  assert.equal(isTrustedDomain("anywhere.test"), true)
})

test("dangerous JavaScript APIs are detected before evaluate-style execution", () => {
  assert.deepEqual(
    detectDangerousApis("fetch('/api'); document.cookie; localStorage.getItem('k')"),
    ["fetch", "localStorage", "document.cookie"],
  )
  assert.deepEqual(detectDangerousApis("document.body?.innerText || ''"), [])
})

test("high-risk execution is blocked before osascript_eval can run", async () => {
  const safety = checkHighRiskExecution("evaluate", "fetch('/api')")
  assert.equal(safety.blocked, true)
  assert.deepEqual(safety.dangerousApis, ["fetch"])

  // Verify no false positives: "prefetch" should NOT match
  const safeResult = checkHighRiskExecution("evaluate", "prefetch('/api')")
  assert.equal(safeResult.blocked, false)

  const response = await handleMessage(
    { type: "osascript_eval", id: "tool_1", url: "example.com", expression: "document.cookie" },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  assert.match(response.error, /Security Block/)
  assert.deepEqual(response.data.dangerous_apis_found, ["document.cookie"])
})

test("security block errors are classified as security stops", () => {
  assert.equal(classifyError("Security Block: evaluate contains high-risk APIs (fetch(). User denied execution."), "security")
})

test("script injection failures are recoverable so the agent can try fallback tools", () => {
  assert.equal(classifyError("Script injection failed in both ISOLATED and MAIN worlds", { toolName: "get_page_html" }), "recoverable")
  assert.equal(classifyError("Script injection failed in both ISOLATED and MAIN worlds; DOM fallback failed: Debugger attach failed", { toolName: "get_page_html" }), "recoverable")
})

test("classifyError 'No tab with id 303' is recoverable", () => {
  assert.equal(classifyError("No tab with id 303", { toolName: "get_page_text" }), "recoverable")
})

test("classifyError 'unknown error' defaults to non_recoverable", () => {
  assert.equal(classifyError("completely unknown error message"), "non_recoverable")
})

test("classifyError 'permission denied: camera' is non_recoverable", () => {
  assert.equal(classifyError("permission denied: camera access"), "non_recoverable")
})

test("classifyError 'timeout waiting for selector' is recoverable", () => {
  assert.equal(classifyError("timeout waiting for selector '#btn'"), "recoverable")
})
test("logger redacts sensitive keys recursively", () => {
  const redacted = redactLogData({
    api_key: "sk-secret",
    headers: {
      authorization: "Bearer token",
      cookie: "sid=123",
      safe: "value",
    },
    nested: [
      {
        password: "pw",
        access_token: "token",
        ok: true,
      },
    ],
  }) as any

  assert.equal(redacted.api_key, "[REDACTED]")
  assert.equal(redacted.headers.authorization, "[REDACTED]")
  assert.equal(redacted.headers.cookie, "[REDACTED]")
  assert.equal(redacted.headers.safe, "value")
  assert.equal(redacted.nested[0].password, "[REDACTED]")
  assert.equal(redacted.nested[0].access_token, "[REDACTED]")
  assert.equal(redacted.nested[0].ok, true)
})

test("logger writes redacted JSONL entries under logs directory", () => {
  const now = new Date("2026-01-02T03:04:05.000Z")
  const filePath = getLogFilePath(now)
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true })

  logEvent("info", "test.event", { api_key: "sk-secret", count: 1 }, "test", now)

  const [line] = fs.readFileSync(filePath, "utf-8").trim().split("\n")
  const entry = JSON.parse(line)
  assert.equal(entry.ts, "2026-01-02T03:04:05.000Z")
  assert.equal(entry.level, "info")
  assert.equal(entry.source, "test")
  assert.equal(entry.event, "test.event")
  assert.equal(entry.data.api_key, "[REDACTED]")
  assert.equal(entry.data.count, 1)
})

test("security confirmation manager resolves approval and denial responses", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(1000)

  const approvedPromise = manager.request((msg) => sent.push(msg), {
    toolName: "evaluate",
    dangerousApis: ["fetch("],
    code: "fetch('/api')",
  })
  assert.equal(sent[0].type, "security.confirmation.request")
  assert.equal(manager.respond(sent[0].confirmation_id, true), true)
  assert.deepEqual(await approvedPromise, {
    confirmationId: sent[0].confirmation_id,
    approved: true,
    reason: "approved",
  })
  assert.equal(sent[1].type, "security.confirmation.resolved")

  const deniedPromise = manager.request((msg) => sent.push(msg), {
    toolName: "osascript_eval",
    dangerousApis: ["document.cookie"],
    code: "document.cookie",
  })
  const deniedRequest = sent[sent.length - 1]
  assert.equal(manager.respond(deniedRequest.confirmation_id, false), true)
  assert.deepEqual(await deniedPromise, {
    confirmationId: deniedRequest.confirmation_id,
    approved: false,
    reason: "denied",
  })
})

test("security confirmation manager times out unresolved requests", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(5)

  const decision = await manager.request((msg) => sent.push(msg), {
    toolName: "evaluate",
    dangerousApis: ["localStorage"],
    code: "localStorage.getItem('k')",
  })

  assert.equal(decision.approved, false)
  assert.equal(decision.reason, "timeout")
  assert.equal(sent[1].type, "security.confirmation.expired")
})
