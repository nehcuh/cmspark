// Synthetic snapshots exercise the actual old/current PS comparators. This is
// not a target GUI/background-delivery test or a GetCursorPos fault injection.
import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const PS = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
const OLD_SHA = "dd032ea5d793d7123d280a4cdcb5db8f91e8844a772c58f61a757a1d6a573163"
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex")

test("#572 actual PS: legacy failed cursor sample certifies background; current refuses it", {
  skip: process.platform !== "win32",
}, async () => {
  const old = path.resolve("tests/fixtures/computer-bg-oracles-before-572.ps1")
  const current = path.resolve("src/host-use/win/scripts/computer-bg-oracles.ps1")
  // Missing PS/source is a Windows failure, not an availability skip.
  assert.ok(existsSync(PS))
  const oldCheckout = readFileSync(old)
  // Windows Git may materialize this text fixture with CRLF. Only that checkout
  // transport is canonicalized; the executed owned copy must be the exact old
  // production blob (no BOM stripping or other normalization).
  const oldBytes = Buffer.from(oldCheckout.toString("utf8").replace(/\r\n/g, "\n"))
  assert.equal(sha(oldBytes), OLD_SHA, "historical baseline must remain exact")
  const currentBytes = readFileSync(current)
  const dir = mkdtempSync(path.join(tmpdir(), "bg-oracle-counterfactual-"))
  try {
    const oldScript = path.join(dir, "legacy.ps1")
    writeFileSync(oldScript, oldBytes, { flag: "wx", mode: 0o600 })
    const before = path.join(dir, "before.json")
    const after = path.join(dir, "after.json")
    const snapshot = { foreground: 100, cursor: { x: 0, y: 0, got: false }, zorder: [100, 101] }
    writeFileSync(before, JSON.stringify(snapshot))
    writeFileSync(after, JSON.stringify(snapshot))
    const invoke = (script: string, output: string) => new Promise<{ code: number | string | null; stderr: string }>((resolve) => {
      execFile(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
        "-Mode", "compare", "-Before", before, "-After", after, "-Out", output, "-Delivery", "uia-pattern"],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 }, (error, _stdout, stderr) => {
        resolve({ code: error ? error.code ?? "UNKNOWN_CHILD_ERROR" : null, stderr: String(stderr || "") })
      })
    })
    const legacyOutput = path.join(dir, "legacy.json")
    const legacy = await invoke(oldScript, legacyOutput)
    assert.equal(legacy.code, null, `legacy producer failed before the intended observation: ${legacy.stderr}`)
    const badVerdict = JSON.parse(readFileSync(legacyOutput, "utf8"))
    assert.equal(badVerdict.cursor_kept, true, "old producer must expose the actual false-positive")
    assert.equal(badVerdict.background_verified, true, "unreadable legacy sample was incorrectly certified")

    const currentOutput = path.join(dir, "current.json")
    const corrected = await invoke(current, currentOutput)
    assert.equal(corrected.code, 4, `current producer must refuse with the exact existing code: ${corrected.stderr}`)
    assert.match(corrected.stderr, /ORACLE_UNREADABLE_SNAPSHOT:/)
    assert.equal(existsSync(currentOutput), false)
    // Both calls used ordinary files in an owned test directory. Neither
    // replaces the production script or mutates the current checkout.
    assert.deepEqual(readFileSync(current), currentBytes)
    assert.deepEqual(readFileSync(old), oldCheckout)
    assert.equal(sha(readFileSync(oldScript)), OLD_SHA)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
