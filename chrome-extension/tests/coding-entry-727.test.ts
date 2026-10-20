// CPU React SSR + production JSX callbacks/App event effect, not a mounted whole
// App or browser. The actual store reducer verifies return-navigation memory.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import { agentReducer, initialState, selectCodingSession, codingSessionBelongsToThread } from "../src/sidepanel/store/agentStore"
import * as embedEntry from "../src/sidepanel/coding-handoff/embed-entry"
import { resolveFocusBandSlot, FOCUS_BAND_MAX_PX, FOCUS_BAND_PRIMARY_MAX_PX, FOCUS_BAND_SECONDARY_MAX_PX } from "../src/sidepanel/components/focus-band-priority"
const root = path.resolve(__dirname, "../../src/sidepanel")
function source(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
function one(sf: ts.SourceFile, predicate: (n: ts.Node) => boolean) {
  const rows: ts.Node[] = []; function visit(n: ts.Node) { if (predicate(n)) rows.push(n); ts.forEachChild(n, visit) }; visit(sf)
  assert.equal(rows.length, 1, "exact actual source node"); return rows[0].getText(sf)
}
function compile(code: string, globals: Record<string, unknown> = {}): any {
  const exports = {}; (vm.runInNewContext as any)(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require(name: string) { assert.equal(name, "react/jsx-runtime"); return jsxRuntime }, ...globals }, { timeout: 1000 }); return exports
}
const copy = compile(source("coding-handoff/copy.ts").text).codingHandoffCopy
function environment() {
  const eventBus = new EventTarget(), opens: boolean[] = [], seeds: unknown[] = []; let menuClosed = 0, commands = 0
  const app = source("App.tsx")
  const effect = one(app, n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(app) === "useEffect" && n.getText(app).includes('addEventListener("cmspark:open-coding-handoff"'))
  const globals = { codingHandoffCopy: copy, styles: {}, railStyles: {}, CustomEvent,
    window: eventBus, useEffect: (run: () => unknown) => run(), setCodingPanelOpen: (value: boolean) => opens.push(value), setCodingPanelSeed: (value: unknown) => seeds.push(value),
    closeMenu: () => { menuClosed++ }, codingSessionBelongsToThread,
    chrome: { runtime: { sendMessage: () => { commands++; throw Error("NO_EXECUTION_FROM_OPEN") } } } }
  compile(`export function install(){${effect}}`, globals).install()
  return { globals, opens, seeds, menuClosed: () => menuClosed, noCommands: () => assert.equal(commands, 0) }
}
for (const status of ["offered", "confirmed"]) test(`#722 actual ${status} Panel output area is waiting to start, not started`, () => {
  const panel = source("components/CodingAgentPanel.tsx")
  const live = one(panel, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(panel) === "live"))
  const region = one(panel, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(panel) === "data-agent-live-log"))
  const display = one(panel, n => ts.isFunctionDeclaration(n) && n.name?.text === "displayProgressTail")
  const render = compile(`${display}\nexport function render(session){${live};return(${region})}`, { codingHandoffCopy: copy, styles: {}, PROGRESS_TAIL_DISPLAY_LINES: 200, PROGRESS_TAIL_CLI_CHARS: 12000 }).render
  const html = renderToStaticMarkup(render({ state: status }))
  assert.ok(html.includes("待启动")); assert.equal(html.includes("已启动"), false)
})
test("#727 actual Chip open callback reaches the original App effect once, preserving session", () => {
  const f = environment(), chip = source("components/CodingSessionChip.tsx")
  const button = one(chip, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(chip) === "button" && n.children.some(c => c.getText(chip).includes("codingHandoffCopy.ctaOpenPanel")))
  const element = compile(`export function render(session,state){return(${button})}`, f.globals).render
  const session = { sessionId: "own", threadId: "A", agentId: "inert", state: "offered", updatedAt: 1 }, state = { activeThreadId: "A" }
  const before = JSON.stringify(session), actual = element(session, state)
  assert.ok(renderToStaticMarkup(actual).includes("打开")); actual.props.onClick()
  assert.deepEqual(f.opens, [true]); assert.equal(f.seeds[0], undefined); assert.equal(JSON.stringify(session), before)
  element(session, { activeThreadId: "B" }).props.onClick(); assert.equal(f.opens.length, 1)
  f.noCommands()
})
test("#727 actual More menu item opens only the panel through the existing event", () => {
  const f = environment(), rail = source("components/StatusRail.tsx")
  const button = one(rail, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(rail) === "button" && n.children.some(c => c.getText(rail).includes("codingHandoffCopy.productName")))
  const actual = compile(`export function render(){return(${button})}`, f.globals).render()
  assert.match(renderToStaticMarkup(actual), /role="menuitem"/); actual.props.onClick()
  assert.equal(f.menuClosed(), 1); assert.deepEqual(f.opens, [true]); f.noCommands()
})
test("#727 real EmptyState JSX includes both discovery hints without an execution handler", () => {
  const chat = source("components/ChatView.tsx")
  const hints = one(chat, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(chat) === "data-coding-entry-hints"))
  const actual = compile(`export function render(){return(${hints})}`, { styles: {}, codingHandoffCopy: copy }).render()
  const html = renderToStaticMarkup(actual)
  assert.ok(html.includes("/code 打开编程接力")); assert.ok(html.includes("消息悬浮")); assert.ok(html.includes("不会自动启动"))
  assert.equal(html.includes("button"), false)
})
test("#727 actual store retains the offered session on A-B-A return; priority budgets unchanged", () => {
  let state = agentReducer({ ...initialState, activeThreadId: "A" }, { type: "ACP_SESSION_EVENT", event: { session_id: "own", thread_id: "A", agent_id: "inert", state: "offered" } })
  const before = JSON.stringify(selectCodingSession(state)); assert.notStrictEqual(before, "null")
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "B" }); assert.equal(selectCodingSession(state), null)
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "A" }); assert.equal(JSON.stringify(selectCodingSession(state)), before)
  assert.equal(FOCUS_BAND_MAX_PX, 80); assert.ok(FOCUS_BAND_PRIMARY_MAX_PX <= 80); assert.ok(FOCUS_BAND_SECONDARY_MAX_PX <= 80)
  for (const [confirm, l2, expected] of [[true, false, "confirm"], [false, true, "l2_safety"]] as const) assert.equal(resolveFocusBandSlot({ hasPendingConfirm: confirm, hasL2Task: l2, l2AbortRequired: l2, hasFleetActivity: false, hasCodingSession: true, isBrowserContext: false }).primary, expected)
})
test("#722 actual Chip SSR preserves its already-shipped pending-start status and adds only open CTA", () => {
  const file = source("components/CodingSessionChip.tsx"), session = { sessionId: "own", threadId: "A", agentId: "inert", state: "offered", updatedAt: 1 }
  const store = { useAgentStore: () => ({ state: { activeThreadId: "A", codingSessionIdsByThread: { A: ["own"] }, codingSessionsById: { own: session } }, dispatch() {} }), codingSessionBelongsToThread, selectCodingOperationError: () => null, selectCodingManualEntry: () => null }
  const component = compile(file.text, { require(id: string) {
    if (id === "react") return React
    if (id === "react/jsx-runtime") return jsxRuntime
    if (id === "../ui/tokens") return { tokens: {} }
    if (id === "../coding-handoff/copy") return { codingHandoffCopy: copy }
    if (id === "../coding-handoff/embed-entry") return embedEntry
    if (id === "../store/agentStore") return store
    if (id === "../hooks/useCodingStop") return { useCodingStop: () => ({ stop() {}, pending: false }) }
    if (id === "../utils/coding-operation-send") return { sendCodingOperation: () => { throw Error("NO_ACTION_FROM_RENDER") } }
    throw Error("UNADMITTED_COMPONENT_IMPORT")
  } }).CodingSessionChip
  const html = renderToStaticMarkup(React.createElement(component, { session }))
  assert.ok(html.includes("待启动")); assert.ok(html.includes("打开")); assert.equal(html.includes("运行中"), false)
})

function terminalView() {
  const sf = ts.createSourceFile("TerminalApp.tsx", fs.readFileSync(path.resolve(root, "../terminal/TerminalApp.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const receive = one(sf, n => ts.isCallExpression(n) && n.expression.getText(sf) === "port.onMessage.addListener")
  const callback = receive.slice(receive.indexOf("(") + 1, receive.lastIndexOf(")"))
  const heading = one(sf, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "strong")
  const wire = compile(fs.readFileSync(path.resolve(root, "../terminal/wire.ts"), "utf8"), { TextEncoder, atob, btoa })
  const ui: { status: string; kind: string | null; tail: string } = { status: "connecting", kind: null, tail: "" }
  const frameReceiver = compile(`export function create(){let sessionEnded=false,opened=false,ready=false,pendingResize=null;const sessionId='owned';return ${callback}}`, {
    clearTimeout() {}, clearInterval() {}, watchdog: 1, pingTimer: 1,
    setStatus: (value: string) => { ui.status = value }, setLaunchKind: (value: string | null) => { ui.kind = value },
    setDetail() {}, setReportStatus() {}, setSubmitting() {}, setReviewPrompt() {},
    setTail: (value: string) => { ui.tail = value },
    fit: { fit() {} }, send() {}, subData: { dispose() {} },
    term: { cols: 80, rows: 24, focus() {}, write(_bytes: unknown, done: () => void) { done() } },
    terminalB64Decode: wire.terminalB64Decode,
  }).create()
  const render = compile(`export function heading(status,launchKind){return(${heading})}`, { terminalLaunchLabel: wire.terminalLaunchLabel }).heading
  return { ui, receive: (raw: unknown) => frameReceiver(wire.parseTerminalServerFrame(raw)), html: () => renderToStaticMarkup(render(ui.status, ui.kind)) }
}
for (const kind of ["local_shell", "embedded_agent"]) test(`#724 actual TerminalApp opened callback and heading expose only ${kind} source`, () => {
  const f = terminalView()
  f.receive({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: kind })
  assert.equal(f.ui.status, "running"); assert.equal(f.ui.kind, kind)
  assert.ok(f.html().includes(kind === "local_shell" ? "非编程 Agent" : "核实"))
  assert.equal(f.html().includes("正在运行"), false)
})
test("#724 actual TerminalApp keeps legacy/foreign/ended launch source honest", () => {
  const f = terminalView()
  f.receive({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: "FORGED" })
  assert.equal(f.ui.kind, null); assert.ok(f.html().includes("未知"))
  f.receive({ type: "terminal.opened", id: "foreign", platform: "win32", launch_kind: "embedded_agent" })
  assert.equal(f.ui.kind, null)
  f.receive({ type: "terminal.closed", id: "owned" })
  f.receive({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: "embedded_agent" })
  assert.equal(f.ui.status, "closed"); assert.equal(f.ui.kind, null)
})
test("#724 actual failed open cannot later claim an Agent launch source", () => {
  const f = terminalView()
  f.receive({ type: "terminal.error", id: "owned", code: "request_failed", error: "inert refusal" })
  f.receive({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: "embedded_agent" })
  assert.equal(f.ui.status, "error"); assert.equal(f.ui.kind, null)
  assert.equal(f.html().includes("内嵌 Agent 启动来源"), false)
})


test("#725 actual extracted TerminalApp callback clears received tail on retirement and rejects late revival", () => {
  const actual = JSON.parse(fs.readFileSync(path.resolve(root, "../../tests/fixtures/terminal-tail-725.json"), "utf8"))
  for (const retirement of [
    { type: "terminal.closed", id: "owned" },
    { type: "terminal.error", id: "owned", code: "disconnected", error: "connection lost" },
  ]) {
    const f = terminalView()
    f.receive({ type: "terminal.opened", id: "owned", platform: "win32", launch_kind: "embedded_agent" })
    f.receive({ ...actual, id: "owned" })
    assert.equal(f.ui.tail, actual.result.data.text, "the actual current-session callback stores the producer-recorded text")
    f.receive({ ...retirement, id: "foreign" })
    assert.equal(f.ui.tail, actual.result.data.text, "foreign retirement must not change the current excerpt")
    f.receive(retirement)
    assert.equal(f.ui.status, "closed")
    assert.equal(f.ui.tail, "", "retirement invokes the real state reset, not a no-op setter")
    f.receive({ ...actual, id: "owned" })
    assert.equal(f.ui.tail, "", "late tail frames cannot revive an ended session")
  }
})
