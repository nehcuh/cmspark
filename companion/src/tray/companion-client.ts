// CompanionClient — WebSocket client for tray ↔ companion communication
//
// Connects to the companion server (ws://127.0.0.1:23401) and uses the
// existing message protocol (thread.list, skill.list, system.ping, etc.)
// to populate tray menus with live data.
//
// P0-2B (#35) authentication: the companion challenges every new connection,
// so this client must complete the shared-secret HMAC handshake before any app
// message is accepted. "connected" means AUTHENTICATED — refreshAll() runs only
// after auth.ok, mirroring the extension's chrome-extension/src/background/ws-client.ts.
// The tray is a first-party local process in the same codebase as the server and
// reads the SAME ws_secret file via getOrCreateSharedSecret(), so it always holds
// the secret the server will accept (both sides converge on ~/.cmspark-agent/ws_secret).
//
// When the companion is unreachable, returns default Quick Actions.

import * as crypto from "crypto"
import WebSocket from "ws"
import { QuickActionItem, RecentThreadItem } from "./tray-adapter"
import { getOrCreateSharedSecret, AUTH_TIMEOUT_MS } from "../ws-auth"

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

/** Origin presented on the WS upgrade. Allow-listed by isAllowedWsOrigin as a
 *  trusted first-party tray origin. The real gate is the #35 HMAC handshake —
 *  a web page cannot forge an arbitrary browser Origin, so this string only ever
 *  reaches the server from the local tray. */
const DEFAULT_TRAY_ORIGIN = "cmspark-tray://local"

export interface CompanionClientOptions {
  host: string
  port: number
  reconnectInterval: number
  maxReconnectAttempts: number
  /** Override the WS Origin header (defaults to the trusted tray origin). */
  origin?: string
  /** Override the shared-secret source (defaults to getOrCreateSharedSecret).
   *  Mainly a test seam for simulating the unpaired (no-secret) state. */
  secretLoader?: () => string
}

export type ConnectionState = "connected" | "connecting" | "disconnected"

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Default Quick Actions (used when companion is unreachable)
// ---------------------------------------------------------------------------

const DEFAULT_QUICK_ACTIONS: QuickActionItem[] = [
  { id: "read-page", title: "📖 读取当前页面" },
  { id: "screenshot", title: "📸 截图并分析" },
  { id: "extract-data", title: "📝 提取页面数据" },
  { id: "summarize", title: "📋 总结页面" },
  { id: "new-chat", title: "💬 新建对话" },
]

// ---------------------------------------------------------------------------
// CompanionClient
// ---------------------------------------------------------------------------

export class CompanionClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private pendingRequests = new Map<string, PendingRequest>()
  private requestId = 0
  private _state: ConnectionState = "disconnected"

  /** Authenticated = companion accepted our HMAC handshake. App sends + data
   *  fetches are gated on this; promoted to "connected" only after auth.ok. */
  private authenticated = false
  /** No shared secret available (first run, not paired). Suppresses reconnect storm. */
  private unpaired = false
  /** Resolver for the in-flight connect() promise (fired once on auth.ok or close). */
  private connectResolve: (() => void) | null = null
  /** Auth-handshake watchdog; if the server upgrades but never challenges within
   *  AUTH_TIMEOUT_MS, close so we reconnect instead of parking in "connecting". */
  private connectAuthTimer: ReturnType<typeof setTimeout> | null = null

  // Heartbeat: detect dead connections where TCP is silently dropped
  private lastActivityAt = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private readonly HEARTBEAT_INTERVAL_MS = 30000
  private readonly HEARTBEAT_TIMEOUT_MS = 90000

  // Event callbacks
  private connectedCbs: Array<() => void> = []
  private disconnectedCbs: Array<() => void> = []
  private dataChangedCbs: Array<() => void> = []

  // Cached data
  private cachedThreads: RecentThreadItem[] = []
  private cachedQuickActions: QuickActionItem[] = DEFAULT_QUICK_ACTIONS

  constructor(private options: CompanionClientOptions) {}

  // --- Connection management ---

  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return
    this._state = "connecting"
    this.authenticated = false

    const url = `ws://${this.options.host}:${this.options.port}`
    const origin = this.options.origin ?? DEFAULT_TRAY_ORIGIN

    return new Promise((resolve) => {
      this.connectResolve = resolve

      const ws = new WebSocket(url, { handshakeTimeout: 3000, origin })

      ws.on("open", () => {
        // WS open ≠ authenticated. The companion sends auth.challenge immediately;
        // we stay "connecting" and promote to "connected" only on auth.ok. Sending
        // any app message now is terminated by the companion (unauthenticated).
        this.reconnectAttempts = 0
        this.debug("socket open; awaiting auth.ok")

        // Watchdog: the server challenges on connect, so auth.ok should land within
        // AUTH_TIMEOUT_MS. If it never does (server upgraded then hung/crashed), close
        // so handleDisconnect + scheduleReconnect take over — otherwise connect() would
        // park in "connecting" forever with no data and no retry.
        this.connectAuthTimer = setTimeout(() => {
          this.connectAuthTimer = null
          this.debug("auth handshake timed out; closing to reconnect")
          try { ws.close() } catch { /* closing */ }
        }, AUTH_TIMEOUT_MS)
      })

      ws.on("message", (raw: WebSocket.Data) => {
        this.lastActivityAt = Date.now()
        this.handleMessage(raw.toString())
      })

      ws.on("ping", () => {
        this.lastActivityAt = Date.now()
      })

      ws.on("close", () => {
        this.handleDisconnect()
        this.settleConnect()
      })

      ws.on("error", () => {
        this.handleDisconnect()
        this.settleConnect()
      })

      this.ws = ws
    })
  }

  /** Resolve the in-flight connect() promise exactly once (idempotent). Also
   *  clears the auth-handshake watchdog (no longer needed once settled). */
  private settleConnect(): void {
    if (this.connectAuthTimer) {
      clearTimeout(this.connectAuthTimer)
      this.connectAuthTimer = null
    }
    if (this.connectResolve) {
      const r = this.connectResolve
      this.connectResolve = null
      r()
    }
  }

  disconnect(): void {
    this.stopHeartbeat()
    this.clearReconnect()
    if (this.ws) {
      try { this.ws.terminate() } catch { /* ignore */ }
      this.ws = null
    }
    this._state = "disconnected"
    this.authenticated = false
    this.rejectAllPending("disconnect")
    this.settleConnect()
  }

  get connectionState(): ConnectionState {
    return this._state
  }

  // --- Data fetching ---

  async fetchQuickActions(): Promise<QuickActionItem[]> {
    if (this._state !== "connected") return DEFAULT_QUICK_ACTIONS

    try {
      const skills = await this.sendRequest("skill.list")
      if (skills?.skills && Array.isArray(skills.skills)) {
        // Convert skills to quick actions
        const fromSkills: QuickActionItem[] = skills.skills
          .filter((s: any) => s.builtin === false || s.type === "prompt_template")
          .slice(0, 5)
          .map((s: any) => ({
            id: `skill:${s.name}`,
            title: `⚡ ${s.name}`,
          }))

        if (fromSkills.length > 0) {
          this.cachedQuickActions = fromSkills
          return fromSkills
        }
      }
    } catch {
      // Server doesn't support or error — use defaults
    }
    this.cachedQuickActions = DEFAULT_QUICK_ACTIONS
    return DEFAULT_QUICK_ACTIONS
  }

  async fetchRecentThreads(limit = 5): Promise<RecentThreadItem[]> {
    if (this._state !== "connected") return []

    try {
      const resp = await this.sendRequest("thread.list")
      if (resp?.threads && Array.isArray(resp.threads)) {
        const threads: RecentThreadItem[] = resp.threads
          .sort((a: any, b: any) => {
            const ta = a.updated_at || a.created_at || ""
            const tb = b.updated_at || b.created_at || ""
            return tb.localeCompare(ta)
          })
          .slice(0, limit)
          .map((t: any) => ({
            id: t.id,
            title: t.alias || t.id,
            lastActivity: t.updated_at || t.created_at,
          }))
        this.cachedThreads = threads
        return threads
      }
    } catch {
      // ignore
    }
    this.cachedThreads = []
    return []
  }

  async executeQuickAction(id: string): Promise<any> {
    if (this._state !== "connected") {
      console.warn(`[companion-client] 未连接，无法执行快速操作: ${id}`)
      return { success: false, error: "未连接" }
    }

    try {
      const result = await this.sendRequest("executeQuickAction", { actionId: id }, 30000)
      this.debug(`Quick action '${id}' result: ${JSON.stringify(result)}`)
      return result
    } catch (err: any) {
      console.error(`[companion-client] 快速操作 '${id}' 失败: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async openThread(id: string): Promise<void> {
    if (this._state !== "connected") return
    try {
      await this.sendRequest("thread.select", { thread_id: id })
    } catch {
      // ignore
    }
  }

  /** Refresh all data from server */
  async refreshAll(): Promise<void> {
    const [actions, threads] = await Promise.all([
      this.fetchQuickActions(),
      this.fetchRecentThreads(),
    ])
    this.cachedQuickActions = actions
    this.cachedThreads = threads
    this.dataChangedCbs.forEach(cb => cb())
  }

  // --- Event callbacks ---

  onConnected(cb: () => void): void { this.connectedCbs.push(cb) }
  onDisconnected(cb: () => void): void { this.disconnectedCbs.push(cb) }
  onDataChanged(cb: () => void): void { this.dataChangedCbs.push(cb) }

  // --- Accessors for cached data ---

  get quickActions(): QuickActionItem[] { return this.cachedQuickActions }
  get recentThreads(): RecentThreadItem[] { return this.cachedThreads }

  // --- Internals ---

  private sendRequest(type: string, params?: Record<string, any>, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Must be AUTHENTICATED, not merely socket-open: between open and auth.ok the
      // companion terminates any non-handshake message (ws.unauthenticated_message).
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
        reject(new Error("Not connected"))
        return
      }

      const id = `tray-${++this.requestId}`
      const effectiveTimeout = timeoutMs ?? 5000
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${type}`))
      }, effectiveTimeout)

      this.pendingRequests.set(id, { resolve, reject, timer })

      const msg: Record<string, any> = { type, id }
      if (params) Object.assign(msg, params)

      try {
        this.ws.send(JSON.stringify(msg))
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(err)
      }
    })
  }

  private handleMessage(raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // --- Auth handshake (handled inline, never matched as request/response) ---
    if (msg.type === "auth.challenge") {
      this.respondToChallenge(msg.nonce).catch(() => {})
      return
    }
    if (msg.type === "auth.ok") {
      // Promote to authenticated+connected. App sends are now accepted; fetch data.
      this.authenticated = true
      this._state = "connected"
      this.lastActivityAt = Date.now()
      this.startHeartbeat()
      this.debug("authenticated")
      this.settleConnect()
      this.connectedCbs.forEach(cb => cb())
      this.refreshAll().catch(() => {})
      return
    }
    // auth.failed / handshake timeout → companion terminates the socket; the
    // "close" handler resets state and schedules a reconnect.

    // Match response to pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!
      clearTimeout(pending.timer)
      this.pendingRequests.delete(msg.id)

      if (msg.error) {
        pending.reject(new Error(msg.error.message || msg.error))
      } else {
        pending.resolve(msg)
      }
      return
    }

    // --- Server push handlers ---
    // IMPORTANT: only handle TRUE server pushes here. Any message carrying an `id`
    // was already matched to a pending request above and returned. NEVER add a
    // response-type name (e.g. skill.list / thread.list / *.list) to these
    // conditions — a response re-triggering its own request creates a tight
    // request/response loop (see the skill.list hotfix that pinned both CPUs).
    if (msg.type === "connected") {
      // App-level connected (server sends this right after auth.ok). We already
      // promoted on auth.ok, so this is a no-op here — kept for clarity.
      return
    }

    // If server pushes thread updates, refresh
    if (msg.type === "thread.created" || msg.type === "thread.deleted" || msg.type === "thread.updated") {
      this.fetchRecentThreads().then(() => {
        this.dataChangedCbs.forEach(cb => cb())
      }).catch(() => {})
    }

    // `skill.list` is the response to our own fetchQuickActions() request, not a
    // server push. Reacting to it here re-triggers fetchQuickActions() on every
    // response, creating a request/response loop. Match responses by id above.
    if (msg.type === "skill.activated" || msg.type === "skill.deactivated") {
      this.fetchQuickActions().then(() => {
        this.dataChangedCbs.forEach(cb => cb())
      }).catch(() => {})
    }
  }

  /** Respond to the companion's auth.challenge with proof = HMAC(secret, nonce).
   *  Mirrors the extension's ws-client handleChallenge. If no secret is available,
   *  mark unpaired and close so we don't storm reconnect with doomed handshakes. */
  private async respondToChallenge(nonce: string): Promise<void> {
    const secret = this.loadSecret()
    if (!secret) {
      this.unpaired = true
      this.debug("no shared secret; marking unpaired and closing")
      try { this.ws?.close() } catch { /* closing */ }
      return
    }
    this.unpaired = false
    try {
      // Matches ws-auth verifyProof exactly:
      //   crypto.createHmac("sha256", secret).update(nonce).digest("hex")
      // (UTF-8 bytes of the hex secret as the HMAC key, UTF-8 nonce as the message.)
      const proof = crypto.createHmac("sha256", secret).update(String(nonce)).digest("hex")
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "auth.handshake", proof }))
      }
    } catch (err) {
      this.debug(`auth handshake failed: ${(err as Error).message}`)
    }
  }

  /** Load the shared secret from the companion data dir (same file the server
   *  uses; getOrCreateSharedSecret reads-or-creates it owner-only at 0o600).
   *  The tray creates the file if missing so it always has a secret to present —
   *  the server reads the same file, so both converge on one secret regardless of
   *  startup order. `secretLoader` is a test seam for the unpaired state. */
  private loadSecret(): string {
    try {
      return this.options.secretLoader ? this.options.secretLoader() : getOrCreateSharedSecret()
    } catch {
      return ""
    }
  }

  private handleDisconnect(): void {
    if (this._state === "disconnected") return
    this._state = "disconnected"
    this.authenticated = false
    this.ws = null
    this.stopHeartbeat()

    // Reset to defaults
    this.cachedQuickActions = DEFAULT_QUICK_ACTIONS
    this.cachedThreads = []

    this.rejectAllPending("disconnect")
    this.disconnectedCbs.forEach(cb => cb())
    this.dataChangedCbs.forEach(cb => cb())

    this.scheduleReconnect()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this._state !== "connected") return
      const idle = Date.now() - this.lastActivityAt
      if (idle > this.HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[companion-client] Connection dead (no activity for ${idle}ms), forcing reconnect`)
        this.disconnect()
        this.scheduleReconnect()
      }
    }, this.HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    // No secret yet → don't storm the companion with doomed handshakes; the tray
    // reconnects on the next launch once a secret exists (after pairing).
    if (this.unpaired) {
      this.debug("unpaired — suppressing reconnect until a shared secret exists")
      return
    }

    if (this.options.maxReconnectAttempts >= 0 &&
        this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.debug("max reconnect attempts reached")
      return
    }

    this.clearReconnect()
    // Exponential backoff: base * 1.5^attempt, capped at 30s
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts),
      30000,
    )
    this.reconnectAttempts++
    this.debug(`reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {})
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingRequests.clear()
  }

  private debug(msg: string): void {
    if (process.env.CMSPARK_DEBUG) {
      console.log(`[companion-client] ${msg}`)
    }
  }
}
