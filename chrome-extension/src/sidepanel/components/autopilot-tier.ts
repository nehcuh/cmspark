// Trust IA / Autopilot — pure tier derivation over existing security bools.
// Design SoT: docs/superpowers/specs/2026-08-02-trust-ia-autopilot-design.md §5.2
// Wire SoT remains companion security.* flags; this is UI packaging only (ADR-020 Trust).

export type AutopilotTier =
  | "off"
  | "browser"
  | "full"
  | "full_protocol"
  | "custom"

export interface SecurityArmFlags {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}

/** Derive display tier from orthogonal flags (bools remain SoT). */
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
    case "custom":
      return "自定义"
  }
}

/** Chip label when any arm flag is on. */
export function cruiseChipLabel(flags: SecurityArmFlags): string | null {
  const tier = deriveAutopilotTier(flags)
  if (tier === "off") return null
  return `巡航中 · ${tierShortLabel(tier)}`
}

/**
 * Target flag set for arming a selectable tier.
 * - browser: only set dangerous true; force protocol off; do not touch enterprise (caller merges).
 * - full / full_protocol: set all three explicitly.
 */
export function targetFlagsForTier(
  tier: "browser" | "full" | "full_protocol",
  current: SecurityArmFlags,
): Required<SecurityArmFlags> {
  if (tier === "browser") {
    return {
      auto_approve_dangerous: true,
      // Do not clear enterprise if already on — results in custom tier (locked design).
      auto_approve_enterprise_tools: current.auto_approve_enterprise_tools === true,
      allow_all_schemes: false,
    }
  }
  if (tier === "full") {
    return {
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    }
  }
  return {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  }
}

/** P1-A disarm: clear all three. */
export function disarmAllFlags(): Required<SecurityArmFlags> {
  return {
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
  }
}

/** Which flags need false→true arm (require phrase). */
export function flagsNeedingArm(
  current: SecurityArmFlags,
  target: Required<SecurityArmFlags>,
): Array<keyof Required<SecurityArmFlags>> {
  const keys: Array<keyof Required<SecurityArmFlags>> = [
    "auto_approve_dangerous",
    "auto_approve_enterprise_tools",
    "allow_all_schemes",
  ]
  return keys.filter((k) => target[k] === true && current[k] !== true)
}

/** Which flags need true→false disarm (no phrase). */
export function flagsNeedingDisarm(
  current: SecurityArmFlags,
  target: Required<SecurityArmFlags>,
): Array<keyof Required<SecurityArmFlags>> {
  const keys: Array<keyof Required<SecurityArmFlags>> = [
    "auto_approve_dangerous",
    "auto_approve_enterprise_tools",
    "allow_all_schemes",
  ]
  return keys.filter((k) => target[k] === false && current[k] === true)
}

export const AUTOPILOT_CONSEQUENCE_ROWS: Array<{
  family: string
  browser: string
  full: string
  protocol: string
}> = [
  {
    family: "网页 evaluate / 导航 L2",
    browser: "跳过",
    full: "跳过",
    protocol: "跳过",
  },
  {
    family: "非 http(s) 协议 (L1)",
    browser: "仍阻断",
    full: "仍阻断",
    protocol: "跳过·高风险",
  },
  {
    family: "shell / netsec（有范围+模块）",
    browser: "仍确认",
    full: "跳过*",
    protocol: "跳过*",
  },
  {
    family: "host_computer / spawn",
    browser: "仍确认",
    full: "仍确认",
    protocol: "仍确认",
  },
  {
    family: "Cookie / 工作区绑定",
    browser: "不涉及",
    full: "不涉及",
    protocol: "不涉及",
  },
]
