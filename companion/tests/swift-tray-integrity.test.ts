import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as crypto from "node:crypto"

import { checkIntegrity, getExpectedHash } from "../src/tray/swift-tray-bridge"

function writeTempBin(content: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swift-tray-test-"))
  const binPath = path.join(dir, "fake-tray")
  fs.writeFileSync(binPath, content)
  fs.chmodSync(binPath, 0o755)
  return binPath
}

test("S-P0-2 / A5: checkIntegrity returns ok:false on missing binary (ENOENT)", () => {
  const result = checkIntegrity("/nonexistent/path/to/tray-binary")
  assert.equal(result.ok, false)
  assert.equal(result.inode, -1)
  assert.equal(result.dev, -1)
  assert.equal(result.realpath, "")
})

test("S-P0-2 / A5: checkIntegrity returns ok:false on hash mismatch (no throw, no rebuild)", () => {
  // A5: hash mismatch must NOT crash — caller (SwiftTrayAdapter.start) inspects
  // `ok` and throws a descriptive error. Auto-rebuild is gated on missing-binary only.
  const binPath = writeTempBin(Buffer.from("this is not the real Swift binary"))
  try {
    const result = checkIntegrity(binPath)
    assert.equal(result.ok, false)
    // inode/dev/realpath are still populated so callers can compare against post-spawn state:
    assert.ok(result.inode > 0, "inode should be captured even on hash mismatch")
    assert.ok(result.dev >= 0, "dev should be captured even on hash mismatch")
    // macOS: /var → /private/var; compare against realpath, not the literal input.
    assert.equal(result.realpath, fs.realpathSync(binPath))
  } finally {
    fs.rmSync(path.dirname(binPath), { recursive: true, force: true })
  }
})

test("S-P0-2 / A5: checkIntegrity captures inode/dev/realpath for TOCTOU comparison", () => {
  // We can't fake the production SWIFT_TRAY_SHA256 in a unit test, so the
  // success-path (ok:true) is exercised by the integration build path.
  // Here we verify the structural metadata used by start()'s post-spawn re-stat:
  //   - inode > 0 (so the post-spawn `inode !== pre.inode` check is meaningful)
  //   - realpath is the resolved path
  //   - independent sha256 differs from the production constant
  const payload = Buffer.from("dummy swift tray binary contents")
  const binPath = writeTempBin(payload)
  try {
    const result = checkIntegrity(binPath)
    assert.equal(result.ok, false) // hash won't match production constant
    assert.ok(result.inode > 0)
    assert.equal(result.realpath, fs.realpathSync(binPath))

    const expectedHash = crypto.createHash("sha256").update(payload).digest("hex")
    assert.notEqual(expectedHash, getExpectedHash())
  } finally {
    fs.rmSync(path.dirname(binPath), { recursive: true, force: true })
  }
})

test("S-P0-2 / A5: checkIntegrity follows symlinks via realpath", () => {
  const target = writeTempBin(Buffer.from("symlink target contents"))
  const symlinkPath = path.join(path.dirname(target), "symlinked-tray")
  try {
    fs.symlinkSync(target, symlinkPath)
    const result = checkIntegrity(symlinkPath)
    assert.equal(result.realpath, fs.realpathSync(target)) // resolved through symlink
    assert.ok(result.inode > 0)
  } finally {
    fs.rmSync(path.dirname(target), { recursive: true, force: true })
  }
})
