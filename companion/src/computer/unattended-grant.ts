/**
 * Unattended desktop session grant (ADR-021).
 *
 * Process-memory only — companion restart clears. After phrase arm, host_computer
 * skips *initial* task L2 for coordinateAllowed apps when unattendedInitialSkipEligible
 * holds, AND mid-task re-L2 (including PROMPT_ALWAYS tags) is silent while armed
 * (executor reL2 short-circuit). Hard denials (payment final, captcha, …) still throw
 * without a confirm dialog.
 *
 * open_within_app: no type corpus ⊆ check (blast radius higher than G1 — UI must disclose).
 * Global auto_approve / allow_all_schemes alone NEVER set this grant.
 */

import { SECURITY_ARM_CONFIRM_PHRASE, isValidSecurityArmPhrase } from "../security-arm"
import { logger } from "../logger"

/** Wall-clock hard TTL (design F14 / ADR-021). */
export const UNATTENDED_HARD_TTL_MS = 8 * 60 * 60 * 1000 // 8h

/** Default per-task caps (aligned with server host_computer budget max 30). */
export const UNATTENDED_DEFAULT_MAX_BUDGET = 30
export const UNATTENDED_DEFAULT_MAX_ACTIONS = 30

export interface UnattendedGrantState {
  armed: boolean
  armedAt: number | null
  expiresAt: number | null
  includeProtocol: boolean
  maxBudgetCap: number
  maxActionsCap: number
}

interface InternalGrant {
  armedAt: number
  expiresAt: number
  includeProtocol: boolean
  maxBudgetCap: number
  maxActionsCap: number
}

let grant: InternalGrant | null = null

/** Test hook — wipe process grant. */
export function resetUnattendedGrantForTests(): void {
  grant = null
}

export function isUnattendedArmed(now: number = Date.now()): boolean {
  if (!grant) return false
  if (now >= grant.expiresAt) {
    grant = null
    return false
  }
  return true
}

export function getUnattendedStatus(now: number = Date.now()): UnattendedGrantState {
  if (!grant || now >= grant.expiresAt) {
    if (grant && now >= grant.expiresAt) grant = null
    return {
      armed: false,
      armedAt: null,
      expiresAt: null,
      includeProtocol: false,
      maxBudgetCap: UNATTENDED_DEFAULT_MAX_BUDGET,
      maxActionsCap: UNATTENDED_DEFAULT_MAX_ACTIONS,
    }
  }
  return {
    armed: true,
    armedAt: grant.armedAt,
    expiresAt: grant.expiresAt,
    includeProtocol: grant.includeProtocol,
    maxBudgetCap: grant.maxBudgetCap,
    maxActionsCap: grant.maxActionsCap,
  }
}

export interface ArmUnattendedOpts {
  confirmation_phrase: unknown
  include_protocol?: boolean
  max_budget_cap?: number
  max_actions_cap?: number
  /** Injectable clock for tests */
  now?: number
}

export type ArmUnattendedResult =
  | { ok: true; status: UnattendedGrantState }
  | { ok: false; error: string }

/**
 * Arm process-memory unattended grant. Requires valid phrase (same literal as security-arm).
 */
export function armUnattended(opts: ArmUnattendedOpts): ArmUnattendedResult {
  if (!isValidSecurityArmPhrase(opts.confirmation_phrase)) {
    logger.warn("security.unattended_arm_rejected", { reason: "bad_phrase" })
    return {
      ok: false,
      error:
        "Arming unattended desktop requires a valid confirmation_phrase (Settings phrase step-up).",
    }
  }
  const now = opts.now ?? Date.now()
  const maxBudgetCap = clampCap(opts.max_budget_cap, UNATTENDED_DEFAULT_MAX_BUDGET)
  const maxActionsCap = clampCap(opts.max_actions_cap, UNATTENDED_DEFAULT_MAX_ACTIONS)
  const includeProtocol = opts.include_protocol === true
  grant = {
    armedAt: now,
    expiresAt: now + UNATTENDED_HARD_TTL_MS,
    includeProtocol,
    maxBudgetCap,
    maxActionsCap,
  }
  logger.warn("security.unattended_armed", {
    armed_at: grant.armedAt,
    expires_at: grant.expiresAt,
    include_protocol: includeProtocol,
    max_budget_cap: maxBudgetCap,
    max_actions_cap: maxActionsCap,
  })
  return { ok: true, status: getUnattendedStatus(now) }
}

export function disarmUnattended(now: number = Date.now()): UnattendedGrantState {
  if (grant) {
    logger.info("security.unattended_disarmed", {
      was_armed_at: grant.armedAt,
      at: now,
    })
  }
  grant = null
  return getUnattendedStatus(now)
}

function clampCap(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(1, Math.floor(n)), 30)
}

/**
 * Pure gate for unattended initial L2 skip.
 * coordinateAllowed must already be true at call site (assertCoordinateAllowed passed).
 *
 * Product (owner 2026-08): 武装 = 风险自担。值守 grant 有效期内 **不再** 因
 * modelEnabled / experimental / credential latch 退回弹窗——否则「无人值守」
 * 名不副实。硬拒绝（支付终确等）仍在 executor 以 throw 无对话框路径处理。
 * experimental / modelEnabled / credentialLatched 参数保留签名兼容，**不再 gate**。
 */
export function unattendedInitialSkipEligible(args: {
  armed: boolean
  coordinateAllowed: boolean
  experimental: boolean
  modelEnabled: boolean
  credentialLatched: boolean
  budget: number
  actionCount: number
  maxBudgetCap: number
  maxActionsCap: number
  now: number
  expiresAt: number
}): boolean {
  if (!args.armed) return false
  if (!(args.expiresAt > args.now)) return false
  if (args.coordinateAllowed !== true) return false
  // modelEnabled / experimental / credentialLatched intentionally ignored under unattended
  void args.experimental
  void args.modelEnabled
  void args.credentialLatched
  if (!(args.budget > 0 && args.budget <= args.maxBudgetCap)) return false
  if (!(args.actionCount >= 0 && args.actionCount <= args.maxActionsCap)) return false
  return true
}

/**
 * Convenience for server: evaluate skip using live grant + task params.
 */
export function evaluateUnattendedHostComputerSkip(args: {
  coordinateAllowed: boolean
  experimental: boolean
  modelEnabled: boolean
  credentialLatched: boolean
  budget: number
  actionCount: number
  now?: number
}): boolean {
  return evaluateUnattendedHostComputerSkipDetail(args).ok
}

/**
 * Same gate as evaluateUnattendedHostComputerSkip but with a stable block_reason
 * for audit logs and Confirm Center copy (why 值守中 still prompted).
 */
export function evaluateUnattendedHostComputerSkipDetail(args: {
  coordinateAllowed: boolean
  experimental: boolean
  modelEnabled: boolean
  credentialLatched: boolean
  budget: number
  actionCount: number
  now?: number
}): { ok: boolean; block_reason?: string } {
  const now = args.now ?? Date.now()
  const st = getUnattendedStatus(now)
  if (!st.armed || st.expiresAt == null) {
    return { ok: false, block_reason: "not_armed_or_expired" }
  }
  if (args.coordinateAllowed !== true) {
    return { ok: false, block_reason: "coordinate_not_allowed" }
  }
  // Owner 2026-08: unattended = full residual risk on host_computer confirms.
  // modelEnabled / experimental / credential latch no longer block initial skip.
  void args.experimental
  void args.modelEnabled
  void args.credentialLatched
  if (!(args.budget > 0 && args.budget <= st.maxBudgetCap)) {
    return { ok: false, block_reason: "budget_over_cap" }
  }
  if (!(args.actionCount >= 0 && args.actionCount <= st.maxActionsCap)) {
    return { ok: false, block_reason: "actions_over_cap" }
  }
  return { ok: true }
}

/** Re-export phrase constant for handlers that want a single import. */
export { SECURITY_ARM_CONFIRM_PHRASE }
