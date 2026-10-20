// #480 actual canonical callback with inert server/auth/surface/owned-child seams; never native proof.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import ts from "typescript"
const filename = path.resolve(__dirname, "../../tests/desktop-native-windows-480.test.ts")
const title = "real Windows binding noninherited bootstrap and minimal parent handle authenticate native WebView2 and metadata"
function callbackSource() {
  const text = fs.readFileSync(filename, "utf8"), ast = ts.createSourceFile(filename, text, ts.ScriptTarget.ES2022, true)
  const statements = ast.statements.filter(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && ts.isStringLiteral(s.expression.arguments[0]) && s.expression.arguments[0].text === title)
  assert.equal(statements.length, 1)
  const fn = (statements[0] as ts.ExpressionStatement).expression as ts.CallExpression
  assert.ok(ts.isArrowFunction(fn.arguments[2])); return fn.arguments[2].getText(ast)
}
function harness(mode: string, body = callbackSource()) {
  const control = new AbortController(), events: string[] = [], diagnostics: any[] = []
  let subscriptions = 0, removals = 0, launched = 0, terminated = 0, exited = false, exitCallback: ((n: number) => void) | undefined, options: any, outcome = "pending", failure: any
  const signal = { get aborted() { return control.signal.aborted }, get reason() { return control.signal.reason },
    addEventListener(type: string, fn: any, opts: any) { if (type === "abort") subscriptions++; control.signal.addEventListener(type, fn, opts) },
    removeEventListener(type: string, fn: any) { if (type === "abort") removals++; control.signal.removeEventListener(type, fn) }, throwIfAborted() { control.signal.throwIfAborted() } }
  const emitExit = (code: number) => { if (!exited) { exited = true; exitCallback!(code) } }
  const ws = { send(raw: string) { assert.deepEqual(JSON.parse(raw), { type: "desktop.close" }); events.push("close-sent"); if (mode === "send-throw") throw Error("INERT_SEND_PRIMARY") }, terminate() { events.push("ws-terminate") } }
  class Wss extends EventEmitter { clients = new Set<any>(); close(fn: () => void) { events.push("wss-close"); fn() } }
  const channel = { wss: new Wss(), window: () => mode !== "window-refused" }; channel.wss.clients.add(ws)
  const server = { listen() {}, address: () => ({ port: 1 }), close(fn: () => void) { events.push("server-close"); fn() } }
  const binding = { launch(_binary: string, _cap: string, _secret: string, _endpoint: string, fn: (n: number) => void) {
    launched++; if (mode === "launch-throw") throw Error("INERT_LAUNCH_PRIMARY")
    exitCallback = fn; options.onAuthenticated("owned")
    if (mode !== "metadata-abort") { options.services.threads.desktopMetadataSnapshot(); options.services.skills.list(); options.services.skills.listKnowledge(); options.services.mcp.listServers() }
    return { terminate() { terminated++; events.push("terminate"); if (mode !== "closing-held") emitExit(1) } }
  } }
  const lease = { checkpoint() { control.signal.throwIfAborted() }, retain() { events.push("retain") }, settled() { events.push("settled") } }
  const fn = vm.runInNewContext(ts.transpileModule("(" + body + ")", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { Buffer, Set, Promise, Error, JSON, Number, Reflect, assert, path, native: "/INERT/desktop-native", DesktopIdentityRegistry: class { issue() { return { capabilityId: "INERT", secret: "INERT" } } }, WebSocketServer: Wss,
      http: { createServer: () => server }, once: async () => { if (mode === "preaborted") control.abort(Error("INERT_PREABORT")) },
      createDesktopChannel: (o: any) => { options = o; return channel }, attachDesktopUpgrade() {}, observeNativePhaseResponses() {}, nativePhaseNames: [], require: () => binding,
      fs: { existsSync: () => true, writeFileSync(fd: number, raw: string) { assert.equal(fd, 1); diagnostics.push(JSON.parse(raw.trim().slice("DESKTOP_480_NATIVE ".length))) } },
      withSurface650: async (t: any, action: any) => action(t, lease) })
  const done = fn({ signal }).then(() => { outcome = "resolved" }, (e: any) => { outcome = "rejected"; failure = e })
  return { done, abort: () => control.abort(Error("INERT_ABORT")), exit: emitExit,
    state: () => ({ subscriptions, removals, launched, terminated, outcome, failure, events: events.slice(), diagnostics: diagnostics.slice() }) }
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 30 && !condition(); i++) await Promise.resolve()
  assert.equal(condition(), true, "finite inert microtask schedule did not reach expected source boundary")
}
const primaryAbort = (h: ReturnType<typeof harness>) => { assert.equal(h.state().outcome, "rejected"); assert.match(h.state().failure.message, /Owned Windows native outer deadline/); assert.ok(h.state().events.includes("settled")); assert.equal(h.state().removals, 1) }
test("#480 normal metadata and real captured exit0 preserve assertions and remove owned abort listener", async () => {
  const h = harness("normal"); await until(() => h.state().events.includes("close-sent")); h.exit(0); await h.done
  assert.equal(h.state().outcome, "resolved"); assert.equal(h.state().subscriptions, 1); assert.equal(h.state().removals, 1); assert.ok(h.state().events.includes("settled"))
})
test("#480 metadata abort preserves failure and original terminate/exit/cleanup", async () => {
  const h = harness("metadata-abort"); await until(() => h.state().subscriptions === 1 && h.state().launched === 1); h.abort(); await until(() => h.state().outcome !== "pending"); await h.done; primaryAbort(h); assert.equal(h.state().terminated, 1)
})
test("#480 closing abort reaches original finally before a later unrelated exit", async () => {
  const h = harness("closing-held"); await until(() => h.state().events.includes("close-sent")); h.abort()
  try { await until(() => h.state().terminated === 1); assert.ok(h.state().events.includes("retain")); assert.equal(h.state().outcome, "pending") }
  finally { h.exit(1); await h.done }
  primaryAbort(h); assert.equal(h.state().diagnostics.find(x => x.reason === "deadline").phase, "closing")
})
test("#480 closing cancellation retains surface until exact owned exit and socket cleanup", async () => {
  const h = harness("closing-held"); await until(() => h.state().events.includes("close-sent")); h.abort()
  try { await until(() => h.state().terminated === 1); assert.equal(h.state().events.includes("settled"), false); assert.equal(h.state().events.includes("server-close"), false) }
  finally { h.exit(1); await h.done }
  primaryAbort(h); assert.ok(h.state().events.indexOf("server-close") < h.state().events.indexOf("settled"))
})
test("#480 already-aborted listening completion rejects before native launch and clears listener", async () => {
  const h = harness("preaborted"); await h.done; assert.equal(h.state().outcome, "rejected"); assert.equal(h.state().launched, 0); assert.equal(h.state().terminated, 0); assert.equal(h.state().removals, 1); assert.ok(h.state().events.includes("settled"))
})
for (const [mode, message] of [["launch-throw", "INERT_LAUNCH_PRIMARY"], ["send-throw", "INERT_SEND_PRIMARY"]]) test("#480 " + mode + " primary survives exact cleanup and listener retirement", async () => {
  const h = harness(mode); await h.done; assert.equal(h.state().outcome, "rejected"); assert.equal(h.state().failure.message, message); assert.equal(h.state().removals, 1); assert.ok(h.state().events.includes("settled")); assert.equal(h.state().terminated, mode === "launch-throw" ? 0 : 1)
})
test("#480 failed native window request remains a hard assertion with owned cleanup", async () => {
  const h = harness("window-refused"); await h.done; assert.equal(h.state().outcome, "rejected"); assert.equal(h.state().failure.code, "ERR_ASSERTION"); assert.equal(h.state().terminated, 1); assert.equal(h.state().removals, 1); assert.ok(h.state().events.includes("settled"))
})
