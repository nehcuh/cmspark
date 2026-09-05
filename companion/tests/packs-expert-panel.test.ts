// #369: 用户专家 round-trip · 停用语义（spawn/apply 稳定失败码）· 有效工具面公式 · 用量聚合
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-expert-panel-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let initDataDir: typeof import("../src/config").initDataDir
let clearConfigCache: typeof import("../src/config").clearConfigCache
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let packEngine: typeof import("../src/packs/pack-engine")
let expertPanel: typeof import("../src/packs/expert-panel")
let WORKER_HARD_DENY: Set<string>

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  clearConfigCache = configMod.clearConfigCache
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  packEngine = await import("../src/packs/pack-engine")
  expertPanel = await import("../src/packs/expert-panel")
  WORKER_HARD_DENY = (await import("../src/orchestrator/constants")).WORKER_HARD_DENY
  await initDataDir()
  clearConfigCache()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("user expert round-trip: save kind=expert → list/get detail → update preserves kind → delete", () => {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name: "代码评审专家",
      system_prompt_append: "你是代码评审专家，只做只读评审。",
      skill_ids: [],
      kind: "expert",
      tools: { mode: "allowlist", allow: ["list_tabs", "get_page_text", "navigate"], deny: [] },
    },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  const listed = packEngine.listInstalledPacks().find((p) => p.id === saved.id)
  assert.equal(listed?.kind, "expert")
  assert.equal(listed?.origin, "user")
  assert.equal(listed?.editable, true)
  assert.equal(listed?.disabled, undefined)

  const detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.equal(detail.pack.kind, "expert")

  // Update omitting kind → preserved expert (not reset to mission)
  const updated = packEngine.saveUserPack(
    { id: saved.id, name: "代码评审专家v2", system_prompt_append: "v2 prompt", skill_ids: [] },
    skillEngine,
  )
  assert.equal(updated.ok, true)
  const detail2 = packEngine.getPackDetail(saved.id)
  assert.equal(detail2.ok, true)
  if (!detail2.ok) return
  assert.equal(detail2.pack.kind, "expert")

  const tm = new ThreadManager()
  const del = packEngine.deleteUserPack(saved.id, tm, skillEngine)
  assert.equal(del.ok, true)
  assert.ok(!packEngine.listInstalledPacks().some((p) => p.id === saved.id))
})

test("disabled: applyPack refuses with stable code pack_disabled; spawn gate PACK_DISABLED; re-enable recovers", () => {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name: "停用专家",
      system_prompt_append: "你是专家。",
      skill_ids: [],
      kind: "expert",
      disabled: true,
      tools: { mode: "allowlist", allow: ["list_tabs", "get_page_text"], deny: [] },
    },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return

  const listed = packEngine.listInstalledPacks().find((p) => p.id === saved.id)
  assert.equal(listed?.disabled, true)

  // propose/套用 拒绝（稳定码 pack_disabled）
  const tm = new ThreadManager()
  const thread = tm.create("t-disabled")
  const applied = packEngine.applyPack(saved.id, thread.id, tm, skillEngine)
  assert.equal(applied.ok, false)
  if (applied.ok) return
  assert.equal((applied as any).code, "pack_disabled")

  // spawn_worker(pack_id) 闸门：稳定码 PACK_DISABLED，且无任何副作用
  const gate = expertPanel.getPackSpawnGate(saved.id)
  assert.equal(gate.ok, false)
  if (gate.ok) return
  assert.equal(gate.code, expertPanel.PACK_DISABLED_CODE)
  assert.match(gate.error, /disabled/)

  // pack.get 仍可打开（编辑器只读路径）
  const detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.equal(detail.pack.disabled, true)

  // 重新启用（omit disabled 会保留；显式 false 才启用）
  const stillDisabled = packEngine.saveUserPack(
    { id: saved.id, name: "停用专家", system_prompt_append: "你是专家。", skill_ids: [] },
    skillEngine,
  )
  assert.equal(stillDisabled.ok, true)
  assert.equal(expertPanel.getPackSpawnGate(saved.id).ok, false, "omit disabled must preserve")
  const enabled = packEngine.saveUserPack(
    {
      id: saved.id,
      name: "停用专家",
      system_prompt_append: "你是专家。",
      skill_ids: [],
      disabled: false,
    },
    skillEngine,
  )
  assert.equal(enabled.ok, true)
  assert.equal(expertPanel.getPackSpawnGate(saved.id).ok, true)
  assert.equal(packEngine.listInstalledPacks().find((p) => p.id === saved.id)?.disabled, undefined)

  packEngine.deleteUserPack(saved.id, tm, skillEngine)
})

test("effective tools: (parent ∩ pack.allow) \\ HARD_DENY — wish list never shown", () => {
  assert.ok(WORKER_HARD_DENY.has("shell_exec"), "test assumes shell_exec in HARD_DENY")
  const tools = {
    mode: "allowlist" as const,
    allow: ["navigate", "shell_exec", "get_page_text"],
    deny: [],
  }
  // parent 收窄：只有 navigate/shell_exec → 交集后再剔除 HARD_DENY 的 shell_exec
  const eff = expertPanel.computePackEffectiveTools(tools, ["navigate", "click", "shell_exec"])
  assert.deepEqual(eff, ["navigate"])
  // parent null → roleAllow 为基底，仍剔除 HARD_DENY
  const effNull = expertPanel.computePackEffectiveTools(tools, null)
  assert.deepEqual(effNull, ["navigate", "get_page_text"])
  // pack.deny 也剔除
  const effDeny = expertPanel.computePackEffectiveTools(
    { mode: "allowlist", allow: ["navigate", "click"], deny: ["click"] },
    null,
  )
  assert.deepEqual(effDeny, ["navigate"])
})

test("MAJOR-1 regression: 停用→启用（save omit ui 字段）不丢自定义 ui 三字段", () => {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name: "自定义文案专家",
      system_prompt_append: "你是专家。",
      skill_ids: [],
      kind: "expert",
      suitable_for: "自定义适合：只读代码评审",
      unsuitable_for: "自定义不适用：需要写文件的场景",
      tools_summary_zh: "自定义工具面摘要",
      tools: { mode: "allowlist", allow: ["list_tabs", "get_page_text"], deny: [] },
    },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return

  const tm = new ThreadManager()
  // 停用（toggle-disabled 路径：save_user 只翻 disabled，省略 ui 字段）
  const off = packEngine.saveUserPack(
    { id: saved.id, name: "自定义文案专家", system_prompt_append: "你是专家。", skill_ids: [], disabled: true },
    skillEngine,
  )
  assert.equal(off.ok, true)
  let detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.equal(detail.pack.disabled, true)
  assert.equal(detail.pack.suitable_for, "自定义适合：只读代码评审", "停用不得抹掉自定义 suitable_for")
  assert.equal(detail.pack.unsuitable_for, "自定义不适用：需要写文件的场景", "停用不得抹掉自定义 unsuitable_for")
  assert.equal(detail.pack.tools_summary_zh, "自定义工具面摘要", "停用不得抹掉自定义 tools_summary_zh")

  // 启用（同样省略 ui 字段）
  const on = packEngine.saveUserPack(
    { id: saved.id, name: "自定义文案专家", system_prompt_append: "你是专家。", skill_ids: [], disabled: false },
    skillEngine,
  )
  assert.equal(on.ok, true)
  detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.equal(detail.pack.disabled, undefined)
  assert.equal(detail.pack.suitable_for, "自定义适合：只读代码评审")
  assert.equal(detail.pack.unsuitable_for, "自定义不适用：需要写文件的场景")
  assert.equal(detail.pack.tools_summary_zh, "自定义工具面摘要")

  packEngine.deleteUserPack(saved.id, tm, skillEngine)
})

test("ui omit-preserve 不冻结自动推导值：改名后 suitable_for 重新推导", () => {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    { name: "旧名字", system_prompt_append: "prompt", skill_ids: [] },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  const before = packEngine.getPackDetail(saved.id)
  assert.equal(before.ok, true)
  if (!before.ok) return
  assert.equal(before.pack.suitable_for, "用户场景：旧名字")

  const renamed = packEngine.saveUserPack(
    { id: saved.id, name: "新名字", system_prompt_append: "prompt", skill_ids: [] },
    skillEngine,
  )
  assert.equal(renamed.ok, true)
  const after = packEngine.getPackDetail(saved.id)
  assert.equal(after.ok, true)
  if (!after.ok) return
  // 未自定义过 → 按新 name 重新推导，不冻结旧文案
  assert.equal(after.pack.suitable_for, "用户场景：新名字")

  const tm = new ThreadManager()
  packEngine.deleteUserPack(saved.id, tm, skillEngine)
})

test("usage aggregation: spawn_worker grouped by role_label (zero new instrumentation)", () => {
  const file = path.join(tempHome, "audit-test.jsonl")
  const lines = [
    { type: "orchestrator.spawn_worker", at: "2026-09-01T00:00:00Z", role_label: "代码评审专家", tool_whitelist: [] },
    { type: "orchestrator.spawn_worker", at: "2026-09-02T00:00:00Z", role_label: "代码评审专家", tool_whitelist: [] },
    { type: "orchestrator.spawn_worker", at: "2026-09-03T00:00:00Z", role_label: "other-role", tool_whitelist: [] },
    { type: "pack.apply", at: "2026-09-03T01:00:00Z", pack_id: "代码评审专家" },
    "not-json",
  ]
  fs.writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"))
  const usage = expertPanel.aggregateSpawnUsageByRole(file)
  assert.equal(usage.get("代码评审专家")?.count, 2)
  assert.equal(usage.get("代码评审专家")?.last_at, "2026-09-02T00:00:00Z")
  assert.equal(usage.get("other-role")?.count, 1)
  assert.equal(usage.get("pack.apply"), undefined)
})

test("expert panel data: effective tools + usage joined by pack id/name", () => {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name: "面板专家",
      system_prompt_append: "你是专家。",
      skill_ids: [],
      kind: "expert",
      tools: { mode: "allowlist", allow: ["navigate", "shell_exec", "list_tabs"], deny: [] },
    },
    skillEngine,
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  const tm = new ThreadManager()
  const thread = tm.create("t-panel")
  const data = expertPanel.getExpertPanelData(tm, thread.id)
  const entry = data.find((e) => e.id === saved.id)
  assert.ok(entry, "expert must appear in panel data")
  assert.deepEqual(entry?.effective_tools, ["navigate", "list_tabs"], "HARD_DENY (shell_exec) removed")
  assert.equal(entry?.spawn_count, 0)
  // mission packs must NOT appear
  const savedMission = packEngine.saveUserPack(
    { name: "普通场景", system_prompt_append: "场景。", skill_ids: [] },
    skillEngine,
  )
  assert.equal(savedMission.ok, true)
  if (!savedMission.ok) return
  const data2 = expertPanel.getExpertPanelData(tm, thread.id)
  assert.ok(!data2.some((e) => e.id === savedMission.id))
  packEngine.deleteUserPack(saved.id, tm, skillEngine)
  packEngine.deleteUserPack(savedMission.id, tm, skillEngine)
})
