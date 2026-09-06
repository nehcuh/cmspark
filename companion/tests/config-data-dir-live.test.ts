// #406 — residual DATA_DIR freeze points live-ification.
//
// Locks the semantic contract #404/#405 introduced and #406 extends:
//   DATA_DIR           = import-time constant (env snapshot at module load)
//   getConfigDir()     = live  (re-reads process.env.CMSPARK_DATA_DIR per call)
//   getLogDir()        = live  (path.join(getConfigDir(), "logs"))
//   getPidFilePath()   = live  (path.join(getConfigDir(), "daemon.pid"))  ← #406
//   ws-auth / grants / obsidian cache paths = live (resolved per call)
//
// This file imports config AFTER pinning CMSPARK_DATA_DIR to a temp dir (A), then
// flips the env var at runtime to a second temp dir (B) and asserts every
// "live" getter follows B while the frozen DATA_DIR export still points at A.

import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const homeA = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-live-data-dir-a-"))
process.env.HOME = homeA
process.env.CMSPARK_DATA_DIR = homeA

let cfg: typeof import("../src/config")
let wsAuth: typeof import("../src/ws-auth")
let grants: typeof import("../src/outbound-mcp/outbound-grants")
let vaultIndex: typeof import("../src/obsidian/vault-index")
let vaultProfiler: typeof import("../src/obsidian/vault-profiler")
let vaultTemplates: typeof import("../src/obsidian/vault-templates")

before(async () => {
  cfg = await import("../src/config")
  wsAuth = await import("../src/ws-auth")
  grants = await import("../src/outbound-mcp/outbound-grants")
  vaultIndex = await import("../src/obsidian/vault-index")
  vaultProfiler = await import("../src/obsidian/vault-profiler")
  vaultTemplates = await import("../src/obsidian/vault-templates")
})

after(() => {
  fs.rmSync(homeA, { recursive: true, force: true })
})

test("getConfigDir/getLogDir/getPidFilePath follow a runtime CMSPARK_DATA_DIR flip (#406)", () => {
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-live-data-dir-b-"))
  try {
    // Module was imported with env pinned to A — DATA_DIR export is frozen at A.
    assert.equal(cfg.DATA_DIR, homeA, "DATA_DIR is the import-time snapshot")
    assert.equal(cfg.getConfigDir(), homeA, "live dir starts at A")

    // Flip the env var at runtime (post-import retarget — the #406 hazard).
    process.env.CMSPARK_DATA_DIR = dirB
    cfg.clearConfigCache()
    assert.equal(cfg.getConfigDir(), dirB, "getConfigDir() must follow the env flip")
    assert.equal(cfg.getLogDir(), path.join(dirB, "logs"), "getLogDir() must follow")
    assert.equal(
      cfg.getPidFilePath(),
      path.join(dirB, "daemon.pid"),
      "getPidFilePath() must follow (was frozen on DATA_DIR before #406)",
    )
    // Frozen export unchanged — documents the intended split.
    assert.equal(cfg.DATA_DIR, homeA)
  } finally {
    process.env.CMSPARK_DATA_DIR = homeA
    cfg.clearConfigCache()
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})

test("ws-auth secret/paired + outbound grants + obsidian cache paths resolve live (#406)", () => {
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-live-data-dir-c-"))
  try {
    process.env.CMSPARK_DATA_DIR = dirB
    cfg.clearConfigCache()
    wsAuth.clearSecretCache()

    assert.equal(
      wsAuth.getPairedMarkerPath(),
      path.join(dirB, ".paired"),
      "paired marker must resolve under the live dir",
    )
    assert.equal(
      vaultIndex.getVaultIndexPath(),
      path.join(dirB, "obsidian", "vault-index.json"),
    )
    assert.equal(
      vaultProfiler.getVaultProfilePath(),
      path.join(dirB, "obsidian", "profile.json"),
    )
    assert.equal(
      vaultTemplates.getVaultTemplatesPath(),
      path.join(dirB, "obsidian", "templates.json"),
    )

    // getOrCreateSharedSecret persists into the live dir (no real-home write).
    const secret = wsAuth.getOrCreateSharedSecret()
    assert.ok(secret.length >= 64, "secret must be generated")
    assert.ok(fs.existsSync(path.join(dirB, "ws_secret")), "ws_secret written under live dir")
    assert.ok(
      !fs.existsSync(path.join(homeA, "ws_secret")),
      "no ws_secret may land in the pre-flip dir",
    )

    // Outbound grants wipe is live-scoped too (the known real-home write point).
    grants.resetOutboundGrantsForTests()
    assert.ok(!fs.existsSync(path.join(homeA, "outbound-grants.json")))
  } finally {
    wsAuth.clearSecretCache()
    process.env.CMSPARK_DATA_DIR = homeA
    cfg.clearConfigCache()
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})
