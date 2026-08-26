/**
 * Confirm origin binding + fan-out predicates for overlay / outbound / panel.
 *
 * Overlay never becomes originWs and never receives Allow/Deny chrome:
 * overlayNotice means mcp.confirm.pending only.
 */

import type { WebSocket } from "ws"

export function isSummonerSurface(s?: string): boolean {
  return s === "summoner"
}

/** Fan-out Allow/Deny (`security.confirmation.request`) to non-summoner peers only. */
export function shouldReceiveConfirmRequest(surface?: string): boolean {
  return surface !== "summoner"
}

export function resolveConfirmBinding(args: {
  originatingWs: WebSocket
  originatingSurface?: string
  isOutboundMcpCall: boolean
  extensionWs: WebSocket | null
}): {
  originWs: WebSocket | undefined
  overlayNotice: boolean
  trayOwnerWs: WebSocket | null
} {
  // Outbound L8: unbound origin so any authenticated non-summoner peer + tray
  // may resolve. Never bind originatingWs (even if overlay).
  if (args.isOutboundMcpCall) {
    return {
      originWs: undefined,
      overlayNotice: false,
      trayOwnerWs: args.extensionWs,
    }
  }

  // Overlay chat cannot confirm (N5/S21). Bind extension if present, else
  // leave unbound; tray map must never be keyed by the summoner socket.
  if (isSummonerSurface(args.originatingSurface)) {
    return {
      originWs: args.extensionWs ?? undefined,
      overlayNotice: true,
      trayOwnerWs: args.extensionWs,
    }
  }

  // Panel / operator: stay origin-bound. originatingWs is not summoner.
  return {
    originWs: args.originatingWs,
    overlayNotice: false,
    trayOwnerWs: args.originatingWs,
  }
}
