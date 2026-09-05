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

/**
 * Composer picker slots — AutopilotArmPick minus unattended, plus off.
 * UI view only; three bools remain config SoT. Do not persist this union.
 */
export const COMPOSER_CRUISE_SLOTS = ["off", "browser", "full", "full_protocol"] as const
export type ComposerCruiseSlot = (typeof COMPOSER_CRUISE_SLOTS)[number]

/** Lock-step with companion SECURITY_ARM_CONFIRM_PHRASE / Settings GODMODE_CONFIRM_PHRASE. */
export const AUTOPILOT_ARM_PHRASE = "我了解风险"

/** v1 composer cruise is machine-global, not per-thread. */
export const COMPOSER_CRUISE_SCOPE_NOTE = "对本机全部对话生效"

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
 * SafetyStrip / Settings / rail title+aria.
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

/**
 * StatusRail 320px chip — two hanzi. Full `trustStatusChip` stays on
 * title/aria and SafetyStrip so 解除 remains named, not buried.
 */
export function trustStatusChipShort(
  flags: SecurityArmFlags,
  unattendedArmed: boolean,
): string | null {
  if (unattendedArmed) return "值守"
  if (deriveAutopilotTier(flags) === "off") return null
  return "巡航"
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

/** Chip text: 100% live deriveAutopilotTier. Never cache; never prefer unattended. */
export function composerCruiseChipLabel(flags: SecurityArmFlags): string {
  return tierShortLabel(deriveAutopilotTier(flags))
}

/**
 * Canonical flags for a composer slot.
 * Browser does not inherit enterprise (otherwise picking 网页巡航 from 全自动
 * would still derive as full via targetFlagsForTier's keep-enterprise).
 */
export function composerSlotFlags(slot: ComposerCruiseSlot): Required<SecurityArmFlags> {
  if (slot === "off") return disarmAllFlags()
  return targetFlagsForTier(slot, { auto_approve_enterprise_tools: false })
}

export function composerPickNeedsArm(
  current: SecurityArmFlags,
  slot: ComposerCruiseSlot,
): boolean {
  return flagsNeedingArm(current, composerSlotFlags(slot)).length > 0
}

export type ComposerCruiseWrite = {
  flag: keyof Required<SecurityArmFlags>
  value: boolean
  needsPhrase: boolean
}

/** Disarm first, then arm — same order as Settings applySecurityFlagsTarget. */
export function composerSlotWrites(
  current: SecurityArmFlags,
  slot: ComposerCruiseSlot,
): ComposerCruiseWrite[] {
  const target = composerSlotFlags(slot)
  const out: ComposerCruiseWrite[] = []
  for (const k of flagsNeedingDisarm(current, target)) {
    out.push({ flag: k, value: false, needsPhrase: false })
  }
  for (const k of flagsNeedingArm(current, target)) {
    out.push({ flag: k, value: true, needsPhrase: true })
  }
  return out
}

export const AUTOPILOT_CONSEQUENCE_ROWS: Array<{
  family: string
  browser: string
  full: string
  protocol: string
  unattended: string
}> = [
  {
    // auto_approve_dangerous alone skips navigate / create_tab / set_tab_url L2.
    family: "导航 L2（navigate / create_tab / set_tab_url）",
    browser: "跳过",
    full: "跳过",
    protocol: "跳过",
    unattended: "跳过",
  },
  {
    // evaluate / osascript_eval keep forceConfirm unless three-flag (protocol) cruise.
    // Default 值守 dual-writes dangerous+enterprise only — NOT allow_all_schemes.
    family: "evaluate / osascript L2",
    browser: "仍确认",
    full: "仍确认",
    protocol: "跳过§",
    unattended: "仍确认††",
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
    protocol: "可跳过§",
    unattended: "静默‡",
  },
  {
    family: "host_computer 危险/实验/让出 re-L2",
    browser: "仍确认",
    full: "仍确认",
    protocol: "仍确认",
    unattended: "静默‡",
  },
  {
    family: "spawn / ask_user / shell / skill_install",
    browser: "仍确认",
    full: "shell 跳过*",
    protocol: "跳过·高风险",
    unattended: "跳过·高风险§",
  },
  {
    family: "Cookie 读写",
    browser: "须信任域",
    full: "须信任域",
    protocol: "跳过·高风险§",
    unattended: "跳过·高风险§",
  },
]

export const UNATTENDED_MATRIX_FOOTNOTES =
  "‡ 值守武装=风险自担：仅白名单且已开坐标的 App；任务级 L2 与 mid-task re-L2（含危险/实验/前台让出）均静默；键入不再逐字预览；支付/验证码等硬拒绝仍直接失败、不弹窗。" +
  "† 勾选「同时协议解锁」才放行非 http(s)（武装时精确写入 allow_all_schemes）。" +
  "†† 默认无人值守 dual-write 仅网页+企业两旗（dangerous+enterprise），**不**写 allow_all_schemes，故 evaluate / osascript 仍 forceConfirm；仅三旗全开（协议勾选或「全自动+协议」）才 waive evaluate。值守本身不替代三旗。" +
  "* 须 enterprise 模块与范围。" +
  "§ 全自动+协议三旗全开（dangerous+enterprise+allow_all_schemes）时：用户已接受最大风险，L2/critical/ cookie 信任域门不再二次确认；解除武装或关掉任一旗即恢复。" +
  " 无人值守会 dual-write 持久巡航，解除武装才清；桌面 grant 进程内存 8h，重启失效。"