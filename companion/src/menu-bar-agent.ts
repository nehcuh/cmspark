// Menu Bar Agent — Native system tray for CMspark Companion (cross-platform)
//
// Uses systray2 for persistent tray icon with right-click menu.
// On macOS Apple Silicon (darwin-arm64), falls back to a native Swift NSStatusBar
// binary (cmspark-tray) compiled from Tray.swift, since systray2's precompiled
// Go binary does not include a darwin-arm64 build.
//
// Features:
//   - Persistent tray icon (🟢 running / 🔴 stopped / 🟡 connecting)
//   - Right-click menu: start/stop/status/logs/chrome/auto-start/quit
//   - WebSocket polling every 3s
//   - Status change notifications via node-notifier

import * as readline from "readline"
import * as child_process from "child_process"
import * as path from "path"
import * as fs from "fs"
import WebSocket from "ws"

// Lazy-loaded systray2 — only imported when actually needed (non-Apple-Silicon fallback)
let SysTray: any = null
const SYSTRAY_SEPARATOR = { title: "---" }

async function loadSysTrayModule(): Promise<any> {
  if (SysTray) return SysTray
  const mod = await import("systray2")
  SysTray = mod.default
  return SysTray
}

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

/** Safe wrapper around node-notifier that swallows errors on Apple Silicon without Rosetta 2 */
function safeNotify(options: {
  title?: string
  message?: string
  sound?: boolean | string
  timeout?: number
}): void {
  try {
    notifier.notify(options)
  } catch {
    // node-notifier depends on terminal-notifier which is x86_64-only on macOS.
    // On Apple Silicon without Rosetta 2 it throws -86 (architecture mismatch).
  }
}

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
let systrayInstance: any = null
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
  try {
    if (status === "running") {
      safeNotify({ title: "CMspark Agent", message: "Companion 守护进程已启动", sound: false, timeout: 3 })
    } else {
      safeNotify({ title: "CMspark Agent", message: "Companion 守护进程已停止", sound: false, timeout: 3 })
    }
  } catch {
    // node-notifier may fail on Apple Silicon without Rosetta 2
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
      SYSTRAY_SEPARATOR,
      { title: "查看状态", tooltip: "查看 Companion 详细状态", checked: false, enabled: true },
      { title: "打开日志目录", tooltip: "打开日志文件夹", checked: false, enabled: true },
      { title: "打开 Chrome Side Panel", tooltip: "打开 Chrome 扩展", checked: false, enabled: true },
      SYSTRAY_SEPARATOR,
      { title: `开机自启: ${autoStartEnabled ? "开" : "关"}`, tooltip: "切换开机自启", checked: autoStartEnabled, enabled: true },
      SYSTRAY_SEPARATOR,
      { title: "退出", tooltip: "退出托盘代理", checked: false, enabled: true },
    ],
  }
}

async function updateTrayState(): Promise<void> {
  if (systrayInstance) {
    const autoStart = await checkAutoStart()
    const menu = buildMenu(state.companionStatus, autoStart)

    await systrayInstance.sendAction({ type: "update-menu", menu })
  }

  if (swiftTrayProcess) {
    sendSwiftTrayUpdate()
    const autoStart = await checkAutoStart()
    sendSwiftTrayAutoStart(autoStart)
  }
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
    safeNotify({ title: "CMspark Agent", message: `启动失败: ${err.message}`, timeout: 5 })
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
    safeNotify({ title: "CMspark Agent", message: `停止失败: ${err.message}`, timeout: 5 })
  }
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

    safeNotify({
      title: "CMspark Agent - 状态",
      message: lines.join("\n"),
      timeout: 5,
    })
  } catch {
    // node-notifier may fail on Apple Silicon without Rosetta 2
    console.log(`Companion: ${state.companionStatus === "running" ? "运行中" : "已停止"}`)
  }
}

function getLogDir(): string {
  return path.join(getConfigDir(), "logs")
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
    openLogDirectory(getLogDir())
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `打开日志目录失败: ${err.message}`, timeout: 5 })
  }
}

// ---------------------------------------------------------------------------
// Tray setup
// ---------------------------------------------------------------------------

async function setupTray(): Promise<any> {
  const Tray = await loadSysTrayModule()
  if (!Tray) {
    throw new Error("systray2 module not installed")
  }

  const autoStart = await checkAutoStart()
  const menu = buildMenu(state.companionStatus, autoStart)

  const systray = new Tray({
    menu,
    debug: !!process.env.CMSPARK_DEBUG,
    copyDir: true,
  })

  // Wait for init() to complete (_rl and _process are created) before
  // registering any listeners.  systray2's init() is async; _rl is null
  // until the Go binary is spawned and the readline interface is set up.
  await systray.ready()
  console.log("[tray] System tray ready")

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

  return systray
}

// ---------------------------------------------------------------------------
// Swift Tray (macOS Apple Silicon native fallback)
// ---------------------------------------------------------------------------

/** Expected SHA256 of the Swift tray binary (update via build-tray.sh) */
const SWIFT_TRAY_SHA256 = "a296e96758d604abc18e40d9251691f2f7de9beb2a5b000f9f8dfde59eddc5c5"

/** Verify Swift tray binary integrity */
function verifySwiftTrayIntegrity(binPath: string): boolean {
  try {
    const hash = require("crypto")
      .createHash("sha256")
      .update(fs.readFileSync(binPath))
      .digest("hex")
    return hash === SWIFT_TRAY_SHA256
  } catch {
    return false
  }
}

/** Path to the compiled Swift tray binary */
function getSwiftTrayPath(): string {
  return path.join(__dirname, "..", "dist", "cmspark-tray")
}

/** Check if the Swift tray binary exists and passes integrity check */
function isSwiftTrayAvailable(): boolean {
  const binPath = getSwiftTrayPath()
  if (!fs.existsSync(binPath)) return false
  if (!verifySwiftTrayIntegrity(binPath)) {
    console.warn("[tray] Swift tray binary hash mismatch — possible tampering")
    return false
  }
  return true
}

/** Check if we should prefer Swift tray over systray2 */
function shouldUseSwiftTray(): boolean {
  return process.platform === "darwin" && process.arch === "arm64"
}

let swiftTrayProcess: child_process.ChildProcess | null = null
let swiftTrayReader: readline.Interface | null = null

interface SwiftTrayEvent {
  type: "ready" | "click" | "exit"
  action?: string
  code?: number
}

async function setupSwiftTray(): Promise<void> {
  const binPath = getSwiftTrayPath()

  if (!fs.existsSync(binPath)) {
    throw new Error(`Swift tray binary not found: ${binPath}. Run: ./src/tray/build-tray.sh`)
  }

  const proc = child_process.spawn(binPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
  })

  swiftTrayProcess = proc

  return new Promise((resolve, reject) => {
    let ready = false

    swiftTrayReader = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    })

    swiftTrayReader.on("line", async (line) => {
      let event: SwiftTrayEvent
      try {
        event = JSON.parse(line) as SwiftTrayEvent
      } catch {
        // Ignore non-JSON lines
        return
      }

      if (event.type === "ready") {
        if (!ready) {
          ready = true
          console.log("[tray] Swift tray ready")
          resolve()
        }
        return
      }

      if (event.type === "click" && event.action) {
        await handleSwiftTrayAction(event.action)
      }

      if (event.type === "exit") {
        cleanup()
        process.exit(0)
      }
    })

    proc.stderr?.on("data", (data) => {
      const msg = data.toString().trim()
      if (msg) {
        console.error("[tray] Swift stderr:", msg)
      }
    })

    proc.on("error", (err) => {
      if (!ready) {
        reject(err)
      } else {
        console.error("[tray] Swift process error:", err)
      }
    })

    proc.on("exit", (code) => {
      if (!ready) {
        reject(new Error(`Swift tray exited prematurely (code: ${code})`))
      } else {
        console.log(`[tray] Swift tray exited (code: ${code})`)
        cleanup()
        process.exit(0)
      }
    })

    // Send initial state
    sendSwiftTrayUpdate()
  })
}

async function handleSwiftTrayAction(action: string): Promise<void> {
  switch (action) {
    case "start":
      await startCompanion()
      break
    case "stop":
      await stopCompanion()
      break
    case "status":
      showStatusNotification()
      break
    case "logs":
      openLogsDir()
      break
    case "chrome":
      openChromeSidePanel()
      break
    case "autostart":
      await toggleAutoStart()
      break
    case "quit":
      stopMenuBarAgent()
      break
  }
}

function sendSwiftTrayUpdate(): void {
  if (!swiftTrayProcess?.stdin?.writable) return

  const cmd = JSON.stringify({ cmd: "update", status: state.companionStatus })
  swiftTrayProcess.stdin.write(`${cmd}\n`)
}

function sendSwiftTrayAutoStart(enabled: boolean): void {
  if (!swiftTrayProcess?.stdin?.writable) return

  const cmd = JSON.stringify({ cmd: "update-autostart", enabled })
  swiftTrayProcess.stdin.write(`${cmd}\n`)
}

function killSwiftTray(): void {
  // Capture reference and null the global immediately to prevent double-cleanup
  const proc = swiftTrayProcess
  swiftTrayProcess = null

  if (swiftTrayReader) {
    swiftTrayReader.close()
    swiftTrayReader = null
  }

  if (!proc) return

  // Graceful shutdown via protocol
  if (proc.stdin?.writable) {
    try {
      proc.stdin.write(`${JSON.stringify({ cmd: "quit" })}\n`)
    } catch {
      // ignore
    }
  }

  if (!proc.killed) {
    proc.kill("SIGTERM")
    // Force kill after 2 seconds if still running
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL")
      }
    }, 2000)
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

  killSwiftTray()

  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.unlinkSync(STATUS_FILE)
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Fallback: readline CLI (when systray2 is unavailable, e.g. no Rosetta on Apple Silicon)
// ---------------------------------------------------------------------------

let rl: readline.Interface | null = null

function printMenu() {
  const icon = state.companionStatus === "running" ? "🟢" : "🔴"
  const status = state.companionStatus === "running"
    ? `运行中 (pid: ${state.pid}, WS: 已连接)`
    : "已停止"

  console.clear()
  console.log("CMspark Agent Menu")
  console.log("==================")
  console.log("")
  console.log(`${icon} Companion ${status}`)
  console.log(`   最后检测: ${state.lastCheckedAt}`)
  console.log("")
  console.log("[1] 启动 Companion")
  console.log("[2] 停止 Companion")
  console.log("[3] 查看状态")
  console.log("[4] 打开日志目录")
  console.log("[5] 打开 Chrome Side Panel")
  console.log("[6] 退出")
  console.log("")
  process.stdout.write("请选择操作: ")
}

function pauseAndContinue(): void {
  console.log("")
  process.stdout.write("按 Enter 继续...")
  if (rl) {
    rl.once("line", () => {
      printMenu()
    })
  }
}

function startReadlineAgent(): void {
  if (rl) {
    console.log("菜单栏代理已在运行")
    return
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  printMenu()

  rl.on("line", async (input) => {
    const choice = input.trim()
    switch (choice) {
      case "1":
        await startCompanion()
        pauseAndContinue()
        break
      case "2":
        await stopCompanion()
        pauseAndContinue()
        break
      case "3":
        showStatusNotification()
        pauseAndContinue()
        break
      case "4":
        openLogsDir()
        pauseAndContinue()
        break
      case "5":
        openChromeSidePanel()
        pauseAndContinue()
        break
      case "6":
      case "q":
      case "quit":
        stopMenuBarAgent()
        break
      default:
        console.log("\n无效选择，请重新输入")
        pauseAndContinue()
    }
  })

  rl.on("close", () => {
    stopMenuBarAgent()
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startMenuBarAgent(): Promise<void> {
  if (systrayInstance || swiftTrayProcess || rl) {
    console.log("菜单栏代理已在运行")
    return
  }

  // Initial status poll
  await pollCompanionStatus()
  lastNotifiedStatus = state.companionStatus

  // Strategy:
  // 1. On Apple Silicon macOS with Swift binary available → use native Swift tray
  // 2. Otherwise try systray2
  // 3. Fall back to readline CLI on failure
  let trayStarted = false

  if (shouldUseSwiftTray() && isSwiftTrayAvailable()) {
    try {
      await setupSwiftTray()
      console.log("[tray] CMspark Agent Swift tray started")
      trayStarted = true
    } catch (err: any) {
      console.warn(`[tray] Swift tray failed: ${err.message}`)
      console.warn("[tray] Falling back to systray2...")
    }
  }

  if (!trayStarted) {
    try {
      systrayInstance = await setupTray()
      console.log("[tray] CMspark Agent system tray started")
      trayStarted = true
    } catch (err: any) {
      console.warn(`[tray] System tray unavailable: ${err.message}`)
      console.warn("[tray] Falling back to readline CLI menu.")
      if (process.platform === "darwin" && process.arch === "arm64") {
        console.warn("[tray] Tip: Build the Swift tray binary:")
        console.warn("       cd companion && ./src/tray/build-tray.sh")
        console.warn("[tray] Or install Rosetta 2 to use systray2:")
        console.warn("       softwareupdate --install-rosetta --agree-to-license")
      }
      startReadlineAgent()
    }
  }

  // Start polling loop
  pollTimer = setInterval(() => {
    pollCompanionStatus().catch((err) => {
      if (process.env.CMSPARK_DEBUG) {
        console.warn("[menu-bar] Poll error:", err)
      }
    })
  }, POLL_INTERVAL_MS)
}

export function stopMenuBarAgent(): void {
  if (systrayInstance) {
    systrayInstance.kill().catch(() => { /* ignore */ })
    systrayInstance = null
  }
  if (swiftTrayProcess) {
    killSwiftTray()
  }
  if (rl) {
    rl.close()
    rl = null
  }
  cleanup()
  console.log("[tray] CMspark Agent menu bar stopped")
}
