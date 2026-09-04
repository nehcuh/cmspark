/**
 * #284: settings-driven capability_profile switch (community ⇄ enterprise).
 *
 *  - setCapabilityProfile writes ONLY capability_profile (pack-trust three
 *    flags untouched — 禁令) and audits type:"profile.change" into the same
 *    capability-audit.jsonl as module.enable.
 *  - Downgrade to community is fail-closed: enabled shell/netsec powers are
 *    forcibly disabled (module.disable audits) — no "enabled but gated" zombie.
 *  - Upgrade never auto-enables modules; no-op switch writes nothing.
 *  - Wire case modules.set_profile routes through the same path and returns
 *    modules.updated (with capability_profile) so existing listeners refresh.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-profile-switch-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let setCapabilityProfile: typeof import("../src/packs/pack-engine").setCapabilityProfile
let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfig: typeof import("../src/config").getConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let getAuditLogPath: typeof import("../src/packs/audit-log").getAuditLogPath

function readAuditLines(): any[] {
  const p = getAuditLogPath()
  if (!fs.existsSync(p)) return []
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

before(async () => {
  const pe = await import("../src/packs/pack-engine")
  const mr = await import("../src/message-router")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  const al = await import("../src/packs/audit-log")
  setCapabilityProfile = pe.setCapabilityProfile
  handleMessage = mr.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfig = cfg.getConfig
  getConfigDir = cfg.getConfigDir
  getAuditLogPath = al.getAuditLogPath
  await cfg.initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  const audit = getAuditLogPath()
  if (fs.existsSync(audit)) fs.rmSync(audit, { force: true })
  saveConfig({
    capability_profile: "community",
    modules: {
      appsec: { available: true, enabled: false },
      "devsec-workspace": { available: true, enabled: false },
      shell: { available: true, enabled: false },
      netsec: { available: true, enabled: false },
    },
    security: {
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
  } as any)
})

test("#284 upgrade to enterprise: writes profile only + audits profile.change (module.enable format)", () => {
  const r = setCapabilityProfile("enterprise", "settings.profile")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.profile, "enterprise")
  assert.deepEqual(r.modules_disabled, [])
  assert.equal(getConfig().capability_profile, "enterprise")

  const lines = readAuditLines()
  const change = lines.find((l) => l.type === "profile.change")
  assert.ok(change, "profile.change must land in capability-audit.jsonl")
  assert.equal(change.from, "community")
  assert.equal(change.to, "enterprise")
  assert.equal(change.by, "settings.profile")
  assert.equal(typeof change.at, "string", "same at-stamp shape as module.enable")
  assert.deepEqual(change.modules_disabled, [])
  // no module flip may be smuggled by an upgrade
  assert.equal(lines.some((l) => l.type === "module.enable" || l.type === "module.disable"), false)
  // modules stay off — enterprise only unlocks ENABILITY
  const modsUp = getConfig().modules as any
  assert.equal(modsUp.shell.enabled, false)
  assert.equal(modsUp.netsec.enabled, false)
})

test("#284 downgrade to community forcibly disables enabled shell/netsec (fail-closed)", () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      appsec: { available: true, enabled: true },
      "devsec-workspace": { available: true, enabled: false },
      shell: { available: true, enabled: true },
      netsec: { available: true, enabled: true },
    },
  } as any)

  const r = setCapabilityProfile("community", "settings.profile")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.modules_disabled, ["shell", "netsec"])

  const mods = getConfig().modules as any
  assert.equal(mods.shell.enabled, false, "shell power must be OFF after downgrade")
  assert.equal(mods.netsec.enabled, false, "netsec power must be OFF after downgrade")
  assert.equal(mods.appsec.enabled, true, "community-allowed modules keep their power")

  const lines = readAuditLines()
  const change = lines.find((l) => l.type === "profile.change")
  assert.ok(change)
  assert.deepEqual(change.modules_disabled, ["shell", "netsec"])
  // fail-closed flip is itself audited via the module.disable path
  const disables = lines.filter((l) => l.type === "module.disable")
  assert.deepEqual(
    disables.map((l) => l.module).sort(),
    ["netsec", "shell"],
    "forced power-off must write module.disable audits",
  )
})

test("#284 switch never touches the pack-trust three flags (禁令)", () => {
  saveConfig({
    capability_profile: "enterprise",
    security: {
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    },
    modules: { shell: { available: true, enabled: true }, netsec: { available: true, enabled: true } },
  } as any)

  const r = setCapabilityProfile("community", "settings.profile")
  assert.equal(r.ok, true)
  const sec = getConfig().security as any
  assert.equal(sec.auto_approve_dangerous, true, "三旗巡航不归切档管")
  assert.equal(sec.auto_approve_enterprise_tools, true)
  assert.equal(sec.allow_all_schemes, true)

  const back = setCapabilityProfile("enterprise", "settings.profile")
  assert.equal(back.ok, true)
  const sec2 = getConfig().security as any
  assert.equal(sec2.auto_approve_dangerous, true)
  assert.equal(sec2.auto_approve_enterprise_tools, true)
  assert.equal(sec2.allow_all_schemes, true)
})

test("#284 no-op and invalid switches write nothing", () => {
  const noop = setCapabilityProfile("community", "settings.profile")
  assert.equal(noop.ok, true)
  if (noop.ok) assert.deepEqual(noop.modules_disabled, [])
  assert.equal(getConfig().capability_profile, "community")
  assert.equal(readAuditLines().length, 0, "no-op must not audit")

  const bad = setCapabilityProfile("galactic" as any, "settings.profile")
  assert.equal(bad.ok, false)
  assert.equal(getConfig().capability_profile, "community")
  assert.equal(readAuditLines().length, 0, "invalid target must not write")
})

test("#284 wire: modules.set_profile routes through the same path, replies modules.updated", async () => {
  const tm = new ThreadManager()
  const services = {
    threadManager: tm,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
  }
  const session = { sendToExtension: () => {}, executeTool: async () => ({ success: true, data: {} }) } as any

  const up = await handleMessage({ type: "modules.set_profile", profile: "enterprise" }, services as any, session)
  assert.equal(up.type, "modules.updated")
  assert.equal((up as any).capability_profile, "enterprise")
  assert.equal(getConfig().capability_profile, "enterprise")
  assert.ok(readAuditLines().some((l) => l.type === "profile.change" && l.to === "enterprise"))

  // now with shell on, downgrade over the wire forcibly powers it off
  saveConfig({ modules: { shell: { available: true, enabled: true } } } as any)
  const down = await handleMessage({ type: "modules.set_profile", profile: "community" }, services as any, session)
  assert.equal(down.type, "modules.updated")
  assert.equal((down as any).capability_profile, "community")
  assert.deepEqual((down as any).modules_disabled, ["shell"])
  assert.equal((getConfig().modules as any).shell.enabled, false)

  const invalid = await handleMessage({ type: "modules.set_profile", profile: "galactic" }, services as any, session)
  assert.equal(invalid.type, "error")
  assert.match((invalid as any).error, /community\|enterprise/)
})
