// #572 — REAL integration: the compiled adapter driving the REAL PowerShell script.
//
// WHY THIS FILE EXISTS (read before deleting it):
// The first cut of #572 had `computer-uia-invoke.ps1` missing the `-StopFile` parameter while
// `PsInputInjector.withStop()` appends it on EVERY call — and production always constructs the
// injector with a stop file (`new PsInputInjector(undefined, estopFlagPath())`). PowerShell
// then failed parameter binding before running a single line, so every eligible click silently
// fell back to the foreground coordinate path: the entire feature was dead in production while
// the suite stayed green.
//
// It stayed green because both existing layers bypassed the boundary:
//   * `computer-uia-invoke-adapter.test.ts` injects a FAKE runner — no argv binding happens.
//   * the manual E2E drove the script directly, without `-StopFile` (there was no stop file in
//     a standalone invocation), i.e. a different shape from production.
//
// So this file deliberately uses the REAL runner and the REAL argv, with a stop file present,
// and asserts on the script's OWN error code. A binding failure shows up as `method_failed`
// with `NamedParameterNotFound`; correct binding shows up as `window_gone`. We assert the
// latter. Any test here that can pass while the parameter is missing is worthless.
import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { PsInputInjector } from "../src/computer/win-adapters"

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
const SCRIPT_REL = "src/host-use/win/scripts/computer-uia-invoke.ps1"
const SCRIPT = [SCRIPT_REL, path.join("companion", SCRIPT_REL)].find((p) => existsSync(p))
const available = process.platform === "win32" && existsSync(PS) && !!SCRIPT

/** A handle that is guaranteed not to be a window, so the script exits at its first check. */
const DEAD_HWND = 1

test("#572 integration: the real script accepts -StopFile (the argv production actually sends)", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uia-int-"))
  try {
    // A stop file that does NOT exist: binding must succeed and the run must proceed to the
    // window check. If the parameter were missing, PowerShell rejects the whole invocation.
    const stopFile = path.join(dir, "absent.stop")
    const injector = new PsInputInjector(undefined, stopFile)
    const r = await injector.invokeUia(DEAD_HWND, "SubmitTest", "auto")

    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(
      r.reason,
      "window_gone",
      `the script must actually RUN (dead hwnd → window_gone). Got '${r.reason}': ${r.detail}. ` +
        `'method_failed' here means -StopFile was not accepted — the production call shape is broken.`,
    )
    // And the failure must NOT smell like a binding rejection.
    assert.ok(
      !/NamedParameterNotFound|找不到接受实际参数|A parameter cannot be found/i.test(r.detail),
      `argv binding failed: ${r.detail}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 integration: an existing stop file aborts the background delivery (STOPPED → aborted)", { skip: !available }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uia-int-"))
  try {
    // The file EXISTS ⇒ emergency stop is raised ⇒ the script must refuse before touching
    // the target, and the adapter must surface it as `aborted` (never a fallback trigger).
    const stopFile = path.join(dir, "present.stop")
    writeFileSync(stopFile, "stop")
    const injector = new PsInputInjector(undefined, stopFile)
    const r = await injector.invokeUia(DEAD_HWND, "SubmitTest", "auto")

    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.reason, "aborted", `stop flag must map to 'aborted', got '${r.reason}': ${r.detail}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#572 integration: with no stop file at all the script still runs (standalone shape)", { skip: !available }, async () => {
  const injector = new PsInputInjector()
  const r = await injector.invokeUia(DEAD_HWND, "SubmitTest", "auto")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "window_gone")
})


// Current #572 positive acceptance. CPU controls extract these exact assertions;
// only the Windows callback below starts owned WPF processes.
import { execFile, type ChildProcess } from "node:child_process"
import { readFileSync, watch } from "node:fs"
import { performance } from "node:perf_hooks"
import { promisify } from "node:util"
import { PsUiaLocator } from "../src/computer/win-adapters"
import { resolveWinScript, runPs, type PsRunner } from "../src/host-use/win/powershell"

type WpfSnapshot572 = {
  foreground: number
  cursor: { got: boolean; x: number; y: number }
  zorder: number[]
}
type WpfChild572 = {
  child: ChildProcess
  closed: Promise<void>
  isClosed: () => boolean
  launchError: () => Error | undefined
}

function assertCurrentWpfProof572(
  target: number, sibling: number, before: WpfSnapshot572, after: WpfSnapshot572,
  verdict: Record<string, unknown>, marker: string, siblingMarker: boolean,
): void {
  assert.ok(Number.isSafeInteger(target) && target > 0)
  assert.ok(Number.isSafeInteger(sibling) && sibling > 0 && target !== sibling)
  for (const snapshot of [before, after]) {
    assert.equal(snapshot.foreground, sibling, "owned sibling must actually retain foreground")
    assert.equal(snapshot.cursor.got, true)
    assert.ok(Number.isFinite(snapshot.cursor.x) && Number.isFinite(snapshot.cursor.y))
    assert.ok(Array.isArray(snapshot.zorder) && snapshot.zorder.length > 0 && snapshot.zorder.length <= 16)
    assert.ok(snapshot.zorder.every(value => Number.isSafeInteger(value) && value > 0))
    assert.ok(snapshot.zorder.includes(target) && snapshot.zorder.includes(sibling))
  }
  assert.deepEqual(after.zorder, before.zorder, "actual observed z-order must be unchanged")
  assert.equal(after.cursor.x, before.cursor.x)
  assert.equal(after.cursor.y, before.cursor.y)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.delivery, "uia-pattern")
  assert.equal(verdict.target_hwnd, target)
  for (const key of ["focus_kept", "zorder_kept", "cursor_kept", "no_leaked_input", "background_verified"]) {
    assert.equal(verdict[key], true, `actual comparator must establish ${key}`)
  }
  assert.equal(verdict.no_leaked_input_kind, "derived")
  assert.match(marker, /^clicked \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/)
  assert.equal(siblingMarker, false, "owned foreground sibling must receive no click")
}

type WpfEvent572 = {
  sequence: number
  event: "Activated" | "Deactivated" | "ContentRendered" | "Click"
  phase: "event" | "enter" | "exit"
  active: boolean
  foregroundKnown: boolean
  foregroundOwn: boolean
}

/** Untrusted owned receipt bytes never flow directly to public diagnostics. */
function projectWpfEvents572(text: string, role: "target" | "sibling"): {
  schema: 1; role: "target" | "sibling"; stage: "before_cleanup"; valid: boolean; atLimit: boolean; events: WpfEvent572[]
} {
  const empty = { schema: 1 as const, role, stage: "before_cleanup" as const, valid: false, atLimit: false, events: [] as WpfEvent572[] }
  if (role !== "target" && role !== "sibling") throw new Error("WPF572_EVENT_ROLE_INVALID")
  if (Buffer.byteLength(text, "utf8") > 4096 || text.trim() === "") return empty
  const lines = text.trim().split(/\r?\n/)
  if (lines.length > 16) return empty
  const events: WpfEvent572[] = []
  try {
    for (const line of lines) {
      const value = JSON.parse(line) as Record<string, unknown>
      if (!value || typeof value !== "object" || Array.isArray(value)) return empty
      if (Object.keys(value).sort().join(",") !== "active,event,foregroundKnown,foregroundOwn,phase,sequence") return empty
      if (value.sequence !== events.length + 1 || typeof value.active !== "boolean" || typeof value.foregroundKnown !== "boolean" || typeof value.foregroundOwn !== "boolean") return empty
      if (value.foregroundOwn && !value.foregroundKnown) return empty
      if (value.event === "Click") {
        if (value.phase !== "enter" && value.phase !== "exit") return empty
      } else if (!["Activated", "Deactivated", "ContentRendered"].includes(value.event as string) || value.phase !== "event") return empty
      events.push({ sequence: value.sequence as number, event: value.event as WpfEvent572["event"], phase: value.phase as WpfEvent572["phase"],
        active: value.active, foregroundKnown: value.foregroundKnown, foregroundOwn: value.foregroundOwn })
    }
  } catch { return empty }
  return { schema: 1, role, stage: "before_cleanup", valid: true, atLimit: events.length === 16, events }
}

function emitWpfEvents572(role: "target" | "sibling", read: () => string, sink: (value: string) => void): void {
  try {
    let text = ""
    try { text = read() } catch { /* no free error/path output */ }
    sink("WPF572_EVENT_OBSERVATION " + JSON.stringify(projectWpfEvents572(text, role)))
  } catch { /* diagnostics cannot replace acceptance or prevent owned cleanup */ }
}

// Only the owned acceptance copy is instrumented. Removing the five marked
// insertions must recover every original byte, including its BOM and EOLs.
function stripWpfClientProbe572(source: Buffer): Buffer {
  let text = source.toString("utf8")
  for (const name of ["DECL", "FUNCTION", "PRE", "POST", "EXIT"]) {
    const begin = name === "DECL" ? `/*WPF572_CLIENT_PROBE_${name}_BEGIN*/` : `<#WPF572_CLIENT_PROBE_${name}_BEGIN#>`
    const end = name === "DECL" ? `/*WPF572_CLIENT_PROBE_${name}_END*/` : `<#WPF572_CLIENT_PROBE_${name}_END#>`
    const first = text.indexOf(begin), last = text.indexOf(end)
    assert.ok(first >= 0 && last > first && text.indexOf(begin, first + begin.length) < 0 && text.indexOf(end, last + end.length) < 0)
    text = text.slice(0, first) + text.slice(last + end.length)
  }
  return Buffer.from(text, "utf8")
}

function buildWpfClientProbe572(source: Buffer, sibling: number, receipt: string): Buffer {
  const text = source.toString("utf8")
  assert.ok(Buffer.from(text, "utf8").equals(source), "probe requires exact UTF-8 bytes")
  assert.ok(!text.includes("WPF572_CLIENT_PROBE_"))
  assert.ok(Number.isSafeInteger(sibling) && sibling > 0 && !receipt.includes("\0"))
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const marked = (name: string, body: string) => `<#WPF572_CLIENT_PROBE_${name}_BEGIN#>${body}<#WPF572_CLIENT_PROBE_${name}_END#>`
  const call = (phase: string) => `try { Write-WpfClientProbe572 '${phase}' } catch {}; `
  const functionBody = String.raw`
$script:wpfClientProbeSequence572 = 0
function Write-WpfClientProbe572([string]$Phase) {
  try {
    if ($Phase -notin @('BEFORE_FROM_HANDLE','PRE_INVOKE','POST_INVOKE','PRE_EXIT') -or $script:wpfClientProbeSequence572 -ge 4) { return }
    $foreground = [CU.W32]::GetForegroundWindow()
    $role = if ($foreground -eq [IntPtr]$Hwnd) { 'TARGET' } elseif ($foreground -eq [IntPtr]::new([long]${sibling})) { 'SIBLING' } elseif ($foreground -eq [IntPtr]::Zero) { 'NONE' } else { 'OTHER' }
    [void]($script:wpfClientProbeSequence572++)
    $record = [ordered]@{ sequence = [int]$script:wpfClientProbeSequence572; phase = $Phase; foregroundRole = $role }
    $line = Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject $record
    [IO.File]::AppendAllText('${receipt.replace(/'/g, "''")}', $line + [Environment]::NewLine)
  } catch {}
}
${call("BEFORE_FROM_HANDLE")}
`.replace(/\n/g, eol)
  const declaration = "public static extern bool IsWindow(System.IntPtr h);"
  const fromHandle = "try { $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd) }"
  const action = '  try { & $act $obj; [void]$tried.Add("${pname}:ok"); return $true }'
  const exit = "exit 0"
  for (const anchor of [declaration, fromHandle, action, exit]) {
    assert.equal(text.split(anchor).length, 2, "every source anchor must be unique")
  }
  const inserts = [
    { at: text.indexOf(declaration) + declaration.length, value: '/*WPF572_CLIENT_PROBE_DECL_BEGIN*/ [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); /*WPF572_CLIENT_PROBE_DECL_END*/' },
    { at: text.indexOf(fromHandle), value: marked("FUNCTION", functionBody) },
    { at: text.indexOf(action) + action.indexOf("& $act"), value: marked("PRE", `if ($pname -eq 'invoke') { ${call("PRE_INVOKE")} }; `) },
    { at: text.indexOf(action) + action.indexOf("[void]$tried"), value: marked("POST", `if ($pname -eq 'invoke') { ${call("POST_INVOKE")} }; `) },
    { at: text.indexOf(exit), value: marked("EXIT", call("PRE_EXIT")) },
  ]
  let output = text
  for (const insertion of inserts.sort((a, b) => b.at - a.at)) output = output.slice(0, insertion.at) + insertion.value + output.slice(insertion.at)
  const result = Buffer.from(output, "utf8")
  assert.ok(stripWpfClientProbe572(result).equals(source), "probe inverse must recover the whole shipped script")
  return result
}

function makeWpfClientProbe572(dir: string, sibling: number, runner: PsRunner): { run: PsRunner; status: () => string } {
  let capture = "NOT_RUN", calls = 0
  return {
    status: () => capture,
    run: async (script, args, opts) => {
      // Instrumentation failure cannot change the original action or refusal.
      let selected = script
      try {
        assert.equal(++calls, 1)
        assert.equal(path.basename(script), "computer-uia-invoke.ps1")
        const observed = buildWpfClientProbe572(readFileSync(script), sibling, path.join(dir, "invoke-client-phases.jsonl"))
        writeFileSync(path.join(dir, "invoke-client-phases.jsonl"), "", { flag: "wx", mode: 0o600 })
        selected = path.join(dir, "observed-uia-invoke.ps1")
        writeFileSync(selected, observed, { flag: "wx", mode: 0o600 })
        capture = "READY"
      } catch { selected = script; capture = "UNAVAILABLE" }
      return runner(selected, args, opts)
    },
  }
}

// The original acceptance always constructs the production/default runner.
// Only the independently owned diagnostic case selects the observed copy.
function makeCurrentWpfInjector572(diagnostic: boolean, dir: string, sibling: number) {
  const probe = diagnostic ? makeWpfClientProbe572(dir, sibling, runPs) : undefined
  return { injector: new PsInputInjector(probe?.run, path.join(dir, "absent.stop")), probe }
}

function projectWpfClientProbe572(text: string, capture: string, parentRole: string) {
  const roles = ["TARGET", "SIBLING", "NONE", "OTHER"]
  const after = roles.includes(parentRole) ? parentRole : "UNKNOWN"
  const empty = { schema: 1, capture: ["READY", "NOT_RUN"].includes(capture) ? capture : "UNAVAILABLE", valid: false, complete: false,
    phases: [] as { sequence: number; phase: string; foregroundRole: string }[],
    parentSnapshotPhase: after === "UNKNOWN" ? "NOT_OBSERVED" : "AFTER_CLIENT_CLOSE_AND_MARKER", parentForegroundRole: after }
  if (capture !== "READY" || Buffer.byteLength(text, "utf8") > 4096 || text.trim() === "") return empty
  try {
    const rows = text.trim().split(/\r?\n/), expected = ["BEFORE_FROM_HANDLE", "PRE_INVOKE", "POST_INVOKE", "PRE_EXIT"]
    if (rows.length > 4) return empty
    const phases = rows.map((line, index) => {
      const value = JSON.parse(line)
      if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "foregroundRole,phase,sequence" || value.sequence !== index + 1 || value.phase !== expected[index] || !roles.includes(value.foregroundRole)) throw new Error("WPF572_CLIENT_PROBE_INVALID")
      return { sequence: value.sequence, phase: value.phase, foregroundRole: value.foregroundRole }
    })
    return { ...empty, valid: true, complete: phases.length === 4, phases }
  } catch { return empty }
}

function emitWpfClientProbe572(read: () => string, sink: (value: string) => void, capture: string, parentRole: string): void {
  try {
    let text = ""
    try { text = read() } catch {}
    sink("WPF572_CLIENT_PHASE_OBSERVATION " + JSON.stringify(projectWpfClientProbe572(text, capture, parentRole)))
  } catch { /* a passive sink cannot replace primary failure or owned cleanup */ }
}

function startOwnedWpf572(fixture: string, args: string[], remaining: number): WpfChild572 {
  let ended = false
  let failure: Error | undefined
  const child = execFile(PS, ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", fixture, ...args], {
    encoding: "utf8", windowsHide: true, timeout: remaining, maxBuffer: 4096,
  }, error => { if (error) failure = error })
  const closed = new Promise<void>(resolve => {
    child.once("close", () => { ended = true; resolve() })
  })
  return { child, closed, isClosed: () => ended, launchError: () => failure }
}

/** Wait for a fresh owned receipt via filesystem events, never retry an action. */
function waitOwnedFile572<T>(file: string, owner: WpfChild572, deadline: number, parse: (text: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { watcher.close() } catch { /* owned observer disposal cannot replace the primary outcome */ }
      if (error) reject(error)
      else resolve(value as T)
    }
    const check = () => {
      try {
        if (existsSync(file)) finish(undefined, parse(readFileSync(file, "utf8")))
      } catch (error) { finish(error) }
    }
    const watcher = watch(path.dirname(file), check)
    const timer = setTimeout(() => finish(new Error("WPF572_OWNED_RECEIPT_DEADLINE")), Math.max(1, deadline - performance.now()))
    void owner.closed.then(() => finish(owner.launchError() ?? new Error("WPF572_OWNER_CLOSED_BEFORE_RECEIPT")))
    check()
  })
}

/** Stop all owned handles even if an earlier close fails; preserve the primary error. */
async function cleanupOwnedWpf572(children: WpfChild572[], removeOwned: () => void, primary: unknown): Promise<void> {
  let cleanupError: unknown
  for (const owner of [...children].reverse()) {
    try {
      if (!owner.isClosed() && !owner.child.kill()) throw new Error("WPF572_OWNED_TERMINATE_FAILED")
    } catch (error) { cleanupError ??= error }
    try { await owner.closed } catch (error) { cleanupError ??= error }
  }
  try { removeOwned() } catch (error) { cleanupError ??= error }
  if (primary !== undefined) throw primary
  if (cleanupError !== undefined) throw cleanupError
}

async function runCurrentWpf572(t: TestContext, diagnostic = false): Promise<void> {
  const fixture = path.resolve("tests/fixtures/win/uia-wpf-fixture.ps1")
  const dir = mkdtempSync(path.join(tmpdir(), "uia-current-wpf-572-"))
  const children: WpfChild572[] = []
  // Same original fixture lifetime, shared across both owned windows and all checks.
  const deadline = performance.now() + 45_000
  const remaining = () => {
    const ms = Math.floor(deadline - performance.now())
    assert.ok(ms > 0, "original WPF fixture lifetime exhausted")
    return ms
  }
  const runOracle = async (args: string[]) => {
    assert.ok(children.every(owner => !owner.isClosed()), "owned WPF exited before acceptance completed")
    await runPs(resolveWinScript("computer-bg-oracles.ps1"), args, { timeoutMs: Math.min(15_000, remaining()) })
  }
  let primary: unknown
  let clientProbe: ReturnType<typeof makeWpfClientProbe572> | undefined
  let parentProbeRole = "UNKNOWN"
  try {
    const marker = path.join(dir, "target.marker"), siblingMarker = path.join(dir, "sibling.marker")
    const launch = async (role: "target" | "sibling") => {
      const ready = path.join(dir, `${role}.ready`)
      const receipt = path.join(dir, `${role}.acceptance.json`)
      const owner = startOwnedWpf572(fixture, ["-Marker", role === "target" ? marker : siblingMarker,
        "-Ready", ready, "-ButtonText", role === "target" ? "SubmitTest" : "ForegroundSibling",
        "-AcceptanceReady", receipt, "-AcceptanceTrace", path.join(dir, `${role}.events.jsonl`), "-AcceptanceRole", role,
        ...(role === "sibling" ? ["-OwnForeground"] : [])], remaining())
      children.push(owner)
      const value = await waitOwnedFile572(receipt, owner, deadline, text => JSON.parse(text) as { hwnd: number; foreground: number; active: boolean })
      assert.ok(Number.isSafeInteger(value.hwnd) && value.hwnd > 0)
      if (role === "sibling") {
        assert.equal(value.foreground, value.hwnd, "single owned activation must actually succeed")
        assert.equal(value.active, true)
      }
      return value.hwnd
    }
    const target = await launch("target"), sibling = await launch("sibling")
    assert.notEqual(target, sibling)
    assert.equal(existsSync(marker), false)
    assert.equal(existsSync(siblingMarker), false)
    const hit = await new PsUiaLocator().locate(target, "SubmitTest")
    assert.ok(hit)
    assert.equal(hit.controlType, "Button")
    assert.equal(hit.automationId, "cmspark_fixture_button")
    const beforePath = path.join(dir, "before.json"), afterPath = path.join(dir, "after.json"), verdictPath = path.join(dir, "verdict.json")
    await runOracle(["-Mode", "snapshot", "-TargetHwnd", String(target), "-Out", beforePath])
    const before = JSON.parse(readFileSync(beforePath, "utf8")) as WpfSnapshot572
    assert.equal(before.foreground, sibling, "the target must really be in the background before Invoke")
    const selected = makeCurrentWpfInjector572(diagnostic, dir, sibling)
    clientProbe = selected.probe
    const result = await selected.injector.invokeUia(target, hit.name, "invoke", {
      expectControlType: hit.controlType, expectAutomationId: hit.automationId,
    })
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error("WPF572_INVOKE_REFUSED")
    assert.equal(result.mode, "invoke")
    assert.equal(result.foreground, false)
    const targetMarker = await waitOwnedFile572(marker, children[0], deadline, text => text)
    await runOracle(["-Mode", "snapshot", "-TargetHwnd", String(target), "-Out", afterPath])
    await runOracle(["-Mode", "compare", "-Before", beforePath, "-After", afterPath, "-TargetHwnd", String(target), "-Delivery", "uia-pattern", "-Out", verdictPath])
    const after = JSON.parse(readFileSync(afterPath, "utf8")) as WpfSnapshot572
    const verdict = JSON.parse(readFileSync(verdictPath, "utf8")) as Record<string, unknown>
    // Closed role/boolean observations only. A diagnostic sink cannot alter acceptance or cleanup.
    try {
      const role = (handle: number) => handle === target ? "TARGET" : handle === sibling ? "SIBLING" : handle === 0 ? "NONE" : "OTHER"
      // This is the existing snapshot after actual client exit AND marker; not an exit-instant sample.
      parentProbeRole = role(after.foreground)
      t.diagnostic("WPF572_NATIVE_OBSERVATION " + JSON.stringify({ schema: 1,
        beforeForegroundRole: role(before.foreground), afterForegroundRole: role(after.foreground),
        targetChanged: /^clicked \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(targetMarker),
        siblingMarkerPresent: existsSync(siblingMarker),
        focusKept: verdict.focus_kept === true, zorderKept: verdict.zorder_kept === true,
        cursorKept: verdict.cursor_kept === true, noLeakedInput: verdict.no_leaked_input === true,
        backgroundVerified: verdict.background_verified === true,
      }))
    } catch { /* passive diagnostics never replace the primary acceptance result */ }
    assertCurrentWpfProof572(target, sibling, before, after, verdict, targetMarker, existsSync(siblingMarker))
    const changed = await new PsUiaLocator().locate(target, "Clicked OK")
    assert.ok(changed)
    assert.equal(changed.automationId, hit.automationId)
    assert.ok(children.every(owner => !owner.isClosed()), "both fixtures must remain alive through the assertions")
  } catch (error) { primary = error }
  finally {
    if (diagnostic) emitWpfClientProbe572(() => readFileSync(path.join(dir, "invoke-client-phases.jsonl"), "utf8"), value => t.diagnostic(value), clientProbe?.status() ?? "NOT_RUN", parentProbeRole)
    // Observe before termination so cleanup-induced deactivation is not mistaken for Invoke behavior.
    for (const role of ["target", "sibling"] as const) {
      emitWpfEvents572(role, () => readFileSync(path.join(dir, `${role}.events.jsonl`), "utf8"), value => t.diagnostic(value))
    }
    await cleanupOwnedWpf572(children, () => rmSync(dir, { recursive: true, force: true }), primary)
  }
  assert.ok(children.length === 2 && children.every(owner => owner.isClosed()), "both owned WPF handles must be closed")
  console.log(JSON.stringify({ schema: 1, kind: diagnostic ? "WPF572_CLIENT_PHASE_DIAGNOSTIC" : "WPF572_CURRENT_REAL_BACKGROUND", targetChanged: true,
    siblingUnchanged: true, actualForegroundSibling: true, focusKept: true, zorderKept: true,
    cursorKept: true, noLeakedInput: true, noLeakedInputKind: "derived", ownedChildrenClosed: 2 }))
}

// Both are mandatory independent cases, each with fresh windows/StopFile and its
// own original lifetime. Diagnostic success can never replace original acceptance.
test("#572 current WPF background Invoke changes only the target while all four desktop oracles hold", { skip: !available }, async (t) => {
  await runCurrentWpf572(t)
})

test("#572 current WPF background client-phase diagnostic retains the same strict oracles", { skip: !available }, async (t) => {
  await runCurrentWpf572(t, true)
})

test("#650 shipped UIA source parses as Unicode in actual Desktop PowerShell 5.1", { skip: !available }, async () => {
  const fixture = path.resolve("tests/fixtures/uia-script-encoding-650.ps1")
  const result = await promisify(execFile)(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-ScriptPath", path.resolve(SCRIPT!)], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })
  const proof = JSON.parse(result.stdout.trim())
  assert.equal(proof.desktop51, true)
  assert.equal(proof.current_errors, 0)
  assert.equal(proof.stop_literal_exact, true)
  assert.ok(Number.isSafeInteger(proof.ansi_counterfactual_errors) && proof.ansi_counterfactual_errors >= 1 && proof.ansi_counterfactual_errors <= 100)
})


// Portable controls exercise the exact diagnostic projection; WPF event delivery remains native-only.
test("#572 WPF event diagnostics accept only bounded fixed event records", () => {
  const row = { sequence: 1, event: "Activated", phase: "event", active: true, foregroundKnown: true, foregroundOwn: true }
  const valid = projectWpfEvents572(JSON.stringify(row) + "\n", "target")
  assert.equal(valid.valid, true)
  assert.equal(valid.role, "target")
  assert.deepEqual(valid.events, [row])
  assert.equal(projectWpfEvents572("", "target").valid, false)
  const rows = Array.from({ length: 16 }, (_, i) => ({ ...row, sequence: i + 1 }))
  assert.equal(projectWpfEvents572(rows.map(value => JSON.stringify(value)).join("\n") + "\n", "sibling").atLimit, true)
  assert.equal(projectWpfEvents572([...rows, { ...row, sequence: 17 }].map(value => JSON.stringify(value)).join("\n"), "target").valid, false)
  for (const change of [
    { event: "UNKNOWN_SECRET_PATH" }, { phase: "UNKNOWN_SECRET_BODY" }, { event: "Click", phase: "event" },
    { phase: "enter" }, { sequence: 2 }, { active: "secret" }, { foregroundOwn: 1 },
    { foregroundKnown: false }, { extra: "SECRET_BODY" },
  ]) {
    const output = projectWpfEvents572(JSON.stringify({ ...row, ...change }), "target")
    assert.equal(output.valid, false)
    assert.deepEqual(output.events, [])
    assert.doesNotMatch(JSON.stringify(output), /SECRET|UNKNOWN/)
  }
  for (const phase of ["enter", "exit"]) assert.equal(projectWpfEvents572(JSON.stringify({ ...row, event: "Click", phase }), "target").valid, true)
  for (const event of ["Deactivated", "ContentRendered"]) assert.equal(projectWpfEvents572(JSON.stringify({ ...row, event }), "target").valid, true)
  for (const text of ["not-json SECRET", "null", "[]", "x".repeat(4097)]) {
    assert.equal(projectWpfEvents572(text, "target").valid, false)
    assert.doesNotMatch(JSON.stringify(projectWpfEvents572(text, "target")), /SECRET/)
  }
})

test("#572 WPF event diagnostic sink failures preserve cleanup and original acceptance", async () => {
  const row = { sequence: 1, event: "Activated", phase: "event", active: true, foregroundKnown: true, foregroundOwn: true }
  const emitted: string[] = []
  emitWpfEvents572("target", () => JSON.stringify(row), value => { emitted.push(value) })
  assert.equal(emitted.length, 1)
  assert.match(emitted[0], /^WPF572_EVENT_OBSERVATION /)
  assert.equal(JSON.parse(emitted[0].slice("WPF572_EVENT_OBSERVATION ".length)).valid, true)
  emitWpfEvents572("target", () => { throw new Error("SECRET_PATH") }, value => { emitted.push(value) })
  assert.doesNotMatch(emitted.join("\n"), /SECRET_PATH/)
  emitWpfEvents572("sibling", () => JSON.stringify(row), () => { throw new Error("sink") })
  const primary = new Error("original assertion")
  let removed = 0, killed = 0
  const owner = { child: { kill() { killed++; return true } }, closed: Promise.resolve(), isClosed: () => false, launchError: () => undefined } as unknown as WpfChild572
  await assert.rejects(cleanupOwnedWpf572([owner], () => {
    emitWpfEvents572("target", () => JSON.stringify(row), () => { throw new Error("sink") })
    removed++
  }, primary), error => error === primary)
  assert.equal(killed, 1)
  assert.equal(removed, 1)
})

test("#572 client phase copy preserves every shipped byte and refuses ambiguous anchors", () => {
  assert.ok(SCRIPT)
  const original = readFileSync(SCRIPT!)
  for (const source of [original, Buffer.from(original.toString("utf8").replace(/\r?\n/g, "\r\n")), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original])]) {
    const observed = buildWpfClientProbe572(source, 44, "C:\\owned space\\O'Hare\\phases.jsonl")
    assert.ok(stripWpfClientProbe572(observed).equals(source))
    const before = source.toString("utf8"), after = observed.toString("utf8")
    assert.equal(after.split("Add-Type").length, before.split("Add-Type").length)
    assert.equal(after.split("([System.Windows.Automation.InvokePattern]$o).Invoke()").length, before.split("([System.Windows.Automation.InvokePattern]$o).Invoke()").length)
    assert.ok(after.includes("O''Hare"))
    assert.ok(after.includes("-ge 4"))
    assert.equal(after.includes("SetForegroundWindow("), before.includes("SetForegroundWindow("))
  }
  for (const source of [Buffer.from(original.toString("utf8").replace("exit 0", "exit 1")), Buffer.concat([original, Buffer.from("\nexit 0\n")])]) {
    assert.throws(() => buildWpfClientProbe572(source, 44, "owned"))
  }
  assert.throws(() => buildWpfClientProbe572(original, 0, "owned"))
})

test("#572 client probe keeps the real runner argv, stdout and rejection on instrumentation failure", async () => {
  assert.ok(SCRIPT)
  const dir = mkdtempSync(path.join(tmpdir(), "uia-client-probe-cpu-"))
  try {
    const source = readFileSync(SCRIPT!), script = path.join(dir, "computer-uia-invoke.ps1")
    writeFileSync(script, source)
    const args = ["-Hwnd", "40", "-Name", "SubmitTest", "-Mode", "invoke", "-StopFile", path.join(dir, "absent.stop")]
    const opts = { timeoutMs: 15000 }
    let calls = 0
    const probe = makeWpfClientProbe572(dir, 44, async (actual, received, options) => {
      calls++
      assert.notEqual(actual, script)
      assert.ok(stripWpfClientProbe572(readFileSync(actual)).equals(source))
      assert.equal(received, args)
      assert.equal(options, opts)
      return '{"ok":true}'
    })
    assert.equal(await probe.run(script, args, opts), '{"ok":true}')
    assert.equal(probe.status(), "READY")
    assert.equal(calls, 1)
    // A source-guard failure still executes the original runner once and
    // preserves its rejection object; it is not a new action/refusal path.
    writeFileSync(script, source.toString("utf8").replace("exit 0", "exit 1"))
    const primary = new Error("OWNED_ORIGINAL_REFUSAL")
    const refused = makeWpfClientProbe572(dir, 44, async (actual, received, options) => {
      calls++
      assert.equal(actual, script)
      assert.equal(received, args)
      assert.equal(options, opts)
      throw primary
    })
    await assert.rejects(refused.run(script, args, opts), error => error === primary)
    assert.equal(refused.status(), "UNAVAILABLE")
    assert.equal(calls, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("#572 client phase projection is closed and sink errors preserve primary cleanup", async () => {
  const names = ["BEFORE_FROM_HANDLE", "PRE_INVOKE", "POST_INVOKE", "PRE_EXIT"]
  const rows = names.map((phase, index) => ({ sequence: index + 1, phase, foregroundRole: "SIBLING" }))
  const text = rows.map(value => JSON.stringify(value)).join("\r\n")
  const proof = projectWpfClientProbe572(text, "READY", "TARGET")
  assert.equal(proof.complete, true)
  assert.equal(proof.parentSnapshotPhase, "AFTER_CLIENT_CLOSE_AND_MARKER")
  assert.equal(proof.parentForegroundRole, "TARGET")
  assert.equal(projectWpfClientProbe572(JSON.stringify(rows[0]), "READY", "UNKNOWN").complete, false)
  for (const bad of ["", "x".repeat(4097), JSON.stringify({ ...rows[0], extra: "NEVER_REFLECT" }), JSON.stringify({ ...rows[0], foregroundRole: "NEVER_REFLECT" }), JSON.stringify(rows[1]), text + "\n" + JSON.stringify(rows[0])]) {
    const output = projectWpfClientProbe572(bad, "READY", "NEVER_REFLECT")
    assert.equal(output.valid, false)
    assert.equal(JSON.stringify(output).includes("NEVER_REFLECT"), false)
  }
  const primary = new Error("OWNED_PRIMARY"), closed: string[] = []
  emitWpfClientProbe572(() => text, () => { throw new Error("OWNED_SINK") }, "READY", "TARGET")
  await assert.rejects(cleanupOwnedWpf572([{ child: { kill: () => { closed.push("kill"); return true } }, closed: Promise.resolve(), isClosed: () => false, launchError: () => undefined } as unknown as WpfChild572], () => { closed.push("remove") }, primary), error => error === primary)
  assert.deepEqual(closed, ["kill", "remove"])
})


test("#572 client route selection keeps normal acceptance on the actual default runner", () => {
  const dir = path.join(tmpdir(), "owned-not-created-route-selection")
  const normal = makeCurrentWpfInjector572(false, dir, 44)
  const observed = makeCurrentWpfInjector572(true, dir, 44)
  // Construction only: no PS execution or owned file write occurs here.
  const runnerOf = (value: PsInputInjector) => (value as unknown as { runner: PsRunner }).runner
  const stopOf = (value: PsInputInjector) => (value as unknown as { stopFile: string }).stopFile
  assert.equal(normal.probe, undefined)
  assert.equal(runnerOf(normal.injector), runPs)
  assert.ok(observed.probe)
  assert.equal(runnerOf(observed.injector), observed.probe.run)
  assert.notEqual(runnerOf(observed.injector), runPs)
  assert.equal(stopOf(normal.injector), path.join(dir, "absent.stop"))
  assert.equal(stopOf(observed.injector), stopOf(normal.injector))
  assert.equal(observed.probe.status(), "NOT_RUN")
})
