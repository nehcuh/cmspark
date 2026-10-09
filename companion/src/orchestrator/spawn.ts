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
import { workerCapUsage } from "./worker-occupancy"

/** Orchestrator control tools are not the capability surface inherited by workers. */
export function workerParentCapabilityWhitelist(parent: {
  agent_role?: string | null
  tool_whitelist?: string[] | null
} | null | undefined): string[] | null {
  return parent?.agent_role === "orchestrator" || !Array.isArray(parent?.tool_whitelist)
    ? null
    : [...parent.tool_whitelist]
}

export function computeWorkerWhitelist(opts: {
  parentWhitelist: string[] | null
  roleAllow: string[] | null
  roleDeny?: string[]
}): string[] {
  let base: string[]
  if (opts.roleAllow != null) {
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

export type ParentPromotionSnapshot = {
  agent_role: AgentRole
  tool_whitelist: string[] | null
  orchestrator_run_id: string | null
}

export type SpawnWorkerResult =
  | { ok: true; worker: any; orchestrator_run_id: string; parent_before_promotion: ParentPromotionSnapshot | null }
  | { ok: false; error: string }

/**
 * #292: undo the parent promotion when a post-create step (pack apply /
 * intent claim) failed and the worker was deleted — the parent must not
 * stay narrowed to ORCHESTRATOR_TOOL_ALLOWLIST over a spawn that never
 * happened. No-op when nothing was promoted.
 */
export function restoreParentAfterFailedSpawn(
  tm: ThreadManager,
  parentThreadId: string,
  snapshot: ParentPromotionSnapshot | null,
): void {
  if (!snapshot) return
  try {
    tm.update(parentThreadId, {
      agent_role: snapshot.agent_role,
      tool_whitelist: snapshot.tool_whitelist,
      orchestrator_run_id: snapshot.orchestrator_run_id,
    } as any)
  } catch {
    /* best-effort rollback */
  }
}

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
    /** ADR-016 Stage 3: bind worker to a board intent (claimed after create). */
    intentId?: string | null
    /**
     * #578: 活性谓词（三源并集）——执行闸必须注入（dispatch / expert-team），
     * 缺省退化为纯字段判定只对测试/advisory 可接受。
     */
    isActive?: (threadId: string) => boolean
  },
): SpawnWorkerResult {
  if (!opts.userConfirmed) {
    return { ok: false, error: "spawn_worker requires userConfirmed=true (user must approve spawn)" }
  }
  const parent = tm.get(opts.parentThreadId) as any
  if (!parent) return { ok: false, error: `parent thread not found: ${opts.parentThreadId}` }

  // Workers must not nest: only normal/orchestrator threads may spawn.
  if (parent.agent_role === "worker") {
    return {
      ok: false,
      error: "spawn_worker denied: worker threads cannot spawn nested workers",
    }
  }

  // Capture capability whitelist BEFORE orchestrator promotion.
  // Promotion writes ORCHESTRATOR_TOOL_ALLOWLIST onto null-parent threads; workers must
  // still be computed from the pre-promotion surface (null → roleAllow fully minus HARD_DENY).
  // ADR-015: effective = (parent ∩ role.allow) \ HARD_DENY with parent null → role.allow.
  //
  // After the parent is already an orchestrator, parent.tool_whitelist is the control
  // surface — do NOT inherit that onto workers. Treat orchestrator parent as null parent
  // capability so roleAllow (or the safe browser default) is the base, then HARD_DENY.
  const parentCapabilityWhitelist = workerParentCapabilityWhitelist(parent)

  const runId = ensureOrchestratorRunId(parent)

  // #292: everything that can fail is validated BEFORE the parent is
  // promoted — a failed spawn must leave the parent's tool surface
  // untouched (a normal thread keeps navigate/click, not just list_tabs).
  //
  // #578: 占名额口径（终局释放）——paused/在跑/新鲜未跑占，终局与逾期孤儿让位；
  // 外加单 run 累计创建上限（删除/回收站不退款，回滚硬删不计数）。
  const usage = workerCapUsage(tm, runId, { isActive: opts.isActive })
  if (usage.occupied >= ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run) {
    return {
      ok: false,
      error:
        `max_workers_per_orchestrator_run reached: worker slots full ` +
        `${usage.occupied}/${ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run} occupied ` +
        `(paused/running/pending), ` +
        `${usage.created}/${ORCHESTRATOR_CAPS.max_workers_created_per_run} created this run ` +
        `(trashed workers still count)`,
    }
  }
  if (usage.created >= ORCHESTRATOR_CAPS.max_workers_created_per_run) {
    return {
      ok: false,
      error:
        `worker creation cap reached: ${usage.created}/${ORCHESTRATOR_CAPS.max_workers_created_per_run} ` +
        `created this run — finished workers free slots but not the creation budget; ` +
        `start a new thread for a fresh run, or hard-delete workers (trash does not refund the budget)`,
    }
  }

  const whitelist = computeWorkerWhitelist({
    parentWhitelist: parentCapabilityWhitelist,
    roleAllow: opts.roleAllow ?? null,
    roleDeny: opts.roleDeny,
  })
  if (whitelist.length === 0) {
    return { ok: false, error: "effective worker tool_whitelist is empty after HARD_DENY" }
  }

  // Promote parent to orchestrator (orchestrator surface only — not worker input).
  // #292: snapshot the pre-promotion state so a later rollback (pack/intent
  // failure in the dispatcher deletes the worker) can restore it exactly.
  const snapshotWhitelist = (): string[] | null =>
    parent.tool_whitelist === null
      ? null
      : Array.isArray(parent.tool_whitelist)
        ? [...parent.tool_whitelist]
        : null
  let parentBeforePromotion: ParentPromotionSnapshot | null = null
  if (parent.agent_role !== "orchestrator") {
    parentBeforePromotion = {
      agent_role: (parent.agent_role || "normal") as AgentRole,
      tool_whitelist: snapshotWhitelist(),
      orchestrator_run_id: parent.orchestrator_run_id ?? null,
    }
    tm.update(opts.parentThreadId, {
      agent_role: "orchestrator" as AgentRole,
      orchestrator_run_id: runId,
      tool_whitelist:
        parent.tool_whitelist === null
          ? [...ORCHESTRATOR_TOOL_ALLOWLIST]
          : parent.tool_whitelist,
    } as any)
  } else if (!parent.orchestrator_run_id) {
    parentBeforePromotion = {
      agent_role: "orchestrator",
      tool_whitelist: snapshotWhitelist(),
      orchestrator_run_id: null,
    }
    tm.update(opts.parentThreadId, { orchestrator_run_id: runId } as any)
  }

  const intentId = opts.intentId && String(opts.intentId).trim() ? String(opts.intentId).trim() : null
  const worker = tm.create(opts.alias || `worker:${opts.roleLabel || "task"}`)
  const parentThread = tm.get(opts.parentThreadId)
  // #327: stamp a worker ONLY when the parent is currently plan_readonly.
  // Never stamp "default" — an unstamped worker live-follows the parent's
  // CURRENT policy at gate time (plan-readonly.ts parent fallback), so arming
  // plan mid-run also caps workers spawned earlier. A worker stamped plan
  // stays capped even if the parent exits plan (只收紧方向).
  const parentPlan = parentThread?.execution_policy === "plan_readonly"
  tm.update(worker.id, {
    parent_thread_id: opts.parentThreadId,
    orchestrator_run_id: runId,
    worker_role_label: opts.roleLabel || "worker",
    agent_role: "worker" as AgentRole,
    ...(parentPlan ? { execution_policy: "plan_readonly" as const } : {}),
    tool_whitelist: whitelist,
    mission_pack_id: opts.packId ?? null,
    assigned_intent_id: intentId,
    config_override: {
      ...(worker.config_override || {}),
      system_prompt_append: [
        `You are a worker agent (role=${opts.roleLabel || "worker"}).`,
        `Parent orchestrator thread: ${opts.parentThreadId}.`,
        intentId
          ? `You are bound to board intent_id=${intentId}. Explore only that intent; return structured handback (schema_version 1) with facts/intents.`
          : `When done, summarize results for the orchestrator; do not spawn further workers.`,
        `Always pass explicit numeric tabId for browser tools. Never assume active tab.`,
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
    intent_id: intentId,
  })

  return { ok: true, worker: full, orchestrator_run_id: runId, parent_before_promotion: parentBeforePromotion }
}

export function listWorkers(
  tm: ThreadManager,
  orchestratorRunId: string,
  opts: { includeTrashed?: boolean } = {},
): any[] {
  // 评审 F1：默认仍排除回收站（wait_workers / run-busy probe 等消费方不变）；
  // list_workers 诊断面显式传 includeTrashed——占名额 SoT 含 trashed 行
  // （G8b：trash 不释放占用、不退预算），诊断面必须能枚举到同一批行，
  // 否则「5/5 occupied」对模型不可对账。
  return tm
    .list(opts.includeTrashed ? { include_trashed: true } : undefined)
    .filter((t: any) => t.orchestrator_run_id === orchestratorRunId && t.agent_role === "worker")
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
