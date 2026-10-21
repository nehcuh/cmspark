// #650 diagnostic only: one independent cold child, never a replacement for old A/B.
import test from "node:test"
import vm from "node:vm"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
const FIXTURES = ["tests/fixtures", "companion/tests/fixtures"].find(p => existsSync(path.join(p, "computer-bg-read-boundary-650.ps1"))) ?? "tests/fixtures"
const ORIGINAL = path.join(FIXTURES, "computer-bg-read-boundary-650.ps1")
const WRAPPER = path.join(FIXTURES, "computer-bg-module-scope-650.ps1")
const ORIGINAL_SHA = "010598620920a759a60bc9adddade20b36a14adf756dcfe0587f4c4cc531ef19"
// Exact complete checkout transports only; the invoked original bytes are never normalized.
const ORIGINAL_CRLF_SHA = "adce869eca5d745e2f18504792491759814e861aa3941da3e89ce9a1051d454c"
const REPO = path.resolve(__dirname, "../../../..")
function childEnvironment(input: NodeJS.ProcessEnv, workspace: string, temporary: string): NodeJS.ProcessEnv {
  // Exact existing canonical implementation; import is inert unless that module is its own CLI.
  const canonical = require(path.join(REPO, "scripts/windows-census.mjs")) as { childEnvironment: (input: NodeJS.ProcessEnv, workspace: string, temporary: string) => NodeJS.ProcessEnv }
  return canonical.childEnvironment(input, workspace, temporary)
}
const CONTENT = "CMSPARK_650_OWNED_READ_V1"
const PHASES = ["ENTERED", "DIRECT_READ_ENTERED", "DIRECT_READ_RETURNED", "DISCOVERY_ENTERED", "DISCOVERY_RETURNED", "CMDLET_READ_ENTERED", "CMDLET_READ_RETURNED", "COMPLETE"]
const KEYS = ["full_language", "pshome_modules_exists", "psmodulepath_contains_pshome_modules", "windows_ps51"]
const SCOPE = "CMSPARK_MODULE_SCOPE_650:true"
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function observe(stdout: string, stderr: string) {
  const lines = stderr.split(/\r?\n/), phases: Array<{ phase: string; elapsed_ms: number }> = []
  let valid = lines.pop() === "", preflight: Record<string, boolean> | null = null
  const scope = lines.shift() === SCOPE
  for (const line of lines) {
    const m = /^CMSPARK_READ_BOUNDARY_650:([A-Z_]+):([0-9]{1,9})$/.exec(line)
    if (m) {
      const elapsed = Number(m[2])
      if (m[1] !== PHASES[phases.length] || (phases.length && elapsed < phases[phases.length - 1].elapsed_ms)) valid = false
      if (phases.length < PHASES.length && PHASES.includes(m[1])) phases.push({ phase: m[1], elapsed_ms: elapsed })
      else valid = false
    } else if (line.startsWith("CMSPARK_READ_PREFLIGHT_650:")) {
      try {
        const value = JSON.parse(line.slice("CMSPARK_READ_PREFLIGHT_650:".length))
        if (preflight !== null || phases.length !== 1 || !value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== KEYS.join(",") || KEYS.some(k => typeof value[k] !== "boolean")) valid = false
        else preflight = value
      } catch { valid = false }
    } else valid = false // Unknown text is rejected, never copied to the finite observation.
  }
  const expected = '{"version":1,"direct_read_match":true,"command_match":true,"cmdlet_read_match":true}'
  const receipt = stdout === expected + "\n" || stdout === expected + "\r\n"
  return { complete: valid && scope && preflight !== null && phases.length === 8 && receipt, scope_only_pshome: scope, phases, preflight, receipt }
}

function run(input: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ err: unknown; observation: ReturnType<typeof observe>; stdout_bytes: number; stderr_bytes: number; code: number | string | null; killed: boolean; signal: string | null }>(resolve => {
    execFile(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WRAPPER, "-InputPath", input],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, env },
      (err, stdout, stderr) => {
        const out = String(stdout || ""), diagnostic = String(stderr || "")
        let code: number | string | null = null, killed = false, signal: string | null = null
        // Diagnostic accessors must not replace the original callback outcome.
        try {
          if (err && typeof err === "object") {
            const value = (key: string) => Object.getOwnPropertyDescriptor(err, key)?.value
            const c = value("code"), s = value("signal")
            code = typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 255 ? c :
              typeof c === "string" && ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(c) ? c : null
            killed = value("killed") === true
            signal = s === "SIGTERM" || s === "SIGKILL" ? s : s == null ? null : "OTHER"
          }
        } catch { /* unavailable diagnostics never replace err/stdout/stderr */ }
        resolve({ err, observation: observe(out, diagnostic), stdout_bytes: Buffer.byteLength(out), stderr_bytes: Buffer.byteLength(diagnostic), code, killed, signal })
      })
  })
}
function requireComplete(result: Awaited<ReturnType<typeof run>>) {
  assert.ok(result.err === null, "scoped cold child must succeed; no command/error body in this assertion")
  assert.ok(result.observation.complete, "single scope marker and complete original content checks required")
}

// Generate fixtures from the real original PS outlets/format, not an imagined protocol.
function emittedFixture() {
  const source = readFileSync(ORIGINAL, "utf8")
  const literal = [...source.matchAll(/\[Console\]::Out\.WriteLine\('([^'\r\n]+)'\)/g)]
  assert.equal(literal.length, 1)
  const template = /'CMSPARK_READ_PREFLIGHT_650:([^'\r\n]+)'/.exec(source); assert.ok(template)
  const phases = [...source.matchAll(/^\s*Mark-ReadBoundary650 '([A-Z_]+)'/gm)].map(m => m[1])
  assert.deepEqual(phases, PHASES)
  const preflight = template[1].replace(/\{[0-3]\}/g, "true").replace(/\{\{/g, "{").replace(/\}\}/g, "}")
  const lines = PHASES.map((phase, i) => `CMSPARK_READ_BOUNDARY_650:${phase}:${i}`)
  lines.splice(1, 0, "CMSPARK_READ_PREFLIGHT_650:" + preflight)
  return { stdout: literal[0][1] + "\n", stderr: SCOPE + "\n" + lines.join("\n") + "\n" }
}

// Exact selected fields from official public artifact12102068647; source member SHA receipts preserved in implementation packet.
const ACTUAL_FAIL_BASELINE = JSON.parse("{\"identity\":{\"head\":\"6dc71dc3c057deddfb3285e25af462f1c9a3e852\",\"tree\":\"d3c86ded6c6d7ef9c6e9498e011e57b12ce80b96\",\"run\":\"39035617037\",\"attempt\":\"1\",\"namespace\":\"11b6b0db-9721-4932-b2db-6bc4370cf828\",\"platform\":\"win32\",\"arch\":\"x64\"},\"result\":{\"outcome\":\"FAIL\",\"error_code\":\"CENSUS_STAGE_FAILED\",\"raw_publish\":\"SEALED_CIPHERTEXT_ONLY\",\"raw_durability\":\"UPLOAD_AND_ROOT_RECOVERY_PENDING\",\"complete\":false,\"stages\":[{\"name\":\"install\",\"code\":0,\"signal\":null,\"spawn_error\":null,\"capture_error\":false},{\"name\":\"build\",\"code\":0,\"signal\":null,\"spawn_error\":null,\"capture_error\":false},{\"name\":\"stage\",\"code\":0,\"signal\":null,\"spawn_error\":null,\"capture_error\":false},{\"name\":\"tests\",\"code\":1,\"signal\":null,\"spawn_error\":null,\"capture_error\":false}],\"evidence\":{\"status\":{\"outcome\":\"FAIL\",\"complete\":false,\"capture_loss\":false,\"receipt_eof_complete\":true,\"missing_raw\":[]}}},\"accounting\":{\"complete\":false,\"execution_complete\":true,\"tests_exit\":1,\"outcome\":\"FAIL\"}}") as Record<string, any>

function registerCpuTests() {
test("#650 module scope CPU: real sealed FAIL is terminal; incomplete or mismatched documents refuse", () => {
  const original = ACTUAL_FAIL_BASELINE
  const expected = { head: original.identity.head, run: original.identity.run, attempt: original.identity.attempt }
  assert.equal(original.result.outcome, "FAIL"); assert.equal(terminalDocuments(original, expected), true)
  for (const mutate of [
    (v: any) => { delete v.identity }, (v: any) => { delete v.result }, (v: any) => { delete v.accounting },
    (v: any) => { v.identity.head = "0".repeat(40) }, (v: any) => { v.result.outcome = "INCOMPLETE" },
    (v: any) => { v.result.stages.pop() }, (v: any) => { v.result.stages[3].code = null },
    (v: any) => { v.result.stages[3].capture_error = true }, (v: any) => { v.result.stages[3].signal = "SIGTERM" },
    (v: any) => { v.result.evidence.status.capture_loss = true }, (v: any) => { v.result.evidence.status.receipt_eof_complete = false },
    (v: any) => { v.result.evidence.status.missing_raw.push("raw/tests.stdout") },
    (v: any) => { v.accounting.execution_complete = false }, (v: any) => { v.accounting.tests_exit = 0 },
    (v: any) => { v.result.evidence.status.outcome = "PASS" }, (v: any) => { v.result.raw_publish = "OTHER" },
  ]) { const value = structuredClone(original); mutate(value); assert.equal(terminalDocuments(value, expected), false) }
  assert.equal(original.result.outcome, "FAIL", "admission never changes the original verdict")
})
test("#650 module scope CPU: real finite public files stay immutable and changed bytes are detected", () => {
  const fs = require("node:fs") as typeof import("node:fs"), directory = mkdtempSync(path.join(tmpdir(), "cmspark-census-650-")), publicDir = path.join(directory, "public")
  try {
    fs.mkdirSync(publicDir)
    for (const [name, value] of Object.entries(ACTUAL_FAIL_BASELINE)) writeFileSync(path.join(publicDir, name + ".json"), JSON.stringify(value), { flag: "wx" })
    const expected = { head: ACTUAL_FAIL_BASELINE.identity.head, run: ACTUAL_FAIL_BASELINE.identity.run, attempt: ACTUAL_FAIL_BASELINE.identity.attempt }
    const admitted = readBaseline(publicDir, expected)
    assert.equal(admitted.outcome, "FAIL"); assert.equal(baselineUnchanged(admitted.snapshots), true)
    fs.appendFileSync(path.join(publicDir, "result.json"), " ")
    assert.equal(baselineUnchanged(admitted.snapshots), false)
    assert.throws(() => readBaseline("relative-owned-input", expected))
    fs.unlinkSync(path.join(publicDir, "accounting.json"))
    assert.throws(() => readBaseline(publicDir, expected))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test("#650 module scope CPU: actual standalone main preserves admitted FAIL and emits only finite observations", async t => {
  const fs = require("node:fs") as typeof import("node:fs"), child = require("node:child_process") as typeof import("node:child_process")
  const directory = mkdtempSync(path.join(tmpdir(), "cmspark-census-650-")), publicDir = path.join(directory, "public"), output: string[] = []
  const fixture = emittedFixture(), before = JSON.stringify(ACTUAL_FAIL_BASELINE)
  let primary: Error | null = null, calls = 0
  try {
    fs.mkdirSync(publicDir)
    for (const [name, value] of Object.entries(ACTUAL_FAIL_BASELINE)) writeFileSync(path.join(publicDir, name + ".json"), JSON.stringify(value), { flag: "wx" })
    t.mock.method(child, "execFile", (_command: string, _args: string[], _options: unknown, callback: Function) => { calls++; callback(primary, fixture.stdout, fixture.stderr); return {} })
    // Run the whole compiled producer with a VM-owned process view and inert child seam.
    // This is not execution of Windows, PowerShell, or its module-discovery implementation.
    const view = { platform: "win32", argv: [], env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows", GITHUB_SHA: ACTUAL_FAIL_BASELINE.identity.head, GITHUB_RUN_ID: ACTUAL_FAIL_BASELINE.identity.run, GITHUB_RUN_ATTEMPT: ACTUAL_FAIL_BASELINE.identity.attempt, PSModulePath: "OWNED_PARENT_NOT_PRINTED" } }
    const module = { exports: {} as { main: typeof main } }
    vm.runInNewContext(readFileSync(__filename, "utf8") + "\nmodule.exports = { main };", { require, module, exports: module.exports, __dirname, __filename, Buffer, process: view, console: { log: (line: string) => output.push(line) } })
    assert.equal(await module.exports.main(publicDir), 0)
    primary = new Error("OWNED_RAW_ERROR_NOT_PRINTED")
    assert.equal(await module.exports.main(publicDir), 1)
    assert.equal(calls, 2); assert.equal(output.length, 2)
    const records = output.map(line => { assert.ok(line.startsWith("MODULE_SCOPE_650 ")); return JSON.parse(line.slice("MODULE_SCOPE_650 ".length)) })
    assert.deepEqual(records.map(v => [v.state, v.baseline_outcome, v.baseline_unchanged]), [["PASS", "FAIL", true], ["FAIL", "FAIL", true]])
    assert.equal(output.join("\n").includes(directory), false)
    assert.doesNotMatch(output.join("\n"), /OWNED_PARENT_NOT_PRINTED|OWNED_RAW_ERROR_NOT_PRINTED|owned-read\.txt/)
    assert.equal(view.env.PSModulePath, "OWNED_PARENT_NOT_PRINTED")
    assert.equal(JSON.stringify(ACTUAL_FAIL_BASELINE), before)
    assert.equal(JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8")).outcome, "FAIL")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test("#650 module scope CPU: original discovery admits old test suffix but excludes standalone probe", () => {
  const source = readFileSync(path.join(REPO, "companion/scripts/run-tests.mjs"), "utf8")
  const from = source.indexOf("function walk("), to = source.indexOf("const discovered", from)
  assert.ok(from >= 0 && to > from)
  const names = ["computer-bg-module-scope-650.test.js", "computer-bg-read-boundary-650.test.js", "computer-bg-module-scope-650.probe.js"]
  const walk = vm.runInNewContext(source.slice(from, to) + "\nwalk", { path, fs: { existsSync: () => true, readdirSync: () => names.map(name => ({ name, isDirectory: () => false, isFile: () => true })) } }) as (root: string) => string[]
  const found = walk("OWNED_DATA")
  assert.ok(found.includes(path.join("OWNED_DATA", names[0])), "old unpublished route really entered canonical discovery")
  assert.ok(found.includes(path.join("OWNED_DATA", names[1])))
  assert.equal(found.includes(path.join("OWNED_DATA", names[2])), false, "standalone probe cannot precede baseline in canonical workers")
})
test("#650 module scope CPU: sole census-lane invocation follows its original seal/upload", () => {
  const source = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8")
  const marker = '      - name: "Post-census isolated module-scope diagnostic (#650)"'
  assert.equal(source.split(marker).length, 2)
  const start = source.indexOf(marker), end = source.indexOf("\n  acp-history-restart:", start)
  assert.ok(end > start, "the following independent job is outside this matrix step")
  const step = source.slice(start, end)
  assert.ok(source.indexOf('      - name: "Windows census finite public receipts (#650)"') < start)
  assert.ok(source.indexOf('      - name: "Windows native 8.3 filesystem paths (#604)"') < start)
  const nativeShortStep = source.slice(source.indexOf('      - name: "Windows native 8.3 filesystem paths (#604)"'), start)
  assert.match(nativeShortStep, /if: matrix\.os == 'windows-latest' && matrix\.lane != 'census'/, "the source-order sibling runs on the independent native desktop, not this census lane")
  assert.equal(step.match(/^      - name:/gm)?.length, 1, "nothing may follow this standalone diagnostic")
  assert.match(step, /if: \$\{\{ always\(\) && !cancelled\(\) && matrix\.os == 'windows-latest' && matrix\.lane == 'census' \}\}/)
  assert.match(step, /CMSPARK_650_FINISHED_PUBLIC_DIR: \$\{\{ steps\.windows-census\.outputs\.public_dir \}\}/)
  assert.match(step, /\$moduleScopeProbe650 = \[IO\.Path\]::Combine\(\$PWD\.Path, '\.test-dist\/tests\/fixtures\/computer-bg-module-scope-650\.probe\.js'\)/)
  assert.match(step, /\[IO\.File\]::Exists\(\$moduleScopeProbe650\)/)
  assert.match(step, /^\s+node "\$moduleScopeProbe650" "\$env:CMSPARK_650_FINISHED_PUBLIC_DIR"\r?$/m)
  assert.doesNotMatch(step, /continue-on-error|windows-census\.mjs|run-tests\.mjs|PSModulePath|retry|timeout/)
})
test("#650 module scope CPU: wrapper fixes only its process scope before the exact original sibling", () => {
  const source = readFileSync(WRAPPER, "utf8")
  assert.match(source, /param\(\[Parameter\(Mandatory=\$true\)\]\[string\]\$InputPath\)/)
  assert.match(source, /\[IO\.Path\]::Combine\(\$PSScriptRoot, 'computer-bg-read-boundary-650\.ps1'\)/)
  assert.match(source, /\[Environment\]::SetEnvironmentVariable\('PSModulePath', \$modules, \[EnvironmentVariableTarget\]::Process\)/)
  assert.match(source, /\[Console\]::Error\.WriteLine\('CMSPARK_MODULE_SCOPE_650:true'\)/)
  assert.match(source, /& \$original -InputPath \$InputPath\r?\nexit \$LASTEXITCODE/)
  assert.ok(source.indexOf("SetEnvironmentVariable") < source.indexOf(SCOPE) && source.indexOf(SCOPE) < source.indexOf("& $original"))
  assert.doesNotMatch(source, /QualifiedLookup|Import-Module|Get-Command|Get-Content|Start-Sleep|Add-Type|Write-Output/)
  assert.ok([ORIGINAL_SHA, ORIGINAL_CRLF_SHA].includes(sha(readFileSync(ORIGINAL))), "original diagnostic is an exact LF or CRLF checkout")
})
test("#650 module scope CPU: actual original outlets accept complete LF and CRLF only", () => {
  const v = emittedFixture()
  assert.equal(observe(v.stdout, v.stderr).complete, true)
  assert.equal(observe(v.stdout.replace(/\n/g, "\r\n"), v.stderr.replace(/\n/g, "\r\n")).complete, true)
})
test("#650 module scope CPU: malformed scope, unknown, duplicate and reordered observations refuse", () => {
  const v = emittedFixture()
  for (const bad of [v.stderr.replace(SCOPE, "CMSPARK_MODULE_SCOPE_650:false"), v.stderr.replace(SCOPE + "\n", ""),
    SCOPE + "\n" + v.stderr, v.stderr.replace(SCOPE, SCOPE + ":extra"), v.stderr.replace(SCOPE, SCOPE.toUpperCase()),
    v.stderr.replace("DISCOVERY_RETURNED:4", "DISCOVERY_RETURNED:0"), v.stderr.replace("CMDLET_READ_ENTERED", "UNKNOWN"),
    v.stderr.replace("COMPLETE:7\n", ""), v.stderr.replace('"windows_ps51":true', '"windows_ps51":"true"'),
    v.stderr.replace('"windows_ps51":true', '"windows_ps51":true,"extra":true'), v.stderr + "OWNED_PRIVATE_CANARY\n"]) {
    const result = observe(v.stdout, bad); assert.equal(result.complete, false)
    assert.equal(JSON.stringify(result).includes("OWNED_PRIVATE_CANARY"), false)
  }
  for (const bad of ["", v.stdout + v.stdout, v.stdout.replace('"command_match":true', '"command_match":false')]) assert.equal(observe(bad, v.stderr).complete, false)
})
test("#650 module scope CPU: actual adapter keeps argv, 15s and parent environment", async t => {
  const child = require("node:child_process") as typeof import("node:child_process"), fixture = emittedFixture(), parent = { SystemRoot: "OWNED_SYSTEM", PSModulePath: "OWNED_NOT_INHERITED", PROVIDER_KEY: "OWNED_NOT_INHERITED" }, env = childEnvironment(parent, REPO, "OWNED_TEMP")
  let calls = 0
  t.mock.method(child, "execFile", (command: string, args: string[], options: any, callback: Function) => {
    calls++; assert.equal(command, PS)
    assert.deepEqual(args, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WRAPPER, "-InputPath", "OWNED_NOT_EXECUTED"])
    assert.equal(options.timeout, 15000); assert.equal(options.windowsHide, true); assert.equal(options.encoding, "utf8")
    assert.equal(options.env, env)
    assert.equal(Object.keys(options.env).some(k => k.toUpperCase() === "PSMODULEPATH" || k === "PROVIDER_KEY"), false)
    assert.equal(options.env.SystemRoot, parent.SystemRoot)
    callback(null, fixture.stdout, fixture.stderr); return {}
  })
  requireComplete(await run("OWNED_NOT_EXECUTED", env)); assert.equal(calls, 1)
  assert.equal(parent.PSModulePath, "OWNED_NOT_INHERITED"); assert.equal(parent.PROVIDER_KEY, "OWNED_NOT_INHERITED")
})
test("#650 module scope CPU: nonzero child cannot pass even with complete observations", async t => {
  const child = require("node:child_process") as typeof import("node:child_process"), fixture = emittedFixture(), primary = new Error("OWNED_NOT_PRINTED")
  let calls = 0, getters = 0
  Object.defineProperty(primary, "code", { get() { getters++; throw Error("OWNED_GETTER_NOT_PRINTED") } })
  Object.assign(primary, { killed: true, signal: "SIGTERM" })
  t.mock.method(child, "execFile", (_command: string, _args: string[], _options: unknown, callback: Function) => { calls++; callback(primary, fixture.stdout, fixture.stderr); return {} })
  const result = await run("OWNED_NOT_EXECUTED", childEnvironment({}, REPO, "OWNED_TEMP"))
  assert.equal(result.err, primary); assert.equal(calls, 1)
  assert.equal(getters, 0); assert.equal(result.code, null); assert.equal(result.killed, true); assert.equal(result.signal, "SIGTERM")
  assert.throws(() => requireComplete(result), e => !String(e).includes("OWNED_NOT_PRINTED"))
})


}

type Snapshot = { file: string; bytes: Buffer; dev: bigint; ino: bigint; size: bigint }
function terminalDocuments(docs: Record<string, any>, expected: { head: string; run: string; attempt: string }) {
  try {
    const { identity, result, accounting } = docs, stages = result.stages
    if (identity.head !== expected.head || identity.run !== expected.run || identity.attempt !== expected.attempt || !/^[0-9a-f]{40}$/.test(identity.tree)) return false
    if (!["PASS", "FAIL"].includes(result.outcome) || result.raw_publish !== "SEALED_CIPHERTEXT_ONLY" || !Array.isArray(stages) || stages.length !== 4) return false
    if (stages.map((s: any) => s.name).join(",") !== "install,build,stage,tests") return false
    const last = stages[3]
    if (!Number.isInteger(last.code) || last.code < 0 || last.code > 255 || last.signal !== null || last.spawn_error !== null || last.capture_error !== false) return false
    if (stages.slice(0, 3).some((s: any) => s.code !== 0 || s.signal !== null || s.spawn_error !== null || s.capture_error !== false)) return false
    const seal = result.evidence?.status
    return accounting.execution_complete === true && accounting.tests_exit === last.code && accounting.outcome === result.outcome &&
      seal?.outcome === result.outcome && seal.capture_loss === false && seal.receipt_eof_complete === true && Array.isArray(seal.missing_raw) && seal.missing_raw.length === 0
  } catch { return false }
}
function readBaseline(publicInput: string, expected: { head: string; run: string; attempt: string }) {
  const fs = require("node:fs") as typeof import("node:fs")
  if (!path.isAbsolute(publicInput)) throw Error("BASELINE_INCOMPLETE")
  const publicDir = fs.realpathSync.native(publicInput), owned = path.dirname(publicDir), temporary = fs.realpathSync.native(tmpdir())
  if (path.basename(publicDir) !== "public" || !/^cmspark-census-650-[A-Za-z0-9]{6}$/.test(path.basename(owned)) || path.dirname(owned).toLowerCase() !== temporary.toLowerCase()) throw Error("BASELINE_INCOMPLETE")
  for (const directory of [publicInput, owned]) { const st = fs.lstatSync(directory); if (!st.isDirectory() || st.isSymbolicLink()) throw Error("BASELINE_INCOMPLETE") }
  const snapshots: Snapshot[] = [], docs: Record<string, unknown> = {}
  for (const [key, name] of [["identity", "identity.json"], ["result", "result.json"], ["accounting", "accounting.json"]]) {
    const file = path.join(publicDir, name), before = fs.lstatSync(file, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 16n * 1024n * 1024n) throw Error("BASELINE_INCOMPLETE")
    const bytes = fs.readFileSync(file), after = fs.lstatSync(file, { bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== Number(before.size)) throw Error("BASELINE_INCOMPLETE")
    docs[key] = JSON.parse(bytes.toString("utf8")); snapshots.push({ file, bytes, dev: before.dev, ino: before.ino, size: before.size })
  }
  if (!/^[0-9a-f]{40}$/.test(expected.head) || !/^[1-9][0-9]*$/.test(expected.run) || !/^[1-9][0-9]*$/.test(expected.attempt) || !terminalDocuments(docs, expected)) throw Error("BASELINE_INCOMPLETE")
  return { snapshots, outcome: (docs.result as any).outcome as "PASS" | "FAIL" }
}
function baselineUnchanged(snapshots: Snapshot[]) {
  try {
    return snapshots.every(s => { const st = lstatSync(s.file, { bigint: true }); return st.isFile() && !st.isSymbolicLink() && st.nlink === 1n && st.dev === s.dev && st.ino === s.ino && st.size === s.size && readFileSync(s.file).equals(s.bytes) })
  } catch { return false }
}
async function main(publicInput: string | undefined) {
  let state: "PASS" | "FAIL" | "INCOMPLETE" = "INCOMPLETE", reason = "BASELINE_INCOMPLETE"
  let baseline: ReturnType<typeof readBaseline> | undefined, finite: Record<string, unknown> = {}
  let directory: string | undefined, unchanged = false
  try {
    if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Windows" || !publicInput) throw Error("BASELINE_INCOMPLETE")
    baseline = readBaseline(publicInput, { head: process.env.GITHUB_SHA || "", run: process.env.GITHUB_RUN_ID || "", attempt: process.env.GITHUB_RUN_ATTEMPT || "" })
    const original = readFileSync(ORIGINAL), wrapper = readFileSync(WRAPPER)
    if (![ORIGINAL_SHA, ORIGINAL_CRLF_SHA].includes(sha(original))) throw Error("SOURCE_DRIFT")
    directory = mkdtempSync(path.join(tmpdir(), "cmspark-module-scope-650-"))
    const env = childEnvironment(process.env, REPO, directory), input = path.join(directory, "owned-read.txt")
    const parentModulePath = Object.keys(process.env).filter(k => k.toUpperCase() === "PSMODULEPATH").map(k => [k, process.env[k]])
    writeFileSync(input, CONTENT, { flag: "wx", mode: 0o600 }); const before = lstatSync(input, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw Error("SOURCE_DRIFT")
    const result = await run(input, env), { err, ...observation } = result
    finite = observation
    state = err === null && result.observation.complete ? "PASS" : "FAIL"; reason = err !== null ? "CHILD_FAILED" : result.observation.complete ? "NONE" : "RECEIPT_FAILED"
    const after = lstatSync(input, { bigint: true }), parentAfter = Object.keys(process.env).filter(k => k.toUpperCase() === "PSMODULEPATH").map(k => [k, process.env[k]])
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || readFileSync(input, "utf8") !== CONTENT || !readFileSync(ORIGINAL).equals(original) || !readFileSync(WRAPPER).equals(wrapper) || JSON.stringify(parentModulePath) !== JSON.stringify(parentAfter)) throw Error("SOURCE_DRIFT")
  } catch (error) { state = "INCOMPLETE"; reason = error instanceof Error && error.message === "SOURCE_DRIFT" ? "SOURCE_DRIFT" : "BASELINE_INCOMPLETE" }
  finally {
    if (directory) { try { rmSync(directory, { recursive: true, force: true }) } catch { state = "INCOMPLETE"; reason = "CLEANUP_FAILED" } }
    unchanged = baseline ? baselineUnchanged(baseline.snapshots) : false
    if (baseline && !unchanged) { state = "INCOMPLETE"; reason = "BASELINE_CHANGED" }
  }
  console.log("MODULE_SCOPE_650 " + JSON.stringify({ version: 1, state, reason, baseline_outcome: baseline?.outcome ?? "NOT_OBSERVED", baseline_unchanged: unchanged, ...finite }))
  return state === "PASS" ? 0 : 1
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--cpu-test") registerCpuTests()
  else if (process.argv.length === 3) void main(process.argv[2]).then(code => { process.exitCode = code }, () => { process.exitCode = 1 })
  else { console.log('MODULE_SCOPE_650 {"version":1,"state":"INCOMPLETE","reason":"ARGUMENTS"}'); process.exitCode = 1 }
}
