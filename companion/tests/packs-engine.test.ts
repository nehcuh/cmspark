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
