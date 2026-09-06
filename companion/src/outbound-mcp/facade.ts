/**
 * Outbound MCP façade (Phase 0c).
 *
 * Enforces curated L1 profile + grant-file page-export flag + operator HITL + audit.
 * Live Companion dispatch lives in bridge.ts (injectable).
 */

import {
  OUTBOUND_DISCLOSURE_ZH,
  OUTBOUND_MCP_EXFIL_CLASS,
  outboundToolAllowedOnProfiles,
  outboundToolsForProfiles,
  outboundToInternalName,
} from "./profile"
import { appendOutboundMcpAudit, type OutboundAuditEvent } from "./audit"
import { hasOutboundDisclosure } from "./disclosure-session"
import {
  grantAllowsPageExport,
  grantAllowsPageExportById,
  liveGrantProfileById,
  liveGrantProfilesByCaller,
  OUTBOUND_L1_DEFAULT_PROFILE,
} from "./outbound-grants"

export type OutboundCallRequest = {
  caller_id: string
  tool: string
  /** Raw invoke name before canonicalOutboundMcpName (HTTP dual-track). */
  wire_name?: string
  /** Grant profile that authorized this request (#410, HTTP per-key track). */
  profile?: string
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

/** MCP tools/list response names (default profile — kept for compat callers). */
export function listOutboundTools(): string[] {
  return outboundToolsForProfiles([OUTBOUND_L1_DEFAULT_PROFILE])
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
  extraAudit?: Pick<OutboundAuditEvent, "domain" | "grant_id" | "wire_name" | "profile">,
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
 * Resolve which profiles authorize `req`: explicit (HTTP per-key track)
 * when provided, else caller-level (stdio / legacy) = live grants of the
 * caller; none → default profile (fail closed to today's semantics).
 */
export function resolveOutboundGateProfiles(
  req: Pick<OutboundCallRequest, "caller_id" | "profile">,
  explicitProfiles?: string[],
): string[] {
  if (explicitProfiles && explicitProfiles.length > 0) return explicitProfiles
  if (req.profile) return [req.profile]
  const callerLevel = liveGrantProfilesByCaller(req.caller_id || "unknown")
  if (callerLevel.length > 0) return callerLevel
  return [OUTBOUND_L1_DEFAULT_PROFILE]
}

/**
 * Gate a tool call before any Companion dispatch.
 * Fail-closed on forbidden tools and missing grant flag / operator HITL for exfil.
 *
 * @param opts.explicitProfiles — HTTP per-key track: profiles granted by the
 *   authenticated key itself (never widened by sibling keys). Omit on the
 *   stdio / legacy caller-level track → caller's live-grant profiles.
 */
export function gateOutboundCall(
  req: OutboundCallRequest,
  opts?: { explicitProfiles?: string[] },
): OutboundCallResult {
  const tool = (req.tool || "").trim()
  if (!tool) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: "",
      wire_name: req.wire_name,
      profile: req.profile,
      ok: false,
      error_code: "TOOL_REQUIRED",
    })
    return { ok: false, error: "tool required", error_code: "TOOL_REQUIRED" }
  }

  const profiles = resolveOutboundGateProfiles(req, opts?.explicitProfiles)
  const allowed = outboundToolAllowedOnProfiles(tool, profiles)
  if (!allowed) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool,
      wire_name: req.wire_name,
      profile: req.profile,
      domain: req.domain,
      ok: false,
      error_code: "PROFILE_FORBIDDEN",
      confirm_outcome: "n/a",
    })
    const isDefaultOnly =
      profiles.length === 1 && profiles[0] === OUTBOUND_L1_DEFAULT_PROFILE
    return {
      ok: false,
      error: isDefaultOnly
        ? `tool "${tool}" is not on the default outbound L1 profile (forbidden)`
        : `tool "${tool}" is not granted on the outbound profile(s) ${profiles.join("/")} (forbidden)`,
      error_code: "PROFILE_FORBIDDEN",
    }
  }

  // Caller disclosure_accepted is intentionally ignored.
  // stdio track (W2): caller-level exfil gate — no grant credential here;
  // see denyOutboundExfilIfNeeded for the dual-track semantics.
  const exfilDeny = denyOutboundExfilIfNeeded(req.caller_id, tool, {
    domain: req.domain,
    wire_name: req.wire_name,
    profile: req.profile,
  })
  if (exfilDeny) return exfilDeny

  const internal = outboundToInternalName(tool)
  appendOutboundMcpAudit({
    caller_id: req.caller_id || "unknown",
    tool,
    wire_name: req.wire_name,
    profile: req.profile,
    domain: req.domain,
    ok: true,
    confirm_outcome: "n/a",
  })
  return {
    ok: true,
    internal_tool: internal || undefined,
  }
}
