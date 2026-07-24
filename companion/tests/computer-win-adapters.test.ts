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
  STOPPED: "TASK_ABORTED",
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

// --- X6: temp-capture janitor --------------------------------------------------
// Filenames: `${prefix}-${pid}-${12hex}.png` (prefix itself may contain '-').
// Removal rule: pid is not ours AND (process is dead OR file older than TTL).

import { sweepComputerTempCaptures, type SweepFsLike } from "../src/computer/win-adapters"

function fakeFs(files: Record<string, number /* mtimeMs */>): { fsLike: SweepFsLike; removedPaths: string[] } {
  const removedPaths: string[] = []
  const fsLike: SweepFsLike = {
    readdirSync: () => Object.keys(files),
    statSync: (p) => {
      const name = p.split(/[\\/]/).pop()!
      if (!(name in files)) throw new Error("ENOENT")
      return { mtimeMs: files[name] }
    },
    rmSync: (p) => { removedPaths.push(p.split(/[\\/]/).pop()!) },
  }
  return { fsLike, removedPaths }
}

const NOW = 10_000_000
const HOUR = 3_600_000

test("X6 sweep: dead pid's capture is removed", () => {
  const { fsLike, removedPaths } = fakeFs({ "cap-4444-aaaaaaaaaaaa.png": NOW - 1000 })
  const r = sweepComputerTempCaptures({
    dir: "t", now: NOW, selfPid: 1111, fsLike,
    isPidAlive: () => false,
  })
  assert.deepEqual(removedPaths, ["cap-4444-aaaaaaaaaaaa.png"])
  assert.deepEqual(r.removed, ["cap-4444-aaaaaaaaaaaa.png"])
})

test("X6 sweep: own pid is NEVER removed, even when stale", () => {
  const { fsLike, removedPaths } = fakeFs({ "cap-1111-aaaaaaaaaaaa.png": NOW - 10 * HOUR })
  const r = sweepComputerTempCaptures({ dir: "t", now: NOW, selfPid: 1111, fsLike, isPidAlive: () => false })
  assert.deepEqual(removedPaths, [])
  assert.deepEqual(r.kept, ["cap-1111-aaaaaaaaaaaa.png"])
})

test("X6 sweep: live pid + fresh file is kept", () => {
  const { fsLike, removedPaths } = fakeFs({ "cap-4444-aaaaaaaaaaaa.png": NOW - 1000 })
  const r = sweepComputerTempCaptures({ dir: "t", now: NOW, selfPid: 1111, fsLike, isPidAlive: () => true })
  assert.deepEqual(removedPaths, [])
  assert.deepEqual(r.kept, ["cap-4444-aaaaaaaaaaaa.png"])
})

test("X6 sweep: live pid + file older than TTL is removed (wedged task pins nothing)", () => {
  const { fsLike, removedPaths } = fakeFs({ "cap-4444-aaaaaaaaaaaa.png": NOW - 2 * HOUR })
  const r = sweepComputerTempCaptures({ dir: "t", now: NOW, selfPid: 1111, fsLike, isPidAlive: () => true })
  assert.deepEqual(removedPaths, ["cap-4444-aaaaaaaaaaaa.png"])
})

test("X6 sweep: hyphenated prefix parses (diffregion-a) and foreign names are kept", () => {
  const { fsLike, removedPaths } = fakeFs({
    "diffregion-a-4444-bbbbbbbbbbbb.png": NOW - 1000, // dead pid -> removed
    "diffregion-b-4444-nothexsuffix.png": NOW - 10 * HOUR, // bad suffix -> kept
    "unrelated.txt": NOW - 10 * HOUR,
    "cap-4444-aaaaaaaaaaaa.bak": NOW - 10 * HOUR,
  })
  const r = sweepComputerTempCaptures({ dir: "t", now: NOW, selfPid: 1111, fsLike, isPidAlive: () => false })
  assert.deepEqual(removedPaths, ["diffregion-a-4444-bbbbbbbbbbbb.png"])
  assert.equal(r.kept.length, 3)
})

test("X6 sweep: missing temp dir is a no-op (never throws)", () => {
  const r = sweepComputerTempCaptures({
    dir: "t", now: NOW, selfPid: 1111,
    fsLike: {
      readdirSync: () => { throw new Error("ENOENT") },
      statSync: () => { throw new Error("ENOENT") },
      rmSync: () => {},
    },
  })
  assert.deepEqual(r, { removed: [], kept: [] })
})
