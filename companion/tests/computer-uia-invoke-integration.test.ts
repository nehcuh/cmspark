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
import test from "node:test"
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
import { resolveWinScript, runPs } from "../src/host-use/win/powershell"

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

test("#572 current WPF background Invoke changes only the target while all four desktop oracles hold", { skip: !available }, async () => {
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
  try {
    const marker = path.join(dir, "target.marker"), siblingMarker = path.join(dir, "sibling.marker")
    const launch = async (role: "target" | "sibling") => {
      const ready = path.join(dir, `${role}.ready`)
      const receipt = path.join(dir, `${role}.acceptance.json`)
      const owner = startOwnedWpf572(fixture, ["-Marker", role === "target" ? marker : siblingMarker,
        "-Ready", ready, "-ButtonText", role === "target" ? "SubmitTest" : "ForegroundSibling",
        "-AcceptanceReady", receipt, ...(role === "sibling" ? ["-OwnForeground"] : [])], remaining())
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
    const result = await new PsInputInjector(undefined, path.join(dir, "absent.stop")).invokeUia(target, hit.name, "invoke", {
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
    assertCurrentWpfProof572(target, sibling, before, after, verdict, targetMarker, existsSync(siblingMarker))
    const changed = await new PsUiaLocator().locate(target, "Clicked OK")
    assert.ok(changed)
    assert.equal(changed.automationId, hit.automationId)
    assert.ok(children.every(owner => !owner.isClosed()), "both fixtures must remain alive through the assertions")
  } catch (error) { primary = error }
  finally { await cleanupOwnedWpf572(children, () => rmSync(dir, { recursive: true, force: true }), primary) }
  assert.ok(children.length === 2 && children.every(owner => owner.isClosed()), "both owned WPF handles must be closed")
  console.log(JSON.stringify({ schema: 1, kind: "WPF572_CURRENT_REAL_BACKGROUND", targetChanged: true,
    siblingUnchanged: true, actualForegroundSibling: true, focusKept: true, zorderKept: true,
    cursorKept: true, noLeakedInput: true, noLeakedInputKind: "derived", ownedChildrenClosed: 2 }))
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

