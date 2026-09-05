import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// #368 I2: 七个 builtin 预置专家 Pack 的 fixture 约束。
// 隔离：不写真实 ~/.cmspark-agent（#356 split-brain 教训同款）。

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-packs-i2-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

const EXPERT_IDS = [
  "expert-product-manager",
  "expert-sre",
  "expert-project-manager",
  "expert-ops",
  "expert-architect",
  "expert-developer",
  "expert-qa",
]

/** 基线 allow 外允许按角色扩的浏览器交互工具（无 evaluate）。 */
const EXTRA_ALLOW = new Set(["navigate", "click", "scroll"])
/** 基线 allow（全员必有）。 */
const BASELINE_ALLOW = ["list_tabs", "get_page_text", "screenshot", "use_skill"]
/** 全员禁止的高危/控制面工具（对齐 issue NEVER + ADR-015 HARD_DENY 精神）。 */
const FORBIDDEN_ALLOW = new Set([
  "shell_exec",
  "netsec_port_scan",
  "osascript_eval",
  "host_computer",
  "host_write",
  "host_read",
  "host_app",
  "host_cli",
  "evaluate",
  "spawn_worker",
  "acp_list_agents",
  "acp_propose_session",
  "acp_start_session",
  "acp_collect_result",
  "acp_cancel_session",
  "acp_get_status",
  "acp_apply_diff",
])

let getBuiltinPacksRoot: typeof import("../src/packs/pack-engine").getBuiltinPacksRoot
let packEngine: typeof import("../src/packs/pack-engine")
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let validatePackDir: typeof import("../src/packs/validator").validatePackDir

before(async () => {
  packEngine = await import("../src/packs/pack-engine")
  getBuiltinPacksRoot = packEngine.getBuiltinPacksRoot
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  validatePackDir = (await import("../src/packs/validator")).validatePackDir
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

/** 从源目录（非安装目录）读并校验每个 expert pack。 */
function expertPackDirs(): Array<{ id: string; dir: string }> {
  const root = getBuiltinPacksRoot()
  return EXPERT_IDS.map((id) => ({ id, dir: path.join(root, id) })).filter((d) =>
    fs.existsSync(path.join(d.dir, "pack.yaml")),
  )
}

test("I2: 七个 expert builtin 源目录存在且 pack.yaml 过 validator", () => {
  const dirs = expertPackDirs()
  assert.equal(dirs.length, 7, `expected 7 expert pack dirs, got ${dirs.length}: ${dirs.map((d) => d.id).join(",")}`)
  for (const { id, dir } of dirs) {
    const v = validatePackDir(dir)
    assert.equal(v.ok, true, `${id} must validate: ${v.ok ? "" : (v as { error: string }).error}`)
  }
})

test("I2: 七包 kind=expert / author=cmspark / channel=community / 无 trust 无 enterprise 模块", () => {
  for (const { id, dir } of expertPackDirs()) {
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const m = v.manifest
    assert.equal(m.kind, "expert", `${id} kind must be expert`)
    assert.equal(m.author, "cmspark", `${id} author must be cmspark (builtin origin 解析依赖)`)
    assert.equal(m.channel, "community", `${id} must be community (no enterprise SKU)`)
    assert.equal(m.trust, undefined, `${id} must not carry trust`)
    assert.deepEqual(m.requires_modules, [], `${id} must not require enterprise modules`)
    assert.notEqual(m.board_mode, true, `${id} board_mode must be falsy/omitted`)
  }
})

test("I2: 工具面 — 基线必有、allow 不越界、deny 覆盖高危；无 evaluate", () => {
  const dirs = expertPackDirs()
  for (const { id, dir } of dirs) {
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const t = v.manifest.tools
    assert.equal(t.mode, "allowlist", `${id} tools.mode must be allowlist`)
    const allow = new Set(t.allow)
    // 基线 allow 必须全在
    for (const b of BASELINE_ALLOW) {
      assert.ok(allow.has(b), `${id} missing baseline allow: ${b}`)
    }
    // allow 只能 = 基线 ∪ (QA/developer 可加 navigate/click/scroll)
    const allowedExtras = [...allow].filter((x) => !BASELINE_ALLOW.includes(x))
    for (const x of allowedExtras) {
      assert.ok(EXTRA_ALLOW.has(x), `${id} unexpected allow entry: ${x}`)
    }
    // 高危/控制面永不在 allow（含 evaluate）
    for (const f of FORBIDDEN_ALLOW) {
      assert.ok(!allow.has(f), `${id} must NOT allow ${f}`)
    }
    // deny 必须覆盖 FORBIDDEN_ALLOW 全集合（复审 grok NIT-1：票面 host_*/netsec_*/acp_* 整集，非抽样）
    for (const f of FORBIDDEN_ALLOW) {
      assert.ok(t.deny.includes(f), `${id} deny must include ${f}`)
    }
  }
})

test("I2: 角色差异化 — QA/developer 有 navigate/click/scroll，纯顾问角色没有", () => {
  const dirs = expertPackDirs()
  const interactive = ["expert-qa", "expert-developer"]
  for (const { id, dir } of dirs) {
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const allow = new Set(v.manifest.tools.allow)
    const expectInteractive = interactive.includes(id)
    for (const extra of ["navigate", "click", "scroll"]) {
      assert.equal(allow.has(extra), expectInteractive, `${id} interactive tool ${extra} mismatch`)
    }
  }
})

test("I2: ui 字段必填 + 各附 1 个 pack-local skill 文件", () => {
  for (const { id, dir } of expertPackDirs()) {
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const m = v.manifest
    // suitable_for / unsuitable_for / tools_summary_zh 必填
    assert.ok(m.ui?.suitable_for?.trim(), `${id} ui.suitable_for required`)
    assert.ok(m.ui?.unsuitable_for?.trim(), `${id} ui.unsuitable_for required`)
    assert.ok(m.ui?.tools_summary_zh?.trim(), `${id} ui.tools_summary_zh required`)
    // 恰好 1 个 pack-local skill
    assert.equal(m.skills.length, 1, `${id} should have exactly 1 pack-local skill`)
    const skillPath = path.join(dir, m.skills[0])
    assert.ok(fs.existsSync(skillPath), `${id} skill file missing: ${m.skills[0]}`)
    assert.ok(fs.statSync(skillPath).isFile(), `${id} skill is not a file`)
  }
})

test("I2: 运维/SRE 的 unsuitable_for 写明「主对话+企业模块，不 spawn worker」", () => {
  for (const id of ["expert-ops", "expert-sre"]) {
    const dir = path.join(getBuiltinPacksRoot(), id)
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const unsuitable = v.manifest.ui?.unsuitable_for ?? ""
    assert.match(unsuitable, /主对话/, `${id} unsuitable_for must mention 主对话`)
    assert.match(unsuitable, /企业模块/, `${id} unsuitable_for must mention 企业模块`)
    assert.match(unsuitable, /不要 spawn worker/, `${id} unsuitable_for must say 不要 spawn worker`)
  }
})

test("I2: system_prompt_append 含能力边界与审计句，无越权话术", () => {
  for (const { id, dir } of expertPackDirs()) {
    const v = validatePackDir(dir)
    assert.ok(v.ok)
    if (!v.ok) continue
    const p = v.manifest.system_prompt_append
    assert.ok(p.length > 0, `${id} system_prompt_append required`)
    // 票面 prompt 3–8 句：按非空行（语义段落）计——防写成一段说明书。
    // （不用分号/句号切分：中文流水句会被 ; 虚高计数，非票面本意。）
    const paras = p.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 0).length
    assert.ok(paras >= 3 && paras <= 8, `${id} prompt should be 3-8 paragraphs, got ${paras}`)
    // 审计句：不得声称执行工具面外操作
    assert.match(p, /不得声称/, `${id} must carry 审计句 (不得声称…)`)
    assert.match(p, /persona ≠ 权限/, `${id} must state persona ≠ 权限`)
    // 能力边界结构哨兵：必有「能力边界」段 + 足够否定词 + 工具面自我限定
    assert.match(p, /能力边界/, `${id} must have 能力边界 section`)
    assert.ok((p.match(/不能|不得|无权|只/g) || []).length >= 2, `${id} must bound capability with negations`)
    assert.match(p, /工具面/, `${id} must self-limit to 工具面`)
    // MAJOR-1 (复审 grok): 正向禁止——persona 不得以肯定句自述能执行主机/跑命令/改信任/spawn。
    // 限距 24 字符防「可以读页面但**不能**执行 shell」误伤（实测 7 包全 safe）。
    assert.ok(
      !/可以.{0,24}(执行主机|跑命令|改全局信任|spawn worker|shell)/.test(p),
      `${id} must not affirmatively claim host/command/trust/spawn capability`,
    )
    // 能力边界句必须含否定式「不能执行」（防只写「只能读」而漏禁执行）
    assert.match(p, /不能执行/, `${id} capability boundary must explicitly forbid 执行`)
  }
})

test("I2: 启动安装后 pack.list 可按 kind 滤出 7 个 expert", async () => {
  const skillEngine = new SkillEngine()
  const installed = packEngine.ensureBuiltinPacksInstalled(skillEngine)
  for (const id of EXPERT_IDS) {
    assert.ok(installed.includes(id), `ensureBuiltinPacksInstalled should install ${id}`)
  }
  const list = packEngine.listInstalledPacks()
  // NIT-5 (复审 grok): 不断言「恰好 7」永恒不变量（I3 之后会有第 8 个 user expert）——
  // 改为断言本票 7 个都带 kind=expert 且过滤语义正确（mission 不被误标）。
  for (const id of EXPERT_IDS) {
    const item = list.find((p) => p.id === id)
    assert.ok(item, `${id} should be listed`)
    assert.equal(item!.kind, "expert", `${id} must be kind=expert`)
  }
  const experts = list.filter((p) => p.kind === "expert")
  assert.ok(experts.length >= EXPERT_IDS.length, `expected at least ${EXPERT_IDS.length} kind=expert in list`)
  // 旧的 4 个 mission pack 不受影响
  const missions = list.filter((p) => p.kind === "mission")
  assert.ok(missions.length >= 4, "existing mission packs must remain listed")
})
