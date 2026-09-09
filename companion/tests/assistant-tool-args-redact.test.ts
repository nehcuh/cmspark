/**
 * L4: assistant tool_calls.arguments must be redacted before threads/*.json persist.
 * persistAssistantDraft is the disk gate; in-flight LLM rows stay raw.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { redactAssistantToolCallsForPersistence } from "../src/security/tool-persistence-redact"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-assistant-args-redact-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[candidates.length - 1]
}

function call(
  name: string,
  args: string,
  id = "call_1",
): { id: string; type: "function"; function: { name: string; arguments: string } } {
  return { id, type: "function", function: { name, arguments: args } }
}

function persistedArgs(toolCalls: ReturnType<typeof redactAssistantToolCallsForPersistence>): string {
  return JSON.stringify(toolCalls)
}

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const config = await import("../src/config")
  initDataDir = config.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})

after(() => {
  try { fs.rmSync(tempHome, { recursive: true, force: true }) } catch { /* best-effort */ }
})

test("set_cookie value is folded in persisted assistant arguments", () => {
  const secret = "COOKIE_SECRET_VALUE_DO_NOT_PERSIST"
  const original = call("set_cookie", JSON.stringify({
    name: "sid",
    domain: "example.com",
    value: secret,
  }))
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.equal(out[0].id, "call_1")
  assert.equal(out[0].type, "function")
  assert.equal(out[0].function.name, "set_cookie")
  assert.equal(args.name, "sid")
  assert.equal(args.domain, "example.com")
  assert.ok(String(args.value).startsWith("<redacted:"))
  assert.ok(!persistedArgs(out).includes(secret))
  assert.equal(original.function.arguments.includes(secret), true, "in-flight row stays raw")
})

test("shell_exec command is folded in persisted assistant arguments", () => {
  const command = "cat /etc/passwd && echo SHELL_SECRET_PAYLOAD"
  const original = call("shell_exec", JSON.stringify({ command, cwd: "/tmp" }))
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.ok(String(args.command).startsWith("<redacted:"))
  assert.equal(args.cwd, "/tmp")
  assert.ok(!persistedArgs(out).includes(command))
  assert.ok(!persistedArgs(out).includes("SHELL_SECRET_PAYLOAD"))
  assert.equal(original.function.arguments.includes(command), true)
})

test("host_computer task is folded in persisted assistant arguments", () => {
  const task = "type the password hunter2 into the login form"
  const original = call("host_computer", JSON.stringify({ task, actions: [{ type: "type", text: "hunter2" }] }))
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.ok(String(args.task).startsWith("<redacted:"))
  assert.ok(!persistedArgs(out).includes(task))
  assert.ok(!persistedArgs(out).includes("hunter2"))
  assert.equal(original.function.arguments.includes("hunter2"), true)
})

test("evaluate code is folded in persisted assistant arguments", () => {
  const code = "return document.cookie"
  const original = call("evaluate", JSON.stringify({ code, tabId: 7 }))
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.ok(String(args.code).startsWith("<redacted:"))
  assert.equal(args.tabId, 7)
  assert.ok(!persistedArgs(out).includes(code))
})

test("list_tabs keeps non-secret args", () => {
  const original = call("list_tabs", JSON.stringify({ currentWindow: true, tabId: 42 }))
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.equal(args.currentWindow, true)
  assert.equal(args.tabId, 42)
  assert.equal(out[0].function.name, "list_tabs")
})

test("invalid JSON arguments are replaced with a stub, not the raw string", () => {
  const raw = '{"value":"PARTIAL_SECRET_STILL_LEAK"'
  const original = call("set_cookie", raw)
  const out = redactAssistantToolCallsForPersistence([original])
  const args = JSON.parse(out[0].function.arguments)
  assert.equal(args._redacted, "invalid_json")
  assert.equal(args.len, raw.length)
  assert.ok(!persistedArgs(out).includes("PARTIAL_SECRET_STILL_LEAK"))
  assert.equal(original.function.arguments, raw)
})

test("empty tool_calls list stays empty", () => {
  assert.deepEqual(redactAssistantToolCallsForPersistence([]), [])
  assert.deepEqual(redactAssistantToolCallsForPersistence(undefined), [])
})

test("persistAssistantDraft redacts tool_calls before addMessage", () => {
  const src = fs.readFileSync(srcFile("llm", "adapter.ts"), "utf8")
  assert.match(src, /redactAssistantToolCallsForPersistence/)
  const start = src.indexOf("function persistAssistantDraft")
  assert.ok(start >= 0, "persistAssistantDraft missing")
  const loopMark = src.indexOf("// Tool calling loop", start)
  const body = src.slice(start, loopMark > start ? loopMark : start + 1200)
  assert.match(body, /redactAssistantToolCallsForPersistence/)
  assert.match(body, /addMessage/)
  assert.ok(
    body.indexOf("redactAssistantToolCallsForPersistence") < body.indexOf("addMessage"),
    "helper must run before addMessage",
  )
  assert.ok(
    /tool_calls:\s*redactAssistantToolCallsForPersistence\(/.test(body)
      || /const\s+\w+\s*=\s*redactAssistantToolCallsForPersistence\(/.test(body),
    "addMessage payload must use helper output, not raw assistantMsg",
  )
})

test("set_cookie value does not appear in persisted thread JSON", () => {
  const secret = "COOKIE_SECRET_VALUE_DO_NOT_PERSIST"
  const tm = new ThreadManager()
  const th = tm.create("assistant-args-redact")
  tm.addMessage(th.id, {
    thread_id: th.id,
    role: "assistant",
    content: "",
    tool_calls: redactAssistantToolCallsForPersistence([
      call("set_cookie", JSON.stringify({ name: "sid", value: secret, domain: "example.com" })),
    ]),
  })
  const diskPath = path.join(process.env.CMSPARK_DATA_DIR!, "threads", `${th.id}.json`)
  const disk = fs.readFileSync(diskPath, "utf8")
  assert.ok(!disk.includes(secret), "cookie value must not persist in threads/*.json")
  const stored = JSON.parse(disk)
  const args = JSON.parse(stored.messages[0].tool_calls[0].function.arguments)
  assert.equal(args.name, "sid")
  assert.ok(String(args.value).startsWith("<redacted:"))
})
