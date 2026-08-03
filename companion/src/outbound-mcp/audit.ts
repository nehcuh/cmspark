/**
 * Outbound MCP audit lines (Phase 0) — one structured line per call.
 * Values never include page body or screenshot bytes.
 */

import { appendCapabilityAudit } from "../packs/audit-log"

export type OutboundAuditEvent = {
  caller_id: string
  tool: string
  domain?: string
  confirm_outcome?: "approved" | "denied" | "timeout" | "skipped" | "n/a"
  ok: boolean
  error_code?: string
}

export function appendOutboundMcpAudit(ev: OutboundAuditEvent): void {
  appendCapabilityAudit({
    type: "outbound_mcp.tool",
    caller_id: ev.caller_id,
    tool: ev.tool,
    domain: ev.domain,
    confirm_outcome: ev.confirm_outcome ?? "n/a",
    ok: ev.ok,
    error_code: ev.error_code,
    at: new Date().toISOString(),
  } as any)
}
