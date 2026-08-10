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

import * as fs from "fs"
import * as path from "path"
import { SECURITY_ARM_CONFIRM_PHRASE, isValidSecurityArmPhrase } from "../security-arm"
import { logger } from "../logger"
import { DATA_DIR } from "../config"

/** Wall-clock hard TTL (design F14 / ADR-021). */
export const UNATTENDED_HARD_TTL_MS = 8 * 60 * 60 * 1000 // 8h

/** Default per-task caps (aligned with server host_computer budget max 30). */
export const UNATTENDED_DEFAULT_MAX_BUDGET = 30
export const UNATTENDED_DEFAULT_MAX_ACTIONS = 30

/** Durable pre-arm cruise snapshot — closes dual-clock across companion restart (Pi C1 nit). */
export const CRUISE_SNAPSHOT_FILENAME = "unattended-cruise-snapshot.json"

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

/** Pre-arm snapshot of durable cruise flags (C1 multi-adv dual-write lifecycle). */
export interface CruiseFlagsSnapshot {
  auto_approve_dangerous: boolean
  auto_approve_enterprise_tools: boolean
  allow_all_schemes: boolean
}

let grant: InternalGrant | null = null
/** Process-memory snapshot of cruise flags captured on arm; restored on disarm/TTL. */
let cruiseSnapshot: CruiseFlagsSnapshot | null = null
/** Optional restore handler registered by message-router (getConfig/saveConfig). */
let cruiseRestoreHandler: ((snap: CruiseFlagsSnapshot | null) => void) | null = null
let expireRestoreDone = false
/** Test override for snapshot path (avoids touching real DATA_DIR). */
let cruiseSnapshotPathOverride: string | null = null

function cruiseSnapshotFilePath(): string {
  if (cruiseSnapshotPathOverride) return cruiseSnapshotPathOverride
  return path.join(DATA_DIR, CRUISE_SNAPSHOT_FILENAME)
}

function persistCruiseSnapshotFile(flags: CruiseFlagsSnapshot): void {
  try {
    const p = cruiseSnapshotFilePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmp = `${p}.${process.pid}.tmp`
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        v: 1,
        auto_approve_dangerous: flags.auto_approve_dangerous === true,
        auto_approve_enterprise_tools: flags.auto_approve_enterprise_tools === true,
        allow_all_schemes: flags.allow_all_schemes === true,
        at: new Date().toISOString(),
      }),
      { encoding: "utf-8", mode: 0o600 },
    )
    fs.renameSync(tmp, p)
    try {
      fs.chmodSync(p, 0o600)
    } catch {
      /* best-effort */
    }
  } catch (e: any) {
    logger.warn("security.unattended_cruise_snapshot_persist_failed", {
      error: e?.message || String(e),
    })
  }
}

function clearCruiseSnapshotFile(): void {
  try {
    const p = cruiseSnapshotFilePath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    /* best-effort */
  }
}

function loadCruiseSnapshotFile(): CruiseFlagsSnapshot | null {
  try {
    const p = cruiseSnapshotFilePath()
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"))
    if (!raw || typeof raw !== "object") return null
    return {
      auto_approve_dangerous: raw.auto_approve_dangerous === true,
      auto_approve_enterprise_tools: raw.auto_approve_enterprise_tools === true,
      allow_all_schemes: raw.allow_all_schemes === true,
    }
  } catch {
    return null
  }
}

/** Test hook — wipe process grant + cruise snapshot. */
export function resetUnattendedGrantForTests(): void {
  grant = null
  cruiseSnapshot = null
  expireRestoreDone = false
  // Clear file while override still points at the test path (Pi r2 nit:
  // never unlink real DATA_DIR snapshot when override is active).
  clearCruiseSnapshotFile()
  cruiseSnapshotPathOverride = null
}

/** Test-only: redirect durable snapshot path. */
export function setCruiseSnapshotPathForTests(p: string | null): void {
  cruiseSnapshotPathOverride = p
}

/**
 * Register handler invoked when grant TTL expires or restoreCruiseFromSnapshot is called.
 * message-router / startServer should register once at boot with getConfig/saveConfig wiring.
 */
export function registerCruiseRestoreHandler(
  handler: ((snap: CruiseFlagsSnapshot | null) => void) | null,
): void {
  cruiseRestoreHandler = handler
}

/** Capture pre-arm cruise flags (call BEFORE dual-write). Also persists for restart reconcile. */
export function captureCruiseSnapshot(flags: CruiseFlagsSnapshot): void {
  cruiseSnapshot = {
    auto_approve_dangerous: flags.auto_approve_dangerous === true,
    auto_approve_enterprise_tools: flags.auto_approve_enterprise_tools === true,
    allow_all_schemes: flags.allow_all_schemes === true,
  }
  expireRestoreDone = false
  persistCruiseSnapshotFile(cruiseSnapshot)
}

export function getCruiseSnapshot(): CruiseFlagsSnapshot | null {
  return cruiseSnapshot
    ? {
        auto_approve_dangerous: cruiseSnapshot.auto_approve_dangerous,
        auto_approve_enterprise_tools: cruiseSnapshot.auto_approve_enterprise_tools,
        allow_all_schemes: cruiseSnapshot.allow_all_schemes,
      }
    : null
}

/** Drop snapshot without invoking restore handler (failed arm path). */
export function discardCruiseSnapshot(): void {
  cruiseSnapshot = null
  clearCruiseSnapshotFile()
}

/**
 * Restore pre-arm cruise snapshot via registered handler.
 * Prefer in-memory snapshot; fall back to durable file (restart residual).
 * Clears process + file snapshot after invoke.
 * @returns snap applied, or null if no snap (handler still called only when forceNull).
 */
export function restoreCruiseFromSnapshot(opts?: {
  /** When true, call handler(null) even with no snapshot (legacy clear-all). Default false. */
  forceNull?: boolean
}): CruiseFlagsSnapshot | null {
  let snap = getCruiseSnapshot()
  if (!snap) snap = loadCruiseSnapshotFile()
  cruiseSnapshot = null
  expireRestoreDone = true
  clearCruiseSnapshotFile()
  if (!snap && !opts?.forceNull) {
    return null
  }
  if (cruiseRestoreHandler) {
    try {
      cruiseRestoreHandler(snap)
    } catch (e: any) {
      logger.warn("security.unattended_cruise_restore_failed", {
        error: e?.message || String(e),
      })
    }
  }
  return snap
}

/**
 * Pure gate for message-router disarm path (Pi r2 nit — unit-testable).
 * Restore dual-write cruise only when this process had a grant/snapshot, or
 * the client explicitly asked clear_cruise (force wipe).
 */
export function shouldRestoreCruiseOnDisarm(opts: {
  had_grant: boolean
  had_snapshot: boolean
  clear_cruise: boolean
}): boolean {
  return opts.had_grant === true || opts.had_snapshot === true || opts.clear_cruise === true
}

/**
 * Boot reconcile (Pi C1 nit): grant is always process-memory-null at cold start.
 * If a durable dual-write snapshot file exists, restore pre-arm flags and delete the file.
 * Call after registerCruiseRestoreHandler. Safe before full initServices — file presence
 * implies the snapshot dir already existed (persist does mkdir recursive).
 */
export function reconcileUnattendedCruiseOnBoot(): {
  restored: boolean
  snap: CruiseFlagsSnapshot | null
} {
  if (grant) return { restored: false, snap: null }
  const snap = loadCruiseSnapshotFile()
  if (!snap) return { restored: false, snap: null }
  cruiseSnapshot = snap
  const applied = restoreCruiseFromSnapshot()
  logger.info("security.unattended.cruise_boot_reconcile", {
    restored: !!applied,
  })
  return { restored: !!applied, snap: applied }
}

function expireGrantIfNeeded(now: number): void {
  if (!grant) return
  if (now < grant.expiresAt) return
  grant = null
  // C1: TTL expire must restore dual-written cruise (once)
  if (!expireRestoreDone) {
    restoreCruiseFromSnapshot()
  }
}

export function isUnattendedArmed(now: number = Date.now()): boolean {
  expireGrantIfNeeded(now)
  return !!grant
}

export function getUnattendedStatus(now: number = Date.now()): UnattendedGrantState {
  expireGrantIfNeeded(now)
  if (!grant) {
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

/**
 * Disarm process grant. Does **not** restore cruise flags by itself —
 * caller (message-router) must call restoreCruiseFromSnapshot after disarm
 * so dual-write lifecycle is always reversed (C1 multi-adv).
 */
export function disarmUnattended(now: number = Date.now()): UnattendedGrantState & {
  /** True if a process grant existed before this call (for restore gating). */
  had_grant: boolean
} {
  const hadGrant = !!grant
  if (grant) {
    logger.info("security.unattended_disarmed", {
      was_armed_at: grant.armedAt,
      at: now,
    })
  }
  grant = null
  return { ...getUnattendedStatus(now), had_grant: hadGrant }
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
