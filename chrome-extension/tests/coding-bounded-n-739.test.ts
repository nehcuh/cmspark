/** Actual reducer/producer CPU contracts; no mounted browser or runtime bridge. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { codingManualEntryAction } from "../src/sidepanel/utils/coding-manual-entry-message"
import { codingControlAction } from "../src/sidepanel/utils/coding-control-message"
import { agentReducer, initialState, selectCodingSession, type AgentState } from "../src/sidepanel/store/agentStore"
import { sendCodingOperation, takeCodingOperationReply, clearCodingOperationFeedback, captureCodingSelection } from "../src/sidepanel/utils/coding-operation-send"

const switchTo = (s: AgentState, threadId: string) => agentReducer(s, { type: "SET_ACTIVE_THREAD", threadId })
function offer(s: AgentState, sessionId: string, threadId = "owner") {
  return agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: sessionId, thread_id: threadId, agent_id: sessionId, state: "offered" } })
}
function select(s: AgentState, sessionId: string) {
  return agentReducer(s, { type: "ACP_SELECT_SESSION", threadId: "owner", sessionId, threadRevision: s.activeThreadSelectionRevision })
}
const identity = (s: AgentState, sessionId: string) => ({ sessionId, threadId: "owner", threadRevision: s.activeThreadSelectionRevision, selectionRevision: s.activeCodingSelectionRevision })

test("#739 ordered membership keeps all same-thread sessions; progress/handback does not steal a valid view", () => {
  let s = offer(offer(switchTo(initialState, "owner"), "A"), "B")
  assert.deepEqual(JSON.parse(JSON.stringify(s.codingSessionIdsByThread.owner)), ["A", "B"])
  s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: "A", thread_id: "owner", state: "closed", execution_phase: "released" } })
  s = offer(s, "C")
  assert.equal(selectCodingSession(s)?.sessionId, "A")
  s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: "B", thread_id: "owner", state: "running", execution_phase: "running" } })
  assert.deepEqual(JSON.parse(JSON.stringify(s.codingSessionIdsByThread.owner)), ["A", "B", "C"])
  assert.equal(selectCodingSession(s)?.sessionId, "A")
})

test("#739 same-thread A→B→A changes selection revision and rejects stale operation result", () => {
  let s = offer(offer(switchTo(initialState, "owner"), "A"), "B"), captured = identity(s, "A")
  s = agentReducer(s, { type: "ACP_OPERATION_REQUEST", ...captured })
  s = select(select(s, "B"), "A")
  assert.ok(s.activeCodingSelectionRevision > captured.selectionRevision)
  assert.equal(agentReducer(s, { type: "ACP_OPERATION_ERROR", ...captured, error: "STALE" }), s)
  s = agentReducer(s, { type: "ACP_OPERATION_ERROR", ...identity(s, "A"), error: "CURRENT" })
  assert.equal(s.codingOperationError?.error, "CURRENT")
})

test("#739 thread A→other→A also rejects stale operation/manual completion without retargeting records", () => {
  let s = offer(switchTo(initialState, "owner"), "A"), captured = identity(s, "A")
  s = agentReducer(s, { type: "ACP_MANUAL_ENTRY_REQUEST", ...captured, requestId: "entry-A" })
  s = switchTo(switchTo(s, "other"), "owner")
  assert.equal(agentReducer(s, { type: "ACP_OPERATION_ERROR", ...captured, error: "STALE" }), s)
  assert.equal(agentReducer(s, { type: "ACP_MANUAL_ENTRY_RESULT", ...captured, requestId: "entry-A", commandLine: "inert", shell: "POSIX sh" }), s)
})

test("#739 closed+closing is owned active metadata, cannot be compacted/dismissed by old terminal timer", () => {
  let s = switchTo(initialState, "other")
  s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: "held", thread_id: "owner", state: "closed", execution_phase: "closing" } })
  for (let i = 0; i < 20; i++) s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: `done${i}`, thread_id: `done${i}`, state: "closed", execution_phase: "released" } })
  assert.equal(s.codingSessionsById.held.executionPhase, "closing")
  assert.equal(s.codingSessionsById.held.cacheCompacted, undefined)
  s = switchTo(s, "owner")
  assert.equal(agentReducer(s, { type: "CLEAR_CODING_SESSION", sessionId: "held" }), s)
})

test("#739 compacted markers leave membership but late events cannot restore rich view", () => {
  let s = switchTo(initialState, "other")
  for (let i = 0; i < 20; i++) s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: `done${i}`, thread_id: "owner", state: "closed", execution_phase: "released" } })
  const compacted = Object.values(s.codingSessionsById).find(row => row.cacheCompacted)!
  assert.ok(compacted)
  assert.equal(s.codingSessionIdsByThread.owner.includes(compacted.sessionId), false)
  assert.equal(agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: compacted.sessionId, thread_id: "owner", state: "running", execution_phase: "running" } }), s)
})

test("#739 actual send helper captures both UI revisions only in local actions, never adds wire authority", () => {
  clearCodingOperationFeedback()
  const wire: any[] = [], actions: any[] = []
  const prior = globalThis.chrome
  ;(globalThis as any).chrome = { runtime: { sendMessage(message: unknown, callback: (value: unknown) => void) { wire.push(message); callback({ ok: false, error: "INERT_REFUSAL" }) } } }
  try {
    sendCodingOperation({ sessionId: "A", threadId: "owner" }, a => actions.push(a), { type: "acp.ui_start", cloud_disclosure_accepted: true }, { threadRevision: 2, selectionRevision: 3 })
    assert.equal(actions.length, 2)
    assert.ok(actions.every(a => a.threadRevision === 2 && a.selectionRevision === 3))
    assert.deepEqual(JSON.parse(JSON.stringify(wire)), [{ type: "acp.ui_start", cloud_disclosure_accepted: true, session_id: "A", thread_id: "owner" }])
  } finally { (globalThis as any).chrome = prior }
})

test("#739 private outstanding requests reject repeats, correlate parent replies and ignore late callbacks after settlement", () => {
  clearCodingOperationFeedback()
  const callbacks: Array<(r: any) => void> = [], actions: any[] = [], prior = globalThis.chrome
  ;(globalThis as any).chrome = { runtime: { sendMessage(_message: unknown, callback: (value: unknown) => void) { callbacks.push(callback) } } }
  try {
    const capture = { threadRevision: 2, selectionRevision: 3 }
    for (const sessionId of ["A", "B"]) assert.equal(sendCodingOperation({ sessionId, threadId: "owner" }, a => actions.push(a), { type: "acp.session.followup", goal: "inert" }, capture), true)
    assert.equal(sendCodingOperation({ sessionId: "A", threadId: "owner" }, a => actions.push(a), { type: "acp.session.followup", goal: "duplicate" }, capture), false)
    assert.equal(callbacks.length, 2)
    assert.equal(takeCodingOperationReply({ type: "acp.ui_start.accepted", session_id: "new-A", thread_id: "owner" }), null)
    assert.equal(takeCodingOperationReply({ type: "acp.ui_start.accepted", session_id: "new-A", parent_session_id: "A", thread_id: "foreign" }), null)
    const settled = takeCodingOperationReply({ type: "acp.ui_start.accepted", session_id: "new-B", parent_session_id: "B", thread_id: "owner" })!
    if (settled.type !== "ACP_OPERATION_SETTLED") throw new Error("actual accepted reply must settle this operation")
    assert.equal(settled.sessionId, "B"); assert.equal(settled.threadRevision, 2); assert.equal(settled.selectionRevision, 3)
    const count = actions.length
    callbacks[1]({ ok: false, error: "LATE_AFTER_SETTLE" }); assert.equal(actions.length, count)
    clearCodingOperationFeedback(); callbacks[0]({ ok: false, error: "AFTER_DISCONNECT" }); assert.equal(actions.length, count)
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})

test("#739 singleton legacy seed migrates one owner-checked selection, never grants a restored execution slot", () => {
  let s: any = offer(offer(switchTo(initialState, "owner"), "A"), "B")
  delete s.codingSessionIdsByThread; delete s.activeCodingSelectionRevision
  s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: "foreign", thread_id: "elsewhere", state: "offered" } })
  assert.deepEqual(JSON.parse(JSON.stringify(s.codingSessionIdsByThread.owner)), ["A"])
  assert.equal(s.codingSessionsById.A.executionPhase, undefined)
})

test("#739 terminal event/Stop ACK before Start reply cannot retire or replace that outstanding request", () => {
  clearCodingOperationFeedback()
  let s = offer(offer(switchTo(initialState, "owner"), "A"), "B")
  const wire: any[] = [], callbacks: any[] = [], prior = globalThis.chrome
  ;(globalThis as any).chrome = { runtime: { sendMessage(message: any, callback: any) { wire.push(message); callbacks.push(callback) } } }
  const dispatch = (action: any) => { s = agentReducer(s, action) }
  try {
    const captured = identity(s, "A")
    assert.equal(sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.ui_start" }, captured), true)
    callbacks[0]({ ok: true }) // forwarding alone is not the sole handler's reply
    s = agentReducer(s, { type: "ACP_SESSION_EVENT", event: { session_id: "A", thread_id: "owner", state: "closed", execution_phase: "released" } })
    assert.equal(takeCodingOperationReply({ type: "acp.session.cancel.ack", session_id: "A", thread_id: "owner" }), null)
    s = agentReducer(s, { type: "ACP_CANCEL_RECEIPT", sessionId: "A", threadId: "owner" })
    s = select(select(s, "B"), "A")
    assert.equal(sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.ui_start" }, identity(s, "A")), false)
    assert.equal(wire.length, 1)
    const currentError = s.codingOperationError
    const oldReply = takeCodingOperationReply({ type: "error", family: "acp", request_type: "acp.ui_start", session_id: "A", thread_id: "owner", error: "ORIGINAL_START_RESULT" })!
    s = agentReducer(s, oldReply)
    assert.equal(s.codingOperationError, currentError, "old capture cannot replace current duplicate feedback after ABA")
    callbacks[0]({ ok: false, error: "LATE_FORWARD_CALLBACK" })
    assert.equal(s.codingOperationError, currentError)
    clearCodingOperationFeedback()
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})


test("#739 actual whole WS listener correlates exact receipts and retains Stop/manual-entry and legacy unknown fences", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const sf = ts.createSourceFile("hook", source, ts.ScriptTarget.ES2022, true)
  let listener: ts.VariableDeclaration | undefined
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "messageListener") listener = node; ts.forEachChild(node, walk) }; walk(sf)
  if (!listener) throw Error("actual whole listener required")
  let s = offer(offer(switchTo(initialState, "owner"), "A"), "B")
  const callbacks: any[] = [], prior = globalThis.chrome, actions: any[] = []
  ;(globalThis as any).chrome = { runtime: { sendMessage(_message: unknown, callback: any) { callbacks.push(callback) } } }
  const dispatch = (a: any) => { actions.push(a); s = agentReducer(s, a) }
  const exported: any = {}
  const code = ts.transpileModule(`export const ${listener.getText(sf)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports: exported, takeCodingOperationReply, dispatch, codingManualEntryAction, codingControlAction,
    activeThreadRef: { current: "owner" }, isBoardHintReply: () => false, isManagedThreadMutationReply: () => false,
    nextHydrateRetry: () => "none", knowledgePreviewErrorText: () => null, isComputerModelErrorMessage: () => false,
  })
  const route = exported.messageListener
  try {
    clearCodingOperationFeedback()
    const captured = identity(s, "A")
    sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "inert" }, captured)
    s = select(select(s, "B"), "A")
    const before = s
    route({ type: "error", family: "other", request_type: "acp.session.prompt", session_id: "A", thread_id: "owner", error: "WRONG_FAMILY" })
    assert.equal(s, before)
    route({ type: "error", family: "acp", request_type: "acp.session.prompt", session_id: "A", thread_id: "owner", error: "OLD_PROMPT" })
    assert.equal(s, before, "actual listener cannot assign current revisions to an old same-session receipt")
    sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "inert" }, identity(s, "A"))
    route({ type: "error", family: "acp", request_type: "acp.session.prompt", session_id: "A", thread_id: "owner", error: "CURRENT_PROMPT" })
    assert.equal(s.codingOperationError?.error, "CURRENT_PROMPT")
    callbacks[0]({ ok: false, error: "LATE_FORWARD" }); assert.equal(s.codingOperationError?.error, "CURRENT_PROMPT")
    route({ type: "error", family: "acp", request_type: "acp.session.prompt", session_id: "A", thread_id: "owner", error: "LEGACY_UNKNOWN" })
    assert.equal(s.codingOperationError?.error, "CURRENT_PROMPT"); assert.equal(s.codingSessionsById.A.operationError, "LEGACY_UNKNOWN")
    route({ type: "error", family: "acp", request_type: "acp.session.prompt", session_id: "A", thread_id: "foreign", error: "FOREIGN" })
    assert.equal(s.codingSessionsById.A.operationError, "LEGACY_UNKNOWN")
    dispatch({ type: "ACP_MANUAL_ENTRY_REQUEST", ...identity(s, "A"), requestId: "manual" })
    route({ type: "acp.session.manual_entry", session_id: "A", thread_id: "owner", request_id: "manual", command_line: "owned fixture command", shell: "POSIX sh" })
    assert.equal(s.codingManualEntry?.commandLine, "owned fixture command")
    route({ type: "acp.session.cancel.ack", session_id: "A", thread_id: "owner" })
    assert.equal(s.codingSessionsById.A.cancelConfirmed, true)
    assert.equal(actions.some(a => a.type === "SET_PROCESSING_STATUS"), false)
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})


test("#739 outstanding map stops at64 without evicting unsettled requests or borrowing a late old connection callback", () => {
  clearCodingOperationFeedback()
  const prior = globalThis.chrome, callbacks: any[] = [], actions: any[] = []
  ;(globalThis as any).chrome = { runtime: { sendMessage(_message: unknown, callback: any) { callbacks.push(callback) } } }
  const capture = { threadRevision: 2, selectionRevision: 3 }, dispatch = (a: any) => actions.push(a)
  try {
    for (let i = 0; i < 64; i++) assert.equal(sendCodingOperation({ sessionId: `S${i}`, threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "inert" }, capture), true)
    assert.equal(sendCodingOperation({ sessionId: "overflow", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "inert" }, capture), false)
    assert.equal(callbacks.length, 64)
    const first = takeCodingOperationReply({ type: "acp.session.prompt.accepted", session_id: "S0", thread_id: "owner" })!
    if (first.type !== "ACP_OPERATION_SETTLED") throw Error("expected own pending settlement")
    assert.equal(first.sessionId, "S0", "capacity refusal cannot evict the first unsettled operation")
    clearCodingOperationFeedback()
    assert.equal(sendCodingOperation({ sessionId: "S0", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "new connection" }, capture), true)
    const count = actions.length; callbacks[0]({ ok: false, error: "OLD_CONNECTION" }); assert.equal(actions.length, count)
    assert.equal(takeCodingOperationReply({ type: "acp.session.prompt.accepted", session_id: "S0", thread_id: "owner" })?.type, "ACP_OPERATION_SETTLED")
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})


test("#739 actual primary-start callback preserves forwarding rollback and original12s fallback without retiring pending requests", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../../src/sidepanel/components/CodingAgentPanel.tsx"), "utf8")
  const sf = ts.createSourceFile("panel", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "sendUiStart" && n.initializer && ts.isCallExpression(n.initializer)) callback = n.initializer.arguments[0]; ts.forEachChild(n, walk) }; walk(sf)
  if (!callback) throw Error("actual primary start callback required")
  let s = switchTo(initialState, "owner")
  const capture = identity(s, ""), ref = { current: { threadId: "owner", revision: capture.threadRevision, selectionRevision: capture.selectionRevision } }
  const starting: boolean[] = [], timers: Array<{ fn: () => void; ms: number }> = [], forwards: any[] = [], flashes: string[] = []
  const prior = globalThis.chrome
  ;(globalThis as any).chrome = { runtime: { sendMessage(_message: unknown, callback: any) { forwards.push(callback) } } }
  const exported: any = {}, dispatch = (a: any) => { s = agentReducer(s, a) }
  vm.runInNewContext(ts.transpileModule(`export const start=${callback.getText(sf)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: exported, effectiveWorkspace: "/inert/workspace", mountedRef: { current: true }, threadId: "owner", state: s, agentId: "A",
    setStarting: (v: boolean) => starting.push(v), flash: (s: string) => flashes.push(s), formatPageContext: () => "inert", pageUrl: "", pageTitle: "", repoHint: null,
    captureCodingSelection, currentSelectionRef: ref, sendCodingOperation, dispatch, goal: "inert", mode: "review_readonly",
    isAcpDisabledError: () => false, setStoreAcpEnabledFalse: () => { throw Error("UNEXPECTED_CONFIG_ROLLBACK") },
    startingRef: { current: true }, enablePollTimersRef: { current: [] }, window: { setTimeout(fn: () => void, ms: number) { timers.push({ fn, ms }); return timers.length } },
  })
  try {
    clearCodingOperationFeedback(); exported.start(); assert.equal(forwards.length, 1); assert.equal(timers.length, 0)
    forwards[0]({ ok: false, error: "INERT_FORWARD_FAILURE" }); assert.equal(timers.length, 0); assert.equal(starting.at(-1), false); assert.equal(flashes.at(-1), "INERT_FORWARD_FAILURE")
    clearCodingOperationFeedback(); starting.length = 0; exported.start(); forwards[1]({ ok: true }); assert.equal(timers[0].ms, 12000); timers[0].fn()
    assert.equal(starting.at(-1), false)
    assert.equal(sendCodingOperation({ sessionId: "", threadId: "owner" }, dispatch, { type: "acp.ui_start" }, capture), false, "local CTA fallback cannot retire the unique pending reply")
    ref.current.selectionRevision++
    starting.length = 0; timers[0].fn(); assert.equal(starting.length, 0, "old timer cannot affect a new selection")
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})

test("#739 actual Stop hook checks both view revisions before transmit and keeps late errors on the original owner row", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../../src/sidepanel/hooks/useCodingStop.ts"), "utf8")
  let state = offer(offer(switchTo(initialState, "owner"), "A"), "B"), refs: any[] = [], cursor = 0
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "A", thread_id: "owner", state: "running", execution_phase: "running" } })
  const wire: any[] = [], callbacks: any[] = [], exported: any = {}
  const chrome = { runtime: { sendMessage(msg: any, callback: any) { wire.push(msg); callbacks.push(callback) } } }
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: exported, chrome,
    require(name: string) {
      if (name === "react") return { useRef(value: any) { const i = cursor++; return refs[i] || (refs[i] = { current: value }) }, useState: () => ["", () => {}], useEffect() {} }
      if (name === "../store/agentStore") return { useAgentStore: () => ({ state, dispatch: (a: any) => { state = agentReducer(state, a) } }), codingSessionBelongsToThread: (row: any, threadId: string) => row?.threadId === threadId }
      throw Error("UNADMITTED_STOP_IMPORT")
    },
  })
  const render = () => { cursor = 0; return exported.useCodingStop(state.codingSessionsById.A) }
  const old = render(); state = select(select(state, "B"), "A"); const current = render()
  old.stop(); assert.equal(wire.length, 0)
  current.stop(); assert.equal(wire.length, 1); assert.equal(wire[0].session_id, "A"); assert.equal(wire[0].thread_id, "owner")
  state = select(state, "B"); render(); callbacks[0]({ ok: false, error: "OWNED_LATE_STOP_FAILURE" })
  assert.equal(state.codingSessionsById.A.controlError, "OWNED_LATE_STOP_FAILURE")
  assert.equal(state.codingSessionIdByThread.owner, "B"); assert.equal(state.codingOperationError, null)
})


test("#739 actual connection lifecycle broadcast retires pending feedback even when disconnect/reconnect happens between polls", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const sf = ts.createSourceFile("hook", source, ts.ScriptTarget.ES2022, true)
  let listener: ts.VariableDeclaration | undefined
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "messageListener") listener = node; ts.forEachChild(node, walk) }; walk(sf)
  if (!listener) throw Error("actual whole listener required")
  clearCodingOperationFeedback()
  const actions: any[] = [], callbacks: any[] = [], prior = globalThis.chrome
  ;(globalThis as any).chrome = { runtime: { sendMessage(_message: unknown, callback: any) { callbacks.push(callback) } } }
  const exported: any = {}, dispatch = (a: any) => actions.push(a)
  vm.runInNewContext(ts.transpileModule(`export const ${listener.getText(sf)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: exported, takeCodingOperationReply, clearCodingOperationFeedback, dispatch,
  })
  const route = exported.messageListener, capture = { threadRevision: 2, selectionRevision: 3 }
  try {
    assert.equal(sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "old connection" }, capture), true)
    route({ type: "thread.mutation.connection", state: "disconnected" })
    route({ type: "thread.mutation.connection", state: "connected" })
    const count = actions.length
    callbacks[0]({ ok: false, error: "OLD_CONNECTION_CALLBACK" })
    route({ type: "acp.session.prompt.accepted", session_id: "A", thread_id: "owner" })
    assert.equal(actions.length, count, "late callback/reply cannot settle feedback from a lost connection")
    assert.equal(sendCodingOperation({ sessionId: "A", threadId: "owner" }, dispatch, { type: "acp.session.prompt", text: "current connection" }, capture), true)
    route({ type: "thread.mutation.connection", state: "connected" })
    assert.equal(takeCodingOperationReply({ type: "acp.session.prompt.accepted", session_id: "A", thread_id: "owner" })?.type, "ACP_OPERATION_SETTLED", "connected status alone is not a new invalidation")
  } finally { clearCodingOperationFeedback(); (globalThis as any).chrome = prior }
})
