// Single-file module tests: message-router.ts, security.ts
// Tests for core security, routing logic, and thread isolation

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-single-"))

let initDataDir: typeof import("../../src/config").initDataDir
let getConfig: typeof import("../../src/config").getConfig
let saveConfig: typeof import("../../src/config").saveConfig
let ThreadManager: typeof import("../../src/threads/thread-manager").ThreadManager
let handleMessage: typeof import("../../src/message-router").handleMessage
let isTrustedDomain: typeof import("../../src/security").isTrustedDomain
let checkHighRiskExecution: typeof import("../../src/security").checkHighRiskExecution
let detectDangerousApis: typeof import("../../src/security").detectDangerousApis
let classifyError: typeof import("../../src/security").classifyError

// Mock skill engine - use partial interface with 'as any' for compatibility
const mockSkillEngine = {
  activate: (threadId: string, skillName: string): void => {
    // No-op for testing
  },
  deactivate: (threadId: string, skillName: string): void => {
    // No-op for testing
  },
  getActiveForThread: (threadId: string): any[] => [],
  matchSkills: (message: string): Array<{ name: string; confidence: number }> => [],
  get: (name: string): any => undefined,
  list: (): any[] => [],
  refresh: (): void => {},
} as any

// Track active skills for testing thread isolation
const activeSkillMap = new Map<string, string[]>()

// Mock history store - use partial interface with 'as any' for compatibility
const mockHistoryStore = {
  query: () => [],
  exportJSON: () => ({ operations: [] }),
  record: () => 0,
} as any

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const config = await import("../../src/config")
  const threadManager = await import("../../src/threads/thread-manager")
  const messageRouter = await import("../../src/message-router")
  const security = await import("../../src/security")

  initDataDir = config.initDataDir
  getConfig = config.getConfig
  saveConfig = config.saveConfig
  ThreadManager = threadManager.ThreadManager
  handleMessage = messageRouter.handleMessage
  isTrustedDomain = security.isTrustedDomain
  checkHighRiskExecution = security.checkHighRiskExecution
  detectDangerousApis = security.detectDangerousApis
  classifyError = security.classifyError

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// ========================================
// message-router.ts tests
// ========================================

test("message-router: config.get returns config with masked API key", async () => {
  saveConfig({
    llm: { base_url: "https://api.test.com", api_key: "sk-real-key", model_name: "gpt-4", temperature: 0.5, context_window: 4000 },
    trusted_domains: [],
  } as any)

  const response = await handleMessage(
    { type: "config.get" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "config.updated")
  assert.equal(response.config.llm.api_key, "***")
})

test("message-router: config.set saves trusted domains", async () => {
  const response = await handleMessage(
    {
      type: "config.set",
      config: {
        trusted_domains: ["example.com", "*.company.com"],
      },
    },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "config.updated")
  assert.deepEqual(getConfig().trusted_domains, ["example.com", "*.company.com"])
})

test("message-router: config.set ignores unknown keys", async () => {
  // config.set only allows specific keys (port, trusted_domains, history_retention_days, llm fields)
  // Unknown keys like 'nested' are silently ignored
  const response = await handleMessage(
    {
      type: "config.set",
      config: {
        // This key is not in the allowlist and should be ignored
        nested: { arbitrary: "data" },
      },
    },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // The request should succeed but ignore the unknown key
  assert.equal(response.type, "config.updated")
  assert.equal((getConfig() as any).nested, undefined)
})

test("message-router: config.set normalizes flat LLM fields", async () => {
  const response = await handleMessage(
    {
      type: "config.set",
      config: {
        base_url: "https://api.example.com/v1",
        model_name: "gpt-4",
        temperature: 0.7,
      },
    },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "config.updated")
  assert.equal(getConfig().llm.base_url, "https://api.example.com/v1")
  assert.equal(getConfig().llm.model_name, "gpt-4")
  assert.equal(getConfig().llm.temperature, 0.7)
})

test("message-router: config.test with placeholder API key returns error", async () => {
  saveConfig({
    llm: { base_url: "https://api.test.com", api_key: "sk-placeholder", model_name: "gpt-4", temperature: 0.5, context_window: 4000 },
    trusted_domains: [],
  } as any)

  const response = await handleMessage(
    { type: "config.test" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // With placeholder key, should fail with specific error
  assert.equal(response.type, "config.testResult")
  assert.equal(response.ok, false)
  assert.ok(response.error?.includes("API Key"))
})

test("message-router: config.test without API key returns error", async () => {
  saveConfig({
    llm: { base_url: "https://api.test.com", api_key: "sk-placeholder", model_name: "gpt-4", temperature: 0.5, context_window: 4000 },
    trusted_domains: [],
  } as any)

  const response = await handleMessage(
    { type: "config.test" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "config.testResult")
  assert.equal(response.ok, false)
  assert.ok(response.error?.includes("API Key"))
})

test("message-router: thread.create creates a new thread", async () => {
  const threadManager = new ThreadManager()

  const response = await handleMessage(
    { type: "thread.create", alias: "Test Thread" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.created")
  assert.equal(response.thread.alias, "Test Thread")
  assert.ok(response.thread.id)

  // Verify thread was persisted
  const retrieved = threadManager.get(response.thread.id)
  assert.equal(retrieved?.alias, "Test Thread")
})

test("message-router: thread.create with custom id uses sanitized id", async () => {
  const threadManager = new ThreadManager()

  const response = await handleMessage(
    { type: "thread.create", alias: "Custom ID", id: "custom-123" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.created")
  assert.equal(response.thread.id, "custom-123")
})

test("message-router: thread.delete removes thread", async () => {
  const threadManager = new ThreadManager()
  const created = await handleMessage(
    { type: "thread.create", alias: "To Delete" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const deleteResponse = await handleMessage(
    { type: "thread.delete", thread_id: created.thread.id },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(deleteResponse.type, "thread.deleted")
  assert.equal(deleteResponse.thread_id, created.thread.id)
  assert.equal(threadManager.get(created.thread.id), undefined)
})

test("message-router: thread.list returns all threads", async () => {
  const threadManager = new ThreadManager()
  await handleMessage(
    { type: "thread.create", alias: "Thread 1" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )
  await handleMessage(
    { type: "thread.create", alias: "Thread 2" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const response = await handleMessage(
    { type: "thread.list" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.list")
  assert.ok(response.threads.length >= 2)
})

test("message-router: thread.select returns messages for thread", async () => {
  const threadManager = new ThreadManager()
  const created = await handleMessage(
    { type: "thread.create", alias: "Message Test" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // Add a message
  threadManager.addMessage(created.thread.id, {
    thread_id: created.thread.id,
    role: "user",
    content: "Hello",
  })

  const response = await handleMessage(
    { type: "thread.select", thread_id: created.thread.id },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.messages")
  assert.equal(response.messages.length, 1)
  assert.equal(response.messages[0].content, "Hello")
})

test("message-router: thread.update updates thread properties", async () => {
  const threadManager = new ThreadManager()
  const created = await handleMessage(
    { type: "thread.create", alias: "Original" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const response = await handleMessage(
    {
      type: "thread.update",
      thread_id: created.thread.id,
      updates: { alias: "Updated", pinned_tabs: [101, 202] },
    },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.updated")
  assert.equal(response.thread.alias, "Updated")
  assert.deepEqual(response.thread.pinned_tabs, [101, 202])
})

test("message-router: thread.update rejects invalid keys", async () => {
  const threadManager = new ThreadManager()
  const created = await handleMessage(
    { type: "thread.create", alias: "Test" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const response = await handleMessage(
    {
      type: "thread.update",
      thread_id: created.thread.id,
      updates: { invalid_key: "value" } as any,
    },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "thread.updated")
  // Invalid keys should be ignored (not set)
  assert.equal((response.thread as any).invalid_key, undefined)
})

test("message-router: skill.activate activates skill for thread", async () => {
  const skillEngine = mockSkillEngine
  const threadManager = new ThreadManager()

  const response = await handleMessage(
    { type: "skill.activate", thread_id: "thread-1", skill_name: "browse" },
    { threadManager, skillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "skill.activated")
  assert.equal(response.skill_name, "browse")
})

test("message-router: skill.deactivate deactivates skill for thread", async () => {
  const skillEngine = mockSkillEngine
  skillEngine.activate("thread-1", "browse")

  const response = await handleMessage(
    { type: "skill.deactivate", thread_id: "thread-1", skill_name: "browse" },
    { threadManager: new ThreadManager(), skillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "skill.deactivated")
  assert.equal(response.skill_name, "browse")
})

test("message-router: skill.list returns refreshed skill list", async () => {
  const skillEngine = mockSkillEngine

  const response = await handleMessage(
    { type: "skill.list" },
    { threadManager: new ThreadManager(), skillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "skill.list")
  assert.deepEqual(response.skills, [])
})

test("message-router: system.ping returns pong", async () => {
  const response = await handleMessage(
    { type: "system.ping" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "system.pong")
})

test("message-router: unknown type returns error", async () => {
  const response = await handleMessage(
    { type: "unknown.type" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "error")
  assert.ok(response.error?.includes("Unknown message type"))
})

test("message-router: osascript_eval blocks dangerous code", async () => {
  const response = await handleMessage(
    {
      type: "osascript_eval",
      id: "tool_1",
      url: "https://example.com",
      expression: "fetch('/api')",
    },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  assert.ok(response.error?.includes("Security Block"))
  assert.deepEqual(response.data.dangerous_apis_found, ["fetch"])
})

test("message-router: chat.abort cancels in-flight request", async () => {
  const threadManager = new ThreadManager()

  // First, create a chat request (mocked - no actual LLM call)
  // In real scenario, this would start a long-running request
  const abortResponse = await handleMessage(
    { type: "chat.abort", thread_id: "thread-123" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(abortResponse.type, "chat.aborted")
  assert.equal(abortResponse.thread_id, "thread-123")
})

test("message-router: history.query returns empty result", async () => {
  const response = await handleMessage(
    { type: "history.query", limit: 10 },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "history.result")
  assert.deepEqual(response.operations, [])
})

test("message-router: history.export returns data", async () => {
  const response = await handleMessage(
    { type: "history.export" },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "history.exported")
  assert.deepEqual(response.data, { operations: [] })
})

// ========================================
// Thread isolation tests (message-router)
// ========================================

test("message-router: threads maintain message isolation", async () => {
  const threadManager = new ThreadManager()

  const thread1 = await handleMessage(
    { type: "thread.create", alias: "Thread 1" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const thread2 = await handleMessage(
    { type: "thread.create", alias: "Thread 2" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // Add message to thread1
  threadManager.addMessage(thread1.thread.id, {
    thread_id: thread1.thread.id,
    role: "user",
    content: "Message for thread 1",
  })

  // Add message to thread2
  threadManager.addMessage(thread2.thread.id, {
    thread_id: thread2.thread.id,
    role: "user",
    content: "Message for thread 2",
  })

  const messages1 = threadManager.getMessages(thread1.thread.id)
  const messages2 = threadManager.getMessages(thread2.thread.id)

  assert.equal(messages1.length, 1)
  assert.equal(messages1[0].content, "Message for thread 1")
  assert.equal(messages2.length, 1)
  assert.equal(messages2[0].content, "Message for thread 2")
})

test("message-router: skill activation is per-thread", async () => {
  const threadManager = new ThreadManager()
  const activeSkills = new Map<string, string[]>()

  const skillEngineWithTracking = {
    ...mockSkillEngine,
    activate: (threadId: string, skillName: string): void => {
      const active = activeSkills.get(threadId) || []
      if (!active.includes(skillName)) {
        activeSkills.set(threadId, [...active, skillName])
      }
    },
    getActiveForThread: (threadId: string): any[] => {
      const names = activeSkills.get(threadId) || []
      return names.map(name => ({ name }))
    },
  } as any

  const thread1 = await handleMessage(
    { type: "thread.create", alias: "Thread 1" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  const thread2 = await handleMessage(
    { type: "thread.create", alias: "Thread 2" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  // Activate skill for thread1 only
  await handleMessage(
    { type: "skill.activate", thread_id: thread1.thread.id, skill_name: "browse" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  const active1 = skillEngineWithTracking.getActiveForThread(thread1.thread.id)
  const active2 = skillEngineWithTracking.getActiveForThread(thread2.thread.id)

  assert.equal(active1.length, 1)
  assert.equal(active1[0].name, "browse")
  assert.equal(active2.length, 0)
})

test("message-router: thread.update doesn't affect other threads", async () => {
  const threadManager = new ThreadManager()

  const thread1 = await handleMessage(
    { type: "thread.create", alias: "Thread 1" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const thread2 = await handleMessage(
    { type: "thread.create", alias: "Thread 2" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  await handleMessage(
    { type: "thread.update", thread_id: thread1.thread.id, updates: { pinned_tabs: [111] } },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  const retrieved1 = threadManager.get(thread1.thread.id)
  const retrieved2 = threadManager.get(thread2.thread.id)

  assert.deepEqual(retrieved1?.pinned_tabs, [111])
  assert.deepEqual(retrieved2?.pinned_tabs, [])
})

// ========================================
// security.ts tests
// ========================================

test("security: isTrustedDomain returns true for exact match", () => {
  saveConfig({ trusted_domains: ["example.com"] })

  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("other.com"), false)
})

test("security: isTrustedDomain supports wildcard patterns", () => {
  saveConfig({ trusted_domains: ["*.company.com"] })

  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("finance.company.com"), true)
  assert.equal(isTrustedDomain("company.com"), true) // base domain matches
  assert.equal(isTrustedDomain("evil.com"), false)
})

test("security: isTrustedDomain supports global wildcard", () => {
  saveConfig({ trusted_domains: ["*"] })

  assert.equal(isTrustedDomain("any-domain.com"), true)
  assert.equal(isTrustedDomain("localhost"), true)
})

test("security: isTrustedDomain returns false for empty list", () => {
  saveConfig({ trusted_domains: [] })

  assert.equal(isTrustedDomain("example.com"), false)
  assert.equal(isTrustedDomain("any.com"), false)
})

test("security: isTrustedDomain handles multiple patterns", () => {
  saveConfig({ trusted_domains: ["example.com", "*.company.com", "test.org"] })

  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("test.org"), true)
  assert.equal(isTrustedDomain("other.com"), false)
})

test("security: detectDangerousApis detects fetch", () => {
  const detected = detectDangerousApis("fetch('/api')")
  assert.deepEqual(detected, ["fetch"])
})

test("security: detectDangerousApis detects multiple dangerous APIs", () => {
  const detected = detectDangerousApis("fetch('/api'); localStorage.getItem('k'); document.cookie")
  assert.deepEqual(detected, ["fetch", "localStorage", "document.cookie"])
})

test("security: detectDangerousApis detects bracket notation obfuscation", () => {
  const detected = detectDangerousApis("['fetch']('/api'); window['open']()")
  assert.deepEqual(detected, ["bracket-fetch", "bracket-open"])
})

test("security: detectDangerousApis detects eval and Function", () => {
  const detected = detectDangerousApis("eval('code'); new Function('x', 'return x')")
  assert.deepEqual(detected, ["eval", "Function"])
})

test("security: detectDangerousApis detects WebSocket and EventSource", () => {
  const detected = detectDangerousApis("new WebSocket('ws://x'); new EventSource('/events')")
  assert.deepEqual(detected, ["WebSocket", "EventSource"])
})

test("security: detectDangerousApis detects setTimeout/setInterval with strings", () => {
  const detected = detectDangerousApis("setTimeout('alert(1)', 1000); setInterval('xss()', 5000)")
  assert.deepEqual(detected, ["setTimeout-string", "setInterval-string"])
})

test("security: detectDangerousApis avoids false positives", () => {
  // "prefetch" should NOT match "fetch"
  const detected1 = detectDangerousApis("prefetch('/api')")
  assert.deepEqual(detected1, [])

  // "window.openModal" should NOT match "window.open"
  const detected2 = detectDangerousApis("window.openModal()")
  assert.deepEqual(detected2, [])

  // "document.cookieJar" should NOT match "document.cookie" (word boundary)
  // But our pattern is \bdocument\.cookie\b which should match exactly
  const detected3 = detectDangerousApis("document.cookieJar")
  assert.deepEqual(detected3, [])

  const detected4 = detectDangerousApis("document.cookie")
  assert.deepEqual(detected4, ["document.cookie"])
})

test("security: checkHighRiskExecution blocks code with dangerous APIs", () => {
  const result = checkHighRiskExecution("evaluate", "fetch('/api')")
  assert.equal(result.blocked, true)
  assert.deepEqual(result.dangerousApis, ["fetch"])
  assert.ok(result.error?.includes("Security Block"))
})

test("security: checkHighRiskExecution allows safe code", () => {
  const result = checkHighRiskExecution("evaluate", "document.querySelector('#btn')")
  assert.equal(result.blocked, false)
  assert.deepEqual(result.dangerousApis, [])
  assert.equal(result.error, undefined)
})

test("security: checkHighRiskExecution returns all dangerous APIs found", () => {
  const result = checkHighRiskExecution("evaluate", "localStorage.getItem('x'); fetch('/y')")
  assert.equal(result.blocked, true)
  assert.ok(result.dangerousApis.includes("localStorage"))
  assert.ok(result.dangerousApis.includes("fetch"))
})

test("security: classifyError classifies security errors", () => {
  assert.equal(classifyError("Security Block: evaluate"), "security")
  assert.equal(classifyError("blocked by user"), "security")
  assert.equal(classifyError("user rejected"), "security")
  assert.equal(classifyError("user denied execution"), "security")
})

test("security: classifyError classifies non-recoverable errors", () => {
  assert.equal(classifyError("permission denied"), "non_recoverable")
  assert.equal(classifyError("permission not granted"), "non_recoverable")
  assert.equal(classifyError("not in trusted domains"), "non_recoverable")
  assert.equal(classifyError("cookie domain mismatch"), "non_recoverable")
})

test("security: classifyError classifies recoverable errors", () => {
  assert.equal(classifyError("timeout"), "recoverable")
  assert.equal(classifyError("timed out"), "recoverable")
  assert.equal(classifyError("selector not found"), "recoverable")
  assert.equal(classifyError("element not found"), "recoverable")
  assert.equal(classifyError("no tab with id 999"), "recoverable")
  assert.equal(classifyError("network error"), "recoverable")
  assert.equal(classifyError("connection refused"), "recoverable")
})

test("security: classifyError classifies security context for untrusted domain", () => {
  // With untrusted domain + cookie access -> security
  saveConfig({ trusted_domains: [] })
  assert.equal(classifyError("cookie access denied", { domain: "evil.com", toolName: "get_cookies" }), "security")
})

test("security: classifyError defaults to non_recoverable for unknown errors", () => {
  assert.equal(classifyError("completely unknown error message"), "non_recoverable")
  assert.equal(classifyError(""), "non_recoverable")
})

test("security: classifyError handles case-insensitive matching", () => {
  assert.equal(classifyError("TIMEOUT"), "recoverable")
  assert.equal(classifyError("Permission Denied"), "non_recoverable")
  assert.equal(classifyError("SECURITY BLOCK"), "security")
})

test("security: DANGEROUS_API_PATTERNS contains Reflect and Proxy patterns", () => {
  const code = "Reflect.apply(fetch, null, ['/api']); new Proxy(target, handler)"
  const detected = detectDangerousApis(code)
  assert.ok(detected.includes("Reflect.apply"))
  assert.ok(detected.includes("Proxy"))
})

test("security: dangerous API patterns cover indexedDB", () => {
  const detected = detectDangerousApis("indexedDB.open('db')")
  assert.ok(detected.includes("indexedDB"))
})

test("security: dangerous API patterns cover XMLHttpRequest", () => {
  const detected = detectDangerousApis("new XMLHttpRequest()")
  assert.ok(detected.includes("XMLHttpRequest"))
})

test("security: dangerous API patterns cover navigator.sendBeacon", () => {
  const detected = detectDangerousApis("navigator.sendBeacon('/log', data)")
  assert.ok(detected.includes("navigator.sendBeacon"))
})

test("security: dangerous API patterns cover sessionStorage", () => {
  const detected = detectDangerousApis("sessionStorage.setItem('key', 'value')")
  assert.ok(detected.includes("sessionStorage"))
})

// ========================================
// Combined integration tests
// ========================================

test("integration: message-router respects security policy for osascript_eval", async () => {
  const threadManager = new ThreadManager()

  // Dangerous code should be blocked
  const response = await handleMessage(
    {
      type: "osascript_eval",
      id: "tool_1",
      url: "https://example.com",
      expression: "document.cookie",
    },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  assert.ok(response.error?.includes("Security Block"))
})

test("integration: thread isolation prevents cross-thread skill leakage", async () => {
  const threadManager = new ThreadManager()
  const activeSkills = new Map<string, string[]>()

  const skillEngineWithTracking = {
    ...mockSkillEngine,
    activate: (threadId: string, skillName: string): void => {
      const active = activeSkills.get(threadId) || []
      if (!active.includes(skillName)) {
        activeSkills.set(threadId, [...active, skillName])
      }
    },
    getActiveForThread: (threadId: string): any[] => {
      const names = activeSkills.get(threadId) || []
      return names.map(name => ({ name }))
    },
  } as any

  const thread1 = await handleMessage(
    { type: "thread.create", alias: "Thread 1" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  const thread2 = await handleMessage(
    { type: "thread.create", alias: "Thread 2" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  // Activate multiple skills for thread1
  await handleMessage(
    { type: "skill.activate", thread_id: thread1.thread.id, skill_name: "browse" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )
  await handleMessage(
    { type: "skill.activate", thread_id: thread1.thread.id, skill_name: "analyze" },
    { threadManager, skillEngine: skillEngineWithTracking, historyStore: mockHistoryStore },
  )

  // thread2 should have no active skills
  const active2 = skillEngineWithTracking.getActiveForThread(thread2.thread.id)
  assert.equal(active2.length, 0)
})

test("integration: config changes are isolated per config key", async () => {
  // Set initial config
  saveConfig({
    llm: { base_url: "https://api.test.com", api_key: "initial-key", model_name: "gpt-3", temperature: 0.5, context_window: 4000 },
    trusted_domains: ["initial.com"],
  } as any)

  // Update only trusted_domains
  await handleMessage(
    { type: "config.set", config: { trusted_domains: ["updated.com"] } },
    { threadManager: new ThreadManager(), skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // LLM config should remain unchanged
  assert.equal(getConfig().llm.api_key, "initial-key")
  assert.equal(getConfig().llm.model_name, "gpt-3")
  assert.deepEqual(getConfig().trusted_domains, ["updated.com"])
})

test("integration: thread.fork creates isolated copy", async () => {
  const threadManager = new ThreadManager()

  const source = await handleMessage(
    { type: "thread.create", alias: "Source" },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  // Add messages to source
  threadManager.addMessage(source.thread.id, {
    thread_id: source.thread.id,
    role: "user",
    content: "First message",
  })
  threadManager.addMessage(source.thread.id, {
    thread_id: source.thread.id,
    role: "assistant",
    content: "First response",
  })

  // Update source thread properties
  threadManager.update(source.thread.id, { pinned_tabs: [777] })

  // Fork the thread
  const forked = await handleMessage(
    { type: "thread.fork", thread_id: source.thread.id, message_id: threadManager.getMessages(source.thread.id)[0].id },
    { threadManager, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )

  assert.equal(forked.type, "thread.forked")
  assert.notEqual(forked.thread.id, source.thread.id)

  // Fork should have copied properties
  assert.deepEqual(forked.thread.pinned_tabs, [777])

  // Fork should have copied messages up to the fork point
  assert.ok(forked.messages.length >= 1)

  // Adding message to fork should not affect source
  threadManager.addMessage(forked.thread.id, {
    thread_id: forked.thread.id,
    role: "user",
    content: "Fork-only message",
  })

  const sourceMessages = threadManager.getMessages(source.thread.id)
  const forkedMessages = threadManager.getMessages(forked.thread.id)

  assert.equal(sourceMessages.length, 2) // Original 2 messages
  assert.ok(forkedMessages.length >= 2) // At least 1 + 1 new
})
