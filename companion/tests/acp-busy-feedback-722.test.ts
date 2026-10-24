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
  const propose = ["propose", "proposeOwned", "visibleHolder", "expireOfferedSessions"].map(name => extract(managerSource, n => ts.isMethodDeclaration(n) && n.name.getText(managerSource) === name)).join("\n")
  const Manager = compile(`export class ActualPropose {
    sessions=new Map(); nativeBindings=new WeakMap(); executionClaims=new Map();failedSpawnChildren=new WeakSet();startupPreparations=new Map();processes=new Map();protocolHandles=new Map();manualEntryLaunches=new Map();lastProgressAt=new Map();
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
  for (let i = 1; i < 4; i++) assert.equal((await f.dispatch({ ...f.params, agent_id: `inert-${i}` })).success, true)
  const before = JSON.stringify([...f.manager.sessions])
  const refusal = await f.dispatch({ ...f.params, agent_id: "fifth" })
  assert.equal(refusal.success, false)
  assert.equal(JSON.stringify([...f.manager.sessions]), before)
  assert.equal(f.manager.executionClaims.size, 0)
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
test("#722 different-agent offer preserves the existing running claim and metadata bounds", async () => {
  const f = fixture(), first = await f.dispatch(f.params)
  f.manager.sessions.get(first.data.session_id).state = "running"; f.manager.executionClaims.set(f.manager.sessions.get(first.data.session_id),{children:new Set(),ending:false})
  const offered = await f.dispatch({ ...f.params, agent_id: "other-agent" })
  assert.equal(offered.success, true); assert.equal(offered.data.state, "offered")
  assert.equal(f.manager.executionClaims.size, 1); assert.equal(f.manager.sessions.size, 2); noEffects(f)
})
for (const own of [true, false]) test(`#722 new proposal does not expose an ${own ? "own" : "foreign"} running holder`, async () => {
  const f = fixture(), first = await f.dispatch({ ...f.params, __thread_id: own ? "owned-thread" : "foreign-thread" })
  const row = f.manager.sessions.get(first.data.session_id); row.state = "running"; row.goal = "SYNTHETIC_DO_NOT_DISCLOSE"; f.manager.executionClaims.set(row,{children:new Set(),ending:false})
  const offered = await f.dispatch({ ...f.params, agent_id: "other-agent" })
  assert.equal(offered.success, true); assert.equal(offered.data.state, "offered"); assert.equal(f.manager.executionClaims.size, 1)
  assert.equal(JSON.stringify(offered).includes(row.goal), false); assert.equal(JSON.stringify(offered).includes(first.data.session_id), false); noEffects(f)
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
  const methods = ["propose", "proposeOwned", "visibleHolder", "nativeCurrent", "detachNativeAbort", "cancelOwned", "reserveExecutionClaim", "releaseExecutionClaim", "start", "startCliBridge", "trackChild", "noteHistory", "getSession", "listSessionsForThread", "cancel", "shutdown", "expireOfferedSessions", "checkStartAdmission", "promptSession", "followup"].map(name =>
    extract(managerSource, n => ts.isMethodDeclaration(n) && n.name.getText(managerSource) === name)).join("\n")
  const children: any[] = [], preparations: Array<() => void> = [], tracked: Promise<any>[] = []
  let serial = 0, prepareCalls = 0, startCalls = 0, envCalls = 0, kills = 0, enabled = true, preparationReleased = !deferredPreparation
  let entered!: () => void
  let enteredSecond!: () => void
  const firstChild = new Promise<void>(resolve => { entered = resolve })
  const secondChild = new Promise<void>(resolve => { enteredSecond = resolve })
  const exports = compile(`export class ActualAdmission {
    sessions=new Map();nativeBindings=new WeakMap();executionClaims=new Map();failedSpawnChildren=new WeakSet();processes=new Map();ownedChildren=new Set();startupPreparations=new Map();
    protocolHandles=new Map();manualEntryLaunches=new Map();lastProgressAt=new Map();shuttingDown=false;unsubscribeEmbedSpawn(){};
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
    threadManager: { get: () => ({ agent_role: "main" }) },
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
    assert.equal(target.state, "offered"); assert.equal(f.manager.executionClaims.size, 1)
    assert.deepEqual(Object.keys(refused.data).sort(), ["data_not_instruction", "suggested_action"])
    f.close(f.children[0]); await pa
    assert.equal(f.manager.executionClaims.size, 0)
    assert.equal(f.children.length, 1, "refused target must not auto-start after release")
    const resumed = f.start(target.session_id)
    await f.secondChild
    assert.equal(f.children.length, 2); assert.equal(target.state, "running")
    f.close(f.children[1]); await resumed
    assert.equal(f.manager.executionClaims.size, 0)
  } finally { await f.cleanup() }
})
test("#722 win32 preparation reserves the one slot before its await", async () => {
  const f = admissionFixture("win32", true), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id), pb = f.start(target.session_id)
    assert.equal(f.prepareCalls(), 1, "busy target must not enter Windows job preparation")
    assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 1)
    assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(target.state, "offered")
    f.releasePreparation(); await f.firstChild
    assert.equal(f.children.length, 1); f.close(f.children[0]); await pa
    assert.equal(f.manager.executionClaims.size, 0)
  } finally { await f.cleanup() }
})
test("#722 cancel does not release a live child's admission before the real close callback", async () => {
  const f = admissionFixture("linux"), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); await f.firstChild
    assert.equal(f.manager.cancel(first.session_id).ok, true)
    assert.equal(first.state, "closed"); assert.equal(f.manager.executionClaims.size, 1); assert.equal(f.kills(), 1)
    const pb = f.start(target.session_id)
    assert.equal(f.children.length, 1); assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(target.state, "offered")
    f.close(f.children[0]); await pa
    assert.equal(f.manager.executionClaims.size, 0); assert.equal(f.children.length, 1)
  } finally { await f.cleanup() }
})
test("#722 shutdown keeps its original refusal and waits for the owned close", async () => {
  const f = admissionFixture("linux"), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); await f.firstChild
    const shuttingDown = f.manager.shutdown()
    const refusal = await f.start(target.session_id)
    assert.equal(refusal.ok, false); assert.equal(refusal.error, "acp: manager shutting down")
    assert.equal(refusal.error_code, undefined); assert.equal(f.manager.executionClaims.size, 1); assert.equal(target.state, "offered")
    f.close(f.children[0]); await Promise.all([pa, shuttingDown]); assert.equal(f.manager.executionClaims.size, 0)
  } finally { await f.cleanup() }
})
test("#722 cancelled Windows preparation stays reserved until the original preparation settles", async () => {
  const f = admissionFixture("win32", true), first = f.offer("owner-A"), target = f.offer("owner-B")
  try {
    const pa = f.start(first.session_id); f.manager.cancel(first.session_id)
    const pb = f.start(target.session_id)
    assert.equal(f.prepareCalls(), 1); assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 1)
    assert.equal((await pb).error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(target.state, "offered")
    f.releasePreparation(); assert.equal((await pa).ok, false)
    assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 0)
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

// Whole real WS handler + the same actual manager methods above. Approval and
// process boundaries are controlled CPU seams, never a token or real Agent.
function uiAdmissionFixture(platform: "linux" | "win32" = "linux") {
  const requests: Promise<any>[] = []
  const f = admissionFixture(platform), starts: Array<{ id: string; pending: Promise<any>; settled: boolean }> = []
  const confirmations: Array<{ owner: string; details: any; resolve: (decision: { approved: boolean }) => void; reject: (reason: unknown) => void }> = []
  let enabled = true
  const currentRoles = new Map<string, string>()
  const manager = f.manager, originalStart = manager.start
  manager.listAgents = () => [{ id: "inert-agent", display_name: "Owned inert agent" }]
  manager.start = function (id: string, admission?: { admitted: boolean }) {
    const row = { id, pending: originalStart.call(manager, id, admission), settled: false }
    row.pending.then(() => { row.settled = true }, () => { row.settled = true })
    starts.push(row); return row.pending
  }
  const noCall = () => { throw Error("UNUSED_EXTERNAL_SEAM") }
  const handler = compile(source("acp/handlers.ts").text, { require(name: string) {
    if (name === "fs") return { realpathSync: noCall }
    if (name === "../config") return { getConfig: () => ({ acp: { enabled } }), saveConfig: noCall }
    if (name === "../logger") return { logger: { warn() {}, info: noCall } }
    if (name === "./manager") return { getAcpManager: () => manager }
    if (name === "./discover") return { discoverCodingAgents: noCall, _resetDiscoverCache: noCall }
    if (name === "./confirm-copy") return compile(source("acp/confirm-copy.ts").text)
    if (name === "./git-status") return { getWorkspaceGitStatus: noCall }
    return noCall()
  } }).handleAcpWsMessage
  const request = (owner: string, extra: Record<string, unknown> = {}, role = "main") => { const pending = handler("acp.ui_start", {
    thread_id: owner, agent_id: "inert-agent", goal: "synthetic task", workspace_root: "/inert/workspace",
    cloud_disclosure_accepted: true, ...extra,
  }, { threadId: owner, getAgentRole: (id: string) => currentRoles.get(id) || role, getWorkspaceRoot: () => "/inert/workspace",
    requestConfirmation(details: any) {
      assert.equal(details.toolName, "acp_start_session"); assert.equal(details.autoConfirmEligible, false)
      return new Promise((resolve, reject) => confirmations.push({ owner, resolve, reject, details }))
    },
  }); requests.push(pending); return pending }
  const prompt = (owner: string, sessionId: string, text = "synthetic follow-up", role = "main") => {
    const pending = handler("acp.session.prompt", { thread_id: owner, session_id: sessionId, text }, {
      threadId: owner, getAgentRole: (id: string) => currentRoles.get(id) || role,
      requestConfirmation(details: any) {
        assert.equal(details.toolName, "acp_start_session"); assert.equal(details.autoConfirmEligible, false)
        return new Promise((resolve, reject) => confirmations.push({ owner, resolve, reject, details }))
      },
    }); requests.push(pending); return pending
  }
  const cleanup = async () => {
    for (const pending of confirmations) pending.resolve({ approved: false })
    await f.cleanup(); await Promise.allSettled(starts.map(row => row.pending)); await Promise.allSettled(requests)
  }
  return { ...f, request, prompt, starts, confirmations, cleanup, setRole: (id: string, role: string) => currentRoles.set(id, role), disableUi: () => { enabled = false; f.disable() } }
}

for (const platform of ["linux", "win32"] as const) test(`#722 real ${platform} WS confirmation preserves long admitted start and returns a second owner's typed refusal`, async () => {
  const f = uiAdmissionFixture(platform)
  try {
    const a = f.request("owner-A"), b = f.request("owner-B")
    assert.equal(f.confirmations.length, 2); assert.equal(f.manager.sessions.size, 2)
    f.confirmations[0].resolve({ approved: true })
    const admitted = await a
    assert.equal(admitted.type, "acp.ui_start.accepted"); assert.equal(admitted.thread_id, "owner-A")
    assert.equal(admitted.state, f.manager.getSession(admitted.session_id).state)
    assert.equal(f.starts[0].settled, false, "reply must not await a long running session's terminal result")
    f.confirmations[1].resolve({ approved: true })
    const refused = await b
    assert.equal(refused.type, "error"); assert.equal(refused.error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(refused.family, "acp"); assert.equal(refused.request_type, "acp.ui_start")
    assert.equal(refused.thread_id, "owner-B"); assert.equal(refused.session_id, f.starts[1].id)
    assert.deepEqual(JSON.parse(JSON.stringify(refused.data)), { suggested_action: "wait_for_acp_capacity", data_not_instruction: true })
    assert.equal(f.manager.getSession(refused.session_id).state, "offered")
    assert.equal(f.children.length, 1); assert.equal(f.manager.executionClaims.size, 1)
  } finally { await f.cleanup() }
})

test("#722 real UI proposal busy returns typed facts before requesting another approval", async () => {
  const f = uiAdmissionFixture()
  try {
    const pending = f.request("owner-A"), session = [...f.manager.sessions.values()][0] as any
    const refused = await f.request("owner-A")
    assert.equal(f.confirmations.length, 1); assert.equal(f.starts.length, 0)
    assert.equal(refused.type, "error"); assert.equal(refused.error_code, "ACP_SESSION_BUSY")
    assert.equal(refused.thread_id, "owner-A"); assert.equal(refused.data.holder_session_id, session.session_id)
    assert.equal(refused.data.suggested_action, "start_or_cancel_current_acp_session")
    f.confirmations[0].resolve({ approved: false }); assert.equal((await pending).type, "acp.ui_start.denied")
  } finally { await f.cleanup() }
})

test("#722 real denied confirmation never starts the offered session", async () => {
  const f = uiAdmissionFixture()
  try {
    const pending = f.request("owner-A"); f.confirmations[0].resolve({ approved: false })
    const denied = await pending
    assert.equal(denied.type, "acp.ui_start.denied"); assert.equal(denied.thread_id, "owner-A")
    assert.equal(f.starts.length, 0); assert.equal(f.children.length, 0)
    assert.equal(f.manager.getSession(denied.session_id).state, "closed")
  } finally { await f.cleanup() }
})

test("#722 real worker and missing owner are refused before confirmation and start", async () => {
  const f = uiAdmissionFixture()
  try {
    assert.equal((await f.request("worker", {}, "worker")).type, "error")
    assert.equal((await f.request("", { thread_id: "" })).type, "error")
    assert.equal(f.confirmations.length, 0); assert.equal(f.starts.length, 0); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

test("#722 real config invalidation during confirmation returns failure instead of accepted", async () => {
  const f = uiAdmissionFixture()
  try {
    const pending = f.request("owner-A"); f.disableUi(); f.confirmations[0].resolve({ approved: true })
    const refused = await pending
    assert.equal(refused.type, "error"); assert.match(refused.error, /feature disabled/)
    assert.equal(refused.thread_id, "owner-A"); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

test("#722 real synchronous startup cancellation never becomes accepted running", async () => {
  const f = uiAdmissionFixture()
  try {
    let cancelOnce = true
    f.manager.pushTimeline = (session: any) => { if (cancelOnce) { cancelOnce = false; f.manager.cancel(session.session_id) } }
    const pending = f.request("owner-A"); f.confirmations[0].resolve({ approved: true })
    const refused = await pending
    assert.equal(refused.type, "error"); assert.match(refused.error, /cancelled during startup/)
    assert.equal(refused.thread_id, "owner-A"); assert.equal(f.manager.getSession(refused.session_id).state, "closed")
    assert.equal(f.manager.executionClaims.size, 0); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

test("#722 actual hook shows owned typed refusal, ignores foreign or ownerless feedback and does not claim an Agent started", async () => {
  const f = uiAdmissionFixture()
  try {
    const a = f.request("owner-A"), b = f.request("owner-B")
    f.confirmations[0].resolve({ approved: true }); const admitted = await a
    f.confirmations[1].resolve({ approved: true }); const refused = await b
    const file = ts.createSourceFile("hook.ts", fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/hooks/useWebSocket.ts"), "utf8"), ts.ScriptTarget.Latest, true)
    const ownerCheck = ["codingMessageTargetsThread", "codingMessageTargetsSelection"].map(name => extract(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name)).join("\n")
    const accepted = extract(file, n => ts.isCaseClause(n) && n.expression.getText(file) === '"acp.ui_start.accepted"')
    const error = extract(file, n => ts.isIfStatement(n) && n.expression.getText(file).startsWith('msg.family === "acp"'))
    const listenerText = extract(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === "messageListener")
    const projected = ts.createSourceFile("listener", `const ${listenerText}`, ts.ScriptTarget.Latest, true)
    const declaration = (projected.statements[0] as ts.VariableStatement).declarationList.declarations[0]
    const statements = ((declaration.initializer as ts.ArrowFunction).body as ts.Block).statements
    const feedback = statements.findIndex(n => ts.isIfStatement(n) && n.expression.getText(projected) === "codingFeedback")
    assert.ok(feedback >= 0)
    const prelude = statements.slice(0, feedback + 1).map(n => n.getText(projected)).join("\n")
    assert.match(prelude, /takeCodingOperationReply/)
    const actions: any[] = [], activeThreadRef = { current: "owner-B" as string | null }
    const operations = compile(fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/utils/coding-operation-send.ts"), "utf8"), {
      chrome: { runtime: { sendMessage(_msg: unknown, callback: any) { callback({ ok: true }) } } },
    })
    const route = compile(`${ownerCheck}\nexport function run(msg){${prelude};switch(msg.type){${accepted}\ncase "error":${error}}}`, {
      takeCodingOperationReply: operations.takeCodingOperationReply, clearCodingOperationFeedback: operations.clearCodingOperationFeedback,
      activeThreadRef, codingSelectionRef: { current: { "owner-A": admitted.session_id, "owner-B": refused.session_id } }, dispatch: (action: any) => actions.push(action),
      codingManualEntryAction: compile(fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/utils/coding-manual-entry-message.ts"), "utf8")).codingManualEntryAction,
      codingControlAction: compile(fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/utils/coding-control-message.ts"), "utf8")).codingControlAction,
    }).run
    const capture = { threadRevision: 2, selectionRevision: 3 }
    for (const threadId of ["owner-A", "owner-B"]) operations.sendCodingOperation({ sessionId: "", threadId }, () => {}, { type: "acp.ui_start" }, capture)
    route(refused); assert.equal(actions.length, 1); assert.equal(actions[0].type, "ACP_OPERATION_ERROR"); assert.equal(actions[0].error, refused.error)
    assert.equal(actions[0].threadId, "owner-B"); assert.equal(actions[0].selectionRevision, 3)
    actions.length = 0; route(admitted); assert.equal(actions.length, 1)
    assert.equal(actions[0].threadId, "owner-A"); assert.equal(actions[0].type, "ACP_OPERATION_SETTLED")
    assert.equal(actions[0].resultSessionId, admitted.session_id)
    actions.length = 0
    route({ ...refused, thread_id: "owner-A" }); route({ ...refused, thread_id: undefined }); assert.equal(actions.length, 0)
    activeThreadRef.current = "owner-A"; route(admitted)
    assert.equal(actions.length, 0, "duplicate/uncorrelated legacy acceptance cannot borrow current revisions or announce readiness")
  } finally { await f.cleanup() }
})

test("#722 real post-spawn timeline cancellation replies before close while preserving the occupied slot", async () => {
  const f = uiAdmissionFixture()
  let reply: any, replied = false, timelineCalls = 0, cancelled = false
  try {
    f.manager.pushTimeline = (session: any) => {
      timelineCalls++
      if (!cancelled && timelineCalls === 2) { cancelled = true; f.manager.cancel(session.session_id) }
    }
    const pending = f.request("owner-A")
    pending.then((value: any) => { replied = true; reply = value })
    f.confirmations[0].resolve({ approved: true }); await f.firstChild
    // Observe only bounded CPU promise reactions, without delivering child close.
    // This is a test seam; product admission never races microtasks or timers.
    for (let i = 0; i < 16; i++) await Promise.resolve()
    const beforeClose = { replied, reply, occupied: f.manager.executionClaims.size, exitCode: f.children[0].exitCode }
    assert.equal(cancelled, true); assert.equal(f.children.length, 1)
    assert.equal(beforeClose.occupied, 1); assert.equal(beforeClose.exitCode, null)
    const target = f.manager.propose({ threadId: "owner-B", agentId: "inert-agent", goal: "synthetic task", workspaceRoot: "/inert/workspace" })
    assert.equal(target.ok, true, "an offer is metadata, not another executing process")
    const blocked = await f.manager.start(target.session.session_id)
    assert.equal(blocked.ok, false); assert.equal(blocked.error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(target.session.state, "offered"); assert.equal(f.children.length, 1)
    f.close(f.children[0]); await pending
    assert.equal(f.manager.executionClaims.size, 0)
    assert.equal(beforeClose.replied, true, "UI cancellation must not wait for its admitted child's close")
    assert.equal(beforeClose.reply.type, "error"); assert.equal(beforeClose.reply.family, "acp")
    assert.equal(beforeClose.reply.request_type, "acp.ui_start"); assert.equal(beforeClose.reply.thread_id, "owner-A")
    assert.equal(beforeClose.reply.session_id, f.starts[0].id)
    assert.match(beforeClose.reply.error, /cancelled during startup/)
    assert.equal(beforeClose.reply.state, undefined, "cancelled response must never claim accepted closed/running")
  } finally { await f.cleanup() }
})


// #722 remaining original scope: explicit old-offer UI starts, never new capacity.
test("#722 selected-offer UI confirmation uses the stored snapshot and never client overrides", async () => {
  const f = uiAdmissionFixture()
  try {
    const row = f.offer("owner-A"); row.goal = "ORIGINAL_SYNTHETIC_GOAL"; row.workspace_root = "/original/owned"; row.mode = "review_readonly"
    const pending = f.request("owner-A", { session_id: row.session_id, agent_id: "OVERRIDE", goal: "OVERRIDE", workspace_root: "/override", mode: "propose_diff" })
    assert.equal(f.confirmations.length, 1); assert.equal(f.manager.sessions.size, 1); assert.equal(f.starts.length, 0)
    const copy = f.confirmations[0].details.code
    assert.match(copy, /ORIGINAL_SYNTHETIC_GOAL/); assert.match(copy, /original\/owned/); assert.equal(copy.includes("OVERRIDE"), false)
    f.confirmations[0].resolve({ approved: true }); const accepted = await pending
    assert.equal(accepted.type, "acp.ui_start.accepted"); assert.equal(accepted.session_id, row.session_id)
    assert.equal(row.mode, "review_readonly"); assert.equal(f.children.length, 1); assert.equal(f.manager.executionClaims.size, 1)
  } finally { await f.cleanup() }
})
test("#722 duplicate selected-offer UI confirmation refuses before a second approval", async () => {
  const f = uiAdmissionFixture()
  try {
    const row = f.offer("owner-A"), first = f.request("owner-A", { session_id: row.session_id })
    const duplicate = await f.request("owner-A", { session_id: row.session_id })
    assert.equal(duplicate.error_code, "ACP_SESSION_BUSY"); assert.equal(f.confirmations.length, 1)
    assert.equal(row.state, "offered"); assert.equal(f.starts.length, 0)
    f.confirmations[0].resolve({ approved: false }); assert.equal((await first).type, "acp.ui_start.denied")
    assert.equal(row.state, "closed"); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})
for (const invalidation of ["expired", "cancelled", "disabled"] as const) test(`#722 late selected-offer approval after ${invalidation} cannot spawn`, async () => {
  const f = uiAdmissionFixture()
  try {
    const row = f.offer("owner-A"), pending = f.request("owner-A", { session_id: row.session_id })
    assert.equal(row.state, "offered"); assert.equal(f.confirmations.length, 1)
    if (invalidation === "expired") row.created_at = "1970-01-01T00:00:00.000Z"
    if (invalidation === "cancelled") f.manager.cancel(row.session_id)
    if (invalidation === "disabled") f.disableUi()
    f.confirmations[0].resolve({ approved: true }); const reply = await pending
    assert.equal(reply.type, "error"); assert.equal(reply.session_id, row.session_id); assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 0)
    if (invalidation === "expired") assert.equal(f.manager.getSession(row.session_id), undefined)
  } finally { await f.cleanup() }
})
test("#722 foreign selected offer refuses before confirmation and keeps its immutable owner", async () => {
  const f = uiAdmissionFixture()
  try {
    const row = f.offer("owner-A"), reply = await f.request("owner-B", { session_id: row.session_id })
    assert.equal(reply.error_code, "ACP_OWNER_MISMATCH"); assert.equal(f.confirmations.length, 0)
    assert.equal(f.starts.length, 0); assert.equal(row.state, "offered"); assert.equal(row.thread_id, "owner-A")
  } finally { await f.cleanup() }
})
test("#722 selected-offer UI checks current capacity before asking approval", async () => {
  const f = uiAdmissionFixture()
  try {
    const first = f.offer("owner-A"), pending = f.start(first.session_id); await f.firstChild
    const row = f.offer("owner-B"), reply = await f.request("owner-B", { session_id: row.session_id })
    assert.equal(reply.error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(f.confirmations.length, 0)
    assert.equal(f.children.length, 1); assert.equal(row.state, "offered")
    f.close(f.children[0]); await pending
    assert.equal(f.children.length, 1, "release must not automatically start the refused offer")
  } finally { await f.cleanup() }
})

for (const change of ["owner", "agent", "goal", "workspace", "mode", "terminal", "replacement", "worker"] as const) test(`#722 selected-offer late ${change} invalidation refuses before spawn`, async () => {
  const f = uiAdmissionFixture()
  try {
    const row = f.offer("owner-A"), pending = f.request("owner-A", { session_id: row.session_id })
    if (change === "owner") row.thread_id = "foreign-owner"
    if (change === "agent") row.agent_id = "changed-agent"
    if (change === "goal") row.goal = "CHANGED_SYNTHETIC_TASK"
    if (change === "workspace") row.workspace_root = "/changed/owned"
    if (change === "mode") row.mode = "propose_diff"
    if (change === "terminal") row.open_local_terminal_snapshot = true
    if (change === "replacement") f.manager.sessions.set(row.session_id, { ...row })
    if (change === "worker") f.setRole("owner-A", "worker")
    f.confirmations[0].resolve({ approved: true }); const reply = await pending
    assert.equal(reply.type, "error"); assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 0)
  } finally { await f.cleanup() }
})

// #736: the actual CLI/closed prompt producer creates a follow-up offer. That is
// metadata only; its second L2/start continuation must obey the same admission.
async function promptReactions() { for (let i = 0; i < 16; i++) await Promise.resolve() }
function closedPromptParent(f: ReturnType<typeof uiAdmissionFixture>) {
  const row = f.offer("owner-A"); row.state = "closed"; row.transport = "cli"
  row.handback_text = "synthetic previous output"; return row
}
function followupRow(f: ReturnType<typeof uiAdmissionFixture>, parent: any) {
  const row = [...f.manager.sessions.values()].find((x: any) => x.parent_session_id === parent.session_id) as any
  assert.ok(row, "actual promptSession/followup producer must create the new offer"); return row
}

test("#736 live CLI prompt refuses busy before another confirmation and stays visible on its original owner/session", async () => {
  const f = uiAdmissionFixture(), parent = f.offer("owner-A")
  try {
    const live = f.start(parent.session_id); await f.firstChild
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions()
    const confirmationsBefore = f.confirmations.length
    for (const row of f.confirmations) row.resolve({ approved: false })
    const reply = await pending
    assert.equal(confirmationsBefore, 0, "busy must not request another L2")
    assert.equal(reply.type, "error"); assert.equal(reply.error_code, "ACP_SESSION_BUSY")
    assert.equal(reply.thread_id, "owner-A"); assert.equal(reply.session_id, parent.session_id)
    assert.equal(reply.family, "acp"); assert.equal(reply.request_type, "acp.session.prompt")
    assert.equal(f.starts.length, 1); assert.equal(f.children.length, 1); assert.equal(f.manager.executionClaims.size, 1)
    assert.equal([...f.manager.sessions.values()].some((row: any) => row.parent_session_id === parent.session_id), false, "nonterminal pair cannot create a duplicate offer")
    const ops = compile(fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/utils/coding-operation-send.ts"), "utf8"), { chrome: { runtime: { sendMessage(_m: unknown, done: any) { done({ ok: true }) } } } })
    ops.sendCodingOperation({ sessionId: parent.session_id, threadId: "owner-A" }, () => {}, { type: "acp.session.prompt", text: "inert" }, { threadRevision: 1, selectionRevision: 1 })
    const action = ops.takeCodingOperationReply(reply)
    const store = ts.createSourceFile("agentStore.tsx", fs.readFileSync(path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/store/agentStore.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const clause = extract(store, n => ts.isCaseClause(n) && n.expression.getText(store) === '"ACP_OPERATION_ERROR"')
    const reduce = compile(`export function run(state, action){switch(action.type){${clause}}return state}`).run
    const state = { activeThreadSelectionRevision: 1, activeCodingSelectionRevision: 1, activeThreadId: "owner-A", codingSessionIdByThread: { "owner-A": parent.session_id }, codingSessionsById: { [parent.session_id]: { sessionId: parent.session_id, threadId: "owner-A", state: "running" } }, codingOperationError: null }
    assert.equal(reduce(state, action).codingOperationError.error, reply.error)
    assert.equal(reduce(state, { ...action, threadId: "foreign" }), state)
    f.close(f.children[0]); await live
  } finally { await f.cleanup() }
})

test("#736 actual prompt followup accepted receipt does not await its long running result", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent)
    assert.equal(f.confirmations.length, 1); assert.equal(row.state, "offered")
    const details = f.confirmations[0].details
    assert.equal(details.autoConfirmEligible, false); assert.match(details.code, /synthetic follow-up/)
    f.confirmations[0].resolve({ approved: true }); const reply = await pending
    assert.equal(reply.type, "acp.session.prompt.accepted"); assert.equal(reply.parent_session_id, parent.session_id)
    assert.equal(reply.session_id, row.session_id); assert.equal(reply.thread_id, "owner-A")
    assert.equal(f.children.length, 1); assert.equal(f.starts[0].settled, false); assert.equal(f.manager.executionClaims.size, 1)
  } finally { await f.cleanup() }
})

test("#736 actual followup late capacity refusal is returned instead of accepted", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent)
    const holder = f.offer("owner-B"), occupied = f.start(holder.session_id); await f.firstChild
    f.confirmations[0].resolve({ approved: true }); const reply = await pending
    assert.equal(reply.type, "error"); assert.equal(reply.error_code, "ACP_CONCURRENCY_LIMIT")
    assert.equal(reply.thread_id, "owner-A"); assert.equal(reply.session_id, parent.session_id)
    assert.deepEqual(JSON.parse(JSON.stringify(reply.data)), { suggested_action: "wait_for_acp_capacity", data_not_instruction: true })
    assert.equal(row.state, "offered"); assert.equal(f.children.length, 1); assert.equal(f.manager.executionClaims.size, 1)
    f.close(f.children[0]); await occupied
  } finally { await f.cleanup() }
})

test("#736 pending prompt followup cannot open a duplicate UI confirmation on the same object", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent)
    const duplicate = f.request("owner-A", { session_id: row.session_id }); await promptReactions()
    const count = f.confirmations.length
    for (const item of f.confirmations) item.resolve({ approved: false })
    const refused = await duplicate; await pending
    assert.equal(count, 1); assert.equal(refused.type, "error"); assert.equal(refused.error_code, "ACP_SESSION_BUSY")
    assert.equal(f.starts.length, 0); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

for (const change of ["owner", "agent", "goal", "workspace", "mode", "terminal", "replacement", "worker", "expired", "cancelled", "disabled"] as const) test(`#736 actual prompt late ${change} invalidation cannot start`, async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent)
    if (change === "owner") row.thread_id = "foreign"
    if (change === "agent") row.agent_id = "changed"
    if (change === "goal") row.goal = "CHANGED_SYNTHETIC_GOAL"
    if (change === "workspace") row.workspace_root = "/changed/inert"
    if (change === "mode") row.mode = "propose_diff"
    if (change === "terminal") row.open_local_terminal_snapshot = true
    if (change === "replacement") f.manager.sessions.set(row.session_id, { ...row })
    if (change === "worker") f.setRole("owner-A", "worker")
    if (change === "expired") row.created_at = "1970-01-01T00:00:00.000Z"
    if (change === "cancelled") f.manager.cancel(row.session_id)
    if (change === "disabled") f.disableUi()
    f.confirmations[0].resolve({ approved: true }); const reply = await pending
    assert.equal(reply.type, "error"); assert.equal(reply.session_id, parent.session_id); assert.equal(reply.thread_id, "owner-A")
    assert.equal(f.children.length, 0); assert.equal(f.manager.executionClaims.size, 0)
    if (change === "replacement") assert.equal(f.manager.getSession(row.session_id).state, "offered")
    if (change === "expired") assert.equal(f.manager.getSession(row.session_id), undefined)
  } finally { await f.cleanup() }
})

test("#736 denied prompt confirmation cancels only its original still-offered object", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent), replacement = { ...row }
    f.manager.sessions.set(row.session_id, replacement); f.confirmations[0].resolve({ approved: false }); const reply = await pending
    assert.equal(reply.type, "acp.session.prompt.denied"); assert.equal(reply.session_id, parent.session_id)
    assert.equal(f.manager.getSession(row.session_id), replacement); assert.equal(replacement.state, "offered")
    assert.equal(f.starts.length, 0); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

test("#736 rejected prompt confirmation cleans the original offer and never leaks its error body", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  try {
    const pending = f.prompt("owner-A", parent.session_id); await promptReactions(); const row = followupRow(f, parent)
    // Attach observation before deliberately rejecting the controlled decision.
    const observed = pending.then((value: any) => value, (error: unknown) => ({ unhandled: error }))
    f.confirmations[0].reject(Error("SYNTHETIC_PRIVATE_CONFIRMATION_BODY")); const reply = await observed
    assert.equal(reply.type, "error"); assert.equal(reply.session_id, parent.session_id)
    assert.equal(JSON.stringify(reply).includes("SYNTHETIC_PRIVATE_CONFIRMATION_BODY"), false)
    assert.equal(row.state, "closed"); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})

test("#736 post-spawn prompt cancellation replies before close and does not release the occupied slot", async () => {
  const f = uiAdmissionFixture(), parent = closedPromptParent(f)
  let timelineCalls = 0, replied = false, reply: any
  try {
    f.manager.pushTimeline = (session: any) => { if (++timelineCalls === 2) f.manager.cancel(session.session_id) }
    const pending = f.prompt("owner-A", parent.session_id); pending.then((value: any) => { replied = true; reply = value })
    await promptReactions(); f.confirmations[0].resolve({ approved: true }); await f.firstChild; await promptReactions()
    const beforeClose = { replied, reply, occupied: f.manager.executionClaims.size, exitCode: f.children[0].exitCode }
    assert.equal(beforeClose.replied, true); assert.equal(beforeClose.reply.type, "error")
    assert.equal(beforeClose.reply.session_id, parent.session_id); assert.match(beforeClose.reply.error, /cancelled during startup/)
    assert.equal(beforeClose.occupied, 1); assert.equal(beforeClose.exitCode, null)
    f.close(f.children[0]); await pending; assert.equal(f.manager.executionClaims.size, 0)
  } finally { await f.cleanup() }
})

test("#736 explicit UI requested-owner mismatch remains rejected and stamps that valid request owner", async () => {
  const f = uiAdmissionFixture()
  try {
    const reply = await f.request("context-owner", { thread_id: "explicit-owner-b" })
    assert.equal(reply.type, "error"); assert.equal(reply.thread_id, "explicit-owner-b")
    assert.equal(reply.family, "acp"); assert.equal(reply.request_type, "acp.ui_start")
    assert.equal(f.confirmations.length, 0); assert.equal(f.starts.length, 0); assert.equal(f.children.length, 0)
  } finally { await f.cleanup() }
})
