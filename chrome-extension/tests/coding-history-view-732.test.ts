// Actual affected JSX/effect/consumer callback projection, not a browser or whole App.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import { codingHistoryLabel } from "../src/sidepanel/coding-handoff/history"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
const root = path.resolve(__dirname, "../../src/sidepanel")
function source(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
function exact(sf: ts.SourceFile, match: (node: ts.Node) => boolean) {
  const nodes: ts.Node[] = []; function visit(n: ts.Node) { if (match(n)) nodes.push(n); ts.forEachChild(n, visit) }; visit(sf)
  assert.equal(nodes.length, 1, "exact source region required"); return nodes[0].getText(sf)
}
function compile(code: string, globals: Record<string, unknown>) {
  const exports = {} as any
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => { assert.equal(name, "react/jsx-runtime"); return jsxRuntime }, ...globals })
  return exports
}
const rawRow = { session_id: "one", thread_id: "owner", agent_id: "<img src=x onerror=bad>", mode: "review_readonly", created_at: "2026-10-19T12:00:00.000Z", updated_at: "2026-10-19T12:00:00.000Z", observed_state: "running", source: "history", history_status: "interrupted" }

test("#732 actual history JSX escapes identifiers and provides no old-session action", () => {
  const sf = source("components/CodingAgentPanel.tsx")
  const region = exact(sf, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(sf) === "data-acp-history"))
  const render = compile(`export function render(history){return(${region})}`, { codingHistoryLabel }).render
  const html = renderToStaticMarkup(render({ pending: false, status: "ok", rows: [rawRow] }))
  assert.match(html, /已中断/); assert.match(html, /目标、路径和输出未保存/)
  assert.equal(html.includes("<img"), false); assert.equal(html.includes("<button"), false)
  assert.match(html, /max-height:140px/)
  assert.match(renderToStaticMarkup(render(null)), /不代表没有会话/)
})

test("#732 actual panel effect sends only bounded read-only owner request", () => {
  const sf = source("components/CodingAgentPanel.tsx")
  const effect = exact(sf, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(sf) === "useEffect" && n.getText(sf).includes('type: "acp.sessions.list"'))
  for (const variant of ["current", "foreign", "disconnected", "disabled", "closed"] as const) {
    const sends: any[] = [], actions: any[] = []
    let execute = () => {}
    compile(`export function install(){${effect}}`, {
      open: variant !== "closed", threadId: "owner", state: { activeThreadId: variant === "foreign" ? "other" : "owner", activeThreadSelectionRevision: 7,
        connectionState: variant === "disconnected" ? "disconnected" : "connected" },
      storeAcpEnabled: variant !== "disabled", session: null, crypto: { randomUUID: () => "inert-one" },
      dispatch: (v: unknown) => actions.push(v), useEffect: (fn: () => void) => { execute = fn },
      chrome: { runtime: { sendMessage: (v: unknown, fn: () => void) => { sends.push(v); fn() }, lastError: undefined } },
    }).install()
    execute()
    assert.equal(sends.length, variant === "current" ? 1 : 0)
    if (variant === "current") {
      assert.deepEqual(JSON.parse(JSON.stringify(sends[0])), { type: "acp.sessions.list", thread_id: "owner", request_id: "history:inert-one" })
      assert.equal(actions[0].selectionRevision, 7)
    }
  }
})

test("#732 actual WebSocket consumer case reaches the existing owner-guarded reducer", () => {
  const sf = source("hooks/useWebSocket.ts")
  const clause = exact(sf, n => ts.isCaseClause(n) && n.expression.getText(sf) === '"acp.sessions.list_result"')
  const consume = compile(`export function consume(msg,dispatch){switch(msg.type){${clause}}}`, {}).consume
  let state = agentReducer(initialState, { type: "SET_CONNECTION", state: "connected" })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "owner" })
  state = agentReducer(state, { type: "ACP_HISTORY_REQUEST", threadId: "owner", requestId: "history:one", selectionRevision: state.activeThreadSelectionRevision })
  consume({ type: "acp.sessions.list_result", thread_id: "owner", request_id: "history:one", status: "ok", rows: [rawRow] }, (action: any) => { state = agentReducer(state, action) })
  assert.equal(state.codingHistory?.rows.length, 1)
  assert.equal(Object.keys(state.codingSessionsById).length, 0)
})
