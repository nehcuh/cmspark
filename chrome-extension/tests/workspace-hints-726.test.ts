// Whole observer/hook/reducer and actual Panel callback seams. CPU, not browser/native.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as jsx from "react/jsx-runtime"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import { WorkspaceHints, workspaceHintPath } from "../src/sidepanel/coding-handoff/workspace-hints"
const root = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../src/sidepanel" : "../src/sidepanel")
function compile(code: string, globals: Record<string, any>) {
  const exports: any = {}; vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, console, ...globals }, { timeout: 2000 }); return exports
}
function connected() { const o = new WorkspaceHints(); o.select("A", 1); o.observe({ type: "connected" }); return o }
function shell(o: WorkspaceHints, id: string, cwd: string, extra: any = {}, params: any = {}) {
  o.observe({ type: "tool.start", thread_id: "A", tool_call_id: id, tool_name: "shell_exec", params })
  o.observe({ type: "tool.result", thread_id: "A", tool_call_id: id, tool_name: "shell_exec", result: { success: true, data: { exit_code: 0, timed_out: false, aborted: false, cwd, ...extra } } })
}
test("#726 exact path keys retain case/CJK/root and normalize only declared Windows spelling", () => {
  for (const [a, b] of [["c:/项目/repo/", "C:\\项目\\repo"], ["\\\\HOST\\SHARE\\中文\\", "\\\\host\\share\\中文"], ["C:\\", "c:/"], ["/", "/"]]) assert.equal(workspaceHintPath(a)?.key, workspaceHintPath(b)?.key)
  assert.notEqual(workspaceHintPath("/Repo")?.key, workspaceHintPath("/repo")?.key)
  assert.notEqual(workspaceHintPath("C:\\Repo")?.key, workspaceHintPath("C:\\repo")?.key)
  for (const bad of ["relative", "C:relative", "\\\\?\\C:\\repo", "/a/../b", "/bad\n", "/bad\u202e"]) assert.equal(workspaceHintPath(bad), null)
})
test("#726 memory is bounded3, latest first, retained count only; no automatic action", () => {
  const o = connected(); shell(o, "1", "/one"); shell(o, "2", "/two"); shell(o, "3", "/one"); shell(o, "4", "/three"); shell(o, "5", "/four")
  assert.equal(o.view()?.rows.length, 3); assert.equal(JSON.stringify(o.view()?.rows.map(r => r.path)), JSON.stringify(["/four", "/three", "/one"]))
  assert.equal(o.view()?.rows[2].count, 2); shell(o, "6", "/two"); assert.equal(o.view()?.rows[0].count, 1)
})
test("#726 only paired completed current frames qualify, never folded/error/missing/mismatched/remote", () => {
  for (const extra of [{ exit_code: 1 }, { timed_out: true }, { aborted: true }, { folded: true }, { redacted: true }, { truncated: true }]) { const o = connected(); shell(o, "1", "/bad", extra); assert.equal(o.view()?.rows.length, 0) }
  const o = connected()
  for (const msg of [
    { type: "tool.result", thread_id: "A", tool_call_id: "missing", tool_name: "shell_exec", result: { success: true, data: { cwd: "/bad", exit_code: 0, timed_out: false, aborted: false } } },
    { type: "tool.start", thread_id: "B", tool_call_id: "foreign", tool_name: "shell_exec", params: {} },
    { type: "tool.start", thread_id: "A", tool_call_id: "mcp", tool_name: "mcp_filesystem", params: { path: "/remote" } },
    { type: "thread.messages", thread_id: "A", messages: [{ data: { cwd: "/history" } }] },
  ]) o.observe(msg)
  assert.equal(o.view()?.rows.length, 0)
  o.observe({ type: "tool.start", thread_id: "A", tool_call_id: "x", tool_name: "shell_exec", params: {} })
  o.observe({ type: "tool.result", thread_id: "A", tool_call_id: "x", tool_name: "acp_propose_session", result: { success: true, data: { session_id: "offer", state: "offered", workspace_root: "/bad" } } })
  assert.equal(o.view()?.rows.length, 0)
})
test("#726 selection ABA/reconnect retires actual source holders and all hints", () => {
  const o = connected(); o.observe({ type: "tool.start", thread_id: "A", tool_call_id: "old", tool_name: "shell_exec", params: {} })
  o.select("B", 2); o.select("A", 3)
  o.observe({ type: "tool.result", thread_id: "A", tool_call_id: "old", tool_name: "shell_exec", result: { success: true, data: { cwd: "/bad", exit_code: 0, timed_out: false, aborted: false } } })
  assert.equal(o.view()?.rows.length, 0); shell(o, "new", "/good"); o.observe({ type: "thread.mutation.connection", state: "disconnected" }); assert.equal(o.view(), null)
  o.observe({ type: "thread.mutation.connection", state: "connected" }); assert.equal(o.view()?.rows.length, 0)
})
test("#726 getters/Proxy and incomplete sources cannot fabricate hints", () => {
  const o = connected(); const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw Error("not read") } }); assert.equal(o.observe(hostile), false)
  const p: any = {}; Object.defineProperty(p, "type", { get() { throw Error("not read") } }); assert.equal(o.observe(p), false)
  o.observe({ type: "tool.start", thread_id: "A", tool_call_id: "x", tool_name: "shell_exec", params: {} })
  const data: any = { exit_code: 0, aborted: false, timed_out: false }; Object.defineProperty(data, "cwd", { get() { throw Error("not read") } })
  o.observe({ type: "tool.result", thread_id: "A", tool_call_id: "x", tool_name: "shell_exec", result: { success: true, data } }); assert.equal(o.view()?.rows.length, 0)
})
function hook() {
  let state = agentReducer({ ...initialState, connectionState: "connected" }, { type: "SET_ACTIVE_THREAD", threadId: "A" })
  const effects: (() => void)[] = [], refs: any[] = []; let cursor = 0, listener: any
  const action = (a: any) => { state = agentReducer(state, a) }
  const no = () => {}
  const chrome = { runtime: { lastError: null, onMessage: { addListener(fn: any) { listener = fn }, removeListener: no }, sendMessage(_msg: any, done?: any) { if (_msg.type === "getStatus") done?.({ connectionState: "connected" }) }, connect: () => ({ disconnect: no }) }, storage: { local: { get: no, remove: no } } }
  const react = { useRef(v: any) { return refs[cursor++] ||= { current: v } }, useEffect(fn: any) { if (!listener) effects.push(fn) } }
  const fallback = new Proxy({}, { get: () => no })
  const mod = compile(fs.readFileSync(path.join(root, "hooks/useWebSocket.ts"), "utf8"), { require(id: string) {
    if (id === "react") return react
    if (id === "../store/agentStore") return { useAgentStore: () => ({ state, dispatch: action }) }
    if (id === "../coding-handoff/workspace-hints") return { WorkspaceHints }
    if (id === "../mode/mode-controller") return { isBrowserTool: () => false }
    return fallback
  }, chrome, document: { addEventListener: no, removeEventListener: no }, window: { dispatchEvent: no }, setInterval: () => 1, clearInterval: no })
  function render() { cursor = 0; mod.useWebSocket() }
  render(); effects.forEach(fn => fn())
  return { state: () => state, render, send: (msg: any) => listener(msg), action }
}
test("#726 whole live hook publishes only completed pairs; reducer retires disconnect and ABA", () => {
  const f = hook(); f.send({ type: "connected" }); f.render()
  f.send({ type: "tool.start", thread_id: "A", tool_call_id: "x", tool_name: "shell_exec", params: { command: "cd /declared" } })
  f.send({ type: "tool.result", thread_id: "A", tool_call_id: "x", tool_name: "shell_exec", result: { success: true, data: { cwd: "/actual/spawn", declared_cwd: "/declared", exit_code: 0, timed_out: false, aborted: false } } })
  assert.equal(JSON.stringify(f.state().workspaceHints?.rows.map(r => r.path)), JSON.stringify(["/declared", "/actual/spawn"]))
  const old = f.state().workspaceHints
  f.action({ type: "SET_ACTIVE_THREAD", threadId: "B" }); f.action({ type: "SET_ACTIVE_THREAD", threadId: "A" }); f.render()
  assert.equal(f.state().workspaceHints, null); f.action({ type: "SET_WORKSPACE_HINTS", view: old }); assert.equal(f.state().workspaceHints, null)
  f.send({ type: "thread.mutation.connection", state: "disconnected" }); assert.equal(f.state().workspaceHints, null)
})
function panel() {
  const sf = ts.createSourceFile("panel.tsx", fs.readFileSync(path.join(root, "components/CodingAgentPanel.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes: ts.Node[] = []; const walk = (n: ts.Node) => { nodes.push(n); ts.forEachChild(n, walk) }; walk(sf)
  const pick = nodes.find(n => ts.isVariableStatement(n) && n.getText(sf).startsWith("const pickWorkspace ="))!.getText(sf)
  const effect = nodes.find(n => ts.isExpressionStatement(n) && n.getText(sf).includes('chrome.runtime.onMessage.addListener(onMsg)'))!.getText(sf)
  const o = connected(); shell(o, "1", "/hint")
  const view = { current: o.view() }, selection = { current: { threadId: "A", revision: 1 } }, pending = { current: null as any }, autoStart = { current: true }, wires: any[] = [], paths: string[] = []; let listener: any
  const fn = compile(`export function install(){${pick};${effect};return pickWorkspace}`, { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn(), threadId: "A", open: true, effectiveWorkspace: null,
    state: { connectionState: "connected" }, hintViewRef: view, currentSelectionRef: selection, hintPickRef: pending, pendingStartAfterPickRef: autoStart, startingRef: { current: false },
    crypto: { randomUUID: () => "fixed" }, flash() {}, setPickError() {}, setStarting() {}, setLocalWorkspace: (p: string) => paths.push(p),
    chrome: { runtime: { lastError: null, sendMessage(msg: any, done: any) { wires.push(msg); done() }, onMessage: { addListener(fn: any) { listener = fn }, removeListener() {} } } } }).install()
  return { click: () => fn(o.view()!.rows[0]), wires, paths, selection, view, autoStart, reply: (overrides: any = {}) => listener({ type: "workspace.pick_result", request_id: "workspace-pick:fixed", thread_id: "A", path: "/actual/chosen", bound: true, ...overrides }) }
}
test("#726 actual Panel callback launches exactly one original picker only on explicit click", () => {
  const f = panel(); assert.equal(f.wires.length, 0); f.click(); assert.equal(f.wires.length, 1); assert.equal(f.wires[0].initial_path, "/hint"); assert.equal(f.autoStart.current, false)
  f.reply(); assert.deepEqual(f.paths, ["/actual/chosen"])
})
test("#726 actual Panel ignores wrong request/foreign/ABA/reconnected late replies", () => {
  for (const mode of ["request", "foreign", "ABA", "reconnect"]) { const f = panel(); f.click()
    if (mode === "ABA") f.selection.current.revision = 3
    if (mode === "reconnect") f.view.current = { ...f.view.current!, connection: {} }
    f.reply(mode === "request" ? { request_id: "old" } : mode === "foreign" ? { thread_id: "B" } : {})
    assert.equal(f.paths.length, 0, mode)
  }
})
test("#726 actual Panel JSX labels unbound evidence and has no bind/start handlers", () => {
  const sf = ts.createSourceFile("panel.tsx", fs.readFileSync(path.join(root, "components/CodingAgentPanel.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let block: ts.Node | undefined; const walk = (n: ts.Node) => { if (ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(sf) === "data-workspace-hints")) block = n; ts.forEachChild(n, walk) }; walk(sf); assert.ok(block)
  const calls: any[] = [], o = connected(); shell(o, "1", "/中文")
  const element = compile(`export function render(){return (${block!.getText(sf)})}`, { require: () => jsx, state: { workspaceHints: o.view() }, styles: {}, pickWorkspace: (hint: any) => calls.push(hint) }).render()
  assert.equal(calls.length, 0); element.props.children[1][0].props.onClick(); assert.equal(calls[0].path, "/中文")
})


test("#726 duplicate active IDs cannot assign old result to replacement declarations", () => {
  const o = connected()
  for (const command of ["cd /first", "cd /second"]) o.observe({ type: "tool.start", thread_id: "A", tool_name: "shell_exec", tool_call_id: "reused", params: { command } })
  o.observe({ type: "tool.result", thread_id: "A", tool_name: "shell_exec", tool_call_id: "reused", result: { success: true, data: { cwd: "/first-spawn", declared_cwd: "/second", exit_code: 0, timed_out: false, aborted: false } } })
  assert.equal(o.view()?.rows.length, 0)
})
test("#726 ALM path refused", () => assert.equal(workspaceHintPath("/safe\u061cdir"), null))
test("#726 C1 path refused", () => assert.equal(workspaceHintPath("/safe\u0085dir"), null))
test("#726 duplicate active-ID refusal remains bounded until actual selection/connection change", () => {
  const o = connected(); shell(o, "good", "/verified")
  for (const id of ["dup", "dup"]) o.observe({ type: "tool.start", thread_id: "A", tool_name: "shell_exec", tool_call_id: id, params: {} })
  shell(o, "later", "/not-collected"); assert.equal(o.view()?.rows.length, 1); assert.equal(o.view()?.rows[0].path, "/verified")
  o.select("B", 2); o.select("A", 3); shell(o, "new", "/new"); assert.equal(o.view()?.rows[0].path, "/new")
})
