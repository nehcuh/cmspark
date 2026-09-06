/**
 * Outbound MCP audit lines (Phase 0) — one structured line per call.
 * Values never include page body or screenshot bytes.
 */

import { appendCapabilityAudit } from "../packs/audit-log"

export type OutboundAuditEvent = {
  caller_id: string
  tool: string
  /** Raw name as received, before canonicalOutboundMcpName. Tool-name only. */
  wire_name?: string
  /** Grant profile that authorized the call (#410); omit on caller-level tracks. */
  profile?: string
  domain?: string
  confirm_outcome?: "approved" | "denied" | "timeout" | "skipped" | "n/a"
  ok: boolean
  error_code?: string
  /** L4+ grant id when auth mode is grant */
  grant_id?: string
}

export function appendOutboundMcpAudit(ev: OutboundAuditEvent): void {
  appendCapabilityAudit({
    type: "outbound_mcp.tool",
    caller_id: ev.caller_id,
    tool: ev.tool,
    ...(ev.wire_name != null && ev.wire_name !== "" ? { wire_name: ev.wire_name } : {}),
    ...(ev.profile != null && ev.profile !== "" ? { profile: ev.profile } : {}),
    domain: ev.domain,
    confirm_outcome: ev.confirm_outcome ?? "n/a",
    ok: ev.ok,
    error_code: ev.error_code,
    grant_id: ev.grant_id,
    at: new Date().toISOString(),
  } as any)
}
