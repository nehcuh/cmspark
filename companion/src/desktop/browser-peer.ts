/** Fixed extension metadata/view transport. Never a generic tool/evaluate RPC. */
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"

export type BrowserPeerOperation = "snapshot" | "inspect" | "reveal"
export type DesktopBrowserPeer = Readonly<{
  id: string; socket: WebSocket; current(): boolean
  request(op: BrowserPeerOperation, params: Record<string, string | number>, signal: AbortSignal, remainingMs: number): Promise<unknown>
}>
type Pending = { ws: WebSocket; resolve(value: unknown): void; reject(error: Error): void }
const pending = new Map<string, Pending>()
const peers = new WeakMap<WebSocket, DesktopBrowserPeer>()
export function desktopBrowserPeer(ws: WebSocket, current: () => boolean): DesktopBrowserPeer {
  const old = peers.get(ws); if (old) return old
  const peer: DesktopBrowserPeer = {
    id: randomUUID(), socket: ws, current,
    request(op, params, signal, remainingMs) {
      if (!current() || ws.readyState !== WebSocket.OPEN || signal.aborted || !Number.isFinite(remainingMs) || remainingMs <= 0) return Promise.reject(Error("DESKTOP_BROWSER_UNAVAILABLE"))
      return new Promise((resolve, reject) => {
        const id = randomUUID(), finish = (value: unknown, failed = false) => {
          if (!pending.delete(id)) return
          clearTimeout(timer); signal.removeEventListener("abort", abort); ws.off("close", close)
          if (failed || !current() || signal.aborted) reject(Error("DESKTOP_BROWSER_UNAVAILABLE")); else resolve(value)
        }
        const abort = () => {
          if (pending.has(id) && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: "desktop.browser.peer.cancel", id })) } catch { /* unknown cancellation is never success */ } }
          finish(null, true)
        }, close = () => finish(null, true)
        const timer = setTimeout(abort, Math.min(15000, Math.ceil(remainingMs)))
        pending.set(id, { ws, resolve: value => finish(value), reject: () => finish(null, true) })
        signal.addEventListener("abort", abort, { once: true }); ws.once("close", close)
        try { ws.send(JSON.stringify({ type: "desktop.browser.peer.request", id, op, remaining_ms: Math.min(15000, Math.ceil(remainingMs)), ...params })) } catch { abort() }
        if (signal.aborted) abort()
      })
    },
  }
  peers.set(ws, peer); return peer
}
/** Only the exact dispatch socket may settle a fixed metadata/view request. */
export function handleDesktopBrowserPeerResult(ws: WebSocket, frame: Record<string, unknown>): void {
  if (typeof frame.id !== "string") return
  const p = pending.get(frame.id); if (!p || p.ws !== ws) return
  if (Object.keys(frame).some(k => !["type", "id", "ok", "data"].includes(k)) || frame.ok !== true) { p.reject(Error("DESKTOP_BROWSER_UNAVAILABLE")); return }
  p.resolve(frame.data)
}
