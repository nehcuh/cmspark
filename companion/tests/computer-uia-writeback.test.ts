// WP3 (§K.5) — writeBackUiaVerdict against a real (temp) config.json.
//
// ISOLATION DISCIPLINE (hard-won): writeBackUiaVerdict calls the GLOBAL
// config module, and config.ts computes DATA_DIR at module-evaluation time.
// Any static import that transitively loads config.ts would therefore bind
// the REAL ~/.cmspark-agent before this file's env pin runs — an earlier
// revision of these tests lived in computer-uia.test.ts (whose static
// imports do exactly that) and WROTE THE FAKE ENTRY INTO THE REAL CONFIG.
// So: this file imports NOTHING config-touching statically; CMSPARK_DATA_DIR
// is pinned in before(); every config-touching module is dynamically
// imported afterwards (the apps-config.test.ts pattern). Distinct tokens per
// test avoid saveConfig deep-merge residue between tests.

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import type { AppEntry } from "../src/apps/types"
import type { UiaVerdict } from "../src/computer/uia"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-uia-wb-"))

type ConfigModule = typeof import("../src/config")
type UiaModule = typeof import("../src/computer/uia")

let cfg: ConfigModule
let uia: UiaModule

function entry(token: string, over: Partial<AppEntry> = {}): AppEntry {
  return {
    token,
    kind: "gui",
    display_name: "Test App",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: "C:\\Program Files\\TestApp\\app.exe", signer: "CN=Test", user_writable_dir: false },
    ...over,
  }
}

function verdict(capable: boolean): UiaVerdict {
  return {
    uiaCapable: capable,
    confidence: 0.9,
    stats: {
      nodes: 50, maxDepth: 4, edits: 0, documents: 0, interactive: 3, named: 6, namedOnscreen: 5,
      capped: false, hydrationRechecked: false, passANodes: 50, durationMs: 10,
    },
  }
}

before(async () => {
  process.env.CMSPARK_DATA_DIR = tempHome
  cfg = await import("../src/config")
  await cfg.initDataDir()
  cfg.clearConfigCache()
  uia = await import("../src/computer/uia")
})

after(() => {
  try { fs.rmSync(tempHome, { recursive: true, force: true }) } catch { /* best-effort */ }
})

function seed(e: AppEntry) {
  cfg.saveConfig({ apps: { enabled: true, entries: { [e.token]: e } } } as any)
  cfg.clearConfigCache()
}

test("writeBackUiaVerdict persists the verdict into config.json (unprobed entry)", () => {
  seed(entry("win.app.wbalpha"))
  const r = uia.writeBackUiaVerdict("win.app.wbalpha", verdict(true), "2026-07-19T03:00:00.000Z")
  assert.equal(r.applied, true)
  cfg.clearConfigCache()
  const onDisk = cfg.getConfig().apps?.entries?.["win.app.wbalpha"]
  assert.equal(onDisk?.uiaCapable, true)
  assert.equal(onDisk?.uiaProbedAt, "2026-07-19T03:00:00.000Z")
})

test("writeBackUiaVerdict refreshes a previously auto-probed value", () => {
  seed(entry("win.app.wbbeta", { uiaCapable: true, uiaProbedAt: "2026-07-19T03:00:00.000Z" }))
  const r = uia.writeBackUiaVerdict("win.app.wbbeta", verdict(false), "2026-07-19T05:00:00.000Z")
  assert.equal(r.applied, true)
  cfg.clearConfigCache()
  const onDisk = cfg.getConfig().apps?.entries?.["win.app.wbbeta"]
  assert.equal(onDisk?.uiaCapable, false)
  assert.equal(onDisk?.uiaProbedAt, "2026-07-19T05:00:00.000Z")
})

test("writeBackUiaVerdict refuses a HAND-SET override and touches nothing", () => {
  seed(entry("win.app.wbgamma", { uiaCapable: false })) // no uiaProbedAt = human wrote this
  const r = uia.writeBackUiaVerdict("win.app.wbgamma", verdict(true), "2026-07-19T06:00:00.000Z")
  assert.equal(r.applied, false)
  assert.equal(r.reason, "hand-set-override")
  cfg.clearConfigCache()
  const onDisk = cfg.getConfig().apps?.entries?.["win.app.wbgamma"]
  assert.equal(onDisk?.uiaCapable, false)
  assert.equal(onDisk?.uiaProbedAt, undefined)
})

test("writeBackUiaVerdict: unknown token is a logged no-op, never throws", () => {
  const r = uia.writeBackUiaVerdict("win.app.wbghost", verdict(true), "2026-07-19T07:00:00.000Z")
  assert.equal(r.applied, false)
  assert.equal(r.reason, "unknown-token")
})
