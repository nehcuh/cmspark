// WP2 apps.* handlers — full matrix with injected gate/enumerate/fs deps.
// Config is real (pinned to a throwaway DATA_DIR by the setup import) so the
// replaceAppsEntries round-trip is exercised; everything else is faked.

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config import.

import test, { before } from "node:test"
import * as assert from "node:assert/strict"

import { handleAppsMessage, type AppsHandlerDeps } from "../src/apps/handlers"
import { maxPolicyForEntry, type AppEntry } from "../src/apps/types"

let getConfig: typeof import("../src/config").getConfig
let replaceAppsEntries: typeof import("../src/config").replaceAppsEntries
let initDataDir: typeof import("../src/config").initDataDir

const WIN = process.platform === "win32"
const SYS_EXE = WIN ? "C:\\Program Files\\TestApp\\app.exe" : "/opt/testapp/app.exe"
const CHROME_EXE = WIN ? "C:\\Google\\chrome.exe" : "/opt/google/chrome.exe"

before(async () => {
  const cfg = await import("../src/config")
  getConfig = cfg.getConfig
  replaceAppsEntries = cfg.replaceAppsEntries
  initDataDir = cfg.initDataDir
  await initDataDir()
})

function reset() {
  replaceAppsEntries({})
}

function deps(overrides: Partial<AppsHandlerDeps> = {}): AppsHandlerDeps {
  return {
    realpath: (p) => p,
    exists: () => true,
    signerProbe: async () => "CN=Test Signer, O=Test Corp",
    platform: "win32",
    ...overrides,
  }
}

function seedEntry(token: string, overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    token,
    kind: "gui",
    display_name: token,
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: SYS_EXE, signer: "CN=Test Signer", user_writable_dir: false },
    ...overrides,
  }
}

function fakeGate(behavior: "approve" | "deny" | "cancel", captured?: { calls: number; action?: string }) {
  return async (req: { action: string }) => {
    if (captured) {
      captured.calls += 1
      captured.action = req.action
    }
    if (behavior === "approve") return { approved: true as const, method: "windows-hello" as const, nonce: "n1" }
    if (behavior === "cancel") return { approved: false as const, reason: "cancelled" as const }
    return { approved: false as const, reason: "denied" as const }
  }
}

const approveChannel = async () => ({ confirmationId: "c", approved: true, reason: "approved" as const })

// --- apps.list -----------------------------------------------------------------

test("apps.list: empty config → enabled flag + empty entries + preset status", async () => {
  reset()
  const r: any = await handleAppsMessage({ type: "apps.list" }, {}, deps({ exists: () => false }))
  assert.equal(r.type, "apps.list")
  assert.equal(r.enabled, true)
  assert.deepEqual(r.entries, [])
  assert.ok(Array.isArray(r.presets))
  const cm = r.presets.find((p: any) => p.token === "win.app.cloudmusic")
  assert.ok(cm, "cloudmusic preset status must be present")
  assert.equal(cm.detected, false)
  assert.equal(cm.persisted, false)
})

test("apps.list: lazily materializes detected preset (manual, preset source, persisted)", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.list" },
    {},
    deps({ exists: (p) => p.toLowerCase().includes("program files"), signerProbe: async () => "CN=NetEase" }),
  )
  const cm = r.presets.find((p: any) => p.token === "win.app.cloudmusic")
  assert.equal(cm.detected, true)
  assert.equal(cm.persisted, true)
  const persisted = getConfig().apps?.entries?.["win.app.cloudmusic"]
  assert.ok(persisted, "preset entry must persist on detection")
  assert.equal(persisted!.source, "preset")
  assert.equal(persisted!.policy, "manual")
  assert.equal(persisted!.exe?.signer, "CN=NetEase")
  assert.equal(maxPolicyForEntry(persisted!), "auto") // signed + not user-writable
  // Second list must not re-materialize or clobber user state.
  replaceAppsEntries({ ...getConfig().apps!.entries, "win.app.cloudmusic": { ...persisted!, policy: "ai", enabled: false } })
  const r2: any = await handleAppsMessage({ type: "apps.list" }, {}, deps({ exists: (p) => p.toLowerCase().includes("program files") }))
  const e2 = r2.entries.find((e: any) => e.token === "win.app.cloudmusic")
  assert.equal(e2.policy, "ai", "user-owned preset policy must survive later lists")
  assert.equal(e2.enabled, false)
  assert.equal(e2.max_policy, "auto")
})

test("apps.list: entries carry max_policy for the panel badge", async () => {
  reset()
  replaceAppsEntries({
    "win.app.capped": seedEntry("win.app.capped", { exe: { path: SYS_EXE, user_writable_dir: true } }),
  })
  const r: any = await handleAppsMessage({ type: "apps.list" }, {}, deps({ exists: () => false }))
  const e = r.entries.find((x: any) => x.token === "win.app.capped")
  assert.equal(e.max_policy, "ai")
})

// --- apps.enumerate --------------------------------------------------------------

test("apps.enumerate: non-win32 → typed unsupported error", async () => {
  const r: any = await handleAppsMessage({ type: "apps.enumerate" }, {}, deps({ platform: "linux" }))
  assert.equal(r.type, "error")
  assert.match(r.error, /win32|Windows/)
})

test("apps.enumerate: candidates annotated with lolbin block + vault token", async () => {
  const r: any = await handleAppsMessage({ type: "apps.enumerate" }, {}, deps({
    enumerate: async () => [
      { name: "CMD", source: "running", path: "C:\\Windows\\System32\\cmd.exe" },
      { name: "Chrome", source: "running", path: "C:\\Google\\chrome.exe" },
      { name: "Music", source: "startapps", path: "C:\\Apps\\cloudmusic.exe" },
      { name: "Calc", source: "startapps", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" },
    ],
  }))
  assert.equal(r.type, "apps.enumerate.result")
  const [cmd, chrome, music, calc] = r.candidates
  assert.equal(cmd.blocked, true)
  assert.equal(cmd.block_reason, "lolbin")
  assert.equal(chrome.blocked, false)
  assert.equal(chrome.vault_token, "win.chrome")
  assert.equal(music.blocked, false)
  assert.equal(music.vault_token, undefined)
  assert.equal(calc.blocked, false)
})

// --- apps.add --------------------------------------------------------------------

test("apps.add (manual, enumerate) → persists + broadcasts apps.updated with warnings", async () => {
  reset()
  const broadcasts: any[] = []
  const r: any = await handleAppsMessage(
    { type: "apps.add", kind: "gui", path: SYS_EXE, display_name: "Test App", origin: "enumerate" },
    { broadcast: (d) => broadcasts.push(d) },
    deps(),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(r.added, "win.app.app")
  assert.equal(r.warnings.length, 0)
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].type, "apps.updated")
  const persisted = getConfig().apps?.entries?.["win.app.app"]
  assert.ok(persisted)
  assert.equal(persisted!.policy, "manual")
  assert.equal(persisted!.exe?.path, SYS_EXE)
})

test("apps.add: prototype-pollution payload rejected", async () => {
  reset()
  const r: any = await handleAppsMessage(
    JSON.parse(`{"type":"apps.add","path":"${SYS_EXE.replace(/\\/g, "\\\\")}","__proto__":{"x":1}}`),
    {},
    deps(),
  )
  assert.equal(r.type, "error")
  assert.equal(r.error, "Invalid config keys detected")
  assert.equal(Object.keys(getConfig().apps?.entries ?? {}).length, 0)
})

test("apps.add policy auto without confirmation channel → NO_CONFIRMATION_CHANNEL", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: SYS_EXE, policy: "auto" },
    {}, // no requestConfirmation
    deps(),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "NO_CONFIRMATION_CHANNEL")
  assert.equal(Object.keys(getConfig().apps?.entries ?? {}).length, 0)
})

test("apps.add policy auto + gate approved → persisted auto + audit path", async () => {
  reset()
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: SYS_EXE, policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(captured.calls, 1)
  assert.equal(captured.action, "apps.add")
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.policy, "auto")
})

test("apps.add policy auto + gate denied → BIOMETRIC_DENIED, nothing persisted", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: SYS_EXE, policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("deny") }),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(Object.keys(getConfig().apps?.entries ?? {}).length, 0)
})

test("apps.add policy auto + gate cancelled → hard deny (cancel reason surfaced)", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: SYS_EXE, policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("cancel") }),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(r.reason, "cancelled")
  assert.match(r.error, /cancelled by user/)
})

test("apps.add auto on unsigned exe → POLICY_CAP_EXCEEDED, gate never invoked", async () => {
  reset()
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: SYS_EXE, policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ signerProbe: async () => undefined, gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "POLICY_CAP_EXCEEDED")
  assert.equal(r.cap, "ai")
  assert.equal(captured.calls, 0, "cap check must run BEFORE the biometric gate")
})

test("apps.add auto on AUMID → POLICY_CAP_EXCEEDED (AUMID always caps ai)", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.add", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", policy: "auto" },
    { requestConfirmation: approveChannel },
    deps(),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "POLICY_CAP_EXCEEDED")
  assert.equal(r.cap, "ai")
})

test("apps.add lolbin → lolbin_denied error code", async () => {
  reset()
  const r: any = await handleAppsMessage(
    { type: "apps.add", path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
    {},
    deps(),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "lolbin_denied")
})

test("apps.add kind cli → CLI_PHASE2 typed error (P1 gui only)", async () => {
  reset()
  const r: any = await handleAppsMessage({ type: "apps.add", kind: "cli", path: SYS_EXE }, {}, deps())
  assert.equal(r.type, "error")
  assert.equal(r.code, "CLI_PHASE2")
})

test("apps.add duplicate path → duplicate_app", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app") })
  const r: any = await handleAppsMessage({ type: "apps.add", path: SYS_EXE }, {}, deps())
  assert.equal(r.type, "error")
  assert.equal(r.code, "duplicate_app")
})

// --- apps.set_policy --------------------------------------------------------------

test("apps.set_policy downgrade auto→manual is free (gate not invoked)", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app", { policy: "auto" }) })
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.app", policy: "manual" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(r.changed, true)
  assert.equal(captured.calls, 0)
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.policy, "manual")
})

test("apps.set_policy manual→ai is free (below auto, no gate)", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app", { policy: "manual" }) })
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.app", policy: "ai" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.changed, true)
  assert.equal(captured.calls, 0)
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.policy, "ai")
})

test("apps.set_policy upgrade →auto requires the biometric gate (approved path)", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app", { policy: "manual" }) })
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.app", policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(captured.calls, 1)
  assert.equal(captured.action, "apps.set_policy")
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.policy, "auto")
})

test("apps.set_policy upgrade →auto denied → policy unchanged", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app", { policy: "ai" }) })
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.app", policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("deny") }),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "BIOMETRIC_DENIED")
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.policy, "ai")
})

test("apps.set_policy beyond cap → POLICY_CAP_EXCEEDED (write-time re-check), gate not invoked", async () => {
  reset()
  replaceAppsEntries({
    "win.app.capped": seedEntry("win.app.capped", {
      policy: "ai",
      exe: { path: SYS_EXE, user_writable_dir: true }, // unsigned + user-writable → cap ai
    }),
  })
  const captured = { calls: 0, action: "" }
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.capped", policy: "auto" },
    { requestConfirmation: approveChannel },
    deps({ gate: fakeGate("approve", captured) }),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "POLICY_CAP_EXCEEDED")
  assert.equal(r.cap, "ai")
  assert.equal(captured.calls, 0)
})

test("apps.set_policy same value → changed:false no-op", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app", { policy: "manual" }) })
  const r: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.app", policy: "manual" },
    {},
    deps(),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(r.changed, false)
})

test("apps.set_policy unknown token → NOT_FOUND; invalid token → INVALID_TOKEN", async () => {
  reset()
  const nf: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "win.app.nope", policy: "ai" }, {}, deps(),
  )
  assert.equal(nf.code, "NOT_FOUND")
  const bad: any = await handleAppsMessage(
    { type: "apps.set_policy", token: "evil.token", policy: "ai" }, {}, deps(),
  )
  assert.equal(bad.code, "INVALID_TOKEN")
})

// --- apps.set_enabled ---------------------------------------------------------------

test("apps.set_enabled toggles persisted enabled flag", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app") })
  const off: any = await handleAppsMessage(
    { type: "apps.set_enabled", token: "win.app.app", enabled: false }, {}, deps(),
  )
  assert.equal(off.type, "apps.updated")
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.enabled, false)
  const on: any = await handleAppsMessage(
    { type: "apps.set_enabled", token: "win.app.app", enabled: true }, {}, deps(),
  )
  assert.equal(getConfig().apps?.entries?.["win.app.app"]?.enabled, true)
  void on
})

test("apps.set_enabled requires boolean enabled", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app") })
  const r: any = await handleAppsMessage(
    { type: "apps.set_enabled", token: "win.app.app", enabled: "yes" }, {}, deps(),
  )
  assert.equal(r.code, "INVALID_ENABLED")
})

// --- apps.remove ----------------------------------------------------------------------

test("apps.remove user entry → removed + broadcast", async () => {
  reset()
  replaceAppsEntries({ "win.app.app": seedEntry("win.app.app") })
  const broadcasts: any[] = []
  const r: any = await handleAppsMessage(
    { type: "apps.remove", token: "win.app.app" },
    { broadcast: (d) => broadcasts.push(d) },
    deps(),
  )
  assert.equal(r.type, "apps.updated")
  assert.equal(r.removed, "win.app.app")
  assert.equal(broadcasts.length, 1)
  assert.equal(getConfig().apps?.entries?.["win.app.app"], undefined)
})

test("apps.remove preset entry → PRESET_NOT_REMOVABLE", async () => {
  reset()
  replaceAppsEntries({ "win.app.cloudmusic": seedEntry("win.app.cloudmusic", { source: "preset" }) })
  const r: any = await handleAppsMessage(
    { type: "apps.remove", token: "win.app.cloudmusic" }, {}, deps(),
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "PRESET_NOT_REMOVABLE")
  assert.ok(getConfig().apps?.entries?.["win.app.cloudmusic"], "preset must survive")
})

test("apps.remove unknown token → NOT_FOUND", async () => {
  reset()
  const r: any = await handleAppsMessage({ type: "apps.remove", token: "win.app.nope" }, {}, deps())
  assert.equal(r.code, "NOT_FOUND")
})

// --- router delegation (wiring smoke) -------------------------------------------------

test("message-router delegates apps.list and apps.add (AUMID round-trip, no fs deps)", async () => {
  reset()
  const mr = await import("../src/message-router")
  const services: any = {}
  // apps.list through the router — real deps; on this Windows host the
  // cloudmusic preset may genuinely materialize (harmless, tmp DATA_DIR).
  const list: any = await mr.handleMessage({ type: "apps.list" }, services, undefined)
  assert.equal(list.type, "apps.list")
  assert.ok(Array.isArray(list.entries))
  assert.ok(Array.isArray(list.presets))
  // apps.add through the router — the AUMID branch touches no fs/PS, so this
  // round-trip is deterministic on any host and proves router→handler→config
  // wiring end to end (auto-policy gating is covered at the handler level —
  // the gate is not injectable through the router by design).
  const add: any = await mr.handleMessage(
    { type: "apps.add", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", display_name: "Calculator", origin: "enumerate" },
    services,
    { sendToExtension: () => {}, executeTool: async () => ({ success: true }) },
  )
  assert.equal(add.type, "apps.updated", `expected add to succeed, got: ${add.error || JSON.stringify(add)}`)
  assert.equal(add.added, "win.app.calculator")
  assert.ok(getConfig().apps?.entries?.["win.app.calculator"])
})
