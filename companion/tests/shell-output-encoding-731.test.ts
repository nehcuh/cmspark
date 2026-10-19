/** #731 actual shell module, inert child bytes; never starts a shell. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import * as ts from "typescript"

const root = path.basename(path.dirname(__dirname)) === ".test-dist" ? path.resolve(__dirname, "../..") : path.resolve(__dirname, "..")
const source = path.join(root, "src/capability/shell.ts")
const chinese = Buffer.from("中文🙂", "utf8")
// Fixed CP936 bytes for 中文, not a recording of the user's private command.
const cp936 = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
function fixture(policy = "confirm_per_command", enabled = true) {
  const child: any = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  child.pid = 31; child.exitCode = null; child.signalCode = null
  let kills = 0, now = 1000
  const spawnCalls: any[] = [], timers = new Map<number, () => void>(), intervals = new Map<number, () => void>(), audits: any[] = []
  let nextTimer = 0
  child.kill = () => { kills++; return true }
  const context: any = { Buffer, TextDecoder, console, AbortController,
    process: { platform: "win32", env: { PATH: "OWNED_INERT_PATH" }, cwd: () => "OWNED_CWD", kill: () => assert.fail("no real kill") },
    Date: class extends Date { static now() { return now } },
    setTimeout: (fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id }, clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: () => void) => { const id = ++nextTimer; intervals.set(id, fn); return id }, clearInterval: (id: number) => intervals.delete(id),
  }
  const dependencies: Record<string, any> = {
    child_process: { spawn: (...args: any[]) => { spawnCalls.push(args); return child } },
    fs, path, string_decoder: require("node:string_decoder"), util: require("node:util"),
    "./modules": { getModule: () => ({ policy, allowlist_commands: ["echo"] }), requireModule: () => enabled ? { ok: true } : { ok: false, error: "shell module disabled" } },
    "../packs/audit-log": { appendCapabilityAudit: (value: any) => audits.push(value) },
    "../user-env": { getUserEnvVars: () => ({}) }, "../process-path": { hardenPath: ({ pathEnv }: any) => pathEnv },
    "../pty/windows-tree": { killWindowsPtyTree: (_pid: number, fallback: () => void) => fallback() },
  }
  const module = { exports: {} as any }
  const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, reportDiagnostics: true })
  assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  vm.runInNewContext("(function(require,module,exports){" + compiled.outputText + "\n})", context, { filename: source })((id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), "undeclared source import " + id); return dependencies[id]
  }, module, module.exports)
  return { shell: module.exports as typeof import("../src/capability/shell"), child, spawnCalls, audits, timers, intervals,
    now: (value: number) => { now = value }, kills: () => kills,
    close: (code = 0) => { child.exitCode = code; child.emit("close", code, null) },
  }
}
async function bytes(stdout: Buffer[], stderr: Buffer[] = [], code = 0) {
  const f = fixture(), progress: any[] = []
  const p = f.shell.shellExec({ command: "echo 中文", runKey: "owned-731", onProgress: value => progress.push(value) })
  for (const b of stdout) { f.now(2000 + progress.length * 1000); f.child.stdout.emit("data", b) }
  for (const b of stderr) { f.now(50000 + progress.length * 1000); f.child.stderr.emit("data", b) }
  f.close(code); const result = await p
  assert.equal(f.spawnCalls.length, 1); assert.equal(f.spawnCalls[0][0], "echo 中文")
  assert.equal(f.spawnCalls[0][1].shell, true); assert.equal(f.spawnCalls[0][1].windowsHide, true)
  assert.equal(f.spawnCalls[0][1].env.PATH, "OWNED_INERT_PATH"); assert.equal(f.spawnCalls[0][1].env.CMSPARK_SHELL, "1")
  assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0); assert.equal(f.shell.listActiveShellRunIds().length, 0)
  assert.equal(f.audits.length, 1); assert.equal("stdout" in f.audits[0], false)
  return { result, progress, f }
}

test("731 valid UTF8 survives every stdout and stderr chunk boundary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-731-utf8-file-")), file = path.join(dir, "owned.txt")
  fs.writeFileSync(file, chinese)
  try {
    for (let i = 1; i < chinese.length; i++) {
      const { result, progress } = await bytes([chinese.subarray(0, i), chinese.subarray(i)], [chinese.subarray(0, i), chinese.subarray(i)])
      assert.equal(result.data.stdout, "中文🙂"); assert.equal(result.data.stderr, "中文🙂")
      for (const p of progress) assert.equal((p.stdout_tail + p.stderr_tail).includes("�"), false)
      assert.equal(result.data.note.includes("OUTPUT_ENCODING_UNDETERMINED"), false)
    }
    assert.equal(fs.readFileSync(file).equals(chinese), true, "pipe decoding must not mutate the valid UTF8 file")
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test("731 invalid CP936 bytes are explicitly undetermined, never guessed as UTF8 Chinese", async () => {
  const { result, progress } = await bytes([cp936])
  assert.match(result.data.note, /OUTPUT_ENCODING_UNDETERMINED.*stdout/)
  assert.notEqual(result.data.stdout, "中文"); assert.equal(result.success, true)
  assert.ok(progress.some(p => p.stdout_tail.includes("OUTPUT_ENCODING_UNDETERMINED")))
})
test("731 stderr encoding warning is independent from valid stdout", async () => {
  const { result, progress } = await bytes([Buffer.from("中文")], [cp936])
  assert.equal(result.data.stdout, "中文"); assert.match(result.data.note, /OUTPUT_ENCODING_UNDETERMINED.*stderr/)
  assert.ok(progress.some(p => p.stderr_tail.includes("OUTPUT_ENCODING_UNDETERMINED")))
  assert.equal(progress.at(-1).stdout_tail, "中文")
})
test("731 incomplete final UTF8 bytes flush with an explicit warning", async () => {
  const { result, progress } = await bytes([Buffer.from([0xe4, 0xb8])], [Buffer.from([0xf0, 0x9f])])
  assert.match(result.data.note, /OUTPUT_ENCODING_UNDETERMINED.*stdout.*stderr/)
  assert.match(progress.at(-1).stdout_tail, /OUTPUT_ENCODING_UNDETERMINED/)
  assert.match(progress.at(-1).stderr_tail, /OUTPUT_ENCODING_UNDETERMINED/)
})
test("731 mixed binary NUL output is not presented as confirmed text", async () => {
  const { result, progress } = await bytes([Buffer.from("ok\0中文")])
  assert.match(result.data.note, /OUTPUT_ENCODING_UNDETERMINED/)
  assert.ok(progress.some(p => p.stdout_tail.includes("OUTPUT_ENCODING_UNDETERMINED")))
})
test("731 literal Unicode replacement character remains valid UTF8", async () => {
  const { result } = await bytes([Buffer.from("真实�字符", "utf8")])
  assert.equal(result.data.stdout, "真实�字符"); assert.equal(result.data.note.includes("OUTPUT_ENCODING_UNDETERMINED"), false)
})
test("731 output cap, progress cap, nonzero exit and command bytes are retained", async () => {
  const { result, progress } = await bytes([Buffer.from("x".repeat(200010)), cp936], [Buffer.from("error")], 7)
  assert.equal(result.data.stdout, "x".repeat(200000)); assert.equal(result.data.stderr, "error")
  assert.equal(result.data.exit_code, 7); assert.equal(result.data.truncated, true); assert.equal(result.success, true)
  assert.match(result.data.note, /OUTPUT_ENCODING_UNDETERMINED/)
  for (const p of progress) { assert.ok(p.stdout_tail.length <= 2000); assert.ok(p.stderr_tail.length <= 2000) }
})
test("731 timeout and abort retain owned kill and partial-output results", async () => {
  for (const mode of ["timeout", "abort"] as const) {
    const f = fixture(), ac = new AbortController(), p = f.shell.shellExec({ command: "echo 中文", timeoutMs: 1000, signal: ac.signal })
    f.child.stdout.emit("data", Buffer.from("中文"))
    if (mode === "timeout") [...f.timers.values()][0]()
    else ac.abort()
    assert.equal(f.kills(), 1); f.close(); const r = await p
    assert.equal(r.success, true); assert.equal(r.data.exit_code, -1); assert.equal(r.data.stdout, "中文")
    assert.equal(r.data.timed_out, mode === "timeout"); assert.equal(r.data.aborted, mode === "abort")
    assert.equal(f.timers.size, 0); assert.equal(f.shell.listActiveShellRunIds().length, 0)
  }
})
test("731 module/policy/preabort refusals still prevent any spawn", async () => {
  const disabled = fixture("confirm_per_command", false); assert.equal((await disabled.shell.shellExec({ command: "echo hi" })).success, false); assert.equal(disabled.spawnCalls.length, 0)
  const denied = fixture("allowlist"); assert.equal((await denied.shell.shellExec({ command: "echo hi;bad" })).success, false); assert.equal(denied.spawnCalls.length, 0)
  const early = fixture(), ac = new AbortController(); ac.abort(); assert.equal((await early.shell.shellExec({ command: "echo hi", signal: ac.signal })).data.aborted, true); assert.equal(early.spawnCalls.length, 0)
})
