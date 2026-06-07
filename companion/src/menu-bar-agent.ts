// Menu Bar Agent — Native system tray for CMspark Companion (cross-platform)
//
// Uses systray2 for persistent tray icon with right-click menu.
//
// Features:
//   - Persistent tray icon (🟢 running / 🔴 stopped / 🟡 connecting)
//   - Right-click menu: start/stop/status/logs/chrome/auto-start/quit
//   - WebSocket polling every 3s
//   - Status change notifications via node-notifier

import * as child_process from "child_process"
import * as path from "path"
import * as fs from "fs"
import WebSocket from "ws"
import SysTray from "systray2"

// node-notifier does not ship TypeScript declarations; use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifier = require("node-notifier") as {
  notify(options: {
    title?: string
    message?: string
    sound?: boolean | string
    timeout?: number
  }): void
}

import { isProcessRunning, readPidFile } from "./daemon"
import { getConfigDir, getPidFilePath } from "./config"
import { getChromeOpener, openLogDirectory, getPlatform, isMacOS } from "./platform"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_PORT = 23401
const WS_HOST = "127.0.0.1"
const POLL_INTERVAL_MS = 3000
const STATUS_FILE = path.join(getConfigDir(), ".menu-bar-status.json")

// ---------------------------------------------------------------------------
// Icon loading (base64 PNG for systray2)
// ---------------------------------------------------------------------------

function loadIconBase64(name: string): string {
  const iconPath = path.join(__dirname, "..", "assets", name)
  return fs.readFileSync(iconPath).toString("base64")
}

const ICON_GREEN = loadIconBase64("tray-icon-green.png")
const ICON_RED = loadIconBase64("tray-icon-red.png")
const ICON_YELLOW = loadIconBase64("tray-icon-yellow.png")
const ICON_TEMPLATE = loadIconBase64("tray-icon-template.png")

/** Select icon based on platform and status */
function getTrayIcon(status: CompanionStatus): string {
  if (isMacOS()) {
    // macOS template icon is black; system tints it for dark/light mode
    return ICON_TEMPLATE
  }
  switch (status) {
    case "running": return ICON_GREEN
    case "stopped": return ICON_RED
    default: return ICON_YELLOW
  }
}

/** Tooltip text reflecting current status */
function getTrayTooltip(status: CompanionStatus): string {
  switch (status) {
    case "running": return "CMspark Agent - 运行中"
    case "stopped": return "CMspark Agent - 已停止"
    default: return "CMspark Agent - 检测中..."
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type CompanionStatus = "unknown" | "running" | "stopped"

interface MenuBarState {
  companionStatus: CompanionStatus
  lastCheckedAt: string
  wsConnected: boolean
  pid: number | null
}

let state: MenuBarState = {
  companionStatus: "unknown",
  lastCheckedAt: new Date().toISOString(),
  wsConnected: false,
  pid: null,
}

let pollTimer: NodeJS.Timeout | null = null
let systrayInstance: SysTray | null = null
let lastNotifiedStatus: CompanionStatus | null = null

// Menu item indices (must match the order in buildMenu())
const IDX_START = 0
const IDX_STOP = 1
const IDX_SEP1 = 2
const IDX_STATUS = 3
const IDX_LOGS = 4
const IDX_CHROME = 5
const IDX_SEP2 = 6
const IDX_AUTOSTART = 7
const IDX_SEP3 = 8
const IDX_QUIT = 9

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

function getCompanionPid(): number | null {
  return readPidFile(getPidFilePath())
}

function isCompanionProcessRunning(): boolean {
  const pid = getCompanionPid()
  if (!pid) return false
  return isProcessRunning(pid)
}

function checkWsConnectivity(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${WS_HOST}:${WS_PORT}`, {
      handshakeTimeout: 2000,
    })
    let settled = false

    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      try { ws.terminate() } catch { /* ignore */ }
      resolve(result)
    }

    ws.on("open", () => settle(true))
    ws.on("error", () => settle(false))
    ws.on("close", () => settle(false))
    setTimeout(() => settle(false), 2500)
  })
}

async function pollCompanionStatus(): Promise<void> {
  const pid = getCompanionPid()
  const processRunning = isCompanionProcessRunning()
  const wsReachable = await checkWsConnectivity()

  const newStatus: CompanionStatus = processRunning && wsReachable ? "running" : "stopped"
  const changed = state.companionStatus !== newStatus

  state = {
    companionStatus: newStatus,
    lastCheckedAt: new Date().toISOString(),
    wsConnected: wsReachable,
    pid: pid,
  }

  writeStatusFile()

  if (changed) {
    updateTrayState()
    if (lastNotifiedStatus !== null) {
      notifyStatusChange(newStatus)
    }
  }
  lastNotifiedStatus = newStatus
}

function writeStatusFile(): void {
  try {
    const tmp = `${STATUS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, STATUS_FILE)
  } catch (err: any) {
    if (process.env.CMSPARK_DEBUG) {
      console.warn("[menu-bar] Failed to write status file:", err.message)
    }
  }
}

function notifyStatusChange(status: CompanionStatus): void {
  if (status === "running") {
    notifier.notify({ title: "CMspark Agent", message: "Companion 守护进程已启动", sound: false, timeout: 3 })
  } else {
    notifier.notify({ title: "CMspark Agent", message: "Companion 守护进程已停止", sound: false, timeout: 3 })
  }
}

// ---------------------------------------------------------------------------
// Tray state updates
// ---------------------------------------------------------------------------

function buildMenu(status: CompanionStatus, autoStartEnabled: boolean) {
  const running = status === "running"
  const icon = getTrayIcon(status)
  const tooltip = getTrayTooltip(status)

  return {
    icon,
    title: tooltip,
    tooltip,
    isTemplateIcon: isMacOS(),
    items: [
      { title: "启动 Companion", tooltip: "启动 Companion 守护进程", checked: false, enabled: !running },
      { title: "停止 Companion", tooltip: "停止 Companion 守护进程", checked: false, enabled: running },
      SysTray.separator,
      { title: "查看状态", tooltip: "查看 Companion 详细状态", checked: false, enabled: true },
      { title: "打开日志目录", tooltip: "打开日志文件夹", checked: false, enabled: true },
      { title: "打开 Chrome Side Panel", tooltip: "打开 Chrome 扩展", checked: false, enabled: true },
      SysTray.separator,
      { title: `开机自启: ${autoStartEnabled ? "开" : "关"}`, tooltip: "切换开机自启", checked: autoStartEnabled, enabled: true },
      SysTray.separator,
      { title: "退出", tooltip: "退出托盘代理", checked: false, enabled: true },
    ],
  }
}

async function updateTrayState(): Promise<void> {
  if (!systrayInstance) return

  const autoStart = await checkAutoStart()
  const menu = buildMenu(state.companionStatus, autoStart)

  await systrayInstance.sendAction({ type: "update-menu", menu })
}

async function updateMenuItemEnabled(index: number, enabled: boolean): Promise<void> {
  if (!systrayInstance) return
  const autoStart = await checkAutoStart()
  const menu = buildMenu(state.companionStatus, autoStart)
  const item = menu.items[index]
  if (item) {
    item.enabled = enabled
    await systrayInstance.sendAction({ type: "update-item", item, seq_id: index })
  }
}

// ---------------------------------------------------------------------------
// Auto-start detection
// ---------------------------------------------------------------------------

async function checkAutoStart(): Promise<boolean> {
  const platform = getPlatform()
  try {
    if (platform === "darwin") {
      const plist = `${process.env.HOME}/Library/LaunchAgents/com.cmspark.companion.plist`
      return fs.existsSync(plist)
    }
    if (platform === "linux") {
      const result = child_process.execSync("systemctl --user is-enabled cmspark-companion 2>/dev/null || echo disabled", { encoding: "utf-8" })
      return result.trim() === "enabled"
    }
    if (platform === "win32") {
      const result = child_process.execSync("schtasks /query /tn cmspark-companion 2>nul && echo yes || echo no", { encoding: "utf-8", shell: "cmd.exe" })
      return result.trim().includes("yes")
    }
  } catch {
    // ignore
  }
  return false
}

async function toggleAutoStart(): Promise<void> {
  const platform = getPlatform()
  const currentlyEnabled = await checkAutoStart()

  try {
    if (platform === "darwin") {
      const plist = `${process.env.HOME}/Library/LaunchAgents/com.cmspark.companion.plist`
      if (currentlyEnabled) {
        child_process.execSync(`launchctl unload "${plist}" 2>/dev/null || true`)
        fs.unlinkSync(plist)
      } else {
        // Would need install script path; guide user
        notifier.notify({ title: "CMspark Agent", message: "请运行 make install-macos 开启开机自启", timeout: 5 })
      }
    } else if (platform === "linux") {
      if (currentlyEnabled) {
        child_process.execSync("systemctl --user disable cmspark-companion")
      } else {
        child_process.execSync("systemctl --user enable cmspark-companion")
      }
    } else if (platform === "win32") {
      notifier.notify({ title: "CMspark Agent", message: "请运行 make install-windows 开启开机自启", timeout: 5 })
    }
  } catch (err: any) {
    notifier.notify({ title: "CMspark Agent", message: `自启切换失败: ${err.message}`, timeout: 5 })
  }

  await updateTrayState()
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

async function startCompanion(): Promise<void> {
  if (state.companionStatus === "running") return

  // Immediately set to connecting state for visual feedback
  state.companionStatus = "unknown"
  await updateTrayState()

  try {
    const proc = child_process.spawn(
      process.execPath,
      [path.join(__dirname, "index.js"), "daemon", "start", "--daemonize"],
      { detached: true, stdio: "ignore" },
    )
    proc.unref()
  } catch (err: any) {
    notifier.notify({ title: "CMspark Agent", message: `启动失败: ${err.message}`, timeout: 5 })
  }
}

async function stopCompanion(): Promise<void> {
  if (state.companionStatus !== "running") return

  try {
    child_process.execSync(
      `"${process.execPath}" "${path.join(__dirname, "index.js")}" daemon stop`,
      { timeout: 15000 },
    )
  } catch (err: any) {
    notifier.notify({ title: "CMspark Agent", message: `停止失败: ${err.message}`, timeout: 5 })
  }
}

function showStatusNotification(): void {
  const running = state.companionStatus === "running"
  const lines = [
    `Companion: ${running ? "运行中" : "已停止"}`,
    `WS 连接: ${state.wsConnected ? "已连接" : "未连接"}`,
    state.pid ? `PID: ${state.pid}` : "",
    `WebSocket: ws://${WS_HOST}:${WS_PORT}`,
    `数据目录: ${getConfigDir()}`,
  ].filter(Boolean)

  notifier.notify({
    title: "CMspark Agent - 状态",
    message: lines.join("\n"),
    timeout: 5,
  })
}

function getLogDir(): string {
  return path.join(getConfigDir(), "logs")
}

function openChromeSidePanel(): void {
  try {
    getChromeOpener().openSidePanel()
  } catch (err: any) {
    notifier.notify({ title: "CMspark Agent", message: `打开 Chrome 失败: ${err.message}`, timeout: 5 })
  }
}

function openLogsDir(): void {
  try {
    openLogDirectory(getLogDir())
  } catch (err: any) {
    notifier.notify({ title: "CMspark Agent", message: `打开日志目录失败: ${err.message}`, timeout: 5 })
  }
}

// ---------------------------------------------------------------------------
// Tray setup
// ---------------------------------------------------------------------------

async function setupTray(): Promise<SysTray> {
  const autoStart = await checkAutoStart()
  const menu = buildMenu(state.companionStatus, autoStart)

  const systray = new SysTray({
    menu,
    debug: !!process.env.CMSPARK_DEBUG,
    copyDir: true,
  })

  systray.onReady(() => {
    console.log("[tray] System tray ready")
  })

  systray.onClick(async (action) => {
    switch (action.seq_id) {
      case IDX_START:
        await startCompanion()
        break
      case IDX_STOP:
        await stopCompanion()
        break
      case IDX_STATUS:
        showStatusNotification()
        break
      case IDX_LOGS:
        openLogsDir()
        break
      case IDX_CHROME:
        openChromeSidePanel()
        break
      case IDX_AUTOSTART:
        await toggleAutoStart()
        break
      case IDX_QUIT:
        await systray.kill()
        break
    }
  })

  systray.onExit((code, signal) => {
    console.log(`[tray] Exited (code: ${code}, signal: ${signal})`)
    cleanup()
    process.exit(0)
  })

  systray.onError((err) => {
    console.error("[tray] Error:", err)
  })

  await systray.ready()
  return systray
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE)
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startMenuBarAgent(): Promise<void> {
  if (systrayInstance) {
    console.log("系统托盘代理已在运行")
    return
  }

  // Initial status poll
  await pollCompanionStatus()
  lastNotifiedStatus = state.companionStatus

  // Setup tray
  systrayInstance = await setupTray()

  // Start polling loop
  pollTimer = setInterval(() => {
    pollCompanionStatus().catch((err) => {
      if (process.env.CMSPARK_DEBUG) {
        console.warn("[menu-bar] Poll error:", err)
      }
    })
  }, POLL_INTERVAL_MS)

  console.log("[tray] CMspark Agent system tray started")
}

export function stopMenuBarAgent(): void {
  if (systrayInstance) {
    systrayInstance.kill().catch(() => { /* ignore */ })
    systrayInstance = null
  }
  cleanup()
  console.log("[tray] CMspark Agent system tray stopped")
}
