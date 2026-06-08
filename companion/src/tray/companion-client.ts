// CompanionClient — WebSocket client for tray ↔ companion communication
//
// Connects to the companion server (ws://127.0.0.1:23401) and uses the
// existing message protocol (thread.list, skill.list, system.ping, etc.)
// to populate tray menus with live data.
//
// When the companion is unreachable, returns default Quick Actions.

import WebSocket from "ws"
import { QuickActionItem, RecentThreadItem } from "./tray-adapter"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanionClientOptions {
  host: string
  port: number
  reconnectInterval: number
  maxReconnectAttempts: number
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

    const url = `ws://${this.options.host}:${this.options.port}`

    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(url, { handshakeTimeout: 3000 })

      ws.on("open", () => {
        if (settled) return
        settled = true
        this._state = "connected"
        this.reconnectAttempts = 0
        this.connectedCbs.forEach(cb => cb())
        this.debug("connected")

        // Fetch initial data
        this.refreshAll().catch(() => {})
        resolve()
      })

      ws.on("message", (raw: WebSocket.Data) => {
        this.handleMessage(raw.toString())
      })

      ws.on("close", () => {
        this.handleDisconnect()
        if (!settled) {
          settled = true
          resolve() // resolve, not reject — disconnected is a valid initial state
        }
      })

      ws.on("error", () => {
        this.handleDisconnect()
        if (!settled) {
          settled = true
          resolve()
        }
      })

      this.ws = ws
    })
  }

  disconnect(): void {
    this.clearReconnect()
    if (this.ws) {
      try { this.ws.terminate() } catch { /* ignore */ }
      this.ws = null
    }
    this._state = "disconnected"
    this.rejectAllPending("disconnect")
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
      const result = await this.sendRequest("executeQuickAction", { id })
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

  private sendRequest(type: string, params?: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"))
        return
      }

      const id = `tray-${++this.requestId}`
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${type}`))
      }, 5000)

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

    // Handle server pushes (type starts with known patterns)
    if (msg.type === "connected") {
      // Initial handshake from server
      return
    }

    // If server pushes thread updates, refresh
    if (msg.type === "thread.created" || msg.type === "thread.deleted" || msg.type === "thread.updated") {
      this.fetchRecentThreads().then(() => {
        this.dataChangedCbs.forEach(cb => cb())
      }).catch(() => {})
    }

    if (msg.type === "skill.activated" || msg.type === "skill.deactivated" || msg.type === "skill.list") {
      this.fetchQuickActions().then(() => {
        this.dataChangedCbs.forEach(cb => cb())
      }).catch(() => {})
    }
  }

  private handleDisconnect(): void {
    if (this._state === "disconnected") return
    this._state = "disconnected"
    this.ws = null

    // Reset to defaults
    this.cachedQuickActions = DEFAULT_QUICK_ACTIONS
    this.cachedThreads = []

    this.rejectAllPending("disconnect")
    this.disconnectedCbs.forEach(cb => cb())
    this.dataChangedCbs.forEach(cb => cb())

    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
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
    for (const [id, pending] of this.pendingRequests) {
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
