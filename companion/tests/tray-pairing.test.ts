// Unit tests for the pure tray pairing helpers (companion/src/tray/pairing.ts).
// These back the tray's pairing-code popup: reading the WS shared secret + the
// "has any peer ever paired" marker + per-platform clipboard resolution. All pure
// (configDir / platform injected) so no DATA_DIR env juggling is needed.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import {
  readPairingSecret,
  hasPaired,
  getWsSecretPath,
  getPairedMarkerPath,
  resolveClipboardCommand,
  WS_SECRET_FILENAME,
  PAIRED_MARKER_FILENAME,
} from "../src/tray/pairing"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tray-pairing-"))
}

test("path helpers join the canonical filenames under configDir", () => {
  const d = "/tmp/fake-cmspark-dir"
  assert.equal(WS_SECRET_FILENAME, "ws_secret")
  assert.equal(PAIRED_MARKER_FILENAME, ".paired")
  assert.equal(getWsSecretPath(d), path.join(d, "ws_secret"))
  assert.equal(getPairedMarkerPath(d), path.join(d, ".paired"))
})

test("readPairingSecret returns '' when the secret is missing (never throws)", () => {
  const d = tmpDir()
  assert.equal(readPairingSecret(d), "")
})

test("readPairingSecret reads + trims surrounding whitespace/newline", () => {
  const d = tmpDir()
  fs.writeFileSync(getWsSecretPath(d), "abcdef0123456789\n", { mode: 0o600 })
  assert.equal(readPairingSecret(d), "abcdef0123456789")

  fs.writeFileSync(getWsSecretPath(d), "  deadbeef  \n", { mode: 0o600 })
  assert.equal(readPairingSecret(d), "deadbeef")
})

test("readPairingSecret returns '' for an unreadable file instead of throwing", () => {
  const d = tmpDir()
  // A directory at the secret path makes readFileSync throw → helper swallows it.
  fs.mkdirSync(getWsSecretPath(d))
  assert.equal(readPairingSecret(d), "")
})

test("hasPaired tracks marker presence", () => {
  const d = tmpDir()
  assert.equal(hasPaired(d), false)
  fs.writeFileSync(getPairedMarkerPath(d), "2026-07-13T00:00:00.000Z\n", { mode: 0o600 })
  assert.equal(hasPaired(d), true)
})

test("resolveClipboardCommand: darwin → pbcopy, win32 → clip", () => {
  assert.deepEqual(resolveClipboardCommand("darwin", {}), { cmd: "pbcopy", args: [] })
  assert.deepEqual(resolveClipboardCommand("win32", {}), { cmd: "clip", args: [] })
})

test("resolveClipboardCommand: linux prefers xclip, falls back to xsel, else null", () => {
  assert.deepEqual(
    resolveClipboardCommand("linux", { xclip: true, xsel: true }),
    { cmd: "xclip", args: ["-selection", "clipboard"] },
  )
  assert.deepEqual(
    resolveClipboardCommand("linux", { xclip: false, xsel: true }),
    { cmd: "xsel", args: ["--clipboard", "--input"] },
  )
  assert.equal(resolveClipboardCommand("linux", {}), null)
})

test("resolveClipboardCommand: unknown platform → null", () => {
  assert.equal(resolveClipboardCommand("aix", {}), null)
})
