// App tab (WP2) — WS message handlers (apps.* family), mirroring the mcp.*
// handler patterns in message-router.ts:
//   - every mutating handler validates + normalizes BEFORE replaceAppsEntries
//     (replaceAppsEntries itself does NOT validate — WP1 review note ①)
//   - prototype-pollution keys in the inbound payload are rejected
//   - mutations broadcast apps.updated (mcp.servers.updated parity) and return
//     the same payload to the requester
//   - auto-policy grants (add-auto / upgrade→auto) go through the D2 biometric
//     gate — never L2, cancel → hard deny, no fallback on cancel
//   - policy cap re-checked at write time (WP1 review note ④)
//
// Kept out of message-router.ts so tests can inject gate/enumerate/fs deps
// without touching the router.

import os from "os"
import { getConfig, replaceAppsEntries } from "../config"
import { logger } from "../logger"
import { getThreadApprovals } from "../host-use/thread-approvals"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"
import {
  APP_TOKEN_PATTERN,
  AppEntry,
  AppKind,
  AppPolicy,
  maxPolicyForEntry,
  normalizeAppEntry,
  validateAppEntry,
} from "./types"
import {
  AddFlowError,
  AddFlowWarning,
  buildAppEntry,
  type AddFlowDeps,
  type AddFlowOrigin,
} from "./add-flow"
import { enumerateApps, type EnumeratedAppCandidate } from "./enumerate"
import { basenameToVault, isLolbinPath } from "./guards"
import { materializePresets } from "./presets"
import { requireAppsBiometric } from "./biometric-gate"

export interface AppsHandlerContext {
  /** Origin-bound confirmation channel (server.ts wires { originWs: ws }). */
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
}

export interface AppsHandlerDeps extends AddFlowDeps {
  enumerate?: () => Promise<EnumeratedAppCandidate[]>
  gate?: typeof requireAppsBiometric
  platform?: NodeJS.Platform
  /**
   * WP3 obligation (owner decision 2): clear the token's thread-scoped
   * "app-launch" trust entries across all threads. Called on apps.remove,
   * apps.set_policy (any change), and apps.set_enabled(false) — the trust
   * context a user approved ("launch THIS app, as currently registered")
   * no longer holds once the entry changes or disappears.
   * Returns the number of cleared entries (for audit). Injectable for tests.
   */
  clearAppTrust?: (token: string) => number
}

/** Default trust clearer — ThreadApprovals singleton, kind "app-launch" only. */
function defaultClearAppTrust(token: string): number {
  return getThreadApprovals().clearBundle(token, "app-launch")
}

/**
 * Clear app-launch trust + audit when anything was actually cleared.
 * Called AFTER the config mutation has persisted.
 */
function clearAppLaunchTrust(token: string, deps: AppsHandlerDeps, via: string): void {
  const clear = deps.clearAppTrust ?? defaultClearAppTrust
  let cleared = 0
  try {
    cleared = clear(token)
  } catch (err: any) {
    logger.error("apps.launch_trust_clear_failed", { token, via, error: err?.message || String(err) })
    return
  }
  if (cleared > 0) {
    logger.info("apps.launch_trust_cleared", { token, via, cleared })
  }
}

const POLICY_RANK: Record<AppPolicy, number> = { manual: 0, ai: 1, auto: 2 }
const VALID_POLICIES: ReadonlySet<string> = new Set(["auto", "ai", "manual"])

// Mirrors message-router.ts's local guard (kept local — handlers must not
// reach into the router module for it).
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])
function hasPrototypePollutionKey(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false
  for (const key of Object.keys(obj)) {
    if (POLLUTION_KEYS.has(key)) return true
    const val = obj[key]
    if (typeof val === "object" && hasPrototypePollutionKey(val)) return true
  }
  return false
}

/** entries map → sorted array with the policy ceiling attached (WP4 badge). */
function entriesList(entries: Record<string, AppEntry>) {
  return Object.values(entries)
    .map((e) => ({ ...e, max_policy: maxPolicyForEntry(e) }))
    .sort((a, b) => a.added_at.localeCompare(b.added_at))
}

function appsUpdatedPayload(entries: Record<string, AppEntry>) {
  return {
    type: "apps.updated",
    enabled: getConfig().apps?.enabled ?? true,
    entries: entriesList(entries),
  }
}

function broadcastAndReturn(ctx: AppsHandlerContext, payload: any, extra?: Record<string, unknown>) {
  ctx.broadcast?.(payload)
  return extra ? { ...payload, ...extra } : payload
}

export async function handleAppsMessage(
  msg: any,
  ctx: AppsHandlerContext = {},
  deps: AppsHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg

  switch (type) {
    // --- apps.list: sanitized entries + enabled flag + lazy preset seeding ---
    case "apps.list": {
      const appsCfg = getConfig().apps ?? { enabled: true, entries: {} }
      const { entries, added, presets } = await materializePresets(appsCfg.entries, {
        exists: deps.exists,
        realpath: deps.realpath,
        signerProbe: deps.signerProbe,
      })
      if (added.length > 0) {
        replaceAppsEntries(entries)
        logger.info("apps.preset_detected", { tokens: added })
      }
      const after = getConfig().apps ?? { enabled: true, entries }
      return {
        type: "apps.list",
        enabled: after.enabled,
        entries: entriesList(after.entries),
        presets,
      }
    }

    // --- apps.enumerate: merged running/startapps candidates (Windows only) ---
    case "apps.enumerate": {
      const platform = deps.platform ?? os.platform()
      if (platform !== "win32") {
        return { type: "error", error: "apps.enumerate is supported on Windows (win32) only" }
      }
      const run = deps.enumerate ?? (() => enumerateApps())
      const candidates = await run()
      // Annotate with guard verdicts so the panel can grey out hard-denied
      // candidates and badge vault-mapped ones BEFORE the user picks them.
      const annotated = candidates.map((c) => {
        if (!c.path) return { ...c, blocked: false as const }
        const lolbin = isLolbinPath(c.path)
        const vaultToken = basenameToVault(c.path)
        return {
          ...c,
          blocked: lolbin,
          ...(lolbin ? { block_reason: "lolbin" as const } : {}),
          ...(vaultToken ? { vault_token: vaultToken } : {}),
        }
      })
      return { type: "apps.enumerate.result", candidates: annotated }
    }

    // --- apps.add: enumeration pick OR manual paste → validated entry --------
    case "apps.add": {
      if (hasPrototypePollutionKey(rest)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      const kind: AppKind = rest.kind === "cli" ? "cli" : "gui"
      if (kind !== "gui") {
        return {
          type: "error",
          error: "apps.add: kind \"cli\" is Phase-2 (P1 supports gui only)",
          code: "CLI_PHASE2",
        }
      }
      const policy = rest.policy === undefined ? "manual" : String(rest.policy)
      if (!VALID_POLICIES.has(policy)) {
        return { type: "error", error: `Invalid policy "${policy}" (must be auto, ai, or manual)`, code: "INVALID_POLICY" }
      }
      const origin: AddFlowOrigin =
        rest.origin === "enumerate" || rest.origin === "manual-paste"
          ? rest.origin
          : (rest.path ? "manual-paste" : "enumerate")

      const existing = getConfig().apps?.entries ?? {}
      let entry: AppEntry
      let warnings: AddFlowWarning[]
      try {
        const built = await buildAppEntry(
          {
            kind,
            path: typeof rest.path === "string" ? rest.path : undefined,
            aumid: typeof rest.aumid === "string" ? rest.aumid : undefined,
            displayName: typeof rest.display_name === "string" ? rest.display_name : undefined,
            origin,
            existingEntries: existing,
            policy: "manual", // requested policy applied only after the gates below
          },
          deps,
        )
        entry = built.entry
        warnings = built.warnings
      } catch (e: any) {
        if (e instanceof AddFlowError) {
          logger.warn("apps.add_denied", { code: e.code, error: e.message })
          return { type: "error", error: e.message, code: e.code }
        }
        throw e
      }

      // Policy ceiling re-checked at write time (WP1 review note ④). AUMID
      // entries always cap "ai" (note ⑤) — maxPolicyForEntry encodes both.
      const cap = maxPolicyForEntry(entry)
      if (POLICY_RANK[policy as AppPolicy] > POLICY_RANK[cap]) {
        return {
          type: "error",
          error: `policy "${policy}" exceeds the maximum allowed for this app ("${cap}" — unsigned binary, user-writable directory, or AUMID)`,
          code: "POLICY_CAP_EXCEEDED",
          cap,
        }
      }

      // D2: auto is a persistent grant → biometric gate (Hello + manual-nonce
      // fallback; cancel → hard deny, never L2, no confirmation → no grant).
      if (policy === "auto") {
        if (!ctx.requestConfirmation) {
          return {
            type: "error",
            error: "apps.add with policy \"auto\" requires an interactive confirmation channel",
            code: "NO_CONFIRMATION_CHANNEL",
          }
        }
        const gate = deps.gate ?? requireAppsBiometric
        const outcome = await gate({
          action: "apps.add",
          reason: `Add "${entry.display_name}" as an auto-launch app`,
          requestConfirmation: ctx.requestConfirmation,
        })
        if (!outcome.approved) {
          logger.warn("apps.add_auto_denied", { token: entry.token, reason: outcome.reason })
          return {
            type: "error",
            error: `auto policy ${outcome.reason === "cancelled" ? "cancelled by user" : `denied (${outcome.reason})`} — app was NOT added`,
            code: "BIOMETRIC_DENIED",
            reason: outcome.reason,
          }
        }
        logger.info("apps.add_auto_approved", {
          token: entry.token,
          display_name: entry.display_name,
          method: outcome.method,
        })
      }

      const finalEntry = normalizeAppEntry({ ...entry, policy: policy as AppPolicy })
      const schemaErr = validateAppEntry(finalEntry)
      if (schemaErr) return { type: "error", error: schemaErr } // belt — unreachable
      const newEntries = { ...existing, [finalEntry.token]: finalEntry }
      replaceAppsEntries(newEntries)
      logger.info("apps.added", {
        token: finalEntry.token,
        kind: finalEntry.kind,
        source: finalEntry.source,
        policy: finalEntry.policy,
        origin,
        warnings: warnings.map((w) => w.code),
      })
      return broadcastAndReturn(ctx, appsUpdatedPayload(newEntries), {
        added: finalEntry.token,
        entry: finalEntry,
        warnings,
      })
    }

    // --- apps.remove: immediate; preset entries can only be disabled ---------
    case "apps.remove": {
      const token = String(rest.token || "")
      if (!APP_TOKEN_PATTERN.test(token)) {
        return { type: "error", error: `Invalid app token "${token}"`, code: "INVALID_TOKEN" }
      }
      const existing = getConfig().apps?.entries ?? {}
      const entry = existing[token]
      if (!entry) return { type: "error", error: `App "${token}" not found`, code: "NOT_FOUND" }
      if (entry.source === "preset") {
        return {
          type: "error",
          error: `preset app "${token}" cannot be removed — disable it instead`,
          code: "PRESET_NOT_REMOVABLE",
        }
      }
      const newEntries = { ...existing }
      delete newEntries[token]
      replaceAppsEntries(newEntries)
      logger.info("apps.removed", { token, display_name: entry.display_name })
      // WP3 obligation (owner decision 2): a removed app's "app-launch"
      // thread-trust entries must die with it — a re-added app (same token,
      // new binary) must NOT inherit launches approved for the old entry.
      clearAppLaunchTrust(token, deps, "apps.remove")
      return broadcastAndReturn(ctx, appsUpdatedPayload(newEntries), { removed: token })
    }

    // --- apps.set_policy: downgrade free; →auto gated + cap enforced ---------
    case "apps.set_policy": {
      const token = String(rest.token || "")
      if (!APP_TOKEN_PATTERN.test(token)) {
        return { type: "error", error: `Invalid app token "${token}"`, code: "INVALID_TOKEN" }
      }
      const policy = String(rest.policy || "")
      if (!VALID_POLICIES.has(policy)) {
        return { type: "error", error: `Invalid policy "${policy}" (must be auto, ai, or manual)`, code: "INVALID_POLICY" }
      }
      const existing = getConfig().apps?.entries ?? {}
      const entry = existing[token]
      if (!entry) return { type: "error", error: `App "${token}" not found`, code: "NOT_FOUND" }
      const current = entry.policy
      if (current === policy) {
        return broadcastAndReturn(ctx, appsUpdatedPayload(existing), { token, policy, changed: false })
      }
      // Write-time cap re-check (WP1 review note ④) — even a "downgrade"
      // request is validated so a tampered exe block can't smuggle auto.
      const cap = maxPolicyForEntry(entry)
      if (POLICY_RANK[policy as AppPolicy] > POLICY_RANK[cap]) {
        return {
          type: "error",
          error: `policy "${policy}" exceeds the maximum allowed for this app ("${cap}" — unsigned binary, user-writable directory, or AUMID)`,
          code: "POLICY_CAP_EXCEEDED",
          cap,
        }
      }
      // D2: upgrade →auto requires the biometric gate. Downgrades and
      // manual↔ai moves below auto are free (design §1: policy 降级自由).
      if (policy === "auto") {
        if (!ctx.requestConfirmation) {
          return {
            type: "error",
            error: "upgrade to \"auto\" requires an interactive confirmation channel",
            code: "NO_CONFIRMATION_CHANNEL",
          }
        }
        const gate = deps.gate ?? requireAppsBiometric
        const outcome = await gate({
          action: "apps.set_policy",
          reason: `Upgrade "${entry.display_name}" to auto-launch`,
          requestConfirmation: ctx.requestConfirmation,
        })
        if (!outcome.approved) {
          logger.warn("apps.policy_upgrade_denied", { token, from: current, reason: outcome.reason })
          return {
            type: "error",
            error: `policy upgrade ${outcome.reason === "cancelled" ? "cancelled by user" : `denied (${outcome.reason})`} — policy unchanged`,
            code: "BIOMETRIC_DENIED",
            reason: outcome.reason,
          }
        }
        logger.info("apps.set_policy_auto_approved", { token, from: current, method: outcome.method })
      }
      const updated = normalizeAppEntry({ ...entry, policy: policy as AppPolicy })
      const schemaErr = validateAppEntry(updated)
      if (schemaErr) return { type: "error", error: schemaErr }
      const newEntries = { ...existing, [token]: updated }
      replaceAppsEntries(newEntries)
      logger.info("apps.policy_changed", { token, from: current, to: policy, gated: policy === "auto" })
      // WP3 obligation: ANY policy change invalidates the "app-launch" trust
      // context (the user approved launches under the OLD policy). Clearing
      // on upgrade→auto is belt-and-braces (auto never consults trust).
      clearAppLaunchTrust(token, deps, "apps.set_policy")
      return broadcastAndReturn(ctx, appsUpdatedPayload(newEntries), { token, policy, changed: true })
    }

    // --- apps.set_enabled: free both directions ------------------------------
    case "apps.set_enabled": {
      const token = String(rest.token || "")
      if (!APP_TOKEN_PATTERN.test(token)) {
        return { type: "error", error: `Invalid app token "${token}"`, code: "INVALID_TOKEN" }
      }
      if (typeof rest.enabled !== "boolean") {
        return { type: "error", error: "apps.set_enabled requires boolean enabled", code: "INVALID_ENABLED" }
      }
      const existing = getConfig().apps?.entries ?? {}
      const entry = existing[token]
      if (!entry) return { type: "error", error: `App "${token}" not found`, code: "NOT_FOUND" }
      const newEntries = { ...existing, [token]: { ...entry, enabled: rest.enabled } }
      replaceAppsEntries(newEntries)
      logger.info("apps.enabled_changed", { token, enabled: rest.enabled })
      // WP3 obligation: disabling clears "app-launch" trust — re-enabling
      // must NOT resurrect it (the disable→enable window may have replaced
      // the binary; the user re-approves via the next L2 dialog).
      if (rest.enabled === false) {
        clearAppLaunchTrust(token, deps, "apps.set_enabled")
      }
      return broadcastAndReturn(ctx, appsUpdatedPayload(newEntries), { token, enabled: rest.enabled })
    }

    default:
      return { type: "error", error: `Unknown apps message type: ${type}` }
  }
}
