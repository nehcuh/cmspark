/** Actual connection producer → hook → reducer → effect dependency controls; no browser. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { agentReducer, initialState, selectCodingSession, type AgentState } from "../src/sidepanel/store/agentStore"

const repo = path.resolve(__dirname, "../../..")
const files = { hook: "chrome-extension/src/sidepanel/hooks/useWebSocket.ts", panel: "chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx", background: "chrome-extension/src/background/index.ts" }
function syntax(file: string, ending = "\n") {
  const text = fs.readFileSync(path.join(repo, file), "utf8").replace(/\r\n/g, "\n").replace(/\n/g, ending)
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}
function exact(sf: ts.SourceFile, match: (n: ts.Node) => boolean) {
  const found: ts.Node[] = []; const visit = (n: ts.Node) => { if (match(n)) found.push(n); ts.forEachChild(n, visit) }; visit(sf)
  assert.equal(found.length, 1); return found[0].getText(sf)
}
function compile(code: string, globals: Record<string, unknown> = {}) {
  const exports: any = {}, result = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.equal(result.diagnostics?.length, 0)
  vm.runInNewContext(result.outputText, { exports, TextEncoder, Date, Map, Set, ...globals }); return exports
}
// Row body comes from the real backend projector/list method. Only unneeded
// persistence/native imports and the completed-load seam are inert here.
const backend = compile(fs.readFileSync(path.join(repo, "companion/src/acp/history-store.ts"), "utf8"), {
  require(name: string) {
    if (name === "fs") return fs
    if (name === "path") return path
    if (name === "crypto") return { randomUUID() { throw Error("UNUSED_UUID") } }
    if (name === "./history-privacy") return { verifyHistoryPrivacy() { throw Error("NO_NATIVE_PRIVACY") } }
    if (name === "./history-new-empty") return { initializeHistoryEmpty() { throw Error("NO_NATIVE_INITIALIZER") } }
    throw Error("UNADMITTED_HISTORY_IMPORT")
  }, Buffer: { byteLength: (value: string) => new TextEncoder().encode(value).length },
})
const event = { session_id: "one", thread_id: "owner", agent_id: "owned", mode: "review_readonly", state: "running", created_at: "2026-10-21T00:00:00.000Z" }
async function actualRows(live: boolean) {
  const projected = backend.projectAcpHistory(event)
  assert.ok(projected)
  return backend.AcpHistoryStore.prototype.list.call({ options: { enabled: () => true }, rows: new Map([["one", projected]]), status: "ok", blocked: false, startWork() {}, async settle() {} }, "owner", live ? [event] : [])
}
function fixture(ending = "\n", flags: { open?: boolean; enabled?: boolean } = {}) {
  let state = agentReducer(agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "owner" }), { type: "SET_CONNECTION", state: "connected" })
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event })
  const dispatch = (a: any) => { state = agentReducer(state, a) }, wire: any[] = []; let dependencies: unknown[] | undefined, sequence = 0, nativeDisconnects = 0
  const hook = syntax(files.hook, ending), panel = syntax(files.panel, ending), background = syntax(files.background, ending)
  const branch = exact(hook, n => ts.isIfStatement(n) && n.expression.getText(hook) === 'msg.type === "thread.mutation.connection"')
  const effect = exact(panel, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(panel) === "useEffect" && n.getText(panel).includes('type: "acp.sessions.list"'))
  const context = { dispatch, workspaceHintsRef: { current: { select() {}, observe() {}, view() { return null } } }, activeThreadRef: { current: "owner" }, workspaceHintSelectionRef: { current: 1 }, clearCodingOperationFeedback() {} }
  const route = compile(`export function consume(msg){${branch}}`, context).consume
  const producer = exact(background, n => ts.isFunctionDeclaration(n) && n.name?.text === "handleStateChange")
  const emit = compile(`export ${producer}`, { updateBadge() {}, cockpitNativeRelay: { disconnect() { nativeDisconnects++ } }, chrome: { runtime: { sendMessage(message: unknown) { route(message); return Promise.resolve() } } }, scheduleDisconnectNotification() {}, clearGraphRequests() {}, cancelDisconnectNotification() {}, clearDisconnectedNotification() {}, wsClient: { send() {} } }).handleStateChange
  const render = () => compile(`export function install(){${effect}}`, { state, open: flags.open !== false, threadId: "owner", storeAcpEnabled: flags.enabled !== false, session: selectCodingSession(state), dispatch,
    crypto: { randomUUID: () => `connection-${++sequence}` }, chrome: { runtime: { lastError: undefined, sendMessage(message: unknown, done: () => void) { wire.push(message); done() } } },
    useEffect(fn: () => void, next: unknown[]) { if (!dependencies || next.some((value, i) => !Object.is(value, dependencies![i]))) { dependencies = next; fn() } },
  }).install()
  const deliver = async (index: number, live = false, patch: Record<string, unknown> = {}) => {
    const frame = wire[index], result = await actualRows(live)
    dispatch({ type: "ACP_HISTORY_RESULT", message: { type: "acp.sessions.list_result", thread_id: frame.thread_id, request_id: frame.request_id, ...result, ...patch } })
  }
  return { get state() { return state }, get nativeDisconnects() { return nativeDisconnects }, wire, route, emit, render, dispatch, deliver }
}

test("#732 management connection observations preserve chat, while the existing status action still clears disconnected work", async () => {
  const f = fixture(); f.render(); await f.deliver(0, true)
  f.dispatch({ type: "SET_THREAD_BUSY", threadId: "owner", busy: true })
  f.dispatch({ type: "SET_PROCESSING", isProcessing: true })
  f.dispatch({ type: "SET_STREAMING", content: "owned chat stream" })
  f.dispatch({ type: "SET_STREAMING_REASONING", content: "owned chat reasoning" })
  const chat = () => JSON.stringify({ busy: f.state.threadBusyById, processing: f.state.isProcessing,
    content: f.state.streamingContent, reasoning: f.state.streamingReasoning, messages: f.state.messages })
  const before = chat(), revision = f.state.codingHistoryConnectionRevision
  f.emit("disconnected")
  assert.equal(chat(), before, "management broadcast must not clear unrelated chat activity")
  assert.equal(f.state.codingHistory, null)
  assert.equal(f.state.codingHistoryConnectionRevision, revision + 1)
  f.emit("connected"); f.render(); assert.equal(f.wire.length, 2)
  f.dispatch({ type: "SET_CONNECTION", state: "disconnected" })
  assert.equal(f.state.isProcessing, false); assert.deepEqual(f.state.threadBusyById, {})
  assert.equal(f.state.streamingContent, ""); assert.equal(f.state.streamingReasoning, "")
})

test("#732 actual rapid connection broadcasts invalidate live history between polls (LF/CRLF)", async () => {
  for (const ending of ["\n", "\r\n"]) {
    const f = fixture(ending); f.render(); await f.deliver(0, true)
    f.emit("disconnected"); assert.equal(f.state.connectionState, "disconnected"); assert.equal(f.state.codingHistory, null)
    f.render(); assert.equal(f.wire.length, 1)
    f.emit("connected"); f.render(); assert.equal(f.wire.length, 2)
    await f.deliver(1); assert.equal(f.state.codingHistory?.rows[0].history_status, "interrupted"); assert.equal(selectCodingSession(f.state), null)
  }
})
test("#732 one-batch disconnect/reconnect refreshes the actual panel effect despite final connected label", async () => {
  const f = fixture(); f.render(); await f.deliver(0, true)
  f.emit("disconnected"); f.emit("connected"); f.render(); assert.equal(f.wire.length, 2)
  const pending = f.state; await f.deliver(0); assert.equal(f.state, pending)
  await f.deliver(1); assert.equal(selectCodingSession(f.state), null)
  f.render(); await f.deliver(2); f.render(); assert.equal(f.wire.length, 3, "retirement follow-up settles, no requestId dependency loop")
})
test("#732 connecting loss and duplicate/unknown observations cannot loop or read while unconnected", () => {
  const f = fixture(); f.render(); f.emit("connecting"); f.render(); assert.equal(f.wire.length, 1); assert.equal(f.state.codingHistory, null)
  f.emit("connecting"); f.render(); assert.equal(f.wire.length, 1)
  f.emit("connected"); f.render(); assert.equal(f.wire.length, 2)
  f.emit("connected"); f.render(); assert.equal(f.wire.length, 2)
  const old = f.state
  f.route({ type: "thread.mutation.connection", state: "unknown" }); f.render(); assert.equal(f.state.connectionState, "connected"); assert.equal(f.wire.length, 2)
  assert.equal(agentReducer(old, { type: "SET_CONNECTION", state: "unknown" } as any), old)
})
test("#732 loss invalidates a pending old reply, while a fresh runtime event wins over the current history reply", async () => {
  const f = fixture(); f.render(); f.emit("disconnected"); f.emit("connected"); f.render()
  const pending = f.state; await f.deliver(0); assert.equal(f.state, pending)
  f.dispatch({ type: "ACP_SESSION_EVENT", event }); const current = selectCodingSession(f.state)
  await f.deliver(1); assert.equal(selectCodingSession(f.state), current); assert.equal(f.state.codingHistory?.rows[0].history_status, "interrupted")
})
test("#732 current history refresh preserves owner/request/selection guards", async () => {
  for (const mode of ["owner", "request", "selection"] as const) {
    const f = fixture(); f.render(); f.emit("disconnected"); f.emit("connected"); f.render()
    if (mode === "selection") { f.dispatch({ type: "SET_ACTIVE_THREAD", threadId: "other" }); f.dispatch({ type: "SET_ACTIVE_THREAD", threadId: "owner" }) }
    const before = f.state
    await f.deliver(1, false, mode === "owner" ? { thread_id: "foreign" } : mode === "request" ? { request_id: "history:old" } : {})
    assert.equal(f.state, before); assert.equal(selectCodingSession(f.state)?.state, "running")
  }
})
test("#732 connection observations cannot enable history for closed/disabled/foreign panels", () => {
  for (const mode of ["closed", "disabled", "foreign"] as const) {
    const f = fixture("\n", { open: mode !== "closed", enabled: mode !== "disabled" })
    if (mode === "foreign") f.dispatch({ type: "SET_ACTIVE_THREAD", threadId: "other" })
    f.render(); f.emit("disconnected"); f.emit("connected"); f.render(); assert.equal(f.wire.length, 0)
  }
})
test("#732 ordinary explicit polling transition still refreshes history; duplicate labels do not", () => {
  const f = fixture(); f.render(); f.dispatch({ type: "SET_CONNECTION", state: "disconnected" }); f.render()
  f.dispatch({ type: "SET_CONNECTION", state: "connected" }); f.render(); assert.equal(f.wire.length, 2)
  f.dispatch({ type: "SET_CONNECTION", state: "connected" }); f.render(); assert.equal(f.wire.length, 2)
})

// The actual background connection producer now has two independent consumers.
// This inert required binding keeps the history fixture honest without starting
// the native host or replacing either consumer's production behavior.
test("#732/#723 actual connection producer notifies native relay only on disconnect", () => {
  for (const ending of ["\n", "\r\n"]) {
    const f = fixture(ending)
    f.emit("connected"); f.emit("connecting"); assert.equal(f.nativeDisconnects, 0)
    f.emit("disconnected"); assert.equal(f.nativeDisconnects, 1)
    f.emit("connected"); assert.equal(f.nativeDisconnects, 1)
    f.emit("disconnected"); assert.equal(f.nativeDisconnects, 2)
  }
})
