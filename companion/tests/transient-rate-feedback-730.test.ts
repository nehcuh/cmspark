/** #730 real admission/earlyResult + real limiter → actual classifier/adapter.
 * Only platform/auth/confirmation availability are inert boundaries. No process,
 * native, browser, provider, real approval or valid token is created. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import crypto from "node:crypto"
import ts from "typescript"
import { readonlyComputerDraft } from "../src/computer/readonly-session"

const root = path.resolve(__dirname, "../../src")
function source(file: string) {
  const text = fs.readFileSync(path.join(root, file), "utf8")
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function node(sf: ts.SourceFile, predicate: (n: ts.Node) => boolean) {
  const found: ts.Node[] = []
  function visit(n: ts.Node) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit) }
  visit(sf); assert.equal(found.length, 1, `one actual node required: ${sf.fileName}`)
  return found[0].getText(sf)
}
function compile(code: string, globals: Record<string, unknown> = {}) {
  const exports: any = {}
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(js, { exports, module: { exports }, Error, Buffer, ...globals }, { timeout: 2000 })
  return exports
}
const admissionSource = source("tool/l2-admission.ts")
// Keep the complete production module's non-import code, including earlyResult.
const admissionCode = admissionSource.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getFullText(admissionSource)).join("\n")
const securitySource = source("security.ts")
const securityCode = ["IMAGE_FAMILY_ERROR_CODES", "DEFAULT_NON_RECOVERABLE_CODES", "ERROR_CODE_LEVELS"].map(name =>
  node(securitySource, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(securitySource) === name)))
securityCode.push(node(securitySource, n => ts.isFunctionDeclaration(n) && n.name?.text === "classifyError"))
const classifier = compile(securityCode.join("\n"), { isTrustedDomain: () => true })
const adapterSource = source("llm/adapter.ts")
const hardStop = node(adapterSource, n => ts.isIfStatement(n) && n.expression.getText(adapterSource) === 'errorLevel === "security" || errorLevel === "non_recoverable"')
const classCode = node(adapterSource, n => ts.isVariableDeclaration(n) && n.name.getText(adapterSource) === "classCode")
const errorLevel = node(adapterSource, n => ts.isVariableDeclaration(n) && n.name.getText(adapterSource) === "errorLevel" && n.getText(adapterSource).includes("classifyError(toolResult.error"))
const observe = compile(`export async function observe(toolResult){
  let shouldStop=false;const runStats={};const toolName='host_computer';const threadId='owned';
  const ${classCode};const ${errorLevel};
  for(let once=0;once<1;once++){${hardStop}}
  return{classCode,errorLevel,shouldStop,terminal:runStats.terminal||null}
}`, { classifyError: classifier.classifyError, sendToExtension() {}, toolChatErrorPayload: (r: unknown) => r,
  require(name: string) { assert.equal(name, "../capability/user-gate-copy"); return { formatChatErrorLine: () => "Owned refusal" } },
}).observe
const sameTool = compile(source("llm/same-tool-guard.ts").text, { require(name: string) { assert.equal(name, "../security"); return classifier } })

function fixture(count = 30, busy = false, policyOff = false) {
  const effects = { external: 0, issued: 0, approved: 0, injected: 0, native: 0, network: 0, confirmationUnavailable: 0, limiterLookups: 0 }
  const denied = () => { effects.external++; throw new Error("OWNED_EXTERNAL_FORBIDDEN") }
  const types = compile(source("computer/types.ts").text, { require(name: string) { assert.equal(name, "crypto"); return crypto } })
  const blacklist = compile(source("host-use/win/blacklist.ts").text)
  const guards = compile(source("apps/guards.ts").text, { require(name: string) { assert.equal(name, "../host-use/win/blacklist"); return blacklist } })
  const appTypes = source("apps/types.ts")
  const tokenPattern = compile(node(appTypes, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(appTypes) === "APP_TOKEN_PATTERN")))
  const policy = compile(source("computer/policy.ts").text, { require(name: string) {
    if (name === "path") return path.posix
    if (name === "os") return { platform: () => "darwin" }
    if (name === "../apps/guards") return guards
    if (name === "../apps/types") return tokenPattern
    if (name === "./types") return types
    return denied()
  } })
  const preview = compile(source("computer/preview.ts").text, { require(name: string) { assert.equal(name, "./types"); return types } })
  const bindingSource = source("security-policy.ts")
  const lengthConstants = ["MAX_CODE_LENGTH", "MAX_EXPRESSION_LENGTH"].map(name => node(bindingSource, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(bindingSource) === name))).join("\n")
  const binding = compile(`${lengthConstants}\nexport class ActualBinding {${node(bindingSource, n => ts.isMethodDeclaration(n) && n.name.getText(bindingSource) === "bindingPayloadFor")}\n${node(bindingSource, n => ts.isMethodDeclaration(n) && n.name.getText(bindingSource) === "checkLength")}}`, {
    require(name: string) { assert.equal(name, "./computer/types"); return types },
  }).ActualBinding
  const rate = compile(source("computer/rate-limit.ts").text)
  let now = 1_000_000
  const limiter = new rate.InjectionRateLimiter(() => now)
  limiter.record(count)
  const token = "mac.app.owned_rate"
  const config: any = { security: { auto_approve_dangerous: false, allow_all_schemes: false, auto_approve_enterprise_tools: false },
    computer: { coordinateEnabled: !policyOff, modelEnabled: false }, apps: { enabled: true, entries: {
      [token]: { token, kind: "gui", enabled: true, policy: "manual", coordinateAllowed: true, source: "user", display_name: "Owned synthetic app" },
    } } }
  const active = new Map(); if (busy) active.set("owned-other", {})
  const imports: Record<string, unknown> = {
    "../computer/policy": policy,
    "../computer/vault-browser-oneshot": { cleanVaultBrowserTriggerReason: () => undefined },
    "../computer/preview": preview,
    "../computer/unattended-grant": { evaluateUnattendedHostComputerSkipDetail: () => ({ ok: false }), isUnattendedArmed: () => false },
    "../apps/cli-q5": { isCliOutputTainted: () => false },
    "../acp/taint": { isAcpHandbackTainted: () => false },
  }
  const admission = compile(admissionCode, {
    readonlyComputerDraft,
    ComputerError: types.ComputerError, os: { platform: () => "darwin" }, WebSocket: { OPEN: 1 },
    getConfig: () => config, getComputerTaskAbortRegistry: () => active,
    logger: { info() {}, warn() {} }, familyOfTool: () => null, detectCriticalApis: () => [],
    SecurityPolicy: binding, securityPolicy: { checkLength: (tool: string, code: string) => new binding().checkLength(tool, code), issueToken: denied, issueTokenFor: denied },
    require(name: string) { return Object.hasOwn(imports, name) ? imports[name] : denied() },
  })
  const finishes: unknown[][] = []
  const request = async () => {
    const result = await admission.runL2ToolAdmission({ toolName: "host_computer", finalParams: {
      app: token, task: "Owned synthetic task", actions: [{ action: "click", target: "Owned" }], budget: 15,
    }, toolCallId: "owned-730", startedAt: now, ws: { readyState: 1 }, isOutboundMcpCall: false,
      logToolFinish: (...args: unknown[]) => finishes.push(args), getThreadManager: () => ({ get: () => undefined }),
      getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", activeTrayConfirmsByWs: new WeakMap(), clients: new Set(), wsAuthGet: () => undefined,
      computerRateLimiter: async () => { effects.limiterLookups++; return limiter },
      // This is a controlled unavailable confirmation boundary, not a native call.
      nativeConfirmationUnavailable: async () => { effects.confirmationUnavailable++ },
      securityConfirmations: new Proxy({}, { get: () => denied }),
    })
    assert.equal(result.ok, false)
    const wire = JSON.parse(JSON.stringify(result.result))
    assert.equal(wire.success, false)
    return wire
  }
  const noAuthority = () => {
    for (const key of ["external", "issued", "approved", "injected", "native", "network"] as const) assert.equal(effects[key], 0, key)
  }
  return { request, limiter, advance: (ms: number) => { now += ms }, effects, finishes, noAuthority }
}

for (const elapsed of [0, 59_999]) test(`#730 actual saturated admission remains typed recoverable at ${elapsed}ms`, async t => {
  const f = fixture(); f.advance(elapsed)
  const wire = await f.request()
  const flow = await observe(wire)
  t.diagnostic(JSON.stringify({ producer: "whole-admission-earlyResult", elapsed, wire, flow, inWindow: f.limiter.countInWindow(), effects: f.effects }))
  assert.equal(flow.errorLevel, "recoverable"); assert.equal(flow.shouldStop, false); assert.equal(flow.terminal, null)
  assert.equal(wire.error_code, "RATE_LIMITED")
  assert.match(wire.error, /wait for the window to drain/)
  assert.equal(f.finishes.length, 1); assert.equal(f.effects.confirmationUnavailable, 0)
  assert.equal(f.limiter.countInWindow(), 30); assert.equal(f.limiter.totalApproved(), 30)
  f.noAuthority()
})
for (const [count, elapsed] of [[29, 0], [30, 60_000]] as const) test(`#730 unsaturated ${count}/${elapsed} reaches original confirmation gate without authority`, async () => {
  const f = fixture(count); f.advance(elapsed)
  const wire = await f.request()
  assert.equal(wire.error_code, "DESKTOP_CONFIRMATION_UNAVAILABLE")
  assert.equal(f.effects.confirmationUnavailable, 1); assert.equal(f.effects.limiterLookups, 1)
  assert.equal(f.limiter.countInWindow(), elapsed ? 0 : 29); assert.equal(f.limiter.totalApproved(), count)
  f.noAuthority()
})
test("#730 only real clock expiry clears saturation; refusal does not queue, retry or record an injection", async () => {
  const f = fixture(); const wire = await f.request()
  assert.equal(wire.error_code, "RATE_LIMITED"); assert.equal(f.effects.limiterLookups, 1)
  assert.equal(f.finishes.length, 1); assert.equal(f.limiter.saturated(), true); f.noAuthority()
})
test("#730 existing computer-task busy is typed but remains non-recoverable before rate lookup", async () => {
  const f = fixture(30, true), wire = await f.request()
  assert.equal(wire.error_code, "COMPUTER_TASK_BUSY")
  const flow = await observe(wire); assert.equal(flow.errorLevel, "non_recoverable"); assert.equal(flow.shouldStop, true)
  assert.equal(f.effects.limiterLookups, 0); assert.equal(f.effects.confirmationUnavailable, 0); f.noAuthority()
})
test("#730 real disabled policy still refuses before the limiter and keeps its hard grade", async () => {
  const f = fixture(30, false, true), wire = await f.request()
  assert.equal(wire.error_code, "COMPUTER_DISABLED")
  const flow = await observe(wire); assert.equal(flow.errorLevel, "non_recoverable"); assert.equal(flow.shouldStop, true)
  assert.equal(f.effects.limiterLookups, 0); assert.equal(f.effects.confirmationUnavailable, 0); f.noAuthority()
})
for (const text of ["", "Security Block: permission denied", "element_not_found timeout 429"]) test(`#730 actual rate wire keeps intrinsic grade with metadata ${JSON.stringify(text)}`, async () => {
  const f = fixture(), wire = await f.request()
  const flow = await observe({ ...wire, error: text })
  assert.equal(flow.classCode, "RATE_LIMITED"); assert.equal(flow.errorLevel, "recoverable"); assert.equal(flow.shouldStop, false); f.noAuthority()
})
for (const [error_code, expected] of [["ACP_OWNER_MISMATCH", "security"], ["INTENT_BUSY", "non_recoverable"], ["MAX_WORKERS", "non_recoverable"]]) test(`#730 explicit existing ${error_code} never changes grade`, async () => {
  assert.equal(classifier.classifyError("timeout element_not_found", { error_code }), expected)
  const flow = await observe({ success: false, error: "owned refusal", error_code })
  assert.equal(flow.errorLevel, expected); assert.equal(flow.shouldStop, true)
})
test("#730 typed rate keeps the original third-failure breaker without a locator pivot", async () => {
  const f = fixture(), wire = await f.request()
  assert.equal(sameTool.decideSameToolFailure({ failCount: 1, threshold: 3, errorCode: wire.error_code, errorText: "element_not_found", alreadyPivoted: false }).action, "count")
  assert.equal(sameTool.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: wire.error_code, errorText: "element_not_found", alreadyPivoted: false }).action, "stop")
  f.noAuthority()
})
test("#730 legacy unknown/no-code fallback is unchanged", () => {
  for (const error_code of [undefined, "UNKNOWN_BUSY_CODE"]) {
    assert.equal(classifier.classifyError("owned neutral failure", { error_code }), "non_recoverable")
    assert.equal(classifier.classifyError("timeout", { error_code }), "recoverable")
  }
  assert.equal(classifier.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
})
