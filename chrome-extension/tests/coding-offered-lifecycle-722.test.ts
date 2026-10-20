/** Actual reducer + production JSX/onclick and send helper; CPU seams, not mounted browser. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import { agentReducer, initialState, selectCodingSession } from "../src/sidepanel/store/agentStore"
import { codingMessageTargetsSelection } from "../src/sidepanel/hooks/useWebSocket"
const root = path.resolve(__dirname, "../../src/sidepanel")
function sf(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
function one(file: ts.SourceFile, predicate: (n: ts.Node) => boolean) { const rows: ts.Node[] = []; function walk(n: ts.Node) { if (predicate(n)) rows.push(n); ts.forEachChild(n, walk) } walk(file); assert.equal(rows.length, 1); return rows[0].getText(file) }
function compile(code: string, globals: Record<string, unknown> = {}) { const exports: any = {}; (vm.runInNewContext as any)(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, require(id: string) { assert.equal(id, "react/jsx-runtime"); return jsxRuntime }, ...globals }, { timeout: 2000 }); return exports }
function stateWithOffers() {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "A" })
  for (const id of ["a1", "a2", "a3", "a4"]) state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: id, thread_id: "A", agent_id: "inert", state: "offered" } })
  return agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "foreign", thread_id: "B", agent_id: "private-inert", state: "offered" } })
}
test("#722 four valid offered events retain records without silently replacing current selection", () => {
  const state = stateWithOffers(); assert.equal(selectCodingSession(state)?.sessionId, "a1")
  assert.equal(Object.values(state.codingSessionsById).filter(row => row.threadId === "A").length, 4)
})
test("#722 explicit same-owner selection changes only that target and clears old operation feedback", () => {
  let state = stateWithOffers()
  state = agentReducer(state, { type: "ACP_SELECT_SESSION", threadId: "A", sessionId: "a3", threadRevision: state.activeThreadSelectionRevision })
  assert.equal(selectCodingSession(state)?.sessionId, "a3"); assert.equal(state.codingSessionsById.a1.state, "offered")
  assert.equal(state.codingOperationError, null)
})
test("#722 foreign/missing/ABA-stale selection does not retarget current controls", () => {
  let state = stateWithOffers(), before = state
  for (const sessionId of ["foreign", "missing"]) assert.equal(agentReducer(state, { type: "ACP_SELECT_SESSION", threadId: "A", sessionId, threadRevision: state.activeThreadSelectionRevision }), before)
  const oldRevision = state.activeThreadSelectionRevision
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "B" }); state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "A" })
  assert.equal(agentReducer(state, { type: "ACP_SELECT_SESSION", threadId: "A", sessionId: "a3", threadRevision: oldRevision }), state)
})
test("#722 expired selected row closes without automatically selecting another offered row", () => {
  let state = stateWithOffers()
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "a1", thread_id: "A", state: "closed", error: "expired" } })
  assert.equal(selectCodingSession(state)?.sessionId, "a1"); assert.equal(selectCodingSession(state)?.error, "expired")
  assert.equal(state.codingSessionsById.a2.state, "offered")
})
test("#722 same-thread older replies cannot overwrite a newer selected operation's status", () => {
  const selected = { A: "a3" }
  assert.equal(codingMessageTargetsSelection({ thread_id: "A", session_id: "a3" }, "A", selected), true)
  for (const reply of [{ thread_id: "A", session_id: "a1" }, { thread_id: "B", session_id: "a3" }, { session_id: "a3" }]) assert.equal(codingMessageTargetsSelection(reply, "A", selected), false)
})
test("#722 actual selector JSX lists only current owner and dispatches the explicit selection identity", () => {
  const file = sf("components/CodingAgentPanel.tsx"), declaration = one(file, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(file) === "selectableSessions"))
  const select = one(file, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(file) === "aria-label" && a.getText(file).includes("选择本对话编程提案")))
  let state = stateWithOffers(); const session = selectCodingSession(state)
  const render = compile(`export function render(state,session){const threadId='A';${declaration};return(${select})}`, { styles: {}, dispatch(action: any) { state = agentReducer(state, action) } }).render
  const element = render(state, session), html = renderToStaticMarkup(element)
  assert.equal((html.match(/<option /g) || []).length, 4); assert.equal(html.includes("private-inert"), false); assert.match(html, /待启动/)
  element.props.onChange({ target: { value: "a4" } }); assert.equal(selectCodingSession(state)?.sessionId, "a4")
})
test("#722 actual selected-start button invokes only old session ID/owner + original L2 request", () => {
  const file = sf("components/CodingAgentPanel.tsx"), button = one(file, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(file) === "button" && n.children.some(c => c.getText(file).includes("启动选中提案（需确认）")))
  const wire: any[] = [], actions: any[] = [], row: any = { sessionId: "a3", threadId: "A", state: "offered" }
  const operations = compile(sf("utils/coding-operation-send.ts").text, { chrome: { runtime: { sendMessage(message: any, done: any) { wire.push(message); done({ ok: true }) } } } })
  const refs = { session: { current: row }, owner: { current: { threadId: "A", revision: 2, selectionRevision: 3 } } }
  const render = compile(`export function render(cloudDisclosure=true){return(${button})}`, { session: row, state: { activeThreadSelectionRevision: 2, activeCodingSelectionRevision: 3 }, threadId: "A", styles: {}, pendingConfirm: false, starting: false,
    mountedRef: { current: true }, currentSessionRef: refs.session, currentSelectionRef: refs.owner, setStarting() {}, dispatch: (a: any) => actions.push(a), sendCodingOperation: operations.sendCodingOperation, captureCodingSelection: operations.captureCodingSelection }).render
  const element = render(); assert.match(renderToStaticMarkup(element), /需确认/); assert.equal(wire.length, 0)
  element.props.onClick(); assert.deepEqual(JSON.parse(JSON.stringify(wire)), [{ type: "acp.ui_start", cloud_disclosure_accepted: true, session_id: "a3", thread_id: "A" }])
  refs.session.current = { ...row, sessionId: "a4" }; element.props.onClick(); assert.equal(wire.length, 1)
  refs.session.current = row; refs.owner.current.revision = 3; element.props.onClick(); assert.equal(wire.length, 1)
  render(false).props.onClick(); assert.equal(wire.length, 1); assert.equal(actions[0].type, "ACP_OPERATION_REQUEST")
})
