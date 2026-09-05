// L-2 (#388) loop kernel state — pure types, sanitize, and budget arithmetic.
// Design basis: .omx/artifacts/loop-rethink-20260906/FINAL-SYNTHESIS.md §分歧 1/4 + L-2.
//
// RED LINES (do not relax here):
// - loopState is never written by a plain chatCreate: activation requires one of
//   the three explicit entrances (plan approval / explicit command / unattended
//   arm) or the suggestion-card gesture (== explicit command).
// - STOPPED_USER requires an explicit re-arm gesture; a stopped loop never
//   revives from queued/next runs on its own (#307 discipline).
// - Budgets are hard gates: runs ≤ 20, wall-clock 30min (60min unattended),
//   aggregate tokens ≤ 10× median single-run cost of this loop episode.

/** Explicit activation entrances (plus suggestion_card == lightweight explicit command). */
export type LoopArmSource =
  | "plan_approval"
  | "explicit_command"
  | "suggestion_card"
  | "unattended_arm"

export type LoopPauseReason = "grant_ttl" | "deny_storm"

export type LoopStatus =
  | "active"
  | "completed"
  | "paused" // L-5: grant TTL / deny-storm — recoverable via explicit re-arm
  | "stopped_budget" // checkpoint-resumable via explicit re-arm (resume)
  | "stopped_user" // re-arm must be an explicit gesture
  | "halt_security" // security / non_recoverable — never auto-continues
  | "stopped_no_checklist" // tools ran but no live plan and model never proposed one

export type LoopState = {
  status: LoopStatus
  armed_by: LoopArmSource
  /** ISO timestamp of the latest (re-)arm. */
  armed_at: string
  /** Wall-clock anchor (ms epoch) for the current budget window. */
  started_at_ms: number
  /** Wall-clock budget for this episode (30min attended / 60min unattended). */
  wall_clock_ms: number
  /** Loop-scheduled continuation runs consumed in this budget window. */
  runs_used: number
  /** Aggregate provider total_tokens across runs in this budget window. */
  tokens_used: number
  /** Per-run total_tokens samples (ring, capped) — median × 10 is the token budget. */
  run_tokens: number[]
  /** Budget dimension that stopped the loop (status=stopped_budget only). */
  budget_stop?: "runs" | "wall_clock" | "tokens"
  /** First continuation already asked the model to propose a checklist. */
  propose_requested?: boolean
  /** True when this episode armed under an unattended grant (L-5). */
  unattended?: boolean
  /**
   * Snapshot of grant expiresAt at arm (L-5). Loop never extends this.
   * Absent when the episode is unattended-flagged without a live grant.
   */
  grant_expires_at_ms?: number
  /** Why status=paused (L-5 grant TTL / deny-storm). */
  pause_reason?: LoopPauseReason
}

export const LOOP_BUDGET = {
  maxRuns: 20,
  wallClockAttendedMs: 30 * 60 * 1000,
  wallClockUnattendedMs: 60 * 60 * 1000,
  tokenMultiplier: 10,
  /** Ring size for run_tokens samples. */
  tokenSamples: 50,
} as const

const ARM_SOURCES = new Set<LoopArmSource>([
  "plan_approval",
  "explicit_command",
  "suggestion_card",
  "unattended_arm",
])

const STATUSES = new Set<LoopStatus>([
  "active",
  "completed",
  "paused",
  "stopped_budget",
  "stopped_user",
  "halt_security",
  "stopped_no_checklist",
])

function num(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw
  if (typeof n !== "number" || !Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

/** Disk/untrusted read path: returns null when the payload is not a LoopState. */
export function sanitizeLoopState(raw: unknown): LoopState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!STATUSES.has(o.status as LoopStatus)) return null
  if (!ARM_SOURCES.has(o.armed_by as LoopArmSource)) return null
  const started_at_ms = num(o.started_at_ms, 0, Number.MAX_SAFE_INTEGER)
  const wall_clock_ms = num(o.wall_clock_ms, 1, LOOP_BUDGET.wallClockUnattendedMs)
  const runs_used = num(o.runs_used, 0, LOOP_BUDGET.maxRuns)
  const tokens_used = num(o.tokens_used, 0, Number.MAX_SAFE_INTEGER)
  if (started_at_ms === null || wall_clock_ms === null || runs_used === null || tokens_used === null) {
    return null
  }
  const runTokensRaw = Array.isArray(o.run_tokens) ? o.run_tokens : []
  const run_tokens = runTokensRaw
    .map((t) => num(t, 0, Number.MAX_SAFE_INTEGER))
    .filter((t): t is number => t !== null)
    .slice(-LOOP_BUDGET.tokenSamples)
  const state: LoopState = {
    status: o.status as LoopStatus,
    armed_by: o.armed_by as LoopArmSource,
    armed_at: typeof o.armed_at === "string" ? o.armed_at.slice(0, 64) : "",
    started_at_ms,
    wall_clock_ms,
    runs_used,
    tokens_used,
    run_tokens,
  }
  if (o.budget_stop === "runs" || o.budget_stop === "wall_clock" || o.budget_stop === "tokens") {
    state.budget_stop = o.budget_stop
  }
  if (o.propose_requested === true) state.propose_requested = true
  if (o.unattended === true) state.unattended = true
  const grantExp = num(o.grant_expires_at_ms, 1, Number.MAX_SAFE_INTEGER)
  if (grantExp !== null) state.grant_expires_at_ms = grantExp
  if (o.pause_reason === "grant_ttl" || o.pause_reason === "deny_storm") {
    state.pause_reason = o.pause_reason
  }
  return state
}

export function medianOf(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Hard budget gate. Checked before scheduling another loop run and again at
 * drain time. Token budget only engages once at least one metered run exists
 * (median of this episode's per-run totals × 10).
 */
export function loopBudgetExceeded(
  state: Pick<LoopState, "runs_used" | "started_at_ms" | "wall_clock_ms" | "tokens_used" | "run_tokens">,
  nowMs: number,
): "runs" | "wall_clock" | "tokens" | null {
  if (state.runs_used >= LOOP_BUDGET.maxRuns) return "runs"
  if (nowMs - state.started_at_ms > state.wall_clock_ms) return "wall_clock"
  if (state.run_tokens.length > 0 && state.tokens_used > 0) {
    const median = medianOf(state.run_tokens)
    if (median > 0 && state.tokens_used > LOOP_BUDGET.tokenMultiplier * median) return "tokens"
  }
  return null
}

/** Per-run outcome the adapter reports back to the loop kernel (L-2). */
export type RunTerminal =
  | "aborted" // user stop / supersede — abort path owns the state transition
  | "security_halt" // shouldStop severe: security | non_recoverable → HALT, never auto-continue
  | "circuit_breaker" // 100-round cap / continuous-failure / same-tool failure breakers
  | "error" // overflow / auth / structural / tool-exception terminal chat.error
  | null

export type RunStats = {
  /** Tool calls issued across the whole run (eligibility: ≥1 to continue). */
  toolCalls: number
  /** Tool calls in the closing turn (#387 closing-turn-no-tool_calls layer). */
  closingTurnToolCalls: number
  /** Σ provider total_tokens across rounds (0 when the provider omits usage). */
  totalTokens: number
  terminal: RunTerminal
}
