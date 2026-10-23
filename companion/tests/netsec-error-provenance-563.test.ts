/** #563 E0/E1 real schema/scope/admission/JSON/recovery consumers.
 * AST seams run the production pre-L2 refusal block and adapter code read.
 * Pure policy inputs and provider replay are simulated; no native/auth approval. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import cp from "node:child_process"
import net from "node:net"
const own = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-netsec-563-"))
process.env.CMSPARK_DATA_DIR = own
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
const effects = { process: 0, network: 0, token: 0 }, restores: (() => void)[] = []
function trap(obj: any, key: string, counter: keyof typeof effects) {
  const old = obj[key]; obj[key] = () => { effects[counter]++; throw Error("OWNED_EFFECT_FORBIDDEN") }
  restores.push(() => { obj[key] = old })
}
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) trap(cp, key, "process")
trap(net.Socket.prototype, "connect", "network")
let cfg: typeof import("../src/config"), schema: typeof import("../src/bridge/tool-schemas")
let scope: typeof import("../src/netsec/scope"), sec: typeof import("../src/security")
let guard: typeof import("../src/llm/same-tool-guard"), settings: typeof import("../src/capability/settings-pointer")
let modules: typeof import("../src/capability/modules"), scan: typeof import("../src/netsec/scan")
let TM: typeof import("../src/threads/thread-manager").ThreadManager
let SE: typeof import("../src/skills/skill-engine").SkillEngine
let chat: typeof import("../src/llm/adapter").chatCreate, Provider: typeof import("../src/llm/providers/openai").OpenAIProvider
let envelope: (s: any, helper: typeof settings.settingsRequiredResult) => any
let readCode: (r: any) => string | undefined, baseline: string
function unique(file: string, pred: (n: ts.Node, a: ts.SourceFile) => boolean) {
  const a = ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true)
  const found: ts.Node[] = []; function walk(n: ts.Node) { if (pred(n, a)) found.push(n); ts.forEachChild(n, walk) }
  walk(a); assert.equal(found.length, 1, "unique production AST seam"); return found[0].getText(a)
}
function compile(body: string, ...args: string[]) {
  return new Function(...args, ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
}
before(async () => {
  cfg = await import("../src/config"); await cfg.initDataDir()
  const p = (await import("../src/security-policy")).securityPolicy
  // Spy after policy construction, before producers/adapter. No validator bypass.
  for (const key of ["issueToken", "issueTokenFor"]) trap(p, key, "token")
  schema = await import("../src/bridge/tool-schemas"); scope = await import("../src/netsec/scope")
  sec = await import("../src/security"); guard = await import("../src/llm/same-tool-guard")
  settings = await import("../src/capability/settings-pointer"); modules = await import("../src/capability/modules")
  scan = await import("../src/netsec/scan"); TM = (await import("../src/threads/thread-manager")).ThreadManager
  SE = (await import("../src/skills/skill-engine")).SkillEngine
  chat = (await import("../src/llm/adapter")).chatCreate; Provider = (await import("../src/llm/providers/openai")).OpenAIProvider
  const block = unique("tool/l2-admission.ts", (n, a) => ts.isIfStatement(n) && n.expression.getText(a) === "!scope.ok"
    && n.thenStatement.getText(a).includes('"netsec_port_scan"') && n.thenStatement.getText(a).includes("NETSEC_SCOPE_DENIED"))
  envelope = compile(block, "scope", "settingsRequiredResult") as typeof envelope
  const read = unique("llm/adapter.ts", n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "classCode")
  readCode = compile("const " + read + ";return classCode", "toolResult") as typeof readCode
  baseline = JSON.stringify(cfg.getConfig()); assert.notEqual(cfg.getConfig().modules?.netsec?.enabled, true)
})
after(() => {
  const observed = { ...effects }; for (const restore of restores.reverse()) restore()
  fs.rmSync(own, { recursive: true, force: true }); assert.equal(fs.existsSync(own), false)
  assert.deepEqual(observed, { process: 0, network: 0, token: 0 })
  console.log(JSON.stringify({ netsec_563_effects: observed, owned_data_removed: !fs.existsSync(own) }))
})
function receipt(target: string, more: Record<string, unknown> = {}) {
  const s = scope.checkNetsecScope({ targets: [target], allowlist: ["allowed.example.test"],
    moduleEnabled: true, requireTaskAuth: true, taskAuth: null, ...more })
  assert.equal(s.ok, false)
  const wire = JSON.parse(JSON.stringify(envelope(s, settings.settingsRequiredResult)))
  assert.equal(wire.success, false); assert.deepEqual(Object.keys(wire).sort(), ["data", "error", "success"])
  return { s, wire, code: readCode(wire) }
}
for (const targets of [["   "], ["\t\r\n"], ["\u00a0\u3000"], ["allowed.example.test", "  "]]) {
  test(`#563 E0 trim-empty ${JSON.stringify(targets)} rejected at schema`, () => {
    assert.equal(schema.tryParseToolArgs("netsec_port_scan", { targets }).ok, false)
  })
}
test("#563 E0 preserves raw nonempty targets and original array/port limits", () => {
  const input = { targets: ["  Allowed.Example.test  ", "timeout.example.test"], ports: [1, 65535] }
  assert.deepEqual(schema.parseToolArgs("netsec_port_scan", input), input)
  for (const value of [{}, { targets: [] }, { targets: [""] }, { targets: Array(17).fill("owned.test") },
    { targets: ["owned.test"], ports: [0] }, { targets: ["owned.test"], ports: [65536] },
    { targets: ["owned.test"], ports: [1.1] }, { targets: ["owned.test"], ports: Array(33).fill(80) }]) {
    assert.equal(schema.tryParseToolArgs("netsec_port_scan", value).ok, false)
  }
  assert.equal(schema.tryParseToolArgs("netsec_port_scan", { targets: Array(16).fill("owned.test"), ports: Array(32).fill(80) }).ok, true)
})
for (const target of ["denied.example.test", "timeout.example.test", "element_not_found-timeout.example.test"]) {
  test(`#563 E1 actual ${target} receipt is a typed hard stop`, t => {
    const { s, wire, code } = receipt(target); t.diagnostic(JSON.stringify({ s, wire, code }))
    assert.equal((s as any).reason, "targets_denied"); assert.equal(code, "NETSEC_TARGETS_DENIED")
    assert.equal(wire.error, (s as any).error); assert.deepEqual(Object.keys(wire.data), ["error_code"])
    assert.equal(sec.classifyError(wire.error, { toolName: "netsec_port_scan", error_code: code }), "non_recoverable")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code, errorText: wire.error, alreadyPivoted: false }).action, "stop")
  })
}
test("#563 missing task auth / internal blank stay generic; per-task target refusal is typed", () => {
  for (const [target, more, reason] of [["allowed.example.test", {}, "task_auth_missing"],
    // Pure scope input only; never persisted or converted to a token/grant.
    ["allowed.example.test", { taskAuth: { authorized: true, targets: ["other.example.test"] } }, "target_not_in_task_auth"],
    ["   ", {}, undefined]] as const) {
    const { s, wire, code } = receipt(target, more); assert.equal((s as any).reason, reason)
    const perTaskTarget = reason === "target_not_in_task_auth"
    assert.equal(code, perTaskTarget ? "NETSEC_TARGETS_DENIED" : "NETSEC_SCOPE_DENIED")
    assert.equal(sec.ERROR_CODE_LEVELS.has(code!), perTaskTarget)
    assert.equal(sec.classifyError(wire.error, { error_code: code }), "non_recoverable")
  }
})
test("#563 actual Settings install pointers and management refusal unchanged", async () => {
  for (const [reason, more, level] of [["module_disabled", { moduleEnabled: false }, "recoverable"],
    ["allowlist_empty", { allowlist: [] }, "non_recoverable"]] as const) {
    const { s, wire, code } = receipt("owned.test", more); assert.equal((s as any).reason, reason)
    assert.equal(code, "SETTINGS_REQUIRED"); assert.equal(wire.data.reason, reason)
    assert.equal(wire.data.settings_section, settings.settingsPointerFor("netsec_port_scan")!.settings_section)
    assert.equal(sec.classifyError(wire.error, { error_code: code }), level)
  }
  const direct = await scan.netsecPortScan({ targets: ["owned.test"] })
  assert.equal(direct.success, false); assert.equal((direct.data as any).error_code, "SETTINGS_REQUIRED")
  assert.equal((direct.data as any).reason, "module_disabled")
  for (const name of ["netsec", "owned-unknown", "timeout-unknown"]) assert.equal(modules.setModuleEnabled(name, true).ok, false)
  assert.equal(JSON.stringify(cfg.getConfig()), baseline)
})
test("#563 real dispatcher refuses missing/invalid token before any scan", async () => {
  const dispatch = await import("../src/tool/companion-dispatch")
  const Confirmation = (await import("../src/security-confirmation")).SecurityConfirmationManager
  const tm = new TM()
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: new Confirmation(), getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0 })
  for (const token of [undefined, "DECLARED_INVALID_NONCREDENTIAL"]) {
    const wire = await dispatch.executeCompanionTool("netsec_port_scan", { targets: ["owned.test"], security_token: token })
    assert.equal(wire.success, false)
    assert.match(wire.error, token ? /Invalid or expired security token/ : /requires L2 security_token/)
    assert.deepEqual(wire.data, token ? { error_code: "SECURITY_TOKEN_INVALID" } : undefined)
  }
  assert.deepEqual(effects, { process: 0, network: 0, token: 0 })
  assert.equal(JSON.stringify(cfg.getConfig()), baseline)
})
test("#563 unknown/no-code, true locator and original threshold controls", () => {
  assert.equal(sec.ERROR_CODE_LEVELS.has("OWNED_UNKNOWN"), false)
  for (const code of [undefined, "OWNED_UNKNOWN"]) {
    assert.equal(sec.classifyError("timeout", { error_code: code }), "recoverable")
    assert.equal(guard.decideSameToolFailure({ failCount: 2, threshold: 3, errorCode: code, errorText: "element_not_found", alreadyPivoted: false }).action, "count")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code, errorText: "element_not_found", alreadyPivoted: false }).action, "pivot")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code, errorText: "element_not_found", alreadyPivoted: true }).action, "stop")
  }
  assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: "ELEMENT_NOT_FOUND", alreadyPivoted: false }).action, "pivot")
  assert.equal(sec.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
})
for (const [target, blank] of [["\u3000", true], ["denied.example.test", false], ["element_not_found-timeout.example.test", false]] as const) {
  test(`#563 real adapter ${JSON.stringify(target)} ${blank ? "argument repair without dispatch" : "first refusal halt"}`, async t => {
    const tm = new TM(), parent = tm.create("OWNED_NETSEC_563"), sent: any[] = []; let streams = 0, calls = 0
    t.mock.method(Provider.prototype, "streamChat", () => {
      const turn = streams++
      return (async function* () {
        if (turn < 2) {
          yield { type: "tool_call_delta" as const, index: 0, id: "owned-" + turn,
            name: turn === 0 ? "run_progress_propose" : "netsec_port_scan",
            arguments: JSON.stringify(turn === 0 ? { items: [{ text: "OWNED_INERT" }] } : { targets: [target] }) }
          yield { type: "done" as const, finish_reason: "tool_calls" as const }
        } else { yield { type: "token" as const, text: "OWNED_DONE" }; yield { type: "done" as const, finish_reason: "stop" as const } }
      })()
    })
    await chat({ threadId: parent.id, message: "OWNED_INERT", skillIds: [],
      config: { base_url: "http://127.0.0.1:1", api_key: "DECLARED_NONCREDENTIAL_PROVIDER_FIXTURE", model_name: "owned-inert", temperature: 0, context_window: 8000 },
      threadManager: tm, skillEngine: new SE(), historyStore: { record: () => 0 } as any,
      sendToExtension: m => { sent.push(m) }, executeTool: async (_id, name) => {
        if (name === "run_progress_propose") return { success: true, data: { ok: true } }
        assert.equal(name, "netsec_port_scan"); calls++; return receipt(target).wire
      } })
    const result = sent.find(m => m.type === "tool.result" && m.tool_name === "netsec_port_scan")
    assert.ok(result); assert.equal(result.result.success, false)
    if (blank) { assert.equal(calls, 0); assert.equal(streams, 3); assert.equal(result.result.data, undefined)
      assert.equal(sent.some(m => m.type === "chat.error"), false) }
    else { assert.equal(calls, 1); assert.equal(streams, 2); assert.equal(result.result.data.error_code, "NETSEC_TARGETS_DENIED")
      assert.equal(sent.filter(m => m.type === "chat.error").length, 1) }
    t.diagnostic(JSON.stringify({ target, calls, streams, result: result.result }))
    assert.equal(JSON.stringify(cfg.getConfig()), baseline)
  })
}

// Root #563: actual per-task target refusal must not inherit a target's metadata grade.
for (const target of ["owned.example.test", "timeout.example.test", "element_not_found.example.test",
  "econnrefused.example.test", "503.example.test", "429.example.test"]) {
  test(`#563 task-auth target ${target} has intrinsic hard refusal`, t => {
    const { s, wire, code } = receipt(target, { allowlist: [target],
      taskAuth: { authorized: true, targets: ["other.example.test"] } })
    const level = sec.classifyError(wire.error, { toolName: "netsec_port_scan", error_code: code })
    t.diagnostic(JSON.stringify({ reason: (s as any).reason, code, level, error: wire.error }))
    assert.equal((s as any).reason, "target_not_in_task_auth")
    assert.equal(wire.error, (s as any).error)
    assert.deepEqual(Object.keys(wire.data), ["error_code"])
    assert.equal(code, "NETSEC_TARGETS_DENIED")
    assert.equal(level, "non_recoverable")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code,
      errorText: wire.error, alreadyPivoted: false }).action, "stop")
    assert.deepEqual(effects, { process: 0, network: 0, token: 0 })
  })
}

test("#563 task-auth matching target remains admitted; unknown refusal stays generic", () => {
  assert.deepEqual(scope.checkNetsecScope({ targets: ["owned.example.test"], allowlist: ["owned.example.test"],
    moduleEnabled: true, requireTaskAuth: true, taskAuth: { authorized: true, targets: ["owned.example.test"] } }),
    { ok: true, targets: ["owned.example.test"], allowlist: ["owned.example.test"] })
  const wire = JSON.parse(JSON.stringify(envelope({ ok: false, error: "timeout", reason: "OWNED_UNKNOWN" }, settings.settingsRequiredResult)))
  assert.equal(readCode(wire), "NETSEC_SCOPE_DENIED")
  assert.equal(sec.classifyError(wire.error, { error_code: readCode(wire) }), "recoverable")
  assert.equal(sec.ERROR_CODE_LEVELS.size, 170); assert.equal(sec.ERROR_CODE_LEVELS.get("MCP_EDIT_MATCH_NOT_FOUND"), "recoverable")
  assert.equal(sec.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.deepEqual(effects, { process: 0, network: 0, token: 0 })
})
