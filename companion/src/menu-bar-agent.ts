// Menu Bar Agent — Unified tray orchestrator for CMspark Companion
//
// Owns: state management, status detection, action handlers, polling loop.
// Delegates: tray UI to UnifiedTray backend (Swift / systray2 / readline).

import * as child_process from "child_process"
import * as net from "net"
import * as path from "path"
import * as fs from "fs"

import { isProcessRunning, readPidFile } from "./daemon"
import { getConfig, getConfigDir, getPidFilePath, saveConfig } from "./config"
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
import { OSASCRIPT_BIN } from "./process-path"
import {
  attachChromeOnly,
  buildContinueChatCreate,
  mapChatMessageToSummonerCmd,
  mapVoiceSttToSummonerCmd,
  micPcmStartFrame,
  normalizeResumeIdleMinutes,
  resolveSummonerSttModelId,
  sendMicWavToStt,
  shouldStartNewSummonerThread,
  resolveSummonerOpenTarget,
  summonerHitsFromQuery,
  submitSummonerTalk,
  type SummonerSttModelId,
  type VoiceSttFrame,
} from "./summoner/client"
import {
  encodeSummonerError,
  encodeSummonerHotkeySet,
  encodeSummonerMcp,
  encodeSummonerSettings,
  SUMMONER_SEARCH_HINT,
  type SummonerInboundEvt,
} from "./summoner/protocol"
import { connectedMcpServerNames } from "./mcp/confirm-target"
import { hydratePlaintext } from "./summoner/hydrate"
import {
  beginOverlaySession,
  claimOverlayIfLive,
  currentOverlaySession,
  hydrateOverlayIfLive,
  invalidateOverlaySession,
  overlaySessionIsLive,
} from "./summoner/overlay-session"
import { acceptedSummonerHotkey, nextSummonerHotkeyCmd } from "./summoner/hotkey"

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
      // Absolute path: bare osascript fails with ENOTDIR when PATH is a file (packaged .app).
      child_process.execFileSync(OSASCRIPT_BIN, ["-e", `display notification "${msg}" with title "${title}"`], {
        stdio: "ignore",
      })
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

/**
 * P0a — accessor for server.ts to dispatch confirmation requests to the tray
 * (parallel channel alongside WS Side Panel). Returns null when no tray is
 * running (non-Swift backend, or tray not yet started). Server should fall
 * back to WS-only in that case. */
export function getTrayInstance(): UnifiedTray | null {
  return trayInstance
}

let activeBackend: TrayBackend | null = null
let companionClient: CompanionClient | null = null
/** Second WS: overlay chat (`surface: "summoner"`). Tray menus stay on companionClient. */
let summonerClient: CompanionClient | null = null
let summonerThreadId: string | null = null
let summonerMicSessionId: string | null = null
let summonerMicSeq = 0
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
  let processRunning = isCompanionProcessRunning()

  // Fast path: if our persistent client is connected, server is alive — skip port check
  let wsReachable: boolean
  if (companionClient?.connectionState === "connected") {
    wsReachable = true
  } else {
    wsReachable = await checkPortReachable()
  }

  // If the port is reachable but PID check failed, the PID file may be stale.
  // Trust the port check over the PID file to avoid showing "已停止" incorrectly.
  if (wsReachable && !processRunning) {
    processRunning = true
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

/** Append a line to tray-debug.log (stdout is often discarded for packaged tray). */
function trayDebugLog(message: string): void {
  try {
    const logPath = path.join(getConfigDir(), "tray-debug.log")
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* ignore */
  }
}

/** Show the pairing code: native window (Swift) + clipboard/notify always as backup. */
function showPairingCode(): void {
  const secret = readPairingSecret(getConfigDir())
  trayDebugLog(
    `showPairingCode secretLen=${secret.length} backend=${activeBackend} hasTray=${!!trayInstance}`,
  )
  console.log("[pairing] showPairingCode called, secret length:", secret.length, "backend:", activeBackend)
  if (!secret) {
    trayDebugLog("showPairingCode: no secret")
    console.log("[pairing] No secret available, showing notification")
    safeNotify({
      title: "🔑 CMspark 配对码",
      message: "尚未生成配对码 — 请先启动 Companion 后再试。",
      timeout: 5,
    })
    return
  }

  // Always copy to clipboard first so the user gets a usable secret even if the
  // native window fails to front on macOS 14+ accessory apps (or stdin is stuck).
  // Notification must NEVER include the secret itself (lock-screen visible).
  const copied = copyToClipboard(secret)
  trayDebugLog(`showPairingCode: clipboardCopied=${copied}`)

  if (activeBackend === "swift" && trayInstance) {
    console.log("[pairing] Using Swift native window (+ clipboard backup)")
    try {
      trayInstance.showPairingWindow(secret, hasPaired(getConfigDir()))
    } catch (err: any) {
      trayDebugLog(`showPairingCode: showPairingWindow threw ${err?.message || err}`)
      console.error("[pairing] showPairingWindow error:", err)
    }
    safeNotify({
      title: "🔑 CMspark 配对码",
      message: copied
        ? `配对窗口已打开；配对码也已复制到剪贴板。请粘贴到 ${PAIRING_TARGET_LABEL}。`
        : `配对窗口已打开。请粘贴到 ${PAIRING_TARGET_LABEL}（剪贴板复制失败时可在窗口中选中复制）。`,
      timeout: 8,
    })
    return
  }

  // Non-Swift fallback: clipboard + notify only.
  console.log("[pairing] Using non-Swift fallback (clipboard + notify)")
  safeNotify({
    title: "🔑 CMspark 配对码",
    message: copied
      ? `配对码已复制到剪贴板。请粘贴到 ${PAIRING_TARGET_LABEL} 完成配对。`
      : "未检测到剪贴板工具（请安装 xclip/xsel），无法自动复制。请通过菜单 →「设置」打开设置页查看配对码。",
    timeout: 10,
  })
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

/**
 * Start Companion daemon (detached).
 * @param quiet  tray auto-start path: no "already running" toast; failures still notify
 */
async function startCompanion(opts?: { quiet?: boolean }): Promise<void> {
  const quiet = opts?.quiet === true
  if (state.companionStatus === "running") {
    if (!quiet) {
      safeNotify({ title: "CMspark Agent", message: "Companion 已在运行中 ✅", timeout: 3 })
    }
    return
  }

  if (!quiet) {
    safeNotify({ title: "CMspark Agent", message: "正在启动 Companion...", timeout: 3 })
  }
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
    if (quiet) {
      console.log("[tray] Auto-started Companion daemon")
    }
  } catch (err: any) {
    safeNotify({ title: "CMspark Agent", message: `启动失败 ❌: ${err.message}`, timeout: 5 })
  }
}

/**
 * Stop Companion via `daemon stop`.
 * @param force  always run stop (quit path) even if tray thinks status is stopped
 * @param quiet  suppress toasts (quit path)
 */
async function stopCompanion(opts?: { force?: boolean; quiet?: boolean }): Promise<void> {
  const force = opts?.force === true
  const quiet = opts?.quiet === true

  if (!force && state.companionStatus !== "running") {
    if (!quiet) {
      safeNotify({ title: "CMspark Agent", message: "Companion 未在运行", timeout: 3 })
    }
    return
  }

  if (!quiet) {
    safeNotify({ title: "CMspark Agent", message: "正在停止 Companion...", timeout: 3 })
  }

  try {
    const { getSelfSpawnArgs } = require("./paths")
    const { execPath, args } = getSelfSpawnArgs(["daemon", "stop"])
    child_process.execFileSync(execPath, args, { timeout: 15000 })
    if (!quiet) {
      safeNotify({ title: "CMspark Agent", message: "Companion 已停止 ⏹️", timeout: 3 })
    } else {
      console.log("[tray] Companion daemon stopped (force/quiet)")
    }
    // Refresh status after intentional stop (skip if we are about to exit tray)
    if (!force || !quiet) {
      setTimeout(() => pollCompanionStatus(), 1000)
    } else {
      state.companionStatus = "stopped"
      state.pid = null
      state.wsConnected = false
    }
  } catch (err: any) {
    // force+quiet (quit): still try to exit tray; log only
    if (quiet) {
      console.warn("[tray] daemon stop error:", err?.message || err)
    } else {
      safeNotify({ title: "CMspark Agent", message: `停止失败 ❌: ${err.message}`, timeout: 5 })
    }
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

/** Lazy require: lifecycle already imports this module; load-time import would cycle. */
function summonerBrowserAttached(): boolean {
  try {
    const { pickAuthenticatedClientWs } = require("./ws/lifecycle") as typeof import("./ws/lifecycle")
    return pickAuthenticatedClientWs() != null
  } catch {
    return false
  }
}

function readSummonerCfg() {
  return getConfig().summoner ?? {}
}

function persistSummonerPatch(patch: Record<string, unknown>): void {
  saveConfig({ summoner: { ...readSummonerCfg(), ...patch } })
}

function touchSummonerActivity(threadId?: string | null): void {
  persistSummonerPatch({
    last_activity_at: Date.now(),
    ...(threadId ? { last_thread_id: threadId } : {}),
  })
}

function pushSummonerSettings(): void {
  const s = readSummonerCfg()
  trayInstance?.sendSummoner?.(encodeSummonerSettings({
    resume_idle_minutes: normalizeResumeIdleMinutes(s.resume_idle_minutes),
    chrome_foreground: s.chrome_foreground === true,
  }))
}

async function hydrateSummonerThread(id: string, sessionToken?: number): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const token = sessionToken ?? beginOverlaySession()
  const result = await hydrateOverlayIfLive({
    id,
    token,
    selectMessages: (tid) => client.selectThreadMessages(tid),
    applyHydrate: (tid, messages) => {
      trayInstance?.hydrateSummoner?.({
        thread_id: tid,
        lines: hydratePlaintext(messages),
        browser: summonerBrowserAttached() ? "attached" : "detached",
        search_hint: SUMMONER_SEARCH_HINT,
      })
    },
    claimLease: (tid) => client.claimOverlayComposerLease(tid),
    releaseAllLeases: () => client.releaseAllOverlayComposerLeases(),
  })
  if (result !== "claimed") return false
  summonerThreadId = id
  return true
}

async function pushSummonerMcp(): Promise<void> {
  const client = summonerClient
  if (!client) return
  try {
    const resp = await client.sendAppRequest("mcp.list", {}, 4000)
    const servers = Array.isArray(resp?.servers) ? resp.servers : []
    trayInstance?.sendSummoner?.(encodeSummonerMcp({ names: connectedMcpServerNames(servers) }))
  } catch {
    trayInstance?.sendSummoner?.(encodeSummonerMcp({ names: [] }))
  }
}

export async function handleSummonerReady(): Promise<void> {
  const token = beginOverlaySession()
  syncSummonerHotkeyToTray()
  pushSummonerSettings()
  void pushSummonerMcp()
  const client = summonerClient
  const s = readSummonerCfg()
  const forceNew = shouldStartNewSummonerThread({
    now: Date.now(),
    lastActivityAt: typeof s.last_activity_at === "number" ? s.last_activity_at : null,
    resumeIdleMinutes: normalizeResumeIdleMinutes(s.resume_idle_minutes),
  })
  const threads = (await client?.listThreads()) ?? []
  const target = resolveSummonerOpenTarget({
    forceNew,
    lastThreadId: typeof s.last_thread_id === "string" ? s.last_thread_id : null,
    threads,
  })
  if (target.action === "create") {
    await handleSummonerNewThread(token)
  } else {
    await hydrateSummonerThread(target.threadId, token)
  }
  if (overlaySessionIsLive(currentOverlaySession()) && summonerThreadId) {
    touchSummonerActivity(summonerThreadId)
  }
}

export async function handleSummonerClosed(): Promise<void> {
  invalidateOverlaySession()
  summonerThreadId = null
  const client = summonerClient
  if (!client) return
  await client.releaseAllOverlayComposerLeases()
}

/** Overlay attach CTA — Chrome only. Never openSidePanel (that copy lies). */
export function handleSummonerAttach(foreground = false): void {
  try {
    const copy = attachChromeOnly(getChromeOpener(), { foreground })
    trayDebugLog(copy)
    safeNotify({ title: "CMspark 召唤器", message: copy, timeout: 5 })
  } catch (err: any) {
    const copy = `打开 Chrome 失败: ${err?.message || err}。我们不能替你打开侧栏。`
    trayDebugLog(copy)
    safeNotify({ title: "CMspark 召唤器", message: copy, timeout: 5 })
  }
}

/** Overlay continue CTA — new user message, no L1 replay. */
export function handleSummonerContinue(): boolean {
  if (!summonerClient || !summonerThreadId) return false
  // Busy continue is a no-op (must not supersede).
  void summonerClient.isRunActive(summonerThreadId).then((busy) => {
    if (busy || !summonerClient || !summonerThreadId) return
    summonerClient.sendChatCreate(buildContinueChatCreate(summonerThreadId))
  })
  return true
}

export async function handleSummonerSubmit(
  thread_id: string,
  text: string,
  enqueue = false,
): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const token = currentOverlaySession()
  const result = await submitSummonerTalk(
    thread_id,
    text,
    {
    listThreads: () => client.listThreads(),
    createThread: () => client.createThread(),
    claimLease: (id) =>
      claimOverlayIfLive({
        token,
        claim: () => client.claimOverlayComposerLease(id),
        releaseAll: () => client.releaseAllOverlayComposerLeases(),
      }),
    sendChatCreate: (args) => client.sendChatCreate(args),
    sendSteer: (args) => client.sendSteer(args),
    sendEnqueue: (args) => client.sendChatCreate({ ...args, enqueue: true }),
    isRunActive: (id) => client.isRunActive(id),
    selectMessages: (id) => client.selectThreadMessages(id),
    hydrate: ({ thread_id: id, messages }) => {
      if (!overlaySessionIsLive(token)) return
      summonerThreadId = id
      const prior = messages as Array<{
        role: string
        content?: string
        tool_calls?: Array<{ function?: { name?: string } }>
      }>
      const trimmed = text.trim()
      const last = prior[prior.length - 1]
      const already =
        !!trimmed &&
        last?.role === "user" &&
        String(last.content || "").includes(trimmed)
      const lines = hydratePlaintext(
        already || !trimmed ? prior : [...prior, { role: "user", content: trimmed }],
      )
      trayInstance?.hydrateSummoner?.({
        thread_id: id,
        lines,
        browser: summonerBrowserAttached() ? "attached" : "detached",
        search_hint: SUMMONER_SEARCH_HINT,
      })
    },
    },
    { enqueue },
  )
  if (result.ok && result.threadId) {
    summonerThreadId = result.threadId
    touchSummonerActivity(result.threadId)
  }
  return result.ok
}

export async function handleSummonerSearch(query: string) {
  const threads = (await summonerClient?.listThreads()) ?? []
  const cmd = summonerHitsFromQuery(threads, query)
  trayInstance?.sendSummoner?.(cmd)
  if (cmd.hits.length === 1) {
    const claimed = await hydrateSummonerThread(cmd.hits[0].id)
    if (claimed) touchSummonerActivity(cmd.hits[0].id)
  }
  return cmd
}

export async function handleSummonerSelect(threadId: string): Promise<void> {
  const id = threadId.trim()
  if (!id) return
  const claimed = await hydrateSummonerThread(id)
  if (claimed) touchSummonerActivity(id)
}

export function setSummonerThreadId(id: string | null): void {
  summonerThreadId = id
}

/** Re-arm a persisted combo on Swift. Empty config waits for first overlay open. */
export function armSummonerHotkeyOnTrayStart(): void {
  const cmd = nextSummonerHotkeyCmd(getConfig().summoner?.hotkey)
  if (cmd.cmd !== "summoner.hotkey.set") return
  trayInstance?.sendSummoner?.(cmd)
}

/** First overlay open with empty config → picker; else re-arm RegisterEventHotKey. */
export function syncSummonerHotkeyToTray(): void {
  trayInstance?.sendSummoner?.(nextSummonerHotkeyCmd(getConfig().summoner?.hotkey))
}

/** Persist picker choice (S11). Rejects stolen defaults. Returns canonical combo or null. */
export function persistSummonerHotkeyChosen(combo: string): string | null {
  const accepted = acceptedSummonerHotkey(combo)
  if (!accepted) return null
  saveConfig({ summoner: { hotkey: accepted } })
  trayInstance?.sendSummoner?.(encodeSummonerHotkeySet({ combo: accepted }))
  return accepted
}

/**
 * Swift overlay → Node. Close is summoner.closed only — never chat.abort.
 */
function summonerSttModelId(): SummonerSttModelId {
  const id = getConfig().voice?.localModelId
  if (id === "small" || id === "medium" || id === "large-v3-turbo") return id
  return "medium"
}

/** Cheap dir-exists check — start() still probes hash. Avoid hashing every family on click. */
function presentWhisperModelIds(): string[] {
  try {
    const { resolveWhisperRoot } = require("./voice/whisper-download") as typeof import("./voice/whisper-download")
    const root = resolveWhisperRoot()
    return (["medium", "small", "large-v3-turbo"] as const).filter((id) => {
      try {
        return fs.existsSync(path.join(root, id))
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function sendSummonerSttFrame(frame: VoiceSttFrame): boolean {
  const { type, ...params } = frame
  return summonerClient?.sendAppMessage(type, params) ?? false
}

function emitSummonerSttError(code?: string, message?: string): void {
  const cmd = mapVoiceSttToSummonerCmd({
    type: "voice.stt.error",
    code,
    message: message || code || "听写失败",
  })
  if (cmd) trayInstance?.sendSummoner?.(cmd)
}

async function startVoiceStt(frame: VoiceSttFrame): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const { type, ...params } = frame
  try {
    const resp = await client.sendAppRequest(type, params, 20_000)
    if (resp?.type === "voice.stt.error") {
      emitSummonerSttError(
        typeof resp.code === "string" ? resp.code : undefined,
        typeof resp.message === "string" ? resp.message : undefined,
      )
      return false
    }
    return true
  } catch (err) {
    emitSummonerSttError(undefined, err instanceof Error ? err.message : String(err))
    return false
  }
}

/** Overlay mic gesture → local STT (privacy_ack_v2: user pressed the mic). */
export function handleSummonerMic(
  evt:
    | { type: "summoner.mic.start" }
    | { type: "summoner.mic.chunk"; seq: number; data: string }
    | { type: "summoner.mic.end" }
    | { type: "summoner.mic.wav"; data: string },
): void {
  if (!summonerClient) return
  switch (evt.type) {
    case "summoner.mic.start":
      summonerMicSessionId = null
      summonerMicSeq = 0
      return
    case "summoner.mic.chunk": {
      void (async () => {
        if (!summonerMicSessionId) {
          const modelId = resolveSummonerSttModelId(summonerSttModelId(), presentWhisperModelIds())
          if (!modelId) {
            emitSummonerSttError("model_missing")
            return
          }
          summonerMicSessionId = `summoner-mic-${Date.now()}`
          const ok = await startVoiceStt(micPcmStartFrame({
            sessionId: summonerMicSessionId,
            modelId,
          }))
          if (!ok) {
            summonerMicSessionId = null
            return
          }
        }
        if (!summonerMicSessionId) return
        sendSummonerSttFrame({
          type: "voice.stt.chunk",
          v: 1,
          sessionId: summonerMicSessionId,
          seq: evt.seq,
          data: evt.data,
        })
        summonerMicSeq = evt.seq + 1
      })()
      return
    }
    case "summoner.mic.end": {
      if (!summonerMicSessionId) return
      sendSummonerSttFrame({
        type: "voice.stt.end",
        v: 1,
        sessionId: summonerMicSessionId,
        totalSeq: summonerMicSeq,
      })
      summonerMicSessionId = null
      return
    }
    case "summoner.mic.wav": {
      summonerMicSessionId = null
      const modelId = resolveSummonerSttModelId(summonerSttModelId(), presentWhisperModelIds())
      if (!modelId) {
        emitSummonerSttError("model_missing")
        return
      }
      void sendMicWavToStt({
        sessionId: `summoner-mic-${Date.now()}`,
        modelId,
        data: evt.data,
        transport: {
          start: async (frame) => {
            const client = summonerClient
            if (!client) return { ok: false, message: "召唤器未连接" }
            const { type, ...params } = frame
            try {
              const resp = await client.sendAppRequest(type, params, 20_000)
              if (resp?.type === "voice.stt.error") {
                return {
                  ok: false,
                  code: typeof resp.code === "string" ? resp.code : undefined,
                  message: typeof resp.message === "string" ? resp.message : "听写失败",
                }
              }
              return { ok: true }
            } catch (err) {
              return { ok: false, message: err instanceof Error ? err.message : String(err) }
            }
          },
          chunk: (frame) => { sendSummonerSttFrame(frame) },
          end: (frame) => { sendSummonerSttFrame(frame) },
        },
      }).then((result) => {
        if (!result.ok) emitSummonerSttError(result.code, result.message)
      })
      return
    }
  }
}

export async function handleSummonerNewThread(sessionToken?: number): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const token = sessionToken ?? beginOverlaySession()
  const created = await client.createThread()
  if (!created) {
    trayInstance?.sendSummoner?.(encodeSummonerError({ message: "无法创建新对话" }))
    return false
  }
  const claimed = await claimOverlayIfLive({
    token,
    claim: async () => {
      trayInstance?.hydrateSummoner?.({
        thread_id: created.id,
        lines: [],
        browser: summonerBrowserAttached() ? "attached" : "detached",
        search_hint: SUMMONER_SEARCH_HINT,
      })
      await client.claimOverlayComposerLease(created.id)
    },
    releaseAll: () => client.releaseAllOverlayComposerLeases(),
  })
  if (claimed) {
    summonerThreadId = created.id
    touchSummonerActivity(created.id)
  }
  return claimed
}

export function handleSummonerInbound(evt: SummonerInboundEvt): void {
  switch (evt.type) {
    case "summoner.submit":
      void handleSummonerSubmit(evt.thread_id, evt.text, evt.enqueue === true)
      return
    case "summoner.search":
      void handleSummonerSearch(evt.query)
      return
    case "summoner.select":
      void handleSummonerSelect(evt.thread_id)
      return
    case "summoner.attach_chrome":
      handleSummonerAttach(evt.foreground === true)
      return
    case "summoner.continue":
      handleSummonerContinue()
      return
    case "summoner.ready":
      void handleSummonerReady()
      return
    case "summoner.settings.set":
      persistSummonerPatch({
        resume_idle_minutes: evt.resume_idle_minutes,
        chrome_foreground: evt.chrome_foreground,
      })
      pushSummonerSettings()
      return
    case "summoner.hotkey.chosen":
      persistSummonerHotkeyChosen(evt.combo)
      return
    case "summoner.mic.start":
    case "summoner.mic.chunk":
    case "summoner.mic.end":
    case "summoner.mic.wav":
      handleSummonerMic(evt)
      return
    case "summoner.new_thread":
      void handleSummonerNewThread()
      return
    case "summoner.closed":
      void handleSummonerClosed()
      return
    case "summoner.composing":
      return
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
      // Product: 退出 tray = 停掉 Companion 守护进程及本 tray 进程（不再留下孤儿 node/exe）
      await stopCompanion({ force: true, quiet: true })
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
  if (summonerClient) {
    summonerClient.disconnect()
    summonerClient = null
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

      trayInstance.onSummonerEvent?.((evt) => {
        try {
          handleSummonerInbound(evt)
        } catch (err) {
          console.error("[menu-bar] summoner event error:", err)
        }
      })

      trayInstance.onCompanionUiRect?.((raw) => {
        try {
          if (!raw || typeof raw !== "object") return
          const o = raw as Record<string, unknown>
          summonerClient?.sendAppMessage("companion.ui.rect", o)
        } catch (err) {
          console.error("[menu-bar] companion.ui.rect forward error:", err)
        }
      })

      // Re-arm persisted hotkey on tray spawn. Empty config: wait for overlay open.
      armSummonerHotkeyOnTrayStart()

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

  // Second WS: overlay chat. Same origin; handshake surface=summoner (ACL).
  summonerClient = new CompanionClient({
    host: WS_HOST,
    port: WS_PORT,
    reconnectInterval: 5000,
    maxReconnectAttempts: -1,
    surface: "summoner",
  })
  summonerClient.onAppMessage((msg) => {
    const sttCmd = mapVoiceSttToSummonerCmd(msg)
    if (sttCmd) {
      // voice.stt.result → summoner.dictate (fill composer; user hits send)
      trayInstance?.sendSummoner?.(sttCmd)
      return
    }
    const cmd = mapChatMessageToSummonerCmd(msg)
    if (!cmd) return
    // Task 9 wires Swift stdin; non-Swift / pre-rebuild adapters no-op.
    trayInstance?.sendSummoner?.(cmd)
  })
  summonerClient.connect().catch(() => {})

  // P3a HUD spike (dual-process): tray owns Swift UI; server owns manager.
  // Requires CMSPARK_HUD_SPIKE=1 on BOTH tray and companion processes.
  if (process.env.CMSPARK_HUD_SPIKE === "1") {
    console.log("[tray] CMSPARK_HUD_SPIKE=1 — scheduling dual-process HUD spike")
    scheduleHudSpikeDualProcess()
  }

  // Start polling loop
  pollTimer = setInterval(() => {
    pollCompanionStatus().catch((err) => {
      if (process.env.CMSPARK_DEBUG) {
        console.warn("[menu-bar] Poll error:", err)
      }
    })
  }, POLL_INTERVAL_MS)

  // Darwin: ensure emergency-stop helper is up before daemon CU paths run.
  // Packaged app: MacOS/CMspark already starts estop as Aqua child (host.swift).
  // Dev / node-only tray: best-effort start from this process.
  if (process.platform === "darwin") {
    try {
      const { startTrayOwnedEstopBestEffort } = await import("./computer/darwin-estop")
      startTrayOwnedEstopBestEffort()
    } catch (err: any) {
      console.warn("[tray] estop ensure skipped:", err?.message || err)
    }
  }

  // Product: tray launch always ensures Companion is up — no separate "启动" required.
  if (state.companionStatus !== "running") {
    console.log("[tray] Companion not running — auto-starting daemon")
    await startCompanion({ quiet: true })
  } else {
    console.log("[tray] Companion already running — skip auto-start")
  }

  // Ctrl+C / taskkill graceful path: stop daemon with tray
  if (!(global as any).__cmsparkTraySignalBound) {
    ;(global as any).__cmsparkTraySignalBound = true
    const onSignal = () => {
      console.log("[tray] signal received — stopping Companion + tray")
      stopCompanion({ force: true, quiet: true })
        .catch(() => {})
        .finally(() => {
          stopMenuBarAgent()
            .catch(() => {})
            .finally(() => process.exit(0))
        })
    }
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)
  }
}

/**
 * Dual-process HUD spike: open/hydrate on local Swift tray, then ask companion
 * for a SecurityConfirmationManager id and race showHudConfirm → respond.
 */
function scheduleHudSpikeDualProcess(): void {
  setTimeout(() => {
    void runHudSpikeDualProcess().catch((err) => {
      console.error("[tray] HUD spike failed:", err?.message || err)
    })
  }, 3000)
}

async function runHudSpikeDualProcess(): Promise<void> {
  const tray = trayInstance
  if (!tray?.openHudAsync || !tray.hydrateHud || !tray.showHudConfirm) {
    console.warn("[tray] HUD spike skipped: tray lacks HUD methods (need Swift backend)")
    return
  }

  const { buildSpikeHydrate, HUD_SPIKE_THREAD_ID, HUD_SPIKE_TASK_ID } = await import("./hud/spike")
  const { HudShellRouter } = await import("./hud/shell-router")

  const router = new HudShellRouter({
    sendToHud: (m) => {
      if (m && typeof m === "object" && (m as { cmd?: string }).cmd === "shell.standby") {
        const s = m as { thread_id: string; active_shell: "hud" | "cockpit"; message: string }
        tray.standbyHud?.(s.thread_id, s.active_shell, s.message)
      }
    },
    sendToCockpit: () => {},
  })
  const anyTray = tray as { setShellRouter?: (r: import("./hud/shell-router").HudShellRouter | null) => void; onHudAbort?: (cb: any) => void }
  anyTray.setShellRouter?.(router)
  anyTray.onHudAbort?.((ev: { thread_id?: string; task_id?: string }) => {
    console.log("[tray] hud.abort", ev)
    companionClient?.sendAppMessage("hud.spike.abort", {
      thread_id: ev.thread_id || HUD_SPIKE_THREAD_ID,
      task_id: ev.task_id || HUD_SPIKE_TASK_ID,
    })
  })

  console.log("[tray] HUD spike: openHudAsync…")
  try {
    await tray.openHudAsync(HUD_SPIKE_THREAD_ID, "spike", 2000)
  } catch (err: any) {
    console.error("[tray] HUD spike open failed:", err?.message || err)
    console.error("[tray] Rebuild Swift tray after Task 4: npm run tray:rebuild (macOS)")
    return
  }

  tray.hydrateHud(buildSpikeHydrate("connected"))
  router.setActiveShell(HUD_SPIKE_THREAD_ID, "hud")
  console.log("[tray] HUD spike: hydrated")

  // Dual-process confirm via companion WS
  const client = companionClient
  if (!client || client.connectionState !== "connected") {
    console.warn("[tray] companion not connected — UI-only spike (no manager race)")
    // Local-only confirm so operator can still click Allow/Deny
    const localId = `local-spike-${Date.now()}`
    const r = await tray.showHudConfirm({
      id: localId,
      toolName: "evaluate",
      riskLevel: "high",
      summary: "UI-only spike (companion offline)",
      timeoutMs: 30_000,
    })
    console.log("[tray] local HUD confirm:", r)
    router.setActiveShell(HUD_SPIKE_THREAD_ID, "cockpit")
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const onMsg = (msg: any) => {
      if (!msg || typeof msg !== "object") return
      if (msg.type === "hud.spike.show_confirm") {
        const id = String(msg.id || "")
        if (!id) return
        console.log("[tray] HUD spike: show confirm", id)
        void tray.showHudConfirm!({
          id,
          toolName: String(msg.tool_name || "evaluate"),
          riskLevel: String(msg.risk_level || "high"),
          summary: String(msg.summary || "spike"),
          timeoutMs: typeof msg.timeout_ms === "number" ? msg.timeout_ms : 45_000,
        }).then((r) => {
          client.sendAppMessage("hud.spike.confirm_response", {
            id: r.id,
            approved: r.approved,
          })
        })
      }
      if (msg.type === "hud.spike.done") {
        console.log("[tray] HUD spike done:", msg)
        // Standby after manager terminal
        setTimeout(() => {
          router.setActiveShell(HUD_SPIKE_THREAD_ID, "cockpit")
          console.log("[tray] HUD spike: standby → cockpit")
          finish()
        }, 500)
      }
      if (msg.type === "hud.spike.error") {
        console.error("[tray] HUD spike error from server:", msg.error)
        finish()
      }
    }

    client.onAppMessage(onMsg)
    const ok = client.sendAppMessage("hud.spike.start", { timeout_ms: 45_000 })
    if (!ok) {
      console.error("[tray] failed to send hud.spike.start")
      finish()
      return
    }
    // Safety: don't hang menu-bar forever
    setTimeout(finish, 60_000)
  })
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
  if (summonerClient) {
    summonerClient.disconnect()
    summonerClient = null
  }
  cleanup()
  console.log("[tray] CMspark Agent menu bar stopped")
}
