// Stage 3: Intent claim / heartbeat / reap — ADR-016 § multi-agent board

import type { ThreadManager } from "../threads/thread-manager"
import { ORCHESTRATOR_CAPS } from "../orchestrator/constants"
import {
  mutateMissionBoard,
  resolveBoardHostThreadId,
  isBoardHostThread,
} from "./service"
import type { Intent, MissionBoard } from "./schema"
import { appendCapabilityAudit } from "../packs/audit-log"

type ThreadLike = {
  id: string
  agent_role?: string | null
  parent_thread_id?: string | null
  mission_board?: MissionBoard | null
  [key: string]: unknown
}

/** Max open+claimed intents a single worker may hold. */
export const MAX_INTENTS_PER_WORKER = 3

/** Reap claimed intents with stale heartbeat (2 × idle_ttl). */
export function intentHeartbeatStaleMs(): number {
  return ORCHESTRATOR_CAPS.idle_ttl_ms * 2
}

function nowIso(): string {
  return new Date().toISOString()
}

function audit(type: string, extra: Record<string, unknown>): void {
  try {
    appendCapabilityAudit({ type, at: nowIso(), ...extra })
  } catch {
    /* best-effort */
  }
}

function countWorkerIntents(board: MissionBoard, workerId: string): number {
  return board.intents.filter(
    (i) =>
      i.claimed_by_worker_id === workerId &&
      (i.status === "open" || i.status === "claimed"),
  ).length
}

export type ClaimIntentResult =
  | { ok: true; intent: Intent; board: MissionBoard }
  | { ok: false; error: string; error_code: string }

/**
 * Claim an open intent for a worker on the host board.
 * Optionally create worker binding via thread.assigned_intent_id (caller).
 */
export async function claimIntent(
  tm: ThreadManager,
  opts: {
    hostThreadId: string
    intentId: string
    workerThreadId: string
  },
): Promise<ClaimIntentResult> {
  const host = tm.get(opts.hostThreadId) as ThreadLike | undefined
  if (!host || !isBoardHostThread(host)) {
    return { ok: false, error: "board host not found or not a host thread", error_code: "BOARD_HOST_INVALID" }
  }
  if (host.mission_board == null) {
    return { ok: false, error: "mission_board not initialized", error_code: "BOARD_MISSING" }
  }

  let claimed: Intent | null = null
  const result = await mutateMissionBoard(tm, opts.hostThreadId, (board) => {
    if (countWorkerIntents(board, opts.workerThreadId) >= MAX_INTENTS_PER_WORKER) {
      return {
        ok: false,
        error: `worker already holds ${MAX_INTENTS_PER_WORKER} intents`,
        error_code: "INTENT_CAP",
      }
    }
    const idx = board.intents.findIndex((i) => i.id === opts.intentId)
    if (idx < 0) {
      return { ok: false, error: `intent not found: ${opts.intentId}`, error_code: "INTENT_NOT_FOUND" }
    }
    const intent = board.intents[idx]
    if (intent.status === "done" || intent.status === "abandoned") {
      return { ok: false, error: `intent not claimable: ${intent.status}`, error_code: "INTENT_CLOSED" }
    }
    if (intent.status === "claimed" && intent.claimed_by_worker_id && intent.claimed_by_worker_id !== opts.workerThreadId) {
      return {
        ok: false,
        error: `intent claimed by ${intent.claimed_by_worker_id}`,
        error_code: "INTENT_BUSY",
      }
    }
    const now = nowIso()
    const next: Intent = {
      ...intent,
      status: "claimed",
      claimed_by_worker_id: opts.workerThreadId,
      heartbeat_at: now,
      updated_at: now,
    }
    const intents = [...board.intents]
    intents[idx] = next
    claimed = next
    audit("board.intent_claimed", {
      thread_id: opts.hostThreadId,
      intent_id: opts.intentId,
      worker_id: opts.workerThreadId,
    })
    return { ok: true, board: { ...board, intents, updated_at: now } }
  })

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      error_code: result.error_code || "CLAIM_FAILED",
    }
  }
  if (!claimed) {
    return { ok: false, error: "claim failed", error_code: "CLAIM_FAILED" }
  }
  return { ok: true, intent: claimed, board: result.board }
}

export async function heartbeatIntent(
  tm: ThreadManager,
  opts: { hostThreadId: string; intentId: string; workerThreadId: string },
): Promise<ClaimIntentResult> {
  let updated: Intent | null = null
  const result = await mutateMissionBoard(tm, opts.hostThreadId, (board) => {
    const idx = board.intents.findIndex((i) => i.id === opts.intentId)
    if (idx < 0) {
      return { ok: false, error: "intent not found", error_code: "INTENT_NOT_FOUND" }
    }
    const intent = board.intents[idx]
    if (intent.claimed_by_worker_id !== opts.workerThreadId || intent.status !== "claimed") {
      return { ok: false, error: "not holder of claimed intent", error_code: "INTENT_NOT_HOLDER" }
    }
    const now = nowIso()
    const next = { ...intent, heartbeat_at: now, updated_at: now }
    const intents = [...board.intents]
    intents[idx] = next
    updated = next
    return { ok: true, board: { ...board, intents, updated_at: now } }
  })
  if (!result.ok || !updated) {
    return {
      ok: false,
      error: !result.ok ? result.error : "heartbeat failed",
      error_code: !result.ok ? result.error_code || "HEARTBEAT_FAILED" : "HEARTBEAT_FAILED",
    }
  }
  return { ok: true, intent: updated, board: result.board }
}

/**
 * Reap stale claimed intents (no heartbeat within window) → abandoned.
 * Call from wait_workers / fleet.status / periodic.
 */
export async function reapStaleIntents(
  tm: ThreadManager,
  hostThreadId: string,
  opts?: { staleMs?: number },
): Promise<{ reaped: number }> {
  const staleMs = opts?.staleMs ?? intentHeartbeatStaleMs()
  const cutoff = Date.now() - staleMs
  let reaped = 0
  await mutateMissionBoard(tm, hostThreadId, (board) => {
    const now = nowIso()
    let count = 0
    const intents = board.intents.map((intent) => {
      if (intent.status !== "claimed") return intent
      const hb = intent.heartbeat_at ? Date.parse(intent.heartbeat_at) : 0
      if (!hb || hb < cutoff) {
        count++
        return {
          ...intent,
          status: "abandoned" as const,
          claimed_by_worker_id: null,
          heartbeat_at: null,
          updated_at: now,
        }
      }
      return intent
    })
    reaped = count
    if (count === 0) return { ok: true, board }
    audit("board.intents_reaped", {
      thread_id: hostThreadId,
      reaped_count: count,
      stale_ms: staleMs,
    })
    return { ok: true, board: { ...board, intents, updated_at: now } }
  })
  return { reaped }
}

/** Count open + claimed intents on host board (for FleetStrip). */
export function countOpenIntents(tm: ThreadManager, threadId: string): number {
  const hostId = resolveBoardHostThreadId(tm, threadId) || threadId
  const host = tm.get(hostId) as ThreadLike | undefined
  const board = host?.mission_board
  if (!board) return 0
  return board.intents.filter((i) => i.status === "open" || i.status === "claimed").length
}

export function listOpenIntents(tm: ThreadManager, hostThreadId: string): Intent[] {
  const host = tm.get(hostThreadId) as ThreadLike | undefined
  const board = host?.mission_board
  if (!board) return []
  return board.intents.filter((i) => i.status === "open" || i.status === "claimed")
}
