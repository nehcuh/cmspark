/**
 * #502 B — archive tier: default disk keeps tool STUBS, not bodies.
 *
 * Product switch: `config.persist_full_tool_history` (default false).
 *  - false (default): a non-sensitive tool result/params collapse to
 *    {redacted:true, len, sha256} — name + success + size + fingerprint only.
 *  - true: today's #255 behaviour (read-tier keeps a gated prefix, exec still folds).
 *
 * INVARIANTS that hold in BOTH modes (this file pins them):
 *  - the role="tool" ROW always exists (rebuild pairing / heal depend on it);
 *  - cookie values never persist;
 *  - shell / host_computer / osascript bodies always fold (EXEC_FOLD);
 *  - a data-less error row keeps `error`/`error_code` verbatim — the INTERRUPTED
 *    heal contract keys on error_code (`replaceInterruptedFillerIfPresent`).
 *
 * The 8000-char read-tier cap is #255's; the switch only decides whether the
 * gated prefix is written at all.
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-archive-stub-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let createToolResultMessage: typeof import("../src/llm/tool-batch-heal").createToolResultMessage
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir

/** What initDataDir wrote on a pristine dir = the real product default. */
let pristineDefault: unknown

before(async () => {
  const config = await import("../src/config")
  getConfig = config.getConfig
  saveConfig = config.saveConfig
  initDataDir = config.initDataDir
  await initDataDir()
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(process.env.CMSPARK_DATA_DIR!, "config.json"), "utf8"),
  )
  pristineDefault = onDisk.persist_full_tool_history
  createToolResultMessage = (await import("../src/llm/tool-batch-heal")).createToolResultMessage
})

beforeEach(() => {
  // Reset to the product default between tests (the switch is global config).
  saveConfig({ persist_full_tool_history: false })
})

const PAGE_BODY = "hello world ".repeat(100) // 1200 chars

function call(name: string, id = "call_1") {
  return { id, type: "function", function: { name, arguments: "{}" } }
}

function row(name: string, result: any, params: any = {}, id = "call_1"): any {
  return createToolResultMessage("t", call(name, id), result, params)
}

function contentOf(r: any): any {
  return JSON.parse(r.content)
}

function resultOf(r: any): any {
  return r.tool_calls[0].result
}

function paramsOf(r: any): any {
  return r.tool_calls[0].params
}

// --- product default ---

test("default: config ships with persist_full_tool_history = false", () => {
  assert.equal(pristineDefault, false, "initDataDir must write the switch off")
  const src = fs.readFileSync(path.join(process.cwd(), "src/config.ts"), "utf8")
  assert.match(src, /persist_full_tool_history:\s*false/)
})

test("default: a page-read body collapses to a stub and keeps the row", () => {
  const r = row("get_page_text", { success: true, data: PAGE_BODY }, { url: "https://x" })
  const parsed = contentOf(r)
  assert.equal(parsed.redacted, true)
  assert.equal(typeof parsed.sha256, "string")
  assert.equal(typeof parsed.len, "number")
  // The row itself must survive: rebuild pairing + heal depend on it.
  assert.equal(r.role, "tool")
  assert.equal(r.tool_calls[0].id, "call_1")
  assert.equal(r.tool_calls[0].tool_name, "get_page_text")
  assert.equal(resultOf(r).redacted, true)
  assert.equal(JSON.stringify(r).includes("hello world"), false)
})

test("default: tool params are stubbed too (no selector / fill-value leak)", () => {
  const r = row(
    "fill_form",
    { success: true, data: { ok: true } },
    { selector: "#login-password", text: "FILL_SECRET_TEXT" },
  )
  const p = paramsOf(r)
  assert.equal(p.redacted, true)
  assert.equal(typeof p.len, "number")
  assert.equal(JSON.stringify(r).includes("FILL_SECRET_TEXT"), false)
  assert.equal(JSON.stringify(r).includes("#login-password"), false)
})

test("default: INTERRUPTED error rows keep error_code verbatim (heal contract)", () => {
  const r = row("list_tabs", { success: false, error: "interrupted", error_code: "INTERRUPTED" })
  assert.equal(resultOf(r).error_code, "INTERRUPTED")
  assert.equal(resultOf(r).error, "interrupted")
  assert.equal(contentOf(r).error_code, "INTERRUPTED")
})

// --- switch on: today's #255 behaviour ---

test("full history on: read-tier keeps a gated release, not a redacted stub", () => {
  saveConfig({ persist_full_tool_history: true })
  // Small body: #255 keeps it whole (that is what the switch buys back).
  const small = row("get_page_text", { success: true, data: PAGE_BODY }, { url: "https://x" })
  const parsed = contentOf(small)
  assert.notEqual(parsed.redacted, true)
  assert.equal(parsed.success, true)
  assert.equal(parsed.data, PAGE_BODY)
})

test("full history on: the #255 read cap still bounds a huge body", () => {
  saveConfig({ persist_full_tool_history: true })
  // 20000 chars > READ_RELEASE_MAX_CHARS (8000): #255 persists a surrogate-safe
  // prefix envelope (三态), never the whole thing. The switch re-enables the
  // gated release path — it does not lift the cap.
  const huge = "H".repeat(20000) + "TAIL_SHALL_NOT_PERSIST"
  const r = row("get_page_text", { success: true, data: huge }, { url: "https://x" })
  const parsed = contentOf(r)
  assert.equal(parsed.data.truncated, true)
  assert.ok(parsed.data.kept <= 8000, `kept=${parsed.data.kept}`)
  // `total` is the JSON-serialized length (#255 contract: the UI's 共 M 字符
  // counts the serialized payload, not the raw string).
  assert.equal(parsed.data.total, JSON.stringify(huge).length)
  assert.equal(parsed.data.kept, parsed.data.prefix.length)
  assert.equal(JSON.stringify(r).includes("TAIL_SHALL_NOT_PERSIST"), false)
})

test("full history on: a non-sensitive tool keeps its params + result", () => {
  saveConfig({ persist_full_tool_history: true })
  const r = row("list_tabs", { success: true, data: [{ id: 1 }] }, { currentWindow: true })
  assert.equal(paramsOf(r).currentWindow, true)
  assert.deepEqual(resultOf(r).data, [{ id: 1 }])
})

test("full history on: INTERRUPTED error rows are still verbatim", () => {
  saveConfig({ persist_full_tool_history: true })
  const r = row("list_tabs", { success: false, error: "interrupted", error_code: "INTERRUPTED" })
  assert.equal(resultOf(r).error_code, "INTERRUPTED")
})

// --- sensitive classes fold regardless of the switch ---

test("cookie value never persists, switch on or off", () => {
  const secret = "COOKIE_VALUE_DO_NOT_PERSIST"
  for (const full of [false, true]) {
    saveConfig({ persist_full_tool_history: full })
    const r = row("set_cookie", { success: true, data: { name: "sid", value: secret } }, {
      name: "sid",
      value: secret,
    })
    assert.equal(
      JSON.stringify(r).includes(secret),
      false,
      `cookie value leaked with persist_full_tool_history=${full}`,
    )
    assert.equal(r.role, "tool")
  }
})

test("shell_exec / host_computer bodies fold, switch on or off", () => {
  const cmd = "cat /etc/passwd # SHELL_SECRET_PAYLOAD"
  const task = "type hunter2 into the login form"
  for (const full of [false, true]) {
    saveConfig({ persist_full_tool_history: full })
    const sh = row("shell_exec", { success: true, data: { stdout: cmd } }, { command: cmd })
    assert.equal(JSON.stringify(sh).includes("SHELL_SECRET_PAYLOAD"), false, `shell leaked (full=${full})`)
    const hc = row("host_computer", { success: true, data: { screenshot: "AAAA" } }, { task })
    assert.equal(JSON.stringify(hc).includes("hunter2"), false, `host_computer leaked (full=${full})`)
  }
})

// --- the switch is read at write time, not at module load ---

test("createToolResultMessage reads config at call time (no module-level cache)", () => {
  const body = "call-time probe body".repeat(20)
  saveConfig({ persist_full_tool_history: false })
  assert.equal(contentOf(row("get_page_text", { success: true, data: body })).redacted, true)
  saveConfig({ persist_full_tool_history: true })
  assert.notEqual(contentOf(row("get_page_text", { success: true, data: body })).redacted, true)
  assert.equal(getConfig().persist_full_tool_history, true)
  // ...and back off again: the read is not sticky / one-way.
  saveConfig({ persist_full_tool_history: false })
  assert.equal(contentOf(row("get_page_text", { success: true, data: body })).redacted, true)
})
