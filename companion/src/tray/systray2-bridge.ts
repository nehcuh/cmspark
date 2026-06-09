// SysTray2 Bridge — manages the systray2 cross-platform tray
//
// systray2 does not support submenus, so Quick Actions and Recent Threads
// are rendered as flat items with emoji prefixes and separator dividers.

import * as path from "path"
import * as fs from "fs"

import {
  UnifiedTray,
  TrayConfig,
  TrayMenuAction,
  TrayDataProvider,
  QuickActionItem,
  RecentThreadItem,
} from "./tray-adapter"

// ---------------------------------------------------------------------------
// Icon loading (base64 for systray2) — ICO → PNG → inline fallback
// ---------------------------------------------------------------------------

const FALLBACK_ICON = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

function tryLoadIcon(filename: string): string | null {
  try {
    const { getAssetsDir } = require("../paths")
    const iconPath = path.join(getAssetsDir(), filename)
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64")
    }
  } catch { /* fall through */ }
  return null
}

function loadIconBase64(name: string): string {
  try {
    const { getAssetsDir } = require("../paths")
    const iconPath = path.join(getAssetsDir(), name)
    return fs.readFileSync(iconPath).toString("base64")
  } catch (err) {
    console.error(`[systray2] Failed to load icon ${name}:`, err)
    return FALLBACK_ICON
  }
}

function loadPlatformIcon(baseName: string): string {
  if (process.platform === "win32") {
    const ico = tryLoadIcon(baseName + ".ico")
    if (ico !== null) {
      console.log(`[systray2] Loaded ICO icon: ${baseName}.ico (${ico.length} chars base64)`)
      return ico
    }
    console.warn(`[systray2] ICO not found for ${baseName}, falling back to PNG`)
  }
  return loadIconBase64(baseName + ".png")
}

const ICON_GREEN = loadPlatformIcon("tray-icon-green")
const ICON_RED = loadPlatformIcon("tray-icon-red")
const ICON_YELLOW = loadPlatformIcon("tray-icon-yellow")
const ICON_TEMPLATE = loadPlatformIcon("tray-icon-template")

const SEP = { title: "---" }

function getIcon(status: string): string {
  switch (status) {
    case "running": return ICON_GREEN
    case "stopped": return ICON_RED
    default: return ICON_YELLOW
  }
}

function getTooltip(status: string): string {
  switch (status) {
    case "running": return "CMspark Agent - 运行中"
    case "stopped": return "CMspark Agent - 已停止"
    default: return "CMspark Agent - 检测中..."
  }
}

// ---------------------------------------------------------------------------
// SysTray2Adapter
// ---------------------------------------------------------------------------

export class SysTray2Adapter implements UnifiedTray {
  private systray: any = null
  private actionCallback: ((action: TrayMenuAction) => void) | null = null
  private dataProvider: TrayDataProvider | null = null
  private shuttingDown = false

  // Cached state
  private status: string = "unknown"
  private autostartEnabled = false
  private quickActions: QuickActionItem[] = []
  private recentThreads: RecentThreadItem[] = []

  // seq_id → action mapping (rebuilt each time menu is constructed)
  private seqMap: TrayMenuAction[] = []

  // --- UnifiedTray ---

  async start(_config: TrayConfig): Promise<void> {
    const Tray = await this.loadModule()
    const menu = this.buildMenu()

    const instance = new Tray({ menu, debug: !!process.env.CMSPARK_DEBUG, copyDir: true })
    await instance.ready()
    console.log("[tray] Started with systray2 backend")
    console.log("[tray] Platform:", process.platform, "Arch:", process.arch)

    instance.onClick((action: any) => {
      const mapped = this.seqMap[action.seq_id]
      if (mapped && this.actionCallback) {
        this.actionCallback(mapped)
      }
      if (mapped?.type === "quit") {
        this.shuttingDown = true
        instance.kill().catch(() => {})
      }
    })

    instance.onExit(() => {
      if (!this.shuttingDown) process.exit(0)
    })

    instance.onError((err: any) => console.error("[systray2] Error:", err))
    this.systray = instance
  }

  updateStatus(status: "running" | "stopped" | "unknown", _wsConnected: boolean, _pid: number | null): void {
    this.status = status
    this.rebuild()
  }

  updateAutostart(enabled: boolean): void {
    this.autostartEnabled = enabled
    this.rebuild()
  }

  setQuickActions(actions: QuickActionItem[]): void {
    this.quickActions = actions
    this.rebuild()
  }

  setRecentThreads(threads: RecentThreadItem[]): void {
    this.recentThreads = threads
    this.rebuild()
  }

  onAction(callback: (action: TrayMenuAction) => void): void {
    this.actionCallback = callback
  }

  setDataProvider(provider: TrayDataProvider): void {
    this.dataProvider = provider
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    if (this.systray) {
      await this.systray.kill().catch(() => {})
      this.systray = null
    }
  }

  // --- Internals ---

  private buildMenu() {
    this.seqMap = []
    const running = this.status === "running"
    const items: any[] = []

    const push = (title: string, mapping: TrayMenuAction, opts?: { enabled?: boolean; checked?: boolean }) => {
      items.push({
        title,
        tooltip: title,
        checked: opts?.checked ?? false,
        enabled: opts?.enabled ?? true,
      })
      this.seqMap.push(mapping)
    }

    // Status header (avoid emoji — Windows tray binary may not handle UTF-8 emoji)
    const statusLabel = this.status === "running" ? "[ON] CMspark Agent" : this.status === "stopped" ? "[OFF] CMspark Agent" : "[...] CMspark Agent"
    push(statusLabel, { type: "status" }, { enabled: false })

    items.push(SEP)
    this.seqMap.push({ type: "status" }) // placeholder for separator index

    // Start / Stop / Restart
    push("Start Companion", { type: "start" }, { enabled: !running })
    push("Stop Companion", { type: "stop" }, { enabled: running })
    push("Restart Companion", { type: "restart" }, { enabled: running })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    // Status detail
    push("Status Details", { type: "status" })

    // Quick Actions
    if (this.quickActions.length > 0) {
      items.push(SEP)
      this.seqMap.push({ type: "status" })
      for (const qa of this.quickActions) {
        push(qa.title, { type: "quick-action", payload: { id: qa.id } })
      }
    }

    // Recent Threads
    if (this.recentThreads.length > 0) {
      items.push(SEP)
      this.seqMap.push({ type: "status" })
      for (const t of this.recentThreads) {
        push("> " + t.title, { type: "recent-thread", payload: { id: t.id } })
      }
    }

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("Open Logs", { type: "logs" })
    push("Open Chrome", { type: "chrome" })
    push("Settings", { type: "settings" })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("Auto-start on Login", { type: "autostart" }, { checked: this.autostartEnabled })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("Quit", { type: "quit" })

    return {
      icon: getIcon(this.status),
      title: getTooltip(this.status),
      tooltip: getTooltip(this.status),
      isTemplateIcon: false,
      items,
    }
  }

  private async rebuild(): Promise<void> {
    if (!this.systray) return
    try {
      const menu = this.buildMenu()
      await this.systray.sendAction({ type: "update-menu", menu })
    } catch {
      // systray2 may have exited
    }
  }

  private async loadModule(): Promise<any> {
    const mod = await import("systray2")
    return mod.default
  }
}
