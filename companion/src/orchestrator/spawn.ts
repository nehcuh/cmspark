// Spawn worker threads under an orchestrator — ADR-015 §1–2

import { randomUUID } from "crypto"
import type { ThreadManager } from "../threads/thread-manager"
import {
  ORCHESTRATOR_CAPS,
  ORCHESTRATOR_TOOL_ALLOWLIST,
  WORKER_HARD_DENY,
  type AgentRole,
} from "./constants"
import { appendCapabilityAudit } from "../packs/audit-log"

export function computeWorkerWhitelist(opts: {
  parentWhitelist: string[] | null
  roleAllow: string[] | null
  roleDeny?: string[]
}): string[] {
  let base: string[]
  if (opts.roleAllow && opts.roleAllow.length > 0) {
    if (opts.parentWhitelist === null) {
      base = [...opts.roleAllow]
    } else {
      const parentSet = new Set(opts.parentWhitelist)
      base = opts.roleAllow.filter((t) => parentSet.has(t))
    }
  } else if (opts.parentWhitelist !== null) {
    base = [...opts.parentWhitelist]
  } else {
    // Must be non-null for workers — fall back to safe browser-read set
    base = [
      "list_tabs",
      "screenshot",
      "get_page_text",
      "get_page_html",
      "get_element_info",
      "click",
      "type",
      "navigate",
      "scroll",
      "wait_for",
      "evaluate",
      "create_tab",
      "close_tab",
    ]
  }
  const deny = new Set([...(opts.roleDeny || []), ...WORKER_HARD_DENY])
  return base.filter((t) => !deny.has(t))
}

export function countWorkersInRun(tm: ThreadManager, orchestratorRunId: string): number {
  return tm.list().filter((t: any) => t.orchestrator_run_id === orchestratorRunId && t.agent_role === "worker").length
}

export function ensureOrchestratorRunId(thread: any): string {
  if (thread.orchestrator_run_id && typeof thread.orchestrator_run_id === "string") {
    return thread.orchestrator_run_id
  }
  return `orun_${randomUUID()}`
}

export type SpawnWorkerResult =
  | { ok: true; worker: any; orchestrator_run_id: string }
  | { ok: false; error: string }

/**
 * Create a child worker thread under parent. Caller must have already obtained user confirmation.
 */
export function spawnWorkerThread(
  tm: ThreadManager,
  opts: {
    parentThreadId: string
    roleLabel?: string
    alias?: string
    roleAllow?: string[] | null
    roleDeny?: string[]
    packId?: string | null
    userConfirmed: boolean
  },
): SpawnWorkerResult {
  if (!opts.userConfirmed) {
    return { ok: false, error: "spawn_worker requires userConfirmed=true (user must approve spawn)" }
  }
  const parent = tm.get(opts.parentThreadId) as any
  if (!parent) return { ok: false, error: `parent thread not found: ${opts.parentThreadId}` }

  const runId = ensureOrchestratorRunId(parent)
  // Promote parent to orchestrator if needed
  if (parent.agent_role !== "orchestrator") {
    tm.update(opts.parentThreadId, {
      agent_role: "orchestrator" as AgentRole,
      orchestrator_run_id: runId,
      tool_whitelist:
        parent.tool_whitelist === null
          ? [...ORCHESTRATOR_TOOL_ALLOWLIST]
          : parent.tool_whitelist,
    } as any)
  } else if (!parent.orchestrator_run_id) {
    tm.update(opts.parentThreadId, { orchestrator_run_id: runId } as any)
  }

  const workerCount = countWorkersInRun(tm, runId)
  if (workerCount >= ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run) {
    return {
      ok: false,
      error: `max_workers_per_orchestrator_run (${ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run}) reached`,
    }
  }

  const refreshedParent = tm.get(opts.parentThreadId) as any
  const whitelist = computeWorkerWhitelist({
    parentWhitelist: refreshedParent?.tool_whitelist ?? null,
    roleAllow: opts.roleAllow ?? null,
    roleDeny: opts.roleDeny,
  })
  if (whitelist.length === 0) {
    return { ok: false, error: "effective worker tool_whitelist is empty after HARD_DENY" }
  }

  const worker = tm.create(opts.alias || `worker:${opts.roleLabel || "task"}`)
  tm.update(worker.id, {
    parent_thread_id: opts.parentThreadId,
    orchestrator_run_id: runId,
    worker_role_label: opts.roleLabel || "worker",
    agent_role: "worker" as AgentRole,
    tool_whitelist: whitelist,
    mission_pack_id: opts.packId ?? null,
    config_override: {
      ...(worker.config_override || {}),
      system_prompt_append: [
        `You are a worker agent (role=${opts.roleLabel || "worker"}).`,
        `Parent orchestrator thread: ${opts.parentThreadId}.`,
        `Always pass explicit numeric tabId for browser tools. Never assume active tab.`,
        `When done, summarize results for the orchestrator; do not spawn further workers.`,
      ].join(" "),
    },
  } as any)

  const full = tm.get(worker.id)
  appendCapabilityAudit({
    type: "orchestrator.spawn_worker",
    at: new Date().toISOString(),
    parent_thread_id: opts.parentThreadId,
    worker_id: worker.id,
    orchestrator_run_id: runId,
    role_label: opts.roleLabel || "worker",
    tool_whitelist: whitelist,
  })

  return { ok: true, worker: full, orchestrator_run_id: runId }
}

export function listWorkers(tm: ThreadManager, orchestratorRunId: string): any[] {
  return tm.list().filter(
    (t: any) => t.orchestrator_run_id === orchestratorRunId && t.agent_role === "worker",
  )
}

export function isMultiAgentThread(thread: any | null | undefined): boolean {
  if (!thread) return false
  return (
    thread.agent_role === "worker" ||
    thread.agent_role === "orchestrator" ||
    !!thread.parent_thread_id ||
    !!thread.orchestrator_run_id
  )
}
