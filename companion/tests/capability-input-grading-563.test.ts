/** #563: actual pre-spawn argument refusals, not new command authority. */
import test, { before, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-args563-"))
const root = path.join(owned, "workspace")
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
process.env.CMSPARK_SECURITY_SECRET = "OWNED_ARGUMENT_GUARD_NO_TOKEN"
let config: typeof import("../src/config"), workspace: typeof import("../src/capability/workspace"), shell: typeof import("../src/capability/shell"), security: typeof import("../src/security")
let nativeEffects = 0, issuedTokens = 0
function enabled() {
  config.saveConfig({ capability_profile: "enterprise", modules: {
    shell: { available: true, enabled: true, policy: "allowlist", allowlist_commands: ["echo"] },
    "devsec-workspace": { available: true, enabled: true },
  } } as any)
  config.clearConfigCache()
}
before(async () => {
  const cp = require("node:child_process")
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) mock.method(cp, key, () => { nativeEffects++; throw Error("NATIVE_EFFECT_FORBIDDEN") })
  config = await import("../src/config")
  await config.initDataDir(); enabled()
  const policy = (await import("../src/security-policy")).securityPolicy
  for (const key of ["issueToken", "issueTokenFor"] as const) mock.method(policy, key, () => { issuedTokens++; throw Error("TOKEN_ISSUANCE_FORBIDDEN") })
  workspace = await import("../src/capability/workspace"); shell = await import("../src/capability/shell"); security = await import("../src/security")
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([97, 0, 98])); fs.writeFileSync(path.join(root, "large.txt"), Buffer.alloc(512 * 1024 + 1, 120)); fs.writeFileSync(path.join(root, "text.txt"), "owned text"); fs.mkdirSync(path.join(root, "directory"))
})
after(() => { assert.equal(nativeEffects, 0); assert.equal(issuedTokens, 0); mock.restoreAll(); fs.rmSync(owned, { recursive: true, force: true }) })
// Execute actual adapter expressions over real producer JSON, not hand-built assumed payloads.
const adapter = ts.createSourceFile("adapter.ts", fs.readFileSync(path.resolve(__dirname, "../../src/llm/adapter.ts"), "utf8"), ts.ScriptTarget.Latest, true)
function variable(name: string) {
  const nodes: ts.VariableDeclaration[] = []
  function visit(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(adapter) === name) nodes.push(n); ts.forEachChild(n, visit) }
  visit(adapter); assert.equal(nodes.length, 1); return nodes[0].initializer!.getText(adapter)
}
const classifyWire = new Function("toolResult", "toolName", "classifyError", ts.transpileModule(`const classCode=${variable("classCode")}; const errorLevel=${variable("errorLevel")}; return {classCode,errorLevel};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText)
const cases = [
  ["binary file", "WORKSPACE_FILE_UNSUPPORTED", () => workspace.workspaceReadFile(root, "binary.bin"), "workspace_read_file"],
  ["oversize file", "WORKSPACE_FILE_UNSUPPORTED", () => workspace.workspaceReadFile(root, "large.txt"), "workspace_read_file"],
  ["blank command", "SHELL_INPUT_INVALID", () => shell.shellExec({ command: "   ", cwd: root }), "shell_exec"],
  ["oversize command", "SHELL_INPUT_INVALID", () => shell.shellExec({ command: "x".repeat(8001), cwd: root }), "shell_exec"],
  ["cwd file", "SHELL_INPUT_INVALID", () => shell.shellExec({ command: "echo inert", cwd: path.join(root, "text.txt") }), "shell_exec"],
  ["cwd missing", "SHELL_INPUT_INVALID", () => shell.shellExec({ command: "echo inert", cwd: path.join(root, "missing") }), "shell_exec"],
] as const
for (const [name, code, produce, tool] of cases) test(`#563 actual ${name} refusal keeps the turn recoverable`, async () => {
  const wire = JSON.parse(JSON.stringify(await produce()))
  assert.equal(wire.success, false); assert.equal(wire.data?.error_code, code)
  const classified = classifyWire(wire, tool, security.classifyError)
  assert.equal(classified.classCode, code); assert.equal(classified.errorLevel, "recoverable")
  for (const text of [wire.error, "neutral", "security block", "permission denied", "timeout"]) assert.equal(security.classifyError(text, { error_code: code }), "recoverable", "the finite input-refusal code owns its grade")
})
test("#563 current directory/notfound refusal and unknown fallback remain unchanged", () => {
  const directory = workspace.workspaceReadFile(root, "directory")
  assert.equal(directory.success, false); assert.equal(directory.error, "not a file"); assert.equal(classifyWire(JSON.parse(JSON.stringify(directory)), "workspace_read_file", security.classifyError).errorLevel, "recoverable")
  assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(security.ERROR_CODE_LEVELS.get("INVALID_ARGS"), "non_recoverable"); assert.equal(security.ERROR_CODE_LEVELS.get("THREAD_REQUIRED"), "non_recoverable")
  for (const error_code of [undefined, "OWNED_UNKNOWN_CODE"]) { assert.equal(security.classifyError("timeout", { error_code }), "recoverable"); assert.equal(security.classifyError("neutral", { error_code }), "non_recoverable") }
})
test("#563 module and command policy refusals are not argument codes", async () => {
  try {
    config.saveConfig({ modules: { shell: { available: true, enabled: false }, "devsec-workspace": { available: true, enabled: false } } } as any); config.clearConfigCache()
    for (const result of [workspace.workspaceReadFile(root, "binary.bin"), await shell.shellExec({ command: "echo inert", cwd: root })]) { assert.equal(result.success, false); assert.match(result.error || "", /module_disabled/); assert.equal(result.data?.error_code, undefined) }
  } finally { enabled() }
  const denied = await shell.shellExec({ command: "not_allowlisted_inert", cwd: root })
  assert.equal(denied.success, false); assert.match(denied.error || "", /allowlist/); assert.equal(denied.data?.error_code, undefined)
})
test("#563 real workspace dispatcher carries the code; shell still denies missing/invalid L2", async () => {
  const api = await import("../src/tool/companion-dispatch")
  api.bindCompanionDispatchRuntime({ getThreadManager: () => ({ get: () => ({ workspace_root: root }) }), getSkillEngine: () => null, getComputerEstopEnsureOverride: () => null } as any)
  const produced = JSON.parse(JSON.stringify(await api.executeCompanionTool("workspace_read_file", { path: "binary.bin", __thread_id: "owned-thread" })))
  assert.equal(produced.success, false); assert.equal(produced.data.error_code, "WORKSPACE_FILE_UNSUPPORTED"); assert.equal(classifyWire(produced, "workspace_read_file", security.classifyError).errorLevel, "recoverable")
  for (const token of [undefined, "OWNED_INVALID_NOT_ISSUED"]) {
    const refused = await api.executeCompanionTool("shell_exec", { command: "echo inert", cwd: root, security_token: token })
    assert.equal(refused.success, false); assert.match(refused.error || "", token ? /Invalid or expired security token/ : /requires L2 security_token confirmation/)
    assert.notEqual(refused.data?.error_code, "SHELL_INPUT_INVALID")
    assert.equal(classifyWire(JSON.parse(JSON.stringify(refused)), "shell_exec", security.classifyError).errorLevel, "non_recoverable")
  }
})

for (const command of ["   ", "x".repeat(8001), "not_allowlisted_inert"]) test(`#563 real pre-L2 rejects input of length ${command.length} with its finite code`, async () => {
  const admission = await import("../src/tool/l2-admission")
  const blocked = () => { nativeEffects++; throw Error("CONFIRMATION_OR_PREVIEW_FORBIDDEN") }
  const finished: unknown[][] = []
  const result = await admission.runL2ToolAdmission({ toolName: "shell_exec", finalParams: { command, cwd: root }, toolCallId: "owned-args", startedAt: Date.now(), ws: { readyState: 1 }, sessionId: "owned-no-auth", isOutboundMcpCall: false,
    logToolFinish: (...args: unknown[]) => finished.push(args), securityConfirmations: new Proxy({}, { get: () => blocked }),
    getThreadManager: () => ({ get: () => ({ workspace_root: root }) }), getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: blocked,
    activeTrayConfirmsByWs: new WeakMap(), clients: new Set(), wsAuthGet: () => undefined,
  } as any)
  assert.equal(result.ok, false)
  if (result.ok) throw Error("expected original pre-L2 refusal")
  const wire = JSON.parse(JSON.stringify(result.result)); assert.equal(wire.success, false)
  const policyRefusal = command === "not_allowlisted_inert"
  assert.equal(wire.data.error_code, policyRefusal ? "SHELL_SCOPE_DENIED" : "SHELL_INPUT_INVALID")
  assert.equal(classifyWire(wire, "shell_exec", security.classifyError).errorLevel, policyRefusal ? "non_recoverable" : "recoverable")
  assert.equal(nativeEffects, 0); assert.equal(issuedTokens, 0)
})
