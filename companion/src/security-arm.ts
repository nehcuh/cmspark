/**
 * P1-1: Companion step-up for arming dangerous security flags via config.set.
 *
 * Design A — keep config.set; false→true for the three flags requires a top-level
 * `confirmation_phrase` matching SECURITY_ARM_CONFIRM_PHRASE. Disarm (true→false)
 * and re-send already-true (Settings full Save snapshot) do not need a phrase.
 *
 * Lock-step: chrome-extension SettingsSlideout GODMODE_CONFIRM_PHRASE / ENT_B_PHRASE
 * must use the same literal. config.json out-of-band edit remains ADR-010 path
 * (no WS gate).
 */

/** Shared step-up phrase — must match extension Settings UI constants. */
export const SECURITY_ARM_CONFIRM_PHRASE = "我了解风险"

export const SECURITY_ARM_FLAGS = [
  "allow_all_schemes",
  "auto_approve_dangerous",
  "auto_approve_enterprise_tools",
] as const

export type SecurityArmFlag = (typeof SECURITY_ARM_FLAGS)[number]

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1
}

/**
 * Flags present in `proposed` that transition from not-true → true relative to `current`.
 * Only keys present on `proposed` are considered (partial security objects).
 */
export function findArmingSecurityFlags(
  proposed: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
): SecurityArmFlag[] {
  if (!proposed || typeof proposed !== "object") return []
  const cur = current && typeof current === "object" ? current : {}
  const arming: SecurityArmFlag[] = []
  for (const key of SECURITY_ARM_FLAGS) {
    if (!(key in proposed)) continue
    if (isTruthyFlag(proposed[key]) && !isTruthyFlag(cur[key])) {
      arming.push(key)
    }
  }
  return arming
}

/**
 * Flags present in `proposed` that transition from true → not-true relative to `current`.
 * Only keys present on `proposed` are considered (partial security objects).
 */
export function findDisarmingSecurityFlags(
  proposed: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
): SecurityArmFlag[] {
  if (!proposed || typeof proposed !== "object") return []
  const cur = current && typeof current === "object" ? current : {}
  const disarming: SecurityArmFlag[] = []
  for (const key of SECURITY_ARM_FLAGS) {
    if (!(key in proposed)) continue
    if (!isTruthyFlag(proposed[key]) && isTruthyFlag(cur[key])) {
      disarming.push(key)
    }
  }
  return disarming
}

export function isValidSecurityArmPhrase(phrase: unknown): boolean {
  return typeof phrase === "string" && phrase.trim() === SECURITY_ARM_CONFIRM_PHRASE
}

export function securityArmRejectedError(flags: SecurityArmFlag[]): string {
  // Do not echo the phrase literal on the wire (UI already shows it; static phrase is not a secret).
  return (
    `Arming security flags (${flags.join(", ")}) requires a valid top-level confirmation_phrase ` +
    `(Settings phrase step-up). Disarm and already-armed resend do not need a phrase.`
  )
}
