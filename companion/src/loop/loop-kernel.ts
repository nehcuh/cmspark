// L-2 (#388) loop kernel — explicit activation + nextRun.source=loop continuation
// + budget/breakers + checkpoint resume.
// Design basis: .omx/artifacts/loop-rethink-20260906/FINAL-SYNTHESIS.md §分歧 1/4 + L-2.
//
// RED LINES enforced here:
// - Unactivated === zero behavior change: no loop_state write, no nextRun, no
//   run-level semantic change (100-round cap / failure breakers untouched).
//   The only unactivated emission is the non-blocking suggestion card
//   (task_loop.suggest) — discovery, not behavior (FINAL-SYNTHESIS 分歧 1).
// - Completion is NEVER model prose self-assessment: the verdict comes from
//   #387's evaluateCompletion (all evidence-tick ∧ closing turn no tool_calls);
//   the kernel passes no claim, so only machine evidence can complete a loop.
// - STOPPED_USER / HALT_SECURITY never auto-continue; re-arm is an explicit
//   gesture only (task_loop.arm with user_gesture:true).
// - Workers never loop; an orchestrator's loop yields while any of its
//   workers has an active run.
// - No capability is auto-enabled: the continuation is a plain steer text into
//   the same chat pipeline (same tools, same L2/confirm algebra).
// - Audit family (capability-audit.jsonl, no bodies): task_loop.start /
//   run_scheduled / completed / stopped (state stops) / paused (run not
//   continued, loop stays armed) / worker_yield.
// - Completion close is MACHINE-TIER (see the evaluateCompletion call site):
//   the default-tier claim layer is carried by L-4 (#390).

import type { ThreadManager } from "../threads/thread-manager"
import type { RunProgressItem } from "../threads/run-progress"
import { evidenceItems, evaluateCompletion } from "./completion-predicate"
import { enqueueNextRun, peekNextRun, takeNextRun, dropLoopNextRuns } from "../llm/run-queues"
import { appendCapabilityAudit, type CapabilityAuditEvent } from "../packs/audit-log"
import { logger } from "../logger"
import {
  LOOP_BUDGET,
  loopBudgetExceeded,
  sanitizeLoopState,
  type LoopArmSource,
  type LoopPauseReason,
  type LoopState,
  type RunStats,
} from "./loop-state"
import {
  UNATTENDED_REVIEW_COPY,
  buildEvidenceDigest,
  buildKeyList,
  getBlockedItemIds,
  presentBlockedReport,
  resetDenyStorm,
} from "./unattended-overlay"
import { getUnattendedStatus } from "../computer/unattended-grant"

export { sanitizeLoopState, loopBudgetExceeded, LOOP_BUDGET } from "./loop-state"
export type {
  LoopState,
  LoopArmSource,
  LoopStatus,
  LoopPauseReason,
  RunStats,
  RunTerminal,
} from "./loop-state"

type AuditSink = (e: CapabilityAuditEvent) => void

/** Event payload without the timestamp — audit() stamps `at` on every event. */
type AuditPayload = { type: string; at?: string; [key: string]: unknown }

function defaultAudit(e: CapabilityAuditEvent): void {
  appendCapabilityAudit(e)
}

function audit(sink: AuditSink | undefined, e: AuditPayload): void {
  ;(sink ?? defaultAudit)({ ...e, at: e.at ?? new Date().toISOString() } as CapabilityAuditEvent)
}

/** Model-facing steer for a continuation run: points straight at the stuck items. */
export function buildContinuationSteer(unticked: RunProgressItem[]): string {
  const lines = unticked
    .slice(0, 8)
    .map((it) => `- [${it.id}] ${it.text}`)
    .join("\n")
  const head = unticked.length > 0
    ? `清单还有 ${unticked.length} 项未完成（evidence tick 未落下），继续执行，不要停下来汇报进度：\n${lines}`
    : "上一轮收口时仍有未完结的工具调用，继续把清单执行完，不要停下来汇报进度。"
  return (
    `${head}\n` +
    "每一项用对应工具拿到真实结果后才算完成（工具结果会自动勾选）；全部勾完后用一段话陈述每项的完成情况与证据。"
  )
}

/** Model-facing steer for the first continuation when tools ran without a live plan. */
export const PROPOSE_REQUEST_STEER =
  "先调用 run_progress_propose 提出剩余事项的清单（1–8 条，每条可绑定对应工具），然后再继续执行。"

/**
 * Entry ②: explicit command detection — "持续做完直至完成或无法完成" intent.
 * Conservative phrase list; false negatives are fine (the other two entrances
 * and the suggestion card remain), false positives are what we must avoid.
 */
const LOOP_INTENT_PATTERNS: RegExp[] = [
  /持续做完/,
  /一直做完/,
  /做到(?:全部)?(?:完成|做完)为止/,
  /做完为止/,
  /直到(?:全部|所有|任务|清单)?(?:都)?(?:完成|做完|搞定)/,
  /直至(?:完成|做完)/,
  /自己(?:把它|把这些|把任务)?(?:全部|都)?做完/,
  /不用问我[，,]?\s*(?:自己)?继续/,
  /keep going until (?:it's |it is |everything is |all is )?(?:done|complete|finished)/i,
  /continue until (?:it's |it is |everything is |all is )?(?:done|complete|finished)/i,
  /don't stop until (?:it's |it is |everything is |all is )?(?:done|complete|finished)/i,
  /do not stop until (?:it's |it is |everything is |all is )?(?:done|complete|finished)/i,
]

export function detectLoopIntent(message: unknown): boolean {
  if (typeof message !== "string") return false
  const text = message.trim()
  if (!text) return false
  return LOOP_INTENT_PATTERNS.some((re) => re.test(text))
}

export type ArmLoopOpts = {
  /** Wall-clock 60min when the unattended grant is armed, else 30min. */
  unattended?: boolean
  /** STOPPED_BUDGET checkpoint resume: fresh budget window, progress kept. */
  resume?: boolean
  nowMs?: number
  audit?: AuditSink
}

/**
 * Arm (or explicitly re-arm) the loop on a thread. This is the ONLY writer of
 * an active loop_state — callers must be one of the three explicit entrances
 * or the suggestion-card gesture. Returns the persisted state, or null when
 * the thread is missing or is a worker (workers never loop, FINAL-SYNTHESIS §1).
 */
export function armLoop(
  tm: ThreadManager,
  threadId: string,
  source: LoopArmSource,
  opts?: ArmLoopOpts,
): LoopState | null {
  const thread = tm.get(threadId)
  if (!thread || thread.agent_role === "worker") return null
  // L-4 (#390) plan_readonly=loop_off 强制：#327 计划线程工具面被硬拒，
  // loop 在此线程永不激活（armLoop 是唯一写入方=单一收口）。计划批准
  // （execution_policy plan_readonly→default）先改策略再 arm，不受影响。
  if (thread.execution_policy === "plan_readonly") {
    audit(opts?.audit, {
      type: "task_loop.arm_denied",
      thread_id: threadId,
      reason: "plan_readonly",
      armed_by: source,
    })
    return null
  }
  const now = opts?.nowMs ?? Date.now()
  const prev = sanitizeLoopState(thread.loop_state)
  const state: LoopState = {
    status: "active",
    armed_by: source,
    armed_at: new Date(now).toISOString(),
    started_at_ms: now,
    wall_clock_ms: opts?.unattended
      ? LOOP_BUDGET.wallClockUnattendedMs
      : LOOP_BUDGET.wallClockAttendedMs,
    runs_used: 0,
    tokens_used: 0,
    run_tokens: [],
    // A checklist the model was asked to propose stays requested across a
    // budget resume; a fresh arm re-allows one propose request.
    ...(opts?.resume && prev?.propose_requested ? { propose_requested: true } : {}),
    ...(opts?.unattended ? { unattended: true as const } : {}),
    ...(opts?.unattended
      ? (() => {
          const exp = getUnattendedStatus(now).expiresAt
          return typeof exp === "number" ? { grant_expires_at_ms: exp } : {}
        })()
      : {}),
  }
  resetDenyStorm(threadId)
  tm.update(threadId, { loop_state: state } as any)
  audit(opts?.audit, {
    type: "task_loop.start",
    thread_id: threadId,
    armed_by: source,
    resume: opts?.resume === true,
    unattended: opts?.unattended === true,
    wall_clock_ms: state.wall_clock_ms,
  })
  return state
}

/**
 * User stop (chat.abort / worker.pause / fleet.stop_all / task_loop.stop):
 * mark STOPPED_USER — re-arm must be an explicit gesture; nothing in the
 * kernel revives a user-stopped loop (#307 discipline, L-2 acceptance).
 * No-op for threads without an active loop (incl. all workers).
 */
export function markLoopStoppedByUser(
  tm: ThreadManager,
  threadId: string,
  reason: string,
  opts?: { audit?: AuditSink },
): boolean {
  const state = sanitizeLoopState(tm.get(threadId)?.loop_state)
  if (!state || state.status !== "active") return false
  const dropped = dropLoopNextRuns(threadId)
  tm.update(threadId, { loop_state: { ...state, status: "stopped_user" } } as any)
  audit(opts?.audit, {
    type: "task_loop.stopped",
    thread_id: threadId,
    reason: "user",
    stop_reason: reason,
    runs_used: state.runs_used,
    dropped_next_run: dropped,
  })
  return true
}

/**
 * L-5: grant TTL / deny-storm pause. Recoverable via explicit re-arm.
 * Does not extend grant TTL. Not silent impossible.
 */
export function markLoopPaused(
  tm: ThreadManager,
  threadId: string,
  reason: LoopPauseReason,
  opts?: { audit?: AuditSink; nowMs?: number },
): boolean {
  const state = sanitizeLoopState(tm.get(threadId)?.loop_state)
  if (!state || state.status !== "active") return false
  const dropped = dropLoopNextRuns(threadId)
  persist(tm, threadId, { ...state, status: "paused", pause_reason: reason })
  audit(opts?.audit, {
    type: "task_loop.paused",
    thread_id: threadId,
    reason,
    state_paused: true,
    runs_used: state.runs_used,
    dropped_next_run: dropped,
  })
  return true
}

/** Pause every active unattended loop (grant TTL expire). */
export function pauseUnattendedLoopsOnGrantExpire(
  tm: ThreadManager,
  opts?: { audit?: AuditSink },
): number {
  let n = 0
  for (const thread of tm.list()) {
    const st = sanitizeLoopState(thread.loop_state)
    if (st?.status === "active" && st.unattended === true) {
      if (markLoopPaused(tm, thread.id, "grant_ttl", opts)) n++
    }
  }
  return n
}

function persist(tm: ThreadManager, threadId: string, state: LoopState): void {
  tm.update(threadId, { loop_state: state } as any)
}

function untickedEvidence(progress: unknown): RunProgressItem[] {
  return evidenceItems(progress as any).filter((it) => it.done !== true)
}

export type LoopExitCheckArgs = {
  threadManager: ThreadManager
  threadId: string
  stats: RunStats
  nowMs?: number
  /** Orchestrator yield: true while any worker of this thread's run is active. */
  hasActiveWorker?: () => boolean
  /** Suggestion card channel (WS push); loop frames are never emitted without it. */
  sendToExtension?: (data: any) => void
  audit?: AuditSink
}

/**
 * Adapter-finally exit check (invoked from the router's run-finally seam,
 * right after the adapter's own finally converts leftover steers and before
 * the nextRun drain):
 *
 *   unticked non-draft items ∧ non-terminal run → enqueueNextRun(loop)
 *
 * No activation / budget exhausted → nothing is released. Pure Q&A runs
 * (0 tool calls) never continue. Tools-without-plan asks for a propose once.
 */
export function onLoopRunFinished(args: LoopExitCheckArgs): void {
  const { threadManager: tm, threadId, stats } = args
  const thread = tm.get(threadId)
  if (!thread || thread.agent_role === "worker") return
  const now = args.nowMs ?? Date.now()
  const state = sanitizeLoopState(thread.loop_state)

  // L-5: grant TTL expire → paused (not silent impossible). Loop never
  // extends the grant; re-arm is an explicit gesture after the user re-grants.
  // Only fire when we snapshotted a live grant at arm — missing grant is not TTL.
  if (
    state?.status === "active" &&
    typeof state.grant_expires_at_ms === "number" &&
    now > state.grant_expires_at_ms
  ) {
    markLoopPaused(tm, threadId, "grant_ttl", { audit: args.audit, nowMs: now })
    return
  }

  if (state?.status === "active") {
    // Terminal outcomes first.
    if (stats.terminal === "security_halt") {
      // HALT_SECURITY: never auto-continue (confirmation algebra / L2 untouched).
      persist(tm, threadId, { ...state, status: "halt_security" })
      audit(args.audit, {
        type: "task_loop.stopped",
        thread_id: threadId,
        reason: "security",
        runs_used: state.runs_used,
      })
      return
    }
    if (stats.terminal === "aborted") {
      // The abort path (markLoopStoppedByUser) owns the state transition.
      return
    }
    if (stats.terminal === "circuit_breaker" || stats.terminal === "error") {
      // Run-level breakers (100 rounds / failure limits) keep their semantics:
      // no auto-continue. The loop stays armed — a user-driven run resumes it.
      // Event is `paused`, not `stopped`: the loop STATE did not stop (NIT-2 —
      // replay must distinguish "this run not continued" from a state stop).
      audit(args.audit, {
        type: "task_loop.paused",
        thread_id: threadId,
        reason: stats.terminal,
        runs_used: state.runs_used,
      })
      return
    }
  } else {
    // Unactivated / completed / deliberately stopped: zero continuation. The
    // only emission is the non-blocking suggestion card (discovery — FINAL-
    // SYNTHESIS 分歧 1). STOPPED_USER/HALT_SECURITY: no card (user/security
    // already spoke); STOPPED_BUDGET: card click == explicit resume gesture.
    if (
      !stats.terminal &&
      stats.toolCalls >= 1 &&
      state?.status !== "stopped_user" &&
      state?.status !== "halt_security"
    ) {
      const unticked = untickedEvidence(thread.run_progress)
      if (unticked.length > 0) {
        args.sendToExtension?.({
          type: "task_loop.suggest",
          thread_id: threadId,
          unticked: unticked.map((it) => ({ id: it.id, text: it.text })),
          budget_stopped: state?.status === "stopped_budget" || undefined,
        })
      }
    }
    return
  }

  // Token accounting (provider usage; 0 when unreported — no fake metering).
  let next: LoopState = state
  if (stats.totalTokens > 0) {
    next = {
      ...next,
      tokens_used: next.tokens_used + stats.totalTokens,
      run_tokens: [...next.run_tokens, stats.totalTokens].slice(-LOOP_BUDGET.tokenSamples),
    }
  }

  // Budget gate: 预算尽不放行 (STOPPED_BUDGET, checkpoint-resumable).
  const hit = loopBudgetExceeded(next, now)
  if (hit) {
    persist(tm, threadId, { ...next, status: "stopped_budget", budget_stop: hit })
    audit(args.audit, {
      type: "task_loop.stopped",
      thread_id: threadId,
      reason: "budget",
      dimension: hit,
      runs_used: next.runs_used,
      tokens_used: next.tokens_used,
    })
    return
  }

  // Eligibility: pure Q&A (0 tool calls this run) never continues. Loop stays
  // armed (task_loop.paused, not stopped — NIT-2).
  if (stats.toolCalls < 1) {
    audit(args.audit, {
      type: "task_loop.paused",
      thread_id: threadId,
      reason: "no_tool_calls",
      runs_used: next.runs_used,
    })
    return
  }

  // Worker yield: an orchestrator's loop lets active workers run first.
  // Audited (NIT-3) — replay must show WHY an armed loop did not continue.
  if (args.hasActiveWorker?.()) {
    logger.info("task_loop.worker_yield", { thread_id: threadId })
    audit(args.audit, {
      type: "task_loop.worker_yield",
      thread_id: threadId,
      runs_used: next.runs_used,
    })
    return
  }

  const progress = thread.run_progress
  const items = evidenceItems(progress)
  const blockedIds = new Set(getBlockedItemIds(threadId))
  const chaseable = items.filter((it) => it.done !== true && !blockedIds.has(it.id))

  if (items.length === 0) {
    if (progress === null) {
      // Sticky user clear — never push a propose against it. Loop stays armed
      // (task_loop.paused, not stopped — NIT-2).
      audit(args.audit, {
        type: "task_loop.paused",
        thread_id: threadId,
        reason: "no_checklist",
        runs_used: next.runs_used,
      })
      return
    }
    if (!next.propose_requested) {
      // Tools ran but no live plan: the first continuation asks the model to
      // propose the checklist (predicate bootstrap, FINAL-SYNTHESIS 分歧 4).
      // NIT-1: enqueue FIRST — a full queue must not produce a runs_used
      // increment / run_scheduled audit for a continuation that never happened.
      if (!enqueueNextRun(threadId, PROPOSE_REQUEST_STEER, undefined, "loop")) {
        logger.warn("task_loop.enqueue_failed", {
          thread_id: threadId,
          kind: "propose_request",
          queue_max: "MAX_NEXT_RUN",
        })
        return
      }
      next = { ...next, propose_requested: true, runs_used: next.runs_used + 1 }
      persist(tm, threadId, next)
      audit(args.audit, {
        type: "task_loop.run_scheduled",
        thread_id: threadId,
        kind: "propose_request",
        runs_used: next.runs_used,
      })
      return
    }
    // Model never proposed: no machine-verifiable progress to chase.
    persist(tm, threadId, { ...next, status: "stopped_no_checklist" })
    audit(args.audit, {
      type: "task_loop.stopped",
      thread_id: threadId,
      reason: "no_checklist",
      runs_used: next.runs_used,
    })
    return
  }

  // Completion is machine-checked only (#387 predicate). The kernel NEVER
  // passes a claim (model prose self-assessment can never complete a loop),
  // so the verdict here is MACHINE-TIER by construction: `complete` is
  // unreachable (it requires claim ⊆ tick) and all-ticked always lands on
  // `request-claim`. We close that as machine-tier completion and say so in
  // the audit (`tier:"machine"`).
  //
  // The DEFAULT-tier semantic layer — claim ⊆ tick cross-check, the
  // request-claim statement round, and the "任务完成"-wording ban (FINAL-
  // SYNTHESIS 分歧 3) — is explicitly OUT of kernel scope and is carried by
  // L-4 (#390, tier binding + UI). The unattended tier's「计划完成待复核」
  // wording + evidence digest is L-5 (#391). Do not "upgrade" this close to
  // full completion semantics here.
  const closeUnattended = next.unattended === true && chaseable.length === 0 && items.length > 0
  const verdict = evaluateCompletion({
    runProgress: progress,
    closingTurnToolCalls: stats.closingTurnToolCalls,
    pendingConfirms: 0,
  })
  if (closeUnattended || verdict.kind === "complete" || verdict.kind === "request-claim") {
    persist(tm, threadId, { ...next, status: "completed" })
    const keyList = buildKeyList(threadId)
    if (next.unattended === true) {
      const digest = buildEvidenceDigest({
        runProgress: progress,
        blockedIds: [...blockedIds],
        runsUsed: next.runs_used,
        tokensUsed: next.tokens_used,
      })
      audit(args.audit, {
        type: "task_loop.completed",
        thread_id: threadId,
        tier: "unattended",
        copy: UNATTENDED_REVIEW_COPY,
        digest,
        key_list: keyList,
        ticked_ids: digest.ticked_ids,
        runs_used: next.runs_used,
        tokens_used: next.tokens_used,
      })
      if (keyList.length > 0) {
        presentBlockedReport({
          threadId,
          keyList,
          sendToExtension: args.sendToExtension,
          copy: UNATTENDED_REVIEW_COPY,
        })
      }
    } else {
      audit(args.audit, {
        type: "task_loop.completed",
        thread_id: threadId,
        tier: "machine",
        ticked_ids:
          verdict.kind === "complete" || verdict.kind === "request-claim" ? verdict.tickedIds : [],
        runs_used: next.runs_used,
        tokens_used: next.tokens_used,
      })
    }
    return
  }

  // incomplete (claim-rejected never occurs here — the kernel passes no
  // claim): schedule the next step, steer pointing straight at the stuck items.
  // NIT-1: enqueue FIRST (see propose path). Blocked items are skipped (L-5
  // deny→blocked→bypass): the steer names remaining chaseable items only.
  const unticked = chaseable
  if (!enqueueNextRun(threadId, buildContinuationSteer(unticked), undefined, "loop")) {
    logger.warn("task_loop.enqueue_failed", {
      thread_id: threadId,
      kind: "continue",
      queue_max: "MAX_NEXT_RUN",
    })
    return
  }
  next = { ...next, runs_used: next.runs_used + 1 }
  persist(tm, threadId, next)
  audit(args.audit, {
    type: "task_loop.run_scheduled",
    thread_id: threadId,
    kind: "continue",
    runs_used: next.runs_used,
    unticked_ids: unticked.map((it) => it.id),
  })
}

/**
 * Drain gate (router, before takeNextRun): loop-sourced entries drain only
 * while the loop is still active AND within budget — loop 未激活不放行、预算尽
 * 不放行. Stale loop entries are dropped, never drained; user entries are
 * left untouched. A budget hit discovered here lands STOPPED_BUDGET the same
 * as the exit-check path (checkpoint-resumable).
 */
export function gateLoopNextRunDrain(
  threadId: string,
  tm: ThreadManager,
  opts?: { nowMs?: number; audit?: AuditSink },
): void {
  for (;;) {
    const head = peekNextRun(threadId)
    if (!head || (head.source ?? "user") !== "loop") return
    const state = sanitizeLoopState(tm.get(threadId)?.loop_state)
    if (state?.status === "active") {
      const now = opts?.nowMs ?? Date.now()
      if (typeof state.grant_expires_at_ms === "number" && now > state.grant_expires_at_ms) {
        markLoopPaused(tm, threadId, "grant_ttl", { audit: opts?.audit, nowMs: now })
        takeNextRun(threadId)
        continue
      }
      const hit = loopBudgetExceeded(state, now)
      if (!hit) return // loop active and within budget: release
      persist(tm, threadId, { ...state, status: "stopped_budget", budget_stop: hit })
      audit(opts?.audit, {
        type: "task_loop.stopped",
        thread_id: threadId,
        reason: "budget",
        dimension: hit,
        runs_used: state.runs_used,
        tokens_used: state.tokens_used,
        at_drain: true,
      })
    }
    // Not active (user stop / halt / completed / no_checklist) or budget
    // exhausted: drop this loop entry, never drain it.
    takeNextRun(threadId)
  }
}

/**
 * Kickoff steer for an explicit arm (task_loop.arm / suggestion-card click):
 * continue straight at the unticked items. Returns null when there is no
 * machine-verifiable remainder — the loop then arms silently and the next
 * run's exit check drives (incl. the propose-request bootstrap).
 */
export function buildLoopKickoff(tm: ThreadManager, threadId: string): string | null {
  const unticked = untickedEvidence(tm.get(threadId)?.run_progress)
  if (unticked.length === 0) return null
  return buildContinuationSteer(unticked)
}
