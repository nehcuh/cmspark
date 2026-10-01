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
