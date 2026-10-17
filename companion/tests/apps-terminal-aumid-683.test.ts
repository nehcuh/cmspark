// #683: real Apps handler/policy/normalization, scoped Windows JS identity only.
// Canonical runner supplies owned DATA_DIR. No native/GUI/Hello/token is used.
import test, { before, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"
import * as guards from "../src/apps/guards"
import { handleAppsMessage } from "../src/apps/handlers"
import { getConfig, initDataDir, replaceAppsEntries, DATA_DIR, configEvents, CONFIG_CHANGE_EVENT } from "../src/config"
import { normalizeAppEntry, maxPolicyForEntry, validateAppEntry, type AppEntry } from "../src/apps/types"
import { canEverCoordinate, isVaultBrowserEntry, assertCoordinateAllowed } from "../src/computer/policy"
import { securityPolicy } from "../src/security-policy"

const stable = "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"
const token = "win.app.owned_terminal683"
const entry = (extra: Partial<AppEntry> = {}): AppEntry => ({ token, kind: "gui", display_name: "Owned inert Terminal identity", source: "user",
  policy: "manual", enabled: true, added_at: "2026-10-16T00:00:00Z", aumid: stable, ...extra })
const ordinaryExe = { path: "C:\\Owned\\ordinary.exe", signer: "CN=Owned fixture", user_writable_dir: false }
const browserExe = { ...ordinaryExe, path: "C:\\Owned\\msedge.exe" }
const unknown = "Owned.Unmapped_fixture!App"
const disk = () => fs.readFileSync(path.join(DATA_DIR, "config.json"))
function inert(t: TestContext) {
  t.mock.method(os, "platform", () => "win32") // only existing JS platform branch, not native evidence
  const effects = { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 }
  for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    t.mock.method(cp, k, () => { effects.process++; throw Error("OWNED_NATIVE_FORBIDDEN") })
  for (const k of ["issueToken", "issueTokenFor"] as const)
    t.mock.method(securityPolicy, k, () => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") })
  const context = { requestConfirmation: async (): Promise<never> => { effects.confirmation++; throw Error("OWNED_CONFIRMATION_FORBIDDEN") },
    broadcast: () => { effects.broadcast++ } }
  const deps = { gate: async () => { effects.gate++; return { approved: false as const, reason: "denied" as const } } }
  return { effects, context, deps }
}
before(async () => { assert.ok(process.env.CMSPARK_TEST_RUN_DIR, "canonical isolated runner required"); await initDataDir() })

test("stable Terminal exact ASCII case variants map only to existing win.terminal", () => {
  // Keeping the old module compilable permits a same-test counterfactual.
  const resolve = (guards as unknown as Record<string, unknown>).aumidToVault as (value: unknown) => string | null
  assert.equal(typeof resolve, "function")
  for (const id of [stable, stable.toLowerCase(), stable.toUpperCase(), "mIcRoSoFt.WindowsTerminal_8wekyb3d8bbwe!aPp"]) assert.equal(resolve(id), "win.terminal")
})
test("AUMID resolver neither coerces nor accepts neighbors, Preview, Unicode or whitespace", () => {
  const resolve = (guards as unknown as Record<string, unknown>).aumidToVault as (value: unknown) => string | null
  assert.equal(typeof resolve, "function")
  let coercions = 0
  for (const id of [undefined, null, 1, true, Symbol("owned"), { toString() { coercions++; return stable } }, "", unknown,
    ` ${stable}`, `${stable} `, `${stable}\n`, `x${stable}`, `${stable}x`, stable.replace("!App", "!Other"),
    stable.replace("8wekyb3d8bbwe", "otherpublisher"), stable.replace("WindowsTerminal_", "WindowsTerminalPreview_"), stable.replace("Microsoft", "Microsοft")]) assert.equal(resolve(id), null)
  assert.equal(coercions, 0)
})
for (const [label, extra] of [["AUMID only", {}], ["ordinary EXE", { exe: ordinaryExe }], ["browser EXE", { exe: browserExe }]] as const) {
  test(`known Terminal ${label} is structurally denied and cannot use browser one-shot`, t => {
    const { effects } = inert(t), value = entry({ ...extra, coordinateAllowed: true })
    assert.equal(validateAppEntry(value), null)
    assert.equal(canEverCoordinate(value, "win32"), false)
    assert.equal(isVaultBrowserEntry(value, "win32"), false)
    const cfg = { ...getConfig(), apps: { ...getConfig().apps!, enabled: true, entries: { [token]: value } },
      computer: { ...getConfig().computer, coordinateEnabled: true } }
    assert.throws(() => assertCoordinateAllowed(cfg, token, { allowVaultBrowserOneShot: true }), (e: any) => e.code === "APP_COORDINATE_STRUCTURAL")
    assert.deepEqual(effects, { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 })
  })
  test(`actual execution admission refuses known Terminal ${label} even with stored switches and one-shot`, t => {
    const { effects } = inert(t), value = entry({ ...extra, coordinateAllowed: true })
    const cfg = { ...getConfig(), apps: { ...getConfig().apps!, enabled: true, entries: { [token]: value } },
      computer: { ...getConfig().computer, coordinateEnabled: true } }
    assert.throws(() => assertCoordinateAllowed(cfg, token, { allowVaultBrowserOneShot: true }), (e: any) => e.code === "APP_COORDINATE_STRUCTURAL")
    assert.deepEqual(effects, { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 })
  })
  for (const alreadyTrue of [false, true]) test(`actual coordinate handler rejects ${label}, already-true=${alreadyTrue}, before any gate/write`, async t => {
    const { effects, context, deps } = inert(t)
    replaceAppsEntries({ [token]: entry(extra) })
    if (alreadyTrue) getConfig().apps!.entries[token].coordinateAllowed = true // tampered owned in-memory state, no grant API
    const beforeDisk = disk(), beforeEntry = structuredClone(getConfig().apps!.entries[token]), listeners = configEvents.listenerCount(CONFIG_CHANGE_EVENT)
    const actual = await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: true }, context, deps)
    assert.equal(actual.code, "COORDINATE_STRUCTURAL_DENY")
    assert.deepEqual(getConfig().apps!.entries[token], beforeEntry); assert.deepEqual(disk(), beforeDisk)
    assert.equal(configEvents.listenerCount(CONFIG_CHANGE_EVENT), listeners)
    assert.deepEqual(effects, { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 })
  })
}
test("known Terminal normalization clears coordinate/UIA hints but preserves other identity metadata", t => {
  const { effects } = inert(t), value = entry({ coordinateAllowed: true, uiaCapable: true, uiaProbedAt: "2026-10-16T00:00:00Z" })
  const normalized = normalizeAppEntry(value)
  assert.deepEqual(normalized, { ...value, coordinateAllowed: false, uiaCapable: undefined, uiaProbedAt: undefined })
  assert.equal(value.coordinateAllowed, true); assert.equal(maxPolicyForEntry(value), "ai")
  assert.deepEqual(effects, { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 })
})
test("unknown AUMID preserves ordinary Windows eligibility and original EXE denial/browser exception", t => {
  inert(t)
  assert.equal(canEverCoordinate(entry({ aumid: unknown }), "win32"), true)
  assert.equal(canEverCoordinate(entry({ aumid: unknown, exe: ordinaryExe }), "win32"), true)
  for (const exe of [browserExe, { ...ordinaryExe, path: "C:\\Owned\\powershell_ise.exe" }]) assert.equal(canEverCoordinate(entry({ aumid: unknown, exe }), "win32"), false)
  const browser = entry({ aumid: unknown, exe: browserExe })
  assert.equal(isVaultBrowserEntry(browser, "win32"), true)
  const cfg = { ...getConfig(), apps: { ...getConfig().apps!, enabled: true, entries: { [token]: browser } }, computer: { ...getConfig().computer, coordinateEnabled: true } }
  assert.equal(assertCoordinateAllowed(cfg, token, { allowVaultBrowserOneShot: true }), browser)
  assert.equal(guards.checkAddAllowed("C:\\Owned\\powershell_ise.exe", "cli").allowed, false)
  assert.notEqual(validateAppEntry({ ...entry(), token: "win.cli.owned683", kind: "cli", exe: ordinaryExe }), null)
})
test("Darwin bundle-ID semantics are unchanged by a Windows AUMID", () => {
  assert.equal(canEverCoordinate(entry({ bundleId: "com.example.Owned" }), "darwin"), true)
  assert.equal(canEverCoordinate(entry({ bundleId: "com.apple.Terminal" }), "darwin"), false)
  assert.equal(isVaultBrowserEntry(entry({ bundleId: "com.apple.Safari" }), "darwin"), true)
})
test("actual handler import-window identity replacement stays stale with zero gate/effects", async t => {
  const { effects, context, deps } = inert(t); replaceAppsEntries({ [token]: entry({ aumid: unknown }) })
  const pending = handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: true }, context, deps)
  replaceAppsEntries({ [token]: entry() }); const before = disk()
  assert.equal((await pending).code, "APP_GRANT_STALE"); assert.deepEqual(disk(), before)
  assert.deepEqual(effects, { process: 0, issuer: 0, confirmation: 0, gate: 0, broadcast: 0 })
})
