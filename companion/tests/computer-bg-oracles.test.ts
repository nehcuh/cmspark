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

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
// The .ps1 is NOT compiled into .test-dist (only .ts is), so resolve it against the CWD the
// runner uses (repo root or companion/) exactly like the other source-text guards do.
const SCRIPT_REL = "src/host-use/win/scripts/computer-bg-oracles.ps1"
const SCRIPT = [SCRIPT_REL, path.join("companion", SCRIPT_REL)].find((p) => existsSync(p)) ?? SCRIPT_REL
const available = process.platform === "win32" && existsSync(PS) && existsSync(SCRIPT)

type Snap = {
  ts: string
  foreground: number
  cursor: { x: number; y: number; got: boolean }
  zorder: number[]
}

const run = (args: string[]) =>
  new Promise<{ err: unknown; stderr: string }>((res) => {
    execFile(
      PS,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { encoding: "utf8", windowsHide: true },
      (err, _stdout, stderr) => res({ err, stderr: String(stderr || "") }),
    )
  })

/** Run the comparator on two synthetic snapshots and return its verdict. */
async function compare(
  dir: string,
  before: Snap,
  after: Snap,
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
