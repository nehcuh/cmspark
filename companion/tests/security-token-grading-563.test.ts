/** #563: typed invalid-token refusals preserve the existing hard gate. */
import test, { before, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-token563-"))
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
process.env.CMSPARK_SECURITY_SECRET = "OWNED_UNISSUED_TOKEN_GUARD_ONLY"
let dispatch: typeof import("../src/tool/companion-dispatch")
let security: typeof import("../src/security")
const effects = { process: 0, network: 0, issuer: 0, confirmation: 0 }
before(async () => {
  const config = await import("../src/config"); await config.initDataDir()
  dispatch = await import("../src/tool/companion-dispatch")
  security = await import("../src/security")
  const policy = (await import("../src/security-policy")).securityPolicy
  const deny = (key: keyof typeof effects) => () => { effects[key]++; throw Error(`OWNED_FORBIDDEN_${key}`) }
  const cp = require("node:child_process"), net = require("node:net")
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) mock.method(cp, key, deny("process"))
  mock.method(net.Socket.prototype, "connect", deny("network"))
  mock.method(globalThis, "fetch", deny("network"))
  for (const key of ["issueToken", "issueTokenFor"] as const) mock.method(policy, key, deny("issuer"))
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => ({ get: (id: string) => ({ id, role: "host", parent_id: null, orchestrator_run_id: "owned-run" }) }),
    getSkillEngine: () => ({}), getCachedTabUrl: () => "https://owned.invalid/", getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(), securityConfirmations: new Proxy({}, { get: () => deny("confirmation") }),
    getComputerEstopEnsureOverride: () => null, getComputerRateLimiterSingleton: () => null,
    rejectPendingForThread: deny("confirmation"), hasPendingForTab: () => false, rejectPendingForTab: deny("confirmation"),
  } as any)
})
after(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0, confirmation: 0 }); mock.restoreAll(); fs.rmSync(owned, { recursive: true, force: true }) })

// Execute the real consumer expressions over the actual dispatcher JSON envelope.
const adapter = ts.createSourceFile("adapter.ts", fs.readFileSync(path.resolve(__dirname, "../../src/llm/adapter.ts"), "utf8"), ts.ScriptTarget.Latest, true)
function variable(name: string) {
  const found: ts.VariableDeclaration[] = []
  function visit(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(adapter) === name) found.push(n); ts.forEachChild(n, visit) }
  visit(adapter); assert.equal(found.length, 1); return found[0].initializer!.getText(adapter)
}
const classifyWire = new Function("toolResult", "toolName", "classifyError", ts.transpileModule(`const classCode=${variable("classCode")}; const errorLevel=${variable("errorLevel")}; return {classCode,errorLevel};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText)
const tools = ["spawn_worker", "spawn_expert_team", "acp_propose_session", "acp_start_session", "acp_apply_diff", "ask_user", "board_complete", "skill_install", "shell_exec", "netsec_port_scan", "osascript_eval", "host_read", "host_write", "host_app", "host_cli", "host_computer"] as const
function params() {
  return { agent_id: "owned-agent", __thread_id: "owned-host", _thread_id: "owned-host", thread_id: "owned-host", security_token: "OWNED_NEVER_ISSUED_TOKEN", goal: "owned inert task", question: "owned inert question", command: "echo inert", path: "owned.txt", name: "owned", application: "owned", kind: "create", body: "inert", app: "owned_app", subcommand: "status", flags: {}, args: [], task: "inert", targets: ["owned.invalid"], expression: "1", url: "https://owned.invalid/", intent_id: "owned-intent", worker_id: "owned-worker" }
}
for (const tool of tools) test(`#563 actual ${tool} unissued token is a typed hard refusal`, async t => {
  // Project only this JS platform branch; no AppleScript/native executor runs.
  if (tool === "osascript_eval") t.mock.method(os, "platform", () => "darwin")
  const wire = JSON.parse(JSON.stringify(await dispatch.executeCompanionTool(tool, params())))
  assert.equal(wire.success, false)
  assert.equal(wire.error, tool === "osascript_eval" ? "Invalid or expired security token" : `Invalid or expired security token for ${tool}`)
  assert.equal(wire.data?.error_code, "SECURITY_TOKEN_INVALID")
  const actual = classifyWire(wire, tool, security.classifyError)
  assert.equal(actual.classCode, "SECURITY_TOKEN_INVALID"); assert.equal(actual.errorLevel, "non_recoverable")
})
test("#563 token code owns the hard grade; fallback and default59 remain unchanged", () => {
  for (const text of ["neutral", "timeout", "not found", "module_disabled", "required", "security block"]) assert.equal(security.classifyError(text, { error_code: "SECURITY_TOKEN_INVALID" }), "non_recoverable")
  assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(security.classifyError("timeout", { error_code: "OWNED_UNKNOWN" }), "recoverable")
  assert.equal(security.classifyError("neutral", { error_code: "OWNED_UNKNOWN" }), "non_recoverable")
})
test("#563 missing-token confirmation requests are still separate refusals", async t => {
  t.mock.method(os, "platform", () => "darwin") // Reach the macOS-only JS token guard on every CI OS.
  for (const tool of tools) {
    const input: any = params(); delete input.security_token
    const wire = JSON.parse(JSON.stringify(await dispatch.executeCompanionTool(tool, input)))
    assert.equal(wire.success, false)
    assert.match(wire.error, /requires .*confirmation|requires L2 security_token/)
    assert.equal(wire.data?.error_code, undefined)
  }
})
test("#563 non-macOS osascript refuses at its original platform gate before token validation", async t => {
  t.mock.method(os, "platform", () => "linux")
  const bridge = await import("../src/bridge/tool-definitions")
  const wire = JSON.parse(JSON.stringify(await dispatch.executeCompanionTool("osascript_eval", params())))
  assert.deepEqual(wire, { success: false, error: bridge.OSASCRIPT_MACOS_ONLY_ERROR })
  assert.equal(security.classifyError(wire.error), "recoverable")
})
