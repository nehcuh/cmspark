import { randomBytes } from "node:crypto"
import type http from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { DesktopIdentityRegistry, type DesktopPrincipal } from "./identity"
import { DESKTOP_NATIVE_ORIGIN, DESKTOP_CHALLENGE_TTL_MS } from "./capabilities"
import { desktopRead, type DesktopReadServices } from "./read"
import { parseDesktopFrame } from "./flat-json"
import { createDesktopMcpSave } from "./mcp-save"
import { createDesktopDialog, DESKTOP_DIALOG_METHODS, type NativeDialogRuntime } from "./dialog"
import type { ThreadManager } from "../threads/thread-manager"
import { desktopThreadMetadata } from "./thread-metadata"
import type { SecurityConfirmationManager } from "../security-confirmation"
import { createDesktopResources, DESKTOP_RESOURCE_METHODS } from "./resources"

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
export function createDesktopChannel(opts: { registry: DesktopIdentityRegistry; services: DesktopReadServices; maxPayload: number; securityConfirmations?: SecurityConfirmationManager; onDisconnect?: (ws: WebSocket) => void; onAuthenticated?: (host: string) => void; dialogRuntime?: (owner: { ws: WebSocket; current(): boolean }) => NativeDialogRuntime }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxPayload })
  const active = new Map<WebSocket, DesktopPrincipal>()
  const pending = new Map<WebSocket, string>()
  const retire = new Map<WebSocket, () => void>()
  const unbind = opts.registry.onRevoke(id => { for (const [ws, cap] of pending) if (cap === id) { retire.get(ws)?.(); ws.terminate() } })
  wss.once("close", unbind)
  wss.on("connection", ws => {
    // Reuse the existing legacy admission bound; no unauthenticated desktop growth.
    if ([...wss.clients].filter(c => !active.has(c)).length > 8) { ws.close(1013); return }
    const connectionId = randomBytes(16).toString("hex")
    let capabilityId: string | undefined
    let principal: DesktopPrincipal | undefined
    let mcpSave: ReturnType<typeof createDesktopMcpSave> | undefined
    let dialog: ReturnType<typeof createDesktopDialog> | undefined
    let resources: ReturnType<typeof createDesktopResources> | undefined
    function sendResource(value: unknown) {
      if (ws.readyState !== WebSocket.OPEN) return false
      let encoded: string | undefined
      try { encoded = JSON.stringify(value) } catch { /* Refuse an unencodable projection. */ }
      if (encoded !== undefined && Buffer.byteLength(encoded, "utf8") <= opts.maxPayload) { ws.send(encoded); return true }
      // A read which cannot be delivered must not retain an editable snapshot.
      resources?.cancel()
      const frame = value as Record<string, unknown> | null
      // Confirmation notifications are not request terminals. Let the actor
      // settle its pending write once, with the original closed id/kind shape.
      if (typeof frame?.type === "string" && frame.type.startsWith("desktop.confirmation.")) return false
      const method = typeof frame?.request_method === "string" ? frame.request_method : typeof frame?.type === "string" ? frame.type.replace(/\.result$/, "") : ""
      const id = frame?.id ?? frame?.request_id
      const kind = frame?.kind ?? (frame?.doc as Record<string, unknown> | undefined)?.kind
      const failure = JSON.stringify({ type: (DESKTOP_RESOURCE_METHODS as readonly string[]).includes(method) ? method + ".result" : "desktop.error", ...(typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? { id } : {}), ...(kind === "skill" || kind === "knowledge" ? { kind } : {}), ok: false, outcome: "unavailable", error_code: "DESKTOP_RESOURCE_UNAVAILABLE" })
      if (Buffer.byteLength(failure, "utf8") <= opts.maxPayload) ws.send(failure)
      else ws.close(1009)
      return false
    }
    retire.set(ws, () => { try { dialog?.cancel() } catch { /* Continue retiring other pending work. */ } try { mcpSave?.cancel() } catch { /* Socket teardown must continue. */ } try { resources?.cancel() } catch { /* Finish socket retirement. */ } })
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
          for (const [old, p] of active) if (p.hostSessionId === principal.hostSessionId) { active.delete(old); retire.get(old)?.(); old.terminate() }
          active.set(ws, principal); clearTimeout(timer)
          if (opts.securityConfirmations) { const owner = principal; mcpSave = createDesktopMcpSave({ ws, services: opts.services, manager: opts.securityConfirmations, current: () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.mcp.save"), send: frame => send(ws, frame) }) }
          if (opts.securityConfirmations && opts.services.skills.createDesktopResourceStore) { const owner = principal; resources = createDesktopResources({ ws, store: opts.services.skills.createDesktopResourceStore(), manager: opts.securityConfirmations, current: () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.resource.import"), send: sendResource }) }
          { const owner = principal; const current = () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.chat.send"); dialog = createDesktopDialog({ threads: opts.services.threads as ThreadManager, runtime: opts.dialogRuntime?.({ ws, current }), current, send: frame => send(ws, frame), maxPayload: opts.maxPayload }) }
          send(ws, { type: "desktop.ready", protocol_version: 1 }); opts.onAuthenticated?.(principal.hostSessionId); return
        }
        ws.terminate(); return
      }
      if ((DESKTOP_DIALOG_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!dialog || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return }
        dialog.handle(frame); return
      }
      if (["desktop.thread.metadata.edit", "desktop.thread.metadata.save"].includes(String(frame.type))) {
        const owner = principal
        const current = () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner!, String(frame.type))
        if (!current()) { send(ws, { type: String(frame.type) + ".result", id: frame.id, thread_id: frame.thread_id, ok: false, ...(frame.type === "desktop.thread.metadata.save" ? { saved: false } : {}), error_code: "DESKTOP_METHOD_DENIED" }); return }
        const result = desktopThreadMetadata(frame, opts.services, current)
        if (current()) send(ws, result)
        return
      }
      if ((DESKTOP_RESOURCE_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!resources || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return }
        const owner = principal
        void resources.handle(frame).then(result => { if (opts.registry.allows(owner, String(frame.type))) sendResource(result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) sendResource({ type: String(frame.type) + ".result", id: frame.id, ok: false, outcome: "unknown", error_code: "DESKTOP_RESOURCE_UNAVAILABLE" }) })
        return
      }
      if (["desktop.mcp.edit", "desktop.mcp.save", "desktop.confirmation.decision"].includes(String(frame.type))) {
        if (!mcpSave || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", error_code: "DESKTOP_METHOD_DENIED", ...(typeof frame.id === "string" ? { id: frame.id } : {}) }); return }
        if (frame.type === "desktop.confirmation.decision") { if (frame.purpose === "resource") resources?.decide(frame); else if (!Object.hasOwn(frame, "purpose")) mcpSave.decide(frame); return }
        const owner = principal
        void mcpSave.handle(frame).then(result => { if (opts.registry.allows(owner, String(frame.type))) send(ws, result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) send(ws, { type: "desktop.error", error_code: "DESKTOP_MCP_SAVE_FAILED", ...(typeof frame.id === "string" ? { id: frame.id } : {}) }) })
        return
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
    ws.on("close", () => { retire.get(ws)?.(); retire.delete(ws); clearTimeout(timer); pending.delete(ws); active.delete(ws); if (principal) opts.registry.disconnect(principal); if (capabilityId) opts.registry.cancelChallenge(capabilityId, connectionId); opts.onDisconnect?.(ws) })
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
