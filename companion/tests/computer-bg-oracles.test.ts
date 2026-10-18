// #572 — the background oracles must be able to FAIL.
//
// A verifier that can only say "pass" is worthless. These cases feed the comparator
// synthetic before/after snapshots and assert that each flag flips to false when its
// condition is violated — plus that the derived `no_leaked_input` refuses the foreground
// (SendInput) delivery mode even when nothing else moved.
//
// Windows-only: the oracle is a PowerShell script (it reads the real desktop's foreground
// window, z-order and cursor). It skips elsewhere rather than pretending to pass.
import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
// The .ps1 is NOT compiled into .test-dist (only .ts is), so resolve it against the CWD the
// runner uses (repo root or companion/) exactly like the other source-text guards do.
const SCRIPT_REL = "src/host-use/win/scripts/computer-bg-oracles.ps1"
const SCRIPT = [SCRIPT_REL, path.join("companion", SCRIPT_REL)].find((p) => existsSync(p)) ?? SCRIPT_REL
const available = process.platform === "win32" && existsSync(PS) && existsSync(SCRIPT)

const oraclePhases650 = new Set(["SCRIPT_ENTERED", "COMPARE_ENTERED", "BEFORE_JSON_READ", "BEFORE_JSON_PARSE", "BEFORE_SECOND_JSON_READ", "JSON_LOADED", "REFUSED_4", "CURSOR_VALID", "RESULT_WRITTEN"])
function oracleObservation650(err: unknown, stdout: string, stderr: string, elapsed: number | null) {
  const error = err !== null && typeof err === "object" ? err as Record<string, unknown> : {}
  const code = error.code, signal = error.signal
  const phases: Array<{ phase: string; elapsed_ms: number }> = []
  const seen = new Set<string>()
  for (const m of stderr.matchAll(/^CMSPARK_ORACLE_PHASE_V1:([A-Z0-9_]+):([0-9]{1,9})\r?$/gm)) {
    if (oraclePhases650.has(m[1]) && !seen.has(m[1])) {
      phases.push({ phase: m[1], elapsed_ms: Number(m[2]) })
      seen.add(m[1])
    }
    if (phases.length === oraclePhases650.size) break
  }
  return {
    kind: "ORACLE_COMPARATOR_CALLBACK_V1", elapsed_ms: typeof elapsed === "number" && Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed)) : null,
    error_present: err !== null && err !== undefined,
    code_type: code === null ? "null" : typeof code === "number" ? "number" : typeof code === "string" ? "string" : code === undefined ? "undefined" : "other",
    code: typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 255 ? code :
      typeof code === "string" && ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(code) ? code : null,
    killed: error.killed === true,
    signal: signal === "SIGTERM" || signal === "SIGKILL" ? signal : signal === null || signal === undefined ? null : "OTHER",
    stdout_bytes: Buffer.byteLength(stdout), stderr_bytes: Buffer.byteLength(stderr),
    unreadable_snapshot_prefix: stderr.includes("ORACLE_UNREADABLE_SNAPSHOT:"),
    read_failed_prefix: stderr.includes("ORACLE_READ_FAILED:"), badargs_prefix: stderr.includes("BADARGS:"),
    stderr_phase_markers: phases,
  }
}
function observeOracleCallback650(err: unknown, stdout: string, stderr: string, elapsed: number | null) {
  try { console.error(JSON.stringify(oracleObservation650(err, stdout, stderr, elapsed))) } catch { /* observation cannot replace the original child result */ }
}
function oracleClock650(): number | null {
  try { return performance.now() } catch { return null }
}

type Snap = {
  ts: string
  foreground: number
  cursor: { x: number; y: number; got: boolean }
  zorder: number[]
}

const run = (args: string[]) =>
  new Promise<{ err: unknown; stderr: string }>((res) => {
    const started = oracleClock650()
    execFile(
      PS,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...process.env, CMSPARK_ORACLE_TEST_PHASES_650: "1" } },
      (err, stdout, stderr) => {
        const finished = oracleClock650()
        observeOracleCallback650(err, String(stdout || ""), String(stderr || ""), started === null || finished === null ? null : finished - started)
        res({ err, stderr: String(stderr || "") })
      },
    )
  })

test("#650 comparator callback observation retains only finite error and phase fields", () => {
  const stderr = "CMSPARK_ORACLE_PHASE_V1:SCRIPT_ENTERED:0\r\nCMSPARK_ORACLE_PHASE_V1:JSON_LOADED:21\n"
  const r = oracleObservation650({ code: null, killed: true, signal: "SIGTERM" }, "owned", stderr, 15001.9)
  assert.equal(r.code_type, "null")
  assert.equal(r.code, null)
  assert.equal(r.elapsed_ms, 15001)
  assert.equal(r.killed, true)
  assert.equal(r.signal, "SIGTERM")
  assert.equal(r.stdout_bytes, 5)
  assert.deepEqual(r.stderr_phase_markers, [{ phase: "SCRIPT_ENTERED", elapsed_ms: 0 }, { phase: "JSON_LOADED", elapsed_ms: 21 }])
})
test("#650 comparator observation distinguishes first-file read from JSON parsing", () => {
  const stderr = "CMSPARK_ORACLE_PHASE_V1:BEFORE_JSON_READ:3\nCMSPARK_ORACLE_PHASE_V1:BEFORE_JSON_PARSE:4\n"
  const r = oracleObservation650({ code: null, killed: true, signal: "SIGTERM" }, "", stderr, 15000)
  assert.deepEqual(r.stderr_phase_markers, [
    { phase: "BEFORE_JSON_READ", elapsed_ms: 3 },
    { phase: "BEFORE_JSON_PARSE", elapsed_ms: 4 },
  ])
  assert.equal(r.killed, true)
  assert.equal(r.code, null)
  assert.equal(r.stdout_bytes, 0)
})
test("#650 comparator observation preserves the existing digit-bearing refusal marker only", () => {
  const stderr = "CMSPARK_ORACLE_PHASE_V1:REFUSED_4:1\nCMSPARK_ORACLE_PHASE_V1:UNKNOWN_9:2\n"
  const r = oracleObservation650({ code: 4 }, "", stderr, 2)
  assert.deepEqual(r.stderr_phase_markers, [{ phase: "REFUSED_4", elapsed_ms: 1 }])
  assert.equal(r.code, 4)
  assert.equal(r.error_present, true)
})
test("#650 comparator observation excludes arbitrary child strings, bodies and duplicate/unknown markers", () => {
  const privateMarker = "owned_private_marker_not_for_logging"
  const stderr = `${privateMarker}\nCMSPARK_ORACLE_PHASE_V1:SCRIPT_ENTERED:0\nCMSPARK_ORACLE_PHASE_V1:SCRIPT_ENTERED:1\nCMSPARK_ORACLE_PHASE_V1:UNKNOWN:2\n`
  const r = oracleObservation650({ code: privateMarker, signal: privateMarker, message: privateMarker, path: privateMarker }, privateMarker, stderr, 4)
  assert.equal(r.code, null)
  assert.equal(r.signal, "OTHER")
  assert.equal(r.stderr_phase_markers.length, 1)
  assert.ok(!JSON.stringify(r).includes(privateMarker))
})
test("#650 comparator observer getter/logger failures cannot replace the primary callback result", () => {
  assert.doesNotThrow(() => observeOracleCallback650({ get code() { throw Error("owned getter failure") } }, "", "", 0))
  const original = console.error
  console.error = () => { throw Error("owned logger failure") }
  try { assert.doesNotThrow(() => observeOracleCallback650(null, "", "", 0)) }
  finally { console.error = original }
})
for (const failingRead of [0, 1]) {
  test(`#650 actual comparator run preserves the original callback after clock read ${failingRead} throws`, async () => {
    const child = createRequire(__filename)("node:child_process") as typeof import("node:child_process")
    const originalExec = child.execFile, clockDescriptor = Object.getOwnPropertyDescriptor(performance, "now")
    const originalLogger = console.error
    const originalErr = Object.assign(new Error("owned original child error"), { code: 4 })
    let calls = 0, clockReads = 0
    const records: string[] = []
    child.execFile = ((...args: any[]) => { calls++; args.at(-1)(originalErr, "owned stdout", "owned stderr"); return {} }) as any
    Object.defineProperty(performance, "now", { configurable: true, value: () => {
      if (clockReads++ === failingRead) throw Error("owned clock failure")
      return 20
    } })
    console.error = value => { records.push(String(value)) }
    try {
      const result = await run(["owned_inert_never_executed"])
      assert.equal(calls, 1)
      assert.equal(result.err, originalErr)
      assert.equal(result.stderr, "owned stderr")
      assert.equal(records.length, 1)
      assert.equal(JSON.parse(records[0]).elapsed_ms, null)
      assert.ok(!records[0].includes("owned original child error"))
    } finally {
      child.execFile = originalExec
      if (clockDescriptor) Object.defineProperty(performance, "now", clockDescriptor)
      else Reflect.deleteProperty(performance, "now")
      console.error = originalLogger
    }
  })
}

/** Invoke the actual PS comparator, including malformed snapshot negative controls. */
async function runCompare(
  dir: string,
  before: unknown,
  after: unknown,
  delivery: "uia-pattern" | "sendinput" = "uia-pattern",
) {
  const b = path.join(dir, "b.json")
  const a = path.join(dir, "a.json")
  const r = path.join(dir, "r.json")
  for (const f of [b, a, r]) rmSync(f, { force: true })
  writeFileSync(b, JSON.stringify(before))
  writeFileSync(a, JSON.stringify(after))
  const { err, stderr } = await run([
    "-File", SCRIPT, "-Mode", "compare", "-Before", b, "-After", a, "-Out", r, "-Delivery", delivery,
  ])
  return { err, stderr, output: r }
}

/** Run the comparator on two synthetic snapshots and return its verdict. */
async function compare(
  dir: string,
  before: Snap,
  after: Snap,
  delivery: "uia-pattern" | "sendinput" = "uia-pattern",
) {
  const { err, stderr, output: r } = await runCompare(dir, before, after, delivery)
  assert.equal(err, null, `comparator failed: ${stderr}`)
  assert.ok(existsSync(r), "comparator wrote no result")
  return JSON.parse(readFileSync(r, "utf8"))
}

const BASE: Snap = {
  ts: "t",
  foreground: 100,
  cursor: { x: 10, y: 10, got: true },
  zorder: [100, 101, 102],
}

test("#572 background oracle: the same desktop state verifies as background", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const r = await compare(dir, BASE, BASE)
    assert.equal(r.focus_kept, true)
    assert.equal(r.zorder_kept, true)
    assert.equal(r.cursor_kept, true)
    assert.equal(r.no_leaked_input, true)
    assert.equal(r.background_verified, true, "identical state must verify — else nothing could")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 background oracle: a foreground change flips verification to false", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const r = await compare(dir, BASE, { ...BASE, foreground: 999 })
    assert.equal(r.focus_kept, false, "focus_kept must observe the change")
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 background oracle: a cursor move flips verification to false", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const r = await compare(dir, BASE, { ...BASE, cursor: { x: 11, y: 10, got: true } })
    assert.equal(r.cursor_kept, false)
    assert.equal(r.zorder_kept, true, "a cursor move is not a z-order change")
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 background oracle: a z-order change flips verification to false", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const r = await compare(dir, BASE, { ...BASE, zorder: [101, 100, 102] })
    assert.equal(r.zorder_kept, false)
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 background oracle: SendInput delivery cannot claim background, even if nothing moved", { skip: !available }, async () => {
  // This is the load-bearing case: the oracle must distinguish *why* the desktop is unchanged.
  // A SendInput path that happens to leave focus alone is still not a background delivery.
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const r = await compare(dir, BASE, BASE, "sendinput")
    assert.equal(r.focus_kept, true)
    assert.equal(r.cursor_kept, true)
    assert.equal(r.no_leaked_input, false, "the foreground path must never pass the leak oracle")
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// These call the production PowerShell comparator, not a JS reimplementation.
// They are also counterfactual controls: running this same compiled test against
// the exact old PS source must fail on invalid sampling instead of certifying it.
for (const cursor of [
  { label: "zero", x: 0, y: 0 },
  { label: "negative virtual-screen coordinates", x: -1920, y: -120 },
]) {
  test(`#572 background oracle: valid ${cursor.label} remains a usable observation`, { skip: !available }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
    try {
      const snap: Snap = { ...BASE, cursor: { x: cursor.x, y: cursor.y, got: true } }
      const r = await compare(dir, snap, snap)
      assert.equal(r.cursor_kept, true)
      assert.equal(r.background_verified, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

const invalidCursorSamples: Array<{ label: string; cursor: unknown }> = [
  { label: "failed got", cursor: { x: 10, y: 10, got: false } },
  { label: "missing got", cursor: { x: 10, y: 10 } },
  { label: "null got", cursor: { x: 10, y: 10, got: null } },
  { label: "string got", cursor: { x: 10, y: 10, got: "true" } },
  { label: "numeric got", cursor: { x: 10, y: 10, got: 1 } },
  { label: "array got", cursor: { x: 10, y: 10, got: [true] } },
  { label: "object got", cursor: { x: 10, y: 10, got: {} } },
  { label: "missing cursor", cursor: undefined },
  { label: "null cursor", cursor: null },
  { label: "array cursor", cursor: [{ x: 10, y: 10, got: true }] },
]
for (const axis of ["x", "y"] as const) {
  for (const invalid of [
    { label: "missing", value: undefined },
    { label: "null", value: null },
    { label: "string", value: "10" },
    { label: "boolean", value: true },
    { label: "array", value: [10] },
    { label: "object", value: {} },
    // JSON.stringify writes these non-finite numbers as null. This asserts
    // invalid serialized observations, not a claim that JSON represents NaN.
    { label: "serialized non-finite", value: Number.POSITIVE_INFINITY },
  ]) {
    invalidCursorSamples.push({
      label: `${axis} ${invalid.label}`,
      cursor: { x: 10, y: 10, got: true, [axis]: invalid.value },
    })
  }
}

for (const invalid of invalidCursorSamples) {
  for (const side of ["before", "after"] as const) {
    test(`#572 background oracle: ${side} ${invalid.label} refuses unreadable sampling`, { skip: !available }, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
      try {
        const bad = { ...BASE, cursor: invalid.cursor }
        const { err, stderr, output } = await runCompare(
          dir,
          side === "before" ? bad : BASE,
          side === "after" ? bad : BASE,
        )
        assert.ok(err, "invalid sampling must not exit successfully")
        assert.equal((err as { code?: number }).code, 4, `wrong failure: ${stderr}`)
        assert.match(stderr, /ORACLE_UNREADABLE_SNAPSHOT:/)
        assert.equal(existsSync(output), false, "invalid sampling must not write a verification result")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
}

test("#572 background oracle: two failed cursor samples cannot certify an unchanged cursor", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-"))
  try {
    const bad = { ...BASE, cursor: { x: 0, y: 0, got: false } }
    const { err, stderr, output } = await runCompare(dir, bad, bad)
    assert.ok(err)
    assert.equal((err as { code?: number }).code, 4, `wrong failure: ${stderr}`)
    assert.match(stderr, /ORACLE_UNREADABLE_SNAPSHOT:/)
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
