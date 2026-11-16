/** Task 2: pack restore, apply gate, and Linux ACP shell copy follow one provision authority. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-provision-2-")))
process.env.CMSPARK_DATA_DIR = root
delete process.env.DEEPSEEK_API_KEY

type Loaded = {
  config: typeof import("../src/config")
  packs: typeof import("../src/packs/pack-engine")
  context: typeof import("../src/acp/capability-context")
  ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
  SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
}
let loaded: Loaded | undefined
async function api(): Promise<Loaded> {
  if (!loaded) {
    const config = await import("../src/config")
    await config.initDataDir()
    const packs = await import("../src/packs/pack-engine")
    const context = await import("../src/acp/capability-context")
    const ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
    const SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
    loaded = { config, packs, context, ThreadManager, SkillEngine }
  }
  return loaded
}

const tools = new Set(["acp_list_agents", "acp_propose_session", "acp_start_session", "shell_exec"])

function shellOf() {
  return (loaded!.config.getConfig() as any).modules.shell
}

function writePack(id: string, yaml: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`))
  fs.writeFileSync(path.join(dir, "pack.yaml"), yaml)
  return dir
}

test("enable_modules shell without requires_modules fails when shell is unavailable and rolls back", async () => {
  const { config, packs, ThreadManager, SkillEngine } = await api()
  config.saveConfig({
    capability_profile: "community",
    security: { auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false },
    modules: {
      shell: { available: false, enabled: false, policy: "allowlist", allowlist_commands: ["echo"] },
      netsec: { available: true, enabled: false, target_allowlist: ["127.0.0.1"], require_task_auth: true },
    },
  } as any)
  const engine = new SkillEngine()
  const saved = packs.saveUserPack({
    name: "shell-enable-only",
    system_prompt_append: "requests shell without listing it as required",
    skill_ids: [],
    tools: { mode: "allowlist", allow: ["list_tabs"], deny: [] },
    trust: { enable_modules: ["shell"] },
  }, engine)
  assert.equal(saved.ok, true, (saved as any).error)
  if (!saved.ok) return
  const installed = packs.listInstalledPacks().find((item) => item.id === saved.id)
  const yamlPath = path.join(installed!.installed_path, "pack.yaml")
  const yaml = fs.readFileSync(yamlPath, "utf8").replace(/requires_modules:[\s\S]*?\n(?=\S)/, "requires_modules: []\n")
  fs.writeFileSync(yamlPath, yaml)
  assert.equal(fs.readFileSync(yamlPath, "utf8").includes("shell"), true)
  assert.match(fs.readFileSync(yamlPath, "utf8"), /requires_modules: \[\]/)
  const tm = new ThreadManager()
  const thread = tm.create("shell-unavailable-apply")
  const applied = packs.applyPack(saved.id, thread.id, tm, engine, { allowTrust: true })
  const gaps: string[] = []
  if (applied.ok) gaps.push("apply succeeded")
  if (applied.ok || !/module not available: shell/.test(applied.error || "")) gaps.push(`error=${applied.ok ? "" : applied.error}`)
  const cfg = config.getConfig() as any
  if (cfg.capability_profile !== "community") gaps.push(`profile=${cfg.capability_profile}`)
  if (cfg.modules?.shell?.enabled !== false) gaps.push("shell enabled")
  if (cfg.modules?.shell?.allowlist_commands?.[0] !== "echo") gaps.push("allowlist changed")
  if (cfg.security?.auto_approve_dangerous === true) gaps.push("cruise flag written")
  if (tm.get(thread.id)?.mission_pack_id) gaps.push("thread kept the failed pack")
  assert.deepEqual(gaps, [])
})

test("shell requested by a tool or module uses provision, and an unrelated pack stays open", async () => {
  const { config, packs, ThreadManager, SkillEngine } = await api()
  const engine = new SkillEngine()
  const tm = new ThreadManager()
  const implied = writePack("shell-implied", `
schema_version: 1
id: shell-implied
name: Shell tool
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [shell_exec, list_tabs]
  deny: []
system_prompt_append: "shell tool without a requires entry"
`)
  assert.equal(packs.installPackFromDirectory(implied, engine, { force: true }).ok, true)
  config.saveConfig({
    capability_profile: "community",
    modules: { shell: { available: true, enabled: false, policy: "allowlist", allowlist_commands: ["echo"] } },
  } as any)
  const { checkShellScope } = await import("../src/capability/shell")
  const impliedApply = packs.applyPack("shell-implied", tm.create("implied").id, tm, engine)
  const gaps: string[] = []
  // Offering shell_exec is not a request to provision shell. coding-handoff relies on that.
  if (!impliedApply.ok) gaps.push(`implied blocked=${(impliedApply as any).error}`)
  if (checkShellScope("echo").ok) gaps.push("community shell_exec became executable")

  const required = writePack("shell-required", `
schema_version: 1
id: shell-required
name: Shell required
version: 0.1.0
channel: community
min_capability: L1
requires_modules: [shell]
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [list_tabs]
  deny: []
system_prompt_append: "requires shell"
`)
  assert.equal(packs.installPackFromDirectory(required, engine, { force: true }).ok, true)
  const communityApply = packs.applyPack("shell-required", tm.create("community-shell").id, tm, engine)
  if (communityApply.ok || (communityApply as any).error !== "enterprise_profile_required") gaps.push(`community=${JSON.stringify(communityApply)}`)

  const configPath = path.join(root, "config.json")
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8"))
  disk.capability_profile = "enterprise"
  disk.modules.shell = { available: true, enabled: false, enabled_at: null, enabled_by: null, policy: "allowlist", allowlist_commands: ["echo"] }
  fs.writeFileSync(configPath, JSON.stringify(disk))
  config.clearConfigCache()
  const legacy = packs.applyPack("shell-required", tm.create("legacy-false").id, tm, engine)
  if (!legacy.ok) gaps.push(`legacy=${(legacy as any).error}`)
  const repaired = shellOf()
  if (repaired.enabled !== true || repaired.enabled_by !== "profile.enterprise") gaps.push(`repaired=${JSON.stringify(repaired)}`)
  if (repaired.allowlist_commands?.[0] !== "echo" || repaired.policy !== "allowlist") gaps.push("legacy repair changed policy")

  disk.capability_profile = "enterprise"
  disk.modules.shell = { available: true, enabled: true, enabled_at: "2020-01-01T00:00:00.000Z", enabled_by: "user", policy: "allowlist", allowlist_commands: ["echo"] }
  const realWrite = fs.writeFileSync
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (String(file).includes(`${path.sep}config.json`)) {
      const error = new Error("EACCES: config.json") as NodeJS.ErrnoException
      error.code = "EACCES"
      throw error
    }
    return realWrite(file, data, options)
  }) as typeof fs.writeFileSync
  try {
    realWrite(configPath, JSON.stringify(disk))
    config.clearConfigCache()
    const unknown = packs.applyPack("shell-required", tm.create("unknown-shell").id, tm, engine)
    if (unknown.ok || (unknown as any).error !== "SHELL_PROVISION_RESULT_UNKNOWN") gaps.push(`unknown=${JSON.stringify(unknown)}`)
    const plain = writePack("plain-appsec", `
schema_version: 1
id: plain-appsec
name: Plain
version: 0.1.0
channel: community
min_capability: L1
requires_modules: [appsec]
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [list_tabs]
  deny: []
system_prompt_append: "no shell"
`)
    const installed = packs.installPackFromDirectory(plain, engine, { force: true })
    if (!installed.ok) gaps.push(`plain install=${(installed as any).error}`)
    config.saveConfig = config.saveConfig
    const current = config.getConfig() as any
    current.modules.appsec = { available: true, enabled: true, enabled_at: "2020-01-01T00:00:00.000Z", enabled_by: "test" }
    const plainApply = packs.applyPack("plain-appsec", tm.create("plain").id, tm, engine)
    if (!plainApply.ok) gaps.push(`unrelated blocked=${(plainApply as any).error}`)
  } finally {
    fs.writeFileSync = realWrite
  }
  assert.deepEqual(gaps, [])
})

test("restore follows the profile projection and reports a failed netsec restore", async () => {
  const { config, packs } = await api()
  config.saveConfig({
    capability_profile: "enterprise",
    security: { auto_approve_dangerous: true, auto_approve_enterprise_tools: false, allow_all_schemes: false },
    modules: {
      shell: { available: true, enabled: true, enabled_by: "profile.enterprise", policy: "allowlist", allowlist_commands: ["echo"] },
      netsec: { available: true, enabled: false, target_allowlist: ["127.0.0.1"], require_task_auth: true },
      appsec: { available: true, enabled: true, enabled_by: "test" },
    },
  } as any)
  const failed = packs.restoreTrustSnapshot({
    capability_profile: "community",
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
    modules: { shell: { enabled: true }, netsec: { enabled: true }, appsec: { enabled: true } },
  }, "pack.unapply:task2") as unknown as { ok?: boolean; error?: string }
  const auditPath = path.join(root, "logs", "capability-audit.jsonl")
  const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : ""
  const gaps: string[] = []
  if (failed?.ok !== false) gaps.push(`community result=${JSON.stringify(failed)}`)
  if (!/enterprise_profile_required/.test(failed?.error || "")) gaps.push(`community error=${failed?.error}`)
  const community = config.getConfig() as any
  if (community.capability_profile !== "community") gaps.push("profile stayed enterprise")
  if (community.modules.shell.enabled !== false) gaps.push("snapshot shell true was restored on community")
  if (community.modules.shell.policy !== "allowlist" || community.modules.shell.allowlist_commands?.[0] !== "echo") gaps.push("community restore changed shell policy")
  if (community.modules.netsec.enabled !== false) gaps.push("netsec turned on under community")
  if (community.modules.netsec.target_allowlist?.[0] !== "127.0.0.1") gaps.push("netsec allowlist changed")
  if (community.security.auto_approve_dangerous !== false) gaps.push("cruise flag not restored")
  if (!audit.includes("enterprise_profile_required") || !audit.includes("netsec")) gaps.push("netsec failure was not audited")

  const kept = packs.restoreTrustSnapshot({
    capability_profile: "enterprise",
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
    modules: { shell: { enabled: false }, netsec: { enabled: true }, appsec: { enabled: false } },
  }, "pack.unapply:task2-enterprise") as unknown as { ok?: boolean; error?: string }
  const enterprise = config.getConfig() as any
  if (kept?.ok !== true) gaps.push(`enterprise result=${JSON.stringify(kept)}`)
  if (enterprise.capability_profile !== "enterprise" || enterprise.modules.shell.enabled !== true) gaps.push("enterprise snapshot shell false turned the power off")
  if (enterprise.modules.shell.enabled_by !== "profile.enterprise") gaps.push(`enabled_by=${enterprise.modules.shell.enabled_by}`)
  if (enterprise.modules.shell.policy !== "allowlist" || enterprise.modules.shell.allowlist_commands?.[0] !== "echo") gaps.push("enterprise restore changed shell policy")
  if (enterprise.modules.netsec.enabled !== true || enterprise.modules.netsec.target_allowlist?.[0] !== "127.0.0.1") gaps.push("netsec was not restored")
  if (enterprise.modules.appsec.enabled !== false) gaps.push("appsec restore changed")
  assert.deepEqual(gaps, [])
})

test("downgrade and upgrade keep shell policy and leave netsec off", async () => {
  const { config, packs } = await api()
  config.saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: { available: true, enabled: true, enabled_by: "profile.enterprise", policy: "allowlist", allowlist_commands: ["echo"] },
      netsec: { available: true, enabled: true, target_allowlist: ["10.0.0.8"], require_task_auth: true },
    },
  } as any)
  const down = packs.setCapabilityProfile("community", "settings.profile")
  const mid = config.getConfig() as any
  const up = packs.setCapabilityProfile("enterprise", "settings.profile")
  const after = config.getConfig() as any
  const gaps: string[] = []
  if (!down.ok || mid.modules.shell.enabled !== false || mid.modules.netsec.enabled !== false) gaps.push(`down=${JSON.stringify(down)} shell=${mid.modules.shell.enabled} netsec=${mid.modules.netsec.enabled}`)
  if (mid.modules.shell.allowlist_commands?.[0] !== "echo" || mid.modules.netsec.target_allowlist?.[0] !== "10.0.0.8") gaps.push("downgrade changed policy")
  if (!up.ok || after.modules.shell.enabled !== true || after.modules.shell.enabled_by !== "profile.enterprise") gaps.push(`up=${JSON.stringify(up)}`)
  if (after.modules.netsec.enabled !== false) gaps.push("upgrade re-enabled netsec")
  if (after.modules.shell.allowlist_commands?.[0] !== "echo" || after.modules.shell.policy !== "allowlist") gaps.push("upgrade changed shell policy")
  assert.deepEqual(gaps, [])
})

test("Linux ACP copy follows provided, community, unavailable, and unknown", async () => {
  const { config, context } = await api()
  const gaps: string[] = []
  const expectState = (label: string, text: string, includes: RegExp[], excludes: RegExp[]) => {
    for (const pattern of includes) if (!pattern.test(text)) gaps.push(`${label} missing ${pattern}`)
    for (const pattern of excludes) if (pattern.test(text)) gaps.push(`${label} has ${pattern}`)
    if (!/acp_list_agents.*acp_propose_session.*acp_start_session/.test(text)) gaps.push(`${label} changed ACP start order`)
    if (/PTY/.test(text.match(/zenity[\s\S]*/)?.[0] || "")) gaps.push(`${label} mentions PTY in the shell sentence`)
  }
  config.saveConfig({ capability_profile: "community", acp: { enabled: true }, modules: { shell: { available: true, enabled: true, policy: "confirm_per_command", allowlist_commands: [] } } } as any)
  expectState("community", context.buildCodingHandoffContext(config.getConfig(), "linux", tools), [/enterprise 档/], [/启用 shell/, /可通过 shell_exec/])
  const configPath = path.join(root, "config.json")
  const disk = JSON.parse(fs.readFileSync(configPath, "utf8"))
  disk.capability_profile = "enterprise"
  disk.acp = { enabled: true }
  disk.modules.shell = { available: true, enabled: false, enabled_at: null, enabled_by: null, policy: "allowlist", allowlist_commands: ["echo"] }
  fs.writeFileSync(configPath, JSON.stringify(disk))
  config.clearConfigCache()
  expectState("provided", context.buildCodingHandoffContext(config.getConfig(), "linux", tools), [/可通过 shell_exec/, /包管理器/], [/启用 shell/])
  config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: false, enabled: false, policy: "allowlist", allowlist_commands: ["echo"] } } } as any)
  expectState("unavailable", context.buildCodingHandoffContext(config.getConfig(), "linux", tools), [/模块不可用/], [/启用 shell/, /可通过 shell_exec/])
  disk.modules.shell = { available: true, enabled: true, enabled_at: "2020-01-01T00:00:00.000Z", enabled_by: "user", policy: "allowlist", allowlist_commands: ["echo"] }
  const realWrite = fs.writeFileSync
  fs.writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (String(file).includes(`${path.sep}config.json`)) {
      const error = new Error("EACCES: config.json") as NodeJS.ErrnoException
      error.code = "EACCES"
      throw error
    }
    return realWrite(file, data, options)
  }) as typeof fs.writeFileSync
  try {
    realWrite(configPath, JSON.stringify(disk))
    config.clearConfigCache()
    expectState("unknown", context.buildCodingHandoffContext(config.getConfig(), "linux", tools), [/提供状态未知/], [/启用 shell/, /可通过 shell_exec/])
  } finally {
    fs.writeFileSync = realWrite
  }
  assert.deepEqual(gaps, [])
})
