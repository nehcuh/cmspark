// Menu Bar Agent — Unified tray orchestrator for CMspark Companion
//
// Owns: state management, status detection, action handlers, polling loop.
// Delegates: tray UI to UnifiedTray backend (Swift / systray2 / readline).

import * as child_process from "child_process"
import * as path from "path"
import * as fs from "fs"
import WebSocket from "ws"

import { isProcessRunning, readPidFile } from "./daemon"
import { getConfigDir, getPidFilePath } from "./config"
import { getChromeOpener, openLogDirectory, getPlatform } from "./platform"
import {
  createTray,
  detectTrayBackend,
  TrayConfig,
  UnifiedTray,
  TrayMenuAction,
  QuickActionItem,
  RecentThreadItem,
} from "./tray/tray-adapter"
import { CompanionClient } from "./tray/companion-client"

// node-notifier does not ship TypeScript declarations
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifier = require("node-notifier") as {
  notify(options: { title?: string; message?: string; sound?: boolean | string; timeout?: number }): void
}

function safeNotify(options: { title?: string; message?: string; sound?: boolean | string; timeout?: number }): void {
  try { notifier.notify(options) } catch { /* Apple Silicon without Rosetta */ }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_PORT = 23401
const WS_HOST = "127.0.0.1"
const POLL_INTERVAL_MS = 3000
const STATUS_FILE = path.join(getConfigDir(), ".menu-bar-status.json")

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

let trayInstance: UnifiedTray | null = null
let companionClient: CompanionClient | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastNotifiedStatus: CompanionStatus | null = null

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
    const ws = new WebSocket(`ws://${WS_HOST}:${WS_PORT}`, { handshakeTimeout: 2000 })
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

  // Push to tray backend
  if (trayInstance) {
    trayInstance.updateStatus(newStatus, wsReachable, pid)
  }

  if (changed) {
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
  try {
    if (status === "running") {
      safeNotify({ title: "CMspark Agent", message: "Companion 守护进程已启动", sound: false, timeout: 3 })
    } else {
      safeNotify({ title: "CMspark Agent", message: "Companion 守护进程已停止", sound: false, timeout: 3 })
    }
  } catch { /* ignore */ }
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
  } catch { /* ignore */ }
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
        safeNotify({ title: "CMspark Agent", message: "请运行 make install-macos 开启开机自启", timeout: 5 })
      }
    } else if (platform === "linux") {
      if (currentlyEnabled) {
        child_process.execSync("systemctl --user disable cmspark-companion")
      } else {
        child_process.execSync("systemctl --user enable cmspark-companion")
      }
    } else if (platform === "win32") {
      safeNotify({ title: "CMspark Agent", message: "请运行 make install-windows 开启开机自启", timeout: 5 })
    }
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `自启切换失败: ${err.message}`, timeout: 5 })
  }

  const newEnabled = await checkAutoStart()
  if (trayInstance) trayInstance.updateAutostart(newEnabled)
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

async function startCompanion(): Promise<void> {
  if (state.companionStatus === "running") return

  state.companionStatus = "unknown"
  if (trayInstance) trayInstance.updateStatus("unknown", false, state.pid)

  try {
    const { getSelfSpawnArgs } = require("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "start", "--daemonize"])
    const proc = child_process.spawn(execPath, args, { detached: true, stdio: "ignore" })
    proc.unref()
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `启动失败: ${err.message}`, timeout: 5 })
  }
}

async function stopCompanion(): Promise<void> {
  if (state.companionStatus !== "running") return

  try {
    const { getSelfSpawnArgs } = require("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "stop"])
    child_process.execFileSync(execPath, args, { timeout: 15000 })
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `停止失败: ${err.message}`, timeout: 5 })
  }
}

async function restartCompanion(): Promise<void> {
  if (state.companionStatus !== "running") {
    await startCompanion()
    return
  }
  await stopCompanion()
  // Small delay to let the daemon fully stop
  setTimeout(() => startCompanion(), 2000)
}

function showStatusNotification(): void {
  try {
    const running = state.companionStatus === "running"
    const lines = [
      `Companion: ${running ? "运行中" : "已停止"}`,
      `WS 连接: ${state.wsConnected ? "已连接" : "未连接"}`,
      state.pid ? `PID: ${state.pid}` : "",
      `WebSocket: ws://${WS_HOST}:${WS_PORT}`,
      `数据目录: ${getConfigDir()}`,
    ].filter(Boolean)

    safeNotify({ title: "CMspark Agent - 状态", message: lines.join("\n"), timeout: 5 })
  } catch {
    console.log(`Companion: ${state.companionStatus === "running" ? "运行中" : "已停止"}`)
  }
}

function openChromeSidePanel(): void {
  try {
    getChromeOpener().openSidePanel()
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `打开 Chrome 失败: ${err.message}`, timeout: 5 })
  }
}

function openLogsDir(): void {
  try {
    openLogDirectory(path.join(getConfigDir(), "logs"))
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `打开日志目录失败: ${err.message}`, timeout: 5 })
  }
}

// ---------------------------------------------------------------------------
// Action dispatch — routes tray clicks to handlers
// ---------------------------------------------------------------------------

async function handleAction(action: TrayMenuAction): Promise<void> {
  switch (action.type) {
    case "start": await startCompanion(); break
    case "stop": await stopCompanion(); break
    case "restart": await restartCompanion(); break
    case "status": showStatusNotification(); break
    case "logs": openLogsDir(); break
    case "chrome": openChromeSidePanel(); break
    case "settings":
      // TODO: open settings UI when implemented
      safeNotify({ title: "CMspark Agent", message: "设置功能开发中", timeout: 3 })
      break
    case "autostart": await toggleAutoStart(); break
    case "quick-action":
      if (companionClient) {
        companionClient.executeQuickAction(action.payload?.id || "").catch(() => {})
      }
      break
    case "recent-thread":
      if (companionClient && action.payload?.id) {
        companionClient.openThread(action.payload.id).catch(() => {})
      }
      break
    case "quit":
      await stopMenuBarAgent()
      process.exit(0)
      break
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (companionClient) {
    companionClient.disconnect()
    companionClient = null
  }
  try {
    if (fs.existsSync(STATUS_FILE)) fs.unlinkSync(STATUS_FILE)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startMenuBarAgent(): Promise<void> {
  if (trayInstance) {
    console.log("菜单栏代理已在运行")
    return
  }

  // Initial status poll
  await pollCompanionStatus()
  lastNotifiedStatus = state.companionStatus

  const backend = detectTrayBackend()
  console.log(`[tray] Detected backend: ${backend}`)

  // Try preferred backend, fall back through the chain
  const tryOrder: Array<"swift" | "systray2" | "readline"> = [backend]
  if (backend === "swift") tryOrder.push("systray2", "readline")
  else if (backend === "systray2") tryOrder.push("readline")

  for (const candidate of tryOrder) {
    try {
      trayInstance = await createTray(candidate)
      await trayInstance.start({
        wsPort: WS_PORT,
        wsHost: WS_HOST,
        pollIntervalMs: POLL_INTERVAL_MS,
        statusFile: STATUS_FILE,
        configDir: getConfigDir(),
      })

      // Register action callback
      trayInstance.onAction((action) => {
        handleAction(action).catch((err) => {
          console.error("[menu-bar] Action handler error:", err)
        })
      })

      // Push initial state
      trayInstance.updateStatus(state.companionStatus, state.wsConnected, state.pid)
      const autoStart = await checkAutoStart()
      trayInstance.updateAutostart(autoStart)

      console.log(`[tray] Started with ${candidate} backend`)
      break
    } catch (err: any) {
      console.warn(`[tray] ${candidate} failed: ${err.message}`)
      trayInstance = null
    }
  }

  if (!trayInstance) {
    console.error("[tray] All backends failed — cannot start tray")
    process.exit(1)
  }

  // Start companion client for live data
  companionClient = new CompanionClient({
    host: WS_HOST,
    port: WS_PORT,
    reconnectInterval: 5000,
    maxReconnectAttempts: -1,
  })

  // Push data changes to tray
  companionClient.onDataChanged(() => {
    if (!trayInstance || !companionClient) return
    trayInstance.setQuickActions(companionClient.quickActions)
    trayInstance.setRecentThreads(companionClient.recentThreads)
  })

  // Set default quick actions immediately
  trayInstance.setQuickActions(companionClient.quickActions)

  // Connect (non-blocking — data arrives via callbacks)
  companionClient.connect().catch(() => {})

  // Start polling loop
  pollTimer = setInterval(() => {
    pollCompanionStatus().catch((err) => {
      if (process.env.CMSPARK_DEBUG) {
        console.warn("[menu-bar] Poll error:", err)
      }
    })
  }, POLL_INTERVAL_MS)
}

export async function stopMenuBarAgent(): Promise<void> {
  if (trayInstance) {
    await trayInstance.stop()
    trayInstance = null
  }
  if (companionClient) {
    companionClient.disconnect()
    companionClient = null
  }
  cleanup()
  console.log("[tray] CMspark Agent menu bar stopped")
}
