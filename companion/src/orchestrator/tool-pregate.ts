// ADR-015 multi-agent pre-gate for createToolExecutor.
// Extracted from server.ts (C10 Phase F mechanical split) — zero behavior change.
//
// FREEZE: multi-agent / tab-lease / host_computer chrome gates live HERE.
// Do NOT re-inflate createToolExecutor with this block.
// Cookie/URL → tool/url-cookie-admission.ts; L2 → tool/l2-admission.ts;
// image → tool/image-fetch-admission.ts; browser_download → tool/browser-download-admission.ts;
// MCP → mcp/dispatch.ts.

import { logger } from "../logger"
import { TAB_LEASE_TOOLS } from "./constants"
import {
  anyTabLeaseHeld,
  acquireOrRenewTabLease,
  sweepExpired,
} from "./tab-lease"
import { isMultiAgentThread } from "./spawn"

export type ToolPregateResult =
  | { ok: true; finalParams: Record<string, any> }
  | { ok: false; result: { success: false; error: string; data?: any } }

export type ToolPregateCtx = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  actingThreadId?: string
  isOutboundMcpCall: boolean
  logToolFinish: (
    toolCallId: string,
    toolName: string,
    startedAt: number,
    result: any,
  ) => void
  getThreadManager: () => import("../threads/thread-manager").ThreadManager | null | undefined
  hasPendingForTab: (tabId: number, holderThreadId: string) => boolean
  toolDisplayNameZh: (toolName: string) => string
}

/**
 * Optional overrides for unit tests only. Production omits this argument and uses
 * real orchestrator leaf modules (static imports above + dynamic dual-entry / copy).
 */
export type ToolPregateDeps = {
  TAB_LEASE_TOOLS?: Set<string>
  isMultiAgentThread?: typeof isMultiAgentThread
  anyTabLeaseHeld?: typeof anyTabLeaseHeld
  acquireOrRenewTabLease?: typeof acquireOrRenewTabLease
  sweepExpired?: typeof sweepExpired
  sidePanelWinsReleaseOutboundLease?: (
    tabId: number,
    actingThreadId?: string,
  ) => void
  sceneToolNotAllowedError?: (
    toolLabelZh: string,
    packId: string | null,
  ) => string
  /** When set, invoked at the start of the gate body so tests can force fail-closed. */
  forceThrow?: () => void
}

/**
 * ADR-015 Q4: tab leases are Chrome/Chromium-family tabs. Pixel CU on a vault
 * browser window races the CDP holder. Match **params.app only** (not task
 * text — "knowledge" must not trip "edge").
 */
const VAULT_BROWSER_APP_NEEDLES = [
  "chrome",
  "chromium",
  "safari",
  "msedge",
  "edgemac",
  "microsoft edge",
  "brave",
  "firefox",
  "mozilla",
  "opera",
  "vivaldi",
  "thebrowser",
] as const

export function hostComputerAppHintsVaultBrowser(params: Record<string, unknown> | null | undefined): boolean {
  const app = String(params?.app ?? "").toLowerCase()
  if (!app) return false
  if (VAULT_BROWSER_APP_NEEDLES.some((n) => app.includes(n))) return true
  if (/(^|[._\s-])arc($|[._\s-])/.test(app)) return true
  if (/(^|[._\s-])edge($|[._\s-])/.test(app)) return true
  return false
}

/**
 * ADR-015 multi-agent gates before cookie/L2/dispatch:
 * - sweepExpired tab leases
 * - sidePanelWinsReleaseOutboundLease
 * - worker paused / isToolAllowed (pack whitelist + HARD_DENY)
 * - TAB_ID_REQUIRED in multi-agent
 * - __require_tab_id flag
 * - early HARD tab lease acquire
 * - host_computer + Chrome while leases held
 * Fail-closed on exception → ORCHESTRATOR_GATE_ERROR
 */
export async function runMultiAgentToolPregate(
  ctx: ToolPregateCtx,
  deps?: ToolPregateDeps,
): Promise<ToolPregateResult> {
  const {
    toolName,
    toolCallId,
    startedAt,
    actingThreadId,
    isOutboundMcpCall,
    logToolFinish,
    getThreadManager,
    hasPendingForTab,
    toolDisplayNameZh,
  } = ctx
  let finalParams = ctx.finalParams

  const tabLeaseTools = deps?.TAB_LEASE_TOOLS ?? TAB_LEASE_TOOLS
  const isMa = deps?.isMultiAgentThread ?? isMultiAgentThread
  const anyHeld = deps?.anyTabLeaseHeld ?? anyTabLeaseHeld
  const acquire = deps?.acquireOrRenewTabLease ?? acquireOrRenewTabLease
  const sweep = deps?.sweepExpired ?? sweepExpired

  try {
    if (deps?.forceThrow) deps.forceThrow()

    sweep({ hasPendingForTab })

    // ADR-022 L9: Side Panel wins — if non-outbound actor targets a tab held
    // by outbound_mcp:*, force-release so dual-entry does not thrash.
    if (
      !isOutboundMcpCall &&
      tabLeaseTools.has(toolName) &&
      typeof finalParams.tabId === "number"
    ) {
      try {
        if (deps?.sidePanelWinsReleaseOutboundLease) {
          deps.sidePanelWinsReleaseOutboundLease(finalParams.tabId, actingThreadId)
        } else {
          const { sidePanelWinsReleaseOutboundLease } = await import(
            "../outbound-mcp/dual-entry"
          )
          sidePanelWinsReleaseOutboundLease(finalParams.tabId, actingThreadId)
        }
      } catch {
        /* best-effort */
      }
    }

    // ADR-022 L8/L9 adversary B1: outbound injects synthetic __thread_id
    // (`outbound_mcp:<caller>`) for lease holder identity, but that id is NOT a
    // ThreadManager thread — isToolAllowed would always deny. Outbound surface is
    // already gated by gateOutboundCall + disclosure + dual-entry lease; skip the
    // multi-agent / pack whitelist path for isOutboundMcpCall.
    const threadManager = getThreadManager()
    if (actingThreadId && threadManager && !isOutboundMcpCall) {
      const th = threadManager.get(actingThreadId) as any
      if (th?.paused) {
        const result = {
          success: false as const,
          error: `worker_paused:${actingThreadId} — resume before dispatching tools`,
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return { ok: false, result }
      }
      // isToolAllowed hard gate (Mission Pack / scene tool surface)
      // Orthogonal to god-mode / auto_approve (ADR-014 + scene UX SoT).
      if (!threadManager.isToolAllowed(actingThreadId, toolName)) {
        const packId = typeof th?.mission_pack_id === "string" ? th.mission_pack_id : null
        const toolLabel = toolDisplayNameZh(toolName)
        let sceneHint: string
        if (deps?.sceneToolNotAllowedError) {
          sceneHint = deps.sceneToolNotAllowedError(toolLabel, packId)
        } else {
          const { sceneToolNotAllowedError } = await import("../capability/user-gate-copy")
          sceneHint = sceneToolNotAllowedError(toolLabel, packId)
        }
        const result = {
          success: false as const,
          error: sceneHint,
          data: {
            error_code: "tool_not_allowed",
            error_level: "recoverable" as const,
            tool_name: toolName,
            mission_pack_id: packId,
            suggested_action: packId ? "unapply_pack" : "check_tool_whitelist",
            user_hint_zh: sceneHint.split("\n")[0],
          },
        }
        logger.warn("security.tool_whitelist_blocked", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          thread_id: actingThreadId,
          mission_pack_id: packId,
        })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return { ok: false, result }
      }
      const multi = isMa(th) || anyHeld()
      if (tabLeaseTools.has(toolName) && multi && typeof finalParams.tabId !== "number") {
        const result = {
          success: false as const,
          error:
            "TAB_ID_REQUIRED: multi-agent mode forbids silent active-tab; pass explicit numeric tabId",
          data: { error_code: "TAB_ID_REQUIRED" },
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return { ok: false, result }
      }
      if (multi) {
        // Defense-in-depth for extension screenshot/analyze_image fallback
        ;(finalParams as any).__require_tab_id = true
      }
      // Early exclusive HARD for tab tools — multi-agent only (ADR-015).
      // Outbound MCP already leased in companion-http (L9); skip double-acquire here
      // when isOutboundMcpCall (holder is outbound_mcp:*).
      // Normal single-agent chats must not take per-worker tab leases: browse /
      // AppSec often opens many tabs and max_tabs_leased_per_worker=2 would
      // hard-fail as non_recoverable (thread 1gfd6t). When any multi-agent
      // lease is already held, multi is true so exclusivity still covers peers.
      // GATE2: auto-approve / domain-whitelist / god-mode must still hold exclusive
      // lease — previously willEnterL2 skipped HARD and skipConfirmation skipped SOFT.
      // Interactive L2 path upgrades same-holder HARD → HELD_PENDING_L2 below.
      if (
        multi &&
        !isOutboundMcpCall &&
        tabLeaseTools.has(toolName) &&
        typeof finalParams.tabId === "number" &&
        actingThreadId
      ) {
        const leaseRes = acquire({
          tabId: finalParams.tabId,
          holderThreadId: actingThreadId,
          needsL2: false,
        })
        if (!leaseRes.ok) {
          const result = {
            success: false as const,
            error: leaseRes.error,
            data: {
              error_code: leaseRes.error_code,
              tab_id: leaseRes.tab_id,
              holder_thread_id: leaseRes.holder_thread_id,
            },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return { ok: false, result }
        }
      }
    }
    // host_computer vs any tab lease (Q4): block vault-browser window ops while tabs leased
    if (toolName === "host_computer" && anyHeld()) {
      if (hostComputerAppHintsVaultBrowser(finalParams)) {
        const result = {
          success: false as const,
          error:
            "host_computer blocked on a browser window while tab leases are held — force-release tab leases first (ADR-015 Q4)",
          data: { error_code: "HOST_CHROME_TAB_LEASE" },
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return { ok: false, result }
      }
    }
  } catch (gateErr: any) {
    // Fail closed: never skip multi-agent exclusivity on gate exception (ADR-015)
    logger.warn("orchestrator.gate_error", { error: gateErr?.message || String(gateErr) })
    const result = {
      success: false as const,
      error: `ORCHESTRATOR_GATE_ERROR: ${gateErr?.message || String(gateErr)}`,
      data: { error_code: "ORCHESTRATOR_GATE_ERROR" },
    }
    logToolFinish(toolCallId, toolName, startedAt, result)
    return { ok: false, result }
  }

  return { ok: true, finalParams }
}
