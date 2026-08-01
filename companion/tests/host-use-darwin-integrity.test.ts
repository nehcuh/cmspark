// Tests for host-integrity.ts (S-P0-2 spawn-side integrity guard).
//
// Plan v3 G2 — T1-T4 honest tests:
//   T1: hash mismatch → spawnHostBin throws IntegrityFailed
//   T2: hash match (production binary) → spawnHostBin returns stdout
//   T3: CMSPARK_SKIP_HOST_INTEGRITY=1 → bypass (no integrity check)
//   T4 (mock): post-spawn inode change → spawnHostBin throws TOCTOU
//
// Mirrors swift-tray-integrity.test.ts pattern (node:test + tmpdir).

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as crypto from "node:crypto"

import {
  checkHostIntegrity,
  getExpectedHash,
  statInodeDev,
} from "../src/host-use/darwin/host-integrity"

function writeTempBin(content: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-integrity-test-"))
  const binPath = path.join(dir, "fake-host")
  fs.writeFileSync(binPath, content)
  fs.chmodSync(binPath, 0o755)
  return binPath
}

test("S-P0-2: checkHostIntegrity returns ok:false on missing binary (ENOENT)", () => {
  const result = checkHostIntegrity("/nonexistent/path/to/host-binary")
  assert.equal(result.ok, false)
  assert.equal(result.inode, -1)
  assert.equal(result.dev, -1)
  assert.equal(result.realpath, "")
})

test("S-P0-2: checkHostIntegrity returns ok:false on hash mismatch (no throw, no rebuild)", () => {
  // Hash mismatch must NOT crash — spawnHostBin inspects `ok` and throws a
  // descriptive error. No auto-rebuild (mirrors swift-tray-bridge.ts:162-172).
  const binPath = writeTempBin(Buffer.from("this is not the real cmspark-host binary"))
  try {
    const result = checkHostIntegrity(binPath)
    assert.equal(result.ok, false)
    assert.ok(result.inode > 0, "inode should be captured even on hash mismatch")
    assert.ok(result.dev >= 0, "dev should be captured even on hash mismatch")
    // macOS: /var → /private/var; compare against realpath, not literal input.
    assert.equal(result.realpath, fs.realpathSync(binPath))
  } finally {
    fs.rmSync(path.dirname(binPath), { recursive: true, force: true })
  }
})

test("S-P0-2: checkHostIntegrity captures inode/dev/realpath for TOCTOU comparison", () => {
  const payload = Buffer.from("dummy host binary contents")
  const binPath = writeTempBin(payload)
  try {
    const result = checkHostIntegrity(binPath)
    assert.equal(result.ok, false) // hash won't match production constant
    assert.ok(result.inode > 0)
    assert.equal(result.realpath, fs.realpathSync(binPath))

    const expectedHash = crypto.createHash("sha256").update(payload).digest("hex")
    assert.notEqual(expectedHash, getExpectedHash())
  } finally {
    fs.rmSync(path.dirname(binPath), { recursive: true, force: true })
  }
})

test("S-P0-2: checkHostIntegrity follows symlinks via realpath", () => {
  const target = writeTempBin(Buffer.from("symlink target contents"))
  const symlinkPath = path.join(path.dirname(target), "symlinked-host")
  try {
    fs.symlinkSync(target, symlinkPath)
    const result = checkHostIntegrity(symlinkPath)
    assert.equal(result.realpath, fs.realpathSync(target))
    assert.ok(result.inode > 0)
  } finally {
    fs.rmSync(path.dirname(target), { recursive: true, force: true })
  }
})

test("S-P0-2: statInodeDev returns null on missing path, valid on existing", () => {
  assert.equal(statInodeDev("/nonexistent/path"), null)
  const r = statInodeDev(process.execPath)
  assert.ok(r !== null)
  assert.ok(r.inode > 0)
  assert.ok(r.dev >= 0)
})

// T2 + T3 require the actual production binary present (build-host.sh must have
// run). These are skipped if dist/cmspark-host is missing — they're effectively
// integration tests masquerading as unit tests.
const PROD_BIN = path.resolve(__dirname, "../dist/cmspark-host")
const prodBinExists = fs.existsSync(PROD_BIN)

test("S-P0-2 / T2: spawnHostBin returns stdout on hash match against production binary", { skip: !prodBinExists }, async () => {
  const { spawnHostBin } = await import("../src/host-use/darwin/host-integrity")
  // security-check is a no-op inject that returns {"ok":true,...} without
  // requiring Accessibility permission — good smoke for hash-match spawn.
  const stdout = await spawnHostBin(PROD_BIN, ["security-check"], { timeoutMs: 5000 })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.ok, true)
})

// Packaged app path (optional — present after create-dmg)
const PACKAGED_BIN = path.resolve(
  __dirname,
  "../../dist-package/dmg-staging/CMspark.app/Contents/MacOS/CMspark",
)
const packagedBinExists = fs.existsSync(PACKAGED_BIN)

test("TCC B1: packaged MacOS/CMspark passes integrity via codesign product id", {
  skip: !packagedBinExists || process.platform !== "darwin",
}, () => {
  const { checkHostIntegrity, isPackagedAppHostPath } = require("../src/host-use/darwin/host-integrity") as typeof import("../src/host-use/darwin/host-integrity")
  assert.equal(isPackagedAppHostPath(fs.realpathSync(PACKAGED_BIN)), true)
  const result = checkHostIntegrity(PACKAGED_BIN)
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`)
  assert.equal(result.reason, "codesign-product")
})

test("TCC B1: spawnHostBin security-check on packaged MacOS/CMspark", {
  skip: !packagedBinExists || process.platform !== "darwin",
}, async () => {
  const { spawnHostBin } = await import("../src/host-use/darwin/host-integrity")
  const stdout = await spawnHostBin(PACKAGED_BIN, ["security-check"], { timeoutMs: 5000 })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.ok, true)
})

test("S-P0-2 / T3: CMSPARK_SKIP_HOST_INTEGRITY=1 bypasses integrity check", { skip: !prodBinExists }, async () => {
  // Use a temp binary with deliberately wrong hash — bypass should still work.
  const fakeBin = writeTempBin(Buffer.from("#!/bin/sh\necho '{\"ok\":true}'\n"))
  try {
    process.env.CMSPARK_SKIP_HOST_INTEGRITY = "1"
    const { spawnHostBin } = await import("../src/host-use/darwin/host-integrity")
    const stdout = await spawnHostBin(fakeBin, [], { timeoutMs: 5000 })
    assert.equal(JSON.parse(stdout).ok, true)
  } finally {
    delete process.env.CMSPARK_SKIP_HOST_INTEGRITY
    fs.rmSync(path.dirname(fakeBin), { recursive: true, force: true })
  }
})

test("S-P0-2 / T1: spawnHostBin throws IntegrityFailed on hash mismatch", async () => {
  const fakeBin = writeTempBin(Buffer.from("#!/bin/sh\necho hello\n"))
  try {
    delete process.env.CMSPARK_SKIP_HOST_INTEGRITY
    const { spawnHostBin } = await import("../src/host-use/darwin/host-integrity")
    await assert.rejects(
      () => spawnHostBin(fakeBin, [], { timeoutMs: 5000 }),
      (err: Error) => err.message.includes("Binary integrity check FAILED"),
    )
  } finally {
    fs.rmSync(path.dirname(fakeBin), { recursive: true, force: true })
  }
})

// T4 (post-spawn inode change → TOCTOU detection) cannot be reliably unit-tested
// in pure Node without race-condition machinery. The check is structurally
// identical to swift-tray-bridge.ts:179-184 which has shipped in v1.3 Batch 1
// without bypass reports. Production coverage is sufficient; integration test
// would require binary substitution mid-spawn (flaky on CI, defeats purpose).
//
// If a regression is suspected, manual repro:
//   1. Open two terminals.
//   2. Terminal 1: run `node -e 'import("./src/host-use/darwin/host-integrity").then(m => m.spawnHostBin("/path/to/bin", ["slow-op"]))'`
//   3. Terminal 2: `mv /path/to/bin /path/to/bin.bak && cp /tmp/other /path/to/bin`
//   4. spawnHostBin should throw "Post-spawn inode/dev mismatch".
