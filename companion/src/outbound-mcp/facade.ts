/**
 * Outbound MCP façade (Phase 0c).
 *
 * Enforces curated L1 profile + server-side L3+ disclosure + audit.
 * Live Companion dispatch lives in bridge.ts (injectable).
 */

import {
  OUTBOUND_DISCLOSURE_ZH,
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_EXFIL_CLASS,
  isOutboundAllowed,
  outboundToInternalName,
} from "./profile"
import { appendOutboundMcpAudit } from "./audit"
import { hasOutboundDisclosure } from "./disclosure-session"

export type OutboundCallRequest = {
  caller_id: string
  tool: string
  args?: Record<string, unknown>
  /**
   * @deprecated Ignored for authorization. Kept for API compatibility only.
   * Use acceptOutboundDisclosure(caller_id) so the server holds session state.
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
 * Gate a tool call before any Companion dispatch.
 * Fail-closed on forbidden tools and missing **server-side** disclosure for exfil-class tools.
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

  // M3: server session only — caller disclosure_accepted is intentionally ignored
  if (OUTBOUND_MCP_EXFIL_CLASS.has(tool) && !hasOutboundDisclosure(req.caller_id)) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool,
      domain: req.domain,
      ok: false,
      error_code: "DISCLOSURE_REQUIRED",
      confirm_outcome: "n/a",
    })
    return {
      ok: false,
      error: "disclosure_required",
      error_code: "DISCLOSURE_REQUIRED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }

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
