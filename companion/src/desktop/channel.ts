import { randomBytes } from "node:crypto"
import type http from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { DesktopIdentityRegistry, type DesktopPrincipal } from "./identity"
import { DESKTOP_NATIVE_ORIGIN, DESKTOP_CHALLENGE_TTL_MS } from "./capabilities"
import { desktopRead, desktopTitleSearch, type DesktopReadServices } from "./read"
import { parseDesktopFrame } from "./flat-json"
import { createDesktopMcpSave } from "./mcp-save"
import { createDesktopDialog, DESKTOP_DIALOG_METHODS, type NativeDialogRuntime } from "./dialog"
import type { ThreadManager } from "../threads/thread-manager"
import { desktopThreadMetadata } from "./thread-metadata"
import type { SecurityConfirmationManager } from "../security-confirmation"
import { createDesktopResources, DESKTOP_RESOURCE_METHODS } from "./resources"
import {createDesktopLocalWork,DESKTOP_LOCAL_WORK_METHODS,type LocalWorkRuntime} from "./local-work"
import { createDesktopWorkspace, DESKTOP_WORKSPACE_METHODS, type WorkspaceRuntime } from "./workspace"
import { createDesktopArchive, DESKTOP_ARCHIVE_METHODS } from "./archive"
import { createDesktopBrowser, DESKTOP_BROWSER_METHODS } from "./browser"
import type { DesktopBrowserPeer } from "./browser-peer"
import { createDesktopTerminalWork, DESKTOP_TERMINAL_METHODS, type DesktopTerminalRuntime } from "./terminal-work"
import { pendingToolCalls } from "../ws/tool-forward"

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
export function createDesktopChannel(opts: { registry: DesktopIdentityRegistry; services: DesktopReadServices; maxPayload: number; securityConfirmations?: SecurityConfirmationManager; onDisconnect?: (ws: WebSocket) => void; onAuthenticated?: (host: string) => void; dialogRuntime?: (owner: { ws: WebSocket; current(): boolean }) => NativeDialogRuntime; workspaceRuntime?: WorkspaceRuntime; localRuntime?: LocalWorkRuntime; terminalRuntime?: DesktopTerminalRuntime; archiveActivity?: (id: string) => "idle" | "busy" | "unknown"; browserPeers?: () => DesktopBrowserPeer[] }) {
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
    let archive: ReturnType<typeof createDesktopArchive> | undefined
    let browser: ReturnType<typeof createDesktopBrowser> | undefined
    let workspace: ReturnType<typeof createDesktopWorkspace> | undefined
    let local: ReturnType<typeof createDesktopLocalWork> | undefined
    let terminal: ReturnType<typeof createDesktopTerminalWork> | undefined
    function sendLocal(frame: Record<string,unknown>):boolean {
      if(ws.readyState!==WebSocket.OPEN)return false
      try { const encoded=JSON.stringify(frame);if(Buffer.byteLength(encoded,"utf8")<=opts.maxPayload){ws.send(encoded);return true} }catch{/* Owner delivery cannot authorize execution. */}
      local?.cancel();ws.close(1009);return false
    }
    function sendTerminal(frame: Record<string, unknown>): boolean {
      if (ws.readyState !== WebSocket.OPEN) return false
      try { const body = JSON.stringify(frame); if (Buffer.byteLength(body, "utf8") <= opts.maxPayload) { ws.send(body); return true } } catch { /* Lost delivery cannot grant or repeat effects. */ }
      terminal?.cancel(); ws.close(1009); return false
    }
    function sendWorkspace(frame: Record<string, unknown>): boolean {
      if (ws.readyState !== WebSocket.OPEN) return false
      const privatePicker = typeof frame.type === "string" && frame.type.startsWith("desktop.workspace.picker.")
      let encoded: string | undefined
      try { encoded = JSON.stringify(frame) } catch { /* Refuse without inspecting arbitrary errors. */ }
      if (encoded !== undefined && Buffer.byteLength(encoded, "utf8") <= opts.maxPayload) { try { ws.send(encoded); return true } catch { if (!privatePicker) workspace?.cancel(); return false } }
      if (privatePicker) return false // The original actor settles its own unavailable selection once.
      workspace?.cancel()
      // A confirmation notification cannot settle the associated request.
      if (String(frame.type).startsWith("desktop.confirmation.") || String(frame.type).startsWith("desktop.workspace.picker.")) return false
      const failure = JSON.stringify({ type: frame.type, id: frame.id, thread_id: frame.thread_id, ok: false, error_code: frame.type === "desktop.workspace.pick.result" ? "WORKSPACE_UNCONFIRMED" : "WORKSPACE_UNAVAILABLE", ...(frame.type === "desktop.workspace.pick.result" ? { outcome: "unconfirmed" } : {}) })
      if (Buffer.byteLength(failure, "utf8") <= opts.maxPayload) { try { ws.send(failure) } catch { workspace?.cancel() } }
      else ws.close(1009)
      return false
    }
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
    retire.set(ws, () => { try { browser?.cancel() } catch { /* Retire every owned family. */ } try { archive?.cancel() } catch { /* Continue retirement. */ } try { local?.cancel() } catch { /* Retire every owned family. */ } try { terminal?.cancel() } catch { /* Continue retirement of the selected terminal actor. */ } try { workspace?.cancel() } catch { /* Continue retiring other pending work. */ } try { dialog?.cancel() } catch { /* Continue retiring other pending work. */ } try { mcpSave?.cancel() } catch { /* Socket teardown must continue. */ } try { resources?.cancel() } catch { /* Finish socket retirement. */ } })
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
          if (opts.securityConfirmations && opts.workspaceRuntime) { const owner = principal; workspace = createDesktopWorkspace({ ws, threads: opts.services.threads as ThreadManager, runtime: opts.workspaceRuntime, manager: opts.securityConfirmations, current: () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.workspace.pick"), send: sendWorkspace }) }
          { const owner = principal; browser = createDesktopBrowser({ current: () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.browser.visibility"), hasThread: id => opts.services.threads.desktopMetadataSnapshot().some(t => t.id === id), peers: opts.browserPeers || (() => []), busy: (tab, thread) => [...pendingToolCalls.values()].some(p => p.tabId === tab) || opts.securityConfirmations?.hasPendingForWorker(thread) === true || opts.securityConfirmations?.hasPendingForOriginWs(ws) === true }) }
          { const owner = principal; const current = () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.chat.send"); dialog = createDesktopDialog({ threads: opts.services.threads as ThreadManager, runtime: opts.dialogRuntime?.({ ws, current }), current, send: frame => send(ws, frame), maxPayload: opts.maxPayload, browser }) }
          { const owner = principal; archive = createDesktopArchive({ threads: {
            desktopArchiveSnapshot: () => { if (!opts.services.threads.desktopArchiveSnapshot) throw Error("DESKTOP_ARCHIVE_UNAVAILABLE"); return opts.services.threads.desktopArchiveSnapshot() },
            setDesktopArchive: (id, expected, archived) => { if (!opts.services.threads.setDesktopArchive) throw Error("DESKTOP_ARCHIVE_UNAVAILABLE"); return opts.services.threads.setDesktopArchive(id, expected, archived) },
          }, current: method => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, method), activity: opts.archiveActivity }) }
          // One actor owns the shared terminal methods and local-work confirmations.
          // Full local work retains workspace/agent support; the terminal-only runtime
          // remains an injectable fallback for hosts which do not supply localRuntime.
          if(opts.securityConfirmations&&opts.localRuntime){const owner=principal;local=createDesktopLocalWork({threads:opts.services.threads as ThreadManager,runtime:opts.localRuntime,manager:opts.securityConfirmations,ws,current:()=>ws.readyState===WebSocket.OPEN&&opts.registry.allows(owner,"desktop.terminal.open"),send:sendLocal,maxPayload:opts.maxPayload})}
          else if (opts.securityConfirmations && opts.terminalRuntime) { const owner = principal; terminal = createDesktopTerminalWork({ ws, threads: opts.services.threads as ThreadManager, runtime: opts.terminalRuntime, manager: opts.securityConfirmations, current: () => ws.readyState === WebSocket.OPEN && opts.registry.allows(owner, "desktop.terminal.open"), send: sendTerminal, maxPayload: opts.maxPayload }) }
          send(ws, { type: "desktop.ready", protocol_version: 1 }); opts.onAuthenticated?.(principal.hostSessionId); return
        }
        ws.terminate(); return
      }
      if ((DESKTOP_BROWSER_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!browser || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return }
        const owner = principal
        // handle() performs revoke/intent fences synchronously before its first await.
        void browser.handle(frame).then(result => { if (frame.type !== "desktop.browser.retire" && opts.registry.allows(owner, String(frame.type))) send(ws, result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) send(ws, { type: String(frame.type) + ".result", id: frame.id, ok: false, error_code: "DESKTOP_BROWSER_UNAVAILABLE" }) })
        return
      }
      browser?.intent(String(frame.type), frame.thread_id)
      if((DESKTOP_LOCAL_WORK_METHODS as readonly string[]).includes(String(frame.type)) && (local || !(DESKTOP_TERMINAL_METHODS as readonly string[]).includes(String(frame.type)))){
        if(!local||!opts.registry.allows(principal,String(frame.type))){send(ws,{type:"desktop.error",id:frame.id,error_code:"DESKTOP_METHOD_DENIED"});return}
        const owner=principal;void local.handle(frame).then(result=>{if(opts.registry.allows(owner,String(frame.type)))sendLocal(result)}).catch(()=>{if(opts.registry.allows(owner,String(frame.type)))sendLocal({type:String(frame.type)+".result",id:frame.id,thread_id:frame.thread_id,ok:false,error_code:"LOCAL_UNAVAILABLE"})});return
      }
      if ((DESKTOP_ARCHIVE_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!archive || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: String(frame.type) + ".result", id: frame.id, ok: false, ...(frame.thread_id === undefined ? {} : { thread_id: frame.thread_id }), ...(frame.type === "desktop.archive.set" ? { saved: false } : {}), error_code: "DESKTOP_ARCHIVE_METHOD_DENIED" }); return }
        send(ws, archive.handle(frame)); return
      }
      if ((DESKTOP_TERMINAL_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!terminal || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: String(frame.type) + ".result", id: frame.id, thread_id: frame.thread_id, ok: false, error_code: "DESKTOP_METHOD_DENIED" }); return }
        const owner = principal
        void terminal.handle(frame).then(result => { if (opts.registry.allows(owner, String(frame.type))) sendTerminal(result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) sendTerminal({ type: String(frame.type) + ".result", id: frame.id, thread_id: frame.thread_id, ok: false, error_code: "LOCAL_UNAVAILABLE" }) })
        return
      }
      if ((DESKTOP_DIALOG_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!dialog || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return }
        dialog.handle(frame); return
      }
      if (frame.type === "desktop.workspace.picker.result") {
        if (workspace && opts.registry.allows(principal, "desktop.workspace.picker.result")) workspace.selected(frame)
        return
      }
      if ((DESKTOP_WORKSPACE_METHODS as readonly string[]).includes(String(frame.type))) {
        if (!workspace || !opts.registry.allows(principal, String(frame.type))) { send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return }
        const owner = principal
        void workspace.handle(frame).then(result => { if (opts.registry.allows(owner, String(frame.type))) sendWorkspace(result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) sendWorkspace({ type: String(frame.type) + ".result", id: frame.id, thread_id: frame.thread_id, ok: false, error_code: "WORKSPACE_UNAVAILABLE", ...(frame.type === "desktop.workspace.pick" ? { outcome: "unavailable" } : {}) }) })
        return
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
        if (frame.type === "desktop.confirmation.decision") { if (frame.purpose === "local-work") { if (local) local.decide(frame); else terminal?.decide(frame) } else if (frame.purpose === "workspace") workspace?.decide(frame); else if (frame.purpose === "resource") resources?.decide(frame); else if (!Object.hasOwn(frame, "purpose")) mcpSave.decide(frame); return }
        const owner = principal
        void mcpSave.handle(frame).then(result => { if (opts.registry.allows(owner, String(frame.type))) send(ws, result) }).catch(() => { if (opts.registry.allows(owner, String(frame.type))) send(ws, { type: "desktop.error", error_code: "DESKTOP_MCP_SAVE_FAILED", ...(typeof frame.id === "string" ? { id: frame.id } : {}) }) })
        return
      }
      if (frame.type === "thread.search") {
        const allowed = frame.limit === undefined ? ["type", "id", "query"] : ["type", "id", "query", "limit"]
        if (!exact(frame, allowed) || typeof frame.id !== "string" || frame.id.length > 200 || typeof frame.query !== "string" || frame.query.length > 120 || (frame.limit !== undefined && (typeof frame.limit !== "number" || !Number.isInteger(frame.limit) || frame.limit < 1 || frame.limit > 20)) || !opts.registry.allows(principal, "thread.search")) {
          send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_METHOD_DENIED" }); return
        }
        try {
          const result = desktopTitleSearch(frame.query, frame.limit as number | undefined, opts.services)
          if (ws.readyState === WebSocket.OPEN && opts.registry.allows(principal, "thread.search")) send(ws, { ...result, id: frame.id })
        } catch { if (opts.registry.allows(principal, "thread.search")) send(ws, { type: "desktop.error", id: frame.id, error_code: "DESKTOP_READ_FAILED" }) }
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
