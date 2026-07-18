// A10 policy gates — full matrix (plan G.3). Pure functions over injected
// config; no fs, no Win32. Assertions target typed error CODES (fail-closed
// contract), never message text beyond a few load-bearing substrings.

import test from "node:test"
import assert from "node:assert/strict"

import {
  assertCoordinateAllowed,
  assertHwndOwnedByEntry,
  canEverCoordinate,
  normalizeExePath,
} from "../src/computer/policy"
import { ComputerError, type WindowInfo } from "../src/computer/types"
import { normalizeAppEntry, validateAppEntry, type AppEntry } from "../src/apps/types"
import type { CompanionConfig } from "../src/config"

// --- fixtures ---------------------------------------------------------------

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"

function makeEntry(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    token: "win.app.test",
    kind: "gui",
    display_name: "Test App",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: EXE, signer: "CN=Test", user_writable_dir: false },
    coordinateAllowed: true,
    ...overrides,
  } as AppEntry
}

function makeConfig(overrides: {
  coordinateEnabled?: boolean
  appsEnabled?: boolean
  entry?: AppEntry | null
} = {}): CompanionConfig {
  const entry = overrides.entry === undefined ? makeEntry() : overrides.entry
  return {
    apps: {
      enabled: overrides.appsEnabled ?? true,
      entries: entry ? { [entry.token]: entry } : {},
    },
    computer: { coordinateEnabled: overrides.coordinateEnabled ?? true },
  } as unknown as CompanionConfig
}

function assertComputerError(fn: () => unknown, code: string, messagePart?: string) {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof ComputerError, `expected ComputerError, got ${String(err)}`)
    assert.equal((err as ComputerError).code, code)
    if (messagePart) assert.ok((err as ComputerError).message.includes(messagePart))
    return err as ComputerError
  }
  assert.fail(`expected ComputerError ${code}, but no error was thrown`)
}

// --- canEverCoordinate (structural exclusion, A10.3) --------------------------

test("policy: canEverCoordinate — plain app exe is eligible", () => {
  assert.equal(canEverCoordinate(makeEntry()), true)
})

test("policy: canEverCoordinate — chrome (vault browser) is structurally excluded", () => {
  assert.equal(canEverCoordinate(makeEntry({ exe: { path: CHROME_EXE, user_writable_dir: false } })), false)
})

test("policy: canEverCoordinate — powershell (LOLBIN) is structurally excluded", () => {
  assert.equal(canEverCoordinate(makeEntry({ exe: { path: POWERSHELL_EXE, user_writable_dir: false } })), false)
})

test("policy: canEverCoordinate — AUMID entry (no exe path) stays eligible", () => {
  const entry = makeEntry({ exe: undefined, aumid: "Test.App_x1y2z3!App" } as Partial<AppEntry>)
  assert.equal(canEverCoordinate(entry), true)
})

// --- assertCoordinateAllowed matrix -------------------------------------------

test("policy: malformed token -> APP_NOT_WHITELISTED", () => {
  assertComputerError(() => assertCoordinateAllowed(makeConfig(), "not-a-token"), "APP_NOT_WHITELISTED")
})

test("policy: apps feature disabled -> APP_NOT_WHITELISTED", () => {
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ appsEnabled: false }), "win.app.test"),
    "APP_NOT_WHITELISTED",
  )
})

test("policy: global switch off -> COMPUTER_DISABLED (A10 switch 1)", () => {
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ coordinateEnabled: false }), "win.app.test"),
    "COMPUTER_DISABLED",
  )
})

test("policy: unknown token -> APP_NOT_WHITELISTED", () => {
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: null }), "win.app.test"),
    "APP_NOT_WHITELISTED",
  )
})

test("policy: entry disabled in App tab -> APP_NOT_WHITELISTED", () => {
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: makeEntry({ enabled: false }) }), "win.app.test"),
    "APP_NOT_WHITELISTED",
  )
})

test("policy: non-gui kind -> APP_NOT_WHITELISTED", () => {
  const cli = makeEntry({ token: "win.cli.test", kind: "cli" } as Partial<AppEntry>)
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: cli }), "win.cli.test"),
    "APP_NOT_WHITELISTED",
  )
})

test("policy: chrome exe + coordinateAllowed=true (hand-edited config) -> APP_COORDINATE_STRUCTURAL", () => {
  const tampered = makeEntry({ exe: { path: CHROME_EXE, user_writable_dir: false }, coordinateAllowed: true })
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: tampered }), "win.app.test"),
    "APP_COORDINATE_STRUCTURAL",
  )
})

test("policy: powershell exe + coordinateAllowed=true (hand-edited) -> APP_COORDINATE_STRUCTURAL", () => {
  const tampered = makeEntry({ exe: { path: POWERSHELL_EXE, user_writable_dir: false }, coordinateAllowed: true })
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: tampered }), "win.app.test"),
    "APP_COORDINATE_STRUCTURAL",
  )
})

test("policy: coordinateAllowed=false -> APP_COORDINATE_DENIED (A10 switch 2)", () => {
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry: makeEntry({ coordinateAllowed: false }) }), "win.app.test"),
    "APP_COORDINATE_DENIED",
  )
})

test("policy: coordinateAllowed absent -> APP_COORDINATE_DENIED (default-deny)", () => {
  const entry = makeEntry()
  delete (entry as any).coordinateAllowed
  assertComputerError(
    () => assertCoordinateAllowed(makeConfig({ entry }), "win.app.test"),
    "APP_COORDINATE_DENIED",
  )
})

test("policy: both switches on + clean entry -> returns the entry", () => {
  const entry = makeEntry()
  const got = assertCoordinateAllowed(makeConfig({ entry }), "win.app.test")
  assert.equal(got.token, "win.app.test")
})

// --- normalizeExePath ---------------------------------------------------------

test("policy: normalizeExePath folds case and forward slashes", () => {
  const a = normalizeExePath("C:/Program Files/TestApp/APP.EXE")
  const b = normalizeExePath("c:\\program files\\testapp\\app.exe")
  assert.equal(a, b)
})

// --- assertHwndOwnedByEntry (B5) ----------------------------------------------

function hwndInfo(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd: 424242,
    pid: 1234,
    exePath: EXE,
    title: "Test App",
    rect: { x: 0, y: 0, width: 640, height: 480 },
    alive: true,
    ...overrides,
  }
}

test("policy: dead hwnd -> HWND_DEAD", () => {
  assertComputerError(() => assertHwndOwnedByEntry(hwndInfo({ alive: false }), makeEntry()), "HWND_DEAD")
})

test("policy: entry without exe path -> HWND_NOT_OWNED", () => {
  const aumidEntry = makeEntry({ exe: undefined, aumid: "Test.App_x1y2z3!App" } as Partial<AppEntry>)
  assertComputerError(() => assertHwndOwnedByEntry(hwndInfo(), aumidEntry), "HWND_NOT_OWNED")
})

test("policy: hwnd exe matches entry exe (exact) -> ok", () => {
  assertHwndOwnedByEntry(hwndInfo(), makeEntry())
})

test("policy: hwnd exe matches case-insensitively (NTFS) -> ok", () => {
  assertHwndOwnedByEntry(hwndInfo({ exePath: "c:\\program files\\testapp\\app.exe" }), makeEntry())
})

test("policy: hwnd exe matches with forward slashes -> ok", () => {
  assertHwndOwnedByEntry(hwndInfo({ exePath: "C:/Program Files/TestApp/app.exe" }), makeEntry())
})

test("policy: hwnd exe drift -> HWND_NOT_OWNED with expected/actual detail", () => {
  const err = assertComputerError(
    () => assertHwndOwnedByEntry(hwndInfo({ exePath: "C:\\evil\\replaced.exe" }), makeEntry()),
    "HWND_NOT_OWNED",
  ) as ComputerError
  assert.equal(err.detail?.expected, EXE)
  assert.equal(err.detail?.actual, "C:\\evil\\replaced.exe")
})

test("policy: hwnd with no exePath -> HWND_NOT_OWNED", () => {
  assertComputerError(() => assertHwndOwnedByEntry(hwndInfo({ exePath: "" }), makeEntry()), "HWND_NOT_OWNED")
})

// --- normalizeAppEntry: A10.3 force-clear --------------------------------------

test("policy: normalizeAppEntry force-clears coordinateAllowed on a vault binary (chrome)", () => {
  const tampered = makeEntry({ exe: { path: CHROME_EXE, user_writable_dir: false }, coordinateAllowed: true })
  const errors: string[] = []
  const origError = console.error
  console.error = (msg: unknown) => errors.push(String(msg))
  try {
    const out = normalizeAppEntry(tampered)
    assert.equal(out.coordinateAllowed, false)
    assert.ok(errors.some((m) => m.includes("force-cleared")), "loud log on force-clear")
  } finally {
    console.error = origError
  }
})

test("policy: normalizeAppEntry force-clears coordinateAllowed on a LOLBIN (powershell)", () => {
  const tampered = makeEntry({ exe: { path: POWERSHELL_EXE, user_writable_dir: false }, coordinateAllowed: true })
  const out = normalizeAppEntry(tampered)
  assert.equal(out.coordinateAllowed, false)
})

test("policy: normalizeAppEntry keeps coordinateAllowed=true on a clean binary", () => {
  const entry = makeEntry({ coordinateAllowed: true })
  const out = normalizeAppEntry(entry)
  assert.equal(out.coordinateAllowed, true)
})

test("policy: normalizeAppEntry returns the same object when nothing changes", () => {
  const entry = makeEntry()
  assert.equal(normalizeAppEntry(entry), entry)
})

// --- validateAppEntry: coordinateAllowed schema ---------------------------------

test("policy: validateAppEntry accepts coordinateAllowed boolean", () => {
  assert.equal(validateAppEntry(makeEntry({ coordinateAllowed: true })), null)
  assert.equal(validateAppEntry(makeEntry({ coordinateAllowed: false })), null)
})

test("policy: validateAppEntry accepts a missing coordinateAllowed", () => {
  const entry = makeEntry()
  delete (entry as any).coordinateAllowed
  assert.equal(validateAppEntry(entry), null)
})

test("policy: validateAppEntry rejects non-boolean coordinateAllowed", () => {
  const entry = makeEntry()
  ;(entry as any).coordinateAllowed = "yes"
  const err = validateAppEntry(entry)
  assert.ok(err !== null && err.includes("coordinateAllowed must be a boolean"))
})
