/**
 * Overlay cruise-chip labels — lockstep with
 * chrome-extension/src/sidepanel/components/autopilot-tier.ts
 * (deriveAutopilotTier + tierShortLabel + trustStatusChip).
 *
 * Bools remain cruise SoT (trust-ia D6). This module is a view: it never
 * writes flags. Overlay/Swift must display the returned string and must not
 * re-derive from three bools.
 *
 * GitHub: #324
 */

export type AutopilotTier =
  | "off"
  | "browser"
  | "full"
  | "full_protocol"
  | "unattended"
  | "custom"

export interface SecurityArmFlags {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}

/** Derive display tier from orthogonal flags (bools remain SoT for cruise). */
export function deriveAutopilotTier(flags: SecurityArmFlags): AutopilotTier {
  const d = flags.auto_approve_dangerous === true
  const e = flags.auto_approve_enterprise_tools === true
  const g = flags.allow_all_schemes === true

  if (!d && !e && !g) return "off"
  if (d && !e && !g) return "browser"
  if (d && e && !g) return "full"
  if (d && e && g) return "full_protocol"
  return "custom"
}

export function deriveDisplayTier(
  flags: SecurityArmFlags,
  unattendedArmed: boolean,
): AutopilotTier {
  if (unattendedArmed) return "unattended"
  return deriveAutopilotTier(flags)
}

export function tierShortLabel(tier: AutopilotTier): string {
  switch (tier) {
    case "off":
      return "每次确认"
    case "browser":
      return "网页巡航"
    case "full":
      return "全自动巡航"
    case "full_protocol":
      return "全自动+协议"
    case "unattended":
      return "无人值守"
    case "custom":
      return "自定义"
  }
}

/**
 * Overlay chip copy. Always a string (unlike SafetyStrip which hides off).
 * Unattended takes priority (trust-ia D2 / display tier).
 */
export function overlayCruiseChipLabel(
  flags: SecurityArmFlags,
  unattendedArmed: boolean,
): string {
  if (unattendedArmed) return "值守中 · 桌面"
  const tier = deriveAutopilotTier(flags)
  if (tier === "off") return "每次确认"
  return `巡航中 · ${tierShortLabel(tier)}`
}

/** Wire / Swift cap — display only; extra bytes are stripped, not interpreted. */
export const OVERLAY_CRUISE_LABEL_MAX = 40

export function sanitizeOverlayCruiseLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, OVERLAY_CRUISE_LABEL_MAX)
  return t || undefined
}
