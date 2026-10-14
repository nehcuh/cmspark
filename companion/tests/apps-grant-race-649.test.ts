// #649: real configuration/persistence, inert held gate (no native approval).
import test, { before, after } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleAppsMessage } from "../src/apps/handlers"
import { CONFIG_CHANGE_EVENT, configEvents, getConfig, initDataDir, replaceAppsEntries, DATA_DIR } from "../src/config"
import type { AppEntry } from "../src/apps/types"
import type { BiometricGateOutcome } from "../src/apps/biometric-gate"
const token = "win.app.owned649"
const entry = (): AppEntry => ({ token, kind: "gui", display_name: "Owned inert app", source: "user", policy: "manual", enabled: true,
  added_at: "2026-10-15T00:00:00.000Z", exe: { path: path.resolve("owned-inert.exe"), signer: "CN=Owned fixture", user_writable_dir: false } })
const approval: BiometricGateOutcome = { approved: true, method: "manual-nonce", nonce: "NON_EFFECTIVE_NOT_ISSUED" }
const channel = async (): Promise<never> => { throw new Error("synthetic gate must not call native/confirmation") }
const listeners = () => configEvents.listenerCount(CONFIG_CHANGE_EVENT)
function snapshot() {
  const actual = structuredClone(getConfig().apps!.entries)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")).apps.entries, actual)
  return actual
}
function start(outlet: "policy" | "coordinate") {
  let release!: (r: BiometricGateOutcome) => void, entered!: () => void
  const ready = new Promise<void>(r => { entered = r }), hold = new Promise<BiometricGateOutcome>(r => { release = r }); let gates = 0
  const pending = handleAppsMessage(outlet === "policy" ? { type: "apps.set_policy", token, policy: "auto" } :
    { type: "apps.set_coordinate_allowed", token, allowed: true }, { requestConfirmation: channel }, {
      gate: async () => { gates++; entered(); return hold }, clearAppTrust: () => 0,
    })
  return { pending, ready, release, gates: () => gates }
}
const child = require("node:child_process")
const nativeMethods = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]
const originalNative = new Map<string, any>(); let nativeCalls = 0
before(async () => {
  assert.ok(process.env.CMSPARK_TEST_RUN_DIR, "canonical isolated runner required"); await initDataDir()
  for (const name of nativeMethods) { originalNative.set(name, child[name]); child[name] = () => { nativeCalls++; throw new Error("unexpected native child") } }
})
after(() => {
  for (const [name, original] of originalNative) child[name] = original
  assert.equal(nativeCalls, 0, "no native Hello/process was invoked by these synthetic grant controls")
})
for (const outlet of ["policy", "coordinate"] as const) {
  for (const mutation of ["remove", "disable", "replace", "remove-ABA", "disable-ABA", "cap-ABA", "coordinate-revoke-ABA"] as const) {
    test(`${outlet}: late approval preserves ${mutation} and cleans watcher`, async () => {
      const original = entry(); replaceAppsEntries({ [token]: original }); const baseline = listeners(), flow = start(outlet); await flow.ready
      if (mutation === "remove" || mutation === "remove-ABA") {
        await handleAppsMessage({ type: "apps.remove", token }, {}, { clearAppTrust: () => 0 }); if (mutation === "remove-ABA") replaceAppsEntries({ [token]: original })
      } else if (mutation === "disable" || mutation === "disable-ABA") {
        await handleAppsMessage({ type: "apps.set_enabled", token, enabled: false }, {}, { clearAppTrust: () => 0 })
        if (mutation === "disable-ABA") await handleAppsMessage({ type: "apps.set_enabled", token, enabled: true }, {}, { clearAppTrust: () => 0 })
      } else if (mutation === "replace") replaceAppsEntries({ [token]: { ...original, exe: { ...original.exe!, path: path.resolve("owned-replaced.exe"), user_writable_dir: true } } })
      else if (mutation === "cap-ABA") { replaceAppsEntries({ [token]: { ...original, exe: { ...original.exe!, signer: undefined } } }); replaceAppsEntries({ [token]: original }) }
      else { replaceAppsEntries({ [token]: { ...original, coordinateAllowed: true } }); await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: false }, {}, { clearAppTrust: () => 0 }); replaceAppsEntries({ [token]: original }) }
      const before = snapshot(); flow.release(approval); const result = await flow.pending
      assert.equal(result.code, "APP_GRANT_STALE"); assert.deepEqual(snapshot(), before); assert.equal(listeners(), baseline)
    })
  }
  test(`${outlet}: sibling change survives unchanged target approval`, async () => {
    replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start(outlet); await flow.ready
    const sibling = { ...entry(), token: "win.app.sibling649", enabled: false }; replaceAppsEntries({ ...getConfig().apps!.entries, [sibling.token]: sibling }); flow.release(approval)
    assert.equal((await flow.pending).type, "apps.updated"); const actual = snapshot(); assert.deepEqual(actual[sibling.token], sibling)
    assert.equal(outlet === "policy" ? actual[token].policy : actual[token].coordinateAllowed, outlet === "policy" ? "auto" : true); assert.equal(listeners(), baseline)
  })
  test(`${outlet}: initially disabled unchanged entry remains disabled`, async () => {
    replaceAppsEntries({ [token]: { ...entry(), enabled: false } }); const baseline = listeners(), flow = start(outlet); await flow.ready; flow.release(approval)
    assert.equal((await flow.pending).type, "apps.updated"); assert.equal(snapshot()[token].enabled, false); assert.equal(listeners(), baseline)
  })
  for (const reason of ["denied", "cancelled", "timeout", "disconnect", "error"] as const) test(`${outlet}: ${reason} preserves removal and cleans watcher`, async () => {
    replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start(outlet); await flow.ready
    await handleAppsMessage({ type: "apps.remove", token }, {}, { clearAppTrust: () => 0 }); flow.release({ approved: false, reason })
    assert.equal((await flow.pending).code, "BIOMETRIC_DENIED"); assert.deepEqual(snapshot(), {}); assert.equal(listeners(), baseline)
  })
  test(`${outlet}: gate throw cleans watcher without write`, async () => {
    replaceAppsEntries({ [token]: entry() }); const before = snapshot(), baseline = listeners()
    await assert.rejects(handleAppsMessage(outlet === "policy" ? { type: "apps.set_policy", token, policy: "auto" } : { type: "apps.set_coordinate_allowed", token, allowed: true },
      { requestConfirmation: channel }, { gate: async () => { throw new Error("owned gate failure") }, clearAppTrust: () => 0 }), /owned gate failure/)
    assert.deepEqual(snapshot(), before); assert.equal(listeners(), baseline)
  })
}
test("coordinate: removal in actual import microtask window denies before gate", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start("coordinate")
  await handleAppsMessage({ type: "apps.remove", token }, {}, { clearAppTrust: () => 0 }); flow.release(approval)
  assert.equal((await flow.pending).code, "APP_GRANT_STALE"); assert.equal(flow.gates(), 0); assert.deepEqual(snapshot(), {}); assert.equal(listeners(), baseline)
})
test("parallel grants do not overwrite first committed state", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), first = start("policy"), second = start("coordinate")
  await Promise.all([first.ready, second.ready]); first.release(approval); assert.equal((await first.pending).type, "apps.updated")
  const committed = snapshot(); second.release(approval); assert.equal((await second.pending).code, "APP_GRANT_STALE"); assert.deepEqual(snapshot(), committed); assert.equal(listeners(), baseline)
})
test("unchanged subject on config notification is not falsely revoked", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start("policy"); await flow.ready
  replaceAppsEntries(structuredClone(getConfig().apps!.entries)); flow.release(approval); assert.equal((await flow.pending).type, "apps.updated"); assert.equal(listeners(), baseline)
})
test("existing missing-channel/cap/vault refusals remain", async () => {
  const baseline = listeners(); replaceAppsEntries({ [token]: entry() }); assert.equal((await handleAppsMessage({ type: "apps.set_policy", token, policy: "auto" })).code, "NO_CONFIRMATION_CHANNEL")
  replaceAppsEntries({ [token]: { ...entry(), exe: { ...entry().exe!, user_writable_dir: true } } })
  assert.equal((await handleAppsMessage({ type: "apps.set_policy", token, policy: "auto" }, { requestConfirmation: channel })).code, "POLICY_CAP_EXCEEDED")
  replaceAppsEntries({ [token]: { ...entry(), exe: { ...entry().exe!, path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" } } })
  assert.equal((await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: true }, { requestConfirmation: channel })).code, "COORDINATE_STRUCTURAL_DENY"); assert.equal(listeners(), baseline)
})

test("coordinate structural eligibility is checked both after import and after approval", async () => {
  const policy: any = await import("../src/computer/policy"), original = policy.canEverCoordinate; let checks = 0
  policy.canEverCoordinate = (...args: any[]) => { checks++; return original(...args) }
  try {
    replaceAppsEntries({ [token]: entry() }); const flow = start("coordinate"); await flow.ready; assert.equal(checks, 1)
    flow.release(approval); assert.equal((await flow.pending).type, "apps.updated"); assert.equal(checks, 2)
  } finally { policy.canEverCoordinate = original }
})
for (const outlet of ["policy", "coordinate"] as const) test(`${outlet}: persistence throw cleans pending watcher`, async () => {
  const config: any = await import("../src/config"), original = config.replaceAppsEntries
  replaceAppsEntries({ [token]: entry() }); const before = snapshot(), baseline = listeners(), flow = start(outlet); await flow.ready
  config.replaceAppsEntries = () => { throw new Error("owned persistence failure") }
  try { flow.release(approval); await assert.rejects(flow.pending, /owned persistence failure/); assert.equal(listeners(), baseline); assert.deepEqual(snapshot(), before) }
  finally { config.replaceAppsEntries = original }
})
test("an in-place host mutation is detected against the immutable captured projection", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start("policy"); await flow.ready
  const actual = getConfig().apps!.entries[token]; actual.enabled = false
  replaceAppsEntries(getConfig().apps!.entries); actual.enabled = true; replaceAppsEntries(getConfig().apps!.entries)
  const before = snapshot(); flow.release(approval); assert.equal((await flow.pending).code, "APP_GRANT_STALE"); assert.deepEqual(snapshot(), before); assert.equal(listeners(), baseline)
})

test("read-only UIA probe hints may refresh without revoking an unchanged grant subject", async () => {
  replaceAppsEntries({ [token]: entry() }); const baseline = listeners(), flow = start("policy"); await flow.ready
  const hints = { ...getConfig().apps!.entries[token], uiaCapable: true, uiaProbedAt: "2026-10-15T01:00:00.000Z" }
  replaceAppsEntries({ [token]: hints }); flow.release(approval); assert.equal((await flow.pending).type, "apps.updated")
  const current = snapshot()[token]; assert.equal(current.uiaCapable, true); assert.equal(current.uiaProbedAt, hints.uiaProbedAt); assert.equal(listeners(), baseline)
})
test("coordinate idempotent outlet returns latest sibling projection after its import", async () => {
  replaceAppsEntries({ [token]: { ...entry(), coordinateAllowed: true } })
  const flow = start("coordinate"), sibling = { ...entry(), token: "win.app.sibling649" }
  replaceAppsEntries({ ...getConfig().apps!.entries, [sibling.token]: sibling }); flow.release(approval)
  const result = await flow.pending; assert.equal(result.type, "apps.updated"); assert.ok(result.entries.some((e: AppEntry) => e.token === sibling.token))
  assert.equal(flow.gates(), 0); assert.deepEqual(snapshot()[sibling.token], sibling)
})
