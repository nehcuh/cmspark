import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { createWindowsJobPhaseDiagnostics, observeWindowsJobPhases, quoteWindowsJobPhaseLiteral, WINDOWS_JOB_PHASES } from "./fixtures/windows-job-phase-diagnostics"
import { spawnWindowsJob } from "../src/process/windows-job"
import { windowsJobOwner } from "../src/process/windows-owner"
import { windowsPowerShellExePath } from "../src/acp/win-spawn"

const cp: typeof import("node:child_process") = require("node:child_process")
const shim = require("cross-spawn")
const encode = (value: string) => Buffer.from(value, "utf16le").toString("base64")
const decode = (args: unknown[]) => Buffer.from((args[1] as string[])[4], "base64").toString("utf16le")
const fileName = "windows-job-phases-650.jsonl"
const records = () => WINDOWS_JOB_PHASES.map((phase, index) => ({ phase, elapsed_ms: index * 10 }))
const body = (value: unknown[]) => value.map(row => JSON.stringify(row)).join("\n") + "\n"
function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-phase-650-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, file: path.join(root, fileName) }
}
function actualJobArgs(t: any): unknown[] {
  let args: unknown[] | undefined
  t.mock.getter(windowsJobOwner, "created", () => "123456789")
  t.mock.method(shim, "_parse", (command: string, argv: string[], options: unknown) => ({ command, file: command, args: argv, options }))
  t.mock.method(cp, "spawn", (...value: unknown[]) => { args = value; return new EventEmitter() as any })
  spawnWindowsJob(process.execPath, ["owned spaced & 中文.cjs", "x\"y", "末尾\\"], { env: { CMSPARK_INERT_VALUE: "literal" }, stdio: "pipe" })
  assert.ok(args)
  return args
}

test("actual public bootstrap gains only four ordered file observations and retains all original program bytes", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root)
  const original = actualJobArgs(t), source = decode(original), decorated = phases.decorateSpawnArgs(original), script = decode(decorated)
  assert.equal(original[0], windowsPowerShellExePath())
  assert.ok(source.includes("; Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition @\'\n"), "the actual first cmdlet is pinned to the standard Utility module before compilation")
  assert.equal(decorated[0], original[0]); assert.equal(decorated[2], original[2])
  assert.deepEqual((decorated[1] as string[]).slice(0, 4), (original[1] as string[]).slice(0, 4))
  assert.ok(String(decorated[0]).length + (decorated[1] as string[]).reduce((total, value) => total + value.length + 3, 0) < 32767, "this actual fixture's added observation stays within CreateProcess argv capacity")
  let inverse = script.replace(/\n# CMSPARK_650_PHASE_BEGIN\n[\s\S]*?\n# CMSPARK_650_PHASE_END\n/, "")
  for (const phase of WINDOWS_JOB_PHASES) {
    const call = `__CmsparkPhase650 '${phase}'; `
    assert.equal(script.split(call).length, 2)
    inverse = inverse.replace(call, "")
  }
  assert.equal(inverse, source, "every original statement and its order survive instrumentation")
  assert.ok(script.indexOf("'wrapper_entered';") < script.indexOf("[Environment]::SetEnvironmentVariable"))
  assert.ok(script.indexOf("[Environment]::SetEnvironmentVariable") < script.indexOf("'before_add_type';"))
  assert.ok(script.indexOf("'before_add_type';") < script.indexOf("Add-Type -TypeDefinition"))
  assert.ok(script.indexOf("'after_add_type';") < script.indexOf("'before_run';"))
  assert.ok(script.indexOf("'before_run';") < script.indexOf("exit ([CMsparkOwnedJob]::Run("))
  const observer = script.match(/# CMSPARK_650_PHASE_BEGIN\n([\s\S]*?)# CMSPARK_650_PHASE_END/)![1]
  assert.match(observer, /FileMode\]::Open/); assert.match(observer, /FileAttributes\]::ReparsePoint/)
  assert.match(observer, /-ge 4/); assert.match(observer, /4096/); assert.match(observer, /catch \{\}/)
  assert.doesNotMatch(observer, /Console|StandardOutput|StandardError|Write-Host|Write-Output|GetEnvironmentVariable|\$env:|FILETIME|parentPid/)
  assert.deepEqual(phases.snapshot(), { capture_state: "empty", records: [] }, "constructing a decorator does not fabricate native phases")
})

test("wrong executable, owner query and unrelated argv pass through by identity", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), options = { stdio: "pipe" }
  for (const args of [
    ["other.exe", ["-EncodedCommand", "inert"], options],
    [windowsPowerShellExePath(), ["-NoLogo", "-Command", "owned query"], options],
    [windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encode("'unrelated'")], options],
    [windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", "not base64"], options],
    [windowsPowerShellExePath(), [{ toString() { throw Error("nonmatching argv must not be coerced") } }, "-NoProfile", "-NonInteractive", "-EncodedCommand", encode("'unrelated'")], options],
  ]) assert.equal(phases.decorateSpawnArgs(args), args)
})

test("missing, duplicated or reordered real bootstrap seams refuse the owned fixture", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), original = actualJobArgs(t), source = decode(original)
  const mutations = [
    source.replace("Add-Type -TypeDefinition @'\n", "Add-Type -TypeDefinition @'\r\n"),
    source + "; Add-Type -TypeDefinition @'\n",
    source + "; Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition @'\n",
    source.replace("exit ([CMsparkOwnedJob]::Run(", "exit ([Other]::Run("),
    source + "\n'@; exit ([CMsparkOwnedJob]::Run(",
    source.replace("try { $targetEnvironment=[Text.StringBuilder]::new();", "try { $targetEnvironment=0;"),
  ]
  for (const mutation of mutations) {
    const args = [original[0], [...(original[1] as string[]).slice(0, 4), encode(mutation)], original[2]]
    assert.throws(() => phases.decorateSpawnArgs(args), /OWNED_PHASE_BOOTSTRAP_(SEAM|ORDER)_INVALID/)
  }
  assert.throws(() => phases.decorateSpawnArgs(phases.decorateSpawnArgs(original)), /OWNED_PHASE_BOOTSTRAP_SEAM_INVALID/)
})

test("owned diagnostic filename quotes apostrophes and newlines as a single PowerShell literal", t => {
  const parent = fixture(t), special = path.join(parent.root, "quote' spaced owned")
  fs.mkdirSync(special)
  const phases = createWindowsJobPhaseDiagnostics(special), original = actualJobArgs(t), script = decode(phases.decorateSpawnArgs(original))
  assert.ok(script.includes("quote'' spaced owned"))
  const expected = "'" + path.join(fs.realpathSync(special), fileName).replace(/'/g, "''") + "'"
  assert.ok(script.includes(`[IO.File]::GetAttributes(${expected})`))
  assert.ok(script.includes(`[IO.File]::Open(${expected},[IO.FileMode]::Open`))
  assert.equal(quoteWindowsJobPhaseLiteral("/owned/quote' newline\n;Write-Output inert"), "'/owned/quote'' newline\n;Write-Output inert'", "newline is a literal-only vector, never an invalid native Windows filename")
})

test("spawn mock retains this, options, returned object and throws; restore is exact", t => {
  const f = fixture(t), before = cp.spawn, receiver = {}, options = { shell: false }, sentinel = new EventEmitter(), failure = Error("inert spawn failure")
  const descriptor = Object.getOwnPropertyDescriptor(cp, "spawn")!
  let seen: unknown[] | undefined, context: unknown
  const stub = function(this: unknown, ...args: unknown[]) { context = this; seen = args; if (args[0] === "throws") throw failure; return sentinel as any }
  Object.defineProperty(cp, "spawn", { ...descriptor, value: stub })
  try {
    observeWindowsJobPhases(t, f.root)
    const args: any[] = ["inert-other-command", ["literal"], options]
    assert.equal(Reflect.apply(cp.spawn, receiver, args), sentinel); assert.equal(context, receiver)
    assert.equal(seen![1], args[1]); assert.equal(seen![2], options)
    assert.throws(() => Reflect.apply(cp.spawn, receiver, ["throws", [], options]), error => error === failure)
  } finally {
    // Keep only the observer in Node's tracker: restoring two tracked mocks
    // of the same property in insertion order leaves the older mock installed.
    t.mock.restoreAll()
    const restoredOwnedBoundary = cp.spawn === stub
    Object.defineProperty(cp, "spawn", descriptor)
    assert.equal(restoredOwnedBoundary, true)
  }
  assert.equal(cp.spawn, before)
})

test("installed observer decorates actual public spawnWindowsJob without launching a process", t => {
  const f = fixture(t), descriptor = Object.getOwnPropertyDescriptor(cp, "spawn")!
  let captured: unknown[] | undefined
  const stub = (...args: unknown[]) => { captured = args; return new EventEmitter() as any }
  Object.defineProperty(cp, "spawn", { ...descriptor, value: stub })
  try {
    t.mock.getter(windowsJobOwner, "created", () => "123456789")
    t.mock.method(shim, "_parse", (command: string, args: string[], options: unknown) => ({ command, file: command, args, options }))
    observeWindowsJobPhases(t, f.root)
    spawnWindowsJob(process.execPath, ["owned-literal.cjs"], { env: { CMSPARK_INERT_VALUE: "literal" }, stdio: "pipe" })
    assert.ok(captured)
    for (const phase of WINDOWS_JOB_PHASES) assert.equal(decode(captured).split(`__CmsparkPhase650 '${phase}'; `).length, 2)
  } finally {
    t.mock.restoreAll()
    const restoredOwnedBoundary = cp.spawn === stub
    Object.defineProperty(cp, "spawn", descriptor)
    assert.equal(restoredOwnedBoundary, true)
  }
})

for (const count of [0, 1, 2, 3, 4]) test(`strict snapshot accepts exactly ${count} completed ordered records`, t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root)
  if (count) fs.writeFileSync(f.file, body(records().slice(0, count)))
  assert.deepEqual(phases.snapshot(), { capture_state: count === 0 ? "empty" : count === 4 ? "complete" : "partial", records: records().slice(0, count) })
})

const badRecords: [string, string][] = [
  ["invalid JSON", "{inert secret body}\n"], ["unterminated", body(records()).slice(0, -1)],
  ["unknown field", body([{ ...records()[0], secret: "inert-private-marker" }])],
  ["unknown phase", body([{ phase: "inert-private-marker", elapsed_ms: 0 }])],
  ["duplicate phase", body([records()[0], records()[0]])], ["wrong first phase", body([records()[1]])],
  ["negative elapsed", body([{ ...records()[0], elapsed_ms: -1 }])],
  ["fraction elapsed", body([{ ...records()[0], elapsed_ms: 1.5 }])],
  ["null elapsed", body([{ ...records()[0], elapsed_ms: null }])],
  ["unsafe elapsed", body([{ ...records()[0], elapsed_ms: Number.MAX_SAFE_INTEGER + 1 }])],
  ["backwards time", body([{ ...records()[0], elapsed_ms: 10 }, { ...records()[1], elapsed_ms: 9 }])],
  ["five records", body([...records(), records()[3]])], ["blank line", "\n"],
  ["duplicate JSON keys", '{"phase":"inert-private-marker","phase":"wrapper_entered","elapsed_ms":0}\n'],
]
for (const [name, data] of badRecords) test(`strict snapshot rejects ${name} without returning payload`, t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root); fs.writeFileSync(f.file, data)
  assert.deepEqual(phases.snapshot(), { capture_state: "malformed", records: [] })
  assert.equal(JSON.stringify(phases.snapshot()).includes("inert-private-marker"), false)
})

test("strict snapshot bounds file bytes and reports missing files", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root)
  fs.writeFileSync(f.file, "x".repeat(4097)); assert.deepEqual(phases.snapshot(), { capture_state: "oversize", records: [] })
  fs.unlinkSync(f.file); assert.deepEqual(phases.snapshot(), { capture_state: "missing", records: [] })
})

test("exclusive creation never overwrites an existing diagnostic file", t => {
  const f = fixture(t); fs.writeFileSync(f.file, "inert-existing")
  assert.throws(() => createWindowsJobPhaseDiagnostics(f.root), { code: "EEXIST" }); assert.equal(fs.readFileSync(f.file, "utf8"), "inert-existing")
})

test("strict snapshot refuses hard links and replaced file identity", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), other = path.join(f.root, "hardlink")
  fs.linkSync(f.file, other); assert.deepEqual(phases.snapshot(), { capture_state: "unsafe", records: [] }); fs.unlinkSync(other)
  fs.renameSync(f.file, path.join(f.root, "old-file")); fs.writeFileSync(f.file, body(records()))
  assert.deepEqual(phases.snapshot(), { capture_state: "unsafe", records: [] })
})

test("strict snapshot refuses directory links without reading a foreign payload", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), ownedTarget = path.join(f.root, "other-dir")
  fs.mkdirSync(ownedTarget); fs.unlinkSync(f.file); fs.symlinkSync(ownedTarget, f.file, process.platform === "win32" ? "junction" : "dir")
  assert.deepEqual(phases.snapshot(), { capture_state: "unsafe", records: [] })
  assert.throws(() => createWindowsJobPhaseDiagnostics(f.file), /OWNED_PHASE_ROOT_INVALID/)
})

test("snapshot observation read failure is finite and does not expose the exception", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root)
  t.mock.method(fs, "readSync", () => { throw Error("inert-private-marker") })
  assert.deepEqual(phases.snapshot(), { capture_state: "unavailable", records: [] })
})

test("snapshot rejects file replacement during its read and closes its owned descriptor", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), read = fs.readSync, close = fs.closeSync
  fs.writeFileSync(f.file, body(records()))
  let closes = 0
  t.mock.method(fs, "closeSync", (fd: number) => { closes++; return close(fd) })
  t.mock.method(fs, "readSync", function(...args: any[]) {
    const count = Reflect.apply(read, fs, args)
    fs.renameSync(f.file, path.join(f.root, "retained-old-file")); fs.writeFileSync(f.file, body(records()))
    return count
  })
  assert.deepEqual(phases.snapshot(), { capture_state: "unsafe", records: [] }); assert.equal(closes, 1)
})

test("snapshot rejects replaced root identity before reading any new file", t => {
  const f = fixture(t), phases = createWindowsJobPhaseDiagnostics(f.root), moved = f.root + "-moved"
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }))
  fs.renameSync(f.root, moved); fs.mkdirSync(f.root); fs.writeFileSync(f.file, body(records()))
  assert.deepEqual(phases.snapshot(), { capture_state: "unsafe", records: [] })
})
