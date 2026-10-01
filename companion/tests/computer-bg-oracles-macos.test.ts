// #571 — the macOS background oracles must be able to FAIL.
//
// A verifier that can only say "pass" is worthless. `scripts/computer-bg-oracles.sh` compares
// two desktop snapshots and decides whether a delivery really happened in the background; this
// file feeds it synthetic snapshots and asserts each flag flips to false when its condition is
// violated — plus that an UNREADABLE reading fails closed rather than rounding up to a pass.
//
// Why these live in the companion test suite rather than a Mac-only harness: `compare` is pure
// node logic over JSON, so it is fully exercisable anywhere. The Mac-only part (reading real
// windows and the real cursor through cmspark-host) is `snapshot`, which is exercised by hand on
// a Mac and recorded in the capability ledger.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const SCRIPT_REL = "scripts/computer-bg-oracles.sh"
const SCRIPT = [SCRIPT_REL, path.join("..", SCRIPT_REL)].find((p) => existsSync(p))
// macOS is the intended home, but compare is cross-platform; run it wherever bash+node exist.
const available = !!SCRIPT

type Snap = {
  foreground: number | null
  zorder: number[]
  cursor: { x: number; y: number } | null
}

const BASE: Snap = { foreground: 100, zorder: [100, 101, 102], cursor: { x: 10, y: 10 } }

/** Run the comparator on two synthetic snapshots and return its verdict. */
function compare(dir: string, before: Snap, after: Snap, delivery: "ax-action" | "sendinput" = "ax-action") {
  const b = path.join(dir, "b.json")
  const a = path.join(dir, "a.json")
  const out = path.join(dir, "out.json")
  for (const f of [b, a, out]) rmSync(f, { force: true })
  writeFileSync(b, JSON.stringify(before))
  writeFileSync(a, JSON.stringify(after))
  execFileSync("bash", [SCRIPT!, "compare", "-before", b, "-after", a, "-out", out, "--delivery", delivery], {
    stdio: "pipe",
  })
  assert.ok(existsSync(out), "comparator wrote no result")
  return JSON.parse(readFileSync(out, "utf8"))
}

test("#571 macOS oracle: identical desktop state verifies as background", { skip: !available }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, BASE, BASE)
    assert.equal(r.focus_kept, true)
    assert.equal(r.zorder_kept, true)
    assert.equal(r.cursor_kept, true)
    assert.equal(r.no_leaked_input, true)
    assert.equal(r.background_verified, true, "identical state must verify — else nothing could")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: a foreground change flips verification to false", { skip: !available }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, BASE, { ...BASE, foreground: 999 })
    assert.equal(r.focus_kept, false)
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: a cursor move flips verification to false", { skip: !available }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, BASE, { ...BASE, cursor: { x: 11, y: 10 } })
    assert.equal(r.cursor_kept, false)
    assert.equal(r.zorder_kept, true, "a cursor move is not a z-order change")
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: a z-order change flips verification to false", { skip: !available }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, BASE, { ...BASE, zorder: [101, 100, 102] })
    assert.equal(r.zorder_kept, false)
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: an UNREADABLE reading fails closed, not open", { skip: !available }, () => {
  // The important asymmetry. `snapshot` records null when the host binary is missing or a
  // reading refuses; "I could not measure it" must never become "it passed".
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const focusUnknown = compare(dir, BASE, { ...BASE, foreground: null })
    assert.equal(focusUnknown.focus_kept, null, "unreadable focus stays null, not true")
    assert.equal(focusUnknown.background_verified, false)

    const cursorUnknown = compare(dir, BASE, { ...BASE, cursor: null })
    assert.equal(cursorUnknown.cursor_kept, null, "unreadable cursor stays null, not true")
    assert.equal(cursorUnknown.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: an AX delivery cannot claim background if nothing was readable", { skip: !available }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, { foreground: null, zorder: [], cursor: null }, { foreground: null, zorder: [], cursor: null })
    assert.equal(r.background_verified, false, "no readings ⇒ nothing can be verified")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("#571 macOS oracle: the coordinate path cannot claim background, even if nothing moved", { skip: !available }, () => {
  // The load-bearing case: the oracle must distinguish *why* the desktop is unchanged.
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-mac-"))
  try {
    const r = compare(dir, BASE, BASE, "sendinput")
    assert.equal(r.focus_kept, true)
    assert.equal(r.no_leaked_input, false, "the foreground path must never pass the leak oracle")
    assert.equal(r.background_verified, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
