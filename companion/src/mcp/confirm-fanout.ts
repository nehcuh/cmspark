/**
 * Confirm origin binding + fan-out predicates for overlay / outbound / panel.
 *
 * Overlay never becomes originWs and never receives Allow/Deny chrome:
 * overlayNotice means mcp.confirm.pending only.
 */

import { WebSocket } from "ws"

export type ConfirmPeerAuth = {
  authenticated?: boolean
  origin?: string
  surface?: string
}

/** Overlay notice copy (Allow/Deny never rides this payload). */
export const CONFIRM_OVERLAY_PENDING_NOTICE =
  "需要在确认台或托盘里批准。召唤器不能点允许或拒绝。" as const

export function isSummonerSurface(s?: string): boolean {
  return s === "summoner"
}

/** Fan-out Allow/Deny (`security.confirmation.request`) to non-summoner peers only. */
export function shouldReceiveConfirmRequest(surface?: string): boolean {
  return surface !== "summoner"
}

/**
 * Chrome extension peer for overlay-origin / outbound tray map.
 * Matches pickAuthenticatedClientWs: chrome-extension:// only (never overlay).
 */
export function pickExtensionWsFromAuth(
  clients: Iterable<WebSocket>,
  wsAuthGet: (ws: WebSocket) => ConfirmPeerAuth | undefined,
): WebSocket | null {
  for (const c of clients) {
    if (c.readyState !== WebSocket.OPEN) continue
    const st = wsAuthGet(c)
    if (st?.authenticated !== true) continue
    if (/^chrome-extension:\/\//i.test(st.origin || "")) return c
  }
  return null
}

/**
 * Deliver a confirm payload: Allow/Deny to authenticated non-summoner peers
 * when overlay-origin or outbound; overlay gets mcp.confirm.pending only.
 * Panel origin stays origin-only.
 */
export function fanOutConfirmRequest(args: {
  data: unknown
  originatingWs: WebSocket
  originatingSurface?: string
  isOutboundMcpCall: boolean
  overlayNotice: boolean
  clients: Iterable<WebSocket>
  wsAuthGet: (ws: WebSocket) => ConfirmPeerAuth | undefined
  overlayNoticeMessage?: string
}): void {
  const payload = JSON.stringify(args.data)
  const sent = new Set<WebSocket>()
  const trySend = (c: WebSocket, body: string) => {
    if (c.readyState !== WebSocket.OPEN) return
    if (sent.has(c) && body === payload) return
    try {
      c.send(body)
      sent.add(c)
    } catch {
      /* best-effort */
    }
  }

  const fanOut =
    args.isOutboundMcpCall || isSummonerSurface(args.originatingSurface)

  if (fanOut) {
    for (const c of args.clients) {
      const st = args.wsAuthGet(c)
      if (st?.authenticated !== true) continue
      if (!shouldReceiveConfirmRequest(st.surface)) continue
      trySend(c, payload)
    }
    // Executor-bound socket (tests / harness not in `clients`) if it may confirm.
    if (shouldReceiveConfirmRequest(args.originatingSurface)) {
      trySend(args.originatingWs, payload)
    }
    if (args.overlayNotice) {
      const notice = JSON.stringify({
        type: "mcp.confirm.pending",
        message: args.overlayNoticeMessage ?? CONFIRM_OVERLAY_PENDING_NOTICE,
      })
      trySend(args.originatingWs, notice)
    }
    return
  }

  trySend(args.originatingWs, payload)
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
