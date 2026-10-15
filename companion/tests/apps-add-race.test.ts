// Real App add/config/disk races; only signer and approval are inert seams.
// The canonical runner pins DATA_DIR before imports; HOME is never reassigned.
import test, { before, after } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleAppsMessage, type AppsHandlerDeps } from "../src/apps/handlers"
import { CONFIG_CHANGE_EVENT, configEvents, getConfig, initDataDir, replaceAppsEntries, saveConfig, DATA_DIR } from "../src/config"
import type { AppEntry } from "../src/apps/types"
import type { BiometricGateOutcome } from "../src/apps/biometric-gate"

const token = "win.app.addexisting"
const existing = (): AppEntry => ({ token, kind: "gui", display_name: "Owned existing", source: "user", policy: "auto", enabled: true,
  added_at: "2026-10-15T00:00:00.000Z", exe: { path: "C:\\Program Files\\OwnedAdd\\existing.exe", signer: "CN=Owned fixture", user_writable_dir: false } })
const exe = "C:\\Program Files\\OwnedAdd\\pending.exe"
const approval: BiometricGateOutcome = { approved: true, method: "manual-nonce", nonce: "NON_EFFECTIVE_NOT_ISSUED" }
const channel = async (): Promise<never> => { throw new Error("inert gate must not request real approval") }
const deps: AppsHandlerDeps = { exists: () => true, realpath: () => exe, signerProbe: async () => "CN=Owned fixture", platform: "win32", clearAppTrust: () => 0 }
const add = (aumid: string, display = aumid) => ({ type: "apps.add", aumid: `${aumid}!App`, display_name: display, origin: "enumerate", policy: "manual" })
const listeners = () => configEvents.listenerCount(CONFIG_CHANGE_EVENT)
function snapshot() {
  const entries = structuredClone(getConfig().apps!.entries)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")).apps.entries, entries)
  return entries
}
function start(stage: "signer" | "gate") {
  let entered!: () => void, release!: () => void, gates = 0
  const ready = new Promise<void>(r => { entered = r })
  let releaseSigner!: (s: string) => void, releaseGate!: (r: BiometricGateOutcome) => void
  const heldSigner = new Promise<string>(r => { releaseSigner = r })
  const heldGate = new Promise<BiometricGateOutcome>(r => { releaseGate = r })
  const baseline = listeners()
  const pending = handleAppsMessage({ type: "apps.add", path: path.resolve("owned-pending-add.exe"), policy: "auto" }, { requestConfirmation: channel }, {
    ...deps,
    signerProbe: () => { if (stage === "signer") { entered(); return heldSigner }; return Promise.resolve("CN=Owned fixture") },
    gate: async () => { gates++; if (stage === "gate") { entered(); return heldGate }; return approval },
  })
  release = () => stage === "signer" ? releaseSigner("CN=Owned fixture") : releaseGate(approval)
  return { pending, ready, release, baseline, gates: () => gates }
}
function replaceDisk(entries: Record<string, AppEntry>) {
  const file = path.join(DATA_DIR, "config.json"), stat = fs.statSync(file)
  const config = JSON.parse(fs.readFileSync(file, "utf8")); config.apps.entries = entries
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
  fs.utimesSync(file, stat.atime, new Date(stat.mtimeMs + 2000))
}
const child: any = require("node:child_process"), net: any = require("node:net"), restore: (() => void)[] = []
let effects = 0
const originalHome = process.env.HOME
before(async () => {
  assert.ok(process.env.CMSPARK_TEST_RUN_DIR, "canonical isolated runner required")
  assert.ok(DATA_DIR.startsWith(process.env.CMSPARK_TEST_RUN_DIR!), "owned config required")
  await initDataDir()
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const original = child[name]; child[name] = () => { effects++; throw new Error("unexpected native process") }; restore.push(() => { child[name] = original })
  }
  const connect = net.Socket.prototype.connect; net.Socket.prototype.connect = () => { effects++; throw new Error("unexpected network") }; restore.push(() => { net.Socket.prototype.connect = connect })
})
after(() => { for (const fn of restore.reverse()) fn(); assert.equal(effects, 0); assert.equal(process.env.HOME, originalHome) })

for (const stage of ["signer", "gate"] as const) {
  test(`add: unchanged ${stage} completes once with original gate and cleans listener`, async () => {
    replaceAppsEntries({ [token]: existing() }); const flow = start(stage); await flow.ready; flow.release()
    const result = await flow.pending, actual = snapshot()
    assert.equal(result.type, "apps.updated"); assert.equal(flow.gates(), 1)
    assert.equal(actual[result.added].policy, "auto"); assert.deepEqual(actual[token], existing()); assert.equal(listeners(), flow.baseline)
  })
  for (const mutation of ["disable", "remove", "sibling", "disable-ABA", "remove-ABA", "alias-ABA"] as const) {
    test(`add: pending ${stage} cannot restore ${mutation} or use its old approval`, async () => {
      replaceAppsEntries({ [token]: existing() }); const flow = start(stage); await flow.ready
      if (mutation === "disable" || mutation === "disable-ABA") {
        await handleAppsMessage({ type: "apps.set_enabled", token, enabled: false }, {}, deps)
        if (mutation === "disable-ABA") await handleAppsMessage({ type: "apps.set_enabled", token, enabled: true }, {}, deps)
      } else if (mutation === "remove" || mutation === "remove-ABA") {
        await handleAppsMessage({ type: "apps.remove", token }, {}, deps)
        if (mutation === "remove-ABA") replaceAppsEntries({ [token]: existing() })
      } else if (mutation === "sibling") {
        assert.equal((await handleAppsMessage(add("OwnedSibling"), {}, deps)).type, "apps.updated")
      } else {
        const alias = getConfig().apps!.entries[token]; alias.enabled = false; replaceAppsEntries(getConfig().apps!.entries)
        alias.enabled = true; replaceAppsEntries(getConfig().apps!.entries)
      }
      const before = snapshot(); flow.release(); const result = await flow.pending
      assert.equal(result.type, "error"); assert.equal(result.family, "apps"); assert.equal(result.code, "APP_ADD_STALE")
      assert.deepEqual(snapshot(), before); assert.equal(listeners(), flow.baseline)
      assert.equal(flow.gates(), stage === "signer" ? 0 : 1, "stale signer result must not open a fresh approval")
    })
  }
  test(`add: ${stage} final actual disk reload cannot be overwritten without an event`, async () => {
    replaceAppsEntries({ [token]: existing() }); const flow = start(stage); await flow.ready
    let events = 0; const onChange = () => { events++ }; configEvents.on(CONFIG_CHANGE_EVENT, onChange)
    try {
      replaceDisk({ [token]: { ...existing(), enabled: false } }); const before = snapshot()
      assert.equal(events, 0, "getConfig mtime reload is not a notification")
      flow.release(); assert.equal((await flow.pending).code, "APP_ADD_STALE"); assert.deepEqual(snapshot(), before)
    } finally { configEvents.off(CONFIG_CHANGE_EVENT, onChange) }
    assert.equal(listeners(), flow.baseline)
  })
  test(`add: ${stage} same authority notification remains valid`, async () => {
    replaceAppsEntries({ [token]: existing() }); const flow = start(stage); await flow.ready
    replaceAppsEntries(structuredClone(snapshot())); flow.release()
    assert.equal((await flow.pending).type, "apps.updated"); assert.equal(listeners(), flow.baseline)
  })
}
for (const sameName of [false, true]) test(`add: concurrent ${sameName ? "same-name" : "distinct-name"} identities never both succeed and lose an entry`, async () => {
  replaceAppsEntries({}); const baseline = listeners()
  const results = await Promise.all([handleAppsMessage(add("OwnedOne", sameName ? "Same name" : "One"), {}, deps), handleAppsMessage(add("OwnedTwo", sameName ? "Same name" : "Two"), {}, deps)])
  const successes = results.filter(r => r.type === "apps.updated"), actual = snapshot()
  assert.ok(successes.length >= 1)
  assert.equal(Object.keys(actual).length, successes.length)
  for (const result of successes) assert.deepEqual(actual[result.added], result.entry)
  for (const result of results.filter(r => r.type !== "apps.updated")) assert.equal(result.code, "APP_ADD_STALE")
  assert.equal(listeners(), baseline)
})
test("add: unrelated configuration update does not revoke the pending app subject", async () => {
  replaceAppsEntries({ [token]: existing() }); const flow = start("gate"); await flow.ready
  const config = getConfig(); saveConfig({ ...config, port: config.port + 1 }); flow.release()
  assert.equal((await flow.pending).type, "apps.updated"); assert.equal(listeners(), flow.baseline)
})
test("add: denied/cancelled approval and gate throw retain entries and release listeners", async () => {
  for (const reason of ["denied", "cancelled"] as const) {
    replaceAppsEntries({ [token]: existing() }); const before = snapshot(), baseline = listeners()
    const result = await handleAppsMessage({ type: "apps.add", path: path.resolve("owned-pending-add.exe"), policy: "auto" }, { requestConfirmation: channel }, { ...deps, gate: async () => ({ approved: false, reason }) })
    assert.equal(result.code, "BIOMETRIC_DENIED"); assert.deepEqual(snapshot(), before); assert.equal(listeners(), baseline)
  }
  const before = snapshot(), baseline = listeners()
  await assert.rejects(handleAppsMessage({ type: "apps.add", path: path.resolve("owned-pending-add.exe"), policy: "auto" }, { requestConfirmation: channel }, { ...deps, gate: async () => { throw new Error("owned gate error") } }), /owned gate error/)
  assert.deepEqual(snapshot(), before); assert.equal(listeners(), baseline)
})
test("add: actual persistence EIO cannot commit or leak a pending watcher", async t => {
  replaceAppsEntries({ [token]: existing() }); const before = snapshot(), flow = start("gate"); await flow.ready
  const nativeFs: any = require("node:fs"), rename = nativeFs.renameSync, target = path.join(DATA_DIR, "config.json"); let faults = 0
  t.mock.method(nativeFs, "renameSync", (from: any, to: any) => {
    if (String(to) === target) { faults++; throw Object.assign(new Error("owned add EIO"), { code: "EIO" }) }
    return rename(from, to)
  })
  const rejected = assert.rejects(flow.pending, /owned add EIO/); flow.release(); await rejected
  assert.equal(faults, 1); assert.deepEqual(snapshot(), before); assert.equal(listeners(), flow.baseline)
  assert.equal(fs.existsSync(`${target}.tmp-${process.pid}`), false)
})
