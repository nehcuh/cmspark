// computer-*.ps1 static security guards (adversary WP2 X2).
//
// The ps1 scripts have NO behavioral test coverage (they need a real GUI);
// these content assertions lock the two properties that must never silently
// regress:
//   1. UTF-8 BOM on every computer-*.ps1 — PowerShell 5.1 reads BOM-less
//      UTF-8 as ANSI, mangling CJK literals (danger words, error messages);
//   2. the key branch re-verifies GetForegroundWindow BEFORE its SendBatch —
//      keys go to the FOCUS window, not a screen point, so a popup in the
//      post-ForceForeground settle window would eat enter/space/alt,f4 (X2).

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

// Compiled tests live in .test-dist/tests — resolve the REAL source scripts.
const SCRIPTS_DIR = path.resolve(__dirname, "..", "..", "src", "host-use", "win", "scripts")
const COMPUTER_PS1 = [
  "computer-input.ps1",
  "computer-estop.ps1",
  "computer-probe.ps1",
  "computer-preview.ps1",
  "computer-uia-probe.ps1",
  "computer-uia-locate.ps1",
  "computer-uia-watch.ps1",
]

test("ps1 guard: every computer-*.ps1 carries a UTF-8 BOM (efbbbf)", () => {
  for (const name of COMPUTER_PS1) {
    const p = path.join(SCRIPTS_DIR, name)
    assert.ok(fs.existsSync(p), `missing script ${p}`)
    const head = fs.readFileSync(p).subarray(0, 3)
    assert.deepEqual(
      [...head],
      [0xef, 0xbb, 0xbf],
      `${name}: UTF-8 BOM missing — PowerShell 5.1 would misread the file as ANSI`,
    )
  }
})

test("ps1 guard (X2): key branch re-verifies foreground BEFORE SendBatch, drift -> FOCUSLOST", () => {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, "computer-input.ps1"), "utf8")
  const branchStart = src.indexOf("'key' {")
  assert.notEqual(branchStart, -1, "key branch exists")
  const branchEnd = src.indexOf("'scroll' {", branchStart)
  assert.notEqual(branchEnd, -1, "scroll branch follows key branch")
  const branch = src.slice(branchStart, branchEnd)
  const fgCheck = branch.indexOf("GetForegroundWindow() -ne $hwndPtr")
  const sendBatch = branch.indexOf("SendBatch($batch)")
  assert.notEqual(fgCheck, -1, "key branch must re-check foreground before injecting")
  assert.notEqual(sendBatch, -1, "key branch sends its chord via SendBatch")
  assert.ok(
    fgCheck < sendBatch,
    "the foreground re-check must come BEFORE SendBatch (a check after injection is worthless)",
  )
  assert.match(branch, /FOCUSLOST/, "foreground drift in the key branch fails FOCUSLOST (fail-closed)")
})
