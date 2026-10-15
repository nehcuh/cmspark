// #655: real handlers/config/disk; existing filesystem/signer seams only.
import "./integration/_security-gates-setup"
import test, { before, after } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleAppsMessage, type AppsHandlerDeps } from "../src/apps/handlers"
import { CONFIG_CHANGE_EVENT, configEvents, getConfig, initDataDir, replaceAppsEntries, saveConfig, DATA_DIR } from "../src/config"
import type { AppEntry } from "../src/apps/types"

const token = "win.app.owned655", preset = "win.app.cloudmusic"
const entry = (policy: "manual" | "auto" = "auto"): AppEntry => ({ token, kind: "gui", display_name: "Owned inert app", source: "user", policy, enabled: true,
  added_at: "2026-10-15T00:00:00.000Z", exe: { path: "C:\\Program Files\\Owned655\\owned.exe", signer: "CN=Owned fixture", user_writable_dir: false } })
const deps: AppsHandlerDeps = { exists: p => p.toLowerCase().includes("program files"), realpath: () => "C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe",
  signerProbe: async () => "CN=Owned fixture", clearAppTrust: () => 0, platform: "win32" }
const listeners = () => configEvents.listenerCount(CONFIG_CHANGE_EVENT)
function snapshot() {
  const actual = structuredClone(getConfig().apps!.entries)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")).apps.entries, actual)
  return actual
}
function responseEntries(result: any) {
  return Object.fromEntries(result.entries.map(({ max_policy: _cap, ...value }: any) => [value.token, value]))
}
function startList() {
  let release!: (signer: string) => void, entered!: () => void
  const ready = new Promise<void>(r => { entered = r }), held = new Promise<string>(r => { release = r })
  const baseline = listeners()
  const pending = handleAppsMessage({ type: "apps.list" }, {}, { ...deps, signerProbe: () => { entered(); return held } })
  return { pending, ready, baseline, release: () => release("CN=Owned fixture") }
}
async function finishWithoutWrite(flow: ReturnType<typeof startList>, expected: Record<string, AppEntry>) {
  let changes = 0; const changed = () => { changes++ }
  configEvents.on(CONFIG_CHANGE_EVENT, changed)
  let result: any
  try { flow.release(); result = await flow.pending }
  finally { configEvents.off(CONFIG_CHANGE_EVENT, changed) }
  assert.deepEqual(snapshot(), expected)
  assert.deepEqual(responseEntries(result), expected)
  assert.equal(result.type, "apps.list")
  assert.equal(result.presets.find((p: any) => p.token === preset).persisted, Object.hasOwn(expected, preset))
  assert.equal(changes, 0, "a stale list is a normal latest-state response, not another config write")
  assert.equal(listeners(), flow.baseline)
  return result
}
const child: any = require("node:child_process"), net: any = require("node:net"), originals: (() => void)[] = []
let processes = 0, networks = 0
before(async () => {
  assert.ok(process.env.CMSPARK_TEST_RUN_DIR, "canonical isolated runner required"); await initDataDir()
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const original = child[method]; child[method] = () => { processes++; throw new Error("unexpected native child") }; originals.push(() => { child[method] = original })
  }
  const connect = net.Socket.prototype.connect; net.Socket.prototype.connect = () => { networks++; throw new Error("unexpected network") }; originals.push(() => { net.Socket.prototype.connect = connect })
})
after(() => { for (const restore of originals.reverse()) restore(); assert.equal(processes, 0); assert.equal(networks, 0) })

for (const policy of ["manual", "auto"] as const) {
  test(`list: normal detection seeds manual without changing existing ${policy} entry`, async () => {
    const initial = entry(policy); replaceAppsEntries({ [token]: initial }); const flow = startList(); await flow.ready; flow.release()
    const result = await flow.pending, actual = snapshot()
    assert.deepEqual(actual[token], initial); assert.equal(actual[preset].policy, "manual"); assert.equal(actual[preset].source, "preset")
    assert.equal(result.presets.find((p: any) => p.token === preset).persisted, true)
    assert.deepEqual(responseEntries(result), actual); assert.equal(listeners(), flow.baseline)
  })
  for (const mutation of ["disable", "remove", "sibling", "replace", "remove-ABA", "disable-ABA"] as const) {
    test(`list: pending seed preserves ${policy} ${mutation}`, async () => {
      const initial = entry(policy); replaceAppsEntries({ [token]: initial }); const flow = startList(); await flow.ready
      if (mutation === "disable" || mutation === "disable-ABA") {
        await handleAppsMessage({ type: "apps.set_enabled", token, enabled: false }, {}, deps)
        if (mutation === "disable-ABA") await handleAppsMessage({ type: "apps.set_enabled", token, enabled: true }, {}, deps)
      } else if (mutation === "remove" || mutation === "remove-ABA") {
        await handleAppsMessage({ type: "apps.remove", token }, {}, deps)
        if (mutation === "remove-ABA") replaceAppsEntries({ [token]: initial })
      } else if (mutation === "sibling") {
        const added = await handleAppsMessage({ type: "apps.add", aumid: "Owned655!Sibling", display_name: "Sibling655", origin: "enumerate", policy: "manual" }, {}, deps)
        assert.equal(added.type, "apps.updated"); assert.ok(Object.values(snapshot()).some(e => e.aumid === "Owned655!Sibling"))
      } else replaceAppsEntries({ [token]: { ...initial, exe: { ...initial.exe!, path: "C:\\Program Files\\Owned655\\replacement.exe" } } })
      await finishWithoutWrite(flow, snapshot())
    })
  }
}

for (const mutation of ["none", "disable", "delete", "delete-ABA", "disable-ABA"] as const) {
  test(`list: earlier seed cannot repeat after concurrent first-list ${mutation}`, async () => {
    replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
    const first = await handleAppsMessage({ type: "apps.list" }, {}, deps)
    assert.equal(first.entries.find((e: AppEntry) => e.token === preset).policy, "manual")
    const seeded = snapshot()[preset]
    if (mutation === "disable" || mutation === "disable-ABA") {
      await handleAppsMessage({ type: "apps.set_enabled", token: preset, enabled: false }, {}, deps)
      if (mutation === "disable-ABA") await handleAppsMessage({ type: "apps.set_enabled", token: preset, enabled: true }, {}, deps)
    } else if (mutation === "delete" || mutation === "delete-ABA") {
      // Presets cannot be deleted in the UI; this is actual host config replacement (ADR-010).
      const map = { ...getConfig().apps!.entries }; delete map[preset]; replaceAppsEntries(map)
      if (mutation === "delete-ABA") replaceAppsEntries({ ...getConfig().apps!.entries, [preset]: seeded })
    }
    await finishWithoutWrite(flow, snapshot())
  })
}
test("list: same-map notification conservatively defers seeding without rejecting the read", async () => {
  replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
  replaceAppsEntries(structuredClone(getConfig().apps!.entries)); await finishWithoutWrite(flow, snapshot())
})
test("list: mutable alias ABA events cannot revive lazy seeding", async () => {
  replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
  const alias = getConfig().apps!.entries[token]; alias.enabled = false; replaceAppsEntries(getConfig().apps!.entries)
  alias.enabled = true; replaceAppsEntries(getConfig().apps!.entries); await finishWithoutWrite(flow, snapshot())
})
test("list: current global disabled state is preserved", async () => {
  replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
  saveConfig({ apps: { enabled: false, entries: getConfig().apps!.entries } }); const result = await finishWithoutWrite(flow, snapshot())
  assert.equal(result.enabled, false); assert.equal(getConfig().apps!.enabled, false)
  saveConfig({ apps: { enabled: true, entries: getConfig().apps!.entries } })
})
// Actual config-file changes reload through getConfig's existing mtime path;
// there is no config event to substitute for the final current-map fence.
function replaceDiskEntries(entries: Record<string, AppEntry>) {
  const target = path.join(DATA_DIR, "config.json"), previous = fs.statSync(target)
  const disk = JSON.parse(fs.readFileSync(target, "utf8")); disk.apps.entries = entries
  fs.writeFileSync(target, JSON.stringify(disk), { mode: 0o600 })
  fs.utimesSync(target, previous.atime, new Date(previous.mtimeMs + 2000))
}
test("list: actual file reload merges new preset without restoring initial removed keys", async () => {
  replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
  const sibling = { ...entry("manual"), token: "win.app.disk655", enabled: false }
  replaceDiskEntries({ [sibling.token]: sibling }); flow.release(); const result = await flow.pending, actual = snapshot()
  assert.equal(actual[token], undefined); assert.deepEqual(actual[sibling.token], sibling)
  assert.deepEqual(Object.keys(actual).sort(), [preset, sibling.token].sort()); assert.equal(actual[preset].policy, "manual")
  assert.deepEqual(responseEntries(result), actual); assert.equal(listeners(), flow.baseline)
})
test("list: actual file reload's current preset cannot be overwritten even without notification", async () => {
  replaceAppsEntries({ [token]: entry() }); const flow = startList(); await flow.ready
  const currentPreset: AppEntry = { ...entry("manual"), token: preset, source: "preset", enabled: false }
  replaceDiskEntries({ [token]: entry(), [preset]: currentPreset }); await finishWithoutWrite(flow, snapshot())
})
for (const fault of ["exists", "realpath", "signer"] as const) test(`list: ${fault} failure retains original honest fallback and cleans listener`, async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners()
  const options = { ...deps, [fault === "signer" ? "signerProbe" : fault]: () => { throw new Error("owned detection failure") } }
  const result = await handleAppsMessage({ type: "apps.list" }, {}, options)
  assert.equal(result.type, "apps.list"); assert.deepEqual(snapshot()[token], entry()); assert.equal(listeners(), baseline)
  if (fault === "signer") { assert.equal(snapshot()[preset].policy, "manual"); assert.equal(snapshot()[preset].exe?.signer, undefined) }
  else assert.equal(snapshot()[preset], undefined)
})
test("list: initial config-read failure cleans any listener", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), config: any = require("../src/config"), original = config.getConfig
  config.getConfig = () => { throw new Error("owned config read failure") }
  try { await assert.rejects(handleAppsMessage({ type: "apps.list" }, {}, deps), /owned config read failure/) }
  finally { config.getConfig = original }
  assert.equal(listeners(), baseline)
})
test("list: final config-read failure cannot write a seed and cleans listener", async () => {
  replaceAppsEntries({ [token]: entry() }); const before = snapshot(), flow = startList(); await flow.ready
  const config: any = require("../src/config"), original = config.getConfig; config.getConfig = () => { throw new Error("owned final config failure") }
  try { const rejected = assert.rejects(flow.pending, /owned final config failure/); flow.release(); await rejected }
  finally { config.getConfig = original }
  assert.deepEqual(snapshot(), before); assert.equal(listeners(), flow.baseline)
})
test("list: actual atomic config rename EIO preserves disk and cleans listener", async t => {
  replaceAppsEntries({ [token]: entry() }); const before = snapshot(), flow = startList(); await flow.ready
  const nativeFs: any = require("node:fs"), original = nativeFs.renameSync, configPath = path.join(DATA_DIR, "config.json"); let faults = 0
  t.mock.method(nativeFs, "renameSync", (from: any, to: any) => {
    if (String(to) === configPath) { faults++; throw Object.assign(new Error("owned config EIO"), { code: "EIO" }) }
    return original(from, to)
  })
  const rejected = assert.rejects(flow.pending, /owned config EIO/); flow.release(); await rejected
  assert.equal(faults, 1); assert.deepEqual(snapshot(), before); assert.equal(listeners(), flow.baseline)
  assert.equal(fs.existsSync(`${configPath}.tmp-${process.pid}`), false)
})
