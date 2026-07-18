// WP3 launch engine (apps/launch.ts) — D7 evidence classification with
// injected spawn/probe/exists/sleep fakes. Pure logic, runs on any platform.

import test from "node:test"
import * as assert from "node:assert/strict"

import {
  launchApp,
  processImageName,
  type LaunchDeps,
} from "../src/apps/launch"
import type { AppEntry } from "../src/apps/types"

const EXE = "C:\\Program Files\\TestApp\\myapp.exe"

function exeEntry(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    token: "win.app.myapp",
    kind: "gui",
    display_name: "MyApp",
    source: "user",
    policy: "ai",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: EXE, signer: "CN=Test", user_writable_dir: false },
    ...overrides,
  }
}

interface SpawnCall { file: string; args: string[]; opts: Record<string, unknown> }

function deps(overrides: Partial<LaunchDeps> & { spawnCalls?: SpawnCall[] } = {}): LaunchDeps {
  const { spawnCalls, ...rest } = overrides
  return {
    spawn: (file, args, opts) => {
      spawnCalls?.push({ file, args, opts })
      return { unref: () => {}, on: () => {} }
    },
    probe: async () => ({ running: false, count: 0 }),
    exists: () => true,
    waitMs: 0,
    sleep: async () => {},
    ...rest,
  }
}

// --- processImageName --------------------------------------------------------

test("processImageName: basename minus .exe, both separators, NOT prefix-before-dot", () => {
  assert.equal(processImageName("C:\\Apps\\cloudmusic.exe"), "cloudmusic")
  assert.equal(processImageName("C:/Apps/my.app.exe"), "my.app") // multi-dot preserved (unlike guards exeBasename)
  assert.equal(processImageName("myapp.EXE"), "myapp")
})

// --- exe branch: D7 evidence classification ----------------------------------

test("D7: fresh start — not running before, running after → process_running", async () => {
  const spawnCalls: SpawnCall[] = []
  let calls = 0
  const out = await launchApp(exeEntry(), deps({
    spawnCalls,
    probe: async () => (++calls === 1 ? { running: false, count: 0 } : { running: true, count: 1 }),
  }))
  assert.equal(out.launched, true)
  assert.equal(out.evidence, "process_running")
  assert.equal(out.detail, undefined)
  // Spawn contract: the entry's exe path, EMPTY argv, no shell, detached.
  assert.equal(spawnCalls.length, 1)
  assert.equal(spawnCalls[0].file, EXE)
  assert.deepEqual(spawnCalls[0].args, [])
  assert.equal(spawnCalls[0].opts.shell, false)
  assert.equal(spawnCalls[0].opts.detached, true)
  assert.equal(spawnCalls[0].opts.stdio, "ignore")
})

test("D7: single-instance hand-off — running before AND after → already_running (NOT a failure)", async () => {
  // 网易云-style stub: the launched process exits immediately, but the app
  // was already running (or the hand-off target IS running) → success.
  const out = await launchApp(exeEntry(), deps({
    probe: async () => ({ running: true, count: 1 }),
  }))
  assert.equal(out.launched, true)
  assert.equal(out.evidence, "already_running")
})

test("D7: stub exits, nothing detected after — requested_no_pid, still launched:true (never misreported as failed)", async () => {
  const out = await launchApp(exeEntry(), deps({
    probe: async () => ({ running: false, count: 0 }),
  }))
  assert.equal(out.launched, true)
  assert.equal(out.evidence, "requested_no_pid")
  assert.ok(out.detail?.includes("no running"), "honest detail must explain the absence")
})

test("D7: probe failure degrades honestly — launch proceeds, requested_no_pid with probe-unavailable detail", async () => {
  const out = await launchApp(exeEntry(), deps({
    probe: async () => { throw new Error("powershell exploded") },
  }))
  assert.equal(out.launched, true)
  assert.equal(out.evidence, "requested_no_pid")
  assert.ok(out.detail?.includes("probe unavailable"))
})

test("missing exe on disk → typed error (uninstalled / binary drift), no spawn", async () => {
  const spawnCalls: SpawnCall[] = []
  await assert.rejects(
    () => launchApp(exeEntry(), deps({ spawnCalls, exists: () => false })),
    /exe not found.*uninstalled or binary moved/,
  )
  assert.equal(spawnCalls.length, 0)
})

test("schema-violating entry (neither exe nor aumid) → typed error", async () => {
  const broken = exeEntry()
  delete (broken as any).exe
  await assert.rejects(() => launchApp(broken, deps()), /neither exe nor aumid/)
})

// --- AUMID branch ------------------------------------------------------------

test("AUMID launch: explorer.exe + shell:AppsFolder argv shape, requested_no_pid", async () => {
  const spawnCalls: SpawnCall[] = []
  const entry = exeEntry()
  delete (entry as any).exe
  entry.aumid = "NetEase.CloudMusic_abcd1234!App"
  const out = await launchApp(entry, deps({ spawnCalls }))
  assert.equal(out.launched, true)
  assert.equal(out.evidence, "requested_no_pid")
  assert.ok(out.detail?.includes("no pid"))
  assert.equal(spawnCalls.length, 1)
  assert.match(spawnCalls[0].file, /explorer\.exe$/i)
  assert.deepEqual(spawnCalls[0].args, ["shell:AppsFolder\\NetEase.CloudMusic_abcd1234!App"])
  assert.equal(spawnCalls[0].opts.shell, false)
})

test("AUMID re-validation at exec time (D11): tampered aumid → typed error, no spawn", async () => {
  const spawnCalls: SpawnCall[] = []
  for (const bad of ["no-bang-here", "evil!app extra", "a!b!c", `x${String.fromCharCode(0)}!y`]) {
    const entry = exeEntry()
    delete (entry as any).exe
    entry.aumid = bad
    await assert.rejects(() => launchApp(entry, deps({ spawnCalls })), /invalid aumid/)
  }
  assert.equal(spawnCalls.length, 0)
})
