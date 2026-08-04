/**
 * Synthetic origin for outbound MCP confirm path (ADR-022 L4 / P0c M6).
 * Not a real WebSocket; confirm stack must still bind an origin identity
 * so responses cannot be claimed by an arbitrary peer without matching id.
 */

export type OutboundMcpOrigin = {
  kind: "outbound_mcp"
  caller_id: string
  /** Opaque origin id for SecurityConfirmationManager binding */
  synthetic_origin: string
  /**
   * Placeholder for future WS-backed façade.
   * null means no live socket — confirm UX must use tray/global or fail-closed.
   */
  originWs: null
}

export function makeOutboundMcpOrigin(caller_id: string): OutboundMcpOrigin {
  const id = (caller_id || "").trim() || "unknown"
  return {
    kind: "outbound_mcp",
    caller_id: id,
    synthetic_origin: `outbound_mcp:${id}`,
    originWs: null,
  }
}
