/**
 * #502 B — assistant-side archive tier.
 *
 * The persisted assistant row carries the OTHER copy of the same intermediate
 * operation: `tool_calls[].function.arguments` holds the selector, the fill text,
 * the evaluate code, the URL. Task 1 compacts the tool RESULT row; this compacts
 * the assistant ARGUMENTS row.
 *
 * Invariants:
 *  - `id` and `function.name` are ALWAYS kept verbatim. rebuildMessagesFromHistory
 *    pairs assistant.tool_calls to tool rows BY ID; dropping either breaks reopen.
 *  - Invalid JSON keeps the existing `{_redacted:"invalid_json", len}` stub in
 *    both tiers (a truncated stream is never stored raw, and the diagnostic is
 *    more useful than a generic stub).
 *  - Sensitive folding still runs first: the tier decides whether a NON-sensitive
 *    body is written, never whether a secret is redacted.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-archive-args-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let redactAssistantToolCallsForPersistence: typeof import("../src/security/tool-persistence-redact").redactAssistantToolCallsForPersistence
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const config = await import("../src/config")
  saveConfig = config.saveConfig
  initDataDir = config.initDataDir
  await initDataDir()
  redactAssistantToolCallsForPersistence = (
    await import("../src/security/tool-persistence-redact")
  ).redactAssistantToolCallsForPersistence
})

after(() => {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

beforeEach(() => {
  saveConfig({ persist_full_tool_history: false })
})

function call(name: string, args: unknown, id = "call_1") {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  }
}

function argsOf(tc: { function: { arguments: string } }): any {
  return JSON.parse(tc.function.arguments)
}

test("default: arguments collapse to a stub but id + name survive", () => {
  const original = call("fill_form", {
    selector: "#login-password",
    text: "ARG_SECRET_TEXT",
    html: "<input value='x'>",
  })
  const [out] = redactAssistantToolCallsForPersistence([original])
  assert.equal(out.id, "call_1", "id must survive — rebuild pairs by id")
  assert.equal(out.type, "function")
  assert.equal(out.function.name, "fill_form", "name must survive — UI + audit key on it")
  const a = argsOf(out)
  assert.equal(a.redacted, true)
  assert.equal(typeof a.len, "number")
  const s = JSON.stringify(out)
  assert.equal(s.includes("ARG_SECRET_TEXT"), false)
  assert.equal(s.includes("#login-password"), false)
  assert.equal(s.includes("<input value='x'>"), false)
  // The in-flight row is never mutated (the live LLM keeps full args).
  assert.equal(original.function.arguments.includes("ARG_SECRET_TEXT"), true)
})

test("default: a browser selector does not reach the persisted assistant row", () => {
  const [out] = redactAssistantToolCallsForPersistence([
    call("click", { tabId: 3, selector: "#submit-order", text: "提交订单" }),
  ])
  const s = JSON.stringify(out)
  assert.equal(s.includes("#submit-order"), false)
  assert.equal(s.includes("提交订单"), false)
  assert.equal(out.function.name, "click")
})

test("full history on: non-sensitive args pass through (pre-#502 behaviour)", () => {
  const [out] = redactAssistantToolCallsForPersistence(
    [call("list_tabs", { currentWindow: true, tabId: 42 })],
    { persistFull: true },
  )
  const a = argsOf(out)
  assert.equal(a.currentWindow, true)
  assert.equal(a.tabId, 42)
})

test("adapter wires the tier from config (a dropped read would make the switch inert)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/llm/adapter.ts"), "utf8")
  // Without this argument the assistant path would always stub and the
  // Settings toggle would do nothing on reopen.
  assert.match(
    src,
    /redactAssistantToolCallsForPersistence\([\s\S]{0,200}?persist_full_tool_history/,
  )
})

test("invalid JSON keeps the invalid_json stub in BOTH tiers", () => {
  const raw = '{"value":"PARTIAL_SECRET_STILL_LEAK"'
  for (const full of [false, true]) {
    saveConfig({ persist_full_tool_history: full })
    const [out] = redactAssistantToolCallsForPersistence([call("set_cookie", raw)])
    const a = argsOf(out)
    assert.equal(a._redacted, "invalid_json", `tier=${full}`)
    assert.equal(a.len, raw.length)
    assert.equal(JSON.stringify(out).includes("PARTIAL_SECRET_STILL_LEAK"), false)
  }
})

test("secrets fold in BOTH tiers (the switch never relaxes redaction)", () => {
  const secret = "COOKIE_VALUE_DO_NOT_PERSIST"
  for (const full of [false, true]) {
    saveConfig({ persist_full_tool_history: full })
    const [cookie] = redactAssistantToolCallsForPersistence([
      call("set_cookie", { name: "sid", domain: "example.com", value: secret }),
    ])
    assert.equal(JSON.stringify(cookie).includes(secret), false, `cookie leaked (full=${full})`)

    const cmd = "cat /etc/passwd # SHELL_ARG_SECRET"
    const [shell] = redactAssistantToolCallsForPersistence([
      call("shell_exec", { command: cmd, cwd: "/tmp" }),
    ])
    assert.equal(JSON.stringify(shell).includes("SHELL_ARG_SECRET"), false, `shell leaked (full=${full})`)
  }
})

test("empty / undefined lists stay empty", () => {
  assert.deepEqual(redactAssistantToolCallsForPersistence([]), [])
  assert.deepEqual(redactAssistantToolCallsForPersistence(undefined), [])
  assert.deepEqual(redactAssistantToolCallsForPersistence(null), [])
})
