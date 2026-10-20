// #726: execute the complete production handler/manager with inert imports.
// No local Agent/provider, config, token, filesystem mutation or native picker.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const sourceRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../src" : "../src")
function moduleFromSource(relative: string, imports: Record<string, unknown>) {
  const filename = path.join(sourceRoot, relative)
  const source = fs.readFileSync(filename, "utf8")
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} as Record<string, any> }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `unadmitted production import: ${name}`)
      return imports[name]
    },
    process: { platform: "darwin", env: Object.freeze({}) },
    Buffer, TextEncoder, TextDecoder, AbortController,
    setTimeout: () => { throw new Error("unexpected timer") },
    clearTimeout: () => { throw new Error("unexpected timer clear") },
  }, { filename, timeout: 2000 })
  return module.exports
}

function fixture() {
  const effects = { external: 0, realFs: 0, protocolSeam: 0, confirmation: 0, cancellation: 0 }
  const forbidden = () => { effects.external++; throw new Error("unadmitted effect") }
  const forbiddenFs = new Proxy({}, { get: () => () => { effects.realFs++; throw new Error("real fs forbidden") } })
  const config = { acp: { enabled: true, servers: { inert: {
    enabled: true, display_name: "Inert", command: "not-executed", protocol: "acp",
    policy: { profile: "review_readonly" },
  } } }, coding_handoff: { open_local_terminal: false } }
  const logger = { info() {}, warn() {}, error() {} }
  const timeline = moduleFromSource("acp/timeline.ts", {})
  const progress = moduleFromSource("acp/ui-progress.ts", {})
  const protocolInputs: any[] = []
  const { AcpManager } = moduleFromSource("acp/manager.ts", {
    "./win-spawn": { spawnAcpChild: forbidden, killAcpChild: forbidden, closeAcpChild: forbidden },
    fs: forbiddenFs, os: forbiddenFs, path,
    "../config": { getConfig: () => config }, "../logger": { logger },
    "./workspace-bind": { resolveAcpWorkspaceRoot: (root: string | null) => root
      ? { ok: true, root } : { ok: false, error: "workspace required" } },
    "./handback": {}, "./taint": {}, "./discover": { discoverCodingAgents: () => [] },
    "./launch-presets": { resolveProtocolArgs: () => [] }, "./diff-apply": {}, "./handback-format": {},
    "./protocol-session": { tryStartProtocolSession: async (input: unknown) => {
      effects.protocolSeam++; protocolInputs.push(input); return null
    } },
    "./timeline": timeline, "./open-local-terminal": {},
    "./progress-caps": { PROGRESS_TAIL_CLI_CHARS: 12000, PROGRESS_TAIL_ACP_CHARS: 12000 },
    "./agent-env": { buildAcpAgentEnv: () => Object.freeze({}) },
    "../pty/session": { onPtyAgentSpawned: () => () => {} }, "../process/windows-job": {},
    "./manual-entry": {}, "./ui-progress": progress,
  })
  const manager = new AcpManager()
  const cancel = manager.cancel.bind(manager)
  manager.cancel = (id: string) => { effects.cancellation++; return cancel(id) }
  const confirmCopy = moduleFromSource("acp/confirm-copy.ts", {})
  const handler = moduleFromSource("acp/handlers.ts", {
    fs: forbiddenFs, "../config": { getConfig: () => config, saveConfig: forbidden },
    "../logger": { logger }, "./manager": { getAcpManager: () => manager },
    "./discover": { discoverCodingAgents: () => [], _resetDiscoverCache() {} },
    "./confirm-copy": confirmCopy, "./git-status": { getWorkspaceGitStatus: forbidden },
  })
  let root: string | null = "/inert/bound-project", approved = true, worker = false
  const previews: any[] = []
  let duringConfirmation = () => {}
  const context = {
    threadId: "owner", getWorkspaceRoot: () => root,
    getAgentRole: () => worker ? "worker" : "main",
    requestConfirmation: async (preview: unknown) => {
      effects.confirmation++; previews.push(preview); duringConfirmation(); return { approved }
    },
  }
  const message = { thread_id: "owner", agent_id: "inert", goal: "synthetic only", cloud_disclosure_accepted: true }
  return { manager, effects, previews, protocolInputs,
    setRoot(value: string | null) { root = value }, setApproved(value: boolean) { approved = value },
    setWorker() { worker = true }, duringConfirmation(fn: () => void) { duringConfirmation = fn },
    async start(overrides: Record<string, unknown> = {}) {
      const result = await handler.handleAcpWsMessage("acp.ui_start", { ...message, ...overrides }, context)
      await Promise.resolve(); await Promise.resolve()
      assert.equal(effects.external, 0); assert.equal(effects.realFs, 0)
      return result
    },
    control: (type: string, msg: Record<string, unknown>) => handler.handleAcpWsMessage(type, msg, context),
  }
}

async function expectWorkspace(f: ReturnType<typeof fixture>, overrides: Record<string, unknown>, expected: string) {
  const result = await f.start(overrides)
  assert.equal(result.type, "acp.ui_start.accepted")
  const session = f.manager.getSession(result.session_id)
  assert.equal(session.workspace_root, expected, "proposal snapshot must honor authoritative workspace")
  assert.ok(f.previews[0].code.includes(`仓库: ${expected}\n`), "actual confirmation uses the same workspace")
  assert.equal(f.protocolInputs.length, 1)
  assert.equal(f.protocolInputs[0].cwd, expected, "actual manager protocol-launch cwd matches confirmed snapshot")
  assert.deepEqual(Object.keys(f.protocolInputs[0].env), [], "no inherited environment in inert seam")
}

test("#726 stale explicit UI root cannot override the bound thread root", async () => {
  await expectWorkspace(fixture(), { workspace_root: "/inert/stale-client-project" }, "/inert/bound-project")
})

test("#726 empty explicit UI root uses the bound thread root", async () => {
  await expectWorkspace(fixture(), { workspace_root: "" }, "/inert/bound-project")
})

test("#726 absent explicit UI root uses the bound thread root", async () => {
  await expectWorkspace(fixture(), {}, "/inert/bound-project")
})

test("#726 unbound thread retains the existing explicit-root compatibility", async () => {
  const f = fixture(); f.setRoot(null)
  await expectWorkspace(f, { workspace_root: "/inert/explicit-unbound-project" }, "/inert/explicit-unbound-project")
})

test("#726 no bound or explicit root refuses without confirmation or launch", async () => {
  const f = fixture(); f.setRoot(null)
  const result = await f.start()
  assert.equal(result.type, "error"); assert.match(result.error, /workspace required/)
  assert.equal(f.effects.confirmation, 0); assert.equal(f.effects.protocolSeam, 0)
})

test("#726 worker hard-deny remains before proposal or confirmation", async () => {
  const f = fixture(); f.setWorker()
  const result = await f.start({ workspace_root: "/inert/client" })
  assert.equal(result.type, "error"); assert.match(result.error, /worker/)
  assert.equal(f.manager.listSessionsForThread("owner").length, 0)
  assert.equal(f.effects.confirmation, 0); assert.equal(f.effects.protocolSeam, 0)
})

test("#726 invalid explicit owner is not rescued by legacy context", async () => {
  const f = fixture(); const result = await f.start({ thread_id: "" })
  assert.equal(result.type, "error"); assert.match(result.error, /thread_id required/)
  assert.equal(f.manager.listSessionsForThread("owner").length, 0)
  assert.equal(f.effects.confirmation, 0); assert.equal(f.effects.protocolSeam, 0)
})

test("#726 denied confirmation never starts a protocol process", async () => {
  const f = fixture(); f.setApproved(false)
  const result = await f.start({ workspace_root: "/inert/stale-client-project" })
  assert.equal(result.type, "acp.ui_start.denied")
  assert.equal(f.effects.confirmation, 1); assert.equal(f.effects.protocolSeam, 0)
  assert.equal(f.manager.getSession(result.session_id).workspace_root, "/inert/bound-project")
})

test("#726 workspace changes during confirmation do not retarget the confirmed snapshot", async () => {
  const f = fixture(); f.duringConfirmation(() => f.setRoot("/inert/later-project"))
  await expectWorkspace(f, { workspace_root: "/inert/stale-client-project" }, "/inert/bound-project")
})

test("#726 foreign control still cannot cancel the fixed proposal owner", async () => {
  const f = fixture(); await expectWorkspace(f, {}, "/inert/bound-project")
  const id = f.manager.listSessionsForThread("owner")[0].session_id
  const before = f.effects.cancellation
  const reply = await f.control("acp.session.cancel", { session_id: id, thread_id: "foreign" })
  assert.equal(reply.type, "error"); assert.match(reply.error, /does not belong/)
  assert.equal(f.effects.cancellation, before)
})

test("#726 actual ACP proposal tool producer feeds the actual hint observer without binding or launch", async () => {
  const f = fixture(), source = fs.readFileSync(path.join(sourceRoot, "tool/companion-dispatch.ts"), "utf8")
  const sf = ts.createSourceFile("dispatch.ts", source, ts.ScriptTarget.Latest, true); let clause: ts.CaseClause | undefined
  function walk(n: ts.Node) { if (ts.isCaseClause(n) && n.expression.getText(sf) === '\"acp_propose_session\"') clause = n; ts.forEachChild(n, walk) }; walk(sf); assert.ok(clause)
  const thread = moduleFromSource("acp/thread-id.ts", {}), validation = moduleFromSource("acp/proposal-params.ts", {})
  const exports: any = {}; vm.runInNewContext(ts.transpileModule(`export async function invoke(params){switch('acp_propose_session'){${clause!.getText(sf)}}}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require(id: string) { if (id === "../acp/thread-id") return thread; assert.equal(id, "../acp"); return { getAcpManager: () => f.manager } },
    validateAcpProposalParams: validation.validateAcpProposalParams, threadManager: { get: () => ({ workspace_root: "/inert/bound-project", agent_role: "main" }) }, securityPolicy: { validateTokenFor: (token: string) => token === "synthetic-inert-only" }, invalidSecurityTokenResult: () => ({ success: false }) })
  const result = await exports.invoke({ __thread_id: "owner", agent_id: "inert", goal: "synthetic only", workspace_root: "/stale", security_token: "synthetic-inert-only" })
  assert.equal(result.success, true); assert.equal(result.data.state, "offered"); assert.equal(result.data.workspace_root, "/inert/bound-project")
  const observerExports: any = {}, observerPath = path.resolve(sourceRoot, "../../chrome-extension/src/sidepanel/coding-handoff/workspace-hints.ts")
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(observerPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: observerExports })
  const o = new observerExports.WorkspaceHints(); o.select("owner", 1); o.observe({ type: "connected" })
  o.observe({ type: "tool.start", thread_id: "owner", tool_call_id: "real-offer", tool_name: "acp_propose_session", params: {} })
  o.observe({ type: "tool.result", thread_id: "owner", tool_call_id: "real-offer", tool_name: "acp_propose_session", result })
  assert.equal(o.view().rows[0].path, result.data.workspace_root); assert.equal(o.view().rows[0].source, "acp-offer")
  assert.equal(f.effects.confirmation, 0); assert.equal(f.effects.protocolSeam, 0); assert.equal(f.effects.external, 0); assert.equal(f.effects.realFs, 0)
})
