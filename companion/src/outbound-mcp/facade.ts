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
import { grantAllowsPageExport, grantAllowsPageExportById } from "./outbound-grants"

export type OutboundCallRequest = {
  caller_id: string
  tool: string
  args?: Record<string, unknown>
  /**
   * @deprecated Ignored for authorization. Kept for API compatibility only.
   * Exfil requires the grant-flag gate (per-key on the authenticated HTTP path,
   * caller-level on stdio — see denyOutboundExfilIfNeeded) AND an operator HITL
   * session (acceptOutboundDisclosure). Caller HTTP/stdio acknowledge is not consent.
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
 * Dual-track grant-flag semantics (W2):
 *   - HTTP track: caller passes the authenticated `grant_id` (extraAudit.grant_id)
 *     → per-key check: only THAT grant's own allow_page_export authorizes exfil,
 *     matching the grant-cli "这把钥匙" promise to the operator.
 *   - stdio track (bridge.ts, gateOutboundCall below): no grant credential is
 *     available → caller-level check: any live flagged grant for the caller allows.
 *
 * Intentional mismatch: the operator HITL session (hasOutboundDisclosure) stays
 * keyed by caller_id on BOTH tracks — "grant-level flag gate + caller-level HITL
 * session". One operator approval arms the caller's session; the durable exfil
 * consent stays per-key on the HTTP track.
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
  const granted = extraAudit?.grant_id
    ? grantAllowsPageExportById(extraAudit.grant_id) // HTTP track: this key only
    : grantAllowsPageExport(cid) // stdio track: any live flagged key for caller
  if (!granted) {
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
      error: extraAudit?.grant_id
        ? "page export not granted for this grant key"
        : "page export not granted for this caller",
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

  // Caller disclosure_accepted is intentionally ignored.
  // stdio track (W2): caller-level exfil gate — no grant credential here;
  // see denyOutboundExfilIfNeeded for the dual-track semantics.
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
