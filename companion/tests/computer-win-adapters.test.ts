// rethrowComputerPsError prefix-mapping unit tests (review N10). Pure
// function over { stderr } — no PowerShell ever spawns here. The mapping is
// the ps1 stderr-prefix -> typed ComputerError contract used by every
// adapter; assertions lock the WHOLE table plus the fall-through shapes.

import test from "node:test"
import assert from "node:assert/strict"

import { rethrowComputerPsError } from "../src/computer/win-adapters"
import { ComputerError, type ComputerErrorCode } from "../src/computer/types"

function mappingOf(prefix: string, label = "test"): { code: ComputerErrorCode; message: string; psPrefix: unknown } {
  try {
    rethrowComputerPsError({ stderr: `${prefix}: something went wrong` }, label)
  } catch (err) {
    assert.ok(err instanceof ComputerError, `${prefix}: expected ComputerError, got ${String(err)}`)
    const ce = err as ComputerError
    return { code: ce.code, message: ce.message, psPrefix: ce.detail?.psPrefix }
  }
  return assert.fail(`${prefix}: expected a throw`)
}

const EXPECTED: Record<string, ComputerErrorCode> = {
  HWNDDEAD: "HWND_DEAD",
  ILDENIED: "INTEGRITY_LEVEL_DENIED",
  DESKTOPDENIED: "DESKTOP_DENIED",
  OUTOFBOUNDS: "OUT_OF_BOUNDS",
  OCCLUDED: "CLICK_OCCLUDED",
  FOCUSLOST: "FOCUS_LOST",
  OCRLANGMISSING: "OCR_LANGUAGE_MISSING",
  SENDFAILED: "INJECT_FAILED",
  CAPTUREFAILED: "CAPTURE_FAILED",
  DIFFFAILED: "CAPTURE_FAILED",
  SEALFAILED: "EVIDENCE_ERROR",
  BADARGS: "INVALID_ACTION",
}

for (const [prefix, code] of Object.entries(EXPECTED)) {
  test(`ps error prefix ${prefix} -> ${code}`, () => {
    const m = mappingOf(prefix)
    assert.equal(m.code, code)
    assert.equal(m.psPrefix, prefix)
    assert.ok(m.message.includes("something went wrong"), "detail text preserved")
  })
}

test("ps error: multiline stderr picks the PREFIX line, not the noise", () => {
  try {
    rethrowComputerPsError({ stderr: "some powershell warning\nHWNDDEAD: window is gone\nmore noise" }, "multi")
    assert.fail("expected a throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "HWND_DEAD")
  }
})

test("ps error: unknown stderr (no prefix) -> INJECT_FAILED with stderr preserved", () => {
  try {
    rethrowComputerPsError({ stderr: "Everything is broken" }, "unknown")
    assert.fail("expected a throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "INJECT_FAILED")
    assert.ok((err as ComputerError).message.includes("Everything is broken"))
  }
})

test("ps error: no stderr at all -> original error rethrown untouched", () => {
  const original = new Error("spawn ENOENT")
  try {
    rethrowComputerPsError(original, "nostderr")
    assert.fail("expected a throw")
  } catch (err) {
    assert.equal(err, original, "must not wrap what it cannot classify")
  }
})

test("ps error: label is carried into the message", () => {
  const m = mappingOf("ILDENIED", "inject.click")
  assert.ok(m.message.startsWith("computer.inject.click:"))
})
