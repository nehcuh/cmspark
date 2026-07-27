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
  BOARD_DATA_NOT_INSTRUCTION_RULE,
  BOARD_SCHEMA_VERSION,
  FactSchema,
  HANDBACK_MISSING_STRUCTURE,
  HintSchema,
  IntentSchema,
  MissionBoardSchema,
  buildBoardCompleteDigest,
  createEmptyMissionBoard,
  formatBoardExportSummary,
  formatUntrustedFactFrame,
  newBoardEntityId,
  nowIso,
  parseHandbackPayload,
  parseMissionBoard,
  projectBoardForModel,
  stampProvenance,
  trustTierLabel,
  type ActorType,
  type BoardCompleteDigest,
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
  /** Internal: status→completed allowed only when set by completeBoard (G status integrity). */
  __complete_path?: boolean
  /** Idempotent re-collect: no new facts/intents added. */
  idempotent_replay?: boolean
}

export type BoardResult<T = MissionBoard> = BoardMutationOk<T> | BoardMutationError

export type CompleteBoardParams = {
  supporting_fact_ids?: string[]
  residual_risks?: string[]
  goal_summary?: string | null
  empty_complete?: boolean
  empty_complete_reason?: string | null
}

export type CanCompleteResult =
  | { ok: true; path: "supporting_facts" | "empty_complete" }
  | { ok: false; error: string; error_code: string }

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
 * Status→completed is only allowed when the op marks __complete_path (G status integrity).
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
    const prevStatus = board.status

    const result = await op(board, host)
    if (!result.ok) return result

    // Status transition integrity: completed only via complete mutation path
    if (result.board.status === "completed" && prevStatus !== "completed") {
      if (!result.__complete_path) {
        return {
          ok: false,
          error: "status completed only via board_complete mutation path",
          error_code: "BOARD_STATUS_INVALID",
          recoverable: false,
        }
      }
      if (!result.board.completed_at || !result.board.completed_by) {
        return {
          ok: false,
          error: "completed status requires completed_at and completed_by",
          error_code: "BOARD_STATUS_INVALID",
          recoverable: false,
        }
      }
    }

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
      const msgId = actor.message_id ? String(actor.message_id) : null
      const appliedIds = Array.isArray(board.applied_handback_message_ids)
        ? [...board.applied_handback_message_ids]
        : []

      // Idempotency: re-collect same worker message_id does not duplicate facts
      if (msgId && appliedIds.includes(msgId)) {
        audit(
          "board.handback_idempotent",
          {
            thread_id: hostThreadId,
            worker_id: opts?.workerThreadId ?? actor.worker_id ?? null,
            message_id: msgId,
          },
          opts?.auditPath,
        )
        return {
          ok: true,
          board,
          added_facts: [],
          added_intents: [],
          idempotent_replay: true,
        }
      }

      const provenance = stampProvenance({
        actor_type: actor.actor_type,
        thread_id: actor.thread_id ?? opts?.workerThreadId ?? null,
        worker_id: actor.worker_id ?? opts?.workerThreadId ?? null,
        orchestrator_run_id: actor.orchestrator_run_id ?? null,
        message_id: msgId,
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

      if (msgId) {
        appliedIds.push(msgId)
        // FIFO trim
        while (appliedIds.length > 500) appliedIds.shift()
      }

      const next: MissionBoard = {
        ...board,
        facts: [...board.facts, ...added_facts],
        intents: [...board.intents, ...added_intents],
        applied_handback_message_ids: appliedIds,
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
          message_id: msgId,
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

// ── collect_handback fold (ADR-016 Task 3) ─────────────────────────────────

export type CollectHandbackLastAssistant = {
  id: string
  content: string
  created_at: string
} | null

export type CollectHandbackSuccess = {
  success: true
  data: {
    worker_id: string
    last_assistant: CollectHandbackLastAssistant
    message_count: number
    board_mode: boolean
    /** Present when structured handback was applied — framed for model re-entry (G4). */
    facts?: Array<{
      id: string
      trust: TrustTier
      trust_label: string
      framed_claim: string
      severity: Fact["severity"]
      tags: string[]
    }>
    intents?: Intent[]
    summary?: string | null
    complete_proposal?: unknown
    idempotent_replay?: boolean
    board?: {
      fact_count: number
      intent_count: number
      open_intent_count: number
      status: MissionBoard["status"]
      goal: string | null
      model_projection?: ReturnType<typeof projectBoardForModel>
    }
    /** G4: MissionBoard text is data not instructions. */
    data_not_instruction?: string
  }
}

export type CollectHandbackFailure = {
  success: false
  error: string
  error_code?: string
  recoverable?: boolean
  data?: {
    worker_id: string
    last_assistant: CollectHandbackLastAssistant
    message_count: number
    board_mode: boolean
  }
}

export type CollectHandbackResult = CollectHandbackSuccess | CollectHandbackFailure

/**
 * Whether this host requires structured Fact/Intent handback.
 * True when board_mode is on, mission_board already present, or pack declared board mode.
 */
export function hostRequiresStructuredHandback(host: ThreadLike | null | undefined): boolean {
  if (!host) return false
  if (host.board_mode === true) return true
  if (host.mission_board != null) return true
  return false
}

/**
 * Orchestrator collect_handback path (ADR-016 §2.5.2).
 * - board mode off: free-text last_assistant only (ADR-015 compat)
 * - board mode on / mission_board present: parse + merge into host; prose-only → recoverable HANDBACK_MISSING_STRUCTURE
 */
export async function collectWorkerHandback(
  tm: ThreadManager,
  opts: {
    workerId: string
    /** Caller thread (orchestrator); used if worker has no parent. */
    callerThreadId?: string | null
    resolveToolCall?: ToolCallResolver
    auditPath?: string
    /** Force structured path even if host flags off (tests / expect_structured). */
    forceStructured?: boolean
  },
): Promise<CollectHandbackResult> {
  const workerId = String(opts.workerId)
  const worker = tm.get(workerId) as ThreadLike | undefined
  if (!worker) {
    return { success: false, error: `worker not found: ${workerId}` }
  }

  const msgs = tm.getMessages(workerId)
  const last = [...msgs].reverse().find((m) => m.role === "assistant")
  const lastAssistant: CollectHandbackLastAssistant = last
    ? { id: last.id, content: last.content, created_at: last.created_at }
    : null

  const hostId =
    resolveBoardHostThreadId(tm, workerId) ||
    (opts.callerThreadId ? resolveBoardHostThreadId(tm, String(opts.callerThreadId)) : null) ||
    (worker.parent_thread_id ? String(worker.parent_thread_id) : null)

  const host = hostId ? (tm.get(hostId) as ThreadLike | undefined) : null
  const boardMode = opts.forceStructured === true || hostRequiresStructuredHandback(host)

  const base = {
    worker_id: workerId,
    last_assistant: lastAssistant,
    message_count: msgs.length,
    board_mode: boardMode,
  }

  if (!boardMode) {
    return { success: true, data: base }
  }

  if (!hostId || !host || !isBoardHostThread(host)) {
    return {
      success: false,
      error: "cannot resolve board host for structured handback",
      error_code: "BOARD_HOST_INVALID",
      recoverable: false,
      data: base,
    }
  }

  // Initialize empty board when structured path is required but board not yet created
  if (host.mission_board == null) {
    const init = await ensureBoard(tm, hostId, {
      force: true,
      auditPath: opts.auditPath,
    })
    if (!init.ok) {
      return {
        success: false,
        error: init.error,
        error_code: init.error_code || "BOARD_INIT_FAILED",
        recoverable: true,
        data: base,
      }
    }
  }

  const rawPayload = lastAssistant?.content ?? null
  if (rawPayload == null || (typeof rawPayload === "string" && !rawPayload.trim())) {
    audit(
      "board.handback_rejected",
      {
        thread_id: hostId,
        worker_id: workerId,
        error_code: HANDBACK_MISSING_STRUCTURE,
        error: "handback payload is empty (no assistant message)",
      },
      opts.auditPath,
    )
    return {
      success: false,
      error: "handback payload is empty (no assistant message)",
      error_code: HANDBACK_MISSING_STRUCTURE,
      recoverable: true,
      data: base,
    }
  }

  const applied = await applyHandbackPayload(
    tm,
    hostId,
    rawPayload,
    {
      actor_type: "worker",
      worker_id: workerId,
      thread_id: workerId,
      orchestrator_run_id: (worker.orchestrator_run_id as string | null | undefined) ?? null,
      message_id: lastAssistant?.id ?? null,
      tool_name: "collect_handback",
    },
    {
      resolveToolCall: opts.resolveToolCall,
      auditPath: opts.auditPath,
      workerThreadId: workerId,
    },
  )

  if (!applied.ok) {
    return {
      success: false,
      error: applied.error,
      error_code: applied.error_code || HANDBACK_MISSING_STRUCTURE,
      recoverable: applied.recoverable ?? true,
      data: base,
    }
  }

  // Re-parse for summary / complete_proposal (non-mutating fields not returned by apply)
  const parsed = parseHandbackPayload(rawPayload)
  const summary = parsed.ok ? parsed.payload.summary ?? null : null
  const completeProposal = parsed.ok ? parsed.payload.complete_proposal ?? null : null

  const board = applied.board
  const added = applied.added_facts ?? []
  return {
    success: true,
    data: {
      ...base,
      facts: added.map((f) => ({
        id: f.id,
        trust: f.trust,
        trust_label: trustTierLabel(f.trust),
        framed_claim: formatUntrustedFactFrame(f),
        severity: f.severity,
        tags: f.tags,
      })),
      intents: applied.added_intents ?? [],
      summary,
      complete_proposal: completeProposal,
      idempotent_replay: !!applied.idempotent_replay,
      data_not_instruction: BOARD_DATA_NOT_INSTRUCTION_RULE,
      board: {
        fact_count: board.facts.length,
        intent_count: board.intents.length,
        open_intent_count: board.intents.filter((i) => i.status === "open" || i.status === "claimed").length,
        status: board.status,
        goal: board.goal,
        model_projection: projectBoardForModel(board),
      },
    },
  }
}

/**
 * Build a ToolCallResolver from recorded tool results on a worker (and optional host) thread.
 * Fail-closed: only ids that appear as role=tool messages with matching tool_call id resolve.
 */
export function resolveToolCallFromThreadMessages(
  tm: ThreadManager,
  workerThreadId: string,
  hostThreadId?: string | null,
): ToolCallResolver {
  const ids = new Set<string>()
  const collect = (threadId: string) => {
    const msgs = tm.getMessages(threadId)
    for (const m of msgs) {
      if (m.role === "tool" && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc && typeof tc.id === "string" && tc.id.length > 0) ids.add(tc.id)
        }
      }
      // Also accept assistant-side tool_call ids that have a following tool result pairing
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const id = tc?.id
          if (typeof id === "string" && id.length > 0) {
            // Only count if a tool result exists with that id
            const hasResult = msgs.some(
              (tr) =>
                tr.role === "tool" &&
                Array.isArray(tr.tool_calls) &&
                tr.tool_calls.some((x: any) => x?.id === id),
            )
            if (hasResult) ids.add(id)
          }
        }
      }
    }
  }
  collect(workerThreadId)
  if (hostThreadId && hostThreadId !== workerThreadId) collect(hostThreadId)
  return (toolCallId: string) => ids.has(String(toolCallId))
}

/**
 * Hard canComplete predicate (ADR-016 G5).
 * - goal non-empty OR empty_goal_ok
 * - default: supporting ids exist + ≥1 tool_verified|user_confirmed
 * - exception: empty_complete with non-empty reason (must be L2-approved by caller)
 */
export function canComplete(
  board: MissionBoard | null | undefined,
  params: CompleteBoardParams,
): CanCompleteResult {
  if (!board) {
    return { ok: false, error: "no mission board", error_code: "BOARD_MISSING" }
  }
  if (board.status !== "open") {
    return {
      ok: false,
      error: `board status is ${board.status}, expected open`,
      error_code: "BOARD_NOT_OPEN",
    }
  }
  const goalOk =
    (typeof board.goal === "string" && board.goal.trim().length > 0) || board.empty_goal_ok === true
  if (!goalOk) {
    return {
      ok: false,
      error: "goal is empty and empty_goal_ok is false",
      error_code: "BOARD_GOAL_REQUIRED",
    }
  }

  if (params.empty_complete === true) {
    const reason =
      typeof params.empty_complete_reason === "string" ? params.empty_complete_reason.trim() : ""
    if (!reason) {
      return {
        ok: false,
        error: "empty_complete requires non-empty empty_complete_reason",
        error_code: "BOARD_EMPTY_COMPLETE_REASON",
      }
    }
    return { ok: true, path: "empty_complete" }
  }

  const ids = Array.isArray(params.supporting_fact_ids)
    ? params.supporting_fact_ids.map(String).filter(Boolean)
    : []
  if (ids.length === 0) {
    return {
      ok: false,
      error: "supporting_fact_ids required (or empty_complete with reason)",
      error_code: "BOARD_SUPPORTING_FACTS_REQUIRED",
    }
  }
  const byId = new Map(board.facts.map((f) => [f.id, f]))
  for (const id of ids) {
    if (!byId.has(id)) {
      return {
        ok: false,
        error: `supporting fact not on board: ${id}`,
        error_code: "BOARD_SUPPORTING_FACT_MISSING",
      }
    }
  }
  const hasHardTrust = ids.some((id) => {
    const t = byId.get(id)!.trust
    return t === "tool_verified" || t === "user_confirmed"
  })
  if (!hasHardTrust) {
    return {
      ok: false,
      error:
        "at least one supporting fact must have trust tool_verified or user_confirmed (llm_asserted alone is insufficient)",
      error_code: "BOARD_TRUST_INSUFFICIENT",
    }
  }
  return { ok: true, path: "supporting_facts" }
}

/**
 * board_complete mutation — only legal path to status=completed (G5/G9).
 * Caller MUST enforce L2 security_token before calling.
 */
export async function completeBoard(
  tm: ThreadManager,
  hostThreadId: string,
  params: CompleteBoardParams,
  actor: BoardActorContext,
  opts?: { auditPath?: string },
): Promise<BoardResult & { digest?: BoardCompleteDigest; can_complete?: CanCompleteResult }> {
  const host = tm.get(hostThreadId) as ThreadLike | undefined
  if (!host) return { ok: false, error: `host thread not found: ${hostThreadId}` }
  if (!isBoardHostThread(host)) {
    return {
      ok: false,
      error: "workers cannot complete mission_board",
      error_code: "BOARD_HOST_INVALID",
      recoverable: false,
    }
  }
  // Reject LLM self-stamped user_confirmed on complete actor (G2 pattern)
  if (actor.actor_type === "worker") {
    return {
      ok: false,
      error: "workers cannot call board_complete",
      error_code: "BOARD_COMPLETE_FORBIDDEN",
      recoverable: false,
    }
  }

  const board = loadBoardFromThread(host) || createEmptyMissionBoard()
  const check = canComplete(board, params)
  if (!check.ok) {
    audit(
      "board.complete_rejected",
      {
        thread_id: hostThreadId,
        error_code: check.error_code,
        error: check.error,
        empty_complete: !!params.empty_complete,
      },
      opts?.auditPath,
    )
    return {
      ok: false,
      error: check.error,
      error_code: check.error_code,
      recoverable: true,
      can_complete: check,
      digest: buildBoardCompleteDigest(board, params),
    } as BoardMutationError & { digest: BoardCompleteDigest; can_complete: CanCompleteResult }
  }

  const digest = buildBoardCompleteDigest(board, params)

  return mutateMissionBoard(
    tm,
    hostThreadId,
    (b) => {
      // Re-check after lock (G5: before and after L2)
      const recheck = canComplete(b, params)
      if (!recheck.ok) {
        return {
          ok: false,
          error: recheck.error,
          error_code: recheck.error_code,
          recoverable: true,
        }
      }
      const provenance = stampProvenance({
        actor_type: actor.actor_type === "user" ? "user" : "orchestrator",
        thread_id: actor.thread_id ?? hostThreadId,
        worker_id: null,
        orchestrator_run_id: actor.orchestrator_run_id ?? null,
        message_id: actor.message_id ?? null,
        tool_name: "board_complete",
      })
      const now = nowIso()
      const next: MissionBoard = {
        ...b,
        status: "completed",
        completed_at: now,
        completed_by: provenance,
        // Preserve goal; optional goal_summary is audit-only
      }
      audit(
        "board.completed",
        {
          thread_id: hostThreadId,
          empty_complete: !!params.empty_complete,
          empty_complete_reason: params.empty_complete
            ? String(params.empty_complete_reason || "").slice(0, 500)
            : null,
          supporting_fact_ids: params.supporting_fact_ids || [],
          residual_risks: params.residual_risks || [],
          goal_summary: params.goal_summary
            ? claimPreview(String(params.goal_summary), 200)
            : null,
          path: recheck.path,
          trust_histogram: digest.trust_histogram,
        },
        opts?.auditPath,
      )
      return { ok: true, board: next, __complete_path: true }
    },
    { auditPath: opts?.auditPath },
  ).then((r) => {
    if (r.ok) return { ...r, digest, can_complete: check }
    return { ...r, digest, can_complete: check }
  })
}

/**
 * G13: mark worker's open/claimed intents abandoned on host board.
 * Call BEFORE pending tool reject drainage and lease release.
 */
export async function abandonWorkerIntents(
  tm: ThreadManager,
  workerThreadId: string,
  opts?: { reason?: string; auditPath?: string },
): Promise<{ abandoned: number; host_thread_id: string | null }> {
  const hostId = resolveBoardHostThreadId(tm, workerThreadId)
  if (!hostId) return { abandoned: 0, host_thread_id: null }
  const host = tm.get(hostId) as ThreadLike | undefined
  if (!host || !isBoardHostThread(host)) return { abandoned: 0, host_thread_id: hostId }
  if (host.mission_board == null) return { abandoned: 0, host_thread_id: hostId }

  let abandonedCount = 0
  const result = await mutateMissionBoard(
    tm,
    hostId,
    (board) => {
      const now = nowIso()
      let count = 0
      const intents = board.intents.map((intent) => {
        const owned =
          intent.claimed_by_worker_id === workerThreadId ||
          intent.provenance?.worker_id === workerThreadId ||
          intent.provenance?.thread_id === workerThreadId
        if (owned && (intent.status === "open" || intent.status === "claimed")) {
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
      abandonedCount = count
      if (count === 0) return { ok: true, board }
      audit(
        "board.intents_abandoned",
        {
          thread_id: hostId,
          worker_id: workerThreadId,
          abandoned_count: count,
          reason: opts?.reason || "worker_cancel",
        },
        opts?.auditPath,
      )
      return { ok: true, board: { ...board, intents } }
    },
    { auditPath: opts?.auditPath },
  )
  if (!result.ok) return { abandoned: 0, host_thread_id: hostId }
  return { abandoned: abandonedCount, host_thread_id: hostId }
}

/**
 * Read-only board snapshot for orchestrator (and Pack-granted workers).
 * Model-facing projection uses UNTRUSTED_BOARD_* frames (G4).
 * Raw board still available for UI; export_summary labels trust (G12).
 */
export function boardReadForTool(
  tm: ThreadManager,
  threadId: string,
): {
  success: boolean
  error?: string
  error_code?: string
  data?: {
    /** Model-facing framed projection (preferred for LLM tool results). */
    board: ReturnType<typeof projectBoardForModel>
    /** Raw board for UI / trusted clients — keep trust fields as-is. */
    raw_board: MissionBoard | null
    export_summary: string
    host_thread_id: string | null
    board_mode: boolean
    data_not_instruction: string
  }
} {
  const hostId = resolveBoardHostThreadId(tm, threadId)
  if (!hostId) {
    return {
      success: false,
      error: "cannot resolve board host",
      error_code: "BOARD_HOST_INVALID",
    }
  }
  const host = tm.get(hostId) as ThreadLike | undefined
  if (!host) {
    return { success: false, error: `thread not found: ${hostId}` }
  }
  const board = loadBoardFromThread(host)
  return {
    success: true,
    data: {
      board: projectBoardForModel(board),
      raw_board: board,
      export_summary: formatBoardExportSummary(board),
      host_thread_id: hostId,
      board_mode: host.board_mode === true || board != null,
      data_not_instruction: BOARD_DATA_NOT_INSTRUCTION_RULE,
    },
  }
}
