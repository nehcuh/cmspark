/**
 * #578: spawn gate 占名额 + 累计创建上限集成测（G1–G8）+ 专家队余量（G9）。
 * gate 语义：paused/在跑/新鲜未跑占名额；终局与逾期孤儿让位；
 * 创建预算含 trashed（不退款）、硬删/回滚不计数；注入谓词被执行闸消费（G7）。
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-578-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let spawnWorkerThread: typeof import("../src/orchestrator/spawn").spawnWorkerThread
let remainingWorkerSlots: typeof import("../src/orchestrator/expert-team").remainingWorkerSlots
let ORCHESTRATOR_CAPS: typeof import("../src/orchestrator/constants").ORCHESTRATOR_CAPS
let initDataDir: typeof import("../src/config").initDataDir
let workerOccupancyStatus: typeof import("../src/orchestrator/worker-occupancy").workerOccupancyStatus
let workerOccupiesSlot: typeof import("../src/orchestrator/worker-occupancy").workerOccupiesSlot
let resetOccupancyClock: typeof import("../src/orchestrator/worker-occupancy").__resetOccupancyClockForTests
let workerCapExhaustionMessage: typeof import("../src/orchestrator/expert-team").workerCapExhaustionMessage

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  spawnWorkerThread = (await import("../src/orchestrator/spawn")).spawnWorkerThread
  remainingWorkerSlots = (await import("../src/orchestrator/expert-team")).remainingWorkerSlots
  ORCHESTRATOR_CAPS = (await import("../src/orchestrator/constants")).ORCHESTRATOR_CAPS
  const occ = await import("../src/orchestrator/worker-occupancy")
  workerOccupancyStatus = occ.workerOccupancyStatus
  workerOccupiesSlot = occ.workerOccupiesSlot
  resetOccupancyClock = occ.__resetOccupancyClockForTests
  workerCapExhaustionMessage = (await import("../src/orchestrator/expert-team")).workerCapExhaustionMessage
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

const idleMs = () => ORCHESTRATOR_CAPS.idle_ttl_ms
const CAP = () => ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run
const BUDGET = () => ORCHESTRATOR_CAPS.max_workers_created_per_run

function seedParent(tm: InstanceType<typeof ThreadManager>, runId: string): any {
  const parent = tm.create(`host-578-${runId}`) as any
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: runId })
  return tm.get(parent.id)
}

function seedWorker(
  tm: InstanceType<typeof ThreadManager>,
  parent: any,
  runId: string,
  fields: Record<string, any> = {},
): any {
  const w = tm.create(`worker-578-${runId}`) as any
  tm.update(w.id, {
    agent_role: "worker",
    orchestrator_run_id: runId,
    parent_thread_id: parent.id,
    ...fields,
  })
  return tm.get(w.id)
}

const terminalWorker = (): Record<string, any> => ({
  created_at: new Date(Date.now() - idleMs() - 60_000).toISOString(),
  last_run_ended_at: new Date(Date.now() - 30_000).toISOString(),
  last_run_terminal: null,
})

test("G1 占名额满：拒绝且文案含 N/5 与 M/20 两个数字（保留 max_workers 词元）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g1")
  for (let i = 0; i < CAP(); i++) {
    seedWorker(tm, parent, "run-g1", { created_at: new Date(Date.now()).toISOString() }) // 新鲜未跑 = 占
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.error, /max_workers/)
    assert.match(r.error, new RegExp(`${CAP()}/${CAP()} occupied`))
    assert.match(r.error, new RegExp(`${CAP()}/${BUDGET()} created this run`))
  }
})

test("G1b 终局释放：5 个全部正常收工后第 6 次 spawn 放行（票验收 1）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g1b")
  for (let i = 0; i < CAP(); i++) {
    seedWorker(tm, parent, "run-g1b", terminalWorker())
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, true, "all-terminal workers must free every slot")
  if (r.ok) tm.delete(r.worker.id)
})

test("G2 名额有空但累计 M=20：拒绝且文案含 20/20 与 trash 不退款提示", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g2")
  for (let i = 0; i < BUDGET(); i++) {
    seedWorker(tm, parent, "run-g2", terminalWorker()) // 全部让位 → 名额空闲
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false, "creation budget exhausted even when slots are free")
  if (!r.ok) {
    assert.match(r.error, new RegExp(`${BUDGET()}/${BUDGET()} created this run`))
    assert.match(r.error, /trash does not refund/)
  }
})

test("G4 逾期孤儿让位后 spawn 放行（票验收 4，无需删线程）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g4")
  for (let i = 0; i < CAP(); i++) {
    seedWorker(tm, parent, "run-g4", {
      created_at: new Date(Date.now() - idleMs() - 1_000).toISOString(),
    })
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, true)
  if (r.ok) tm.delete(r.worker.id)
})

test("G5 userConfirmed=false 先于名额闸拒绝（既有顺序不回归）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g5")
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: false })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /userConfirmed/)
})

test("G6 run id 稳定：成功 spawn 不换新 run id（方案 B 禁区）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g6")
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.orchestrator_run_id, "run-g6")
    const p = tm.get(parent.id) as any
    assert.equal(p.orchestrator_run_id, "run-g6")
    tm.delete(r.worker.id)
  }
})

test("G7 执行闸消费注入谓词：4 新鲜 + 1 终局判活 → 注入时 5/5 拒、不注入时 4/5 过（防纯字段退化）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g7")
  for (let i = 0; i < CAP() - 1; i++) {
    seedWorker(tm, parent, "run-g7", { created_at: new Date(Date.now()).toISOString() }) // 新鲜未跑，无条件占
  }
  // 已收工但 re-kick 第二轮在跑：纯字段判定让位，完整谓词计占——两案的唯一 delta
  const active = seedWorker(tm, parent, "run-g7", terminalWorker())
  const r = spawnWorkerThread(tm, {
    parentThreadId: parent.id,
    userConfirmed: true,
    isActive: (id) => id === active.id,
  })
  assert.equal(r.ok, false, "execution gate must consult the injected liveness predicate")
  if (!r.ok) {
    assert.match(r.error, new RegExp(`${CAP()}/${CAP()} occupied`))
  }
  // 对照：同一棵树不注入谓词（advisory 退化口径）→ 只看字段 → 4/5 → 放行
  const r2 = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r2.ok, true)
  if (r2.ok) tm.delete(r2.worker.id)
})

test("G8 trashed worker 计入 N 与 M（occupied 态 trash：不释放占用、不退预算）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g8")
  const w = seedWorker(tm, parent, "run-g8", { created_at: new Date(Date.now()).toISOString() })
  tm.trash(w.id) // 软删 occupied 态 worker
  const r = spawnWorkerThread(tm, {
    parentThreadId: parent.id,
    userConfirmed: true,
    isActive: () => false,
  })
  assert.equal(r.ok, true, "1/5 occupied → spawn allowed; trash does not free the occupied slot")
  if (r.ok) {
    const rows = (tm.list({ include_trashed: true }) as any[]).filter(
      (t) => t.agent_role === "worker" && t.orchestrator_run_id === "run-g8",
    )
    assert.equal(rows.length, 2, "created count includes the trashed row")
    tm.delete(r.worker.id)
  }
})

test("G8b trash 不释放占名额（评审 M1）：5 个新鲜 worker 全部 trash → 仍 5/5 拒", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g8b")
  for (let i = 0; i < CAP(); i++) {
    const w = seedWorker(tm, parent, "run-g8b", { created_at: new Date(Date.now()).toISOString() })
    tm.trash(w.id)
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false, "trashed-but-occupied workers must still hold every slot")
  if (!r.ok) assert.match(r.error, new RegExp(`${CAP()}/${CAP()} occupied`))
})

test("G3 M=19 边界放行（名额与预算都不到顶）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g3")
  for (let i = 0; i < BUDGET() - 1; i++) {
    seedWorker(tm, parent, "run-g3", terminalWorker())
  }
  const r = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, true)
  if (r.ok) tm.delete(r.worker.id)
})

test("G10 parentRoleSnapshot.worker_count 保持库存口径（回收站除外；≠ 占名额口径）", async () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g10")
  const w1 = seedWorker(tm, parent, "run-g10", { created_at: new Date(Date.now()).toISOString() }) // 占用中
  seedWorker(tm, parent, "run-g10", terminalWorker()) // 已终局
  tm.trash(w1.id)
  const { parentRoleSnapshot } = await import("../src/orchestrator/expert-team")
  const snap = parentRoleSnapshot(tm, parent.id)
  assert.equal(snap.worker_count, 1, "inventory = live (non-trashed) workers only, regardless of occupancy")
  // 占名额口径同一棵树：trash 行仍计占、终局行让位 → occupied=1, created=2
  const { workerCapUsage } = await import("../src/orchestrator/worker-occupancy")
  const usage = workerCapUsage(tm, "run-g10", { isActive: () => false })
  assert.deepEqual(usage, { occupied: 1, created: 2 })
})

test("G11 fleet occupied 字段与 llm_active 语义同源且互不覆盖", async () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g11")
  const live = seedWorker(tm, parent, "run-g11", { created_at: new Date(Date.now()).toISOString() })
  seedWorker(tm, parent, "run-g11", terminalWorker())
  const { buildFleetSnapshot } = await import("../src/orchestrator/fleet")
  const snap = buildFleetSnapshot(tm)
  const byId = new Map(snap.workers.map((w) => [w.id, w]))
  assert.equal(byId.get(live.id)?.occupied, true, "fresh never-ran worker occupies")
  assert.equal(byId.get(live.id)?.llm_active, false, "no abort-map entry → llm_active stays false")
  const terminalRow = [...byId.values()].find((w) => w.id !== live.id)
  assert.equal(terminalRow?.occupied, false, "terminal worker released")
})

test("G11c fleet trashed_occupied_count：回收站占位行计数透出且不进 workers 视图（评审 F1 fleet 半）", async () => {
  const tm = new ThreadManager()
  const { buildFleetSnapshot } = await import("../src/orchestrator/fleet")
  // 全局计数（非 per-run），同数据目录内其他测试会留下 trashed worker——
  // 用前后快照增量断言，不受既有污染影响。
  const beforeCount = buildFleetSnapshot(tm).trashed_occupied_count
  const parent = seedParent(tm, "run-g11c")
  const occ = seedWorker(tm, parent, "run-g11c", { created_at: new Date(Date.now()).toISOString() }) // 占用中
  seedWorker(tm, parent, "run-g11c", terminalWorker()) // 已终局让位
  tm.trash(occ.id) // 占用中的 worker 进回收站：仍占名额（G8b）
  const snap = buildFleetSnapshot(tm)
  assert.equal(snap.trashed_occupied_count, beforeCount + 1, "trashed-but-occupied worker must be counted")
  assert.equal(
    snap.workers.some((w) => w.id === occ.id),
    false,
    "trashed row must NOT appear in the workers view (worker_count stays inventory-only, G10)",
  )
  // 变异敏感性：fleet.ts 计数处若退化为 tm.list()（丢 include_trashed），增量恒 0 本测试必红。
})

test("G9 专家队余量 min(5−N, 20−M)：预算不足截到 1；超出部分被创建预算拒绝", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g9")
  for (let i = 0; i < 4; i++) {
    seedWorker(tm, parent, "run-g9", { created_at: new Date(Date.now()).toISOString() }) // N=4 占
  }
  seedWorker(tm, parent, "run-g9", terminalWorker()) // 让位：M=5、N=4
  const slots = remainingWorkerSlots(tm, parent.id, { isActive: () => false })
  assert.equal(slots, Math.min(CAP() - 4, BUDGET() - 5), "min(slot room, budget room)")
  const r1 = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r1.ok, true)
  if (r1.ok) tm.delete(r1.worker.id)
  // 再补到 M=20 → 预算闸独立拒绝（名额仍有空）
  const createdSoFar = (tm.list({ include_trashed: true }) as any[]).filter(
    (t) => t.agent_role === "worker" && t.orchestrator_run_id === "run-g9",
  ).length
  for (let i = createdSoFar; i < BUDGET(); i++) {
    seedWorker(tm, parent, "run-g9", terminalWorker())
  }
  const r2 = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.error, /creation cap reached/)
})

// ── 评审修复（pr-579-adversarial-20261009：G9b / F3 / F2）────────────────────

test("G9b 预算腿严格 binding：occupied=0、created=19 → slots=1（删 min() 预算腿则得 5，本测试必红）", () => {
  const tm = new ThreadManager()
  const parent = seedParent(tm, "run-g9b")
  for (let i = 0; i < BUDGET() - 1; i++) {
    // 全部终局 → N=0（名额腿 slack=5-0），M=19（预算腿 binding=20-19）
    seedWorker(tm, parent, "run-g9b", terminalWorker())
  }
  const slots = remainingWorkerSlots(tm, parent.id, { isActive: () => false })
  assert.equal(slots, 1, "budget leg (20-19=1) must bind; dropping it from min() yields 5-0=5")
})

test("F3 双闸拒绝文案 SSOT：按真实阻塞归因且必含 N/M 数字", () => {
  const onlyBudget = workerCapExhaustionMessage({ occupied: 0, created: BUDGET() })
  assert.match(onlyBudget, /creation budget exhausted/)
  assert.match(onlyBudget, new RegExp(`${BUDGET()}/${BUDGET()} created this run`))
  assert.match(onlyBudget, /0\/5 occupied/)
  assert.match(onlyBudget, /trash does not refund/)
  assert.doesNotMatch(onlyBudget, /slots full/, "budget-only exhaustion must not claim the occupancy cap")
  const onlyOcc = workerCapExhaustionMessage({ occupied: CAP(), created: 3 })
  assert.match(onlyOcc, /slots full/)
  assert.match(onlyOcc, new RegExp(`${CAP()}/${CAP()} occupied`))
  assert.match(onlyOcc, /3\/20 created this run/)
  const both = workerCapExhaustionMessage({ occupied: CAP(), created: BUDGET() })
  assert.match(both, /both exhausted/)
  assert.match(both, /trashed workers still count/)
})

test("F2 墙钟回拨：已让位的逾期孤儿不翻回占位（生产缺省钟路径，高水位钳制）", () => {
  const realNow = Date.now
  try {
    resetOccupancyClock()
    let t = 1_700_000_000_000
    Date.now = () => t
    const tm = new ThreadManager()
    const parent = seedParent(tm, "run-f2")
    const w = seedWorker(tm, parent, "run-f2", { created_at: new Date(t).toISOString() })
    t += idleMs() + 10_000 // 单调前进 130s → 逾期让位
    assert.equal(workerOccupancyStatus(w), "overdue")
    assert.equal(workerOccupiesSlot(w), false)
    t -= 600_000 // 回拨 10 分钟：无钳制时 age 回到 −470s → 翻回 not_started/占
    assert.equal(
      workerOccupancyStatus(w),
      "overdue",
      "backward clock step must not re-occupy a released orphan",
    )
    assert.equal(workerOccupiesSlot(w), false)
    t += idleMs() // 时钟恢复前进，仍 overdue（高水位单调不回退）
    assert.equal(workerOccupancyStatus(w), "overdue")
  } finally {
    Date.now = realNow
    resetOccupancyClock()
  }
})
