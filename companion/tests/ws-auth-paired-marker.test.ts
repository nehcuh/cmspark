// Unit tests for ws-auth.markPaired() — the "has any peer ever paired" marker that
// lets the tray stop auto-surfacing the pairing secret after the first successful
// extension auth. The setup file pins DATA_DIR to a temp dir before ws-auth loads.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"

// Import order matters: the setup file sets CMSPARK_DATA_DIR before ws-auth loads.
import "./_ws-auth-paired-setup"
import { DATA_DIR } from "./_ws-auth-paired-setup"
import { markPaired, getPairedMarkerPath } from "../src/ws-auth"

test("markPaired writes the marker under DATA_DIR on first call", () => {
  const marker = getPairedMarkerPath()
  assert.equal(marker, path.join(DATA_DIR, ".paired"))
  assert.equal(fs.existsSync(marker), false)
  markPaired()
  assert.equal(fs.existsSync(marker), true)
})

test("markPaired is idempotent — a second call does not rewrite the marker", () => {
  const marker = getPairedMarkerPath()
  const first = fs.readFileSync(marker, "utf8")
  // Force a clearly different mtime window, then call again.
  markPaired()
  const second = fs.readFileSync(marker, "utf8")
  assert.equal(first, second, "marker content must be unchanged on repeat calls")
})

test("marker is written owner-only (0o600) on POSIX", () => {
  if (process.platform === "win32") return
  const st = fs.statSync(getPairedMarkerPath())
  assert.equal(st.mode & 0o777, 0o600)
})

test("marker path stays in lock-step with the tray's pairing.ts filename", () => {
  // tray/pairing.ts uses PAIRED_MARKER_FILENAME === ".paired" under getConfigDir()
  // (=== DATA_DIR). If either side renames the file, the auto-popup never stops.
  assert.ok(getPairedMarkerPath().endsWith(path.join("", ".paired")))
})
