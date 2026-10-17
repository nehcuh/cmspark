// #650: one owned Windows-only read/discovery diagnostic; never replaces #572's comparator.
import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
const REL = "tests/fixtures/computer-bg-read-boundary-650.ps1"
const SCRIPT = [REL, path.join("companion", REL)].find(p => existsSync(p)) ?? REL
const CONTENT = "CMSPARK_650_OWNED_READ_V1"
const PHASES = ["ENTERED", "DIRECT_READ_ENTERED", "DIRECT_READ_RETURNED", "DISCOVERY_ENTERED", "DISCOVERY_RETURNED", "CMDLET_READ_ENTERED", "CMDLET_READ_RETURNED", "COMPLETE"]
const PREFLIGHT_KEYS = ["full_language", "pshome_modules_exists", "psmodulepath_contains_pshome_modules", "windows_ps51"]

function observe(stdout: string, stderr: string) {
  const phases: Array<{ phase: string; elapsed_ms: number }> = []
  let preflight: Record<string, boolean> | null = null, valid = true
  const lines = stderr.split(/\r?\n/)
  if (lines.pop() !== "") valid = false
  for (const line of lines) {
    const m = /^CMSPARK_READ_BOUNDARY_650:([A-Z_]+):([0-9]{1,9})$/.exec(line)
    if (m) {
      if (!PHASES.includes(m[1])) { valid = false; continue }
      const elapsed = Number(m[2])
      if (m[1] !== PHASES[phases.length] || (phases.length && elapsed < phases[phases.length - 1].elapsed_ms)) valid = false
      if (phases.length < PHASES.length) phases.push({ phase: m[1], elapsed_ms: elapsed })
      else valid = false
      continue
    }
    if (line.startsWith("CMSPARK_READ_PREFLIGHT_650:")) {
      try {
        const value = JSON.parse(line.slice("CMSPARK_READ_PREFLIGHT_650:".length))
        if (preflight !== null || phases.length !== 1 || !value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== PREFLIGHT_KEYS.join(",") || PREFLIGHT_KEYS.some(k => typeof value[k] !== "boolean")) valid = false
        else preflight = value
      } catch { valid = false }
      continue
    }
    // A fixed failure marker is diagnostic, never success. Arbitrary text is not retained.
    valid = false
  }
  const expected = '{"version":1,"direct_read_match":true,"command_match":true,"cmdlet_read_match":true}'
  const receipt = stdout === expected + "\n" || stdout === expected + "\r\n"
  return { complete: valid && preflight !== null && phases.length === PHASES.length && receipt, phases, preflight, receipt }
}

function run(input: string) {
  return new Promise<{ err: unknown; observation: ReturnType<typeof observe>; error_present: boolean; code: number | string | null; killed: boolean; signal: string | null; stdout_bytes: number; stderr_bytes: number }>(resolve => {
    execFile(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-InputPath", input],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...process.env, CMSPARK_ORACLE_TEST_PHASES_650: "1" } },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; signal?: unknown; killed?: unknown }) | null
        const text = String(stdout || ""), diagnostics = String(stderr || "")
        resolve({ err, observation: observe(text, diagnostics), error_present: err !== null && err !== undefined,
          code: typeof e?.code === "number" && Number.isInteger(e.code) && e.code >= 0 && e.code <= 255 ? e.code :
            typeof e?.code === "string" && ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(e.code) ? e.code : null,
          killed: e?.killed === true, signal: e?.signal === "SIGTERM" || e?.signal === "SIGKILL" ? e.signal : e?.signal == null ? null : "OTHER",
          stdout_bytes: Buffer.byteLength(text), stderr_bytes: Buffer.byteLength(diagnostics) })
      })
  })
}

function requireComplete(result: Awaited<ReturnType<typeof run>>) {
  // Assert only finite booleans: an execFile Error contains its command/path.
  assert.ok(result.err === null, "owned read/discovery child must succeed; finite diagnostic retained")
  assert.ok(result.observation.complete, "all fixed observations and content checks required")
}

function sourceReceipt() {
  const source = readFileSync(SCRIPT, "utf8")
  const literals = [...source.matchAll(/\[Console\]::Out\.WriteLine\('([^'\r\n]+)'\)/g)]
  assert.equal(literals.length, 1, "exact one emitted success literal")
  return literals[0][1] + "\n"
}
function successfulDiagnostics(preflight = [true, true, true, true]) {
  const source = readFileSync(SCRIPT, "utf8")
  const template = /'CMSPARK_READ_PREFLIGHT_650:([^'\r\n]+)'/.exec(source)
  assert.ok(template, "actual fixture's finite format template")
  const line = "CMSPARK_READ_PREFLIGHT_650:" + template[1].replace(/\{([0-3])\}/g, (_, i) => String(preflight[Number(i)])).replace(/\{\{/g, "{").replace(/\}\}/g, "}")
  const lines = PHASES.map((phase, i) => `CMSPARK_READ_BOUNDARY_650:${phase}:${i}`)
  lines.splice(1, 0, line)
  return lines.join("\n") + "\n"
}

test("#650 read-boundary CPU: emitted receipt and preflight schema remain finite", () => {
  const result = observe(sourceReceipt(), successfulDiagnostics())
  assert.equal(result.complete, true)
  assert.equal(result.phases.length, 8)
  // These facts diagnose layout/mode; false is not by itself a cause or a failed content oracle.
  assert.equal(observe(sourceReceipt(), successfulDiagnostics([false, false, false, false])).complete, true)
})
test("#650 read-boundary CPU: malformed, missing and reordered observations fail closed", () => {
  const out = sourceReceipt(), good = successfulDiagnostics()
  for (const bad of ["", good.replace("DIRECT_READ_RETURNED", "UNKNOWN"), good.replace("DISCOVERY_RETURNED:4", "DISCOVERY_RETURNED:0"),
    good.replace("CMDLET_READ_ENTERED", "DISCOVERY_RETURNED"), good.replace("CMSPARK_READ_BOUNDARY_650:COMPLETE:7\n", ""),
    good + "arbitrary secret body\n", good.replace('"windows_ps51":true', '"windows_ps51":"true"'),
    good.replace('"windows_ps51":true', '"windows_ps51":true,"extra":true'), good.replace("ENTERED:0", "ENTERED:-1"),
    good.replace("ENTERED:0", "ENTERED:1000000000")]) assert.equal(observe(out, bad).complete, false)
  const marker = "OWNED_UNREGISTERED_MARKER"
  const rejected = observe(out, `CMSPARK_READ_BOUNDARY_650:${marker}:0\n` + good)
  assert.equal(rejected.complete, false)
  assert.ok(!JSON.stringify(rejected).includes(marker), "unknown child text must not survive the finite diagnostic projection")
  assert.ok(rejected.phases.every(item => PHASES.includes(item.phase)))
  for (const bad of ["", out + out, out.replace('"command_match":true', '"command_match":false'), out.replace('"version":1', '"version":"1"'), out.replace("}", ',"extra":true}')]) {
    assert.equal(observe(bad, good).complete, false)
  }
})
test("#650 read-boundary CPU: actual child adapter preserves flags, timeout and environment", async t => {
  const child = require("node:child_process") as typeof import("node:child_process")
  let calls = 0
  t.mock.method(child, "execFile", (command: string, args: string[], options: any, callback: Function) => {
    calls++
    assert.equal(command, PS)
    assert.deepEqual(args, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-InputPath", "OWNED_NOT_EXECUTED"])
    assert.equal(options.timeout, 15_000); assert.equal(options.encoding, "utf8"); assert.equal(options.windowsHide, true)
    assert.ok(options.env !== process.env)
    assert.ok(Object.keys(options.env).length === new Set([...Object.keys(process.env), "CMSPARK_ORACLE_TEST_PHASES_650"]).size)
    assert.ok(Object.entries(process.env).every(([key, value]) => key === "CMSPARK_ORACLE_TEST_PHASES_650" || options.env[key] === value), "all existing values preserved without printing them")
    assert.equal(options.env.CMSPARK_ORACLE_TEST_PHASES_650, "1")
    callback(null, sourceReceipt(), successfulDiagnostics()); return {}
  })
  const result = await run("OWNED_NOT_EXECUTED")
  assert.equal(calls, 1); assert.equal(result.err, null); assert.equal(result.observation.complete, true)
})
test("#650 read-boundary CPU: transport failure preserves primary result and cannot pass", async t => {
  const child = require("node:child_process") as typeof import("node:child_process")
  const primary = Object.assign(new Error("owned never printed"), { code: null, signal: "SIGTERM", killed: true })
  let calls = 0
  t.mock.method(child, "execFile", (_command: string, _args: string[], _options: unknown, callback: Function) => {
    calls++; callback(primary, sourceReceipt(), successfulDiagnostics()); return {}
  })
  const result = await run("OWNED_NOT_EXECUTED")
  assert.equal(calls, 1); assert.equal(result.err, primary); assert.equal(result.observation.complete, true)
  assert.equal(result.killed, true); assert.equal(result.signal, "SIGTERM"); assert.equal(result.code, null)
  assert.throws(() => requireComplete(result), error => {
    assert.ok(!String(error).includes("owned never printed"))
    assert.ok(!JSON.stringify(error).includes("owned never printed"))
    return true
  })
})

test("#650 native Windows owned Get-Content read/discovery boundary", { skip: process.platform !== "win32" }, async t => {
  assert.ok(existsSync(PS), "pinned Windows PowerShell must exist")
  assert.ok(existsSync(SCRIPT), "owned diagnostic fixture must exist")
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-read-650-")), input = path.join(dir, "owned-read.txt")
  try {
    writeFileSync(input, CONTENT, { flag: "wx", mode: 0o600 })
    const before = lstatSync(input, { bigint: true })
    assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n)
    const result = await run(input)
    const { err, ...finite } = result
    t.diagnostic(JSON.stringify({ kind: "OWNED_READ_BOUNDARY_650", ...finite }))
    requireComplete(result)
    const after = lstatSync(input, { bigint: true })
    assert.ok(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && after.dev === before.dev && after.ino === before.ino && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs)
    assert.equal(readFileSync(input, "utf8"), CONTENT)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
