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

// systray2's resolveIcon() calls fs.pathExists() on the icon value —
// if it's a file path it reads & base64-encodes it, otherwise it's skipped.
// On Windows we MUST pass the file path; raw base64 is silently ignored.
function resolveIconPath(name: string): string {
  try {
    const { getAssetsDir } = require("../paths")
    const iconPath = path.join(getAssetsDir(), name)
    if (fs.existsSync(iconPath)) return iconPath
  } catch { /* fall through */ }
  console.warn(`[systray2] Icon file not found: ${name}, using fallback`)
  return FALLBACK_ICON
}

function getPlatformIconFile(status: string): string {
  if (process.platform === "win32") {
    return resolveIconPath(`tray-icon-${status}.ico`)
  }
  return resolveIconPath(`tray-icon-${status}.png`)
}

const SEP = { title: "---" }

function getIcon(status: string): string {
  switch (status) {
    case "running": return getPlatformIconFile("green")
    case "stopped": return getPlatformIconFile("red")
    default: return getPlatformIconFile("yellow")
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

  // Debounce rebuild to avoid rapid kill/recreate cycles
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null

  // --- UnifiedTray ---

  async start(_config: TrayConfig): Promise<void> {
    const Tray = await this.loadModule()
    const menu = this.buildMenu()

    const instance = new Tray({ menu, debug: !!process.env.CMSPARK_DEBUG, copyDir: true })
    await instance.ready()
    console.log("[tray] Started with systray2 backend")
    console.log("[tray] Platform:", process.platform, "Arch:", process.arch)

    instance.onClick((action: any) => {
      const seqId = action?.seq_id
      if (typeof seqId !== "number" || seqId < 0 || seqId >= this.seqMap.length) {
        console.error("[systray2] Invalid seq_id:", seqId, "seqMap length:", this.seqMap.length)
        return
      }
      const mapped = this.seqMap[seqId]
      if (mapped && this.actionCallback) {
        this.actionCallback(mapped)
      }
      if (mapped?.type === "quit") {
        this.shuttingDown = true
        instance.kill().catch(() => {})
      }
    })

    instance.onExit(() => {
      this.systray = null
      if (this.shuttingDown) return
      console.warn("[systray2] Tray process exited unexpectedly, attempting restart in 3s...")
      setTimeout(async () => {
        if (this.shuttingDown) return
        try {
          await this.start({} as TrayConfig)
          console.log("[systray2] Tray restarted successfully")
        } catch (err: any) {
          console.error("[systray2] Tray restart failed:", err.message)
        }
      }, 3000)
    })

    instance.onError((err: any) => console.error("[systray2] Error:", err))
    this.systray = instance
  }

  updateStatus(status: "running" | "stopped" | "unknown", _wsConnected: boolean, _pid: number | null): void {
    if (this.status === status) return
    this.status = status
    this.rebuild()
  }

  updateAutostart(enabled: boolean): void {
    if (this.autostartEnabled === enabled) return
    this.autostartEnabled = enabled
    this.rebuild()
  }

  setQuickActions(actions: QuickActionItem[]): void {
    if (JSON.stringify(this.quickActions) === JSON.stringify(actions)) return
    this.quickActions = actions
    this.rebuild()
  }

  setRecentThreads(threads: RecentThreadItem[]): void {
    if (JSON.stringify(this.recentThreads) === JSON.stringify(threads)) return
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

    // Status header
    const statusLabel = this.status === "running"
      ? "[运行中] CMspark Agent"
      : this.status === "stopped"
        ? "[已停止] CMspark Agent"
        : "[检测中] CMspark Agent"
    push(statusLabel, { type: "status" }, { enabled: false })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    // Start / Stop / Restart
    push("启动 Companion", { type: "start" }, { enabled: !running })
    push("停止 Companion", { type: "stop" }, { enabled: running })
    push("重启 Companion", { type: "restart" }, { enabled: running })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    // Status detail
    push("状态详情", { type: "status" })

    // Quick Actions
    if (this.quickActions.length > 0) {
      items.push(SEP)
      this.seqMap.push({ type: "status" })
      push("快速操作", { type: "status" }, { enabled: false })
      for (const qa of this.quickActions) {
        push(`  ${qa.title}`, { type: "quick-action", payload: { id: qa.id } })
      }
    }

    // Recent Threads
    if (this.recentThreads.length > 0) {
      items.push(SEP)
      this.seqMap.push({ type: "status" })
      push("最近对话", { type: "status" }, { enabled: false })
      for (const t of this.recentThreads) {
        push(`  > ${t.title}`, { type: "recent-thread", payload: { id: t.id } })
      }
    }

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("打开日志目录", { type: "logs" })
    push("打开 Chrome", { type: "chrome" })
    push("设置", { type: "settings" })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("开机自启", { type: "autostart" }, { checked: this.autostartEnabled })

    items.push(SEP)
    this.seqMap.push({ type: "status" })

    push("退出", { type: "quit" })

    return {
      icon: getIcon(this.status),
      title: getTooltip(this.status),
      tooltip: getTooltip(this.status),
      isTemplateIcon: false,
      items,
    }
  }

  private isRebuilding = false
  private needsRebuild = false

  private async rebuild(): Promise<void> {
    if (!this.systray) return
    if (this.isRebuilding) {
      // Coalesce concurrent rebuild requests while a rebuild is in flight
      this.needsRebuild = true
      return
    }
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
    }
    this.rebuildTimer = setTimeout(async () => {
      this.rebuildTimer = null
      this.isRebuilding = true
      // systray2's update-menu does not refresh the internalIdMap, causing click
      // events to map to stale items after the menu structure changes.
      // Work around by killing and recreating the tray instance.
      const wasShuttingDown = this.shuttingDown
      this.shuttingDown = true
      try {
        await this.systray.kill()
      } catch {
        // ignore
      }
      this.systray = null
      this.shuttingDown = wasShuttingDown
      try {
        await this.start({} as TrayConfig)
      } catch (err: any) {
        console.error("[systray2] Failed to recreate tray:", err.message)
      } finally {
        this.isRebuilding = false
        if (this.needsRebuild) {
          this.needsRebuild = false
          this.rebuild()
        }
      }
    }, 500)
  }

  private async loadModule(): Promise<any> {
    const mod = await import("systray2")
    // Support both ESM default and CJS-style exports for packaging resilience
    return (mod as any).default || (mod as any).SysTray || mod
  }
}
