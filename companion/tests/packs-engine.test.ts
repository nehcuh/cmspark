import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-packs-eng-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let clearConfigCache: typeof import("../src/config").clearConfigCache
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let packEngine: typeof import("../src/packs/pack-engine")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfigDir = configMod.getConfigDir
  getConfig = configMod.getConfig
  saveConfig = configMod.saveConfig
  clearConfigCache = configMod.clearConfigCache
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  packEngine = await import("../src/packs/pack-engine")
  await initDataDir()
  clearConfigCache()
  // enable appsec for apply tests
  const cfg = getConfig()
  saveConfig({
    modules: {
      appsec: { available: true, enabled: true, enabled_at: new Date().toISOString(), enabled_by: "test" },
    },
  } as any)
  clearConfigCache()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function writeMiniPack(dir: string, id = "mini-pack") {
  fs.mkdirSync(path.join(dir, "skills"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "pack.yaml"),
    `
schema_version: 1
id: ${id}
name: Mini
version: 0.1.0
channel: community
min_capability: L1
requires_modules: [appsec]
skills:
  - ./skills/s.md
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [list_tabs, get_page_html]
  deny: [host_computer]
system_prompt_append: "Be a mini auditor."
thread_defaults:
  skill_selection_mode: manual
`,
  )
  fs.writeFileSync(
    path.join(dir, "skills", "s.md"),
    `---\nname: mini-skill\ndescription: d\ntype: prompt_template\n---\n\n# Mini\n`,
  )
}

test("install dir + list + apply allowlist + uninstall restores snapshot", () => {
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const thread = tm.create("pack-test")

  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-src-"))
  writeMiniPack(src)

  const inst = packEngine.installPackFromDirectory(src, skillEngine, { force: true })
  assert.equal(inst.ok, true)

  const list = packEngine.listInstalledPacks()
  assert.ok(list.some((p) => p.id === "mini-pack"))

  const beforeWl = thread.tool_whitelist
  assert.equal(beforeWl, null)

  const applied = packEngine.applyPack("mini-pack", thread.id, tm, skillEngine)
  assert.equal(applied.ok, true)
  if (!applied.ok) return
  const t2 = tm.get(thread.id)!
  assert.equal(t2.mission_pack_id, "mini-pack")
  assert.deepEqual(t2.tool_whitelist, ["list_tabs", "get_page_html"])
  assert.ok(t2.config_override?.system_prompt_append?.includes("Mission Pack"))
  assert.ok(t2.active_skill_ids.some((s) => s.startsWith("pack--mini-pack--")))

  const un = packEngine.uninstallPack("mini-pack", tm, skillEngine)
  assert.equal(un.ok, true)
  const t3 = tm.get(thread.id)!
  assert.equal(t3.mission_pack_id, null)
  assert.equal(t3.tool_whitelist, null)
})

test("saveUserPack + apply uses skill_refs and mcp_servers (tools unchanged)", () => {
  const skillEngine = new SkillEngine()
  // Seed a global skill the user scene can ref
  const skillsRoot = path.join(getConfigDir(), "skills")
  fs.mkdirSync(skillsRoot, { recursive: true })
  fs.writeFileSync(
    path.join(skillsRoot, "demo-research.md"),
    `---\nname: demo-research\ndescription: research helper\ntype: prompt_template\n---\n\n# Research\n`,
  )
  skillEngine.refresh()

  const cfg = getConfig()
  saveConfig({
    mcp: {
      enabled: true,
      servers: {
        "fake-fs": { command: "echo", args: [], enabled: true },
      },
    },
  } as any)
  clearConfigCache()

  const saved = packEngine.saveUserPack(
    {
      name: "投研助手",
      description: "用户自定义场景",
      system_prompt_append: "你是投研助手，优先用已勾选技能。",
      skill_ids: ["demo-research", "missing-skill"],
      mcp_server_ids: ["fake-fs", "not-configured"],
    },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  assert.ok(saved.id.startsWith("user-"))

  const detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.equal(detail.pack.origin, "user")
  assert.equal(detail.pack.editable, true)
  assert.deepEqual(detail.pack.skill_refs, ["demo-research", "missing-skill"])
  assert.ok(detail.pack.system_prompt_append.includes("投研助手"))

  const tm = new ThreadManager()
  const thread = tm.create("user-scene-apply")
  const beforeSkills = [...(thread.active_skill_ids || [])]
  const applied = packEngine.applyPack(saved.id, thread.id, tm, skillEngine)
  assert.equal(applied.ok, true)
  if (!applied.ok) return
  const t2 = tm.get(thread.id)!
  assert.equal(t2.mission_pack_id, saved.id)
  // tools.mode unchanged → whitelist stays null
  assert.equal(t2.tool_whitelist, null)
  assert.deepEqual(t2.active_skill_ids, ["demo-research"]) // missing filtered
  assert.deepEqual(t2.active_mcp_server_ids, ["fake-fs"])
  assert.equal(t2.mcp_selection_mode, "manual")
  assert.equal(t2.skill_selection_mode, "manual")
  assert.ok(t2.config_override?.system_prompt_append?.includes("投研助手"))
  // pre-pack skills should not leak when skill_refs present
  assert.ok(!t2.active_skill_ids.includes("browse") || beforeSkills.includes("demo-research"))

  // cannot overwrite with non-user save targeting builtin-style: update same user pack
  const updated = packEngine.saveUserPack(
    {
      id: saved.id,
      name: "投研助手 v2",
      system_prompt_append: "更新后的 prompt",
      skill_ids: ["demo-research"],
      mcp_server_ids: [],
    },
    skillEngine,
  )
  assert.equal(updated.ok, true)

  const del = packEngine.deleteUserPack(saved.id, tm, skillEngine)
  assert.equal(del.ok, true)
  const t3 = tm.get(thread.id)!
  assert.equal(t3.mission_pack_id, null)

  // restore config modules bit for other tests
  saveConfig({ modules: cfg.modules, mcp: cfg.mcp } as any)
  clearConfigCache()
})

test("deleteUserPack rejects non-user packs", () => {
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-nuser-"))
  writeMiniPack(src, "mini-pack-not-user")
  packEngine.installPackFromDirectory(src, skillEngine, { force: true })
  const del = packEngine.deleteUserPack("mini-pack-not-user", tm, skillEngine)
  assert.equal(del.ok, false)
  if (del.ok) return
  assert.equal(del.code, "not_user_pack")
})

test("getPackDetail includes installed_skill_ids for clone", () => {
  const skillEngine = new SkillEngine()
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-detail-"))
  writeMiniPack(src, "mini-pack-detail")
  packEngine.installPackFromDirectory(src, skillEngine, { force: true })
  skillEngine.refresh()
  const d = packEngine.getPackDetail("mini-pack-detail", skillEngine)
  assert.equal(d.ok, true)
  if (!d.ok) return
  assert.ok((d.pack.installed_skill_ids || []).some((id) => id.startsWith("pack--mini-pack-detail--")))
  assert.equal(d.pack.editable, false)
})

test("unapplyPack restores snapshot without clearing workspace_root", () => {
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const thread = tm.create("unapply-test")
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-unapply-"))
  writeMiniPack(src, "mini-pack-unapply")
  packEngine.installPackFromDirectory(src, skillEngine, { force: true })

  const applied = packEngine.applyPack("mini-pack-unapply", thread.id, tm, skillEngine, {
    workspace_path: "/tmp/ws-keep",
  })
  assert.equal(applied.ok, true)
  assert.equal(tm.get(thread.id)!.mission_pack_id, "mini-pack-unapply")
  assert.deepEqual(tm.get(thread.id)!.tool_whitelist, ["list_tabs", "get_page_html"])
  assert.equal(tm.get(thread.id)!.workspace_root, "/tmp/ws-keep")

  const u = packEngine.unapplyPack(thread.id, tm)
  assert.equal(u.ok, true)
  const t2 = tm.get(thread.id)!
  assert.equal(t2.mission_pack_id, null)
  assert.equal(t2.tool_whitelist, null)
  // workspace is orthogonal to scene — unapply must not clear it
  assert.equal(t2.workspace_root, "/tmp/ws-keep")

  packEngine.uninstallPack("mini-pack-unapply", tm, skillEngine)
})

test("intersect with null whitelist degrades to allowlist", () => {
  assert.deepEqual(
    packEngine.computeWhitelist("intersect", ["list_tabs", "navigate"], ["navigate"], null),
    ["list_tabs"],
  )
  assert.deepEqual(
    packEngine.computeWhitelist("intersect", ["list_tabs", "navigate"], [], ["list_tabs", "screenshot"]),
    ["list_tabs"],
  )
})

test("apply blocked when module disabled", () => {
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const thread = tm.create("mod-off")
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-src2-"))
  writeMiniPack(src, "mini-pack-2")
  packEngine.installPackFromDirectory(src, skillEngine, { force: true })

  saveConfig({
    modules: {
      appsec: { available: true, enabled: false, enabled_at: null, enabled_by: null },
    },
  } as any)
  clearConfigCache()

  const applied = packEngine.applyPack("mini-pack-2", thread.id, tm, skillEngine)
  assert.equal(applied.ok, false)
  if (!applied.ok) assert.equal(applied.code, "module_disabled")

  // restore enabled for other tests
  saveConfig({
    modules: {
      appsec: { available: true, enabled: true, enabled_at: new Date().toISOString(), enabled_by: "test" },
    },
  } as any)
  clearConfigCache()
})

test("extractUserAppendPortion and re-apply freezes snapshot", () => {
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const thread = tm.create("reapply-test")
  // user append before pack
  tm.update(thread.id, {
    config_override: { system_prompt_append: "user rules forever" },
  })
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "mini-pack-src3-"))
  writeMiniPack(src, "mini-pack-3")
  packEngine.installPackFromDirectory(src, skillEngine, { force: true })

  const a1 = packEngine.applyPack("mini-pack-3", thread.id, tm, skillEngine)
  assert.equal(a1.ok, true)
  const t1 = tm.get(thread.id)!
  const snap1 = JSON.stringify(t1.mission_pack_snapshot)
  assert.ok(t1.config_override.system_prompt_append.includes("user rules forever"))
  assert.ok(t1.config_override.system_prompt_append.includes("Mission Pack"))

  const a2 = packEngine.applyPack("mini-pack-3", thread.id, tm, skillEngine)
  assert.equal(a2.ok, true)
  const t2 = tm.get(thread.id)!
  assert.equal(JSON.stringify(t2.mission_pack_snapshot), snap1, "snapshot must freeze on re-apply")
  assert.ok(t2.config_override.system_prompt_append.includes("user rules forever"))

  const un = packEngine.uninstallPack("mini-pack-3", tm, skillEngine)
  assert.equal(un.ok, true)
  const t3 = tm.get(thread.id)!
  assert.equal(t3.mission_pack_id, null)
  assert.equal(t3.tool_whitelist, null)
  // user rules restored from snapshot
  assert.equal(t3.config_override?.system_prompt_append, "user rules forever")
})

test("extractUserAppendPortion helper", () => {
  assert.equal(packEngine.extractUserAppendPortion(null), null)
  assert.equal(packEngine.extractUserAppendPortion("plain user"), "plain user")
  assert.equal(
    packEngine.extractUserAppendPortion("--- Mission Pack ---\nP\n\n--- User ---\nU"),
    "U",
  )
  assert.equal(packEngine.extractUserAppendPortion("--- Mission Pack ---\nonly pack"), null)
})

test("ensureBuiltinPacksInstalled installs appsec-prd-review when present", () => {
  const skillEngine = new SkillEngine()
  // Point at worktree builtin by ensuring getBuiltinPacksRoot finds it
  const installed = packEngine.ensureBuiltinPacksInstalled(skillEngine)
  // may be empty if path resolution fails in test cwd — still must not throw
  assert.ok(Array.isArray(installed))
  const list = packEngine.listInstalledPacks()
  // If builtin path resolved, expect appsec
  const builtinRoot = packEngine.getBuiltinPacksRoot()
  if (fs.existsSync(path.join(builtinRoot, "appsec-prd-review", "pack.yaml"))) {
    assert.ok(list.some((p) => p.id === "appsec-prd-review") || installed.includes("appsec-prd-review"))
  }
})
