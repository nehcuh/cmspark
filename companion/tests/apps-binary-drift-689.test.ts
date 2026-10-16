import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { CONFIG_CHANGE_EVENT, configEvents, getConfig, initDataDir, replaceAppsEntries, saveConfig, clearConfigCache } from "../src/config"
import { handleAppsMessage } from "../src/apps/handlers"
import { validateAppEntry, type AppEntry } from "../src/apps/types"
import { validateWsMessage } from "../src/ws/validate"
import { binaryDriftDigest } from "../src/apps/binary-drift-state"
import { guiTemplateSubject } from "../src/apps/gui-templates"
import { requireAppsBiometric } from "../src/apps/biometric-gate"
import * as fs from "node:fs"
import * as path from "node:path"

const A = "a".repeat(64), B = "b".repeat(64)
const token = "win.app.drift689"
const entry = (): AppEntry => ({ token, kind: "gui", source: "user", display_name: "Owned inert editor",
  enabled: true, policy: "auto", added_at: "2026-10-17T00:00:00Z",
  exe: { path: "C:\\Owned\\inert.exe", sha256: A, signer: "CN=Owned inert", user_writable_dir: false } })
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR, "canonical owned test preload required"); await initDataDir() })
function seed() { saveConfig({ apps: { enabled: true, entries: {} } }); replaceAppsEntries({ [token]: entry(), "win.app.sibling689": { ...entry(), token: "win.app.sibling689", display_name: "Sibling" } }) }
const ctx = { ownerCurrent: () => true, requestConfirmation: async () => ({ confirmationId: "owned", approved: true, reason: "approved" as const }) }
const deps = (hash = B) => ({ platform: "win32", clearAppTrust: () => 0,
  measure: async (_entry: AppEntry, checkpoint: () => void) => { checkpoint(); return { sha256: hash, signer: "CN=Owned inert", userWritable: false, recheck: checkpoint } },
  gate: async () => ({ approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" }) }) as any

test("689 strict record rejects extra fields and nonmanual record", () => {
  const record = { schema_version: 1, status: "suspended", approved_sha256: A, observed_sha256: B,
    restore_policy: "auto", subject_digest: "c".repeat(64) }
  assert.notEqual(validateAppEntry({ ...entry(), binary_drift: record }), null)
  assert.notEqual(validateAppEntry({ ...entry(), policy: "manual", binary_drift: { ...record, extra: true } }), null)
})
test("689 registered WS schema accepts only the fixed three messages", () => {
  for (const type of ["apps.drift_status", "apps.check_drift"]) {
    assert.equal(validateWsMessage({ type, token }).valid, true)
    assert.equal(validateWsMessage({ type, token, path: "C:\\Foreign\\file.exe" }).valid, false)
  }
  assert.equal(validateWsMessage({ type: "apps.reapprove", token, expected_old_sha256: A, expected_observed_sha256: B }).valid, true)
  assert.equal(validateWsMessage({ type: "apps.reapprove", token, expected_old_sha256: A, expected_observed_sha256: B, restore_policy: "auto" }).valid, false)
})
test("689 readonly status does not invoke measurement or change the real store", async () => {
  seed(); const before = JSON.stringify(getConfig().apps); let reads = 0
  const out: any = await handleAppsMessage({ type: "apps.drift_status", token }, ctx as any, { ...deps(), measure: async () => { reads++; throw Error("must not read") } })
  assert.equal(out.status, "not_checked"); assert.equal(reads, 0); assert.equal(JSON.stringify(getConfig().apps), before)
  assert.equal(JSON.stringify(out).includes("C:\\\\Owned"), false)
})
test("689 actual Check persists manual with old pin and preserves sibling", async () => {
  seed(); const out: any = await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps())
  assert.equal(out.status, "suspended"); const e = getConfig().apps!.entries[token] as any
  assert.equal(e.policy, "manual"); assert.equal(e.exe.sha256, A); assert.equal(e.binary_drift.observed_sha256, B)
  assert.equal(e.binary_drift.restore_policy, "auto"); assert.ok(getConfig().apps!.entries["win.app.sibling689"])
})
test("689 actual Reapprove measures twice around D2 and adopts only the displayed hash", async () => {
  seed(); await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps()); let measures = 0, gates = 0
  const d = deps(); d.measure = async (_e: AppEntry, checkpoint: () => void) => { measures++; checkpoint(); return { sha256: B, signer: "CN=Owned inert", userWritable: false, recheck: checkpoint } }
  d.gate = async () => { gates++; return { approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" } }
  const out: any = await handleAppsMessage({ type: "apps.reapprove", token, expected_old_sha256: A, expected_observed_sha256: B }, ctx as any, d)
  assert.equal(out.status, "reapproved"); assert.equal(measures, 2); assert.equal(gates, 1)
  const e = getConfig().apps!.entries[token] as any; assert.equal(e.exe.sha256, B); assert.equal(e.policy, "auto"); assert.equal(e.binary_drift, undefined)
})
test("689 initial failed Check does not fabricate manual suspension", async () => {
  seed(); const before = JSON.stringify(getConfig().apps)
  const out: any = await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, { ...deps(), measure: async () => { throw Error("inert read failed") } })
  assert.equal(out.code, "APP_DRIFT_MEASUREMENT_FAILED"); assert.equal(JSON.stringify(getConfig().apps), before)
  assert.equal(getConfig().apps!.entries[token].policy, "auto")
})

const native = require("node:child_process")
const savedNative = new Map<string, any>(); let nativeEffects = 0
before(() => { for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  savedNative.set(key, native[key]); native[key] = () => { nativeEffects++; throw Error("no native effect admitted") }
} })
after(() => { for (const [key, value] of savedNative) native[key] = value; assert.equal(nativeEffects, 0) })
const reapprove = () => ({ type: "apps.reapprove", token, expected_old_sha256: A, expected_observed_sha256: B })
const listeners = () => configEvents.listenerCount(CONFIG_CHANGE_EVENT)
const state = () => structuredClone(getConfig().apps)
async function suspended() { seed(); assert.equal((await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps())).status, "suspended") }
function heldGate(d = deps(), owner = ctx) {
  let enter!: () => void, release!: (value: any) => void
  const ready = new Promise<void>(resolve => { enter = resolve }), wait = new Promise<any>(resolve => { release = resolve })
  d.gate = async () => { enter(); return wait }
  const pending = handleAppsMessage(reapprove(), owner as any, d)
  return { ready, pending, approve: () => release({ approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" }) }
}
for (const invalid of ["schema", "extra", "policy", "pin", "status", "digest"] as const) test(`689 structural ${invalid} refuses status and Check before measurement`, async () => {
  await suspended(); const map = structuredClone(getConfig().apps!.entries), e: any = map[token]
  if (invalid === "schema") e.binary_drift.schema_version = 2
  if (invalid === "extra") e.binary_drift.extra = true
  if (invalid === "policy") e.policy = "auto"
  if (invalid === "pin") e.binary_drift.approved_sha256 = B
  if (invalid === "status") e.binary_drift.status = "other"
  if (invalid === "digest") e.binary_drift.subject_digest = "bad"
  replaceAppsEntries(map); const before = state(); let calls = 0
  for (const type of ["apps.drift_status", "apps.check_drift"]) assert.equal((await handleAppsMessage({ type, token }, ctx as any,
    { ...deps(), measure: async () => { calls++; throw Error("must not measure") } } as any)).code, "APP_DRIFT_STATE_INVALID")
  assert.equal(calls, 0); assert.deepEqual(state(), before)
})
test("689 restart retains legal suspension; legal digest mismatch is review_again and fresh Check restores current manual only", async () => {
  await suspended(); const before = state(); clearConfigCache(); assert.deepEqual(state(), before)
  const entries = structuredClone(getConfig().apps!.entries); entries[token].display_name = "Changed current name"; replaceAppsEntries(entries)
  assert.equal((await handleAppsMessage({ type: "apps.drift_status", token }, ctx as any, deps())).status, "review_again")
  assert.equal((await handleAppsMessage(reapprove(), ctx as any, deps())).code, "APP_DRIFT_REVIEW_STALE")
  assert.equal((await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps())).status, "suspended")
  assert.equal(getConfig().apps!.entries[token].binary_drift!.restore_policy, "manual")
})
for (const mutation of ["manual", "disable-enable", "coordinate-off", "global-off"] as const) test(`689 ${mutation} cannot revive old auto intent`, async () => {
  await suspended()
  if (mutation === "manual") await handleAppsMessage({ type: "apps.set_policy", token, policy: "manual" }, {}, deps())
  if (mutation === "disable-enable") for (const enabled of [false, true]) await handleAppsMessage({ type: "apps.set_enabled", token, enabled }, {}, deps())
  if (mutation === "coordinate-off") await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: false }, {}, deps())
  if (mutation === "global-off") saveConfig({ apps: { ...getConfig().apps!, enabled: false } })
  assert.equal((await handleAppsMessage({ type: "apps.drift_status", token }, ctx as any, deps())).status, "review_again")
  assert.equal((await handleAppsMessage(reapprove(), ctx as any, deps())).code, mutation === "global-off" ? "APP_DRIFT_DISABLED" : "APP_DRIFT_REVIEW_STALE")
  assert.equal(getConfig().apps!.entries[token].policy, "manual")
})
for (const policy of ["auto", "ai"]) test(`689 suspended and invalidated block ${policy} before gate`, async () => {
  await suspended(); let calls = 0; const d = { ...deps(), gate: async () => { calls++; throw Error("no gate") } }
  for (const invalidated of [false, true]) {
    if (invalidated) await handleAppsMessage({ type: "apps.set_policy", token, policy: "manual" }, {}, deps())
    assert.equal((await handleAppsMessage({ type: "apps.set_policy", token, policy }, ctx as any, d as any)).code, "APP_DRIFT_REAPPROVAL_REQUIRED")
    assert.equal((await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: true }, ctx as any, d as any)).code, "APP_DRIFT_REAPPROVAL_REQUIRED")
  }
  assert.equal(calls, 0)
})
for (const mutation of ["remove", "enabledABA", "pinABA", "globalABA", "manual", "mutableABA", "templatesABA", "cliManifestABA"] as const) test(`689 current request permanently stale on ${mutation}`, async () => {
  await suspended(); const count = listeners(), original = structuredClone(getConfig().apps!.entries[token]), flow = heldGate(); await flow.ready
  const write = (e: AppEntry) => replaceAppsEntries({ ...getConfig().apps!.entries, [token]: e })
  if (mutation === "remove") { const { [token]: _removed, ...rest } = getConfig().apps!.entries; replaceAppsEntries(rest) }
  if (mutation === "enabledABA") { await handleAppsMessage({ type: "apps.set_enabled", token, enabled: false }, {}, deps()); write(original) }
  if (mutation === "pinABA") { const { binary_drift: _r, ...rest } = original; write({ ...rest, exe: { ...rest.exe!, sha256: B } }); write(original) }
  if (mutation === "globalABA") { saveConfig({ apps: { ...getConfig().apps!, enabled: false } }); saveConfig({ apps: { ...getConfig().apps!, enabled: true } }) }
  if (mutation === "manual") await handleAppsMessage({ type: "apps.set_policy", token, policy: "manual" }, {}, deps())
  if (mutation === "mutableABA") { const alias = getConfig().apps!.entries[token]; alias.display_name = "Mutated"; replaceAppsEntries(getConfig().apps!.entries); alias.display_name = original.display_name; replaceAppsEntries(getConfig().apps!.entries) }
  if (mutation === "templatesABA") { write({ ...original, templates: [] }); write(original) }
  if (mutation === "cliManifestABA") { write({ ...original, cli_manifest: { owned: "unsupported-carrier" } } as any); write(original) }
  const before = state(); flow.approve(); assert.equal((await flow.pending).code, "APP_GRANT_STALE"); assert.deepEqual(state(), before); assert.equal(listeners(), count)
})
test("689 sibling change and UIA hint survive current-map commit", async () => {
  await suspended(); const flow = heldGate(); await flow.ready
  const entries = structuredClone(getConfig().apps!.entries); entries["win.app.sibling689"].display_name = "New sibling"; entries[token].uiaCapable = true; replaceAppsEntries(entries)
  flow.approve(); assert.equal((await flow.pending).status, "reapproved")
  assert.equal(getConfig().apps!.entries["win.app.sibling689"].display_name, "New sibling"); assert.equal(getConfig().apps!.entries[token].uiaCapable, true)
})
test("689 disconnected owner after software Hello denies; missing owner denies before measurement", async () => {
  await suspended(); let connected = true; const flow = heldGate(deps(), { ...ctx, ownerCurrent: () => connected }); await flow.ready
  connected = false; const before = state(); flow.approve(); assert.equal((await flow.pending).code, "APP_GRANT_STALE"); assert.deepEqual(state(), before)
  assert.equal((await handleAppsMessage({ type: "apps.check_drift", token }, {}, deps())).code, "APP_DRIFT_REVIEW_STALE")
})
test("689 two simultaneous approvals cannot both commit", async () => {
  await suspended(); const one = heldGate(), two = heldGate(); await Promise.all([one.ready, two.ready]); one.approve()
  assert.equal((await one.pending).status, "reapproved"); const before = state(); two.approve(); assert.equal((await two.pending).code, "APP_GRANT_STALE"); assert.deepEqual(state(), before)
})
test("689 file changed after D2 or cap reduced never adopts", async () => {
  for (const mode of ["hash", "cap", "fence"] as const) {
    await suspended(); let n = 0
    const d = deps(); d.measure = async (_e: AppEntry, check: () => void) => ({ sha256: mode === "hash" && ++n === 2 ? "c".repeat(64) : B,
      signer: "CN=Owned inert", userWritable: mode === "cap", recheck: () => { check(); if (mode === "fence") throw Error("file changed") } })
    const before = state(); const out = await handleAppsMessage(reapprove(), ctx as any, d)
    assert.equal(out.code, mode === "hash" ? "APP_DRIFT_CHANGED_AGAIN" : mode === "cap" ? "APP_DRIFT_POLICY_CAP" : "APP_DRIFT_MEASUREMENT_FAILED"); assert.deepEqual(state(), before)
  }
})
test("689 strict trust clear before Reapprove commit; Check failure leaves known manual commit", async () => {
  await suspended(); const before = state(); const d = { ...deps(), clearAppTrust: () => { throw Error("inert trust store failure") } }
  assert.equal((await handleAppsMessage(reapprove(), ctx as any, d)).code, "APP_DRIFT_MEASUREMENT_FAILED"); assert.deepEqual(state(), before)
  seed(); const out = await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, d)
  assert.equal(out.code, "APP_DRIFT_TRUST_CLEAR_FAILED"); assert.equal(out.outcome, "committed"); assert.equal(getConfig().apps!.entries[token].policy, "manual")
})
for (const phase of ["prewrite", "postcommit", "lostAck"] as const) test(`689 actual writer ${phase} is unknown without rollback; fresh status is independent`, async () => {
  await suspended(); const before = state(); let writerCalls = 0
  const listener = () => { throw Error("owned postcommit observer") }
  if (phase === "postcommit") configEvents.on(CONFIG_CHANGE_EVENT, listener)
  const d = { ...deps(), persistEntries: (entries: Record<string, AppEntry>) => { writerCalls++
    if (phase === "prewrite") throw Error("owned prewrite failure")
    const result = replaceAppsEntries(entries); if (phase === "lostAck") throw Error("owned ACK discard"); return result
  } }
  let out: any
  try { out = await handleAppsMessage(reapprove(), ctx as any, d) } finally { configEvents.off(CONFIG_CHANGE_EVENT, listener) }
  assert.equal(out.code, "APP_DRIFT_COMMIT_UNCERTAIN"); assert.equal(out.outcome, "unknown"); assert.equal(writerCalls, 1)
  const actual = state(); if (phase === "prewrite") assert.deepEqual(actual, before)
  else { assert.equal(actual!.entries[token].exe!.sha256, B); assert.equal(actual!.entries[token].policy, "auto"); assert.equal(actual!.entries[token].binary_drift, undefined) }
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.CMSPARK_DATA_DIR!, "config.json"), "utf8")).apps
  assert.deepEqual(disk, actual)
  assert.equal((await handleAppsMessage({ type: "apps.drift_status", token }, ctx as any, deps())).status, phase === "prewrite" ? "suspended" : "not_checked")
})
test("689 record participates in existing template subject; template profile is unchanged", async () => {
  seed(); const old = structuredClone(getConfig().apps!.entries[token]), oldSubject = guiTemplateSubject(old, true)
  await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps()); assert.notEqual(guiTemplateSubject(getConfig().apps!.entries[token], true), oldSubject)
  assert.notEqual(binaryDriftDigest(getConfig().apps!.entries[token], true), oldSubject)
})
test("689 same pin after suspension still requires a fresh D2", async () => {
  await suspended(); let calls = 0; const d = deps(A); d.gate = async () => { calls++; return { approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" } }
  await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, d)
  const out = await handleAppsMessage({ type: "apps.reapprove", token, expected_old_sha256: A, expected_observed_sha256: A }, ctx as any, d)
  assert.equal(out.status, "reapproved"); assert.equal(calls, 1)
})
for (const hello of ["cancelled", "unavailable"] as const) test(`689 real D2 ${hello} uses original software branch, not native`, async () => {
  await suspended(); let requests = 0; const d = deps()
  d.gate = (req: any) => requireAppsBiometric({ ...req, requestConfirmation: async () => { requests++; return { approved: false, reason: "denied", confirmationId: "owned" } },
    deps: { platform: "win32", tryHello: async () => hello === "cancelled" ? { cancelled: true } : { unavailable: true }, generateNonce: () => "INERT0" } })
  const before = state(); assert.equal((await handleAppsMessage(reapprove(), ctx as any, d)).code, "BIOMETRIC_DENIED")
  assert.equal(requests, hello === "cancelled" ? 0 : 1); assert.deepEqual(state(), before)
})
for (const outlet of ["policy", "coordinate"] as const) test(`689 pending legacy ${outlet} cannot cross Check or record ABA`, async () => {
  seed(); const first = { ...getConfig().apps!.entries[token], policy: "manual" as const }; replaceAppsEntries({ [token]: first })
  let entered!: () => void, release!: (v: any) => void
  const ready = new Promise<void>(r => entered = r), hold = new Promise<any>(r => release = r)
  const pending = handleAppsMessage(outlet === "policy" ? { type: "apps.set_policy", token, policy: "auto" } : { type: "apps.set_coordinate_allowed", token, allowed: true }, ctx as any,
    { ...deps(), gate: async () => { entered(); return hold } })
  await ready; await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps()); replaceAppsEntries({ [token]: first })
  const before = state(); release({ approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" })
  assert.equal((await pending).code, "APP_GRANT_STALE"); assert.deepEqual(state(), before)
})
test("689 pending legacy add keeps current suspension and cannot overwrite the map", async () => {
  seed(); let entered!: () => void, release!: (value: string) => void
  const ready = new Promise<void>(r => entered = r), hold = new Promise<string>(r => release = r)
  const pending = handleAppsMessage({ type: "apps.add", kind: "gui", path: path.resolve("/Owned689/added.exe"), display_name: "Added inert", policy: "manual" }, {},
    { exists: () => true, realpath: value => value, signerProbe: async () => { entered(); return hold }, clearAppTrust: () => 0 })
  await ready; await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps()); const before = state(); release("CN=Owned inert")
  assert.equal((await pending).code, "APP_ADD_STALE"); assert.deepEqual(state(), before)
})
test("689 lazy list leaves the existing suspension byte exact", async () => {
  await suspended(); const before = structuredClone(getConfig().apps!.entries[token])
  await handleAppsMessage({ type: "apps.list" }, {}, { ...deps(), exists: () => false, signerProbe: async () => { throw Error("no read") } })
  assert.deepEqual(getConfig().apps!.entries[token], before)
})
test("689 existing true coordinate is blocked before idempotent branch", async () => {
  seed(); replaceAppsEntries({ ...getConfig().apps!.entries, [token]: { ...getConfig().apps!.entries[token], coordinateAllowed: true } })
  await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps())
  assert.equal((await handleAppsMessage({ type: "apps.set_coordinate_allowed", token, allowed: true }, ctx as any, deps())).code, "APP_DRIFT_REAPPROVAL_REQUIRED")
})
test("689 real template pending approval and issued private receipt become stale on Check", async () => {
  const { admitGuiTemplate } = await import("../src/apps/gui-template-runtime")
  const template: any = { id: "open_text", name: "Owned inert text", profile: "npp-8.9.8.1-x64-local-text-v1", risk: "state-changing",
    argv: ["-multiInst", "-nosession", "-noPlugin", "-ro", { file_slot: "file" }] }
  const params = { app: token, action: "run_template", template: "open_text", params: { file: "C:\\Owned\\text.txt" } }
  for (const phase of ["pending", "receipt"] as const) {
    seed(); replaceAppsEntries({ ...getConfig().apps!.entries, [token]: { ...getConfig().apps!.entries[token], templates: [template] } })
    let entered!: () => void, release!: (v: any) => void, tokens = 0, launches = 0
    const ready = new Promise<void>(r => entered = r), hold = new Promise<any>(r => release = r)
    const pending = admitGuiTemplate({ params, ownerCurrent: () => true, requestConfirmation: async () => { entered(); return hold } }, {
      platform: () => "win32", files: async (_e, file, check) => { check(); return { canonicalExe: entry().exe!.path, canonicalFile: file, bindingIdentity: "INERT_NO_AUTHORITY", recheck: check } },
      policy: { issueToken: () => { tokens++; return { token: "INERT_NON_EFFECTIVE_ONLY" } }, validateToken: () => true } as any,
      spawn: (() => { launches++; throw Error("no app") }) as any,
    })
    await ready
    if (phase === "pending") {
      await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps()); release({ approved: true, reason: "approved" })
      await assert.rejects(pending); assert.equal(tokens, 0)
    } else {
      release({ approved: true, reason: "approved" }); const accepted = await pending
      await handleAppsMessage({ type: "apps.check_drift", token }, ctx as any, deps())
      assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, false); assert.equal(tokens, 1)
    }
    assert.equal(launches, 0)
  }
})
test("689 nonce fallback uses the real origin-bound manager and refuses another socket", async () => {
  const { SecurityConfirmationManager } = await import("../src/security-confirmation")
  await suspended(); const manager = new SecurityConfirmationManager(), owner: any = {}, stranger: any = {}, abort = new AbortController(); let payload: any, entered!: () => void
  const ready = new Promise<void>(r => entered = r)
  const context = { ownerCurrent: () => true, requestConfirmation: (details: any) => manager.request(data => { payload = data; entered() }, details, { originWs: owner, signal: abort.signal }) }
  const d = deps(); d.gate = (req: any) => requireAppsBiometric({ ...req, deps: { platform: "win32", tryHello: async () => ({ unavailable: true }), generateNonce: () => "INERT0" } })
  const pending = handleAppsMessage(reapprove(), context, d); await ready
  try {
  assert.equal(manager.respondFrom(payload.confirmation_id, true, stranger, "INERT0").outcome, "origin_mismatch")
  assert.equal(getConfig().apps!.entries[token].policy, "manual")
  assert.equal(manager.respondFrom(payload.confirmation_id, true, owner, "WRONG0").outcome, "nonce_retry")
  assert.equal(manager.respondFrom(payload.confirmation_id, true, owner, "INERT0").outcome, "resolved")
  assert.equal((await pending).status, "reapproved")
  } finally { abort.abort(); await pending }
})

test("689 structurally invalid loaded record cannot be re-enabled through legacy management", async () => {
  await suspended(); const entries = structuredClone(getConfig().apps!.entries); (entries[token].binary_drift as any).schema_version = 2
  replaceAppsEntries(entries); clearConfigCache(); assert.equal(getConfig().apps!.entries[token].enabled, false)
  const before = state(); const out = await handleAppsMessage({ type: "apps.set_enabled", token, enabled: true }, {}, deps())
  assert.equal(out.code, "APP_DRIFT_STATE_INVALID"); assert.deepEqual(state(), before)
})

test("689 malformed record carrier fails validation without throwing during config load", () => {
  for (const tokenValue of [undefined, null, 1, {}, []]) assert.notEqual(validateAppEntry({ ...entry(), token: tokenValue, binary_drift: {
    schema_version: 1, status: "suspended", approved_sha256: A, observed_sha256: B, restore_policy: "auto", subject_digest: "c".repeat(64) }, policy: "manual" }), null)
})

// Invalid persisted records are present even when their JSON value is falsy.
for (const value of [null, false, 0, "", [], {}]) for (const outlet of ["coordinate", "policy-auto", "policy-manual"] as const)
  test(`689 invalid record ${JSON.stringify(value)} refuses ${outlet} before gate or no-op`, async () => {
    seed(); const entries = structuredClone(getConfig().apps!.entries)
    entries[token] = { ...entries[token], policy: "manual", binary_drift: value as any }
    replaceAppsEntries(entries); clearConfigCache(); assert.equal(getConfig().apps!.entries[token].enabled, false)
    let gates = 0; const before = state(), d = { ...deps(), gate: async () => { gates++; return { approved: true, method: "windows-hello", nonce: "INERT_SOFTWARE_ONLY" } } }
    const message = outlet === "coordinate" ? { type: "apps.set_coordinate_allowed", token, allowed: true }
      : { type: "apps.set_policy", token, policy: outlet === "policy-auto" ? "auto" : "manual" }
    const out = await handleAppsMessage(message, ctx as any, d as any)
    assert.equal(gates, 0); assert.equal(out.type, "error"); assert.deepEqual(state(), before)
  })
