import type { ThreadManager } from "../threads/thread-manager"
import { acpTaskResult, recoveryForTaskStatus, type CooperationResult, type CooperationStatus } from "./cooperation-result"
import type { AcpSessionRecord } from "../acp/types"

export type CooperationTaskRecord = { result: CooperationResult; observed_at: string; failure_versions: string[] }
export const COOPERATION_TASK_CAP = 64

/** Internal runtime snapshot only; never grants execution or restarts a process. */
export function recordCooperationResult(tm: ThreadManager, ownerId: string, result: CooperationResult): CooperationResult {
  const parent = tm.get(ownerId)
  if (!parent || parent.agent_role === "worker" || result.owner_thread_id !== ownerId) throw new Error("cooperation result owner mismatch")
  if (result.schema_version !== 1 || !/^(browser|acp):/.test(result.task_id) || JSON.stringify(result).length > 16000) throw new Error("invalid cooperation result")
  if (result.executor === "browser" && result.run_id !== (parent.orchestrator_run_id ?? null)) throw new Error("cooperation run mismatch")
  const entries = new Map(Object.entries(parent.cooperation_tasks ?? {}))
  const previous = entries.get(result.task_id)
  if (previous?.result.source.version === result.source.version && previous.result.status === result.status) return previous.result
  const failureVersions = result.status === "completed" ? [] : [...(previous?.failure_versions ?? [])]
  if (["failed", "partial"].includes(result.status) && !failureVersions.includes(result.source.version)) failureVersions.push(result.source.version)
  const bounded = { ...result, recovery: recoveryForTaskStatus(result.status, failureVersions.length) }
  if (result.recovery.action === "recollect") bounded.recovery = { ...bounded.recovery, action: "recollect", requires_confirmation: false }
  entries.delete(result.task_id)
  entries.set(result.task_id, { result: bounded, observed_at: new Date().toISOString(), failure_versions: failureVersions.slice(-2) })
  // Old browser fan-outs are outside the current run; keep ACP summaries for this owner.
  for (const [id, task] of entries) if (task.result.executor === "browser" && task.result.run_id !== (parent.orchestrator_run_id ?? null)) entries.delete(id)
  while (entries.size > COOPERATION_TASK_CAP) entries.delete(entries.keys().next().value!)
  tm.update(ownerId, { cooperation_tasks: Object.fromEntries(entries) })
  return bounded
}

export function cooperationSnapshot(tm: ThreadManager, ownerId: string, opts?: { liveSessionIds?: string[]; acpSessions?: AcpSessionRecord[]; isActive?: (id: string) => boolean }) {
  const parent = tm.get(ownerId)
  const live = new Set(opts?.liveSessionIds ?? [])
  const sessions = new Map(opts?.acpSessions?.filter(s => s.thread_id === ownerId).map(s => [s.session_id, s]))
  const tasks = Object.values(parent?.cooperation_tasks ?? {}).map(({ result, observed_at, failure_versions }) => {
    let current = result
    let status: CooperationStatus = result.status
    if (result.executor === "acp") {
      const session = sessions.get(result.source.session_id ?? "")
      if (session) { current = acpTaskResult(session); status = current.status }
      else if (["ready", "running"].includes(status) && !live.has(result.source.session_id ?? "")) status = "stale"
    } else {
      const worker = tm.get(result.source.thread_id)
      if (!worker || worker.parent_thread_id !== ownerId || worker.orchestrator_run_id !== result.run_id || result.run_id !== parent?.orchestrator_run_id) status = "stale"
      else if (worker.paused) status = "paused"
      else if (opts?.isActive?.(worker.id)) status = "running"
      else {
        const prefix = `${worker.last_run_ended_at ?? "not_started"}:${worker.last_run_terminal ?? "normal"}:${!!worker.paused}:`
        if (!result.source.version.startsWith(prefix) || status === "running") status = "stale"
      }
    }
    return { ...current, status, observed_at,
      recovery: status === result.status && current.source.version === result.source.version ? result.recovery : recoveryForTaskStatus(status, failure_versions.length) }
  })
  return { schema_version: 1 as const, tasks, data_not_instruction: true as const }
}
