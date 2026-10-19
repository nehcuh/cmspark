// Execute the actual propose/dispatch/classifier/adapter-stop source in a closed
// CPU VM. Constructor/config/auth are inert seams, never native or valid L2.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const sourceRoot = path.resolve(__dirname, "../../src")
function source(rel: string) {
  return ts.createSourceFile(rel, fs.readFileSync(path.join(sourceRoot, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function extract(sf: ts.SourceFile, predicate: (node: ts.Node) => boolean): string {
  let selected: ts.Node | undefined
  function visit(node: ts.Node) { if (!selected && predicate(node)) selected = node; ts.forEachChild(node, visit) }
  visit(sf)
  assert.ok(selected, `actual source node required: ${sf.fileName}`)
  return selected.getText(sf)
}
function compile(code: string, globals: Record<string, unknown> = {}): any {
  const exports = {}
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports, ...globals }, { timeout: 1000 })
  return exports
}
function fixture() {
  const effects = { external: 0, issuedToken: 0 }
  const deny = () => { effects.external++; throw Error("EXTERNAL_EFFECT_FORBIDDEN") }
  const proposal = compile(source("acp/proposal-params.ts").text)
  const thread = compile(source("acp/thread-id.ts").text)
  // Actual containment helper, synthetic FS, no HOME/USERPROFILE or runtime reads.
  const workspace = compile(source("acp/workspace-bind.ts").text, {
    process: { env: {} },
    require(name: string) {
      if (name === "path") return path.posix
      if (name === "fs") return {
        realpathSync: (value: string) => path.posix.resolve(value),
        existsSync: (value: string) => value === ".cmspark-agent",
        statSync: () => ({ isDirectory: () => true }),
      }
      return deny()
    },
  })
  let enabled = true, role = "main", serial = 0, managerCalls = 0
  const managerSource = source("acp/manager.ts")
  const propose = extract(managerSource, n => ts.isMethodDeclaration(n) && n.name.getText(managerSource) === "propose")
  const Manager = compile(`export class ActualPropose {
    sessions=new Map(); runningCount=0;
    resolveServer(){return {enabled:true,command:'INERT_NOT_EXECUTED',policy:{profile:'review_readonly'}}}
    emitProgress(){}; ${propose}
  }`, {
    getConfig: () => ({ acp: { enabled }, coding_handoff: { open_local_terminal: false } }),
    resolveAcpWorkspaceRoot: workspace.resolveAcpWorkspaceRoot,
    newSessionId: () => `owned-session-${++serial}`,
    logger: { info() {} },
  }).ActualPropose
  const manager = new Manager()
  const dispatchSource = source("tool/companion-dispatch.ts")
  const clause = extract(dispatchSource, n => ts.isCaseClause(n) && n.expression.getText(dispatchSource) === '"acp_propose_session"')
  const dispatch = compile(`export async function run(params){switch('acp_propose_session'){${clause}}}`, {
    validateAcpProposalParams: proposal.validateAcpProposalParams,
    threadManager: { get: () => ({ agent_role: role }) },
    securityPolicy: { validateTokenFor: (token: string) => token === "INERT_AUTH_SEAM_NOT_A_TOKEN" },
    invalidSecurityTokenResult: () => ({ success: false, error: "Invalid or expired security token", data: { error_code: "SECURITY_TOKEN_INVALID" } }),
    require(name: string) {
      if (name === "../acp/thread-id") return thread
      if (name === "../acp") return { getAcpManager: () => ({ propose(opts: unknown) { managerCalls++; return manager.propose(opts) } }) }
      return deny()
    },
  }).run
  const securitySource = source("security.ts")
  const declarations = ["IMAGE_FAMILY_ERROR_CODES", "DEFAULT_NON_RECOVERABLE_CODES", "ERROR_CODE_LEVELS"].map(name =>
    extract(securitySource, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(securitySource) === name)))
  declarations.push(extract(securitySource, n => ts.isFunctionDeclaration(n) && n.name?.text === "classifyError"))
  const classifier = compile(declarations.join("\n"), { isTrustedDomain: () => true }).classifyError
  const adapterSource = source("llm/adapter.ts")
  const halt = extract(adapterSource, n => ts.isIfStatement(n) && n.expression.getText(adapterSource) === 'errorLevel === "security" || errorLevel === "non_recoverable"')
  const observe = compile(`export async function observe(toolResult){
    let shouldStop=false; const runStats={}; const classCode=toolResult.error_code||toolResult.data?.error_code;
    const errorLevel=classifyError(toolResult.error||'',{toolName:'acp_propose_session',error_code:classCode});
    for(let once=0;once<1;once++){${halt}}
    return {errorLevel,shouldStop,terminal:runStats.terminal||null}
  }`, {
    classifyError: classifier, threadId: "owned-thread", sendToExtension() {}, toolChatErrorPayload: (value: unknown) => value,
    require(name: string) { if (name === "../capability/user-gate-copy") return { formatChatErrorLine: () => "inert feedback" }; return deny() },
  }).observe
  const params = { __thread_id: "owned-thread", agent_id: "inert-agent", goal: "synthetic readonly task", workspace_root: "/inert/owned-workspace", security_token: "INERT_AUTH_SEAM_NOT_A_TOKEN" }
  return { manager, dispatch, params, observe, classifier, effects, calls: () => managerCalls, disable: () => { enabled = false }, worker: () => { role = "worker" } }
}
async function busy(f: ReturnType<typeof fixture>) {
  const first = await f.dispatch(f.params)
  assert.equal(first.success, true)
  assert.equal(first.data.state, "offered")
  const before = JSON.stringify([...f.manager.sessions])
  const refusal = await f.dispatch(f.params)
  assert.equal(refusal.success, false)
  assert.equal(JSON.stringify([...f.manager.sessions]), before)
  assert.equal(f.manager.runningCount, 0)
  return { first, refusal }
}
function noEffects(f: ReturnType<typeof fixture>) { assert.deepEqual(f.effects, { external: 0, issuedToken: 0 }) }

test("#722 actual same-thread busy is typed, recoverable and does not halt the turn", async () => {
  const f = fixture(), { refusal } = await busy(f)
  assert.equal(refusal.error_code, "ACP_SESSION_BUSY")
  const flow = await f.observe(refusal)
  assert.equal(flow.errorLevel, "recoverable"); assert.equal(flow.shouldStop, false); assert.equal(flow.terminal, null)
  noEffects(f)
})
test("#722 offered holder facts are owner-scoped finite data, not execution or task text", async () => {
  const f = fixture(), { first, refusal } = await busy(f)
  assert.deepEqual(JSON.parse(JSON.stringify(refusal.data)), {
    holder_session_id: first.data.session_id, holder_agent: "inert-agent", holder_state: "offered",
    suggested_action: "start_or_cancel_current_acp_session", data_not_instruction: true,
  })
  noEffects(f)
})
test("#722 local running holder suggests wait or cancel without changing capacity", async () => {
  const f = fixture(), first = await f.dispatch(f.params)
  f.manager.sessions.get(first.data.session_id).state = "running"
  const refusal = await f.dispatch(f.params)
  assert.equal(refusal.error_code, "ACP_SESSION_BUSY")
  assert.equal(refusal.data.holder_state, "running")
  assert.equal(refusal.data.suggested_action, "wait_or_cancel_current_acp_session")
  assert.equal(f.manager.sessions.size, 1); assert.equal(f.manager.runningCount, 0)
  noEffects(f)
})
for (const own of [true, false]) test(`#722 global running gate preserves ${own ? "own" : "foreign"} holder boundary`, async () => {
  const f = fixture(), first = await f.dispatch({ ...f.params, __thread_id: own ? "owned-thread" : "foreign-thread" })
  const session = f.manager.sessions.get(first.data.session_id)
  session.state = "running"; session.goal = "SYNTHETIC_DO_NOT_DISCLOSE"; session.workspace_root = "/private-synthetic-workspace"
  f.manager.runningCount = 1
  const before = JSON.stringify([...f.manager.sessions]), refusal = await f.dispatch(f.params)
  assert.equal(refusal.success, false); assert.equal(refusal.error_code, "ACP_CONCURRENCY_LIMIT")
  assert.equal((await f.observe(refusal)).shouldStop, false)
  assert.equal(refusal.data.suggested_action, "wait_for_acp_capacity")
  assert.equal(refusal.data.data_not_instruction, true)
  assert.equal(JSON.stringify([...f.manager.sessions]), before); assert.equal(f.manager.runningCount, 1)
  const wire = JSON.stringify(refusal)
  assert.equal(wire.includes(session.goal), false); assert.equal(wire.includes(session.workspace_root), false)
  if (own) { assert.equal(refusal.data.holder_session_id, first.data.session_id); assert.equal(refusal.data.holder_state, "running") }
  else { assert.deepEqual(Object.keys(refusal.data).sort(), ["data_not_instruction", "suggested_action"]); assert.equal(wire.includes(first.data.session_id), false); assert.equal(wire.includes("foreign-thread"), false) }
  noEffects(f)
})
for (const code of ["ACP_SESSION_BUSY", "ACP_CONCURRENCY_LIMIT"]) test(`#722 registered ${code} grade cannot be changed by hostile message metadata`, () => {
  const f = fixture()
  assert.equal(f.classifier("Security Block: permission denied timeout", { error_code: code }), "recoverable")
  assert.equal(f.classifier("temporary refusal", { error_code: "ACP_OWNER_MISMATCH" }), "security")
  assert.equal(f.classifier("ordinary failure", { error_code: "UNKNOWN_BUSY_CODE" }), "non_recoverable")
  noEffects(f)
})
for (const token of [undefined, "INVALID"]) test(`#722 ${token ? "invalid" : "missing"} L2 still denies before manager`, async () => {
  const f = fixture(), refusal = await f.dispatch({ ...f.params, security_token: token })
  assert.equal(refusal.success, false); assert.equal(f.calls(), 0); assert.equal((await f.observe(refusal)).shouldStop, true)
  noEffects(f)
})
test("#722 worker remains denied before manager and feature-disabled stays a hard refusal", async () => {
  const worker = fixture(); worker.worker()
  assert.equal((await worker.dispatch(worker.params)).success, false); assert.equal(worker.calls(), 0); noEffects(worker)
  const disabled = fixture(); disabled.disable()
  const refusal = await disabled.dispatch(disabled.params)
  assert.equal(refusal.success, false); assert.equal(refusal.error_code, undefined); assert.equal((await disabled.observe(refusal)).shouldStop, true)
  assert.equal(disabled.manager.sessions.size, 0); noEffects(disabled)
})
test("#722 actual workspace containment still denies the data-root name", async () => {
  const f = fixture(), refusal = await f.dispatch({ ...f.params, workspace_root: ".cmspark-agent" })
  // No real HOME is provided. VFS realpath canonicalizes the existing
  // relative data-root and the requested workspace to the same identity.
  assert.equal(refusal.success, false); assert.equal(refusal.error_code, undefined)
  assert.equal(f.manager.sessions.size, 0); noEffects(f)
})

// Separate actual start/CLI/cancel/shutdown methods. The process boundary is an
// EventEmitter with inert streams; slot release is the unchanged real close
// callback. No real agent-env merge, child, native preparation or timer runs.
function admissionFixture(platform: "linux" | "win32", deferredPreparation = false) {
  const { EventEmitter } = require("node:events") as typeof import("node:events")
  const managerSource = source("acp/manager.ts")
  const methods = ["propose", "start", "startCliBridge", "trackChild", "noteHistory", "getSession", "cancel", "shutdown"].map(name =>
    extract(managerSource, n => ts.isMethodDeclaration(n) && n.name.getText(managerSource) === name)).join("\n")
  const children: any[] = [], preparations: Array<() => void> = [], tracked: Promise<any>[] = []
  let serial = 0, prepareCalls = 0, startCalls = 0, envCalls = 0, kills = 0, enabled = true, preparationReleased = !deferredPreparation
  let entered!: () => void
  let enteredSecond!: () => void
  const firstChild = new Promise<void>(resolve => { entered = resolve })
  const secondChild = new Promise<void>(resolve => { enteredSecond = resolve })
  const exports = compile(`export class ActualAdmission {
    sessions=new Map();runningCount=0;processes=new Map();ownedChildren=new Set();startupPreparations=new Map();
    protocolHandles=new Map();manualEntryLaunches=new Map();shuttingDown=false;unsubscribeEmbedSpawn(){};
    resolveServer(){return {enabled:true,command:'INERT_NEVER_EXECUTED',protocol:'cli',policy:{profile:'review_readonly'}}};
    emitProgress(){};emitTerminal(){};pushTimeline(){};buildUserPrompt(){return 'synthetic task'};maybeOpenLocalTerminal(){};
    finishSession(session){session.state='closed'};
    ${methods}
  }`, {
    getConfig: () => ({ acp: { enabled } }), newSessionId: () => `inert-start-${++serial}`,
    resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/inert/workspace" }),
    buildAcpAgentEnv: () => { envCalls++; return {} },
    logger: { info() {}, warn() {} }, timelineItem: () => ({ type: "status" }),
    process: { platform }, AbortController, setTimeout: () => 1, clearTimeout() {},
    prepareWindowsJob: () => { prepareCalls++; return preparationReleased ? Promise.resolve() : new Promise<void>(resolve => preparations.push(resolve)) },
    os: { tmpdir: () => "/inert" }, path: path.posix, fs: { writeFileSync() {}, unlinkSync() {} },
    resolveLaunchArgs: () => [],
    spawnAcpChild: () => {
      const child: any = new EventEmitter()
      child.pid = 1000 + children.length; child.exitCode = null; child.signalCode = null
      child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} })
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      children.push(child); entered(); if (children.length === 2) enteredSecond(); return child
    },
    killAcpChild: () => { kills++ },
    closeAcpChild: (child: any) => child.exitCode != null ? Promise.resolve() : new Promise<void>(resolve => child.once("close", resolve)),
  })
  const manager = new exports.ActualAdmission()
  const dispatchSource = source("tool/companion-dispatch.ts")
  const clause = extract(dispatchSource, n => ts.isCaseClause(n) && n.expression.getText(dispatchSource) === '"acp_start_session"')
  const dispatch = compile(`export async function run(params){switch('acp_start_session'){${clause}}}`, {
    securityPolicy: { validateTokenFor: (token: string) => token === "INERT_AUTH_SEAM_NOT_A_TOKEN" },
    invalidSecurityTokenResult: () => ({ success: false, error: "Invalid or expired security token", data: { error_code: "SECURITY_TOKEN_INVALID" } }),
    acpSessionLookupFailure: () => ({ success: false, error_code: "ACP_SESSION_NOT_FOUND", error: "synthetic lookup refusal" }),
    require(name: string) {
      assert.equal(name, "../acp")
      return { getAcpManager: () => ({ getSession: (id: string) => manager.getSession(id), start: (id: string) => { startCalls++; return manager.start(id) } }) }
    },
  }).run
  const offer = (threadId: string) => { const r = manager.propose({ threadId, agentId: "inert-agent", goal: "synthetic task", workspaceRoot: "/inert/workspace" }); assert.ok(r.ok); return r.session }
  const start = (id: string) => { const pending = manager.start(id); pending.then(() => {}, () => {}); tracked.push(pending); return pending }
  const close = (child: any) => { if (child.exitCode == null) { child.exitCode = 0; child.emit("close", 0) } }
  const releasePreparation = () => { preparationReleased = true; for (const resolve of preparations.splice(0)) resolve() }
  const cleanup = async () => {
    releasePreparation()
    // Drain only CPU promise reactions for cleanup, never an admission oracle.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    for (const child of children) close(child)
    await Promise.allSettled(tracked)
  }
  return { manager, offer, start, dispatch, children, firstChild, secondChild, close, cleanup, releasePreparation,
    prepareCalls: () => prepareCalls, startCalls: () => startCalls, envCalls: () => envCalls, kills: () => kills,
    disable: () => { enabled = false } }
}

for (const platform of ["linux", "win32"] as const) test(`#722 ${platform} start rejects another owner until actual CLI close releases the slot`, async () => {
  const f = admissionFixture(platform), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); await f.firstChild
    const pb = f.start(target.session_id)
    if (platform === "win32") assert.equal(f.prepareCalls(), 1, "second start must not enter even inert Windows preparation")
    assert.equal(f.children.length, 1, "second start must not reach even the inert spawn boundary")
    const refused = await pb
    assert.equal(refused.ok, false); assert.equal(refused.error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(target.state, "offered"); assert.equal(f.manager.runningCount, 1)
    assert.deepEqual(Object.keys(refused.data).sort(), ["data_not_instruction", "suggested_action"])
    f.close(f.children[0]); await pa
    assert.equal(f.manager.runningCount, 0)
    assert.equal(f.children.length, 1, "refused target must not auto-start after release")
    const resumed = f.start(target.session_id)
    await f.secondChild
    assert.equal(f.children.length, 2); assert.equal(target.state, "running")
    f.close(f.children[1]); await resumed
    assert.equal(f.manager.runningCount, 0)
  } finally { await f.cleanup() }
})
test("#722 win32 preparation reserves the one slot before its await", async () => {
  const f = admissionFixture("win32", true), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id), pb = f.start(target.session_id)
    assert.equal(f.prepareCalls(), 1, "busy target must not enter Windows job preparation")
    assert.equal(f.children.length, 0); assert.equal(f.manager.runningCount, 1)
    assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(target.state, "offered")
    f.releasePreparation(); await f.firstChild
    assert.equal(f.children.length, 1); f.close(f.children[0]); await pa
    assert.equal(f.manager.runningCount, 0)
  } finally { await f.cleanup() }
})
test("#722 cancel does not release a live child's admission before the real close callback", async () => {
  const f = admissionFixture("linux"), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); await f.firstChild
    assert.equal(f.manager.cancel(first.session_id).ok, true)
    assert.equal(first.state, "closed"); assert.equal(f.manager.runningCount, 1); assert.equal(f.kills(), 1)
    const pb = f.start(target.session_id)
    assert.equal(f.children.length, 1); assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(target.state, "offered")
    f.close(f.children[0]); await pa
    assert.equal(f.manager.runningCount, 0); assert.equal(f.children.length, 1)
  } finally { await f.cleanup() }
})
test("#722 shutdown keeps its original refusal and waits for the owned close", async () => {
  const f = admissionFixture("linux"), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); await f.firstChild
    const shuttingDown = f.manager.shutdown()
    const refusal = await f.start(target.session_id)
    assert.equal(refusal.ok, false); assert.equal(refusal.error, "acp: manager shutting down")
    assert.equal(refusal.error_code, undefined); assert.equal(f.manager.runningCount, 1); assert.equal(target.state, "offered")
    f.close(f.children[0]); await Promise.all([pa, shuttingDown]); assert.equal(f.manager.runningCount, 0)
  } finally { await f.cleanup() }
})
test("#722 cancelled Windows preparation stays reserved until the original preparation settles", async () => {
  const f = admissionFixture("win32", true), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); f.manager.cancel(first.session_id)
    const pb = f.start(target.session_id)
    assert.equal(f.prepareCalls(), 1); assert.equal(f.children.length, 0); assert.equal(f.manager.runningCount, 1)
    assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(target.state, "offered")
    f.releasePreparation(); assert.equal((await pa).ok, false)
    assert.equal(f.children.length, 0); assert.equal(f.manager.runningCount, 0)
  } finally { await f.cleanup() }
})
test("#722 start dispatcher preserves missing/invalid L2 and foreign-owner refusal before admission", async () => {
  const f = admissionFixture("linux"), target = f.offer("owner-A")
  try {
    for (const token of [undefined, "INVALID"]) {
      const refusal = await f.dispatch({ session_id: target.session_id, __thread_id: "owner-A", security_token: token })
      assert.equal(refusal.success, false); assert.equal(f.startCalls(), 0)
    }
    const foreign = await f.dispatch({ session_id: target.session_id, __thread_id: "owner-B", security_token: "INERT_AUTH_SEAM_NOT_A_TOKEN" })
    assert.equal(foreign.error_code, "ACP_OWNER_MISMATCH"); assert.equal(f.startCalls(), 0)
    assert.equal(target.state, "offered"); assert.equal(f.children.length, 0); assert.equal(f.envCalls(), 0)
    f.disable(); const disabled = await f.start(target.session_id)
    assert.equal(disabled.ok, false); assert.equal(disabled.error, "acp: feature disabled"); assert.equal(f.envCalls(), 0)
  } finally { await f.cleanup() }
})
test("#722 start dispatcher carries typed busy and leaves the confirmed target unchanged", async () => {
  const f = admissionFixture("linux"), first = f.offer("owner-A"), target = f.offer("owner-B")
  target.state = "confirmed"
  try {
    const pa = f.start(first.session_id); await f.firstChild
    const pending = f.dispatch({ session_id: target.session_id, __thread_id: "owner-B", security_token: "INERT_AUTH_SEAM_NOT_A_TOKEN" })
    const outcome = await Promise.race([
      pending.then((refusal: any) => ({ kind: "refusal", refusal })),
      f.secondChild.then(() => ({ kind: "unexpected_second_child" })),
    ])
    assert.equal(outcome.kind, "refusal", "a busy approved call must settle as refusal, never spawn")
    assert.equal(f.children.length, 1)
    const refusal = (outcome as { kind: "refusal"; refusal: any }).refusal
    assert.equal(refusal.success, false); assert.equal(refusal.error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(refusal.data.data_not_instruction, true); assert.equal(target.state, "confirmed")
    assert.equal(f.startCalls(), 1)
    f.close(f.children[0]); await pa
  } finally { await f.cleanup() }
})
