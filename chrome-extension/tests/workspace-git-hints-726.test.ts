// Actual Git producer + WS envelope + observer + Panel callbacks; inert CPU only.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import { WorkspaceHints } from "../src/sidepanel/coding-handoff/workspace-hints"
const repo = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../.." : "../..")
function read(name: string) { return fs.readFileSync(path.join(repo, name), "utf8") }
function node(name: string, predicate: (n: ts.Node, sf: ts.SourceFile) => boolean) {
  const sf = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), rows: ts.Node[] = []
  function visit(n: ts.Node) { if (predicate(n, sf)) rows.push(n); ts.forEachChild(n, visit) }; visit(sf)
  assert.equal(rows.length, 1, "one actual production source node"); return rows[0].getText(sf)
}
function compile(code: string, globals: Record<string, unknown> = {}): any {
  const exports = {}; vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...globals }, { timeout: 2000 }); return exports
}
function connected() { const o = new WorkspaceHints(); o.select("A", 1); o.observe({ type: "connected" }); return o }
function panelRequest(o: Pick<WorkspaceHints, "view">, suffix = "1", throwSend = false, publish?: (view: any) => void) {
  const state: any = { connectionState: "connected", activeThreadSelectionRevision: 1 }, sent: any[] = [], views: any[] = []
  let callback: ((value?: any) => void) | undefined, cleanup: (() => void) | undefined
  const runtime: any = { lastError: undefined, sendMessage(message: unknown, cb: (value?: any) => void) { sent.push(message); callback = cb; if (throwSend) throw Error("SYNCHRONOUS_SEND_REFUSED") } }
  const effect = node("chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx", (n, sf) => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(sf) === "useEffect" && n.getText(sf).includes('type: "coding.git_status"'))
  compile(`export function run(){${effect}}`, { open: true, effectiveWorkspace: "C:\\项目\\repo", threadId: "A", state, hintViewRef: { current: o.view() }, currentSelectionRef: { current: { threadId: "A", revision: 1 } }, crypto: { randomUUID: () => "owned-" + suffix }, setGitStatusLine() {}, chrome: { runtime }, dispatch(action: any) { views.push(action.view); publish?.(action.view) }, useEffect(fn: () => (() => void) | undefined) { cleanup = fn() } }).run()
  assert.equal(sent.length, 1, "exactly the original Git request, no extra probe")
  return { request: sent[0], ack(...args: any[]) { callback?.(args.length ? args[0] : { ok: true }) }, fail() { runtime.lastError = { message: "synthetic send failure" }; callback?.() }, close() { cleanup?.() }, views }
}
function forward(request: any, mode: "connected" | "unpaired" | "disconnected" = "connected") {
  const send = node("chrome-extension/src/background/ws-client.ts", (n, sf) => ts.isMethodDeclaration(n) && n.name.getText(sf) === "send")
  const sender = new (compile(`export class Sender {${send}}`, { WebSocket: { OPEN: 1, CONNECTING: 0 } }).Sender)()
  const wires: any[] = []; let ack: any
  Object.assign(sender, { unpaired: mode === "unpaired", authenticated: mode === "connected", pending: [], ws: { readyState: mode === "disconnected" ? 3 : 1, send(value: string) { wires.push(JSON.parse(value)) } }, discardSocket() {}, setState() {}, connect() {} })
  const block = node("chrome-extension/src/background/index.ts", (n, sf) => ts.isTryStatement(n) && n.getText(sf).includes('const sent = message.type === "system.ping" ? wsClient.observeMeetingPcm(message.id) : wsClient.send(frame)'))
  compile(`export function run(message,wsClient,sendResponse){${block}}`).run(request, sender, (value: any) => { ack = value })
  return { wires, ack }
}
async function producer(request: any, type = "coding.git_status") {
  const sent = forward(request); assert.equal(sent.ack.ok, true); assert.equal(sent.wires.length, 1); request = sent.wires[0]
  const name = "companion/src/acp/handlers.ts"
  const branch = node(name, (n, sf) => ts.isIfStatement(n) && n.expression.getText(sf) === 'type === "coding.git_status" || type === "acp.workspace_status"')
  const fn = (label: string) => node("companion/src/acp/git-status.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === label)
  const git = compile(fn("notARepo") + "\n" + fn("getWorkspaceGitStatus"), { resolveAcpWorkspaceRoot: (root: string) => ({ ok: true, root }), runGit: async (_root: string, args: string[]) => ({ code: 0, stdout: args[0] === "rev-parse" ? "main\n" : "## main\n", stderr: "", timedOut: false }) })
  const response = await compile(`export async function run(type,msg,ctx){${branch}}`, { getWorkspaceGitStatus: git.getWorkspaceGitStatus, fs: { realpathSync: (p: string) => p } }).run(type, request, { getWorkspaceRoot: () => null })
  const send = node("companion/src/ws/lifecycle.ts", (n, sf) => ts.isExpressionStatement(n) && n.getText(sf) === "ws.send(JSON.stringify({ ...response, id: msg?.id }))")
  let wire: any; compile(`export function run(response,msg,ws){${send}}`).run(response, request, { send(value: string) { wire = JSON.parse(value) } }); return wire
}
test("#726 actual Panel request→Git producer→WS id→observer→candidate click retains native-only binding", async () => {
  const o = connected(), p = panelRequest(o); assert.equal(typeof p.request.id, "string")
  p.ack(); const wire = await producer(p.request); assert.equal(wire.id, p.request.id); assert.equal(o.observe(wire), true)
  const row = o.view()!.rows[0]; assert.equal(row.path, "C:\\项目\\repo"); assert.equal(row.source, "git-cwd")
  const sent: any[] = []
  const pick = node("chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx", (n, sf) => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(sf) === "pickWorkspace"))
  const actual = compile(`export function run(){${pick};return pickWorkspace}`, { useCallback: (fn: unknown) => fn, threadId: "A", effectiveWorkspace: null, hintViewRef: { current: o.view() }, currentSelectionRef: { current: { threadId: "A", revision: 1 } }, state: { connectionState: "connected" }, hintPickRef: { current: null }, pendingStartAfterPickRef: { current: true }, crypto: { randomUUID: () => "owned-pick" }, flash() {}, chrome: { runtime: { lastError: undefined, sendMessage(msg: unknown) { sent.push(msg) } } } }).run()
  assert.equal(sent.length, 0); actual(row); assert.equal(sent.length, 1); assert.equal(sent[0].type, "workspace.pick"); assert.equal(sent[0].initial_path, row.path); assert.equal(sent[0].thread_id, "A"); assert.equal(sent.some(m => m.type === "workspace.set" || m.type === "acp.ui_start"), false)
})
test("#726 reply before send acknowledgement stays pending; false or unknown send never creates hint", async () => {
  for (const ack of [{ ok: true }, { ok: false }, undefined]) {
    const o = connected(), p = panelRequest(o); const wire = await producer(p.request)
    assert.equal(o.observe(wire), false); assert.equal(o.view()!.rows.length, 0)
    p.ack(ack); assert.equal(o.view()!.rows.length, ack?.ok === true ? 1 : 0)
  }
})
test("#726 sender failure and effect cleanup retire only their own request", async () => {
  for (const retire of [(p: ReturnType<typeof panelRequest>) => p.fail(), (p: ReturnType<typeof panelRequest>) => p.close()]) {
    const o = connected(), p = panelRequest(o); retire(p); p.ack(); o.observe(await producer(p.request)); assert.equal(o.view()!.rows.length, 0)
  }
  const o = connected(), a = panelRequest(o, "A"), b = panelRequest(o, "B"); a.close(); a.fail(); b.ack(); o.observe(await producer(b.request)); assert.equal(o.view()!.rows.length, 1)
  const sync = connected(), refused = panelRequest(sync, "throw", true); refused.ack(); sync.observe(await producer(refused.request)); assert.equal(sync.view()!.rows.length, 0)
})
test("#726 next registered request retires prior response; duplicate/replayed replies never increment count", async () => {
  const o = connected(), a = panelRequest(o, "A"), b = panelRequest(o, "B"); a.ack(); b.ack()
  assert.equal(o.observe(await producer(a.request)), false); assert.equal(o.view()!.rows.length, 0)
  const wire = await producer(b.request); assert.equal(o.observe(wire), true); assert.equal(o.observe(wire), false); assert.equal(o.view()!.rows[0].count, 1)
})
test("#726 thread ABA/selection change/disconnect/reconnect reject late matching old replies", async () => {
  for (const retire of [(o: WorkspaceHints) => { o.select("B", 2); o.select("A", 3) }, (o: WorkspaceHints) => o.select("A", 2), (o: WorkspaceHints) => { o.observe({ type: "thread.mutation.connection", state: "disconnected" }); o.observe({ type: "connected" }) }]) {
    const o = connected(), p = panelRequest(o); p.ack(); const wire = await producer(p.request); retire(o); assert.equal(o.observe(wire), false); assert.equal(o.view()!.rows.length, 0)
  }
})
test("#726 errors, missing/nonrepo/different path, wrong owner and folded scalar records refuse", async () => {
  const mutations = [(x: any) => { x.type = "error" }, (x: any) => { x.error = "synthetic failure" }, (x: any) => { delete x.is_repo }, (x: any) => { x.is_repo = false }, (x: any) => { delete x.workspace_root }, (x: any) => { x.workspace_root = "C:\\other" }, (x: any) => { x.thread_id = "B" }, (x: any) => { x.folded = true }, (x: any) => { x.workspace_root = "C:\\Repo\u061c" }, (x: any) => { Object.defineProperty(x, "workspace_root", { get() { throw Error("GETTER_FORBIDDEN") } }) }]
  for (const mutate of mutations) { const o = connected(), p = panelRequest(o); p.ack(); const wire = await producer(p.request); mutate(wire); assert.equal(o.observe(wire), false); assert.equal(o.view()!.rows.length, 0) }
})
test("#726 unregistered replies and unknown IDs are not evidence; legacy alias producer has no implicit registration", async () => {
  const o = connected(), raw = { thread_id: "A", workspace_root: "C:\\项目\\repo", id: "unregistered" }; assert.equal(o.observe(await producer(raw)), false)
  const p = panelRequest(o); p.ack(); const wire = await producer(p.request); assert.equal(o.observe({ ...wire, id: "foreign" }), false); assert.equal(o.observe(wire), true)
  const alias = connected(); assert.equal(alias.observe(await producer(raw, "acp.workspace_status")), false); assert.equal(alias.view()!.rows.length, 0)
})
test("#726 binding clear retains an already observed live Git cwd; reload does not reconstruct hints", async () => {
  const o = connected(), p = panelRequest(o); p.ack(); o.observe(await producer(p.request)); p.close()
  let state = { ...initialState, activeThreadId: "A", activeThreadSelectionRevision: 1, connectionState: "connected", threads: [{ id: "A", workspace_root: "C:\\项目\\repo" }] } as any
  state = agentReducer(state, { type: "SET_WORKSPACE_HINTS", view: o.view() })
  state = agentReducer(state, { type: "UPSERT_THREAD", thread: { id: "A", workspace_root: null } as any })
  assert.equal(state.threads[0].workspace_root, null); assert.equal(state.workspaceHints.rows[0].path, "C:\\项目\\repo")
  assert.equal(connected().view()!.rows.length, 0)
})
test("#726 Git hints share the original3-row budget, recency and count with other completed sources", async () => {
  const o = connected()
  for (let i = 0; i < 4; i++) { const finish = o.view()!.registerGitRequest!("owned-" + i, "C:\\repo" + i)!; finish(true); const wire = await producer({ id: "owned-" + i, thread_id: "A", workspace_root: "C:\\repo" + i }); assert.equal(o.observe(wire), true) }
  assert.equal(o.view()!.rows.length, 3); assert.equal(o.view()!.rows[0].path, "C:\\repo3")
  const finish = o.view()!.registerGitRequest!("owned-repeat", "C:\\repo2")!; finish(true); o.observe(await producer({ id: "owned-repeat", thread_id: "A", workspace_root: "C:\\repo2" })); assert.equal(o.view()!.rows[0].count, 2)
})

test("#726 whole actual live hook publishes Git id only after registered send and retires selection ABA", async () => {
  const actualHook = node("chrome-extension/tests/workspace-hints-726.test.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === "hook")
  for (const earlyReply of [false, true]) {
    const f = compile(actualHook + "\nexport { hook }", { compile, agentReducer, initialState, WorkspaceHints, fs, path, ts, root: path.join(repo, "chrome-extension/src/sidepanel") }).hook()
    f.send({ type: "connected" }); f.render()
    const p = panelRequest({ view: () => f.state().workspaceHints }, earlyReply ? "early" : "normal", false, view => f.action({ type: "SET_WORKSPACE_HINTS", view }))
    const wire = await producer(p.request)
    if (earlyReply) { f.send(wire); assert.equal(f.state().workspaceHints.rows.length, 0); p.ack() }
    else { p.ack(); f.send(wire) }
    assert.equal(f.state().workspaceHints.rows[0].source, "git-cwd")
    f.action({ type: "SET_ACTIVE_THREAD", threadId: "B" }); f.action({ type: "SET_ACTIVE_THREAD", threadId: "A" }); f.render(); f.send(wire)
    assert.equal(f.state().workspaceHints, null)
  }
})

test("#726 original tool-ID ambiguity also retires Git collection without clearing verified hints", async () => {
  const o = connected(), p = panelRequest(o); p.ack(); const wire = await producer(p.request)
  o.observe({ type: "tool.start", thread_id: "A", tool_call_id: "duplicate", tool_name: "shell_exec", params: {} })
  o.observe({ type: "tool.start", thread_id: "A", tool_call_id: "duplicate", tool_name: "shell_exec", params: {} })
  assert.equal(o.observe(wire), false); assert.equal(o.view()!.registerGitRequest!("later", "C:\\repo"), null)
  assert.equal(o.view()!.rows.length, 0)
})

test("#726 actual background/WS sender preserves id and refuses unpaired or disconnected requests", async () => {
  for (const mode of ["unpaired", "disconnected"] as const) {
    const o = connected(), p = panelRequest(o), sent = forward(p.request, mode)
    assert.equal(sent.ack.ok, false); assert.equal(sent.wires.length, 0); p.ack(sent.ack)
    o.observe(await producer(p.request)); assert.equal(o.view()!.rows.length, 0)
  }
})

test("#726 whole live connection broadcasts retire completed hints and either pending Git half before reconnect", async () => {
  const actualHook = node("chrome-extension/tests/workspace-hints-726.test.ts", n => ts.isFunctionDeclaration(n) && n.name?.text === "hook")
  for (const state of ["connecting", "disconnected"]) for (const order of ["pending", "reply", "ack", "complete"]) {
    const f = compile(actualHook + "\nexport { hook }", { compile, agentReducer, initialState, WorkspaceHints, fs, path, ts, root: path.join(repo, "chrome-extension/src/sidepanel") }).hook()
    f.send({ type: "connected" }); f.render()
    const before = f.state().workspaceHints
    const publish = (view: any) => f.action({ type: "SET_WORKSPACE_HINTS", view })
    const p = panelRequest({ view: () => f.state().workspaceHints }, state + order, false, publish)
    const wire = await producer(p.request)
    if (order === "reply" || order === "complete") f.send(wire)
    if (order === "ack" || order === "complete") p.ack()
    if (order === "complete") assert.equal(f.state().workspaceHints.rows.length, 1)
    f.send({ type: "thread.mutation.connection", state })
    assert.equal(f.state().workspaceHints, null, "actual broadcast clears the old view without relying on polling")
    f.send({ type: "thread.mutation.connection", state: "connected" }); f.render()
    assert.notStrictEqual(f.state().workspaceHints.connection, before.connection)
    f.send(wire); p.ack(); assert.equal(f.state().workspaceHints.rows.length, 0, "old reply or send ACK cannot revive retired evidence")
    const fresh = panelRequest({ view: () => f.state().workspaceHints }, "fresh-" + state + order, false, publish)
    fresh.ack(); f.send(await producer(fresh.request))
    assert.equal(f.state().workspaceHints.rows.length, 1, "the current connection still accepts its own correlated completed query")
    assert.equal(f.state().workspaceHints.rows[0].source, "git-cwd")
  }
})
