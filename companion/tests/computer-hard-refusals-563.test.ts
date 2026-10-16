/** Actual JS executor/policy -> JSON -> actual adapter. Inert seams are not L2 grants/native/human approval. */
import test, { before, after, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import cp from "node:child_process"
import net from "node:net"
import ts from "typescript"
import type { ComputerExecutorDeps } from "../src/computer/executor"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-hard-seven-"))
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let runComputerTask: typeof import("../src/computer/executor").runComputerTask
let config: typeof import("../src/config")
let admission: typeof import("../src/tool/l2-admission")
let coordinate: typeof import("../src/computer/policy")
let computer: typeof import("../src/computer/types")
let security: typeof import("../src/security")
let securityPolicy: typeof import("../src/security-policy").securityPolicy
const rows: any[] = []
before(async () => {
  config = await import("../src/config"); await config.initDataDir()
  runComputerTask = (await import("../src/computer/executor")).runComputerTask
  admission = await import("../src/tool/l2-admission")
  coordinate = await import("../src/computer/policy")
  computer = await import("../src/computer/types")
  security = await import("../src/security")
  securityPolicy = (await import("../src/security-policy")).securityPolicy
})
after(() => { console.log("HARD_SEVEN_ACTUAL_RECEIPTS " + JSON.stringify(rows)); fs.rmSync(owned, { recursive: true, force: true }) })
const CODES = ["COMPUTER_DISABLED", "APP_NOT_WHITELISTED", "DANGER_DENIED_BY_USER", "DIALOG_PAUSED_DENIED", "BUDGET_DENIED", "UNCROSS_DENIED", "EMERGENCY_STOP_LOST"] as const
function effectsTrap(t: TestContext) {
  const e = { process: 0, network: 0, issuer: 0 }
  for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    t.mock.method(cp, k, () => { e.process++; throw Error("OWNED_PROCESS_FORBIDDEN") })
  t.mock.method(net.Socket.prototype, "connect", () => { e.network++; throw Error("OWNED_NETWORK_FORBIDDEN") })
  t.mock.method(globalThis, "fetch", () => { e.network++; throw Error("OWNED_FETCH_FORBIDDEN") })
  for (const k of ["issueToken", "issueTokenFor"] as const)
    t.mock.method(securityPolicy, k, () => { e.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") })
  return e
}
// Use actual return/consumer statements; only native PsRunner, windows, frames,
// OCR and evidence are inert boundaries. No effective L2, native or human action.
const dispatchPath = path.resolve(__dirname, "../../src/tool/companion-dispatch.ts")
const dispatchSource = ts.createSourceFile(dispatchPath, fs.readFileSync(dispatchPath, "utf8"), ts.ScriptTarget.Latest, true)
const returns: string[] = []
function collectReturn(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(dispatchSource) === "!result.success" &&
    node.thenStatement.getText(dispatchSource).includes("evidence_dir") && ts.isBlock(node.thenStatement)) {
    const returned = node.thenStatement.statements.find(ts.isReturnStatement)
    if (returned) returns.push(returned.getText(dispatchSource))
  }
  ts.forEachChild(node, collectReturn)
}
collectReturn(dispatchSource)
assert.equal(returns.length, 1)
const failureEnvelope = new Function("result", returns[0])
const adapterPath = path.resolve(__dirname, "../../src/llm/adapter.ts")
const adapterSource = ts.createSourceFile(adapterPath, fs.readFileSync(adapterPath, "utf8"), ts.ScriptTarget.Latest, true)
const consumerStatements: string[] = []
function collectConsumer(node: ts.Node): void {
  if (ts.isVariableStatement(node)) {
    const name = node.declarationList.declarations[0]?.name.getText(adapterSource)
    if (name === "classCode" || name === "errorLevel") consumerStatements.push(node.getText(adapterSource))
  }
  ts.forEachChild(node, collectConsumer)
}
collectConsumer(adapterSource)
assert.equal(consumerStatements.length, 2)
const consume = new Function("toolResult", "classifyError", "toolName",
  ts.transpile(consumerStatements.join("\n") + ";return {classCode,errorLevel};", {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }))

const HWND = 424242
const EXE = "C:/OwnedComputerFixture/app.exe"
const windowInfo = { hwnd: HWND, pid: 1234, exePath: EXE, title: "Owned fixture", alive: true,
  rect: { x: 100, y: 100, width: 640, height: 480 } }

function fixture(overrides: Partial<ComputerExecutorDeps> = {}) {
  const unexpected: string[] = []
  const trap = async () => { unexpected.push("native/confirmation"); throw new Error("UNEXPECTED_NATIVE_EFFECT") }
  let captures = 0
  const deps = {
    config: { apps: { enabled: true, entries: { "win.app.owned": {
      token: "win.app.owned", kind: "gui", display_name: "Owned fixture", source: "user", policy: "manual",
      enabled: true, coordinateAllowed: true, added_at: "2026-10-16",
      exe: { path: EXE, user_writable_dir: false },
    } } }, computer: { coordinateEnabled: true } },
    capturer: { captureWindow: async () => ({ hwnd: HWND, rect: windowInfo.rect,
      client: { x: 10, y: 40, width: 620, height: 430 }, dpi: 96,
      path: `OWNED_INERT_${++captures}`, sha256: "owned", black: false, fallbackUsed: false, osrBlackSuspected: false }),
      crop: async (_source: string, _rect: unknown, out: string) => out,
      diffRegion: async () => ({ diffRatio: 0 }), diff: async () => ({ diffRatio: 0 }) },
    locator: { ensureLanguage: async () => {}, ocr: async () => ({ language: "zh-Hans", words: [] }) },
    injector: { click: trap, typeText: trap, keyChord: trap, scroll: trap, drag: trap,
      probeWindow: async () => windowInfo, foregroundHwnd: async () => HWND, forceForeground: async () => true },
    windows: { enumerateByExe: async () => [windowInfo], infoForHwnd: async () => windowInfo },
    securityEnv: { assertInjectable: async () => {} },
    evidenceFactory: () => ({ dir: "OWNED_INERT_EVIDENCE", init: async () => {}, finalize: async () => {},
      appendAction: async () => {}, sealScreenshot: async () => ({ sha256: "owned" }) }),
    confirm: trap, removeFile: async () => {}, now: () => 1000000, sleep: async () => {}, ...overrides,
  } as unknown as ComputerExecutorDeps
  return { deps, unexpected }
}


function grade(name: string, result: any, code: string, f: ReturnType<typeof fixture>) {
  assert.equal(result.success, false); assert.equal(result.errorCode, code); assert.deepEqual(f.unexpected, [])
  const wire = JSON.parse(JSON.stringify(failureEnvelope(result)))
  const actual = consume(wire, security.classifyError, "host_computer")
  rows.push({ name, code, wire, actual })
  assert.equal(wire.data.error_code, code); assert.equal(actual.classCode, code)
  assert.equal(actual.errorLevel, "non_recoverable")
}
const base = { task: "Owned refusal", app: "win.app.owned", actions: [{ action: "click" as const, x: 20, y: 20 }] }
for (const label of ["ordinary", "timeout", "disconnected", "security block"])
  for (const variant of ["coordinate_off", "apps_off", "invalid_token", "missing", "disabled", "non_gui", "no_identity"]) {
    test(`#563 actual executor ${variant} with ${label} metadata retains hard refusal`, async t => {
      const effects = effectsTrap(t), f = fixture(); let params = { ...base }
      const cfg = f.deps.config, entry = cfg.apps!.entries![base.app]; entry.display_name = label
      if (variant === "coordinate_off") cfg.computer!.coordinateEnabled = false
      if (variant === "apps_off") cfg.apps!.enabled = false
      if (variant === "invalid_token") params.app = label + " invalid"
      if (variant === "missing") params.app = "win.app." + label.replaceAll(" ", "_")
      if (variant === "disabled") entry.enabled = false
      if (variant === "non_gui") entry.kind = "cli"
      if (variant === "no_identity") delete entry.exe
      grade(variant + ":" + label, await runComputerTask(params, f.deps), variant === "coordinate_off" ? "COMPUTER_DISABLED" : "APP_NOT_WHITELISTED", f)
      assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 })
    })
  }
for (const kind of ["danger", "dialog", "budget", "uncross"] as const) {
  test(`#563 actual ${kind} denial keeps hard grade and existing earlier fake clicks`, async t => {
    const effects = effectsTrap(t), f = fixture(); let clicks = 0, denials = 0
    f.deps.injector.click = async () => { clicks++ }
    f.deps.confirm = async () => { denials++; return { confirmationId: "OWNED_DENIED", approved: false, reason: "denied" } }
    if (kind === "danger") f.deps.locator.ocr = async () => ({ language: "zh-Hans", words: [{ text: "delete", x: 105, y: 135, w: 40, h: 20 }] })
    if (kind === "dialog") f.deps.capturer.diff = async () => ({ diffRatio: 0.5 })
    const n = kind === "budget" ? 2 : kind === "uncross" ? 4 : 1
    const result = await runComputerTask({ ...base, ...(kind === "budget" ? { budget: 1 } : {}), actions: Array(n).fill(base.actions[0]) }, f.deps)
    grade(kind, result, { danger: "DANGER_DENIED_BY_USER", dialog: "DIALOG_PAUSED_DENIED", budget: "BUDGET_DENIED", uncross: "UNCROSS_DENIED" }[kind], f)
    assert.equal(denials, 1); assert.equal(clicks, { danger: 0, dialog: 1, budget: 1, uncross: 3 }[kind])
    rows.push({ name: kind + "_effects", fakeClicks: clicks, denialCallbacks: denials, approvals: 0, native: 0, effects })
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 })
  })
}
for (const phase of ["top", "wait", "preinject"] as const)
  test(`#563 helper lost ${phase} is hard before injection`, async t => {
    const effects = effectsTrap(t), f = fixture(); let calls = 0
    f.deps.abortCheck = () => ++calls > (phase === "top" ? 0 : 1) ? "estop-lost" : null
    const actions = phase === "wait" ? [{ action: "wait" as const, ms: 1 }] : base.actions
    grade(phase, await runComputerTask({ ...base, actions }, f.deps), "EMERGENCY_STOP_LOST", f)
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 })
  })
for (const code of CODES)
  test(`#563 genuine typed ${code} is independent of diagnostic wording`, async t => {
    const effects = effectsTrap(t)
    for (const message of ["owned refusal", "timeout disconnected", "permission denied", "Security Block: owned"] ) {
      const f = fixture(); f.deps.securityEnv.assertInjectable = async () => { throw new computer.ComputerError(code, message) }
      grade("controlled_typed:" + code + ":" + message, await runComputerTask(base, f.deps), code, f)
    }
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 })
  })

async function preL2(t: TestContext, variant: string, label: string, fault?: Error) {
  t.mock.method(os, "platform", () => "darwin")
  const effects = effectsTrap(t), cfg = config.getConfig(), oldApps = cfg.apps, oldComputer = cfg.computer
  const disk = path.join(process.env.CMSPARK_DATA_DIR!, "config.json"), before = fs.readFileSync(disk)
  let token = "mac.app." + label
  cfg.apps = { enabled: true, entries: { [token]: { token, kind: "gui", display_name: label, source: "user", policy: "manual", enabled: true, coordinateAllowed: true, added_at: "2026-10-16", bundleId: "com.example.Owned" } } }
  cfg.computer = { ...oldComputer, coordinateEnabled: true }
  const entry = cfg.apps.entries[token]
  if (variant === "coordinate_off") cfg.computer.coordinateEnabled = false
  if (variant === "apps_off") cfg.apps.enabled = false
  if (variant === "invalid_token") token = label + " invalid"
  if (variant === "missing") cfg.apps.entries = {}
  if (variant === "disabled") entry.enabled = false
  if (variant === "non_gui") entry.kind = "cli"
  try {
    let typed: any = fault
    if (fault) t.mock.method(coordinate, "assertCoordinateAllowed", () => { throw fault })
    else { try { coordinate.assertCoordinateAllowed(cfg, token, { allowVaultBrowserOneShot: true }) } catch (e) { typed = e }; assert.ok(typed instanceof computer.ComputerError) }
    const finish: any[][] = [], trap = () => { throw Error("OWNED_AFTER_POLICY_FORBIDDEN") }
    const actual = await admission.runL2ToolAdmission({ toolName: "host_computer", finalParams: { app: token, task: "Owned refusal", actions: [{ action: "click", target: "Owned" }] }, toolCallId: "owned", startedAt: Date.now(), ws: { readyState: 1 }, sessionId: "owned-no-auth", isOutboundMcpCall: false,
      logToolFinish: (...args: any[]) => finish.push(args), securityConfirmations: new Proxy({}, { get: () => trap }), getThreadManager: () => ({ get: () => undefined }), getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: trap, activeTrayConfirmsByWs: new WeakMap(), clients: new Set(), wsAuthGet: () => undefined } as any)
    assert.equal(actual.ok, false); if (actual.ok) throw Error("Expected refusal")
    const wire = JSON.parse(JSON.stringify(actual.result)), consumer = consume(wire, security.classifyError, "host_computer")
    rows.push({ name: "preL2:" + variant + ":" + label, typedCode: typed.code, wire, consumer, finishCount: finish.length, effects })
    assert.equal(wire.error, typed.message); assert.equal(finish.length, 1); assert.deepEqual(finish[0][3], actual.result)
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 })
    return { wire, typed, consumer }
  } finally { cfg.apps = oldApps; cfg.computer = oldComputer; assert.deepEqual(fs.readFileSync(disk), before) }
}
for (const variant of ["coordinate_off", "apps_off", "invalid_token", "missing", "disabled", "non_gui"])
  for (const label of ["ordinary", "timeout", "disconnected"])
    test(`#563 preL2 actual ${variant} ${label} has genuine finite code and one finish`, async t => {
      const { wire, typed, consumer } = await preL2(t, variant, label)
      assert.equal(typed.code, variant === "coordinate_off" ? "COMPUTER_DISABLED" : "APP_NOT_WHITELISTED")
      assert.equal(wire.error_code, typed.code); assert.equal(consumer.classCode, typed.code); assert.equal(consumer.errorLevel, "non_recoverable")
    })
for (const code of ["COMPUTER_DISABLED", "APP_NOT_WHITELISTED", "APP_COORDINATE_DENIED", "APP_COORDINATE_STRUCTURAL"])
  test(`#563 plain Error cannot forge finite code ${code}`, async t => {
    const e = Object.assign(Error("timeout owned ordinary"), { code, name: "ComputerError" })
    const { wire, consumer } = await preL2(t, "missing", "owned", e)
    assert.equal(Object.hasOwn(wire, "error_code"), false); assert.equal(consumer.errorLevel, "recoverable")
  })
for (const code of ["DANGER_DENIED_BY_USER", "EMERGENCY_STOP_LOST", "OWNED_UNKNOWN_CODE", "APP_NOT_WHITELISTED "])
  test(`#563 genuine unrelated code ${code} retains message-only admission fallback`, async t => {
    const { wire, consumer } = await preL2(t, "missing", "owned", new computer.ComputerError(code as any, "timeout owned unrelated"))
    assert.equal(Object.hasOwn(wire, "error_code"), false); assert.equal(consumer.errorLevel, "recoverable")
  })
test("#563 only seven additional codes and original defaults/mixed fallback remain", () => {
  assert.equal(security.ERROR_CODE_LEVELS.size, 160); assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  for (const code of CODES) assert.equal(security.ERROR_CODE_LEVELS.get(code), "non_recoverable")
  for (const code of [undefined, "OWNED_UNKNOWN_CODE", "EMERGENCY_STOP_UNAVAILABLE", "TYPE_NO_EFFECT", "APP_WINDOW_NOT_FOUND", "INVALID_ACTION"])
    for (const [error, level] of [["timeout", "recoverable"], ["owned refusal", "non_recoverable"]]) assert.equal(security.classifyError(error, { error_code: code }), level)
})
