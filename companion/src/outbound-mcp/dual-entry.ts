/**
 * ADR-022 L9 — dual-entry tab lease between Side Panel and outbound MCP.
 *
 * - Outbound interactive tools take exclusive lease as holder `outbound_mcp:<caller>`.
 * - Side Panel tools on the same tab force-release outbound (Side Panel wins).
 * - MCP conflict → structured error with queue disclosure (no thrash).
 */

import {
  acquireOrRenewTabLease,
  forceReleaseTab,
  getTabLease,
  type LeaseResult,
} from "../orchestrator/tab-lease"
import { TAB_LEASE_TOOLS } from "../orchestrator/constants"
import { appendCapabilityAudit } from "../packs/audit-log"

export const OUTBOUND_HOLDER_PREFIX = "outbound_mcp:"

/** Param flag injected by companion-http for createToolExecutor. */
export const OUTBOUND_MCP_PARAM = "__outbound_mcp"
export const OUTBOUND_CALLER_PARAM = "__outbound_caller_id"

export function outboundHolderThreadId(callerId: string): string {
  const id = (callerId || "").trim() || "unknown"
  return `${OUTBOUND_HOLDER_PREFIX}${id}`
}

export function isOutboundHolder(threadId: string | undefined | null): boolean {
  return typeof threadId === "string" && threadId.startsWith(OUTBOUND_HOLDER_PREFIX)
}

/** Tools that require exclusive tab lease for outbound dual-entry. */
export function outboundNeedsTabLease(internalTool: string): boolean {
  if (internalTool === "list_tabs") return false
  return TAB_LEASE_TOOLS.has(internalTool)
}

export type OutboundLeaseGateResult =
  | { ok: true; tabId?: number; holder: string }
  | {
      ok: false
      error_code: string
      error: string
      tab_id?: number
      holder_thread_id?: string
      side_panel_wins?: boolean
      queue_disclosure_zh: string
    }

/**
 * Before outbound CDP dispatch: require tabId for lease tools; acquire HARD lease.
 */
export function gateOutboundTabLease(
  internalTool: string,
  params: Record<string, unknown>,
  callerId: string,
): OutboundLeaseGateResult {
  const holder = outboundHolderThreadId(callerId)
  if (!outboundNeedsTabLease(internalTool)) {
    return { ok: true, holder }
  }

  const raw = params.tabId
  const tabId =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))
        ? Number(raw)
        : undefined

  if (tabId === undefined) {
    return {
      ok: false,
      error_code: "TAB_ID_REQUIRED",
      error:
        "TAB_ID_REQUIRED: outbound interactive tools require explicit numeric tabId (list_tabs first) — dual-entry L9",
      queue_disclosure_zh:
        "编程 Agent 须先 list_tabs 再带 tabId 操作；禁止静默操作当前激活标签（双入口防互抢）。",
    }
  }

  const existing = getTabLease(tabId)
  if (existing && !isOutboundHolder(existing.holderThreadId)) {
    // Side Panel / multi-agent worker holds tab — MCP queues (Side Panel wins)
    try {
      appendCapabilityAudit({
        type: "outbound_mcp.tab_lease_blocked",
        at: new Date().toISOString(),
        tab_id: tabId,
        holder_thread_id: existing.holderThreadId,
        outbound_caller: callerId,
        reason: "side_panel_or_worker_holds",
      } as any)
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      error_code: existing.state === "SOFT_RESERVED" ? "TAB_BUSY_CONFIRMING" : "TAB_LOCKED",
      error: `tab ${tabId} held by ${existing.holderThreadId} (${existing.state}) — Side Panel wins; MCP must queue or pick another tab`,
      tab_id: tabId,
      holder_thread_id: existing.holderThreadId,
      side_panel_wins: true,
      queue_disclosure_zh:
        "Side Panel / Worker 正占用该标签。按 ADR-022 L9，Side Panel 优先；请排队或换 tab，勿与主面板抢同一标签。",
    }
  }

  const res: LeaseResult = acquireOrRenewTabLease({
    tabId,
    holderThreadId: holder,
    needsL2: false,
  })
  if (!res.ok) {
    return {
      ok: false,
      error_code: res.error_code,
      error: res.error,
      tab_id: res.tab_id,
      holder_thread_id: res.holder_thread_id,
      queue_disclosure_zh:
        "无法获取标签租约；请 list_tab_locks / 换 tab / 关闭多余标签后重试。",
    }
  }

  return { ok: true, tabId, holder }
}

/**
 * Side Panel (or any non-outbound holder) is about to use a tab: force-release
 * outbound lease so Side Panel wins (ADR-022 L9).
 */
export function sidePanelWinsReleaseOutboundLease(
  tabId: number,
  actingThreadId: string | undefined,
): boolean {
  if (isOutboundHolder(actingThreadId)) {
    // Outbound path — do not release self
    return false
  }
  const existing = getTabLease(tabId)
  if (!existing || !isOutboundHolder(existing.holderThreadId)) {
    return false
  }
  forceReleaseTab(tabId, "side_panel_wins", { hasPending: false })
  try {
    appendCapabilityAudit({
      type: "outbound_mcp.side_panel_wins",
      at: new Date().toISOString(),
      tab_id: tabId,
      released_holder: existing.holderThreadId,
      acting_thread_id: actingThreadId || "side_panel",
    } as any)
  } catch {
    /* best-effort */
  }
  return true
}
