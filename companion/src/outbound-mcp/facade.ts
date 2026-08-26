/**
 * Outbound MCP façade (Phase 0c).
 *
 * Enforces curated L1 profile + grant-file page-export flag + operator HITL + audit.
 * Live Companion dispatch lives in bridge.ts (injectable).
 */

import {
  OUTBOUND_DISCLOSURE_ZH,
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_EXFIL_CLASS,
  isOutboundAllowed,
  outboundToInternalName,
} from "./profile"
import { appendOutboundMcpAudit, type OutboundAuditEvent } from "./audit"
import { hasOutboundDisclosure } from "./disclosure-session"
import { grantAllowsPageExport } from "./outbound-grants"

export type OutboundCallRequest = {
  caller_id: string
  tool: string
  args?: Record<string, unknown>
  /**
   * @deprecated Ignored for authorization. Kept for API compatibility only.
   * Exfil requires grantAllowsPageExport(caller_id) AND an operator HITL session
   * (acceptOutboundDisclosure). Caller HTTP/stdio acknowledge is not consent.
   */
  disclosure_accepted?: boolean
  domain?: string
}

export type OutboundCallResult = {
  ok: boolean
  error?: string
  error_code?: string
  /** Internal tool name if allowed */
  internal_tool?: string
  disclosure_required?: boolean
  disclosure_text_zh?: string
  /** Tools list for MCP tools/list */
  tools?: string[]
}

/** MCP tools/list response names. */
export function listOutboundTools(): string[] {
  return [...OUTBOUND_MCP_ALLOWLIST]
}

/**
 * Exfil gate algebra (PR-A):
 *   grant.allow_page_export !== true → DISCLOSURE_NOT_GRANTED
 *   flag true, no operator HITL session → DISCLOSURE_HITL_REQUIRED
 *
 * Caller `disclosure_accepted` and HTTP/stdio acknowledge MUST NOT satisfy this.
 * Returns a deny result, or null if the tool is not exfil / both checks pass.
 */
export function denyOutboundExfilIfNeeded(
  caller_id: string,
  tool: string,
  extraAudit?: Pick<OutboundAuditEvent, "domain" | "grant_id">,
): OutboundCallResult | null {
  if (!OUTBOUND_MCP_EXFIL_CLASS.has(tool)) return null
  const cid = (caller_id || "").trim() || "unknown"
  if (!grantAllowsPageExport(cid)) {
    appendOutboundMcpAudit({
      caller_id: cid,
      tool,
      ok: false,
      error_code: "DISCLOSURE_NOT_GRANTED",
      confirm_outcome: "n/a",
      ...extraAudit,
    })
    return {
      ok: false,
      error: "page export not granted for this caller",
      error_code: "DISCLOSURE_NOT_GRANTED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }
  if (!hasOutboundDisclosure(cid)) {
    appendOutboundMcpAudit({
      caller_id: cid,
      tool,
      ok: false,
      error_code: "DISCLOSURE_HITL_REQUIRED",
      confirm_outcome: "n/a",
      ...extraAudit,
    })
    return {
      ok: false,
      error: "operator HITL required for page export",
      error_code: "DISCLOSURE_HITL_REQUIRED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }
  return null
}

/**
 * Gate a tool call before any Companion dispatch.
 * Fail-closed on forbidden tools and missing grant flag / operator HITL for exfil.
 */
export function gateOutboundCall(req: OutboundCallRequest): OutboundCallResult {
  const tool = (req.tool || "").trim()
  if (!tool) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: "",
      ok: false,
      error_code: "TOOL_REQUIRED",
    })
    return { ok: false, error: "tool required", error_code: "TOOL_REQUIRED" }
  }

  if (!isOutboundAllowed(tool)) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool,
      domain: req.domain,
      ok: false,
      error_code: "PROFILE_FORBIDDEN",
      confirm_outcome: "n/a",
    })
    return {
      ok: false,
      error: `tool "${tool}" is not on the default outbound L1 profile (forbidden)`,
      error_code: "PROFILE_FORBIDDEN",
    }
  }

  // Caller disclosure_accepted is intentionally ignored
  const exfilDeny = denyOutboundExfilIfNeeded(req.caller_id, tool, {
    domain: req.domain,
  })
  if (exfilDeny) return exfilDeny

  const internal = outboundToInternalName(tool)
  appendOutboundMcpAudit({
    caller_id: req.caller_id || "unknown",
    tool,
    domain: req.domain,
    ok: true,
    confirm_outcome: "n/a",
  })
  return {
    ok: true,
    internal_tool: internal || undefined,
  }
}
