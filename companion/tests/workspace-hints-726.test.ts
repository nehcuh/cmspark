// Actual workspace.pick branch and whole native helper, with inert native/FS seams.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const src = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../src" : "../src")
function pickerCase() {
  const file = ts.createSourceFile("router.ts", fs.readFileSync(path.join(src, "message-router.ts"), "utf8"), ts.ScriptTarget.Latest, true)
  let found: ts.CaseClause | undefined
  function walk(n: ts.Node) { if (ts.isCaseClause(n) && n.expression.getText(file) === '"workspace.pick"') found = n; ts.forEachChild(n, walk) }
  walk(file); assert.ok(found)
  const exports: any = {}, calls: any[] = [], bindings: string[] = [], audits: any[] = []
  let thread: any = { id: "A" }, current = true, result: any = { path: "/actual/selected" }, during = () => {}
  const imports = { recordNativePick(p: string) { bindings.push("receipt:" + p) }, setWorkspaceRoot(p: string) { bindings.push(p); return { ok: true, path: p } } }
  const globals = { exports, WORKSPACE_FOLDER_PROMPT: "owned prompt", fs: { realpathSync: (p: string) => p }, path,
    pickFolderNativeImpl: async (...args: any[]) => { calls.push(args); during(); return result },
    threadManager: { get: () => thread, update: (_: string, patch: any) => Object.assign(thread, patch) },
    require: (id: string) => { if (id === "./packs/audit-log") return { appendCapabilityAudit: (event: any) => audits.push(event) }; assert.equal(id, "./capability/workspace"); return imports } }
  const body = found!.statements.map(s => s.getText(file)).join("\n")
  vm.runInNewContext(ts.transpileModule(`export async function dispatch(rest,session){${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, globals)
  return { calls, bindings, audits, run: (rest: any = {}) => exports.dispatch({ thread_id: "A", initial_path: "/hint", request_id: "pick:1", ...rest }, { originWs: {}, isCurrentSession: () => current }),
    result(v: any) { result = v }, during(fn: () => void) { during = fn }, stale() { current = false }, replace() { thread = { id: "A" } } }
}
test("#726 original picker receives only the hint; actual returned selection alone binds", async () => {
  const f = pickerCase(), r = await f.run()
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1], "/hint")
  assert.equal(r.request_id, "pick:1"); assert.equal(r.thread_id, "A"); assert.equal(r.path, "/actual/selected")
  assert.deepEqual(f.bindings, ["receipt:/actual/selected", "/actual/selected"])
  assert.equal(f.audits[0].source, "suggested-confirmed"); assert.equal(f.audits[0].type, "workspace.bound"); assert.equal("path" in f.audits[0], false)
})
test("#726 Cancel never binds, even though initial location was nonempty", async () => {
  const f = pickerCase(); f.result({ error: "cancelled" }); const r = await f.run()
  assert.equal(r.cancelled, true); assert.equal(f.bindings.length, 0)
})
test("#726 changed connection or same-ID thread object after dialog refuses all receipt/binding", async () => {
  for (const mode of ["stale", "replace"] as const) { const f = pickerCase(); f.during(() => f[mode]()); const r = await f.run(); assert.ok(r.error); assert.equal(f.bindings.length, 0) }
})
test("#726 hinted picker rejects missing owner/current session and malformed correlation before opening", async () => {
  for (const rest of [{ thread_id: "" }, { request_id: "bad!" }, { initial_path: "relative" }, { initial_path: "/a\n" }]) {
    const f = pickerCase(), r = await f.run(rest); assert.ok(r.error); assert.equal(f.calls.length, 0); assert.equal(f.bindings.length, 0)
  }
})
function nativeHelper(platform: string) {
  const calls: any[] = [], exports: any = {}; let cancel = false
  const child = async (exe: string, args: string[], options: any) => { calls.push({ exe, args, options }); if (cancel) throw { code: 3 }; return { stdout: "/actual/chosen/" } }
  const imports: any = { child_process: { execFile: {} }, util: { promisify: () => child }, fs: { existsSync: () => false, writeFileSync() {}, unlinkSync() {} }, os: { tmpdir: () => "/owned" }, path,
    "../platform": { isMacOS: () => platform === "darwin", isLinux: () => platform === "linux", isWindows: () => platform === "win32" }, "../process-path": { OSASCRIPT_BIN: "/inert/osascript" } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(src, "obsidian/folder-picker.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (id: string) => { assert.ok(Object.hasOwn(imports, id), id); return imports[id] }, Buffer, process: { pid: 1, env: {} } })
  return { exports, calls, cancel() { cancel = true } }
}
test("#726 Windows initial path is escaped literal and original OK guard/timeout/exit3 remain", async () => {
  const f = nativeHelper("win32"), script = f.exports.buildWindowsFolderPickScript("prompt", "C:\\a'b 中文")
  assert.ok(script.includes("$d.SelectedPath = 'C:\\a''b 中文'")); assert.match(script, /DialogResult\]::OK -and \$d.SelectedPath/)
  f.cancel(); assert.equal((await f.exports.pickFolderNative("prompt", "C:\\dir")).error, "cancelled"); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.timeout, 120000)
})
test("#726 macOS/Linux pre-navigation uses fixed original backends; no existence probe", async () => {
  const m = nativeHelper("darwin"); assert.equal((await m.exports.pickFolderNative("prompt", "/中文/a\"b")).path, "/actual/chosen")
  assert.ok(m.calls[0].args[1].includes('default location (POSIX file')); assert.equal(m.calls[0].options.timeout, 120000)
  const l = nativeHelper("linux"); await l.exports.pickFolderNative("prompt", "/中文/dir"); assert.ok(l.calls[0].args.includes("--filename=/中文/dir/"))
})
