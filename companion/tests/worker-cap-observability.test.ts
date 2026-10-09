/**
 * #578 评审修复（pr-579-adversarial-20261009）生产点/诊断面集成测。
 * worker-cap-gate.test.ts 直调 spawnWorkerThread 只能证明「gate 接受谓词」；
 * 本文件经真实 executeCompanionTool 驱动三个此前零覆盖的面：
 *   G7 生产点 isActive 注入（dispatch / expert-team）——删注入必红；
 *   G8c list_workers 透出回收站占位行（F1——gate「5/5」与诊断面可对账）；
 *   G11b list_workers 行级 occupancy（F4——此前删字段全绿）；
 *   G9c 预算不足队伍 upfront 截断不发生中途全队回滚（F4）。
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-obs-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let spawnWorkerThread: typeof import("../src/orchestrator/spawn").spawnWorkerThread
let securityPolicy: typeof import("../src/security-policy").securityPolicy
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let packEngine: typeof import("../src/packs/pack-engine")
let tryAcquireMultiAgentLlmLoop: typeof import("../src/orchestrator/llm-loop-gate").tryAcquireMultiAgentLlmLoop
let releaseMultiAgentLlmLoop: typeof import("../src/orchestrator/llm-loop-gate").releaseMultiAgentLlmLoop
let resetMultiAgentLlmLoops: typeof import("../src/orchestrator/llm-loop-gate")._resetMultiAgentLlmLoopsForTests

before(async () => {
  const configMod = await import("../src/config")
  const initDataDir = configMod.initDataDir
  const clearConfigCache = configMod.clearConfigCache
  await initDataDir()
  clearConfigCache()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
  securityPolicy = (await import("../src/security-policy")).securityPolicy
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  packEngine = await import("../src/packs/pack-engine")
  spawnWorkerThread = (await import("../src/orchestrator/spawn")).spawnWorkerThread
  const gate = await import("../src/orchestrator/llm-loop-gate")
  tryAcquireMultiAgentLlmLoop = gate.tryAcquireMultiAgentLlmLoop
  releaseMultiAgentLlmLoop = gate.releaseMultiAgentLlmLoop
  resetMultiAgentLlmLoops = gate._resetMultiAgentLlmLoopsForTests
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function bindTm(tm: any, skillEngine: any = null) {
  const mgr = new SecurityConfirmationManager(60_000)
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => skillEngine as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: mgr,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

function saveExpert(name: string) {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name,
      description: `${name} 职责`,
      system_prompt_append: `你是${name}。`,
      skill_ids: [],
      kind: "expert",
      tools: { mode: "allowlist", allow: ["list_tabs", "get_page_text"], deny: ["shell_exec"] },
    },
    skillEngine,
  )
  assert.equal(saved.ok, true, `saveUserPack ${name}`)
  if (!saved.ok) throw new Error("save failed")
  return { id: saved.id, skillEngine }
}

/** parent + N 个新鲜未跑 worker（占）；terminalAt 给出时再 +1 个已收工 worker（让位，除非谓词判活）。 */
function seedTree(tm: any, runId: string, freshCount: number, terminal?: Record<string, any>) {
  const parent = tm.create(`host-obs-${runId}`)
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: runId })
  const ids: string[] = []
  for (let i = 0; i < freshCount; i++) {
    const w = tm.create(`obs-${runId}-fresh${i}`)
    tm.update(w.id, {
      agent_role: "worker",
      orchestrator_run_id: runId,
      parent_thread_id: parent.id,
      created_at: new Date(Date.now()).toISOString(),
    })
    ids.push(w.id)
  }
  let activeId: string | null = null
  if (terminal) {
    const w = tm.create(`obs-${runId}-terminal`)
    tm.update(w.id, {
      agent_role: "worker",
      orchestrator_run_id: runId,
      parent_thread_id: parent.id,
      ...terminal,
    })
    ids.push(w.id)
    activeId = w.id
  }
  return { parent, ids, activeId }
}

const terminalAt = (endedMsAgo: number): Record<string, any> => ({
  created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  last_run_ended_at: new Date(Date.now() - endedMsAgo).toISOString(),
  last_run_terminal: null,
})

test("G8c list_workers 透出回收站占位行：gate「5/5」与诊断面可对账（评审 F1）", async () => {
  const tm = new ThreadManager()
  bindTm(tm)
  const { parent, ids } = seedTree(tm, "run-g8c", 5)
  ids.forEach((id) => tm.trash(id))
  // gate 视角不变（G8b）：trashed-but-occupied → 5/5 拒
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /5\/5 occupied/)
  // 诊断面（修复前返回 0 行，模型无法对账）：同一批行必须可枚举
  const lr = await executeCompanionTool("list_workers", { __thread_id: parent.id })
  assert.equal(lr.success, true, lr?.error)
  assert.equal(lr.data.workers.length, 5, "trashed placeholder rows must be enumerable")
  for (const row of lr.data.workers) {
    assert.equal(row.trashed, true)
    assert.equal(row.occupancy, "not_started")
  }
})

test("G11b list_workers 行级 occupancy 与终局字段同现（评审 G11 的 list_workers 半）", async () => {
  const tm = new ThreadManager()
  bindTm(tm)
  const { parent, ids } = seedTree(tm, "run-g11b", 2)
  const paused = tm.create("obs-g11b-paused")
  tm.update(paused.id, {
    agent_role: "worker",
    orchestrator_run_id: "run-g11b",
    parent_thread_id: parent.id,
    paused: true,
    created_at: new Date(Date.now()).toISOString(),
  })
  ids.push(paused.id)
  const lr = await executeCompanionTool("list_workers", { __thread_id: parent.id })
  assert.equal(lr.success, true, lr?.error)
  const byId = new Map<string, any>(lr.data.workers.map((w: any) => [w.id, w]))
  assert.equal(byId.get(ids[0]).occupancy, "not_started")
  assert.equal(byId.get(ids[0]).last_run_ended_at, null)
  assert.equal(byId.get(ids[0]).trashed, false)
  assert.equal(byId.get(ids[1]).occupancy, "not_started")
  assert.equal(byId.get(paused.id).occupancy, "paused")
})

test("G7-dispatch 生产点：ended_at 已设 + loop-gate 持坑 → spawn_worker 拒 5/5（删 isActive 注入必红）", async () => {
  const tm = new ThreadManager()
  bindTm(tm)
  // 4 新鲜 + 1 终局（ended_at 已设）——纯字段退化口径 4/5 放行，
  // 完整三源并集谓词把「re-kick 第二轮在跑」计占 → 5/5 拒。两案唯一 delta 即注入本身。
  const { parent, activeId } = seedTree(tm, "run-g7d", 4, terminalAt(30_000))
  assert.ok(activeId, "terminal worker seeded")
  const held = tryAcquireMultiAgentLlmLoop({ agent_role: "worker" }, activeId!)
  assert.equal(held.ok, true, "hold the terminal worker's LLM loop (re-kick round 2 in flight)")
  try {
    const params: Record<string, any> = { __thread_id: parent.id, goal: "probe", role_label: "t" }
    const { token } = securityPolicy.issueTokenFor("spawn_worker", params)
    params.security_token = token
    const r = await executeCompanionTool("spawn_worker", params)
    assert.equal(r.success, false, "execution gate must count the held worker via injected predicate")
    assert.match(String(r.error), /5\/5 occupied/)
  } finally {
    releaseMultiAgentLlmLoop(activeId!)
    resetMultiAgentLlmLoops()
  }
})

test("G7-expert-team 生产点 + F3 文案：同态 spawn_expert_team 拒且文案含 5/5 与 M（评审 G7/F3）", async () => {
  const tm = new ThreadManager()
  const extra = saveExpert("评审G7专家")
  bindTm(tm, extra.skillEngine)
  const { parent, activeId } = seedTree(tm, "run-g7e", 4, terminalAt(30_000))
  const held = tryAcquireMultiAgentLlmLoop({ agent_role: "worker" }, activeId!)
  assert.equal(held.ok, true)
  try {
    const params: Record<string, any> = {
      __thread_id: parent.id,
      goal: "probe team",
      members: [{ pack_id: extra.id, brief: "slot probe" }],
    }
    const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
    params.security_token = token
    const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
      kickWorkerChat: () => {},
    })
    assert.equal(r.success, false, "expert-team execution gate holds the same full predicate")
    const err = String(r.error)
    assert.match(err, /5\/5 occupied/, "predicate-active terminal worker must occupy the 5th slot")
    assert.match(err, /5\/20 created this run/, "F3: message must carry current N/M")
    assert.match(err, /slots full/)
  } finally {
    releaseMultiAgentLlmLoop(activeId!)
    resetMultiAgentLlmLoops()
  }
})

test("F3 源码守卫：l2-admission 确认卡拒绝文案钉在 workerCapExhaustionMessage（评审 F3 的 l2 半）", () => {
  // N-3 分支（l2-admission.ts「名额已满不出空队卡」）走完整确认流前置（WS ctx /
  // tray 绑定），行为测试成本高；评审证明的回归恰是「该分支文案被退回旧的
  // 硬编码归因」（变异全绿）——用 #569 同款源码守卫钉死，退回即红。
  const src = ["src/tool/l2-admission.ts", "companion/src/tool/l2-admission.ts"]
    .map((p) => {
      try {
        return fs.readFileSync(p, "utf8")
      } catch {
        return null
      }
    })
    .find((x) => x !== null)
  assert.ok(src, "找不到 l2-admission.ts（请在 companion/ 或仓库根运行）")
  assert.ok(
    src.includes("workerCapExhaustionMessage(capUsage)"),
    "确认卡 N-3 拒绝必须走 workerCapExhaustionMessage SSOT（按真实阻塞归因 + 当前 N/M）",
  )
  assert.ok(
    src.includes("spawn_expert_team denied: "),
    "确认卡拒绝文案须保留 spawn_expert_team denied: 前缀（错误归因可辨识）",
  )
  assert.ok(
    !src.includes("max_workers_per_orchestrator_run reached; spawn_expert_team has no remaining"),
    "旧文案（仅预算耗尽时误归因 occupancy 上限）不得回潮",
  )
})

test("G9c 预算不足队伍 upfront 截断：M=19 → 3 人队截为 1 且无全队回滚（评审 G9）", async () => {
  const tm = new ThreadManager()
  const e1 = saveExpert("评审G9甲")
  const e2 = saveExpert("评审G9乙")
  const e3 = saveExpert("评审G9丙")
  bindTm(tm, e1.skillEngine)
  const { parent } = seedTree(tm, "run-g9c", 0)
  for (let i = 0; i < 19; i++) {
    const w = tm.create(`obs-g9c-t${i}`)
    tm.update(w.id, {
      agent_role: "worker",
      orchestrator_run_id: "run-g9c",
      parent_thread_id: parent.id,
      ...terminalAt(30_000),
    })
  }
  const kicked: string[] = []
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "budget truncation",
    members: [
      { pack_id: e1.id, brief: "a" },
      { pack_id: e2.id, brief: "b" },
      { pack_id: e3.id, brief: "c" },
    ],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: ({ threadId }) => {
      kicked.push(threadId)
    },
  })
  assert.equal(r.success, true, r?.error)
  assert.equal(r.data.worker_ids.length, 1, "upfront truncation to budget room (20-19=1)")
  assert.equal(r.data.truncated, true)
  assert.equal(kicked.length, 1, "no mid-loop gate hit → no full-team rollback")
  // M=20 → 预算闸独立拒绝；F3 文案不得再误归因 occupancy 上限
  const params2: Record<string, any> = {
    __thread_id: parent.id,
    goal: "budget exhausted",
    members: [{ pack_id: e1.id, brief: "one more" }],
  }
  const { token: token2 } = securityPolicy.issueTokenFor("spawn_expert_team", params2)
  params2.security_token = token2
  const r2 = await executeCompanionTool("spawn_expert_team", params2, undefined, {
    kickWorkerChat: () => {},
  })
  assert.equal(r2.success, false)
  const err = String(r2.error)
  assert.match(err, /creation budget exhausted: 20\/20 created this run/)
  assert.match(err, /1\/5 occupied/, "first truncated spawn left one fresh worker occupying")
  assert.doesNotMatch(err, /slots full/)
})
