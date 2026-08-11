// Cookie trust + URL navigate admission gates for createToolExecutor.
// Extracted from server.ts (C10 Phase C mechanical split) — zero behavior change.
//
// FREEZE: cookie trust domain gate + navigate/create_tab/set_tab_url scheme+domain
// gate live HERE. Do NOT re-inflate createToolExecutor with these blocks.
// Image fetch gate → tool/image-fetch-admission.ts (C10-D).
// browser_download path sandbox → tool/browser-download-admission.ts (C10-E1).
// MCP dispatch → mcp/dispatch.ts (C10-E2).

import { WebSocket } from "ws"
import { getConfig } from "../config"
import { logger } from "../logger"
import {
  isTrustedDomain,
  isAutoApprovedDomain,
  cookieTrustBlockedPayload,
} from "../security"
import type { SecurityConfirmationManager } from "../security-confirmation"
import { isFullAutonomyCruise } from "./l2-admission"

export const COOKIE_TOOLS = [
  "get_cookies",
  "set_cookie",
  "delete_cookie",
  "list_all_cookies",
] as const

export const URL_GATE_TOOLS = ["navigate", "create_tab", "set_tab_url"] as const

export type AdmissionEarlyResult =
  | { ok: true }
  | { ok: false; result: { success: false; error: string; data?: any } }

export type CookieAdmissionCtx = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
  getDomainFromUrl: (url: string) => string
}

/**
 * Sync cookie trust check (P0 Cookie Trust Domains Gate).
 * On ok:false, caller returns result (already logToolFinish'd).
 */
export function runCookieTrustAdmission(ctx: CookieAdmissionCtx): AdmissionEarlyResult {
  const { toolName, finalParams, toolCallId, startedAt, logToolFinish, getDomainFromUrl } = ctx

  // Full autonomy cruise (网页+企业巡航+协议解锁三旗全开): user opted into max
  // residual risk — do not block cookie tools solely on trusted_domains.
  // Reuse pure helper — do NOT re-inline the three-flag AND.
  const userFullAutonomyCruise = isFullAutonomyCruise(getConfig().security)

  if (!(COOKIE_TOOLS as readonly string[]).includes(toolName)) {
    return { ok: true }
  }

  let isSafe = false
  let targetDomain = ""

  if (toolName === "get_cookies") {
    targetDomain = finalParams.domain || ""
    isSafe = isTrustedDomain(targetDomain)
  } else if (toolName === "set_cookie") {
    targetDomain = finalParams.domain || ""
    if (!targetDomain && finalParams.url) {
      targetDomain = getDomainFromUrl(finalParams.url)
    }
    isSafe = isTrustedDomain(targetDomain)
  } else if (toolName === "delete_cookie") {
    targetDomain = finalParams.domain || ""
    if (!targetDomain && finalParams.url) {
      targetDomain = getDomainFromUrl(finalParams.url)
    }
    isSafe = isTrustedDomain(targetDomain)
  } else if (toolName === "list_all_cookies") {
    // list_all_cookies is global; only safe if "*" is in trusted domains
    isSafe = isTrustedDomain("*")
    targetDomain = "Global / All Domains"
  }

  if (!isSafe && userFullAutonomyCruise) {
    isSafe = true
    logger.warn("security.cookie_trust_waived", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      target_domain: targetDomain || "unknown",
      reason: "full_autonomy_cruise",
    })
  }

  if (!isSafe) {
    // Plain-language path: Cookie 信任域 ≠ 全自动巡航 / auto_approved_domains.
    const result = cookieTrustBlockedPayload(targetDomain || "unknown", toolName)
    logger.warn("security.cookie_blocked", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      target_domain: targetDomain || "unknown",
      error_code: "COOKIE_TRUST_DENIED",
    })
    logToolFinish(toolCallId, toolName, startedAt, result)
    return { ok: false, result }
  }

  return { ok: true }
}

export type UrlAdmissionCtx = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  ws: WebSocket
  isOutboundMcpCall: boolean
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
  securityConfirmations: SecurityConfirmationManager
  clients: Iterable<WebSocket>
  wsAuthGet: (ws: WebSocket) => { authenticated?: boolean } | undefined
}

/**
 * Async URL scheme+domain gate for navigate / create_tab / set_tab_url.
 * On ok:false, caller returns result (already logToolFinish'd).
 */
export async function runUrlNavigateAdmission(
  ctx: UrlAdmissionCtx,
): Promise<AdmissionEarlyResult> {
  const {
    toolName,
    finalParams,
    toolCallId,
    startedAt,
    ws,
    isOutboundMcpCall,
    logToolFinish,
    securityConfirmations,
    clients,
    wsAuthGet,
  } = ctx

  if (!(URL_GATE_TOOLS as readonly string[]).includes(toolName)) {
    return { ok: true }
  }

  // Audit item 12: navigate / create_tab trust-domain gate. Agents can otherwise
  // drive the browser to ANY URL (including chrome://, file://, data:, or attacker
  // domains) with no confirmation — a credential-phishing / internal-page-pivot
  // vector via prompt injection. Require confirmation for URLs whose host is not
  // in trusted_domains or auto_approved_domains; block non-http(s) schemes outright.
  const rawUrl = String(finalParams.url || "")
  let parsedUrl: URL | null = null
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    /* invalid URL — handled below */
  }
  if (!parsedUrl || !rawUrl) {
    const result = { success: false as const, error: `Invalid URL for ${toolName}: ${rawUrl}` }
    logToolFinish(toolCallId, toolName, startedAt, result)
    return { ok: false, result }
  }
  const securityConfig = getConfig().security
  // Layer 1 — scheme hard-block. skipL1 = allow_all_schemes (GOD-MODE). When
  // bypassed, emit a prominent audit log (javascript: flagged) so god-mode
  // navigations stay traceable, then fall through to the Layer 2 domain gate.
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    if (securityConfig.allow_all_schemes !== true) {
      const result = {
        success: false as const,
        error: `Security Block: ${toolName} to ${parsedUrl.protocol} scheme is not allowed. Only http/https URLs are permitted.`,
      }
      logger.warn("security.url_scheme_blocked", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        scheme: parsedUrl.protocol,
      })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    // GOD-MODE bypass of Layer 1. javascript: is especially dangerous — it
    // runs arbitrary script in the target tab's origin — so flag it explicitly.
    logger.warn("security.godmode_bypassed", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      layer: "scheme",
      scheme: parsedUrl.protocol,
      javascript: parsedUrl.protocol === "javascript:",
      url: rawUrl,
    })
  }
  const host = parsedUrl.hostname
  // ADR-007: trusted_domains is Cookie-only. URL gate uses auto_approved_domains
  // + global toggles only — cookie trust must not skip navigate/create_tab/set_tab_url.
  const skipUrlConfirmation =
    isAutoApprovedDomain(host) ||
    securityConfig.auto_approve_dangerous === true ||
    securityConfig.allow_all_schemes === true
  if (!skipUrlConfirmation) {
    if (ws.readyState !== WebSocket.OPEN) {
      const result = {
        success: false as const,
        error: `Security Block: ${toolName} to untrusted domain "${host}" requires user confirmation, but the WebSocket is not connected.`,
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    logger.warn("security.url_confirmation.requested", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      url: rawUrl,
      host,
      outbound: isOutboundMcpCall,
    })
    // S42 P1: outbound navigate must not depend on a single Side Panel focus
    // (L8). Fan-out + unbound origin for outbound; Side Panel path stays
    // origin-bound so another peer cannot cross-approve.
    const decision = await securityConfirmations.request(
      (data) => {
        const payload = JSON.stringify(data)
        if (isOutboundMcpCall) {
          for (const c of clients) {
            if (c.readyState === WebSocket.OPEN && wsAuthGet(c)?.authenticated === true) {
              try {
                c.send(payload)
              } catch {
                /* best-effort fan-out */
              }
            }
          }
          // Always notify the executor-bound socket (extension peer / tests).
          // Fan-out alone misses peers not in `clients` (integration harness).
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(payload)
            } catch {
              /* ignore */
            }
          }
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload)
        }
      },
      {
        toolName: isOutboundMcpCall ? `[Outbound] ${toolName}` : toolName,
        dangerousApis: [],
        code: `navigate(${rawUrl})`,
        relevantDomains: [host],
      },
      isOutboundMcpCall ? {} : { originWs: ws },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      const result = {
        success: false as const,
        error: `Security Block: ${toolName} to "${rawUrl}" was ${reason === "denied" ? "denied by user" : reason}.`,
      }
      logger.warn("security.url_confirmation.denied", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        url: rawUrl,
        reason,
      })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    logger.info("security.url_confirmation.approved", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      url: rawUrl,
    })
  } else {
    // Skipped via auto_approved_domains / global toggle / god-mode (not cookie trust).
    logger.info("security.url_auto_approved", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      host,
      reason: securityConfig.allow_all_schemes
        ? "god_mode"
        : securityConfig.auto_approve_dangerous
          ? "global_toggle"
          : "domain_whitelist",
    })
  }

  return { ok: true }
}
