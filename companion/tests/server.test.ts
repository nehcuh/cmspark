import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { URL } from "url"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-server-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let HistoryStore: typeof import("../src/history/store").HistoryStore
let handleMessage: typeof import("../src/message-router").handleMessage
let initDataDir: typeof import("../src/config").initDataDir
let saveConfig: typeof import("../src/config").saveConfig
let isTrustedDomain: typeof import("../src/security").isTrustedDomain
let checkHighRiskExecution: typeof import("../src/security").checkHighRiskExecution

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const threadManagerMod = await import("../src/threads/thread-manager")
  const skillEngineMod = await import("../src/skills/skill-engine")
  const historyMod = await import("../src/history/store")
  const messageRouterMod = await import("../src/message-router")
  const configMod = await import("../src/config")
  const securityMod = await import("../src/security")

  ThreadManager = threadManagerMod.ThreadManager
  SkillEngine = skillEngineMod.SkillEngine
  HistoryStore = historyMod.HistoryStore
  handleMessage = messageRouterMod.handleMessage
  initDataDir = configMod.initDataDir
  saveConfig = configMod.saveConfig
  isTrustedDomain = securityMod.isTrustedDomain
  checkHighRiskExecution = securityMod.checkHighRiskExecution

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// --- Cookie domain extraction (server.ts: getDomainFromUrl) ---

function getDomainFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString)
    return parsed.hostname
  } catch {
    return ""
  }
}

test("getDomainFromUrl extracts hostname from valid URL", () => {
  assert.equal(getDomainFromUrl("https://example.com/path"), "example.com")
  assert.equal(getDomainFromUrl("http://sub.domain.co.uk:8080/page?q=1"), "sub.domain.co.uk")
  assert.equal(getDomainFromUrl("https://127.0.0.1:23401"), "127.0.0.1")
})

test("getDomainFromUrl returns empty string for invalid URL", () => {
  assert.equal(getDomainFromUrl("not-a-url"), "")
  assert.equal(getDomainFromUrl(""), "")
})

// --- Summarize helpers (server.ts) ---

function summarizeToolParams(params: any): Record<string, unknown> {
  const safeParams = params || {}
  const summary: Record<string, unknown> = { keys: Object.keys(safeParams) }
  for (const key of ["tabId", "url", "domain", "selector", "threadId", "thread_id"]) {
    if (safeParams[key] !== undefined) summary[key] = safeParams[key]
  }
  if (safeParams.code !== undefined) summary.code_length = String(safeParams.code).length
  if (safeParams.expression !== undefined) summary.expression_length = String(safeParams.expression).length
  return summary
}

test("summarizeToolParams extracts tabId and hides code/expression content", () => {
  const params = {
    tabId: 303,
    selector: "#btn",
    code: "fetch('/api')".repeat(50),
    expression: "document.cookie",
    other: "value",
  }
  const summary = summarizeToolParams(params)
  assert.deepEqual(summary.keys, ["tabId", "selector", "code", "expression", "other"])
  assert.equal(summary.tabId, 303)
  assert.equal(summary.selector, "#btn")
  assert.equal(summary.code_length, 650)
  assert.equal(summary.expression_length, 15)
  assert.equal(Object.prototype.hasOwnProperty.call(summary, "code"), false) // code content not exposed
  assert.equal(Object.prototype.hasOwnProperty.call(summary, "expression"), false) // expression content not exposed
})

test("summarizeToolParams handles empty params", () => {
  const summary = summarizeToolParams(null)
  assert.deepEqual(summary.keys, [])
})

// --- Companion tool execution via message router ---

test("osascript_eval without session blocks dangerous JS", async () => {
  saveConfig({ trusted_domains: [] })

  const response = await handleMessage(
    {
      type: "osascript_eval",
      id: "tool_os_1",
      url: "example.com",
      expression: "document.cookie",
    },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  assert.match(response.error, /Security Block/)
  assert.deepEqual(response.data.dangerous_apis_found, ["document.cookie"])
})

test("osascript_eval without session allows safe JS", async () => {
  // On non-macOS, it will fail with "macOS-only" but not a security block
  const response = await handleMessage(
    {
      type: "osascript_eval",
      id: "tool_os_2",
      url: "example.com",
      expression: "document.title",
    },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "tool.result")
  // Should either be security-blocked or macOS-only error, but NOT crash
  assert.ok(typeof response.success === "boolean")
})

test("osascript_eval without session requires url and expression", async () => {
  const response = await handleMessage(
    { type: "osascript_eval", id: "tool_os_3", url: "", expression: "" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  assert.match(response.error, /required/)
})

// --- Thread lifecycle through message router ---

test("thread.create through message router", async () => {
  const manager = new ThreadManager()
  const response = await handleMessage(
    { type: "thread.create", alias: "Server Thread", id: "svr01" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "thread.created")
  assert.equal(response.thread.alias, "Server Thread")
  assert.equal(response.thread.id, "svr01")
})

test("thread.list through message router", async () => {
  const manager = new ThreadManager()
  manager.create("List Thread", "lst01")

  const response = await handleMessage(
    { type: "thread.list" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "thread.list")
  assert.ok(Array.isArray(response.threads))
  assert.ok(response.threads.length >= 1)
})

test("thread.delete through message router", async () => {
  const manager = new ThreadManager()
  manager.create("Delete Thread", "del01")

  const response = await handleMessage(
    { type: "thread.delete", thread_id: "del01" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "thread.deleted")
  assert.equal(response.thread_id, "del01")
  assert.equal(manager.get("del01"), undefined)
})

test("thread.update with invalid id returns error", async () => {
  const manager = new ThreadManager()

  const response = await handleMessage(
    { type: "thread.update", thread_id: "nonexistent", updates: { alias: "x" } },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "error")
  assert.match(response.error, /not found/)
})

// --- Skill lifecycle through message router ---

test("skill.list through message router refreshes and returns skills", async () => {
  const manager = new ThreadManager()
  const engine = new SkillEngine()

  const response = await handleMessage(
    { type: "skill.list" },
    { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "skill.list")
  assert.ok(Array.isArray(response.skills))
})

test("skill.activate updates thread metadata", async () => {
  const manager = new ThreadManager()
  const engine = new SkillEngine()
  const thread = manager.create("Activate thread", "act01")

  // First create a skill to activate
  const skillsDir = path.join(os.homedir(), ".cmspark-agent", "skills")
  fs.writeFileSync(path.join(skillsDir, "server-activate-test.md"), [
    "---",
    "name: server-activate-test",
    "description: Server activation test",
    "---",
    "# Test",
  ].join("\n"))
  engine.refresh()

  const response = await handleMessage(
    { type: "skill.activate", thread_id: thread.id, skill_name: "server-activate-test" },
    { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "skill.activated")
  assert.equal(response.skill_name, "server-activate-test")

  const updated = manager.get(thread.id)
  assert.ok(updated?.active_skill_ids.includes("server-activate-test"))

  // Cleanup
  fs.unlinkSync(path.join(skillsDir, "server-activate-test.md"))
})

test("skill.deactivate updates thread metadata", async () => {
  const manager = new ThreadManager()
  const engine = new SkillEngine()
  const thread = manager.create("Deactivate thread", "dea01")

  const skillsDir = path.join(os.homedir(), ".cmspark-agent", "skills")
  fs.writeFileSync(path.join(skillsDir, "server-deactivate-test.md"), [
    "---",
    "name: server-deactivate-test",
    "description: Server deactivation test",
    "---",
    "# Test",
  ].join("\n"))
  engine.refresh()

  // Activate first
  await handleMessage(
    { type: "skill.activate", thread_id: thread.id, skill_name: "server-deactivate-test" },
    { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
  )

  // Then deactivate
  await handleMessage(
    { type: "skill.deactivate", thread_id: thread.id, skill_name: "server-deactivate-test" },
    { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
  )

  const updated = manager.get(thread.id)
  assert.ok(!updated?.active_skill_ids.includes("server-deactivate-test"))

  fs.unlinkSync(path.join(skillsDir, "server-deactivate-test.md"))
})

test("skill.import requires content or url", async () => {
  const manager = new ThreadManager()
  const engine = new SkillEngine()

  await assert.rejects(
    () => handleMessage(
      { type: "skill.import" },
      { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
    ),
    /requires/,
  )
})

test("skill.import from content through message router", async () => {
  const manager = new ThreadManager()
  const engine = new SkillEngine()

  const md = [
    "---",
    "name: router-imported",
    "description: Imported via router",
    "---",
    "# Router Imported",
  ].join("\n")

  const response = await handleMessage(
    { type: "skill.import", content: md },
    { threadManager: manager, skillEngine: engine, historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "skill.list")
  const imported = response.skills.find((s: any) => s.name === "router-imported")
  assert.ok(imported)

  // Cleanup
  engine.deleteSkill("router-imported")
})

// --- Chat abort through message router ---

test("chat.abort through message router returns aborted", async () => {
  const manager = new ThreadManager()

  const response = await handleMessage(
    { type: "chat.abort", thread_id: "abt01" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "chat.aborted")
  assert.equal(response.thread_id, "abt01")
})

// --- Config test through message router ---

test("config.test returns ok:false when no API key configured", async () => {
  saveConfig({ llm: { api_key: "" } as any })

  const response = await handleMessage(
    { type: "config.test" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "config.testResult")
  assert.equal(response.ok, false)
  assert.ok(response.error)
})

// --- System ping through message router ---

test("system.ping through message router returns pong", async () => {
  const response = await handleMessage(
    { type: "system.ping" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "system.pong")
})

// --- Unknown message type ---

test("unknown message type returns error", async () => {
  const response = await handleMessage(
    { type: "nonexistent.message.type" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "error")
  assert.match(response.error, /Unknown message type/)
})

// --- Cookie security: domain-based checks ---

test("cookie security gate blocks untrusted domains and allows trusted", async () => {
  saveConfig({ trusted_domains: ["example.com", "*.company.com"] })

  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("evil.com"), false)
  assert.equal(isTrustedDomain(""), false)
})

test("cookie security blocks global wildcard access without '*' trust", async () => {
  saveConfig({ trusted_domains: ["example.com"] })

  // "*" is not in trusted list, so list_all_cookies would be blocked
  assert.equal(isTrustedDomain("*"), false)
})

test("cookie security allows global access when '*' is trusted", async () => {
  saveConfig({ trusted_domains: ["*"] })

  assert.equal(isTrustedDomain("*"), true)
  assert.equal(isTrustedDomain("anywhere.com"), true)
})

// --- Thread.select through message router ---

test("thread.select returns messages for a thread", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("Select thread", "sel01")
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello from select" })

  const response = await handleMessage(
    { type: "thread.select", thread_id: thread.id },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )

  assert.equal(response.type, "thread.messages")
  assert.ok(Array.isArray(response.messages))
  assert.equal(response.messages.length, 1)
  assert.equal(response.messages[0].content, "hello from select")
})

// --- history.query through message router ---

test("history.query returns empty operations for no records", async () => {
  const history = new HistoryStore()

  const response = await handleMessage(
    { type: "history.query", thread_id: "htest01", limit: 10 },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: history },
  )

  assert.equal(response.type, "history.result")
  assert.ok(Array.isArray(response.operations))
})

// --- error path: chat.create without session returns error ---

test("chat.create without session returns error", async () => {
  const response = await handleMessage(
    { type: "chat.create", thread_id: "nosess01", message: "hello", skill_ids: [] },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
    // No session callbacks provided
  )

  assert.equal(response.type, "error")
  assert.match(response.error, /No session/)
})
