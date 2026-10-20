// Whole test-only coordinator, no native/child process/provider/browser execution.
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
const file = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests/helpers/picker-controller-726.cjs" : "helpers/picker-controller-726.cjs")
const moduleObject = { exports: {} as any }; vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: moduleObject.exports, queueMicrotask })
function fixture() {
  const child: any = new EventEmitter(); child.pid = 31; child.exitCode = null; child.signalCode = null
  const signal = new AbortController(); let callback: any, registerResolve: any, stopped = false, invokeCount = 0
  let row: any = { owner: child, pid: 31, path: "C:\\owned\\中文", unique: true, visible: true, current: true }
  const native = { subscribe(_child: any, onChange: any) { callback = onChange; return new Promise(resolve => { registerResolve = () => resolve(() => { callback = null }) }) },
    snapshot: async () => row, invoke: async (r: any) => { invokeCount++; return r }, stop: async () => { stopped = true } }
  const controller = moduleObject.exports.controlPicker726({ child, native, expectedPath: row.path, mode: "ok", signal: signal.signal })
  controller.done.catch(() => {})
  return { child, signal, controller, native, row: (v: any) => { row = v }, getRow: () => row, register: () => registerResolve(), event: () => callback?.(), invoked: () => invokeCount, stopped: () => stopped,
    close() { child.exitCode = 0; child.emit("close") } }
}
test("726 native coordinator registers then snapshots exact owner; original positive once", async () => {
  const f = fixture(); assert.equal(f.invoked(), 0); f.register(); await f.controller.ready
  assert.equal((await f.controller.done).ownedModalAction, true); assert.equal(f.invoked(), 1); f.close(); await f.controller.dispose(); assert.equal(f.stopped(), true)
})
test("726 opened-before-registration is caught by snapshot; simultaneous event never double invokes", async () => {
  const f = fixture(); f.event(); f.register(); await f.controller.ready; await f.controller.done; assert.equal(f.invoked(), 1); f.close(); await f.controller.dispose()
})
test("726 foreign owner/PID/ambiguous/invisible/stale modal never invokes", async () => {
  for (const delta of [{ owner: {} }, { pid: 99 }, { unique: false }, { visible: false }, { current: false }]) {
    const f = fixture(); f.row({ ...f.getRow(), ...delta }); f.register(); await f.controller.ready; await assert.rejects(f.controller.done); assert.equal(f.invoked(), 0); f.close(); await f.controller.dispose()
  }
})
test("726 abort while subscription pending does not launch late action", async () => {
  const f = fixture(); f.signal.abort(); f.register(); await f.controller.ready; await assert.rejects(f.controller.done); assert.equal(f.invoked(), 0); f.close(); await f.controller.dispose()
})
test("726 terminate request without actual child close refuses cleanup", async () => {
  const f = fixture(); f.register(); await f.controller.ready; await f.controller.done; await assert.rejects(f.controller.dispose(), /CHILD_CLOSE_UNKNOWN/); assert.equal(f.stopped(), true); f.close()
})

test("726 actual child close during native confirmation is not a false early-close", async () => {
  const f = fixture(); f.native.invoke = async (row: any) => { f.close(); return row }; f.register(); await f.controller.ready
  assert.equal((await f.controller.done).ownedModalAction, true); await f.controller.dispose()
})

// Extract the real remote-only admission function, not a second implementation.
test("726 remote callback admission refuses local/manual/foreign preload before native access", async () => {
  const ts = require("typescript") as typeof import("typescript")
  const nativeFile = path.join(path.dirname(file), "../workspace-picker-windows-native-726.test.ts")
  const source = fs.readFileSync(nativeFile, "utf8"), ast = ts.createSourceFile(nativeFile, source, ts.ScriptTarget.Latest, true)
  const admission = ast.statements.find((node): node is import("typescript").FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "admission")!
  assert.ok(admission)
  const compiled = ts.transpileModule(admission.getText(ast) + "\nexports.admission = admission", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const valid = { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows", CMSPARK_TEST_RUN_DIR: "C:\\owned", CMSPARK_DATA_DIR: "C:\\owned\\data" }
  for (const delta of [{ platform: "darwin", env: valid }, { platform: "win32", env: {} }, { platform: "win32", env: { ...valid, RUNNER_OS: "Linux" } }, { platform: "win32", env: { ...valid, CMSPARK_DATA_DIR: "relative" } }]) {
    const loaded = { exports: {} as any }; let access = 0
    vm.runInNewContext(compiled, { exports: loaded.exports, process: delta, assert, path: path.win32, fs: new Proxy({}, { get() { access++; throw Error("unexpected fs") } }) })
    assert.throws(() => loaded.exports.admission()); assert.equal(access, 0)
  }
  const positive = { exports: {} as any }, physical = { dev: 1n, ino: 2n, isDirectory: () => true, isSymbolicLink: () => false }
  vm.runInNewContext(compiled, { exports: positive.exports, process: { platform: "win32", env: valid }, assert, path: path.win32, fs: { lstatSync: () => physical, realpathSync: (p: string) => p, statSync: () => physical } })
  assert.equal(positive.exports.admission(), valid.CMSPARK_DATA_DIR)
  for (const wrong of ["foreign", "link", "identity"]) {
    const loaded = { exports: {} as any }, row = { dev: 1n, ino: 2n, isDirectory: () => true, isSymbolicLink: () => wrong === "link" }
    vm.runInNewContext(compiled, { exports: loaded.exports, process: { platform: "win32", env: { ...valid, ...(wrong === "foreign" ? { CMSPARK_DATA_DIR: "C:\\foreign" } : {}) } }, assert, path: path.win32, fs: { lstatSync: () => row, realpathSync: (p: string) => p, statSync: () => ({ ...row, ino: wrong === "identity" ? 3n : 2n }) } })
    assert.throws(() => loaded.exports.admission())
  }
})


test("726 successful native receipt during exit-before-close window remains valid", async () => {
  const f = fixture()
  f.native.invoke = async (row: any) => {
    f.child.exitCode = 0; f.child.emit("exit", 0, null); return row
  }
  f.register(); await f.controller.ready
  assert.equal((await f.controller.done).ownedModalAction, true)
  assert.equal(f.child.listenerCount("close") > 0, true)
  f.close(); await f.controller.dispose()
})
