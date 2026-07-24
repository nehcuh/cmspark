// Readline Tray — terminal fallback when no system tray is available
//
// Presents an interactive CLI menu with numbered options.

import * as readline from "readline"

import {
  UnifiedTray,
  TrayConfig,
  TrayMenuAction,
  TrayDataProvider,
  QuickActionItem,
  RecentThreadItem,
} from "./tray-adapter"

// ---------------------------------------------------------------------------
// Wayland hint
// ---------------------------------------------------------------------------

function printWaylandHint(): void {
  if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
    console.log("")
    console.log("⚠️  检测到 Wayland 显示服务器")
    console.log("   系统托盘在 Wayland 下可能不可用。")
    console.log("   如需系统托盘支持，请切换到 X11 会话：")
    console.log('   在登录管理器中选择 "Ubuntu on Xorg" 或等效选项。')
    console.log("   当前使用 readline 菜单作为回退方案。")
    console.log("")
  }
}

// ---------------------------------------------------------------------------
// ReadlineTrayAdapter
// ---------------------------------------------------------------------------

export class ReadlineTrayAdapter implements UnifiedTray {
  private rl: readline.Interface | null = null
  private actionCallback: ((action: TrayMenuAction) => void) | null = null
  private dataProvider: TrayDataProvider | null = null

  // Cached state
  private status: "running" | "stopped" | "unknown" = "unknown"
  private wsConnected = false
  private pid: number | null = null
  private autostartEnabled = false
  private quickActions: QuickActionItem[] = []
  private recentThreads: RecentThreadItem[] = []

  // --- UnifiedTray ---

  async start(_config: TrayConfig): Promise<void> {
    printWaylandHint()
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    this.printMenu()

    this.rl.on("line", (input) => this.handleInput(input.trim()))
    this.rl.on("close", () => this.emit("quit"))
  }

  updateStatus(status: "running" | "stopped" | "unknown", wsConnected: boolean, pid: number | null): void {
    this.status = status
    this.wsConnected = wsConnected
    this.pid = pid
  }

  updateAutostart(enabled: boolean): void {
    this.autostartEnabled = enabled
  }

  setQuickActions(actions: QuickActionItem[]): void {
    this.quickActions = actions
  }

  setRecentThreads(threads: RecentThreadItem[]): void {
    this.recentThreads = threads
  }

  onAction(callback: (action: TrayMenuAction) => void): void {
    this.actionCallback = callback
  }

  setDataProvider(provider: TrayDataProvider): void {
    this.dataProvider = provider
  }

  // No native window here; the launcher falls back to clipboard-copy + notification.
  showPairingWindow(_secret: string, _paired: boolean): void { /* no-op */ }

  // P0a: readline has no native confirmation dialog. Never resolves → race falls
  // back to WS Side Panel.
  showConfirmDialog(): Promise<never> { return new Promise(() => {}) }
  cancelConfirm(_id: string): void { /* no-op */ }

  async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }

  // --- Internals ---

  private emit(type: string, payload?: Record<string, any>): void {
    if (this.actionCallback) {
      this.actionCallback({ type: type as any, payload })
    }
  }

  private printMenu(): void {
    const icon = this.status === "running" ? "🟢" : "🔴"
    const statusText = this.status === "running"
      ? `运行中 (pid: ${this.pid ?? "-"}, WS: ${this.wsConnected ? "已连接" : "未连接"})`
      : "已停止"

    console.clear()
    console.log("CMspark Agent Menu")
    console.log("==================")
    console.log("")
    console.log(`${icon} Companion ${statusText}`)
    console.log("")

    let idx = 1
    console.log(`[${idx++}] 启动 Companion`)
    console.log(`[${idx++}] 停止 Companion`)
    console.log(`[${idx++}] 重启 Companion`)
    console.log(`[${idx++}] 查看状态`)

    // Quick actions
    for (const qa of this.quickActions) {
      console.log(`[${idx++}] ${qa.title}`)
    }

    // Recent threads
    for (const t of this.recentThreads) {
      console.log(`[${idx++}] 📌 ${t.title}`)
    }

    console.log(`[${idx++}] 打开日志目录`)
    console.log(`[${idx++}] 打开 Chrome`)
    console.log(`[${idx++}] 显示配对码`)
    console.log(`[${idx}] 退出`)

    console.log("")
    process.stdout.write("请选择操作: ")
  }

  private handleInput(choice: string): void {
    // Map choices — indices shift dynamically based on quick actions / threads
    let idx = 1
    const fixedCount = 4 // start, stop, restart, status

    if (this.parseInt(choice) === idx++) { this.emit("start"); this.pause(); return }
    if (this.parseInt(choice) === idx++) { this.emit("stop"); this.pause(); return }
    if (this.parseInt(choice) === idx++) { this.emit("restart"); this.pause(); return }
    if (this.parseInt(choice) === idx++) { this.emit("status"); this.pause(); return }

    // Quick actions
    for (const qa of this.quickActions) {
      if (this.parseInt(choice) === idx++) {
        this.emit("quick-action", { id: qa.id })
        this.pause()
        return
      }
    }

    // Recent threads
    for (const t of this.recentThreads) {
      if (this.parseInt(choice) === idx++) {
        this.emit("recent-thread", { id: t.id })
        this.pause()
        return
      }
    }

    // Fixed tail
    if (this.parseInt(choice) === idx++) { this.emit("logs"); this.pause(); return }
    if (this.parseInt(choice) === idx++) { this.emit("chrome"); this.pause(); return }
    if (this.parseInt(choice) === idx++) { this.emit("show-pairing"); this.pause(); return }
    if (this.parseInt(choice) === idx || choice === "q" || choice === "quit") {
      this.emit("quit")
      return
    }

    console.log("\n无效选择，请重新输入")
    this.pause()
  }

  private parseInt(s: string): number {
    return Number.parseInt(s, 10)
  }

  private pause(): void {
    console.log("")
    process.stdout.write("按 Enter 继续...")
    if (this.rl) {
      this.rl.once("line", () => this.printMenu())
    }
  }
}
