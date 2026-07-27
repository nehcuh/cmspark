/**
 * MissionBoard service — single write path for thread.mission_board (ADR-016).
 *
 * All mutations go through mutateMissionBoard (load → validate → merge → atomic save).
 * Workers never host a canonical board; handback merges into parent/host only.
 */

import type { ThreadManager } from "../threads/thread-manager"
import { appendCapabilityAudit } from "../packs/audit-log"
import {
  BOARD_CAPS,
  BOARD_SCHEMA_VERSION,
  FactSchema,
  HANDBACK_MISSING_STRUCTURE,
  HintSchema,
  IntentSchema,
  MissionBoardSchema,
  createEmptyMissionBoard,
  newBoardEntityId,
  nowIso,
  parseHandbackPayload,
  parseMissionBoard,
  stampProvenance,
  type ActorType,
  type Fact,
  type HandbackPayload,
  type Hint,
  type Intent,
  type MissionBoard,
  type TrustTier,
} from "./schema"

export type BoardActorContext = {
  actor_type: ActorType
  thread_id?: string | null
  worker_id?: string | null
  orchestrator_run_id?: string | null
  message_id?: string | null
  tool_name?: string | null
}

export type ToolCallResolver = (toolCallId: string) => boolean

export type BoardMutationError = {
  ok: false
  error: string
  error_code?: string
  recoverable?: boolean
}

export type BoardMutationOk<T = MissionBoard> = {
  ok: true
  board: T
  added_facts?: Fact[]
  added_intents?: Intent[]
  added_hints?: Hint[]
}

export type BoardResult<T = MissionBoard> = BoardMutationOk<T> | BoardMutationError

type ThreadLike = {
  id: string
  agent_role?: string | null
  parent_thread_id?: string | null
  orchestrator_run_id?: string | null
  board_mode?: boolean | null
  mission_board?: MissionBoard | null
  [key: string]: unknown
}

function audit(
  type: string,
  fields: Record<string, unknown>,
  auditPath?: string,
): void {
  appendCapabilityAudit(
    {
      type,
      at: nowIso(),
      ...fields,
    },
    auditPath,
  )
}

function claimPreview(claim: string, max = 120): string {
  if (claim.length <= max) return claim
  return claim.slice(0, max) + "…"
}

/**
 * Host rule (ADR-016 MF-2 / G7):
 * - multi-agent: canonical board only on orchestrator / parent
 * - single-thread: sole user thread is host
 * - workers never host
 */
export function isBoardHostThread(thread: ThreadLike | null | undefined): boolean {
  if (!thread) return false
  if (thread.agent_role === "worker") return false
  return true
}

export function resolveBoardHostThreadId(
  tm: ThreadManager,
  threadId: string,
): string | null {
  const t = tm.get(threadId) as ThreadLike | undefined
  if (!t) return null
  if (t.agent_role === "worker") {
    return t.parent_thread_id ? String(t.parent_thread_id) : null
  }
  return t.id
}

function loadBoardFromThread(thread: ThreadLike): MissionBoard | null {
  if (thread.mission_board == null) return null
  const parsed = parseMissionBoard(thread.mission_board)
  if (!parsed.ok) return null
  return parsed.board
}

function checkBoardSize(board: MissionBoard): BoardMutationError | null {
  const bytes = Buffer.byteLength(JSON.stringify(board), "utf-8")
  if (bytes > BOARD_CAPS.max_board_json_bytes) {
    return {
      ok: false,
      error: `board exceeds max_board_json_bytes (${BOARD_CAPS.max_board_json_bytes})`,
      error_code: "BOARD_TOO_LARGE",
      recoverable: true,
    }
  }
  return null
}

/**
 * Single serialized write path for mission_board.
 */
export async function mutateMissionBoard(
  tm: ThreadManager,
  hostThreadId: string,
  op: (board: MissionBoard, host: ThreadLike) => BoardResult | Promise<BoardResult>,
  opts?: { auditPath?: string },
): Promise<BoardResult> {
  return tm.withThreadLock(hostThreadId, async () => {
    const host = tm.get(hostThreadId) as ThreadLike | undefined
    if (!host) {
      return { ok: false, error: `host thread not found: ${hostThreadId}` }
    }
    if (!isBoardHostThread(host)) {
      return {
        ok: false,
        error: "workers cannot host mission_board; merge into parent",
        error_code: "BOARD_HOST_INVALID",
        recoverable: false,
      }
    }

    let board = loadBoardFromThread(host)
    if (!board) {
      board = createEmptyMissionBoard()
    }

    const result = await op(board, host)
    if (!result.ok) return result

    const sizeErr = checkBoardSize(result.board)
    if (sizeErr) return sizeErr

    const validated = MissionBoardSchema.safeParse({
      ...result.board,
      updated_at: nowIso(),
    })
    if (!validated.success) {
      return {
        ok: false,
        error: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        error_code: "BOARD_SCHEMA_INVALID",
        recoverable: true,
      }
    }

    const saved = validated.data
    tm.update(hostThreadId, { mission_board: saved } as any)
    return { ...result, board: saved }
  })
}

export function readBoard(tm: ThreadManager, threadId: string): MissionBoard | null {
  const hostId = resolveBoardHostThreadId(tm, threadId)
  if (!hostId) return null
  const host = tm.get(hostId) as ThreadLike | undefined
  if (!host) return null
  return loadBoardFromThread(host)
}

/**
 * Initialize board when board_mode is true. Never on worker threads.
 * Does not wipe existing facts/intents/hints.
 */
export async function ensureBoard(
  tm: ThreadManager,
  threadId: string,
  opts?: {
    origin?: string | null
    goal?: string | null
    force?: boolean
    auditPath?: string
  },
): Promise<BoardResult> {
  const hostId = resolveBoardHostThreadId(tm, threadId)
  if (!hostId) {
    return {
      ok: false,
      error: "cannot resolve board host (worker without parent?)",
      error_code: "BOARD_HOST_INVALID",
    }
  }
  const host = tm.get(hostId) as ThreadLike | undefined
  if (!host) return { ok: false, error: `thread not found: ${hostId}` }
  if (!isBoardHostThread(host)) {
    return { ok: false, error: "workers never host mission_board", error_code: "BOARD_HOST_INVALID" }
  }

  const modeOn = host.board_mode === true || opts?.force === true
  if (!modeOn) {
    // board_mode off → no init; return existing or null-as-error soft
    const existing = loadBoardFromThread(host)
    if (existing) return { ok: true, board: existing }
    return {
      ok: false,
      error: "board_mode is not enabled; ensureBoardDefaults skipped",
      error_code: "BOARD_MODE_OFF",
      recoverable: true,
    }
  }

  return mutateMissionBoard(
    tm,
    hostId,
    (board) => {
      const next: MissionBoard = {
        ...board,
        origin:
          board.origin == null && opts?.origin != null ? opts.origin : board.origin,
        goal: board.goal == null && opts?.goal != null ? opts.goal : board.goal,
      }
      const wasEmpty =
        board.facts.length === 0 &&
        board.intents.length === 0 &&
        board.hints.length === 0 &&
        board.origin == null &&
        board.goal == null
      if (wasEmpty || board.schema_version !== BOARD_SCHEMA_VERSION) {
        audit(
          "board.initialized",
          {
            thread_id: hostId,
            origin: next.origin,
            goal: next.goal ? claimPreview(String(next.goal)) : null,
          },
          opts?.auditPath,
        )
      }
      return { ok: true, board: next }
    },
    { auditPath: opts?.auditPath },
  )
}

function resolveTrustForFact(
  draftTrust: unknown,
  actor: BoardActorContext,
  evidence: Fact["evidence"],
  resolveToolCall?: ToolCallResolver,
  auditPath?: string,
  hostThreadId?: string,
): { trust: TrustTier } | BoardMutationError {
  // Client trust is never trusted as-is; re-stamp.
  let requested: TrustTier | undefined
  if (draftTrust === "llm_asserted" || draftTrust === "tool_verified" || draftTrust === "user_confirmed") {
    requested = draftTrust
  }

  // Non-user claiming user_confirmed → REJECT (G2)
  if (requested === "user_confirmed" && actor.actor_type !== "user") {
    audit(
      "board.trust_rejected",
      {
        thread_id: hostThreadId,
        actor_type: actor.actor_type,
        requested_trust: "user_confirmed",
        reason: "non-user cannot stamp user_confirmed",
      },
      auditPath,
    )
    return {
      ok: false,
      error: "trust user_confirmed rejected for non-user actor",
      error_code: "BOARD_TRUST_REJECTED",
      recoverable: true,
    }
  }

  if (requested === "user_confirmed" && actor.actor_type === "user") {
    return { trust: "user_confirmed" }
  }

  if (requested === "tool_verified") {
    const withId = evidence.filter((e) => e.tool_call_id && String(e.tool_call_id).length > 0)
    if (withId.length === 0) {
      audit(
        "board.trust_rejected",
        {
          thread_id: hostThreadId,
          actor_type: actor.actor_type,
          requested_trust: "tool_verified",
          reason: "missing tool_call_id evidence",
        },
        auditPath,
      )
      return {
        ok: false,
        error: "tool_verified requires evidence with resolvable tool_call_id",
        error_code: "BOARD_TRUST_REJECTED",
        recoverable: true,
      }
    }
    if (resolveToolCall) {
      const anyResolved = withId.some((e) => resolveToolCall(String(e.tool_call_id)))
      if (!anyResolved) {
        audit(
          "board.trust_rejected",
          {
            thread_id: hostThreadId,
            actor_type: actor.actor_type,
            requested_trust: "tool_verified",
            reason: "tool_call_id not resolvable",
          },
          auditPath,
        )
        return {
          ok: false,
          error: "tool_verified tool_call_id not resolvable on host/worker thread",
          error_code: "BOARD_TRUST_REJECTED",
          recoverable: true,
        }
      }
    } else {
      // No resolver provided: cannot verify — reject (P0 default)
      audit(
        "board.trust_rejected",
        {
          thread_id: hostThreadId,
          actor_type: actor.actor_type,
          requested_trust: "tool_verified",
          reason: "no tool_call resolver",
        },
        auditPath,
      )
      return {
        ok: false,
        error: "tool_verified requires resolvable tool_call_id (no resolver)",
        error_code: "BOARD_TRUST_REJECTED",
        recoverable: true,
      }
    }
    return { trust: "tool_verified" }
  }

  // Default
  return { trust: "llm_asserted" }
}

/**
 * Merge structured handback into host board. Rejects prose-only / empty structure.
 * complete_proposal is non-mutating (ignored for status).
 */
export async function applyHandbackPayload(
  tm: ThreadManager,
  hostThreadId: string,
  rawPayload: unknown,
  actor: BoardActorContext,
  opts?: {
    resolveToolCall?: ToolCallResolver
    auditPath?: string
    /** Worker thread that produced the handback (for provenance). */
    workerThreadId?: string | null
  },
): Promise<BoardResult> {
  const parsed = parseHandbackPayload(rawPayload)
  if (!parsed.ok) {
    audit(
      "board.handback_rejected",
      {
        thread_id: hostThreadId,
        worker_id: opts?.workerThreadId ?? actor.worker_id ?? null,
        error_code: parsed.error_code,
        error: parsed.error,
      },
      opts?.auditPath,
    )
    return {
      ok: false,
      error: parsed.error,
      error_code: parsed.error_code,
      recoverable: true,
    }
  }

  const payload: HandbackPayload = parsed.payload
  // complete_proposal MUST NOT mutate status (G11) — ignore for write path
  void payload.complete_proposal

  return mutateMissionBoard(
    tm,
    hostThreadId,
    (board) => {
      const provenance = stampProvenance({
        actor_type: actor.actor_type,
        thread_id: actor.thread_id ?? opts?.workerThreadId ?? null,
        worker_id: actor.worker_id ?? opts?.workerThreadId ?? null,
        orchestrator_run_id: actor.orchestrator_run_id ?? null,
        message_id: actor.message_id ?? null,
        tool_name: actor.tool_name ?? "collect_handback",
      })

      const added_facts: Fact[] = []
      const added_intents: Intent[] = []

      if (board.facts.length + payload.facts.length > BOARD_CAPS.max_facts) {
        return {
          ok: false,
          error: `max_facts (${BOARD_CAPS.max_facts}) would be exceeded`,
          error_code: "BOARD_CAP_FACTS",
          recoverable: true,
        }
      }
      if (board.intents.length + payload.intents.length > BOARD_CAPS.max_intents) {
        return {
          ok: false,
          error: `max_intents (${BOARD_CAPS.max_intents}) would be exceeded`,
          error_code: "BOARD_CAP_INTENTS",
          recoverable: true,
        }
      }

      for (const d of payload.facts) {
        const evidence = (d.evidence || []).map((e) => ({
          kind: e.kind,
          value: e.value,
          tool_call_id: e.tool_call_id ?? null,
        }))
        const trustRes = resolveTrustForFact(
          d.trust,
          actor,
          evidence,
          opts?.resolveToolCall,
          opts?.auditPath,
          hostThreadId,
        )
        if ("ok" in trustRes && trustRes.ok === false) {
          return trustRes
        }
        const trust = (trustRes as { trust: TrustTier }).trust
        const factCandidate = {
          id: newBoardEntityId("fact"),
          claim: d.claim,
          evidence,
          trust,
          tags: d.tags || [],
          related_intent_ids: d.related_intent_ids || [],
          severity: d.severity ?? null,
          provenance,
          created_at: nowIso(),
        }
        const fr = FactSchema.safeParse(factCandidate)
        if (!fr.success) {
          return {
            ok: false,
            error: fr.error.issues.map((i) => i.message).join("; "),
            error_code: "BOARD_FACT_INVALID",
            recoverable: true,
          }
        }
        added_facts.push(fr.data)
        audit(
          "board.fact_added",
          {
            thread_id: hostThreadId,
            fact_id: fr.data.id,
            trust: fr.data.trust,
            actor_type: provenance.actor_type,
            claim_preview: claimPreview(fr.data.claim),
            worker_id: provenance.worker_id,
          },
          opts?.auditPath,
        )
      }

      for (const d of payload.intents) {
        const now = nowIso()
        // P0: no intent claim path — only open/done/abandoned from handback drafts
        const intentStatus = d.status === "done" || d.status === "abandoned" ? d.status : "open"
        const intentCandidate = {
          id: newBoardEntityId("intent"),
          description: d.description,
          status: intentStatus,
          priority: d.priority || "normal",
          claimed_by_worker_id: null,
          heartbeat_at: null,
          parent_fact_ids: d.parent_fact_ids || [],
          result_fact_ids: [],
          provenance,
          created_at: now,
          updated_at: now,
        }
        const ir = IntentSchema.safeParse(intentCandidate)
        if (!ir.success) {
          return {
            ok: false,
            error: ir.error.issues.map((i) => i.message).join("; "),
            error_code: "BOARD_INTENT_INVALID",
            recoverable: true,
          }
        }
        added_intents.push(ir.data)
        audit(
          "board.intent_added",
          {
            thread_id: hostThreadId,
            intent_id: ir.data.id,
            status: ir.data.status,
            actor_type: provenance.actor_type,
            description_preview: claimPreview(ir.data.description),
          },
          opts?.auditPath,
        )
      }

      const next: MissionBoard = {
        ...board,
        facts: [...board.facts, ...added_facts],
        intents: [...board.intents, ...added_intents],
      }

      audit(
        "board.handback_applied",
        {
          thread_id: hostThreadId,
          worker_id: opts?.workerThreadId ?? actor.worker_id ?? null,
          facts_added: added_facts.length,
          intents_added: added_intents.length,
          empty_ok: !!payload.empty_ok,
          has_complete_proposal: payload.complete_proposal != null,
        },
        opts?.auditPath,
      )

      return { ok: true, board: next, added_facts, added_intents }
    },
    { auditPath: opts?.auditPath },
  )
}

/**
 * Add a hint (orchestrator / user). Workers must not call this.
 */
export async function addHint(
  tm: ThreadManager,
  hostThreadId: string,
  text: string,
  actor: BoardActorContext,
  opts?: {
    visibility?: "orchestrator_only" | "run_visible"
    auditPath?: string
  },
): Promise<BoardResult> {
  if (actor.actor_type === "worker") {
    return {
      ok: false,
      error: "workers cannot add hints (P0)",
      error_code: "BOARD_HINT_FORBIDDEN",
      recoverable: false,
    }
  }

  const trimmed = typeof text === "string" ? text.trim() : ""
  if (!trimmed) {
    return { ok: false, error: "hint text required", error_code: "BOARD_HINT_INVALID", recoverable: true }
  }

  return mutateMissionBoard(
    tm,
    hostThreadId,
    (board) => {
      if (board.hints.length >= BOARD_CAPS.max_hints) {
        return {
          ok: false,
          error: `max_hints (${BOARD_CAPS.max_hints}) reached`,
          error_code: "BOARD_CAP_HINTS",
          recoverable: true,
        }
      }
      const provenance = stampProvenance({
        actor_type: actor.actor_type,
        thread_id: actor.thread_id ?? hostThreadId,
        worker_id: actor.worker_id ?? null,
        orchestrator_run_id: actor.orchestrator_run_id ?? null,
        message_id: actor.message_id ?? null,
        tool_name: actor.tool_name ?? "board_add_hint",
      })
      const candidate = {
        id: newBoardEntityId("hint"),
        text: trimmed,
        visibility: opts?.visibility ?? "orchestrator_only",
        provenance,
        created_at: nowIso(),
      }
      const hr = HintSchema.safeParse(candidate)
      if (!hr.success) {
        return {
          ok: false,
          error: hr.error.issues.map((i) => i.message).join("; "),
          error_code: "BOARD_HINT_INVALID",
          recoverable: true,
        }
      }
      audit(
        "board.hint_added",
        {
          thread_id: hostThreadId,
          hint_id: hr.data.id,
          actor_type: provenance.actor_type,
          text_preview: claimPreview(hr.data.text),
        },
        opts?.auditPath,
      )
      return {
        ok: true,
        board: { ...board, hints: [...board.hints, hr.data] },
        added_hints: [hr.data],
      }
    },
    { auditPath: opts?.auditPath },
  )
}

/** Alias used in ADR text. */
export const ensureBoardDefaults = ensureBoard
