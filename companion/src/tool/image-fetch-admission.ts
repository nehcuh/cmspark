// analyze_image IMAGE_FETCH two-phase gate for createToolExecutor.
// Extracted from server.ts (C10 Phase D mechanical split) — zero behavior change.
//
// FREEZE: analyze_image_fetch direct-call reject + analyze_image phase1→gate→phase2
// live HERE. Do NOT re-inflate createToolExecutor with these blocks.
// Cookie/URL gates → tool/url-cookie-admission.ts; L2 → tool/l2-admission.ts.

import { WebSocket } from "ws"
import { logger } from "../logger"
import {
  isAutoApprovedDomain,
  isCloudMetadataIp,
  isPrivateOrLoopbackIp,
} from "../security"
import { decodeDataUrlImage, summarizeCandidateUrl } from "../image-data-url"
import type { SecurityConfirmationManager } from "../security-confirmation"

export type ToolResult = { success: boolean; data?: any; error?: string }

export type ImageFetchAdmissionCtx = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  ws: WebSocket
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
  securityConfirmations: SecurityConfirmationManager
  /** Same plumbing as server's dispatchToExtension — inject to avoid circular deps */
  dispatchToExtension: (
    toolCallId: string,
    toolName: string,
    params: any,
    ws: WebSocket,
  ) => Promise<ToolResult>
}

/**
 * Returns:
 * - null: this tool is not analyze_image / analyze_image_fetch — caller continues
 * - ToolResult: early return from createToolExecutor (already logToolFinish'd when appropriate — match current code)
 */
export async function runImageFetchAdmission(
  ctx: ImageFetchAdmissionCtx,
): Promise<ToolResult | null> {
  const {
    toolName,
    finalParams,
    toolCallId,
    startedAt,
    ws,
    logToolFinish,
    securityConfirmations,
    dispatchToExtension,
  } = ctx

  // analyze_image_fetch is an INTERNAL phase-2 tool, dispatched only by the
  // analyze_image branch below via dispatchToExtension (which does NOT re-enter
  // this function). It is not in the LLM tool schema, so a top-level call here
  // means a malformed/hallucinated request — reject it rather than let it fall
  // through to the default forward and fetch an arbitrary URL past the gate.
  if (toolName === "analyze_image_fetch") {
    const result = {
      success: false,
      error: "Security Block: analyze_image_fetch is an internal tool and cannot be called directly.",
    }
    logger.warn("security.image_fetch_direct_call_rejected", { tool_call_id: toolCallId })
    logToolFinish(toolCallId, toolName, startedAt, result)
    return result
  }

  // M4 (§6.1) — analyze_image IMAGE_FETCH_GATE. Unlike URL_GATE_TOOLS, the
  // image URL is not known until the extension resolves the <img> element, and
  // the SSRF fetch happens inside the extension's <all_urls> service worker.
  // So this is a two-phase dispatch:
  //   phase 1 analyze_image → extension resolves the element, returns either
  //     {type:"canvas", image_base64} (same-origin; zero new exfil capability
  //     since screenshot already captures those pixels → UNGATED) or
  //     {type:"fetch_required", candidate_url} (cross-origin canvas-tainted).
  //   phase 2 analyze_image_fetch → dispatched ONLY after the gate approves;
  //     extension fetches candidate_url → image_base64 (adapter VISION_TOOLS
  //     then runs vision, same as today).
  // Neither god-mode (allow_all_schemes) nor auto_approve_dangerous bypasses
  // this gate — only trusted/auto-approved domains skip confirmation.
  if (toolName !== "analyze_image") {
    return null
  }

  const phase1 = await dispatchToExtension(toolCallId, "analyze_image", finalParams, ws)
  const p1 = phase1?.data
  // Path A (canvas → image_base64) or any error: return as-is. The adapter's
  // VISION_TOOLS post-processing runs vision when image_base64 is present.
  if (phase1?.success !== true || !p1 || p1.type !== "fetch_required") {
    logToolFinish(toolCallId, toolName, startedAt, phase1)
    return phase1
  }
  const candidateUrl = String(p1.candidate_url || "")
  // Residual data: handling for old-extension skew: newer extensions promote
  // data: to type:canvas after CDP and never return fetch_required. If we
  // still see data: here, decode LOCALLY (mime + 6 MiB gate) and return
  // immediately — NO L2, NO analyze_image_fetch phase2, NO schemeOk expansion
  // to data:. Never log or error-interpolate the full multi-KB payload.
  if (candidateUrl.toLowerCase().startsWith("data:")) {
    // Explicit === true/false so residual path typechecks even if
    // strictNullChecks is relaxed in some compile paths.
    const decoded = decodeDataUrlImage(candidateUrl)
    const sum = summarizeCandidateUrl(candidateUrl)
    if (decoded.ok === false) {
      logger.warn("security.image_fetch_blocked", {
        tool_call_id: toolCallId, tool_name: toolName,
        scheme: "data:", mime: decoded.mime || sum.mime,
        byte_len: decoded.byte_len ?? sum.byte_len,
        reason: decoded.error_code === "IMAGE_TOO_LARGE" ? "image_too_large" : "data_url_rejected",
        error_code: decoded.error_code,
      })
      const result = {
        success: false,
        error: decoded.error,
        data: {
          error_code: decoded.error_code,
          mime: decoded.mime,
          byte_len: decoded.byte_len,
        },
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    logger.info("security.image_data_url_decoded", {
      tool_call_id: toolCallId, tool_name: toolName,
      scheme: "data:", mime: decoded.mime, byte_len: decoded.byte_len,
    })
    // Dimensions from phase1 are best-effort (canvas may never have drawn);
    // only positive finite values — vision uses base64, not these metadata fields.
    const dimW = Number(p1.width)
    const dimH = Number(p1.height)
    const result = {
      success: true,
      data: {
        type: "canvas",
        image_base64: decoded.base64,
        width: Number.isFinite(dimW) && dimW > 0 ? Math.floor(dimW) : 0,
        height: Number.isFinite(dimH) && dimH > 0 ? Math.floor(dimH) : 0,
        url: `data:${decoded.mime};base64,…`,
        title: p1.title || "",
        alt_text: p1.alt_text || "",
        selector: finalParams.selector,
      },
    }
    logToolFinish(toolCallId, toolName, startedAt, result)
    return result
  }
  let parsedCu: URL | null = null
  try { parsedCu = new URL(candidateUrl) } catch { /* invalid → blocked below */ }
  const scheme = parsedCu?.protocol || ""
  const host = parsedCu?.hostname || ""
  const isPriv = isPrivateOrLoopbackIp(host)
  const metadata = isCloudMetadataIp(host)
  const schemeOk = scheme === "http:" || scheme === "https:"
  // file:/ftp:/javascript:/blob:/etc. are not http(s) → hard-block.
  // (data: is handled above via local decode; never expand schemeOk to data:.)
  const urlSum = summarizeCandidateUrl(candidateUrl)
  if (!parsedCu || !schemeOk || metadata) {
    const reason = !parsedCu ? "invalid_url" : metadata ? "cloud_metadata_endpoint" : "blocked_scheme"
    logger.warn("security.image_fetch_blocked", {
      tool_call_id: toolCallId, tool_name: toolName,
      candidate_url: urlSum.summary, scheme, host, is_private_ip: isPriv, reason,
    })
    const result = {
      success: false,
      error: `Security Block: analyze_image cannot read ${metadata ? "a cloud metadata endpoint" : `${scheme || "non-http(s)"} URL`} (${urlSum.summary}).`,
    }
    logToolFinish(toolCallId, toolName, startedAt, result)
    return result
  }
  // Cookie trusted_domains must not auto-approve image fetch (ADR-007 Cookie-only).
  const autoApproved = isAutoApprovedDomain(host)
  if (autoApproved) {
    logger.info("security.image_fetch_auto_approved", {
      tool_call_id: toolCallId, tool_name: toolName,
      candidate_url: urlSum.summary, scheme, host, is_private_ip: isPriv,
      reason: "auto_approved_domain",
    })
  } else {
    // Non-auto-approved public URL or (non-metadata) private IP → confirm.
    // god-mode + auto_approve_dangerous do NOT skip IMAGE_FETCH http(s) confirm.
    if (ws.readyState !== WebSocket.OPEN) {
      const result = {
        success: false,
        error: `Security Block: analyze_image needs to read an untrusted image source (${urlSum.summary}) which requires confirmation, but the WebSocket is not connected.`,
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    const decision = await securityConfirmations.request(
      (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)) },
      {
        toolName: "analyze_image_fetch",
        dangerousApis: [],
        code: `analyze_image_fetch(${urlSum.summary})`,
        relevantDomains: [host],
        defenseLayer: 2,
        riskLevel: "high",
      },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      logger.info("security.image_fetch_denied", {
        tool_call_id: toolCallId, tool_name: toolName,
        candidate_url: urlSum.summary, scheme, host, is_private_ip: isPriv, reason,
      })
      const result = {
        success: false,
        error: `Security Block: analyze_image read of "${urlSum.summary}" was ${reason === "denied" ? "denied by user" : reason}.`,
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    logger.warn("security.image_fetch_confirmed", {
      tool_call_id: toolCallId, tool_name: toolName,
      candidate_url: urlSum.summary, scheme, host, is_private_ip: isPriv,
    })
  }
  // Gate passed → phase 2 fetch. Synthetic id keeps the LLM-facing
  // tool_call_id for the final result while correlating the internal fetch.
  const phase2 = await dispatchToExtension(`${toolCallId}__image_fetch`, "analyze_image_fetch", {
    tabId: finalParams.tabId,
    candidate_url: candidateUrl,
    selector: finalParams.selector,
  }, ws)
  logToolFinish(toolCallId, toolName, startedAt, phase2)
  return phase2
}
