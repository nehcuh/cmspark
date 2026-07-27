// Fleet snapshot for Side Panel FleetStrip + Dashboard — ADR-015 P1

import type { ThreadManager } from "../threads/thread-manager"
import { listTabLocks } from "./tab-lease"
import { listWorkers } from "./spawn"

export interface FleetWorkerView {
  id: string
  alias: string
  worker_role_label?: string | null
  parent_thread_id?: string | null
  orchestrator_run_id?: string | null
  agent_role?: string
  paused: boolean
  status: "idle" | "paused" | "holding_tabs" | "unknown"
  tab_locks: Array<{
    tab_id: number
    state: string
    lease_expires_at: number
  }>
}

export interface FleetSnapshot {
  type: "fleet.status"
  at: string
  workers: FleetWorkerView[]
  locks: ReturnType<typeof listTabLocks>
  worker_count: number
  lock_count: number
  worst_status: "idle" | "paused" | "holding_tabs" | "none"
  orchestrator_runs: string[]
}

export function buildFleetSnapshot(tm: ThreadManager): FleetSnapshot {
  const locks = listTabLocks()
  const locksByHolder = new Map<string, typeof locks>()
  for (const l of locks) {
    const arr = locksByHolder.get(l.holder_thread_id) || []
    arr.push(l)
    locksByHolder.set(l.holder_thread_id, arr)
  }

  const all = tm.list() as any[]
  const workers = all.filter(
    (t) => t.agent_role === "worker" || t.agent_role === "orchestrator" || t.parent_thread_id,
  )

  const views: FleetWorkerView[] = workers.map((w) => {
    const wLocks = locksByHolder.get(w.id) || []
    let status: FleetWorkerView["status"] = "idle"
    if (w.paused) status = "paused"
    else if (wLocks.length > 0) status = "holding_tabs"
    return {
      id: w.id,
      alias: w.alias,
      worker_role_label: w.worker_role_label,
      parent_thread_id: w.parent_thread_id,
      orchestrator_run_id: w.orchestrator_run_id,
      agent_role: w.agent_role,
      paused: !!w.paused,
      status,
      tab_locks: wLocks.map((l) => ({
        tab_id: l.tab_id,
        state: l.state,
        lease_expires_at: l.lease_expires_at,
      })),
    }
  })

  let worst: FleetSnapshot["worst_status"] = "none"
  if (views.some((v) => v.status === "holding_tabs")) worst = "holding_tabs"
  else if (views.some((v) => v.status === "paused")) worst = "paused"
  else if (views.length > 0) worst = "idle"

  const runs = [
    ...new Set(
      views
        .map((v) => v.orchestrator_run_id)
        .filter((x): x is string => typeof x === "string" && x.length > 0),
    ),
  ]

  return {
    type: "fleet.status",
    at: new Date().toISOString(),
    workers: views,
    locks,
    worker_count: views.filter((v) => v.agent_role === "worker").length,
    lock_count: locks.length,
    worst_status: worst,
    orchestrator_runs: runs,
  }
}

export function workersForRun(tm: ThreadManager, runId: string) {
  return listWorkers(tm, runId)
}
