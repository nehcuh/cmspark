// Trust IA / Autopilot — pure tier derivation over security bools + unattended grant.
// Design: Trust IA 2026-08-02 + ADR-021 unattended desktop.
// Wire SoT: companion security.* flags + process-memory unattended grant (not config).

export type AutopilotTier =
  | "off"
  | "browser"
  | "full"
  | "full_protocol"
  | "unattended"
  | "custom"

/** Selectable arm targets in Settings (not off/custom). */
export type AutopilotArmPick = "browser" | "full" | "full_protocol" | "unattended"

export interface SecurityArmFlags {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}

export interface UnattendedStatus {
  armed: boolean
  armedAt?: number | null
  expiresAt?: number | null
  includeProtocol?: boolean
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

/**
 * Display tier when unattended grant may override cruise label.
 * Unattended is process grant — prefer showing 值守 when armed even if flags custom.
 */
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
 * StatusRail / SafetyStrip chip.
 * Unattended takes priority over cruise (design §2.2).
 */
export function trustStatusChip(
  flags: SecurityArmFlags,
  unattendedArmed: boolean,
): string | null {
  if (unattendedArmed) return "值守中 · 桌面"
  const tier = deriveAutopilotTier(flags)
  if (tier === "off") return null
  return `巡航中 · ${tierShortLabel(tier)}`
}

/** @deprecated use trustStatusChip — kept for call sites that only have flags */
export function cruiseChipLabel(flags: SecurityArmFlags): string | null {
  return trustStatusChip(flags, false)
}

/**
 * Target cruise flags for arming a selectable tier.
 * unattended dual-writes full (web+enterprise); protocol only if includeProtocol.
 */
export function targetFlagsForTier(
  tier: AutopilotArmPick,
  current: SecurityArmFlags,
  opts?: { includeProtocol?: boolean },
): Required<SecurityArmFlags> {
  if (tier === "browser") {
    return {
      auto_approve_dangerous: true,
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
  if (tier === "full_protocol") {
    return {
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    }
  }
  // unattended: package full cruise; protocol optional
  return {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: opts?.includeProtocol === true,
  }
}

/** P1-A disarm: clear all three cruise flags. */
export function disarmAllFlags(): Required<SecurityArmFlags> {
  return {
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
  }
}

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
  unattended: string
}> = [
  {
    family: "网页 evaluate / 导航 L2",
    browser: "跳过",
    full: "跳过",
    protocol: "跳过",
    unattended: "跳过",
  },
  {
    family: "非 http(s) 协议 (L1)",
    browser: "仍阻断",
    full: "仍阻断",
    protocol: "跳过·高风险",
    unattended: "默认阻断†",
  },
  {
    family: "shell / netsec（有范围+模块）",
    browser: "仍确认",
    full: "跳过*",
    protocol: "跳过*",
    unattended: "跳过*",
  },
  {
    family: "host_computer 初始 L2",
    browser: "仍确认",
    full: "仍确认",
    protocol: "仍确认",
    unattended: "跳过‡",
  },
  {
    family: "host_computer 危险/实验/让出 re-L2",
    browser: "仍确认",
    full: "仍确认",
    protocol: "仍确认",
    unattended: "仍确认",
  },
  {
    family: "spawn / ask_user",
    browser: "仍确认",
    full: "仍确认",
    protocol: "仍确认",
    unattended: "仍确认",
  },
  {
    family: "Cookie / 工作区绑定",
    browser: "不涉及",
    full: "不涉及",
    protocol: "不涉及",
    unattended: "不涉及",
  },
]

export const UNATTENDED_MATRIX_FOOTNOTES =
  "‡ 仅白名单且已开坐标的 App；键入内容执行前不再逐字预览。† 勾选「同时协议解锁」才放行非 http(s)。* 须 enterprise 模块与范围。"
