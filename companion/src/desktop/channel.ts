import { randomBytes } from "node:crypto"
import type http from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { DesktopIdentityRegistry, type DesktopPrincipal } from "./identity"
import { DESKTOP_NATIVE_ORIGIN, DESKTOP_CHALLENGE_TTL_MS } from "./capabilities"
import { desktopRead, type DesktopReadServices } from "./read"
import { parseDesktopFrame } from "./flat-json"

const hexId = /^[0-9a-f]{32}$/
function exact(frame: Record<string, unknown>, keys: string[]): boolean { return Object.keys(frame).every(k => keys.includes(k)) && keys.filter(k => k !== "id").every(k => k in frame) }
function send(ws: WebSocket, frame: unknown) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame)) }
export function attachDesktopUpgrade(server: http.Server, legacy: WebSocketServer, desktop: WebSocketServer, legacyOrigin: (origin: string | undefined) => boolean): void {
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin
    const isDesktop = req.url === "/desktop"
    if ((isDesktop && origin !== DESKTOP_NATIVE_ORIGIN) || (!isDesktop && !legacyOrigin(origin))) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return }
    const target = isDesktop ? desktop : legacy
    target.handleUpgrade(req, socket, head, ws => target.emit("connection", ws, req))
  })
}
export function createDesktopChannel(opts: { registry: DesktopIdentityRegistry; services: DesktopReadServices; maxPayload: number; onDisconnect?: (ws: WebSocket) => void; onAuthenticated?: (host: string) => void }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxPayload })
  const active = new Map<WebSocket, DesktopPrincipal>()
  const pending = new Map<WebSocket, string>()
  const unbind = opts.registry.onRevoke(id => { for (const [ws, cap] of pending) if (cap === id) ws.terminate() })
  wss.once("close", unbind)
  wss.on("connection", ws => {
    // Reuse the existing legacy admission bound; no unauthenticated desktop growth.
    if ([...wss.clients].filter(c => !active.has(c)).length > 8) { ws.close(1013); return }
    const connectionId = randomBytes(16).toString("hex")
    let capabilityId: string | undefined
    let principal: DesktopPrincipal | undefined
    const timer = setTimeout(() => ws.terminate(), DESKTOP_CHALLENGE_TTL_MS)
    ws.on("error", () => {})
    send(ws, { type: "desktop.challenge.request" })
    ws.on("message", raw => {
      const frame = parseDesktopFrame(raw.toString())
      if (!frame) { ws.terminate(); return }
      if (!principal) {
        if (frame.type === "desktop.hello" && !capabilityId && exact(frame, ["type", "capability_id", "protocol_version"]) && typeof frame.capability_id === "string" && hexId.test(frame.capability_id) && frame.protocol_version === 1) {
          const ch = opts.registry.challenge(frame.capability_id, connectionId, 1)
          if (!ch) { ws.terminate(); return }
          capabilityId = frame.capability_id
          pending.set(ws, capabilityId)
          send(ws, { type: "desktop.challenge", capability_id: capabilityId, connection_id: connectionId, protocol_version: 1, nonce: ch.nonce }); return
        }
        if (frame.type === "desktop.authenticate" && capabilityId && exact(frame, ["type", "capability_id", "protocol_version", "proof"]) && frame.capability_id === capabilityId && frame.protocol_version === 1) {
          principal = opts.registry.authenticate(capabilityId, connectionId, 1, frame.proof) || undefined
          if (!principal) { ws.terminate(); return }
          // Reconnect closes old sockets, not merely their privilege bit.
          for (const [old, p] of active) if (p.hostSessionId === principal.hostSessionId) { active.delete(old); old.terminate() }
          active.set(ws, principal); clearTimeout(timer)
          send(ws, { type: "desktop.ready", protocol_version: 1 }); opts.onAuthenticated?.(principal.hostSessionId); return
        }
        ws.terminate(); return
      }
      const keys = frame.type === "thread.peek" ? ["type", "thread_id", "id"] : ["type", "id"]
      if (typeof frame.type !== "string" || !exact(frame, keys) || (frame.id !== undefined && (typeof frame.id !== "string" || frame.id.length > 200)) || (frame.type === "thread.peek" && (typeof frame.thread_id !== "string" || !frame.thread_id.trim())) || !opts.registry.allows(principal, frame.type)) {
        send(ws, { type: "desktop.error", error_code: "DESKTOP_METHOD_DENIED", ...(typeof frame.id === "string" ? { id: frame.id } : {}) }); return
      }
      try {
        const result = desktopRead(frame.type, frame.thread_id as string | undefined, opts.services)
        if (opts.registry.allows(principal, frame.type)) send(ws, { ...result, ...(frame.id === undefined ? {} : { id: frame.id }) })
      } catch { if (opts.registry.allows(principal, frame.type)) send(ws, { type: "desktop.error", error_code: "DESKTOP_READ_FAILED", ...(frame.id === undefined ? {} : { id: frame.id }) }) }
    })
    ws.on("close", () => { clearTimeout(timer); pending.delete(ws); active.delete(ws); if (principal) opts.registry.disconnect(principal); if (capabilityId) opts.registry.cancelChallenge(capabilityId, connectionId); opts.onDisconnect?.(ws) })
  })
  return {
    wss,
    window(host: string, view: "compact" | "workspace"): boolean {
      for (const [ws, p] of active) if (p.hostSessionId === host && opts.registry.allows(p, "system.ping")) { send(ws, { type: "desktop.window", view }); return true }
      return false
    },
    revokeHost(host: string): void { opts.registry.revokeHost(host); for (const [ws,p] of active) if(p.hostSessionId === host) { send(ws,{type:"desktop.close"}); ws.close(); active.delete(ws) } },
  }
}
