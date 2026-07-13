// Menu Bar Agent — Unified tray orchestrator for CMspark Companion
//
// Owns: state management, status detection, action handlers, polling loop.
// Delegates: tray UI to UnifiedTray backend (Swift / systray2 / readline).

import * as child_process from "child_process"
import * as net from "net"
import * as path from "path"
import * as fs from "fs"

import { isProcessRunning, readPidFile } from "./daemon"
import { getConfigDir, getPidFilePath } from "./config"
import { getChromeOpener, openLogDirectory, getPlatform } from "./platform"
import {
  createTray,
  detectTrayBackend,
  TrayConfig,
  TrayBackend,
  UnifiedTray,
  TrayMenuAction,
  QuickActionItem,
  RecentThreadItem,
} from "./tray/tray-adapter"
import { CompanionClient } from "./tray/companion-client"
import { readPairingSecret, hasPaired, resolveClipboardCommand } from "./tray/pairing"

// node-notifier does not ship TypeScript declarations
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifier = require("node-notifier") as {
  notify(options: { title?: string; message?: string; sound?: boolean | string; timeout?: number }): void
}

function safeNotify(options: { title?: string; message?: string; sound?: boolean | string; timeout?: number }): void {
  // Debug log to file (stdout is swallowed in SEA mode)
  try {
    const logPath = path.join(getConfigDir(), "tray-debug.log")
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] safeNotify called: ${options.title} - ${options.message}\n`)
  } catch { /* ignore */ }

  if (process.platform === "darwin") {
    try {
      const title = (options.title || "CMspark Agent").replace(/"/g, '\\"')
      const msg = (options.message || "").replace(/"/g, '\\"')
      child_process.execSync(`osascript -e 'display notification "${msg}" with title "${title}"'`, { stdio: "ignore" })
    } catch { /* ignore */ }
    return
  }
  if (process.platform === "win32") {
    try {
      const title = (options.title || "CMspark Agent").replace(/'/g, "''")
      const msg = (options.message || "").replace(/'/g, "''")
      // Blocking execSync: the MessageBox will stay on screen until the user clicks OK.
      // This is intentional — we want the user to see the notification.
      child_process.execSync(
        `powershell.exe -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${msg}', '${title}')"`,
        { stdio: "inherit", windowsHide: false, timeout: 60000 }
      )
    } catch {
      try { notifier.notify(options) } catch { /* ignore */ }
    }
    return
  }
  try { notifier.notify(options) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_PORT = 23401
const WS_HOST = "127.0.0.1"
const POLL_INTERVAL_MS = 10000
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
let activeBackend: TrayBackend | null = null
let companionClient: CompanionClient | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastNotifiedStatus: CompanionStatus | null = null
// Auto-surface the pairing popup at most once per launcher session — only while the
// extension has never paired (companion writes ~/.cmspark-agent/.paired on first auth).
let autoShowedPairing = false

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

/** Lightweight TCP port check — no WS handshake overhead */
function checkPortReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 2000)
    socket.connect(WS_PORT, WS_HOST, () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(false)
    })
  })
}

async function pollCompanionStatus(): Promise<void> {
  const pid = getCompanionPid()
  const processRunning = isCompanionProcessRunning()

  // Fast path: if our persistent client is connected, server is alive — skip port check
  let wsReachable: boolean
  if (companionClient?.connectionState === "connected") {
    wsReachable = true
  } else {
    wsReachable = await checkPortReachable()
  }

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

  // Detect zombie connection: companion process is dead but client still thinks it's connected
  if (newStatus === "stopped" && companionClient?.connectionState === "connected") {
    console.warn("[menu-bar] Zombie connection detected — companion is dead but client thinks it's connected. Forcing reconnect.")
    companionClient.disconnect()
  }

  if (changed) {
    if (lastNotifiedStatus !== null) {
      notifyStatusChange(newStatus)
    }
  }
  lastNotifiedStatus = newStatus

  // First-run pairing aid: while the extension has never paired and a secret now
  // exists, auto-surface the pairing popup once per session. Swift-only so we never
  // silently clobber the clipboard on systray2/readline (those backends surface the
  // code only on an explicit menu click). activeBackend is null during the pre-tray
  // initial poll, which also guards against firing before the tray is up.
  if (!autoShowedPairing && activeBackend === "swift" && !hasPaired(getConfigDir()) && readPairingSecret(getConfigDir())) {
    autoShowedPairing = true
    showPairingCode()
  }
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
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.cmspark.companion.plist`
      if (currentlyEnabled) {
        child_process.execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`)
        if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath)
        safeNotify({ title: "CMspark Agent", message: "开机自启已关闭 ⏹️", timeout: 3 })
      } else {
        const daemonPath = process.argv[1]
        const configDir = getConfigDir()
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cmspark.companion</string>
  <key>ProgramArguments</key>
  <array>
    <string>${daemonPath}</string>
    <string>daemon</string>
    <string>--daemonize</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${configDir}/logs/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${configDir}/logs/launchd-stderr.log</string>
</dict>
</plist>`
        fs.mkdirSync(path.dirname(plistPath), { recursive: true })
        fs.writeFileSync(plistPath, plistContent, { mode: 0o644 })
        child_process.execSync(`launchctl load "${plistPath}"`)
        safeNotify({ title: "CMspark Agent", message: "开机自启已开启 ✅", timeout: 3 })
      }
    } else if (platform === "linux") {
      if (currentlyEnabled) {
        child_process.execSync("systemctl --user disable cmspark-companion")
        safeNotify({ title: "CMspark Agent", message: "开机自启已关闭 ⏹️", timeout: 3 })
      } else {
        child_process.execSync("systemctl --user enable cmspark-companion")
        safeNotify({ title: "CMspark Agent", message: "开机自启已开启 ✅", timeout: 3 })
      }
    } else if (platform === "win32") {
      const nodePath = process.execPath
      const scriptPath = process.argv[1]
      if (currentlyEnabled) {
        child_process.execSync('schtasks /delete /tn "cmspark-companion" /f', { shell: "cmd.exe" })
        safeNotify({ title: "CMspark Agent", message: "开机自启已关闭", timeout: 3 })
      } else {
        const taskCmd = `"${nodePath}" "${scriptPath}" daemon start --daemonize`
        child_process.execSync(
          `schtasks /create /tn "cmspark-companion" /tr "${taskCmd}" /sc onlogon /rl limited /f`,
          { shell: "cmd.exe" },
        )
        safeNotify({ title: "CMspark Agent", message: "开机自启已开启", timeout: 3 })
      }
    }
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `自启切换失败 ❌: ${err.message}`, timeout: 5 })
  }

  const newEnabled = await checkAutoStart()
  if (trayInstance) trayInstance.updateAutostart(newEnabled)
}

// ---------------------------------------------------------------------------
// Pairing-code popup — surfaces the WS shared secret so users pair the Chrome
// extension without ever touching the command line. Swift backend shows a native
// selectable window; systray2/readline fall back to clipboard-copy + notification.
// The secret is pushed only over the Swift stdin pipe — it is NEVER logged.
// ---------------------------------------------------------------------------

const PAIRING_TARGET_LABEL = "Chrome 扩展 → 设置 → 连接 →「WS 配对密钥」"

function commandAvailable(cmd: string): boolean {
  try {
    const r = child_process.spawnSync("which", [cmd], { stdio: "ignore", timeout: 1500 })
    return r.status === 0
  } catch {
    return false
  }
}

/** Copy text to the system clipboard. Returns false if no clipboard tool is available. */
function copyToClipboard(text: string): boolean {
  const resolved = resolveClipboardCommand(process.platform, {
    xclip: commandAvailable("xclip"),
    xsel: commandAvailable("xsel"),
  })
  if (!resolved) return false
  try {
    const child = child_process.spawnSync(resolved.cmd, resolved.args, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 3000,
      windowsHide: true,
    })
    return child.status === 0
  } catch {
    return false
  }
}

/** Show the pairing code: native window (Swift) or clipboard+notify (other backends). */
function showPairingCode(): void {
  const secret = readPairingSecret(getConfigDir())
  console.log("[pairing] showPairingCode called, secret length:", secret.length, "backend:", activeBackend)
  if (!secret) {
    console.log("[pairing] No secret available, showing notification")
    safeNotify({
      title: "🔑 CMspark 配对码",
      message: "尚未生成配对码 — 请先启动 Companion 后再试。",
      timeout: 5,
    })
    return
  }
  if (activeBackend === "swift" && trayInstance) {
    console.log("[pairing] Using Swift native window")
    trayInstance.showPairingWindow(secret, hasPaired(getConfigDir()))
    return
  }
  // Non-Swift fallback: copy to clipboard + notify. The secret is NEVER placed in the
  // (persisted, lock-screen-visible) notification — if no clipboard tool is available
  // we guide the user to the Settings page rather than leak the key.
  console.log("[pairing] Using non-Swift fallback (clipboard + notify)")
  const copied = copyToClipboard(secret)
  console.log("[pairing] copyToClipboard result:", copied)
  safeNotify({
    title: "🔑 CMspark 配对码",
    message: copied
      ? `配对码已复制到剪贴板。请粘贴到 ${PAIRING_TARGET_LABEL} 完成配对。`
      : "未检测到剪贴板工具（请安装 xclip/xsel），无法自动复制。请通过菜单 →「设置」打开设置页查看配对码。",
    timeout: 10,
  })
  console.log("[pairing] safeNotify called")
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

async function startCompanion(): Promise<void> {
  if (state.companionStatus === "running") {
    safeNotify({ title: "CMspark Agent", message: "Companion 已在运行中 ✅", timeout: 3 })
    return
  }

  safeNotify({ title: "CMspark Agent", message: "正在启动 Companion...", timeout: 3 })
  state.companionStatus = "unknown"
  if (trayInstance) trayInstance.updateStatus("unknown", false, state.pid)

  try {
    const { getSelfSpawnArgs } = require("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "start", "--daemonize"])
    const proc = child_process.spawn(execPath, args, { detached: true, stdio: "ignore", windowsHide: true })
    proc.unref()
    // The daemonized daemon is a two-hop spawn (parent → grandchild) that still has to
    // load the bundle, acquire the UDS lock, init the data dir, and bind port 23401 —
    // easily 2-4s in the packaged .app. A single 1.5s re-poll usually lands while the
    // PID file is written but the port isn't bound yet (processRunning && !wsReachable
    // → "stopped"), so the tray flashes "已停止" until the next 10s poll. Burst-poll so
    // it flips to "运行中" as soon as the server is actually up.
    for (const delay of [1000, 2500, 4500, 7000]) {
      setTimeout(() => pollCompanionStatus().catch(() => {}), delay)
    }
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `启动失败 ❌: ${err.message}`, timeout: 5 })
  }
}

async function stopCompanion(): Promise<void> {
  if (state.companionStatus !== "running") {
    safeNotify({ title: "CMspark Agent", message: "Companion 未在运行", timeout: 3 })
    return
  }

  safeNotify({ title: "CMspark Agent", message: "正在停止 Companion...", timeout: 3 })

  try {
    const { getSelfSpawnArgs } = require("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "stop"])
    child_process.execFileSync(execPath, args, { timeout: 15000 })
    safeNotify({ title: "CMspark Agent", message: "Companion 已停止 ⏹️", timeout: 3 })
    setTimeout(() => pollCompanionStatus(), 1000)
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `停止失败 ❌: ${err.message}`, timeout: 5 })
  }
}

async function restartCompanion(): Promise<void> {
  if (state.companionStatus !== "running") {
    safeNotify({ title: "CMspark Agent", message: "Companion 未运行，正在启动...", timeout: 3 })
    await startCompanion()
    return
  }

  safeNotify({ title: "CMspark Agent", message: "正在重启 Companion...", timeout: 3 })
  await stopCompanion()
  setTimeout(() => {
    safeNotify({ title: "CMspark Agent", message: "正在启动 Companion...", timeout: 3 })
    startCompanion()
  }, 2000)
}

function showStatusNotification(): void {
  try {
    const running = state.companionStatus === "running"
    const lines = [
      `${running ? "✅" : "⏹️"} Companion: ${running ? "运行中" : "已停止"}`,
      `🔗 WS: ${state.wsConnected ? "已连接" : "未连接"} ws://${WS_HOST}:${WS_PORT}`,
      state.pid ? `📌 PID: ${state.pid}` : "",
      `📂 数据目录: ${getConfigDir()}`,
    ].filter(Boolean)

    safeNotify({ title: "📊 CMspark 状态", message: lines.join("\n"), timeout: 5 })
  } catch {
    console.log(`Companion: ${state.companionStatus === "running" ? "运行中" : "已停止"}`)
  }
}

function openChromeSidePanel(): void {
  try {
    getChromeOpener().openSidePanel()
    safeNotify({ title: "CMspark Agent", message: "Chrome 已激活，请在 Side Panel 中点击 CMspark 扩展图标 🧩", timeout: 5 })
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `打开 Chrome 失败: ${err.message}`, timeout: 5 })
  }
}

async function handleQuickAction(id: string): Promise<void> {
  if (!companionClient) {
    safeNotify({ title: "CMspark Agent", message: "Companion 未运行，无法执行操作", timeout: 3 })
    return
  }

  // Open Chrome side panel first so the user sees the result
  openChromeSidePanel()

  let result = await companionClient.executeQuickAction(id)

  // If timeout due to zombie connection, force reconnect and retry once
  if (result?.error?.includes("timeout")) {
    console.warn("[menu-bar] Quick action timeout — forcing reconnect and retry")
    companionClient.disconnect()
    await new Promise(r => setTimeout(r, 500))
    await companionClient.connect()
    await new Promise(r => setTimeout(r, 500))
    result = await companionClient.executeQuickAction(id)
  }

  if (!result || result.error) {
    safeNotify({ title: "CMspark Agent", message: `操作失败: ${result?.error || "未知错误"}`, timeout: 5 })
  }
}

function openLogsDir(): void {
  try {
    openLogDirectory(path.join(getConfigDir(), "logs"))
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `打开日志目录失败: ${err.message}`, timeout: 5 })
  }
}

async function openSettingsUI(): Promise<void> {
  try {
    const { startSettingsServer } = require("./settings-web") as typeof import("./settings-web")
    // startSettingsServer() returns { port, token } — the token is REQUIRED on every
    // request (loopback CSRF defense). Treating the return as a bare port produced a
    // malformed `http://127.0.0.1:[object Object]/settings` URL with no token, which
    // failed to open and fell through to the fallback below.
    const { port, token } = await startSettingsServer()
    const url = `http://127.0.0.1:${port}/settings?token=${token}`
    const platform = getPlatform()

    // Open detached + unref'd so a slow/hung `open` can never block this tray
    // process's event loop (which would freeze status polling).
    if (platform === "darwin") {
      child_process.spawn("open", [url], { detached: true, stdio: "ignore" }).unref()
    } else if (platform === "linux") {
      child_process.spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
    } else if (platform === "win32") {
      // Use "start" command — explorer.exe may treat the URL as a file path and open
      // File Explorer instead of the browser.
      child_process.spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", shell: true }).unref()
    }

    safeNotify({ title: "CMspark Agent", message: `Settings page opened in browser`, timeout: 3 })
  } catch (err: any) {
    // Fallback: spawn a DETACHED settings process. NEVER use execFileSync here — the
    // `settings` command is a long-running server (it awaits forever), so a synchronous
    // call blocks this tray process's event loop for its full timeout, freezing status
    // polling and leaving the tray stuck on a stale "已停止" while companion runs fine.
    try {
      const { getSelfSpawnArgs } = require("./paths")
      const { execPath, args } = getSelfSpawnArgs(["settings"])
      child_process.spawn(execPath, args, { detached: true, stdio: "ignore", windowsHide: true }).unref()
      safeNotify({ title: "CMspark Agent", message: `Settings page opened in browser`, timeout: 3 })
    } catch {
      safeNotify({ title: "CMspark Agent", message: `Failed to open settings: ${err.message}`, timeout: 5 })
    }
  }
}

// ---------------------------------------------------------------------------
// Action dispatch — routes tray clicks to handlers
// ---------------------------------------------------------------------------

async function handleAction(action: TrayMenuAction): Promise<void> {
  console.log("[menu-bar] handleAction:", action.type)
  switch (action.type) {
    case "start": await startCompanion(); break
    case "stop": await stopCompanion(); break
    case "restart": await restartCompanion(); break
    case "status": showStatusNotification(); break
    case "logs": openLogsDir(); break
    case "chrome": openChromeSidePanel(); break
    case "show-pairing": showPairingCode(); break
    case "settings":
      await openSettingsUI()
      break
    case "autostart": await toggleAutoStart(); break
    case "quick-action":
      handleQuickAction(action.payload?.id || "").catch((err) => {
        console.error("[menu-bar] Quick action error:", err)
      })
      break
    case "recent-thread":
      if (!companionClient) {
        safeNotify({ title: "CMspark Agent", message: "Companion 未运行", timeout: 3 })
      } else if (action.payload?.id) {
        companionClient.openThread(action.payload.id)
          .then(() => safeNotify({ title: "CMspark Agent", message: "已切换到对话 ✅", timeout: 3 }))
          .catch((err: any) => safeNotify({ title: "CMspark Agent", message: `切换对话失败: ${err.message}`, timeout: 5 }))
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
      activeBackend = candidate
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
