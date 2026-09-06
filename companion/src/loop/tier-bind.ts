// L-4 (#390) 巡航档表帽路线扇出 — the cruise tier caps the loop's route
// fan-out (FINAL-SYNTHESIS L-4). ZERO new enum: tiers come from
// security/autopilot-tier deriveDisplayTier (bools stay the config SoT).
//
// Tier table (路线扇出 only — tier NEVER gates loop continuation itself):
// - off            已激活也续跑、确认照弹（扇出不受表帽；确认代数不变）
// - browser        仅 L1 面 — host surface (R3 host_computer / R4 osascript)
//                  leaves the fan-out; escalation blocks with 升档 unlock
// - full/full_protocol 已武装面 — host surface iff coordinateEnabled (L-3 资格)
// - unattended     值守 — same as full+ here; L-5 (#391) refines
// - custom         not an explicitly armed combination — host allowed iff
//                  coordinateEnabled (same as off; least surprise, no new tier)

import { platform } from "node:os"
import { getConfig } from "../config"
import {
  deriveDisplayTier,
  type AutopilotTier,
  type SecurityArmFlags,
} from "../security/autopilot-tier"

/** Config keys the tier binding reads — pin for the zero-new-config-key test. */
export const LOOP_TIER_CONFIG_KEYS = [
  "security.auto_approve_dangerous",
  "security.auto_approve_enterprise_tools",
  "security.allow_all_schemes",
  "computer.coordinateEnabled",
] as const

export function tierAllowsHostSurface(tier: AutopilotTier): boolean {
  // browser（仅 L1 面）is the only fan-out-capping tier in the L-4 table.
  return tier !== "browser"
}

export type LoopRouteCaps = {
  cuArmed: boolean
  osascriptAvailable: boolean
  /** "browser-tier" when the host surface is capped by the cruise tier (not by coordinateEnabled). */
  r3CapReason: "browser-tier" | null
  tier: AutopilotTier
}

/** Pure core — unit-testable without config I/O. */
export function routeCapsFromFlags(
  flags: SecurityArmFlags,
  opts: { coordinateEnabled: boolean; unattendedArmed: boolean },
): LoopRouteCaps {
  const tier = deriveDisplayTier(flags, opts.unattendedArmed)
  const hostAllowed = tierAllowsHostSurface(tier)
  return {
    // #417: linux has no host_computer surface — arming coordinateEnabled
    // must not report cuArmed (same caliber as site-op-memory escalatePossible).
    cuArmed: hostAllowed && opts.coordinateEnabled === true && platform() !== "linux",
    osascriptAvailable: hostAllowed && platform() === "darwin",
    r3CapReason: !hostAllowed ? "browser-tier" : null,
    tier,
  }
}

/** Config-reading wrapper (route-session call site). */
export function loopRouteCaps(unattendedArmed = false): LoopRouteCaps {
  const cfg = getConfig()
  return routeCapsFromFlags(
    {
      auto_approve_dangerous: cfg.security?.auto_approve_dangerous === true,
      auto_approve_enterprise_tools: cfg.security?.auto_approve_enterprise_tools === true,
      allow_all_schemes: cfg.security?.allow_all_schemes === true,
    },
    {
      coordinateEnabled: cfg.computer?.coordinateEnabled === true,
      unattendedArmed,
    },
  )
}
