// Real source methods/frames in an inert SDK/transport seam; no configured server or filesystem operations.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const repo = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../.." : "../..")
const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8")
function node(file: string, predicate: (n: ts.Node, sf: ts.SourceFile) => boolean, optional = false): string {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), nodes: ts.Node[] = []
  const visit = (n: ts.Node) => { if (predicate(n, sf)) nodes.push(n); ts.forEachChild(n, visit) }; visit(sf)
  if (optional && nodes.length === 0) return ""
  assert.equal(nodes.length, 1); return nodes[0].getText(sf)
}
function compile(code: string, globals: Record<string, any> = {}): any {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { exports, AbortController, process: { platform: "linux" }, ...globals }, { timeout: 2000 })
  return exports
}
function modules() {
  const identity = compile(read("companion/src/mcp/filesystem-identity.ts"), { require: (id: string) => { assert.equal(id, "node:path"); return path } })
  const file = path.join(repo, "companion/src/mcp/workspace-observation.ts")
  const observation = fs.existsSync(file) ? compile(fs.readFileSync(file, "utf8"), { require: (id: string) => { if (id === "node:path") return path; assert.equal(id, "./filesystem-identity"); return identity } }) : {}
  return { identity, observation }
}
const official = { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/owned/project"] }
const copy = (value: any) => JSON.parse(JSON.stringify(value))
function actualThreadManager(initial: any = { id: "A", agent_role: "normal", mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"], run_progress: null }) {
  const file = "companion/src/threads/thread-manager.ts"
  const method = (name: string, optional = false) => node(file, (n, sf) => ts.isMethodDeclaration(n) && n.name.getText(sf) === name, optional)
  const ownerField = node(file, (n, sf) => ts.isPropertyDeclaration(n) && n.name.getText(sf) === "mcpObservationOwners", true)
  const clock = node(file, n => ts.isFunctionDeclaration(n) && n.name?.text === "monotonicTimestamp")
  const readOwnerField = node(file, (n, sf) => ts.isPropertyDeclaration(n) && n.name.getText(sf) === "computerReadOwners", true)
  const members = [ownerField, readOwnerField, ...["update", "applyPackPatch", "create", "delete", "sanitizeId", "sanitizeAlias", "isSafeThreadId"].map(n => method(n)), method("getMcpObservationOwner", true)].join("\n")
  let saves = 0, saveFailure = false; const files = new Map<string, any>()
  const C = compile(`let _lastTs=0;${clock};export class ThreadManager {${members}}`, { seedRunProgress: () => ({ items: [] }), validateConfigOverride: (v: any) => ({ valid: true, sanitized: v }), atomicWriteJSON: (p: string, v: any) => files.set(p, v), fs: { unlinkSync: (p: string) => files.delete(p) }, removeAttachmentsDir() {} }).ThreadManager
  const tm = new C(); Object.assign(tm, { index: { threads: [initial] }, liveMirrors: new Map(), get(id: string) { return this.index.threads.find((t: any) => t.id === id) }, saveIndex() { saves++; if (saveFailure) throw Error("OWNED_SAVE_FAILURE") }, threadFilePath: (id: string) => "/inert/" + id })
  const selectCase = node("companion/src/message-router/handlers/mcp.ts", (n, sf) => ts.isCaseClause(n) && n.expression.getText(sf) === '"mcp.set_selection"')
  const select = compile(`export function select(rest){switch("mcp.set_selection"){${selectCase}}}`, { threadManager: tm }).select
  const pack = (patch: any) => tm.applyPackPatch("A", { mission_pack_id: null, mission_pack_snapshot: null, tool_whitelist: null, active_skill_ids: [], system_prompt_append: null, ...patch })
  return { tm, select, pack, saves: () => saves, failSave: (v: boolean) => { saveFailure = v } }
}
async function pipeline(options: any = {}) {
  const { identity, observation: m } = modules(), config = options.config ?? copy(official), effective = options.effective ?? config
  let sdkCalls = 0, creates = 0, authIdentity = "initial", currentRoute = { serverName: "filesystem", toolName: options.tool ?? "list_directory" }
  let selected = true, thread: any = options.actualThread ?? { id: "A", agent_role: options.worker ? "worker" : "normal", run_progress: null }, auth: any = { authenticated: true }
  const ownedThread = options.ownedThread ?? actualThreadManager(thread), threadManager = options.unownedManager ? { get: (id: string) => ownedThread.tm.get(id) } : ownedThread.tm
  const rt = () => ({ getThreadManager: () => threadManager })
  const gateSource = node("companion/src/mcp/dispatch.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === "createMcpServerSelectionGate")
  const selectionGate = compile("export " + gateSource, { requireRt: rt }).createMcpServerSelectionGate("filesystem", { __thread_id: "A" }, "owned-socket")
  const ownerSource = node("companion/src/mcp/dispatch.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === "captureMcpObservationSelection", true)
  const observationSelectionCurrent = ownerSource ? compile("export " + ownerSource, { requireRt: rt }).captureMcpObservationSelection({ __thread_id: "A" }, "owned-socket") : () => true
  const controller = new AbortController(), sdkResult = options.sdkResult ?? { content: [{ type: "text", text: "opaque synthetic result" }] }
  const method = (file: string, name: string) => node(file, (n, sf) => ts.isMethodDeclaration(n) && n.name.getText(sf) === name)
  const methods = ["connect", "callTool", "isCurrentClient", "updateConfig"].map(n => method("companion/src/mcp/client.ts", n)).join("\n")
  const client = new (compile(`export class ActualClient {${methods}}`, {
    ...identity, ...m, filesystemStartupConfig: () => effective, filesystemServerHome: () => "/owned/home",
    createTransport: () => { creates++; return {} }, extractPid: () => undefined,
    setTimeout: () => 1, clearTimeout() {}, resolveCallTimeout: () => 20000, resolveStartupTimeout: () => 20000, withTimeout: async (p: any) => p,
    logger: { info() {}, warn() {}, error() {} }, waitForFilesystemNormalization: async (p: any) => p,
    normalizeFilesystemRootAliases: async (_c: any, _t: string, a: any) => options.prepared ?? a,
    normalizeFilesystemToolArgs: async (_t: string, a: any) => a,
    ListRootsRequestSchema: {}, ToolListChangedNotificationSchema: {}, ResourceListChangedNotificationSchema: {}, PromptListChangedNotificationSchema: {},
    Client: class { setNotificationHandler() {} setRequestHandler() {} async connect() {} getServerCapabilities() { return { tools: {} } } getServerVersion() { return {} }
      async callTool(request: any) { sdkCalls++; options.during?.({ client, request, ownedThread, revoke: () => { authIdentity = "revoked" }, route: () => { currentRoute = { serverName: "foreign", toolName: currentRoute.toolName } }, deselect: () => { selected = false }, abort: () => controller.abort() }); return sdkResult } },
  }).ActualClient)()
  Object.assign(client, { name: "filesystem", _config: config, _connection: { status: "disconnected" }, _stderrBuffer: "", _toolsCache: [], publishedCatalogs: new Set(), emit() {}, setStatus(s: string) { this._connection.status = s }, refreshAllCaches: async () => {}, cleanupTransport: async () => {} })
  await client.connect(options.injected ? {} : undefined)
  const manager = new (compile(`export class ActualManager {${method("companion/src/mcp/manager.ts", "callTool")}}`, m).ActualManager)()
  Object.assign(manager, { requireAvailableClient: () => client, getAuthorizationIdentity: () => authIdentity, resolveToolName: () => currentRoute })
  options.beforeCall?.({ client })
  const dispatchGlobals: any = { ...m, nativeOwner: undefined, nativeMcpStale: () => false, nativeMcpStaleResult: () => ({ success: false }), signal: controller.signal,
    checkAuthorization: () => authIdentity === "initial", checkSelection: () => selected ? selectionGate() : { error: "selection changed" }, observationSelectionCurrent, gatePlannedMcpIdentity: () => null,
    manager, toolName: "mcp__filesystem__" + currentRoute.toolName, params: {}, sessionId: "owned-socket", route: { ...currentRoute },
    mcpArgs: options.args ?? { path: "/owned/project/subdir" }, dispatchedArgs: null, extractMcpError: () => "synthetic denied", enhanceMcpError: (e: string) => e }
  const runOnce = node("companion/src/mcp/dispatch.ts", n => ts.isVariableDeclaration(n) && n.name.getText() === "runOnce")
  const dispatchCall = compile(`export async function run(){const ${runOnce};return runOnce()}`, dispatchGlobals).run
  // Execute the actual final success projection inside the real server await.
  const final = node("companion/src/mcp/dispatch.ts", (n, sf) => ts.isIfStatement(n) && n.expression.getText(sf) === "outcome.success")
  const runDispatch = async () => { const output = await dispatchCall(); return output.success ? compile(`export function run(){${final}}`, { ...dispatchGlobals, outcome: output }).run() : output }
  const serverBranch = node("companion/src/server.ts", (n, sf) => ts.isIfStatement(n) && n.expression.getText(sf) === "isMcpNamespaced(toolName)")
  const serverGlobals: any = { ...m, isMcpNamespaced: () => true, evidenceScope: options.unknownScope ? undefined : { kind: "chat", threadId: "A" },
    threadManager: { get: (id: string) => thread === undefined ? undefined : threadManager.get(id) }, getWsAuthState: () => auth, enterprisePermit: undefined, invokeOpts: {}, nativeOwner: undefined,
    signal: controller.signal, ws: { readyState: 1 }, WebSocket: { OPEN: 1 }, finalParams: { __thread_id: "A" }, toolName: dispatchGlobals.toolName,
    executeMcpTool: runDispatch, sessionId: "owned-socket", toolCallId: "actual-call", startedAt: 0, nativeMcpOwner: undefined, logToolFinish() {}, logger: { error() {} } }
  const result = await compile(`export async function run(){${serverBranch}}`, serverGlobals).run()
  options.beforeFrame?.({ replaceAuth: () => { auth = { authenticated: true } }, removeThread: () => { thread = undefined }, abort: () => controller.abort(), revoke: () => { authIdentity = "revoked" } })
  const frame = node("companion/src/llm/adapter.ts", (n, sf) => ts.isObjectLiteralExpression(n) && n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === "result" && p.initializer.getText(sf) === "toolResult"))
  const wire = compile(`export function run(){return ${frame}}`, { ...m, workspaceObservation: m.readMcpWorkspaceObservation?.(result), tc: { id: "actual-call" }, threadId: "A", toolName: dispatchGlobals.toolName, toolResult: result }).run()
  const Hints = compile(read("chrome-extension/src/sidepanel/coding-handoff/workspace-hints.ts")).WorkspaceHints
  const hints = new Hints(); hints.select("A", 1); hints.observe({ type: "connected" })
  hints.observe({ type: "tool.start", tool_call_id: "actual-call", tool_name: dispatchGlobals.toolName, thread_id: "A", params: {} })
  hints.observe(copy(wire))
  return { rows: copy(hints.view().rows), wire: copy(wire), result: copy(result), sdkCalls, creates, modules: m, hints, controller }
}
test("#726 actual stdio startup→prepared directory→manager/dispatch/server/adapter→live candidate; ordinary result unchanged", async () => {
  const p = await pipeline({ prepared: { path: "/owned/project/actual" } })
  assert.equal(p.sdkCalls, 1); assert.equal(p.creates, 1); assert.equal(p.rows.length, 1); assert.equal(p.rows[0].path, "/owned/project/actual"); assert.equal(p.rows[0].source, "mcp-directory")
  assert.deepEqual(p.result, { success: true, data: [{ type: "text", text: "opaque synthetic result" }] })
  assert.deepEqual(p.wire.workspace_observation, { kind: "local-mcp-directory", path: "/owned/project/actual" })
  const refreshed = await pipeline({ beforeCall: (c: any) => c.client.updateConfig({ ...official }) }); assert.equal(refreshed.rows[0].path, "/owned/project/subdir")
  const changed = await pipeline({ during: (c: any) => { c.request.arguments.path = "/foreign/after-dispatch" } }); assert.equal(changed.rows[0].path, "/owned/project/subdir")
})
test("#726 HTTP/custom/injected/unknown chat/worker/error cannot mint a trusted MCP observation", async () => {
  for (const options of [{ config: { transport: "http", url: "https://example.invalid" } }, { config: { transport: "stdio", command: "node", args: ["/owned/custom.js", "/owned/project"] } }, { injected: true }, { config: { transport: "http", url: "https://example.invalid" }, sdkResult: { content: [], workspace_observation: { kind: "local-mcp-directory", path: "/forged" }, structuredContent: { local: true, path: "/forged" } } }, { unknownScope: true }, { worker: true }, { sdkResult: { content: [], isError: true } }]) {
    const p = await pipeline(options); assert.equal(p.rows.length, 0); assert.equal(p.wire.workspace_observation, undefined); assert.equal(p.sdkCalls, options.worker ? 0 : 1)
  }
})
test("#726 file operands use effective narrow roots, never body/dirname/default home or partial multi-file APIs", async () => {
  const good = await pipeline({ tool: "read_text_file", args: { path: "/owned/project/source/a.ts" } }); assert.equal(good.rows[0].path, "/owned/project")
  const effective = await pipeline({ effective: { ...official, args: ["-y", "@modelcontextprotocol/server-filesystem", "/owned/effective"] }, args: { path: "/owned/effective/subdir" } }); assert.equal(effective.rows[0].path, "/owned/effective/subdir")
  const forged = await pipeline({ sdkResult: { content: [], workspace_observation: { kind: "local-mcp-directory", path: "/forged" }, structuredContent: { local: true, workspace_root: "/forged" } } }); assert.equal(forged.rows[0].path, "/owned/project/subdir")
  const home = { ...official, args: ["-y", "@modelcontextprotocol/server-filesystem"] }
  for (const options of [{ config: home, effective: { ...home, args: [...home.args, "/owned/home"] }, tool: "read_text_file", args: { path: "/owned/home/project/file" } },
    { tool: "read_multiple_files", args: { paths: ["/owned/project/a", "/owned/project/b"] } }, { tool: "move_file", args: { source: "/owned/project/a", destination: "/other/b" } },
    { args: { path: "/owned/project-sibling/a" } }, { args: { path: "relative" } }, { args: { path: "/owned/project/../escape" } }, { args: { path: "/owned/project/\u0000" } },
    { args: { path: "/owned/project/" + "x".repeat(4096) } }, { sdkResult: { content: [], structuredContent: { workspace_observation: { kind: "local-mcp-directory", path: "/forged" }, local: true } }, args: { path: "/not-allowed" } }]) {
    const p = await pipeline(options); assert.equal(p.rows.length, 0); assert.equal(p.wire.workspace_observation, undefined)
  }
})
test("#726 completion and adapter-send fences omit only observation after cancellation/config/client/route/auth/selection changes", async () => {
  for (const during of [(c: any) => c.abort(), (c: any) => c.revoke(), (c: any) => c.route(), (c: any) => c.deselect(), (c: any) => { c.client.client = {} }, (c: any) => { c.client.updateConfig({ ...official }) }, (c: any) => { const old = c.client._config; c.client.updateConfig({ ...official }); c.client.updateConfig(old) }]) {
    const p = await pipeline({ during }); assert.equal(p.result.success, true); assert.equal(p.rows.length, 0); assert.equal(p.wire.workspace_observation, undefined)
  }
  for (const beforeFrame of [(c: any) => c.replaceAuth(), (c: any) => c.removeThread(), (c: any) => c.abort(), (c: any) => c.revoke()]) {
    const p = await pipeline({ beforeFrame }); assert.equal(p.result.success, true); assert.equal(p.rows.length, 0)
  }
})
test("#726 root/path caps, immutable snapshot, case/segment boundaries, file home/share/volume restrictions", () => {
  const { observation: m } = modules(); assert.equal(typeof m.captureMcpWorkspaceRoots, "function")
  const capture = (args: string[], home = "/owned/home", platform = "linux") => m.captureMcpWorkspaceRoots({ ...official, args }, { ...official, args }, home, platform)
  const a = ["-y", "@modelcontextprotocol/server-filesystem", "/owned/project"], roots = capture(a); a[2] = "/foreign"
  assert.equal(m.observeMcpDirectory(roots, "list_directory", { path: "/owned/project/a" }).path, "/owned/project/a")
  assert.equal(m.observeMcpDirectory(roots, "read_text_file", { path: "/owned/project2/a" }), undefined)
  assert.equal(m.observeMcpDirectory(roots, "read_text_file", { path: "/Owned/project/a" }), undefined)
  assert.equal(capture(["-y", "@modelcontextprotocol/server-filesystem", ...Array.from({ length: 17 }, (_, i) => "/owned/" + i)]), undefined)
  for (const p of ["C:\\", "\\\\server\\share", "C:\\Users\\owned"]) {
    const w = capture(["-y", "@modelcontextprotocol/server-filesystem", p], "C:\\Users\\owned", "win32")
    assert.equal(m.observeMcpDirectory(w, "read_text_file", { path: p.replace(/\\$/, "") + "\\file" }), undefined)
  }
  const aliasHome = capture(["-y", "@modelcontextprotocol/server-filesystem", "/private/tmp/owned-home"], "/tmp/owned-home", "darwin")
  assert.equal(m.observeMcpDirectory(aliasHome, "read_text_file", { path: "/private/tmp/owned-home/file" }), undefined)
  const w = capture(["-y", "@modelcontextprotocol/server-filesystem", "C:\\Repo"], "C:\\Users\\owned", "win32")
  assert.equal(m.observeMcpDirectory(w, "read_text_file", { path: "c:\\repo\\file" }).path, "C:\\Repo")
  for (const p of ["C:relative", "\\\\?\\C:\\Repo\\file", "C:\\Repo\\file:stream"]) assert.equal(m.observeMcpDirectory(w, "read_text_file", { path: p }), undefined)
  const getter = Object.defineProperty({}, "path", { get() { throw Error("must not invoke") } }); assert.equal(m.observeMcpDirectory(roots, "list_directory", getter), undefined)
})
test("#726 forged/late/reused/folded/foreign frames cannot hydrate candidates; old shell/ACP paths and three-row cap remain", async () => {
  const p = await pipeline(), h = p.hints, frame = p.wire
  h.select("B", 2); h.observe(frame); assert.equal(h.view().rows.length, 0)
  h.select("A", 3); h.observe(frame); assert.equal(h.view().rows.length, 0)
  let revision = 4
  for (const mutate of [(s: any, r: any) => { s.thread_id = "foreign" }, (s: any, r: any) => { r.result.folded = true }, (s: any, r: any) => { r.result.success = false }, (s: any, r: any) => { r.tool_name = "mcp__other__list_directory" }]) {
    h.select("A", revision++); const s = { type: "tool.start", tool_call_id: "actual-call", tool_name: frame.tool_name, thread_id: "A", params: {} }, r = copy(frame); mutate(s, r); h.observe(s); h.observe(r); assert.equal(h.view().rows.length, 0)
  }
  h.select("A", 100); const s = { type: "tool.start", tool_call_id: "actual-call", tool_name: frame.tool_name, thread_id: "A", params: {} }; h.observe(s); h.observe(s); h.observe(frame); assert.equal(h.view().rows.length, 0)
  h.observe({ type: "connected" }); h.observe(s); h.observe({ ...frame, workspace_observation: undefined }); assert.equal(h.view().rows.length, 0)
  for (let i = 0; i < 4; i++) { const id = "shell" + i; h.observe({ ...s, tool_name: "shell_exec", tool_call_id: id }); h.observe({ type: "tool.result", thread_id: "A", tool_name: "shell_exec", tool_call_id: id, result: { success: true, data: { cwd: "/owned/" + i, exit_code: 0, timed_out: false, aborted: false } } }) }; assert.equal(h.view().rows.length, 3)
})

test("#726 actual mcp.set_selection→ThreadManager.update ids/mode ABA retires only the pending observation without a gate call during mutation", async () => {
  const rows: number[] = []
  for (const mode of ["ids", "mode"]) {
    const thread = { id: "A", agent_role: "normal", mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"], run_progress: null }, owned = actualThreadManager(thread)
    const p = await pipeline({ actualThread: thread, ownedThread: owned, during() {
      if (mode === "ids") { owned.select({ thread_id: "A", active_mcp_server_ids: ["other"] }); owned.select({ thread_id: "A", active_mcp_server_ids: ["filesystem"] }) }
      else { owned.select({ thread_id: "A", mcp_selection_mode: "all" }); owned.select({ thread_id: "A", mcp_selection_mode: "manual" }) }
    } })
    assert.equal(owned.saves(), 2); assert.equal(p.result.success, true); assert.equal(p.sdkCalls, 1); rows.push(p.rows.length)
  }
  assert.deepEqual(rows, [0, 0], "ids and mode ABA must retire old observations")
})
test("#726 actual pack selection/role/parent ABA and mutation-before-save-failure retire observation; unrelated/failed validation keep it", async () => {
  const rows: number[] = []
  for (const scenario of ["pack-ids", "pack-mode", "role", "parent", "save-failure", "metadata", "invalid-update", "invalid-pack"]) {
    const thread = { id: "A", agent_role: "normal", mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"], run_progress: null, updated_at: "2000-01-01T00:00:00.000Z" }, owned = actualThreadManager(thread)
    const p = await pipeline({ actualThread: thread, ownedThread: owned, during() {
      if (scenario === "pack-ids") { owned.pack({ active_mcp_server_ids: ["other"] }); owned.pack({ active_mcp_server_ids: ["filesystem"] }) }
      if (scenario === "pack-mode") { owned.pack({ mcp_selection_mode: "all" }); owned.pack({ mcp_selection_mode: "manual" }) }
      if (scenario === "role") { owned.tm.update("A", { agent_role: "worker" }); owned.tm.update("A", { agent_role: "normal" }) }
      if (scenario === "parent") { owned.tm.update("A", { parent_thread_id: "foreign" }); owned.tm.update("A", { parent_thread_id: undefined }) }
      if (scenario === "save-failure") { owned.failSave(true); assert.throws(() => owned.tm.update("A", { active_mcp_server_ids: ["other"] }), /OWNED_SAVE_FAILURE/); owned.failSave(false); owned.tm.update("A", { active_mcp_server_ids: ["filesystem"] }) }
      if (scenario === "metadata") { owned.tm.update("A", { latest_tool: "synthetic" }); assert.notEqual(thread.updated_at, "2000-01-01T00:00:00.000Z") }
      if (scenario === "invalid-update") assert.throws(() => owned.tm.update("A", { mcp_selection_mode: "invalid" }), /Invalid mcp_selection_mode/)
      if (scenario === "invalid-pack") assert.throws(() => owned.pack({ mcp_selection_mode: "invalid" }), /Invalid mcp_selection_mode/)
    } })
    assert.equal(p.result.success, true); assert.equal(p.sdkCalls, 1); rows.push(p.rows.length)
  }
  assert.deepEqual(rows, [0, 0, 0, 0, 0, 1, 1, 1], "pack/role/parent/persistence failures versus unrelated/invalid writes")
})
test("#726 actual delete/create same ID and unknown owner source cannot lend old observation; new valid request works", async () => {
  const thread = { id: "A", agent_role: "normal", mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"], run_progress: null }, owned = actualThreadManager(thread)
  const p = await pipeline({ actualThread: thread, ownedThread: owned, during() { owned.tm.delete("A"); const next = owned.tm.create("new", "A"); owned.tm.update("A", { mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"], run_progress: null }); assert.notEqual(next, thread) } })
  assert.equal(p.result.success, true); assert.equal(p.rows.length, 0)
  const unknown = await pipeline({ unownedManager: true }); assert.equal(unknown.result.success, true)
  const fresh = await pipeline({ actualThread: owned.tm.get("A"), ownedThread: owned })
  assert.deepEqual([p.rows.length, unknown.rows.length, fresh.rows.length], [0, 0, 1])
})
