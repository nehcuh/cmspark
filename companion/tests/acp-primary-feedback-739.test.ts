/** Actual manager -> handler -> operation matcher -> reducer, with inert children.
 * No backend server, browser, provider or native process is started. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const scope = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../.." : "..")
const repo = path.dirname(scope)
function fixture() {
  const cache = new Map<string, { exports: any }>(), jsx = (type: unknown, props: unknown) => ({ type, props })
  const chrome = { runtime: { sendMessage(_message: unknown, cb: (r: unknown) => void) { cb({ ok: true }) } } }
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file)!.exports
    const module = { exports: {} }; cache.set(file, module)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, __dirname: path.dirname(file), Buffer, TextEncoder, console, chrome,
      require(name: string) {
        if (name === "react") return { createContext: (value: unknown) => ({ value }), useContext() { throw Error("NO_REACT_RUNTIME") }, useReducer() { throw Error("NO_REACT_RUNTIME") } }
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
        if (name.startsWith("node:")) return require(name)
        assert(name.startsWith("."), "UNADMITTED_UI_IMPORT")
        const p = path.resolve(path.dirname(file), name), target = [".ts", ".tsx", "/index.ts"].map(x => p + x).find(x => fs.existsSync(x))
        assert(target); assert(target.startsWith(path.join(repo, "chrome-extension", "src") + path.sep)); return load(target)
      },
    }, { filename: file, timeout: 3000 })
    return module.exports
  }
  const ui = load(repo + "/chrome-extension/src/sidepanel/store/agentStore.tsx")
  const ops = load(repo + "/chrome-extension/src/sidepanel/utils/coding-operation-send.ts")
  const file = scope + "/tests/acp-bounded-n-739.test.ts", module: { exports: any } = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, "utf8") + "\nexports.actualFixture=fixture;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => name === "node:test" ? () => {} : name === "typescript" ? ts : require(name),
    __dirname: scope + "/.test-dist/tests", Buffer, process, console, AbortController, setTimeout, clearTimeout,
  }, { filename: file, timeout: 3000 })
  const backend = module.exports.actualFixture(1)
  let state = ui.agentReducer(ui.initialState, { type: "SET_ACTIVE_THREAD", threadId: "owner" })
  const dispatch = (action: any) => { state = ui.agentReducer(state, action) }
  backend.manager.onEvent((event: unknown) => dispatch({ type: "ACP_SESSION_EVENT", event }))
  return { ui, ops, backend, dispatch, state: () => state }
}

for (const mode of ["current-denied", "current-accepted", "thread-ABA", "selection-ABA", "dismissed", "foreign-reply"]) {
  test(`#739 actual primary feedback after its offered event: ${mode}`, async () => {
    const f = fixture(), handler = f.backend.handlers(), capture = f.ops.captureCodingSelection(f.state())
    assert.equal(f.ops.sendCodingOperation({ sessionId: "", threadId: "owner" }, f.dispatch,
      { type: "acp.ui_start", agent_id: "A", goal: "inert", cloud_disclosure_accepted: true }, capture), true)
    let decide!: (v: { approved: boolean }) => void
    const pending = handler("acp.ui_start", { thread_id: "owner", agent_id: "A", goal: "inert", cloud_disclosure_accepted: true },
      { threadId: "owner", requestConfirmation: () => new Promise(resolve => { decide = resolve }) })
    const offeredId = f.state().codingSessionIdByThread.owner
    assert.equal(typeof offeredId, "string"); assert.equal(typeof decide, "function")
    if (mode === "thread-ABA") for (const threadId of ["other", "owner"]) f.dispatch({ type: "SET_ACTIVE_THREAD", threadId })
    if (mode === "selection-ABA") {
      f.dispatch({ type: "ACP_SESSION_EVENT", event: { session_id: "sibling", thread_id: "owner", state: "offered" } })
      for (const sessionId of ["sibling", offeredId]) f.dispatch({ type: "ACP_SELECT_SESSION", threadId: "owner", sessionId, threadRevision: f.state().activeThreadSelectionRevision })
    }
    if (mode === "dismissed") f.dispatch({ type: "CLEAR_CODING_SESSION", sessionId: offeredId })
    decide({ approved: mode === "current-accepted" })
    const reply = await pending
    if (mode === "foreign-reply") assert.equal(f.ops.takeCodingOperationReply({ ...reply, thread_id: "foreign" }), null)
    const action = f.ops.takeCodingOperationReply(reply); assert.ok(action)
    const before = f.state(); f.dispatch(action)
    if (["thread-ABA", "selection-ABA", "dismissed"].includes(mode)) assert.equal(f.state(), before, "late feedback must not borrow the new view")
    else if (mode === "current-accepted") {
      assert.equal(reply.type, "acp.ui_start.accepted"); assert.equal(f.state().codingSessionIdByThread.owner, reply.session_id)
      assert.equal(f.ops.takeCodingOperationReply(reply), null, "reply consumed once")
    } else assert.equal(f.state().processingStatus, reply.error, "own offered event must not hide the real refusal")
    for (const child of f.backend.children) f.backend.close(child)
    assert.equal(f.backend.children.length, mode === "current-accepted" ? 1 : 0)
  })
}
