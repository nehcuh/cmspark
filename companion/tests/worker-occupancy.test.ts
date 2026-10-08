/**
 * #578: worker 占名额口径（终局释放）——worker-occupancy.ts 纯函数单测。
 * 覆盖 test-spec T1–T9b：终局释放 / paused 恒占 / re-kick in-flight 占 /
 * 从未跑宽限 / 逾期让位 / created_at fail-closed / trash 不退款 / 状态优先级。
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  workerOccupancyStatus,
  workerOccupiesSlot,
  occupiedWorkerCount,
  createdWorkerCount,
  runWorkers,
  workerCapUsage,
} from "../src/orchestrator/worker-occupancy"
import { ORCHESTRATOR_CAPS } from "../src/orchestrator/constants"

const NOW = 1_800_000_000_000
const idle = ORCHESTRATOR_CAPS.idle_ttl_ms
const opts = { now: NOW }
const endedNormally = {
  last_run_ended_at: new Date(NOW - 60_000).toISOString(),
  last_run_terminal: null,
}
const killedByCircuitBreaker = {
  last_run_ended_at: new Date(NOW - 60_000).toISOString(),
  last_run_terminal: "circuit_breaker",
}
const freshNeverRan = { created_at: new Date(NOW - 10_000).toISOString() }
const overdueNeverRan = { created_at: new Date(NOW - idle - 1_000).toISOString() }

test("T1 正常收工让位", () => {
  assert.equal(workerOccupiesSlot({ ...endedNormally }, opts), false)
  assert.equal(workerOccupancyStatus({ ...endedNormally }, opts), "completed")
})

test("T2 被处死（circuit_breaker）同样让位——终局不区分成败", () => {
  assert.equal(workerOccupiesSlot({ ...killedByCircuitBreaker }, opts), false)
  assert.equal(workerOccupancyStatus({ ...killedByCircuitBreaker }, opts), "terminated")
})

test("T3 re-kick in-flight：ended_at 是上一轮旧值仍占（isActive-first）", () => {
  const active = new Set(["w1"])
  const w = { id: "w1", ...endedNormally } // 上一轮已收工，但正在跑第二轮
  assert.equal(workerOccupiesSlot(w, { now: NOW, isActive: (id) => active.has(id) }), true)
  assert.equal(workerOccupancyStatus(w, { now: NOW, isActive: (id) => active.has(id) }), "running")
})

test("T4 paused 恒占（无论 ended_at、无论 active）", () => {
  assert.equal(workerOccupiesSlot({ paused: true, ...endedNormally }, opts), true)
  assert.equal(workerOccupiesSlot({ paused: true, ...freshNeverRan }, opts), true)
  assert.equal(workerOccupancyStatus({ paused: true, ...endedNormally }, opts), "paused")
})

test("T5 从未跑 + 宽限内（119s）→ 占", () => {
  const w = { created_at: new Date(NOW - (idle - 1_000)).toISOString() }
  assert.equal(workerOccupiesSlot(w, opts), true)
  assert.equal(workerOccupancyStatus(w, opts), "not_started")
})

test("T5b created_at 缺失/不可解析 → fail-closed 占名额（保 #292 裸 worker 断言）", () => {
  assert.equal(workerOccupiesSlot({}, opts), true)
  assert.equal(workerOccupancyStatus({}, opts), "not_started")
  assert.equal(workerOccupiesSlot({ created_at: "not-a-date" }, opts), true)
})

test("T6 从未跑 + 逾期（121s）→ 让位（D2 孤儿兜底）", () => {
  assert.equal(workerOccupiesSlot(overdueNeverRan, opts), false)
  assert.equal(workerOccupancyStatus(overdueNeverRan, opts), "overdue")
})

test("T7 aborted 终局让位", () => {
  const w = { last_run_ended_at: new Date(NOW - 1_000).toISOString(), last_run_terminal: "aborted" }
  assert.equal(workerOccupiesSlot(w, opts), false)
})

test("T8 计数：occupied 过滤让位行；created 含 trashed（删除不退款）", () => {
  const workers = [
    { id: "a", ...endedNormally },
    { id: "b", ...killedByCircuitBreaker },
    { id: "c", ...freshNeverRan },
    { id: "d", paused: true },
    { id: "e", ...overdueNeverRan },
  ]
  assert.equal(occupiedWorkerCount(workers, opts), 2)
  assert.equal(createdWorkerCount(workers), 5)
  assert.equal(createdWorkerCount([...workers, { id: "trashed", ...freshNeverRan }]), 6)
})

test("T9 状态优先级：paused > running > not_started/overdue > completed/terminated", () => {
  const active = () => true
  assert.equal(workerOccupancyStatus({ paused: true, ...endedNormally }, { now: NOW, isActive: active }), "paused")
  assert.equal(workerOccupancyStatus({ ...endedNormally }, { now: NOW, isActive: active }), "running")
  assert.equal(workerOccupancyStatus({ ...overdueNeverRan }, { now: NOW, isActive: active }), "running")
})

test("workerCapUsage：单次扫描同时取 N/M（数组入口一致）", () => {
  const workers = [
    { id: "a", ...endedNormally },
    { id: "b", ...freshNeverRan },
  ]
  assert.deepEqual(
    { occupied: occupiedWorkerCount(workers, opts), created: createdWorkerCount(workers) },
    { occupied: 1, created: 2 },
  )
})

test("runWorkers/workerCapUsage：含 trashed、按 run id + worker 角色过滤", () => {
  const rows = [
    { id: "w1", agent_role: "worker", orchestrator_run_id: "run-1", created_at: new Date(NOW).toISOString() },
    { id: "w2", agent_role: "worker", orchestrator_run_id: "run-1", ...endedNormally }, // trashed 行仍计入
    { id: "w3", agent_role: "worker", orchestrator_run_id: "run-2" },
    { id: "p", agent_role: "orchestrator", orchestrator_run_id: "run-1" },
  ]
  const tm = { list: (_opts?: any) => rows } as any
  assert.equal(runWorkers(tm, "run-1").length, 2)
  const usage = workerCapUsage(tm, "run-1", { now: NOW })
  assert.deepEqual(usage, { occupied: 1, created: 2 })
})
