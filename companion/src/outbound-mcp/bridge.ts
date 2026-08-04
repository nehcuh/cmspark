/**
 * Outbound MCP invoke path: gate → (optional) companion tool dispatch.
 *
 * Live Extension/CDP dispatch is injected so unit tests do not boot server.ts.
 * When no dispatcher is set, allowed tools fail closed with BRIDGE_UNAVAILABLE
 * (stdio still lists tools; coding agents get an actionable error).
 */

import { gateOutboundCall, type OutboundCallRequest, type OutboundCallResult } from "./facade"
import { makeOutboundMcpOrigin, type OutboundMcpOrigin } from "./origin"
import { appendOutboundMcpAudit } from "./audit"
import { OUTBOUND_MCP_EXFIL_CLASS } from "./profile"
import { hasOutboundDisclosure } from "./disclosure-session"

export type OutboundDispatchRequest = {
  internal_tool: string
  mcp_tool: string
  args: Record<string, unknown>
  caller_id: string
  origin: OutboundMcpOrigin
}

export type OutboundDispatchResult = {
  success: boolean
  data?: unknown
  error?: string
}

export type OutboundDispatcher = (
  req: OutboundDispatchRequest,
) => Promise<OutboundDispatchResult>

export type InvokeOutboundResult = OutboundCallResult & {
  dispatch?: OutboundDispatchResult
  origin?: OutboundMcpOrigin
}

let defaultDispatcher: OutboundDispatcher | null = null

/** Wire production dispatcher (e.g. from companion tool executor). */
export function setOutboundDispatcher(fn: OutboundDispatcher | null): void {
  defaultDispatcher = fn
}

export function getOutboundDispatcher(): OutboundDispatcher | null {
  return defaultDispatcher
}

/**
 * Gate then dispatch. Does not trust caller disclosure_accepted —
 * facade checks server-side disclosure session.
 */
export async function invokeOutboundTool(
  req: OutboundCallRequest,
  dispatcher: OutboundDispatcher | null | undefined = defaultDispatcher,
): Promise<InvokeOutboundResult> {
  const gate = gateOutboundCall(req)
  if (!gate.ok) {
    return gate
  }

  const origin = makeOutboundMcpOrigin(req.caller_id)
  const internal = gate.internal_tool
  if (!internal) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: req.tool,
      ok: false,
      error_code: "INTERNAL_NAME_MISSING",
    })
    return {
      ok: false,
      error: "internal tool name missing",
      error_code: "INTERNAL_NAME_MISSING",
      origin,
    }
  }

  if (!dispatcher) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: req.tool,
      domain: req.domain,
      ok: false,
      error_code: "BRIDGE_UNAVAILABLE",
      confirm_outcome: "n/a",
    })
    return {
      ok: false,
      error:
        "outbound bridge not connected to Companion tool executor — start companion and use a wired mcp-outbound profile, or inject setOutboundDispatcher",
      error_code: "BRIDGE_UNAVAILABLE",
      internal_tool: internal,
      origin,
    }
  }

  // Defense in depth: re-check disclosure before dispatch for exfil tools
  if (OUTBOUND_MCP_EXFIL_CLASS.has(req.tool) && !hasOutboundDisclosure(req.caller_id)) {
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: req.tool,
      ok: false,
      error_code: "DISCLOSURE_REQUIRED",
    })
    return {
      ok: false,
      error: "disclosure_required",
      error_code: "DISCLOSURE_REQUIRED",
      disclosure_required: true,
      origin,
    }
  }

  try {
    const dispatch = await dispatcher({
      internal_tool: internal,
      mcp_tool: req.tool,
      args: req.args || {},
      caller_id: req.caller_id || "unknown",
      origin,
    })
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: req.tool,
      domain: req.domain,
      ok: dispatch.success,
      error_code: dispatch.success ? undefined : "DISPATCH_FAILED",
      confirm_outcome: "n/a",
    })
    return {
      ok: dispatch.success,
      error: dispatch.success ? undefined : dispatch.error || "dispatch failed",
      error_code: dispatch.success ? undefined : "DISPATCH_FAILED",
      internal_tool: internal,
      dispatch,
      origin,
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    appendOutboundMcpAudit({
      caller_id: req.caller_id || "unknown",
      tool: req.tool,
      ok: false,
      error_code: "DISPATCH_THREW",
    })
    return {
      ok: false,
      error: msg,
      error_code: "DISPATCH_THREW",
      internal_tool: internal,
      origin,
    }
  }
}
