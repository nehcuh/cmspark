import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { attachCockpitNativeBridge } from "../src/cockpit/native-bridge"
import { COCKPIT_NATIVE_PORT } from "../src/shared/cockpit-native-bridge"

// Execute the actual Boot effect callback. This is neither a React mount nor
// a replacement hook/DOM, and the real document helper receives no native bind.
const filename = path.resolve(__dirname, "../../src/cockpit/CockpitApp.tsx")
const bytes = fs.readFileSync(filename, "utf8")
const source = ts.createSourceFile(filename, bytes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const boot = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "CockpitBoot")
assert.equal(boot.length, 1)
const effects: ts.ArrowFunction[] = []
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect") {
    const callback = node.arguments[0]
    assert.ok(ts.isArrowFunction(callback))
    if (!ts.isArrowFunction(callback)) throw Error("actual Boot effect must be an arrow")
    effects.push(callback)
  }
  ts.forEachChild(node, visit)
}
visit(boot[0]); assert.equal(effects.length, 1)
const code = ts.transpileModule(`module.exports = (${effects[0].getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function port(failRemove = false) {
  const messages = new Set<(v: unknown) => void>(), disconnects = new Set<() => void>()
  let closed = 0
  return { closed: () => closed, api: {
    onMessage: { addListener: (f: (v: unknown) => void) => messages.add(f), removeListener: (f: (v: unknown) => void) => { if (failRemove) throw Error("owned cleanup fault"); messages.delete(f) } },
    onDisconnect: { addListener: (f: () => void) => disconnects.add(f), removeListener: (f: () => void) => disconnects.delete(f) },
    postMessage() {}, disconnect() { closed++; for (const f of [...disconnects]) f() },
  } }
}
function setup(mode: "native-connect-fails" | "log-connect-fails" | "native-cleanup-fails" | "ok") {
  const log = port(), native = port(mode === "native-cleanup-fails"), names: string[] = [], messages: string[] = []
  let nativeHostEffects = 0
  const sandbox = { module: { exports: {} }, attachCockpitNativeBridge, COCKPIT_NATIVE_PORT, dispatch() {},
    chrome: { runtime: { lastError: undefined, connect({ name }: { name: string }) {
      names.push(name)
      if (name === "cmspark-cockpit") { if (mode === "log-connect-fails") throw Error("original log failure"); return log.api }
      assert.equal(name, COCKPIT_NATIVE_PORT)
      if (mode === "native-connect-fails") throw Error("optional native runtime failure")
      return native.api
    }, sendMessage(value: { type: string }, callback: (value: object) => void) { messages.push(value.type); callback({ ok: true }) },
    connectNative() { nativeHostEffects++; throw Error("unexpected native effect") } } } }
  const effect = vm.runInNewContext(code, sandbox) ?? sandbox.module.exports
  // CommonJS assignment returns its value, independently verify the export.
  assert.equal(effect, sandbox.module.exports); assert.equal(typeof effect, "function")
  return { effect: effect as () => () => void, log, native, names, messages, nativeHostEffects: () => nativeHostEffects }
}

test("optional native connect failure preserves original hydration and log cleanup", () => {
  const s = setup("native-connect-fails")
  let cleanup: (() => void) | undefined
  let threw = false, caught: unknown
  try { cleanup = s.effect() } catch (error) { threw = true; caught = error }
  assert.equal(threw, false); assert.equal(caught, undefined)
  assert.deepEqual(s.messages, ["cockpit.hydrate"])
  assert.deepEqual(s.names, ["cmspark-cockpit", COCKPIT_NATIVE_PORT])
  assert.equal(typeof cleanup, "function"); cleanup!()
  assert.equal(s.log.closed(), 1); assert.equal(s.nativeHostEffects(), 0)
})
test("optional native cleanup failure cannot suppress original log cleanup", () => {
  const s = setup("native-cleanup-fails"), cleanup = s.effect()
  assert.deepEqual(s.messages, ["cockpit.hydrate"])
  let threw = false, caught: unknown
  try { cleanup() } catch (error) { threw = true; caught = error }
  assert.equal(threw, false); assert.equal(caught, undefined)
  assert.equal(s.log.closed(), 1); assert.equal(s.native.closed(), 1); assert.equal(s.nativeHostEffects(), 0)
})
test("normal Boot keeps both runtime lifetimes and original log-connect refusal", () => {
  const s = setup("ok"), cleanup = s.effect(); cleanup()
  assert.equal(s.log.closed(), 1); assert.equal(s.native.closed(), 1); assert.deepEqual(s.messages, ["cockpit.hydrate"])
  const original = setup("log-connect-fails")
  let threw = false, caught: unknown
  try { original.effect() } catch (error) { threw = true; caught = error }
  assert.equal(threw, true); assert.equal(caught instanceof Error, true)
  if (!(caught instanceof Error)) throw Error("original log refusal must remain an Error")
  assert.match(caught.message, /original log failure/)
  assert.deepEqual(original.names, ["cmspark-cockpit"]); assert.deepEqual(original.messages, [])
})
