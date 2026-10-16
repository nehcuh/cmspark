// #686 actual App config/schema/admission producer. No native/GUI/token effects.
import test from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"
import { EventEmitter } from "node:events"
import { admitGuiTemplate } from "../src/apps/gui-template-runtime"
import { validateAppEntry } from "../src/apps/types"
import { parseToolArgs } from "../src/bridge/tool-schemas"
const app = "win.app.owned686"
const template = { id: "open_text", name: "Open text", profile: "npp-8.9.8.1-x64-local-text-v1", risk: "state-changing",
  argv: ["-multiInst", "-nosession", "-noPlugin", "-ro", { file_slot: "file" }] }
const entry = { token: app, kind: "gui", display_name: "Owned inert Notepad++", source: "user", policy: "manual", enabled: true,
  added_at: "2026-10-16T00:00:00Z", exe: { path: "C:\\Owned686\\Notepad++\\notepad++.exe", user_writable_dir: true }, templates: [template] }
const params = { app, action: "run_template", template: "open_text", params: { file: "C:\\Owned686\\中文 with space.txt" } }
function actualFunction(file: string, name: string, globals: any = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, `../../src/${file}`), "utf8")
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const f = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(f?.body)
  const js = ts.transpileModule(f.getText(tree).replace(/^export /, "") + `\nmodule.exports=${name}`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: undefined as any }; new Function("module", ...Object.keys(globals), js)(m, ...Object.values(globals)); return m.exports
}
function actualAdmission(globals: Record<string, unknown>) {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/tool/l2-admission.ts"), "utf8")
  const tree = ts.createSourceFile("l2-admission.ts", source, ts.ScriptTarget.Latest, true)
  const fn = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "runL2ToolAdmission")
  assert.ok(fn?.body)
  const js = ts.transpileModule(`async function gate(ctx: any) ${fn.body.getText(tree)}\nmodule.exports=gate`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: undefined as any }
  new Function("module", ...Object.keys(globals), js)(module, ...Object.values(globals))
  return module.exports
}
test("#686 actual App validator accepts the one reviewed owner template", () => {
  assert.equal(validateAppEntry(entry), null)
})
test("#686 actual canonical tool schema preserves only declared template input", () => {
  assert.deepEqual(parseToolArgs("host_app", params), params)
})
test("#686 actual admission reaches one interactive confirmation for valid owner template", async () => {
  let confirmations = 0
  const cfg = { apps: { enabled: true, entries: { [app]: entry } }, security: {} }
  const gate = actualAdmission({
    getComputerTaskAbortRegistry: () => ({}), os: { platform: () => "win32" },
    isHostAppPlatformGated: () => true, isHostCliPlatformGated: () => true, isHostComputerPlatformGated: () => true,
    L2_GATE_TOOLS: [], APP_TOKEN_PATTERN: /^(win|mac)\.(app|cli)\.[a-z0-9][a-z0-9_\-]{1,31}$/,
    getConfig: () => cfg, securityPolicy: { checkLength: () => ({ ok: true }) },
    WebSocket: { OPEN: 1 },
    admitGuiTemplate: (request: any) => admitGuiTemplate(request, inertDeps(cfg)),
  })
  const outcome = await gate({ finalParams: structuredClone(params), toolName: "host_app", toolCallId: "owned686", startedAt: 0,
    sessionId: "owned", ws: { readyState: 1 }, getThreadManager: () => ({}), logToolFinish: () => {},
    wsAuthGet: () => ({ authenticated: true }),
    securityConfirmations: { request: async () => { confirmations++; return { approved: true, reason: "approved" } } } })
  assert.equal(outcome.ok, true, JSON.stringify(outcome))
  assert.equal(confirmations, 1)
})

// The transport gate body and the production private receipt are exercised together.
// Only Windows filesystem/second-factor/process effects are explicitly inert seams.
function inertDeps(cfg: any, extra: Record<string, any> = {}) {
  return {
    platform: () => "win32",
    config: () => cfg,
    changes: new EventEmitter(),
    files: async (_entry: any, file: string, checkpoint: () => void) => {
      checkpoint(); return Object.freeze({ canonicalExe: entry.exe.path, canonicalFile: file,
        bindingIdentity: "OWNED_INERT_FILE_IDENTITY_NOT_A_GRANT", recheck: () => {} })
    },
    policy: { issueToken: () => ({ token: "OWNED_INERT_NON_EFFECTIVE_TOKEN" }), validateToken: () => true },
    spawn: () => { throw new Error("default inert child must never be reached") },
    ...extra,
  } as any
}
function ownedFlow(options: { risk?: string; policy?: string; decision?: any; owner?: () => boolean; extra?: any } = {}) {
  const e: any = structuredClone(entry); e.policy = options.policy ?? "manual"; e.templates[0].risk = options.risk ?? "state-changing"
  const cfg: any = { apps: { enabled: true, entries: { [app]: e } }, security: { allow_all_schemes: true, auto_approve_dangerous: true, auto_approve_enterprise_tools: true } }
  const calls: any[] = [], confirmations: any[] = [], events = new EventEmitter()
  let tokens = 0, consumed = 0
  const deps = inertDeps(cfg, { changes: events,
    policy: { issueToken: () => { tokens++; return { token: "OWNED_INERT_NON_EFFECTIVE_TOKEN" } }, validateToken: () => { consumed++; return consumed === 1 } },
    spawn: (...args: any[]) => { calls.push(args); return { on() {}, unref() {} } }, ...options.extra })
  const request = { params: structuredClone(params), ownerCurrent: options.owner ?? (() => true),
    requestConfirmation: async (details: any) => { confirmations.push(details); return options.decision ?? { approved: true, reason: "approved" } } }
  return { cfg, events, deps, request, calls, confirmations, tokens: () => tokens, consumed: () => consumed }
}
for (const policy of ["auto", "ai", "manual"]) test(`#686 ${policy} including cruise flags still interactive; exact preview/binding/spawn; one use`, async () => {
  const f = ownedFlow({ policy })
  const accepted = await admitGuiTemplate(f.request, f.deps)
  assert.equal(f.confirmations.length, 1)
  assert.equal(f.confirmations[0].autoConfirmEligible, false)
  assert.deepEqual(f.confirmations[0].relevantApps, [])
  assert.match(f.confirmations[0].fullPreview, /中文 with space\.txt/)
  assert.equal(f.tokens(), 1); assert.equal(f.calls.length, 0)
  assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, true)
  assert.deepEqual(f.calls[0][1], ["-multiInst", "-nosession", "-noPlugin", "-ro", params.params.file])
  assert.equal(f.calls[0][2].shell, false); assert.equal(f.consumed(), 1)
  assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, false)
  assert.equal(f.calls.length, 1); assert.equal(f.events.eventNames().length, 0)
})
for (const mutation of ["remove", "disable", "template", "risk", "exe", "global", "ABA"]) test(`#686 pending actual config event ${mutation} invalidates old approval`, async () => {
  let release!: (v: any) => void, entered!: () => void
  const ready = new Promise<void>(r => entered = r), held = new Promise<any>(r => release = r)
  const f = ownedFlow(); f.request.requestConfirmation = async () => { entered(); return held }
  const pending = admitGuiTemplate(f.request, f.deps); await ready
  const previous = structuredClone(f.cfg.apps.entries[app])
  if (mutation === "remove" || mutation === "ABA") delete f.cfg.apps.entries[app]
  else if (mutation === "disable") f.cfg.apps.entries[app].enabled = false
  else if (mutation === "template") f.cfg.apps.entries[app].templates[0].name = "New name"
  else if (mutation === "risk") f.cfg.apps.entries[app].templates[0].risk = "dangerous"
  else if (mutation === "exe") f.cfg.apps.entries[app].exe.path = "C:\\Other\\notepad++.exe"
  else f.cfg.apps.enabled = false
  // Use the actual event constant (not a guessed fixture label).
  const { CONFIG_CHANGE_EVENT } = await import("../src/config")
  f.events.emit(CONFIG_CHANGE_EVENT, f.cfg)
  if (mutation === "ABA") { f.cfg.apps.entries[app] = previous; f.events.emit(CONFIG_CHANGE_EVENT, f.cfg) }
  release({ approved: true, reason: "approved" })
  await assert.rejects(pending)
  assert.equal(f.tokens(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
for (const reason of ["cancelled", "denied", "timeout", "disconnect", "error"]) test(`#686 L2 ${reason} never mints approval or launches`, async () => {
  const f = ownedFlow({ decision: { approved: false, reason } })
  await assert.rejects(admitGuiTemplate(f.request, f.deps))
  assert.equal(f.tokens(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
test("#686 dangerous private receipt awaits second factor before consuming once; simultaneous replay rejected", async () => {
  let entered!: () => void, release!: (v: any) => void
  const ready = new Promise<void>(r => entered = r), held = new Promise<any>(r => release = r)
  const f = ownedFlow({ risk: "dangerous", extra: { biometric: async () => { entered(); return held } } })
  const accepted = await admitGuiTemplate(f.request, f.deps)
  const first = accepted.receipt.execute(accepted.finalParams); await ready
  assert.equal(f.consumed(), 0)
  assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, false)
  release({ approved: true, method: "manual-nonce", nonce: "OWNED_INERT_NOT_ISSUED" })
  assert.equal((await first).success, true); assert.equal(f.consumed(), 1); assert.equal(f.calls.length, 1)
})
for (const reason of ["cancelled", "denied", "timeout", "disconnect", "error"]) test(`#686 dangerous ${reason} never consumes or spawns`, async () => {
  const f = ownedFlow({ risk: "dangerous", extra: { biometric: async () => ({ approved: false, reason }) } })
  const accepted = await admitGuiTemplate(f.request, f.deps)
  assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, false)
  assert.equal(f.consumed(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
test("#686 owner disconnect and metadata drift at final fence refuse", async () => {
  let owner = true, invalid = false
  const f = ownedFlow({ owner: () => owner, extra: { files: async () => ({ canonicalExe: entry.exe.path, canonicalFile: params.params.file,
    bindingIdentity: "OWNED_INERT", recheck: () => { if (invalid) throw new Error("changed") } }) } })
  const a = await admitGuiTemplate(f.request, f.deps); owner = false
  assert.equal((await a.receipt.execute(a.finalParams)).success, false); assert.equal(f.calls.length, 0)
  owner = true; const b = await admitGuiTemplate(f.request, f.deps); invalid = true
  assert.equal((await b.receipt.execute(b.finalParams)).success, false); assert.equal(f.calls.length, 0)
})
for (const changed of ["app", "template", "params", "risk", "security_token"]) test(`#686 cannot reuse receipt after caller ${changed} tamper`, async () => {
  const f = ownedFlow(), accepted = await admitGuiTemplate(f.request, f.deps), p: any = structuredClone(accepted.finalParams)
  if (changed === "params") p.params.file = "C:\\Owned686\\different.txt"
  else p[changed] = "changed"
  assert.equal((await accepted.receipt.execute(p)).success, false)
  assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})

for (const mutate of [
  (p: any) => { p.args = ["--extra"] },
  (p: any) => { p.risk = "read-only" },
  (p: any) => { p.params.extra = "extra" },
  (p: any) => { p.params.file = "" },
  (p: any) => { p.params.file = "C:\\" + "a".repeat(260) },
  (p: any) => { p.app = "mac.app.editor" },
  (p: any) => { p.template = "../wrong" },
]) test("#686 actual strict template schema rejects excess or unsupported input", () => {
  const p = structuredClone(params); mutate(p)
  assert.throws(() => parseToolArgs("host_app", p))
})
for (const mutate of [
  (e: any) => { e.templates[0].argv.push("--extra") },
  (e: any) => { e.templates[0].argv[0] = "-openSession" },
  (e: any) => { e.templates[0].argv[4].file_slot = "other" },
  (e: any) => { e.templates[0].risk = "read-only" },
  (e: any) => { e.templates[0].profile = "arbitrary-exe" },
  (e: any) => { e.templates[0].name = "inject\nline" },
  (e: any) => { e.templates[0].id = "__proto__" },
  (e: any) => { e.templates[0].extra = "ignored?" },
  (e: any) => { e.templates.push(structuredClone(e.templates[0])) },
  (e: any) => { e.aumid = "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App" },
  (e: any) => { e.exe.path = "C:\\Owned686\\chrome.exe" },
  (e: any) => { e.exe.path = "C:\\Owned686\\powershell.exe" },
  (e: any) => { e.bundleId = "unrelated.bundle" },
]) test("#686 real App validator closes unsupported template authority and mixed identities", () => {
  const e = structuredClone(entry); mutate(e); assert.notEqual(validateAppEntry(e), null)
})
function actualExecutorCase() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/tool/companion-dispatch.ts"), "utf8")
  const tree = ts.createSourceFile("companion-dispatch.ts", source, ts.ScriptTarget.Latest, true)
  let clause: ts.CaseClause | undefined
  function visit(node: ts.Node) {
    if (ts.isCaseClause(node) && node.expression.getText(tree) === '"host_app"') clause = node
    ts.forEachChild(node, visit)
  }
  visit(tree); assert.ok(clause)
  const js = ts.transpileModule(`async function exec(params:any, execOpts:any){${clause.statements.map(n => n.getText(tree)).join("\n")}}\nmodule.exports=exec`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: undefined as any }; new Function("module", js)(module); return module.exports
}
test("#686 actual executor refuses a caller token/forged params receipt; real private options run exactly once", async () => {
  const exec = actualExecutorCase()
  assert.equal((await exec({ ...params, security_token: "OWNED_FAKE", guiTemplateReceipt: { execute: () => { throw new Error("caller-capability-bypass") } } })).success, false)
  const f = ownedFlow(), accepted = await admitGuiTemplate(f.request, f.deps)
  assert.equal((await exec(accepted.finalParams, { guiTemplateReceipt: accepted.receipt })).success, true)
  assert.equal((await exec(accepted.finalParams, { guiTemplateReceipt: accepted.receipt })).success, false)
  assert.equal(f.calls.length, 1)
})
test("#686 actual origin-bound confirmation manager carries untruncated preview; wrong source cannot approve", async () => {
  const { SecurityConfirmationManager } = await import("../src/security-confirmation")
  const manager = new SecurityConfirmationManager(5000), owner: any = {}, stranger: any = {}
  const f = ownedFlow(); f.cfg.apps.entries[app].display_name = "Owned ".repeat(240)
  let entered!: () => void, payload: any
  const ready = new Promise<void>(r => entered = r)
  f.request.requestConfirmation = details => manager.request(data => { payload = data; entered() }, details, { originWs: owner })
  const pending = admitGuiTemplate(f.request, f.deps); await ready
  assert.ok(payload.full_preview.length > 1200)
  assert.ok(payload.code_preview.length < payload.full_preview.length)
  assert.equal(payload.auto_confirm_eligible, false); assert.deepEqual(payload.relevant_apps, [])
  assert.equal(manager.respondFrom(payload.confirmation_id, true, stranger).outcome, "origin_mismatch")
  assert.equal(f.tokens(), 0); assert.equal(f.calls.length, 0)
  assert.equal(manager.respondFrom(payload.confirmation_id, true, owner).outcome, "resolved")
  const approved = await pending
  assert.equal((await approved.receipt.execute(approved.finalParams)).success, true)
  assert.equal(f.calls.length, 1)
})
test("#686 private canonical binding is mandatory; generic host_app token helper cannot issue template approval", async () => {
  const { SecurityPolicy } = await import("../src/security-policy")
  assert.throws(() => SecurityPolicy.bindingPayloadFor("host_app", params), /private canonical operation/)
  assert.equal(SecurityPolicy.bindingPayloadFor("host_app", { app, action: "launch" }), `${app}|launch`)
})

async function runActualGate(f: ReturnType<typeof ownedFlow>, raw: Record<string, any>, overrides: Record<string, any> = {}) {
  const { pickExtensionWsFromAuth } = await import("../src/mcp/confirm-fanout")
  const owner: any = { readyState: 1, send: () => {} }
  const gate = actualAdmission({ admitGuiTemplate: (request: any) => admitGuiTemplate(request, f.deps), WebSocket: { OPEN: 1 }, pickExtensionWsFromAuth })
  const ctx = { finalParams: raw, toolName: "host_app", ws: owner, clients: new Set([owner]),
    wsAuthGet: () => ({ authenticated: true, origin: "chrome-extension://owned686", surface: "panel" }),
    securityConfirmations: { request: async (_send: unknown, details: any) => f.request.requestConfirmation(details) },
    ...overrides }
  return gate(ctx)
}
for (const bypass of ["provided-token", "enterprise-permit", "outbound", "summoner"]) test(`#686 real top-level admission ${bypass} does not bypass interactive template floor`, async () => {
  const f = ownedFlow({ policy: "auto" }), raw: any = structuredClone(params), overrides: any = {}
  if (bypass === "provided-token") raw.security_token = "OWNED_OLD_TOKEN"
  if (bypass === "enterprise-permit") { overrides.enterprisePermit = { owned: true }; raw.__enterprise_guard = { owned: true } }
  if (bypass === "outbound" || bypass === "summoner") {
    const origin: any = { readyState: 1, send: () => {} }, extension: any = { readyState: 1, send: () => {} }
    if (bypass === "outbound") { raw.__outbound_mcp = true; raw.__outbound_caller_id = "owned-inert-caller" }
    overrides.ws = origin; overrides.clients = new Set([origin, extension]); overrides.isOutboundMcpCall = bypass === "outbound"
    overrides.wsAuthGet = (peer: any) => peer === extension ? { authenticated: true, origin: "chrome-extension://owned686", surface: "panel" }
      : { authenticated: true, origin: "http://owned686.invalid", surface: bypass === "summoner" ? "summoner" : "outbound" }
  }
  const outcome = await runActualGate(f, raw, overrides)
  assert.equal(outcome.ok, true, JSON.stringify(outcome)); assert.equal(f.confirmations.length, 1)
  assert.equal(f.calls.length, 0); assert.equal((await outcome.guiTemplateReceipt.execute(outcome.finalParams)).success, true)
  assert.equal(f.calls.length, 1)
})
test("#686 missing user confirmation owner rejects summoner without launching a browser", async () => {
  const f = ownedFlow(), caller: any = { readyState: 1, send: () => {} }
  const outcome = await runActualGate(f, structuredClone(params), { ws: caller, clients: new Set([caller]),
    wsAuthGet: () => ({ authenticated: true, origin: "http://owned686.invalid", surface: "summoner" }) })
  assert.equal(outcome.ok, false); assert.equal(f.confirmations.length, 0); assert.equal(f.calls.length, 0)
})
test("#686 current authenticated owner is fenced after confirmation await", async () => {
  let release!: (v: any) => void, entered!: () => void, authenticated = true
  const held = new Promise<any>(r => release = r), ready = new Promise<void>(r => entered = r)
  const f = ownedFlow(); f.request.requestConfirmation = async () => { entered(); return held }
  const pending = runActualGate(f, structuredClone(params), { wsAuthGet: () => ({ authenticated, origin: "chrome-extension://owned686", surface: "panel" }) })
  await ready; authenticated = false; release({ approved: true, reason: "approved" })
  const outcome = await pending
  assert.equal(outcome.ok, false); assert.equal(f.tokens(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
test("#686 close of unused private receipt retires listener and denies subsequent execution", async () => {
  const f = ownedFlow(), admitted = await admitGuiTemplate(f.request, f.deps)
  assert.ok(f.events.eventNames().length > 0); admitted.receipt.close(); admitted.receipt.close()
  assert.equal(f.events.eventNames().length, 0)
  assert.equal((await admitted.receipt.execute(admitted.finalParams)).success, false); assert.equal(f.calls.length, 0)
})
test("#686 unrelated sibling update survives and cannot be overwritten by template execution", async () => {
  const f = ownedFlow(), admitted = await admitGuiTemplate(f.request, f.deps)
  const sibling = { token: "win.app.sibling686", enabled: false }
  f.cfg.apps.entries[sibling.token] = sibling
  const { CONFIG_CHANGE_EVENT } = await import("../src/config")
  f.events.emit(CONFIG_CHANGE_EVENT, f.cfg)
  assert.equal((await admitted.receipt.execute(admitted.finalParams)).success, true)
  assert.deepEqual(f.cfg.apps.entries[sibling.token], sibling)
})

test("#686 real readonly App projection strips argv and index omits private paths", async () => {
  const { guiTemplateConfigError } = await import("../src/apps/gui-templates")
  const { maxPolicyForEntry } = await import("../src/apps/types")

  const project = actualFunction("apps/handlers.ts", "entriesList", { maxPolicyForEntry, guiTemplateConfigError })
  const cfg: any = { [app]: structuredClone(entry) }, before = structuredClone(cfg)
  const listed = project(cfg)
  assert.equal(listed[0].templates.length, 1); assert.equal(listed[0].templates[0].id, "open_text")
  assert.equal(listed[0].templates[0].argv, undefined); assert.deepEqual(cfg, before)
  const index = actualFunction("llm/adapter.ts", "buildAppIndexSection", { guiTemplateConfigError })("win32", { enabled: true, entries: cfg })
  assert.match(index, /run_template: open_text\(state-changing\)/)
  assert.ok(!index.includes("C:")); assert.ok(!index.includes("notepad++.exe"))
})

test("#686 finite launch audit excludes file/profile paths, argv and receipt secrets", async () => {
  const { logger } = await import("../src/logger")
  const original = logger.info, rows: any[] = []
  logger.info = ((event: string, data: any) => rows.push({ event, data })) as typeof logger.info
  try {
    const f = ownedFlow(), approved = await admitGuiTemplate(f.request, f.deps)
    assert.equal((await approved.receipt.execute(approved.finalParams)).success, true)
    assert.equal(rows.length, 1); assert.equal(rows[0].event, "apps.template_launch")
    assert.deepEqual(Object.keys(rows[0].data).sort(), ["token", "action", "template", "policy", "risk", "tier_used", "argv_count", "file_slot_count", "evidence", "duration_ms"].sort())
    assert.equal(rows[0].data.argv_count, 5); assert.equal(rows[0].data.tier_used, "l2")
    const text = JSON.stringify(rows)
    assert.ok(!text.includes(params.params.file)); assert.ok(!text.includes(entry.exe.path)); assert.ok(!text.includes("OWNED_INERT_NON_EFFECTIVE_TOKEN"))
    const summarized = actualFunction("server.ts", "summarizeToolParams")(params)
    assert.deepEqual(summarized, { keys: Object.keys(params) })
    assert.ok(!JSON.stringify(summarized).includes(params.params.file))
  } finally { logger.info = original }
})

test("#686 actual durable thread/history projection folds a template path in both archive settings", async () => {
  const { archiveToolPayload, redactAssistantToolCallsForPersistence } = await import("../src/security/tool-persistence-redact")
  const { redactForStorage } = await import("../src/history/store")
  const original = structuredClone(params)
  const history = redactForStorage("host_app", JSON.stringify(params), "owned finite result")
  assert.ok(!history.params.includes("中文 with space"))
  for (const persistFull of [false, true]) {
    const direct = archiveToolPayload("host_app", params, { success: true }, persistFull)
    const assistant = redactAssistantToolCallsForPersistence([{ id: "owned686", type: "function", function: { name: "host_app", arguments: JSON.stringify(params) } }], { persistFull })
    assert.ok(!JSON.stringify(direct).includes("中文 with space"))
    assert.ok(!JSON.stringify(assistant).includes("中文 with space"))
  }
  const { redactCodeishParams } = await import("../src/security/redact-rules")
  const legacy = { ...params, action: "launch" }
  assert.deepEqual(redactCodeishParams(legacy, "host_app"), legacy)
  assert.deepEqual(redactCodeishParams(params, "unrelated_exec"), params)
  assert.deepEqual(params, original)
})

test("#686 actual abort during file preparation closes subject watch before approval or issuance", async () => {
  const abort = new AbortController()
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r)
  const f = ownedFlow({ extra: { files: async (_e: any, file: string) => { entered(); await held; return {
    canonicalExe: entry.exe.path, canonicalFile: file, bindingIdentity: "OWNED_ABORT_METADATA", recheck() {} } } } })
  const pending = admitGuiTemplate({ ...f.request, signal: abort.signal }, f.deps)
  await ready; abort.abort(); release(); await assert.rejects(pending)
  assert.equal(f.confirmations.length, 0); assert.equal(f.tokens(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
test("#686 actual abort during second-factor await refuses before token consumption or spawn", async () => {
  const abort = new AbortController()
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r)
  const f = ownedFlow({ risk: "dangerous", extra: { biometric: async () => { entered(); await held; return { approved: true, method: "manual-nonce", nonce: "OWNED_NOT_ISSUED" } } } })
  const admitted = await admitGuiTemplate({ ...f.request, signal: abort.signal }, f.deps)
  const pending = admitted.receipt.execute(admitted.finalParams)
  await ready; abort.abort(); release(); assert.equal((await pending).success, false)
  assert.equal(f.consumed(), 0); assert.equal(f.calls.length, 0); assert.equal(f.events.eventNames().length, 0)
})
