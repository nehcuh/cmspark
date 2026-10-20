/** #723 D3: real confirmation producer; no native/browser/human approval claim. */
import test from "node:test"
import assert from "node:assert/strict"
import { SecurityConfirmationManager } from "../src/security-confirmation"

function originFact(manager: SecurityConfirmationManager, decision: object, socket: object): boolean {
  const method = (manager as any).isOriginApproval
  return typeof method === "function" && method.call(manager, decision, socket) === true
}

test("D3 only successful actual origin response carries private approval provenance", async () => {
  const manager = new SecurityConfirmationManager(), socket = {} as any, frames: any[] = []
  const pending = manager.request(m => frames.push(m), { toolName: "host_computer", dangerousApis: [], code: "owned read" }, { originWs: socket })
  const id = frames[0].confirmation_id
  assert.equal(manager.respondFrom(id, true, socket).outcome, "resolved")
  const decision = await pending
  assert.equal(decision.approved, true)
  assert.equal(originFact(manager, decision, socket), true)
  assert.equal(originFact(manager, { ...decision }, socket), false)
  assert.equal(originFact(manager, decision, {}), false)
})

test("D3 privileged response retains original result but cannot mint reusable origin fact", async () => {
  const manager = new SecurityConfirmationManager(), socket = {} as any, frames: any[] = []
  const pending = manager.request(m => frames.push(m), { toolName: "host_computer", dangerousApis: [], code: "owned read" }, { originWs: socket })
  manager.respond(frames[0].confirmation_id, true)
  const decision = await pending
  assert.equal(decision.approved, true)
  assert.equal(originFact(manager, decision, socket), false)
})

test("D3 foreign/nonce/replay and denied actual responses cannot acquire provenance", async () => {
  const manager = new SecurityConfirmationManager(), socket = {} as any, frames: any[] = []
  const pending = manager.request(m => frames.push(m), { toolName: "host_computer", dangerousApis: [], code: "owned read", nonceChallenge: "ABC123" }, { originWs: socket })
  const id = frames[0].confirmation_id
  assert.equal(manager.respondFrom(id, true, {} as any, "ABC123").outcome, "origin_mismatch")
  assert.equal(manager.respondFrom(id, true, socket, "BAD").outcome, "nonce_retry")
  assert.equal(manager.respondFrom(id, true, socket, "ABC123").outcome, "resolved")
  const decision = await pending
  assert.equal(originFact(manager, decision, socket), true)
  assert.equal(manager.respondFrom(id, true, socket, "ABC123").outcome, "unknown")
  const denied = manager.request(m => frames.push(m), { toolName: "host_computer", dangerousApis: [], code: "owned read" }, { originWs: socket })
  manager.respondFrom(frames.at(-1).confirmation_id, false, socket)
  assert.equal(originFact(manager, await denied, socket), false)
})

import fs from "node:fs"
import path from "node:path"
import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import ts from "typescript"
import { readonlyComputerDraft, computerReadConnectionFor, retireComputerReadonlyThread } from "../src/computer/readonly-session"
import { bindChatEvidenceScope } from "../src/business-evidence/chat-scope"
import { ThreadManager } from "../src/threads/thread-manager"
import * as configuration from "../src/config"
import { runL2ToolAdmission } from "../src/tool/l2-admission"
import { runMultiAgentToolPregate } from "../src/orchestrator/tool-pregate"
import { securityPolicy } from "../src/security-policy"
import { assertCoordinateAllowed } from "../src/computer/policy"
import { getComputerSessionTrust, resolveComputerTrustKey } from "../src/computer/session-trust"
import { InjectionRateLimiter } from "../src/computer/rate-limit"
const COMPANION_ROOT = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../.." : "..")

// Actual whole server factory. Only OS/irrelevant admission surfaces are inert;
// normal router bindChatEvidenceScope, ThreadManager, L2, token issuance and
// origin confirmation manager are real. No hand-assembled trusted subject.
function serverFixture(executeTask?: (params: any, options: any) => Promise<any>) {
  const file = path.join(COMPANION_ROOT, "src/server.ts")
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const factory = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createToolExecutor")!
  assert.ok(factory)
  // The real legacy L2 path deliberately does not run off macOS/Windows.
  // Execute its actual dispatch missing-token refusal, rather than asserting
  // that an unsupported-platform request received a token or a human prompt.
  const dispatchFile = path.join(COMPANION_ROOT, "src/tool/companion-dispatch.ts")
  const dispatchSource = ts.createSourceFile(dispatchFile, fs.readFileSync(dispatchFile, "utf8"), ts.ScriptTarget.Latest, true)
  const missingGuards: ts.IfStatement[] = []
  const findMissingGuard = (n: ts.Node) => {
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text === "host_computer") {
      const statements = n.statements.flatMap(statement => ts.isBlock(statement) ? Array.from(statement.statements) : [statement])
      for (const statement of statements) if (ts.isIfStatement(statement) && statement.expression.getText(dispatchSource) === "!params.security_token") missingGuards.push(statement)
    }
    ts.forEachChild(n, findMissingGuard)
  }
  findMissingGuard(dispatchSource)
  assert.equal(missingGuards.length, 1)
  const rejectMissingToken = new Function("params", ts.transpile(missingGuards[0].getText(dispatchSource), { target: ts.ScriptTarget.ES2022 }))
  const manager = new SecurityConfirmationManager(), threads = new ThreadManager()
  const thread = threads.create("owned D3"), other = threads.create("owned other")
  const cfg = configuration.getConfig(), oldApps = cfg.apps, oldComputer = cfg.computer
  const app = "mac.app.owned723"
  cfg.apps = { enabled: true, entries: { [app]: { token: app, kind: "gui", display_name: "Owned application", enabled: true,
    coordinateAllowed: true, source: "user", policy: "manual", added_at: "2026-10-20", bundleId: "com.example.owned723",
    exe: { path: "C:\\Owned\\readonly723.exe", user_writable_dir: false } } } }
  cfg.computer = { ...cfg.computer, coordinateEnabled: true }
  class Socket extends EventEmitter { readyState = 1; frames: any[] = []; send(b: string) { const frame = JSON.parse(b); this.frames.push(frame); if (frame.type === "security.confirmation.request") this.emit("confirmation", frame) } }
  const socket = new Socket(), auth = { authenticated: true, surface: "panel", origin: "chrome-extension://owned" }
  const authMap = new WeakMap<object, any>([[socket, auth]]), executions: any[] = [], tokens: string[] = []
  let failure = false
  const dependencies: Record<string, any> = {
    exports: {}, securityConfirmations: manager, randomUUID, assertCoordinateAllowed, getComputerSessionTrust, resolveComputerTrustKey, getWsAuthState: (w: object) => authMap.get(w),
    mcpSessionByWs: new WeakMap(), computerReadConnectionFor, readonlyComputerDraft,
    contextReadParams: (_: string, p: any) => ({ ...p }), threadManager: threads, getConfig: configuration.getConfig,
    WebSocket: { OPEN: 1 }, isCompanionTool: (name: string) => name === "host_computer",
    isMcpNamespaced: () => false, logger: { warn() {}, info() {}, error() {} }, logToolFinish() {},
    hasPendingForTab: () => false, toolDisplayNameZh: (name: string) => name,
    summarizeToolParams: () => ({}), runMultiAgentToolPregate,
    runCookieTrustAdmission: () => ({ ok: true }), runBrowserDownloadAdmission: (ctx: any) => ({ ok: true, finalParams: ctx.finalParams }),
    runL2ToolAdmission, computerRateLimiter: async () => new InjectionRateLimiter(), activeTrayConfirmsByWs: new WeakMap(),
    getWsClients: () => new Set([socket]), getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", 
    runUrlNavigateAdmission: (ctx: any) => ({ ok: true, finalParams: ctx.finalParams }), runImageFetchAdmission: async () => null,
    broadcastToClients() {}, getConfigDir: () => configuration.getConfigDir(),
    executeCompanionTool: async (_: string, params: any, _id: string, options: any) => {
      const missing = rejectMissingToken(params)
      if (missing) return missing
      tokens.push(params.security_token)
      assert.equal(securityPolicy.validateTokenFor(params.security_token, "host_computer", params), true)
      options.computerRead?.assertCurrent()
      executions.push(params.actions)
      if (executeTask) return executeTask(params, options)
      return { success: !failure }
    },
  }
  const code = ts.transpileModule(factory.getText(source) + "\nreturn createToolExecutor;", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const create = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
  const execute = create(socket), normalChat = bindChatEvidenceScope(execute, thread.id)
  const body = { task: "owned readonly", app, actions: [{ action: "describe" }] }
  const pump = async (run: Promise<any>, approved = true, privileged = false, target = socket) => {
    let request = target.frames.find(f => f.type === "security.confirmation.request")
    if (!request) {
      let listener!: (frame: any) => void
      try {
        request = await Promise.race([new Promise(resolve => { listener = resolve; target.once("confirmation", listener) }),
          run.then(result => { throw Error("Execution ended before L2: " + JSON.stringify(result)) })])
      } finally { target.removeListener("confirmation", listener) }
    }
    assert.ok(request, "actual L2 request must be emitted")
    target.frames = target.frames.filter(f => f !== request)
    if (privileged) manager.respond(request.confirmation_id, approved)
    else manager.respondFrom(request.confirmation_id, approved, target as any)
    return run
  }
  return { manager, threads, thread, other, cfg, app, body, socket, auth, authMap, normalChat, execute, create, pump, executions, tokens,
    fail: () => { failure = true }, restore: () => { manager.rejectAll(); socket.emit("close"); cfg.apps = oldApps; cfg.computer = oldComputer } }
}

test("D3 actual ordinary chat binder/server/L2: first deny, then real approve/reuse fresh token, not client thread", async () => {
  const f = serverFixture()
  try {
    assert.equal((await f.pump(f.normalChat("denied", "host_computer", f.body), false)).success, false)
    assert.equal(f.executions.length, 0)
    assert.equal((await f.pump(f.normalChat("first", "host_computer", f.body))).success, true)
    // An unexpected second human prompt is answered deny deterministically;
    // the old production path fails the success assertion, without waiting45s.
    const unexpected = (frame: any) => f.manager.respondFrom(frame.confirmation_id, false, f.socket as any)
    f.socket.on("confirmation", unexpected)
    assert.equal((await f.normalChat("reuse", "host_computer", f.body)).success, true)
    f.socket.removeListener("confirmation", unexpected)
    assert.equal(f.executions.length, 2)
    assert.notEqual(f.tokens[0], f.tokens[1])
    assert.equal(f.socket.frames.filter(x => x.type === "security.confirmation.request").length, 0)
  } finally { f.restore() }
})

test("D3 actual ordinary producer: privileged lookalike does not mint, failure and thread ABA retire", async () => {
  const f = serverFixture()
  try {
    assert.equal((await f.pump(f.normalChat("privileged", "host_computer", f.body), true, true)).success, false)
    assert.equal(f.executions.length, 0)
    assert.equal((await f.pump(f.normalChat("first", "host_computer", f.body))).success, true)
    // The actual server closure observes the router's next thread, including return to A.
    assert.equal((await f.pump(bindChatEvidenceScope(f.execute, f.other.id)("other", "host_computer", f.body), false)).success, false)
    assert.equal((await f.pump(f.normalChat("back", "host_computer", f.body), false)).success, false)
    assert.equal((await f.pump(f.normalChat("again", "host_computer", f.body))).success, true)
    f.fail()
    assert.equal((await f.normalChat("failed-read", "host_computer", f.body)).success, false)
    assert.equal((await f.pump(f.normalChat("after-failure", "host_computer", f.body), false)).success, false)
  } finally { f.restore() }
})

test("D3 real data-descriptor classification refuses accessor/mixed/unknown without invoking getter", () => {
  let calls = 0
  const read = { task: "owned", app: "owned", actions: [{ action: "describe" }] }
  assert.ok(readonlyComputerDraft(read))
  assert.equal(readonlyComputerDraft({ ...read, actions: [{ get action() { calls++; return "describe" } }] }), undefined)
  assert.equal(readonlyComputerDraft({ ...read, actions: [{ action: "describe" }, { action: "click", x: 1, y: 1 }] }), undefined)
  assert.equal(readonlyComputerDraft({ ...read, read_only_observation: true }), undefined)
  assert.equal(calls, 0)
})

import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { consumeComputerReadAttempt } from "../src/computer/readonly-session"
const focusFile = path.resolve(COMPANION_ROOT, "../chrome-extension/src/background/cockpit-focus-policy.ts")
const focusExports: Record<string, any> = {}
new Function("exports", ts.transpile(fs.readFileSync(focusFile, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(focusExports)
const { cockpitFocusEventFromMessage, decideCockpitFocus, DEFAULT_ARM_STATE } = focusExports
import { RATE_LIMIT_MAX_IN_WINDOW, RATE_LIMIT_WINDOW_MS } from "../src/computer/rate-limit"

function readExecutorFixture(actions: any[], failCapture = false) {
  const events: any[] = [], frames: any[] = []
  let captures = 0, injections = 0
  const entry = { token: "mac.app.readonly723", display_name: "Owned", kind: "gui", policy: "manual", enabled: true,
    coordinateAllowed: true, bundleId: "com.example.readonly723", exe: { path: "C:\\Owned\\readonly723.exe", user_writable_dir: false }, source: "user", added_at: "2026-10-20" }
  const info = { hwnd: 723, pid: 723, title: "Owned", alive: true, exePath: process.platform === "darwin" ? entry.bundleId : entry.exe.path,
    rect: { x: 0, y: 0, width: 640, height: 480 } }
  const deps = {
    config: { apps: { enabled: true, entries: { [entry.token]: entry } }, computer: { coordinateEnabled: true } },
    windows: { enumerateByExe: async () => [info], infoForHwnd: async () => info },
    capturer: { captureWindow: async () => { captures++; if (failCapture) throw Error("CONTROLLED_CAPTURE_FAILURE"); return { hwnd: info.hwnd, rect: info.rect, dpi: 96, path: "OWNED_INERT_CAPTURE", sha256: "owned", black: false, fallbackUsed: false, osrBlackSuspected: false, client: info.rect } },
      diff: async () => ({ diffRatio: 0 }), crop: async (_p: string, _r: any, out: string) => out, diffRegion: async () => ({ diffRatio: 0 }) },
    locator: { ensureLanguage: async () => {}, ocr: async () => ({ language: "zh-Hans", words: [] }) },
    injector: { click: async () => { injections++ }, typeText: async () => { injections++ }, keyChord: async () => { injections++ },
      scroll: async () => { injections++ }, drag: async () => { injections++ }, foregroundHwnd: async () => info.hwnd, forceForeground: async () => true },
    securityEnv: { assertInjectable: async () => {} }, removeFile: async () => {},
    evidenceFactory: () => ({ dir: "OWNED_INERT_EVIDENCE", init: async () => {}, appendAction: async () => {},
      sealScreenshot: async () => ({ sha256: "owned" }), finalize: async () => {} }),
    confirm: async () => ({ confirmationId: "owned-denied", approved: false, reason: "denied" }),
    onEvent: (event: any) => { events.push(event) },
  } as unknown as ComputerExecutorDeps
  // Execute the actual unchanged production dispatch broadcast expression.
  const dispatchFile = path.join(COMPANION_ROOT, "src/tool/companion-dispatch.ts")
  const dispatchSource = ts.createSourceFile(dispatchFile, fs.readFileSync(dispatchFile, "utf8"), ts.ScriptTarget.Latest, true)
  const broadcasts: string[] = []
  const walk = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.parameters[0]?.name.getText(dispatchSource) === "ev" && node.getText(dispatchSource).includes('type: "computer.task.event"')) broadcasts.push(node.getText(dispatchSource))
    ts.forEachChild(node, walk)
  }; walk(dispatchSource)
  assert.equal(broadcasts.length, 2)
  const broadcast = new Function("execOpts", ts.transpile("return (" + broadcasts[0] + ")", { target: ts.ScriptTarget.ES2022 }))({ broadcast: (frame: any) => frames.push(JSON.parse(JSON.stringify(frame))) })
  deps.onEvent = event => { events.push(event); broadcast(event) }
  return { deps, events, frames, counts: () => ({ captures, injections }),
    run: () => runComputerTask({ task: "owned D3", app: entry.token, actions }, deps) }
}

test("D3 actual executor validated immutable read→actual dispatch broadcast→focus stays background", async () => {
  const f = readExecutorFixture([{ action: "describe" }, { action: "screenshot" }, { action: "wait", ms: 0 }])
  const account = new InjectionRateLimiter(() => 1000)
  f.deps.beforeReadCapture = () => consumeComputerReadAttempt(account)
  const result = await f.run()
  assert.equal(result.success, true)
  assert.deepEqual(f.counts(), { captures: 2, injections: 0 })
  assert.equal(account.countInWindow(), 2)
  const started = f.frames.find(x => x.event === "started")
  assert.equal(started.read_only_observation, true)
  const event = cockpitFocusEventFromMessage(started)!
  assert.equal(decideCockpitFocus(event, DEFAULT_ARM_STATE), "stay_background")
  for (const bad of [undefined, false, "true", 1, null]) {
    const ordinary = cockpitFocusEventFromMessage({ ...started, read_only_observation: bad })!
    assert.equal(decideCockpitFocus(ordinary, DEFAULT_ARM_STATE), "open_focus")
  }
  assert.equal(decideCockpitFocus(cockpitFocusEventFromMessage({ ...started, event: "paused" })!, DEFAULT_ARM_STATE), "open_focus")
  for (const shape of [{ full_preview: "complete draft" }, { nonce_challenge: "123456" }]) {
    assert.equal(decideCockpitFocus(cockpitFocusEventFromMessage({ type: "security.confirmation.request", ...shape })!, DEFAULT_ARM_STATE), "open_focus")
  }
})

test("D3 caller hint/mixed draft never causes read-only started; original injection route remains", async () => {
  const f = readExecutorFixture([{ action: "describe" }, { action: "click", x: 1, y: 1 }])
  await f.run()
  const started = f.frames.find(x => x.event === "started")
  assert.equal(Object.hasOwn(started, "read_only_observation"), false)
  assert.equal(decideCockpitFocus(cockpitFocusEventFromMessage(started)!, DEFAULT_ARM_STATE), "open_focus")
})

test("D3 actual capture attempts include failures, wait excluded, independent original rate constants", async () => {
  let now = 1000
  const account = new InjectionRateLimiter(() => now), injection = new InjectionRateLimiter(() => now)
  const f = readExecutorFixture([{ action: "screenshot" }], true)
  f.deps.beforeReadCapture = () => consumeComputerReadAttempt(account)
  assert.equal((await f.run()).success, false)
  assert.equal(account.countInWindow(), 1)
  for (let i = 1; i < RATE_LIMIT_MAX_IN_WINDOW; i++) consumeComputerReadAttempt(account)
  assert.throws(() => consumeComputerReadAttempt(account), /readonly capture attempt rate limit/)
  assert.equal(injection.countInWindow(), 0)
  now += RATE_LIMIT_WINDOW_MS
  consumeComputerReadAttempt(account)
  assert.equal(account.countInWindow(), 1)
})

test("D3 actual reconnect same thread/origin requires a new human confirmation", async () => {
  const f = serverFixture()
  try {
    assert.equal((await f.pump(f.normalChat("first", "host_computer", f.body))).success, true)
    f.socket.readyState = 3; f.authMap.delete(f.socket); f.socket.emit("close")
    const fresh = new (f.socket.constructor as any)()
    f.authMap.set(fresh, { ...f.auth })
    const next = bindChatEvidenceScope(f.create(fresh), f.thread.id)
    assert.equal((await f.pump(next("reconnect", "host_computer", f.body), false, false, fresh)).success, false)
    assert.equal(f.executions.length, 1)
    fresh.emit("close")
  } finally { f.restore() }
})

test("D3 actual cancel and thread role ABA retire previous approval before a later read", async () => {
  const f = serverFixture(), controller = new AbortController()
  try {
    assert.equal((await f.pump(f.normalChat("first", "host_computer", f.body, controller.signal))).success, true)
    controller.abort()
    assert.equal((await f.pump(f.normalChat("after-cancel", "host_computer", f.body), false)).success, false)
    assert.equal((await f.pump(f.normalChat("again", "host_computer", f.body))).success, true)
    f.threads.update(f.thread.id, { agent_role: "worker" } as any)
    f.threads.update(f.thread.id, { agent_role: "regular" } as any)
    assert.equal((await f.pump(f.normalChat("after-ABA", "host_computer", f.body), false)).success, false)
  } finally { f.restore() }
})

test("D3 actual pending human reply after auth loss cannot mint or execute", async () => {
  const f = serverFixture()
  try {
    const run = f.normalChat("pending", "host_computer", f.body)
    const lose = () => { f.auth.authenticated = false }
    f.socket.once("confirmation", lose)
    assert.equal((await f.pump(run)).success, false)
    assert.equal(f.executions.length, 0)
  } finally { f.restore() }
})

import * as l2Image from "../src/computer/l2-preview-image"
test("D3 mixed injection keeps actual original L2, wrong app and unbound client thread cannot reuse", async t => {
  t.mock.method(l2Image, "buildComputerL2PreviewImage", async () => null)
  const f = serverFixture()
  try {
    assert.equal((await f.pump(f.normalChat("first", "host_computer", f.body))).success, true)
    const mixed = f.normalChat("mixed", "host_computer", { ...f.body, actions: [{ action: "describe" }, { action: "click", x: 1, y: 1 }] })
    if (process.platform === "win32" || process.platform === "darwin") assert.equal((await f.pump(mixed, false)).success, false)
    else {
      const result = await mixed
      assert.deepEqual(result, { success: false, error: "host_computer requires L2 security_token confirmation" })
      assert.equal(f.socket.frames.some(frame => frame.type === "security.confirmation.request"), false)
    }
    assert.equal(f.executions.length, 1)
    const otherApp = "mac.app.other723"
    f.cfg.apps!.entries[otherApp] = { ...f.cfg.apps!.entries[f.app], token: otherApp }
    assert.equal((await f.pump(f.normalChat("wrong-app", "host_computer", { ...f.body, app: otherApp }), false)).success, false)
    const unbound = f.execute("unbound", "host_computer", { ...f.body, _thread_id: f.thread.id })
    if (process.platform === "win32" || process.platform === "darwin") assert.equal((await f.pump(unbound, false)).success, false)
    else {
      assert.deepEqual(await unbound, { success: false, error: "host_computer requires L2 security_token confirmation" })
      assert.equal(f.socket.frames.some(frame => frame.type === "security.confirmation.request"), false)
    }
    assert.equal(f.executions.length, 1)
  } finally { f.restore() }
})

test("D3 actual app revocation during human await prevents token/dispatch, no old approval resurrection", async () => {
  const f = serverFixture()
  try {
    const run = f.normalChat("pending", "host_computer", f.body)
    f.socket.once("confirmation", () => { f.cfg.apps!.entries[f.app].enabled = false })
    assert.equal((await f.pump(run)).success, false)
    assert.equal(f.tokens.length, 0)
    f.cfg.apps!.entries[f.app].enabled = true
    assert.equal((await f.pump(f.normalChat("restored", "host_computer", f.body), false)).success, false)
  } finally { f.restore() }
})

test("D3 actual connection singleton/busy and explicit thread stop cannot leave reusable consent", async () => {
  const f = serverFixture()
  try {
    const pending = f.normalChat("pending", "host_computer", f.body)
    // Two real executor factories on one socket share the same pending scope.
    const otherFactory = bindChatEvidenceScope(f.create(f.socket), f.thread.id)
    await assert.rejects(otherFactory("concurrent", "host_computer", f.body), /already pending/)
    assert.equal((await f.pump(pending)).success, true)
    retireComputerReadonlyThread(f.thread.id)
    assert.equal((await f.pump(f.normalChat("after-stop", "host_computer", f.body), false)).success, false)
  } finally { f.restore() }
})

test("D3 actual executor notices credential rectangles and changed subject after awaited capture", async () => {
  const f = readExecutorFixture([{ action: "describe" }]), observed: boolean[] = []
  let current = true
  f.deps.readScope = { draft: {}, reuse: false, signal: new AbortController().signal, assertCurrent: () => { if (!current) throw Error("OWNED_STALE_SUBJECT") },
    approve: () => false, credential: seen => observed.push(seen), finish: () => {} }
  f.deps.locator.ocr = async () => ({ language: "zh-Hans", words: [{ text: "password", x: 10, y: 10, w: 100, h: 20 }] })
  assert.equal((await f.run()).success, true)
  assert.deepEqual(observed, [true])
  const g = readExecutorFixture([{ action: "describe" }])
  const capture = g.deps.capturer.captureWindow.bind(g.deps.capturer)
  g.deps.readScope = f.deps.readScope
  g.deps.capturer.captureWindow = async h => { const shot = await capture(h); current = false; return shot }
  assert.equal((await g.run()).success, false)
  assert.deepEqual(g.counts(), { captures: 1, injections: 0 })
})

test("D3 actual pending subject replacement cancels old human wait and late old finally preserves successor", async () => {
  const f = serverFixture(), oldSignal = new AbortController()
  try {
    const firstRequest = new Promise<any>(resolve => f.socket.once("confirmation", resolve))
    const old = f.normalChat("old-A", "host_computer", f.body, oldSignal.signal)
    const first = await firstRequest
    f.socket.frames = f.socket.frames.filter(x => x !== first)
    const nextRequest = new Promise<any>(resolve => f.socket.once("confirmation", resolve))
    const nextChat = bindChatEvidenceScope(f.execute, f.other.id)
    const next = nextChat("current-B", "host_computer", f.body)
    await nextRequest
    assert.equal((await old).success, false)
    assert.equal(f.manager.pendingCount(), 1)
    assert.equal(f.manager.respondFrom(first.confirmation_id, true, f.socket as any).outcome, "unknown")
    assert.equal((await f.pump(next)).success, true)
    oldSignal.abort()
    assert.equal((await nextChat("reuse-B", "host_computer", f.body)).success, true)
  } finally { f.restore() }
})

test("D3 actual normal worker and plan-readonly pregates remain closed before confirmation/capture", async () => {
  const f = serverFixture()
  try {
    f.threads.update(f.thread.id, { agent_role: "worker", parent_thread_id: f.other.id } as any)
    assert.equal((await f.normalChat("worker", "host_computer", f.body)).success, false)
    assert.equal(f.socket.frames.some(x => x.type === "security.confirmation.request"), false)
    assert.equal(f.executions.length, 0)
    f.threads.update(f.thread.id, { agent_role: "regular", parent_thread_id: undefined, execution_policy: "plan_readonly" } as any)
    assert.equal((await f.normalChat("plan", "host_computer", f.body)).success, false)
    assert.equal(f.socket.frames.some(x => x.type === "security.confirmation.request"), false)
    assert.equal(f.executions.length, 0)
  } finally { f.restore() }
})


test("D3 real pack commit retires readonly consent including ABA and partial failure, precommit failures retain it", async () => {
  const facts: Array<{ kind: string; changed: boolean; prompts: number; success: boolean; executions: number }> = []
  for (const kind of ["update", "pack", "pack-ABA", "pack-same", "invalid-skills", "invalid-override", "partial-board"]) {
    const f = serverFixture()
    try {
      assert.equal((await f.pump(f.normalChat("pack-first", "host_computer", f.body))).success, true)
      const owner = f.threads.getComputerReadOwner(f.thread.id)
      const patch = { mission_pack_id: null, mission_pack_snapshot: null, tool_whitelist: null,
        active_skill_ids: [] as string[], system_prompt_append: "owned-pack-context" as string | null }
      if (kind === "update") f.threads.update(f.thread.id, { config_override: { system_prompt_append: "owned-pack-context" } })
      else if (kind === "invalid-skills") assert.throws(() => f.threads.applyPackPatch(f.thread.id, { ...patch, active_skill_ids: 1 as any }), /active_skill_ids/)
      else if (kind === "invalid-override") assert.throws(() => f.threads.applyPackPatch(f.thread.id, { ...patch, system_prompt_append: 1 as any }), /Invalid config_override/)
      else if (kind === "partial-board") {
        assert.throws(() => f.threads.applyPackPatch(f.thread.id, { ...patch, mission_pack_id: "owned-partial", board_mode: "invalid" as any }), /board_mode must be a boolean/)
        assert.equal(f.thread.mission_pack_id, "owned-partial", "original method mutates before its existing late board validation")
      } else {
        f.threads.applyPackPatch(f.thread.id, { ...patch, system_prompt_append: kind === "pack-same" ? null : patch.system_prompt_append })
        if (kind === "pack-ABA") f.threads.applyPackPatch(f.thread.id, { ...patch, system_prompt_append: null })
      }
      let prompts = 0
      const deny = (frame: any) => { prompts++; f.manager.respondFrom(frame.confirmation_id, false, f.socket as any) }
      f.socket.on("confirmation", deny)
      const next = await f.normalChat("pack-next", "host_computer", f.body)
      f.socket.removeListener("confirmation", deny)
      facts.push({ kind, changed: f.threads.getComputerReadOwner(f.thread.id) !== owner, prompts, success: next.success, executions: f.executions.length })
    } finally { f.restore() }
  }
  for (const fact of facts) {
    const retained = fact.kind === "invalid-skills" || fact.kind === "invalid-override"
    assert.deepEqual(fact, { kind: fact.kind, changed: !retained, prompts: retained ? 0 : 1, success: retained, executions: retained ? 2 : 1 }, fact.kind)
  }
})


import { writeBackUiaVerdict, uiaVerdictFromStats } from "../src/computer/uia"
test("D3 normal server→executor UIA probe retains read consent without persistent hint; mixed task still writes", async t => {
  t.mock.method(l2Image, "buildComputerL2PreviewImage", async () => null)
  for (const kind of ["fresh-read", "existing-hint", "mixed", "revoked-during-probe", "config-ABA"] as const) {
    let writes = 0
    const verdict = uiaVerdictFromStats({ nodes: 2, maxDepth: 1, edits: 0, documents: 0, interactive: 0,
      named: 0, namedOnscreen: 0, capped: false, hydrationRechecked: false, passANodes: 2, durationMs: 1 })
    let f!: ReturnType<typeof serverFixture>
    const executeTask = async (params: any, options: any) => {
      const task = readExecutorFixture(params.actions)
      const entry = configuration.getConfig().apps!.entries[f.app]
      const info = { hwnd: 723, pid: 723, title: "Owned", alive: true,
        exePath: process.platform === "darwin" ? entry.bundleId! : entry.exe!.path,
        rect: { x: 0, y: 0, width: 640, height: 480 } }
      task.deps.config = configuration.getConfig()
      task.deps.windows = { enumerateByExe: async () => [info], infoForHwnd: async () => info } as any
      task.deps.readScope = options.computerRead
      task.deps.uiaProber = { probe: async () => {
        if (kind === "revoked-during-probe" || kind === "config-ABA") {
          const entries = configuration.getConfig().apps!.entries
          configuration.replaceAppsEntries({ ...entries, [f.app]: { ...entry, enabled: false } })
          if (kind === "config-ABA") configuration.replaceAppsEntries({ ...entries, [f.app]: entry })
        }
        return verdict
      } }
      task.deps.onUiaVerdict = (token, result, at) => {
        writes++
        assert.deepEqual(writeBackUiaVerdict(token, result, at), { applied: true })
      }
      return runComputerTask(params, task.deps)
    }
    f = serverFixture(executeTask)
    try {
      if (kind === "existing-hint") f.cfg.apps!.entries[f.app].uiaCapable = false
      const body = kind === "mixed" ? { ...f.body, actions: [{ action: "describe" }, { action: "click", x: 1, y: 1 }] } : f.body
      let first
      if (kind === "mixed" && process.platform !== "darwin" && process.platform !== "win32") {
        assert.deepEqual(await f.normalChat("uia-off-platform", "host_computer", body),
          { success: false, error: "host_computer requires L2 security_token confirmation" })
        assert.equal(writes, 0, "unsupported dispatch does not reach the executor")
        // Separate lower-level DI control, not a Linux L2/native success claim.
        first = await executeTask(body, {})
      } else first = await f.pump(f.normalChat("uia-first", "host_computer", body))
      if (kind === "revoked-during-probe" || kind === "config-ABA") {
        assert.equal(first.success, false, "real setting mutations during probe cannot retain read authority")
        assert.equal(writes, 0)
        continue
      }
      assert.equal(first.success, true, kind)
      assert.equal(writes, kind === "mixed" ? 1 : 0, kind)
      if (kind !== "mixed") {
        assert.equal(configuration.getConfig(), f.cfg, "read probe does not replace the consent subject")
        const deny = (frame: any) => f.manager.respondFrom(frame.confirmation_id, false, f.socket as any)
        f.socket.on("confirmation", deny)
        assert.equal((await f.normalChat("uia-reuse", "host_computer", f.body)).success, true, "same subject retains original human consent")
        f.socket.removeListener("confirmation", deny)
        assert.equal(writes, 0)
      }
    } finally { f.restore() }
  }
})
