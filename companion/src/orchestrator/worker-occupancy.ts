// #578: spawn 名额占用口径（终局释放）——单一 SoT。
//
// ADR-015 §3.5 的 max_workers_per_orchestrator_run 与本票新增的
// max_workers_created_per_run 都以本模块的谓词/计数为准：
//   占名额 = paused ∨ isActive ∨ (从未跑 ∧ created_at 在 idle_ttl 宽限内)
//   让位   = 终局（last_run_ended_at 已设且非 paused/active）∨ 逾期孤儿
// 纯函数、零运行时依赖（只有类型与常量导入）——活性谓词由调用方注入
// （dispatch/expert-team 用 buildIsThreadLlmActive 三源并集；fleet 用
// abort map ∪ loop-gate holders ∪ 排队 kick 的同步合成）。禁静态导入
// message-router（加载环：spawn→本模块→message-router→llm-loop-gate→spawn；
// 防环先例 message-router.ts probe 注入 / fleet.ts lazy require /
// companion-dispatch.ts async lazy import）。
//
// 终局判定只对非 in-flight worker 生效：last_run_ended_at 在 run 结束的
// finally 覆盖写（adapter 唯一收口），epoch 守卫只防被取代的旧 run 覆写、
// 不防「re-kick 第二轮在跑、ended_at 还是上一轮旧值」——与
// fleet-supervision.ts / cooperation-state.ts 的 isActive-first 一致。

import type { ThreadManager } from "../threads/thread-manager"
import { ORCHESTRATOR_CAPS } from "./constants"

/** 活性谓词：worker 是否有在跑/排队的 LLM run（三源并集由调用方组装）。 */
export type OccupancyActivePredicate = (threadId: string) => boolean

export interface OccupancyOpts {
  /** 计时基准（可注入以便测试）；缺省 Date.now()。 */
  now?: number
  /** 缺省（undefined）= 退化到纯字段判定——仅 advisory 路径可接受，执行闸必须注入。 */
  isActive?: OccupancyActivePredicate
}

/**
 * 与 fleet-supervision.ts 的 paused > not_started > terminal/completed 同族；
 * overdue（从未跑过且超过 idle_ttl 宽限）是 #578 新增的区分。
 */
export type WorkerOccupancyStatus =
  | "paused"
  | "running"
  | "not_started"
  | "overdue"
  | "completed"
  | "terminated"

/** 结构化输入——线程记录的相关字段子集（含测试种裸对象）。 */
export interface OccupancyWorker {
  id?: string
  paused?: boolean
  created_at?: string
  last_run_ended_at?: string | null
  last_run_terminal?: string | null
}

export function workerOccupancyStatus(
  w: OccupancyWorker,
  opts: OccupancyOpts = {},
): WorkerOccupancyStatus {
  if (w.paused) return "paused"
  if (opts.isActive?.(w.id ?? "")) return "running"
  if (!w.last_run_ended_at) {
    // 从未跑过：idle_ttl 宽限内视为新鲜（占）；逾期孤儿让位（#578 D2）。
    // created_at 缺失/不可解析 → fail-closed 视为新鲜（占名额，只收紧不放松）；
    // 保 #292 测试种的裸 worker（无 created_at）仍被名额闸拒绝。
    const createdMs = w.created_at ? Date.parse(w.created_at) : NaN
    if (!Number.isFinite(createdMs)) return "not_started"
    const now = opts.now ?? Date.now()
    return now - createdMs >= ORCHESTRATOR_CAPS.idle_ttl_ms ? "overdue" : "not_started"
  }
  return w.last_run_terminal ? "terminated" : "completed"
}

/** 是否占用 spawn 名额。released = 终局（completed/terminated）∨ 逾期（overdue）。 */
export function workerOccupiesSlot(w: OccupancyWorker, opts: OccupancyOpts = {}): boolean {
  const s = workerOccupancyStatus(w, opts)
  return s === "paused" || s === "running" || s === "not_started"
}

/**
 * 单次扫描：run 下全部 worker（含回收站——trash 不结束 run、不清 paused、
 * 可 restore，故 trash 既不释放占用也不退创建预算；硬删与 #292 spawn 失败
 * 回滚走 tm.delete，天然不计数——「spawn 从未发生」）。
 */
export function runWorkers(tm: ThreadManager, orchestratorRunId: string): OccupancyWorker[] {
  return (tm.list({ include_trashed: true }) as any[]).filter(
    (t) => t.agent_role === "worker" && t.orchestrator_run_id === orchestratorRunId,
  )
}

export function occupiedWorkerCount(workers: OccupancyWorker[], opts: OccupancyOpts = {}): number {
  return workers.filter((w) => workerOccupiesSlot(w, opts)).length
}

/** 累计创建数（含 trashed；硬删/回滚不计数）。 */
export function createdWorkerCount(workers: OccupancyWorker[]): number {
  return workers.length
}

/** spawn gate 一次扫描同时取占用 N 与累计 M。 */
export function workerCapUsage(
  tm: ThreadManager,
  orchestratorRunId: string,
  opts: OccupancyOpts = {},
): { occupied: number; created: number } {
  const workers = runWorkers(tm, orchestratorRunId)
  return { occupied: occupiedWorkerCount(workers, opts), created: createdWorkerCount(workers) }
}
