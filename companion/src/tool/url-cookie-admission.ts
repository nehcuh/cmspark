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
import {
  parseLocalFileUrl,
  assertFileOpenOfferable,
  fileOpenCageError,
  fileOpenInvalidError,
} from "./file-url-admission"
import {
  resolveConfirmBinding,
  fanOutConfirmRequest,
  pickExtensionWsFromAuth,
  isSummonerSurface,
  type ConfirmPeerAuth,
} from "../mcp/confirm-fanout"
import { ensureExtensionPeerForOverlayConfirm } from "../ws/extension-peer"

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
  wsAuthGet: (ws: WebSocket) => ConfirmPeerAuth | undefined
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

  // Overlay / outbound: never bind originWs to summoner; fan-out Allow/Deny
  // to authenticated non-summoner peers. Overlay gets mcp.confirm.pending only.
  const originatingSurface = wsAuthGet(ws)?.surface

  async function bindOverlayConfirmChannel(rawUrlForError: string): Promise<
    | {
        ok: true
        confirmOriginOpts: { originWs?: WebSocket }
        sendConfirm: (data: unknown) => void
      }
    | { ok: false; result: { success: false; error: string } }
  > {
    let extensionWs = pickExtensionWsFromAuth(clients, wsAuthGet)
    if (
      isSummonerSurface(originatingSurface) &&
      !(extensionWs && extensionWs.readyState === WebSocket.OPEN)
    ) {
      try {
        extensionWs = await ensureExtensionPeerForOverlayConfirm({ existing: extensionWs })
      } catch {
        const result = {
          success: false as const,
          error: `Security Block: ${toolName} to "${rawUrlForError}" was unavailable.`,
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return { ok: false, result }
      }
    }
    const confirmBinding = resolveConfirmBinding({
      originatingWs: ws,
      originatingSurface,
      isOutboundMcpCall,
      extensionWs,
    })
    const confirmOriginOpts = confirmBinding.originWs
      ? { originWs: confirmBinding.originWs }
      : {}
    const sendConfirm = (data: unknown) => {
      fanOutConfirmRequest({
        data,
        originatingWs: ws,
        originatingSurface,
        isOutboundMcpCall,
        overlayNotice: confirmBinding.overlayNotice,
        clients,
        wsAuthGet,
      })
    }
    return { ok: true, confirmOriginOpts, sendConfirm }
  }

  // Audit item 12: navigate / create_tab trust-domain gate. Agents can otherwise
  // drive the browser to ANY URL (including chrome://, file://, data:, or attacker
  // domains) with no confirmation — a credential-phishing / internal-page-pivot
  // vector via prompt injection. javascript:/data:/chrome:/about:/blob: stay
  // Layer 1 hard-block. file: is path-caged + L2 (never skipUrlConfirmation).
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
  // #410 (ADR-022 Blast Autonomy): global operator exemption flags must NEVER
  // spill to the outbound track — outbound only trusts grant per-key flags +
  // operator HITL. auto_approved_domains / auto_approve_dangerous /
  // allow_all_schemes (god-mode, incl. three-flag cruise) are ignored for an
  // outbound caller: an external agent navigating an auto-approved domain must
  // still hit the operator confirm fan-out, and non-http(s) schemes stay
  // hard-blocked even on god-mode machines.
  const outboundTrack = isOutboundMcpCall === true
  // file: is NOT in the scheme hard-block bucket (javascript:/data:/chrome:/…).
  // Never fall through to skipUrlConfirmation — auto_approve_dangerous and
  // auto_approved_domains (including localhost / *) must not open local files.
  // Only allow_all_schemes (god-mode; three-flag cruise includes it) skips — and
  // never for the outbound track (#410).
  if (parsedUrl.protocol === "file:") {
    if (securityConfig.allow_all_schemes === true && !outboundTrack) {
      logger.warn("security.godmode_bypassed", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        layer: "scheme",
        scheme: "file:",
        javascript: false,
        url: rawUrl,
      })
      return { ok: true }
    }
    const parsed = parseLocalFileUrl(rawUrl)
    if (!parsed.ok) {
      const result = {
        success: false as const,
        error:
          parsed.kind === "invalid" ? fileOpenInvalidError(toolName) : fileOpenCageError(toolName),
      }
      logger.warn("security.file_open_blocked", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        kind: parsed.kind,
      })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    const offer = assertFileOpenOfferable(parsed.absPath)
    if (!offer.ok) {
      const result = {
        success: false as const,
        error: fileOpenCageError(toolName),
      }
      logger.warn("security.file_open_blocked", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        kind: "cage",
      })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    if (ws.readyState !== WebSocket.OPEN) {
      const result = {
        success: false as const,
        error: `Security Block: ${toolName} to local file requires user confirmation, but the WebSocket is not connected. This is not a denied popup.`,
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    logger.warn("security.file_open_confirmation.requested", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      path: offer.realPath,
    })
    const bound = await bindOverlayConfirmChannel(rawUrl)
    if (!bound.ok) return { ok: false, result: bound.result }
    const decision = await securityConfirmations.request(
      bound.sendConfirm,
      {
        toolName: "打开本地文件（仅这一次）",
        dangerousApis: ["local-file"],
        code:
          "在浏览器打开本地文件（仅这一次；不会加入 MCP 允许目录，也不会加入域名白名单）：\n" +
          offer.realPath,
        relevantDomains: [],
        riskLevel: "medium",
        autoConfirmEligible: false,
      },
      bound.confirmOriginOpts,
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      const result = {
        success: false as const,
        error: `Security Block: ${toolName} to "${rawUrl}" was ${reason === "denied" ? "denied by user" : reason}.`,
      }
      logger.warn("security.file_open_confirmation.denied", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        reason,
      })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return { ok: false, result }
    }
    logger.info("security.file_open_confirmation.approved", {
      tool_call_id: toolCallId,
      tool_name: toolName,
    })
    return { ok: true }
  }

  // Layer 1 — scheme hard-block. skipL1 = allow_all_schemes (GOD-MODE), never
  // honored on the outbound track (#410: outbound stays http/https-only even on
  // god-mode machines). When bypassed (non-outbound), emit a prominent audit log
  // (javascript: flagged) so god-mode navigations stay traceable.
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    if (securityConfig.allow_all_schemes !== true || outboundTrack) {
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
  // #410: outbound track never skips (see outboundTrack comment above).
  const skipUrlConfirmation = outboundTrack
    ? false
    : isAutoApprovedDomain(host) ||
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
    // S42 P1 + overlay L8: outbound / summoner fan-out Allow/Deny to
    // authenticated non-summoner peers; overlay gets mcp.confirm.pending only.
    // Panel path stays origin-bound so another peer cannot cross-approve.
    const bound = await bindOverlayConfirmChannel(rawUrl)
    if (!bound.ok) return { ok: false, result: bound.result }
    const decision = await securityConfirmations.request(
      bound.sendConfirm,
      {
        toolName: isOutboundMcpCall ? `[Outbound] ${toolName}` : toolName,
        dangerousApis: [],
        code: `navigate(${rawUrl})`,
        relevantDomains: [host],
      },
      bound.confirmOriginOpts,
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
