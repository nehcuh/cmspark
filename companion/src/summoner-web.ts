/**
 * C-thin summoner shell: loopback HTML + token (settings-web pattern).
 *
 * The page never upgrades companion WS — Origin allowlist stays
 * chrome-extension:// and cmspark-tray://local. Tray dispatch uses the
 * existing summoner-stamped CompanionClient.
 */
import * as http from "http"
import * as crypto from "crypto"
import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  closeOverlayChrome,
  overlayWindowPosition,
  OVERLAY_WINDOW_SIZE,
  parseFinderDesktopBounds,
  planSummonerShellOpen,
  resolveSummonerBrowserPath,
} from "./summoner/shell-open"
import { applySummonerPayloadPolicy } from "./ws/summoner-acl"
import { MCP_OVERLAY_CONFIRM_NOTICE } from "./mcp/confirm-target"
import {
  attachChromeOnly,
  SUMMONER_ATTACH_FOOTNOTE,
  SUMMONER_ATTACH_PRIMARY,
  SUMMONER_ATTACH_SECONDARY,
  SUMMONER_CONFIRM_NEED,
  SUMMONER_OPEN_CONFIRM,
  SUMMONER_CDP_NEEDED,
  SUMMONER_CHEVRON_COLLAPSE,
  SUMMONER_CHEVRON_EXPAND,
  SUMMONER_L0_CHROME_DOWN,
  SUMMONER_RENTER_CHROME_DOWN,
  CHAT_SHELL_TITLE_NONE,
  VOICE_PRIVACY_ACK_V2_CLAUSES,
  MEETING_PRIVACY_ACK_V1_CLAUSES,
} from "./summoner/client"
import { getChromeOpener } from "./platform"
import { getConfig } from "./config"
import { OVERLAY_RENDER_MD_JS } from "./summoner/overlay-md"

export type SummonerWebDispatch = (msg: Record<string, unknown>) => Promise<unknown>
export type SummonerWebAttachChrome = (opts?: { foreground?: boolean }) => string
export type SummonerWebRequestOpenSidePanel = () => Promise<{ error_code?: string } | void>
export type SummonerWebHasExtensionPeer = () => boolean

export const SUMMONER_WEB_DISPATCH_ALLOW = new Set([
  "system.ping",
  "chat.create",
  "chat.abort",
  "chat.steer",
  "thread.list",
  "thread.select",
  "thread.create",
  "thread.delete",
  "thread.update",
  "mcp.list",
  "mcp.toggle_server",
  "pack.list",
  "pack.apply",
  "skill.list",
  "skill.activate",
  "skill.deactivate",
  "knowledge.list",
  "knowledge.set_active",
  "file.upload",
  "composer.lease.get",
  "composer.lease.claim",
  "composer.lease.release",
  "voice.stt.start",
  "voice.stt.chunk",
  "voice.stt.end",
  "voice.stt.abort",
  "voice.stt.partial_request",
  "meeting.create",
  "meeting.start",
  "meeting.end",
  "meeting.append_transcript",
  "meeting.generate_minutes",
  "meeting.list",
  "meeting.get",
  "meeting.auto_diarize",
])

/** Fan-out to HTML EventSource. Confirm / Trust / config frames stay off this list. */
export const SUMMONER_WEB_EVENT_ALLOW = new Set([
  "chat.token",
  "chat.done",
  "chat.error",
  "chat.user",
  "chat.steered",
  "chat.enqueued",
  "chat.aborted",
  "error",
  "file.upload_status",
  "file.upload_error",
  "file.uploaded",
  "run_status",
  "composer.lease",
  "tool.start",
  "mcp.confirm.pending",
  "voice.stt.partial",
  "voice.stt.result",
  "voice.stt.error",
  "meeting.created",
  "meeting.started",
  "meeting.ended",
  "meeting.error",
  "meeting.updated",
  "meeting.minutes_result",
  "meeting.list_result",
  "meeting.get_result",
  "meeting.diarized",
])

const MAX_SSE_CLIENTS = 4
const sseClients = new Set<http.ServerResponse>()

const FILE_BODY_MAX = 15 * 1024 * 1024
const JSON_BODY_MAX = 64 * 1024
/** /api/stt/chunk only: JSON around base64(256KiB PCM) ≈ 342KiB + envelope. */
const STT_CHUNK_BODY_MAX = 400 * 1024

function escHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  )
}

let activeServer: http.Server | null = null
let activePort: number | null = null
let sessionToken: string | null = null
let activeDispatch: SummonerWebDispatch | null = null
let activeAttachChrome: SummonerWebAttachChrome | null = null
let activeRequestOpenSidePanel: SummonerWebRequestOpenSidePanel | null = null
let activeHasExtensionPeer: SummonerWebHasExtensionPeer | null = null
let activeOnShellClosed: (() => void) | null = null
let lastAccessTime = Date.now()
let autoCloseTimer: ReturnType<typeof setInterval> | null = null

function defaultAttachChrome(opts?: { foreground?: boolean }): string {
  return attachChromeOnly(getChromeOpener(), opts)
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = http.createServer()
        probe.on("error", reject)
        probe.listen(port, "127.0.0.1", () => {
          probe.close(() => resolve())
        })
      })
      return port
    } catch {
      continue
    }
  }
  throw new Error("No available port for summoner web server")
}

function parseQuery(qs: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!qs) return out
  for (const pair of qs.split("&")) {
    if (!pair) continue
    const eq = pair.indexOf("=")
    const k = eq < 0 ? decodeURIComponent(pair) : decodeURIComponent(pair.slice(0, eq))
    const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1))
    out.set(k, v)
  }
  return out
}

function tokenOk(req: http.IncomingMessage, expected: string): boolean {
  const raw = req.url || ""
  const qIdx = raw.indexOf("?")
  if (qIdx < 0) return false
  const query = parseQuery(raw.slice(qIdx + 1))
  const provided = query.get("token")
  if (!provided) return false
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function hostOk(req: http.IncomingMessage, port: number): boolean {
  const host = (req.headers.host || "").toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

function originOk(req: http.IncomingMessage, port: number): boolean {
  const origin = (req.headers.origin || "").toLowerCase()
  if (!origin || origin === "null") return true
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    origin === `http://[::1]:${port}`
  )
}

function forbidden(res: http.ServerResponse, reason: string) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
  res.end(`Forbidden: ${reason}`)
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  }
  res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error("Request body too large"))
        req.destroy()
        return
      }
      body += chunk.toString()
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

async function dispatchAllowed(type: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!SUMMONER_WEB_DISPATCH_ALLOW.has(type)) {
    throw Object.assign(new Error(`not allowed: ${type}`), { status: 403 })
  }
  const msg: Record<string, unknown> = { ...payload, type }
  const gate = applySummonerPayloadPolicy("summoner", msg)
  if (!gate.ok) {
    throw Object.assign(new Error(gate.error), { status: 403, error_code: gate.error_code })
  }
  if (!activeDispatch) throw Object.assign(new Error("summoner dispatch unavailable"), { status: 503 })
  return activeDispatch(msg)
}

export function summonerWebPageUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?token=${token}`
}

const STATUS_LABELS: Record<string, string> = {
  run_active: "本轮还在跑 · 回车纠偏或排队",
  queue_full: "排队已满（最多 8 条）",
  steer_queue_full: "纠偏队列已满",
  idle_enqueue: "空闲时直接发送，不必排队",
  OVERLAY_STANDBY: "侧栏占用了输入",
  LEASE_REV_MISMATCH: "侧栏占用了输入",
  LEASE_HOLDER_SURFACE_MISMATCH: "侧栏占用了输入",
  BROWSER_UNAVAILABLE: SUMMONER_CDP_NEEDED,
}

/** Map router/SSE errors to overlay copy. Keys `data.error_code`, not the English `error` sentence. */
export function summonerWebEventStatus(msg: unknown): string {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return "出错了"
  const m = msg as Record<string, unknown>
  const data = m.data && typeof m.data === "object" && !Array.isArray(m.data)
    ? (m.data as Record<string, unknown>)
    : {}
  const raw = String(m.error_code || data.error_code || m.error || "")
  const code = raw.includes("OVERLAY_STANDBY")
    ? "OVERLAY_STANDBY"
    : raw.includes("LEASE_REV_MISMATCH")
      ? "LEASE_REV_MISMATCH"
      : raw.includes("BROWSER_UNAVAILABLE")
        ? "BROWSER_UNAVAILABLE"
        : raw
  if (STATUS_LABELS[code]) return STATUS_LABELS[code]
  if (typeof m.error === "string" && m.error.trim()) return m.error
  if (typeof m.message === "string" && m.message.trim()) return m.message
  return "出错了"
}

export function pushSummonerWebEvent(msg: unknown): boolean {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false
  const type = (msg as { type?: unknown }).type
  if (typeof type !== "string" || !SUMMONER_WEB_EVENT_ALLOW.has(type)) return false
  if (/confirm/i.test(type) && type !== "mcp.confirm.pending") return false
  const line = `data: ${JSON.stringify(msg)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(line)
    } catch {
      sseClients.delete(res)
    }
  }
  return true
}

function closeSseClients(): void {
  for (const res of sseClients) {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  sseClients.clear()
}

export type OpenLoopbackPageDeps = {
  platform?: NodeJS.Platform
  browserPath?: string | null
  userDataDir?: string
  screen?: { w: number; h: number }
  spawn?: (
    command: string,
    args: string[],
    options: { detached?: boolean; stdio?: "ignore"; windowsHide?: boolean; shell?: boolean },
  ) => { unref: () => void }
}

export function defaultOverlayChromeDir(): string {
  const root = process.env.CMSPARK_DATA_DIR || path.join(os.homedir(), ".cmspark-agent")
  return path.join(root, "overlay-chrome")
}

let overlayLaunchAt = 0
const OVERLAY_LAUNCH_GRACE_MS = 2000

function overlayLaunchInGrace(): boolean {
  return !!(overlayLaunchAt && Date.now() - overlayLaunchAt < OVERLAY_LAUNCH_GRACE_MS)
}

/** Hide/last-SSE/idle-stop share this path; twice is a no-throw. */
function invokeOnShellClosed(): void {
  const cb = activeOnShellClosed
  if (!cb) return
  try {
    cb()
  } catch {
    /* close path must not throw */
  }
}

export function summonerWebHasPage(): boolean {
  return sseClients.size > 0
}

/** SSE connected, or Chrome --app still coming up after spawn. */
export function summonerWebIsShowing(): boolean {
  if (sseClients.size > 0) return true
  if (overlayLaunchInGrace()) return true
  return false
}

export function requestSummonerWebClose(): boolean {
  overlayLaunchAt = 0
  if (sseClients.size === 0) return false
  const line = `data: ${JSON.stringify({ type: "shell.close" })}\n\n`
  for (const res of sseClients) {
    try {
      res.write(line)
    } catch {
      sseClients.delete(res)
    }
  }
  return true
}

export function hideSummonerWebShell(): void {
  requestSummonerWebClose()
  closeOverlayChrome(defaultOverlayChromeDir())
  invokeOnShellClosed()
}

function probeScreen(platform: NodeJS.Platform): { w: number; h: number } {
  if (platform === "darwin") {
    try {
      const raw = child_process.execFileSync(
        "osascript",
        ["-e", 'tell application "Finder" to get bounds of window of desktop'],
        { encoding: "utf8", timeout: 2000 },
      )
      const parsed = parseFinderDesktopBounds(raw)
      if (parsed) return parsed
    } catch {
      /* fallback */
    }
  }
  return { w: 1440, h: 900 }
}

/** Returns false when the URL is rejected (no spawn). */
export function openLoopbackPage(url: string, deps: OpenLoopbackPageDeps = {}): boolean {
  const platform = deps.platform ?? process.platform
  const browserPath =
    deps.browserPath !== undefined ? deps.browserPath : resolveSummonerBrowserPath(platform)
  const userDataDir = deps.userDataDir || defaultOverlayChromeDir()
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
  } catch {
    /* Chrome can still create the profile dir */
  }
  const screen = deps.screen || probeScreen(platform)
  const plan = planSummonerShellOpen(url, {
    platform,
    browserPath,
    userDataDir,
    windowPosition: overlayWindowPosition(screen.w, screen.h),
  })
  if ("error" in plan) {
    console.error(`[summoner-web] ${plan.error}`)
    return false
  }
  overlayLaunchAt = Date.now()
  const spawn = deps.spawn ?? ((cmd, args, opts) => child_process.spawn(cmd, args, opts))
  spawn(plan.command, plan.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref()
  return true
}

export async function startSummonerWebServer(opts: {
  preferredPort?: number
  dispatch: SummonerWebDispatch
  attachChrome?: SummonerWebAttachChrome
  requestOpenSidePanel?: SummonerWebRequestOpenSidePanel
  hasExtensionPeer?: SummonerWebHasExtensionPeer
  onShellClosed?: () => void
}): Promise<{ port: number; token: string }> {
  activeDispatch = opts.dispatch
  activeAttachChrome = opts.attachChrome ?? defaultAttachChrome
  activeRequestOpenSidePanel = opts.requestOpenSidePanel ?? null
  activeHasExtensionPeer = opts.hasExtensionPeer ?? null
  activeOnShellClosed = opts.onShellClosed ?? null
  if (activeServer && activePort && sessionToken) {
    lastAccessTime = Date.now()
    return { port: activePort, token: sessionToken }
  }

  const port = await findAvailablePort(opts.preferredPort ?? 23403)
  lastAccessTime = Date.now()
  const token = crypto.randomBytes(32).toString("hex")

  const server = http.createServer((req, res) => {
    lastAccessTime = Date.now()
    void handleRequest(req, res, port, token)
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  activeServer = server
  activePort = port
  sessionToken = token

  autoCloseTimer = setInterval(() => {
    if (Date.now() - lastAccessTime > 30 * 60 * 1000) {
      stopSummonerWebServer()
    }
  }, 60 * 1000)

  return { port, token }
}

export function stopSummonerWebServer(): void {
  if (autoCloseTimer) {
    clearInterval(autoCloseTimer)
    autoCloseTimer = null
  }
  if (activeServer) {
    closeSseClients()
    activeServer.close()
    activeServer = null
    activePort = null
    sessionToken = null
    activeDispatch = null
    activeAttachChrome = null
    activeRequestOpenSidePanel = null
    activeHasExtensionPeer = null
    invokeOnShellClosed()
    activeOnShellClosed = null
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number,
  token: string,
): Promise<void> {
  let pathOnly = "/"
  let query = new Map<string, string>()
  try {
    const raw = req.url || "/"
    const qIdx = raw.indexOf("?")
    pathOnly = (qIdx < 0 ? raw : raw.slice(0, qIdx)) || "/"
    query = qIdx < 0 ? new Map<string, string>() : parseQuery(raw.slice(qIdx + 1))
    if (!tokenOk(req, token)) {
      forbidden(res, "missing or invalid session token")
      return
    }
  } catch {
    forbidden(res, "missing or invalid session token")
    return
  }
  if (!hostOk(req, port)) {
    forbidden(res, `unexpected Host header "${req.headers.host || ""}"`)
    return
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    res.end()
    return
  }

  if (
    (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") &&
    !originOk(req, port)
  ) {
    forbidden(res, `unexpected Origin header "${req.headers.origin || ""}"`)
    return
  }

  try {
    if ((pathOnly === "/" || pathOnly === "/summoner") && req.method === "GET") {
      const nonce = crypto.randomBytes(16).toString("base64")
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'`,
      })
      res.end(SUMMONER_HTML.replace("<script>", `<script nonce="${nonce}">`))
      return
    }

    if (pathOnly === "/api/health" && req.method === "GET") {
      jsonResponse(res, { status: "ok", uptime: process.uptime() })
      return
    }

    if (pathOnly === "/api/send-shortcut" && req.method === "GET") {
      const v = getConfig().summoner?.send_shortcut
      const send_shortcut = v === "Cmd+Enter" || v === "Ctrl+Enter" || v === "Enter" ? v : "Enter"
      jsonResponse(res, { send_shortcut })
      return
    }

    if (pathOnly === "/api/voice-settings" && req.method === "GET") {
      const voice = getConfig().voice
      const localModelId =
        voice?.localModelId === "small" ||
        voice?.localModelId === "medium" ||
        voice?.localModelId === "large-v3-turbo"
          ? voice.localModelId
          : "medium"
      const sttEngine = voice?.sttEngine === "local" ? "local" : "browser"
      jsonResponse(res, { sttEngine, localModelId, lang: "zh-CN" })
      return
    }

    if (pathOnly === "/api/events" && req.method === "GET") {
      if (sseClients.size >= MAX_SSE_CLIENTS) {
        jsonResponse(res, { type: "error", error: "too many listeners" }, 429)
        return
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      })
      res.write(":\n\n")
      sseClients.add(res)
      req.on("close", () => {
        sseClients.delete(res)
        if (sseClients.size === 0 && !overlayLaunchInGrace()) {
          invokeOnShellClosed()
        }
      })
      return
    }

    if (pathOnly === "/api/threads" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("thread.list", {}))
      return
    }

    if (pathOnly === "/api/threads" && req.method === "POST") {
      jsonResponse(res, await dispatchAllowed("thread.create", {}))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "GET") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("thread.select", { thread_id: id }))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "PATCH") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const alias = typeof body.alias === "string" ? body.alias : ""
      jsonResponse(res, await dispatchAllowed("thread.update", { thread_id: id, updates: { alias } }))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "DELETE") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("thread.delete", { thread_id: id, mode: "trash" }))
      return
    }

    if (pathOnly === "/api/packs" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("pack.list", {}))
      return
    }

    if (pathOnly === "/api/mcp" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("mcp.list", {}))
      return
    }

    if (pathOnly === "/api/mcp/toggle" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const name = typeof body.name === "string" ? body.name : ""
      if (!name || typeof body.enabled !== "boolean") {
        jsonResponse(res, { type: "error", error: "name and enabled required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("mcp.toggle_server", { name, enabled: body.enabled }))
      return
    }

    if (pathOnly === "/api/skills" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("skill.list", {}))
      return
    }

    if (pathOnly === "/api/skills/toggle" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const skill_name = typeof body.skill_name === "string" ? body.skill_name : ""
      const on = body.on !== false
      if (!thread_id || !skill_name) {
        jsonResponse(res, { type: "error", error: "thread_id and skill_name required" }, 400)
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed(on ? "skill.activate" : "skill.deactivate", { thread_id, skill_name }),
      )
      return
    }

    if (pathOnly === "/api/knowledge" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("knowledge.list", {}))
      return
    }

    if (pathOnly === "/api/knowledge/active" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("knowledge.set_active", { thread_id, ids }))
      return
    }

    if (pathOnly === "/api/chat" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const message = typeof body.message === "string" ? body.message : ""
      if (!thread_id || !message.trim()) {
        jsonResponse(res, { type: "error", error: "thread_id and message required" }, 400)
        return
      }
      const mode = body.mode === "steer" || body.mode === "enqueue" ? body.mode : "create"
      if (mode === "steer") {
        jsonResponse(res, await dispatchAllowed("chat.steer", { thread_id, message }))
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed("chat.create", {
          thread_id,
          message,
          ...(mode === "enqueue" ? { enqueue: true } : {}),
        }),
      )
      return
    }

    if (pathOnly === "/api/files" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FILE_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id || !Array.isArray(body.files)) {
        jsonResponse(res, { type: "error", error: "thread_id and files required" }, 400)
        return
      }
      const payload: Record<string, unknown> = { thread_id, files: body.files }
      if (typeof body.message === "string" && body.message.trim()) payload.message = body.message
      jsonResponse(res, await dispatchAllowed("file.upload", payload))
      return
    }

    if (pathOnly === "/api/packs/apply" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const pack_id = typeof body.pack_id === "string" ? body.pack_id : ""
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!pack_id || !thread_id) {
        jsonResponse(res, { type: "error", error: "pack_id and thread_id required" }, 400)
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed("pack.apply", { pack_id, thread_id, user_gesture: true }),
      )
      return
    }

    if (pathOnly === "/api/lease/release" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      const got = (await dispatchAllowed("composer.lease.get", { thread_id })) as {
        rev?: number
      }
      const rev = typeof got?.rev === "number" ? got.rev : 0
      jsonResponse(res, await dispatchAllowed("composer.lease.release", { thread_id, rev }))
      return
    }

    if (pathOnly === "/api/lease" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      const got = (await dispatchAllowed("composer.lease.get", { thread_id })) as {
        rev?: number
      }
      const rev = typeof got?.rev === "number" ? got.rev : 0
      jsonResponse(
        res,
        await dispatchAllowed("composer.lease.claim", {
          thread_id,
          holder: "overlay",
          rev,
        }),
      )
      return
    }

    if (pathOnly === "/api/abort" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("chat.abort", { thread_id }))
      return
    }

    if (pathOnly === "/api/attach" && req.method === "POST") {
      let foreground = false
      try {
        const raw = await readBody(req, JSON_BODY_MAX)
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as { foreground?: unknown }
          foreground = parsed.foreground === true
        }
      } catch {
        foreground = false
      }
      const attach = activeAttachChrome ?? defaultAttachChrome
      const message = attach({ foreground })
      jsonResponse(res, { type: "ok", message })
      return
    }

    if (pathOnly === "/api/operate" && req.method === "POST") {
      const attach = activeAttachChrome ?? defaultAttachChrome
      const message = attach({ foreground: true })
      const fail = () => {
        jsonResponse(
          res,
          { type: "error", error: "请点工具栏 C", error_code: "OPERATE_SIDEPANEL_UNAVAILABLE", attach: message },
          503,
        )
      }
      if (!activeRequestOpenSidePanel || !activeHasExtensionPeer || !activeHasExtensionPeer()) {
        fail()
        return
      }
      try {
        const r = await activeRequestOpenSidePanel()
        if (r && r.error_code) {
          fail()
          return
        }
      } catch {
        fail()
        return
      }
      jsonResponse(res, { type: "ok", message })
      return
    }

    if (pathOnly === "/api/stt/start" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      const cfgModel = getConfig().voice?.localModelId
      const modelId =
        body.modelId === "small" || body.modelId === "medium" || body.modelId === "large-v3-turbo"
          ? body.modelId
          : cfgModel === "small" || cfgModel === "medium" || cfgModel === "large-v3-turbo"
            ? cfgModel
            : "medium"
      const payload: Record<string, unknown> = {
        v: 1,
        sessionId,
        modelId,
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        privacy_ack_v2: true,
      }
      if (typeof body.lang === "string" && body.lang.trim()) {
        payload.lang = body.lang.startsWith("zh") ? "zh" : body.lang
      } else {
        payload.lang = "zh"
      }
      if (typeof body.maxMs === "number" && Number.isFinite(body.maxMs)) payload.maxMs = body.maxMs
      jsonResponse(res, await dispatchAllowed("voice.stt.start", payload))
      return
    }

    if (pathOnly === "/api/stt/chunk" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, STT_CHUNK_BODY_MAX)) as Record<string, unknown>
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      const seq = Number.isInteger(body.seq) ? body.seq : 0
      const data = typeof body.data === "string" ? body.data : ""
      jsonResponse(
        res,
        await dispatchAllowed("voice.stt.chunk", { v: 1, sessionId, seq, data }),
      )
      return
    }

    if (pathOnly === "/api/stt/end" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      const totalSeq = Number.isInteger(body.totalSeq) ? body.totalSeq : 0
      jsonResponse(res, await dispatchAllowed("voice.stt.end", { v: 1, sessionId, totalSeq }))
      return
    }

    if (pathOnly === "/api/stt/abort" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      jsonResponse(res, await dispatchAllowed("voice.stt.abort", { v: 1, sessionId }))
      return
    }

    if (pathOnly === "/api/stt/partial" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      jsonResponse(
        res,
        await dispatchAllowed("voice.stt.partial_request", { v: 1, sessionId }),
      )
      return
    }

    if (pathOnly === "/api/meeting/start" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const payload: Record<string, unknown> = {
        v: 1,
        privacy_ack_v1: true,
        audio_retained: false,
      }
      if (typeof body.title === "string") payload.title = body.title
      if (typeof body.thread_id === "string") payload.thread_id = body.thread_id
      if (typeof body.id === "string" && body.id.trim()) payload.id = body.id.trim()
      jsonResponse(res, await dispatchAllowed("meeting.start", payload))
      return
    }

    if (pathOnly === "/api/meeting/end" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const id = typeof body.id === "string" ? body.id : ""
      jsonResponse(res, await dispatchAllowed("meeting.end", { v: 1, id }))
      return
    }

    if (pathOnly === "/api/meeting/append" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const id = typeof body.id === "string" ? body.id : ""
      const text = typeof body.text === "string" ? body.text : ""
      jsonResponse(
        res,
        await dispatchAllowed("meeting.append_transcript", { v: 1, id, text, source: "stt" }),
      )
      return
    }

    if (pathOnly === "/api/meeting/minutes" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const id = typeof body.id === "string" ? body.id : ""
      jsonResponse(res, await dispatchAllowed("meeting.generate_minutes", { v: 1, id }))
      return
    }

    if (pathOnly === "/api/meetings" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("meeting.list", { v: 1 }))
      return
    }

    if (pathOnly === "/api/meeting" && req.method === "GET") {
      const raw = req.url || ""
      const qIdx = raw.indexOf("?")
      const query = qIdx >= 0 ? parseQuery(raw.slice(qIdx + 1)) : new Map<string, string>()
      const id = query.get("id") || ""
      jsonResponse(res, await dispatchAllowed("meeting.get", { v: 1, id }))
      return
    }

    if (pathOnly === "/api/meeting/diarize" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX)) as Record<string, unknown>
      const id = typeof body.id === "string" ? body.id : ""
      const mode = body.mode === "text_gap" ? "text_gap" : "audio_cluster"
      const k = typeof body.k === "number" ? body.k : 2
      const payload: Record<string, unknown> = {
        v: 1,
        id,
        mode,
        k,
        privacy_ack_v1: true,
      }
      if (Array.isArray(body.features)) payload.features = body.features
      jsonResponse(res, await dispatchAllowed("meeting.auto_diarize", payload))
      return
    }

    res.writeHead(404)
    res.end("Not found")
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500
    jsonResponse(res, { type: "error", error: e?.message || String(e) }, status)
  }
}

const SUMMONER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMspark</title>
<style>
:root{
  --paper:#fff;--canvas:#f4f4f5;--rail-bg:#fafafa;--text:#171717;--secondary:#525252;
  --faint:#737373;--line:rgba(23,23,23,.08);--indigo:#4f46e5;--indigo-soft:#eef2ff;
  --radius:16px;--radius-sm:10px;--rail:52px;--list:216px;
  --focus:0 0 0 2px #fff,0 0 0 4px var(--indigo);
  --shadow:0 1px 0 var(--line),0 18px 40px rgba(23,23,23,.10);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;width:100%;overflow:hidden}
body{
  font:13px/1.45 "Segoe UI","Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif;
  color:var(--text);background:var(--paper);
}
.hud{height:100%;display:flex;flex-direction:column;background:var(--paper);overflow:hidden;position:relative}
.body{display:none;flex:1;min-height:0;border-bottom:1px solid var(--line);overflow:hidden}
.hud.expanded .body{display:flex;flex-direction:column}
.rail{
  background:var(--rail-bg);border-right:1px solid var(--line);
  display:none;flex-direction:column;align-items:center;padding:10px 0;gap:4px;overflow:hidden;flex-shrink:0
}
.rail-btn{
  width:44px;height:44px;border:0;background:transparent;border-radius:var(--radius-sm);
  color:var(--secondary);cursor:pointer;display:grid;place-items:center;
}
.rail-btn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.rail-btn:hover{background:var(--canvas);color:var(--text)}
.rail-btn[aria-current="true"]{background:var(--indigo-soft);color:var(--indigo)}
.rail-btn:focus-visible{outline:none;box-shadow:var(--focus)}
.rail-btn[hidden]{display:none}
.list{border-right:1px solid var(--line);display:none;flex-direction:column;min-width:0;background:var(--paper);overflow:hidden}
.rail,.list{display:none}
.list-scroll{overflow-y:auto;overflow-x:hidden;flex:1;padding:0 6px 10px}
.item,.row{
  display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:10px;
  padding:10px;cursor:pointer;min-height:44px;font:inherit;color:var(--text);
}
.item:hover,.row:hover{background:var(--canvas)}
.item.active,.row[aria-current="true"],.item.active{background:var(--indigo-soft);color:var(--indigo)}
.item:focus-visible,.row:focus-visible{outline:none;box-shadow:var(--focus)}
.item.muted,.row.muted{opacity:.45;cursor:not-allowed}
.row strong,.item strong{display:block;font-weight:500;font-size:13px}
.row small,.item small{display:block;margin-top:2px;font-size:11px;color:var(--faint)}
.trow{display:flex;align-items:stretch;gap:2px}
.trow .item{flex:1;min-width:0}
.icon-mini{
  flex:none;width:36px;height:44px;border:0;background:transparent;color:var(--faint);cursor:pointer;
  border-radius:8px;display:grid;place-items:center;
}
.icon-mini svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.icon-mini:hover{background:var(--canvas);color:var(--text)}
.main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--paper);overflow:hidden}
.brand{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px 4px;font-size:14px;font-weight:600;flex-shrink:0}
.brand-id{display:flex;align-items:center;gap:8px;min-width:0}
.brand-actions{display:flex;gap:4px;flex:none}
.brand-actions button{
  min-height:36px;padding:6px 10px;border:0;background:var(--canvas);border-radius:8px;
  font:12px inherit;cursor:pointer;color:var(--text);
}
.list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 8px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--faint)}
.list-head button{min-height:36px;padding:6px 10px;border:0;background:var(--canvas);border-radius:8px;font:12px inherit;cursor:pointer;color:var(--text);letter-spacing:0;font-weight:500}
.hud.history .list{
  display:flex!important;position:absolute;inset:0;z-index:5;border-right:0;width:auto;background:var(--paper);
}
.meeting-desk{
  position:absolute;inset:0;z-index:7;margin:0;
  display:flex;flex-direction:column;background:var(--paper);color:var(--text);
}
.meeting-desk[hidden]{display:none!important;pointer-events:none!important}
.meeting-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:10px 12px 8px;border-bottom:1px solid var(--line);flex-shrink:0;
}
.meeting-head strong{font-size:14px;font-weight:600}
.meeting-back{
  min-height:32px;padding:4px 10px;border:0;background:transparent;border-radius:8px;
  font:12px inherit;cursor:pointer;color:var(--faint);
}
.meeting-back:hover{background:var(--canvas);color:var(--text)}
.meeting-back:focus-visible{outline:none;box-shadow:var(--focus)}
.meeting-status{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:8px 12px 0;font-size:12px;color:var(--faint);
}
.meeting-dot{width:8px;height:8px;border-radius:50%;background:#d4d4d4;flex:none}
.meeting-desk.recording .meeting-dot{
  background:#dc2626;box-shadow:0 0 0 0 rgba(220,38,38,.4);
  animation:recPulse 1.4s ease-out infinite;
}
@keyframes recPulse{
  0%{box-shadow:0 0 0 0 rgba(220,38,38,.4)}
  70%{box-shadow:0 0 0 8px rgba(220,38,38,0)}
  100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}
}
.meeting-live{
  flex:1;min-height:0;overflow:auto;margin:8px 12px 0;
  padding:10px 12px;background:var(--canvas);border-radius:12px;font-size:13px;line-height:1.5;
}
.meeting-live p{margin:0 0 8px}
.meeting-live .empty-live{
  color:var(--faint);font-size:12.5px;line-height:1.45;padding:22px 8px;text-align:center;
}
.meeting-partial{
  min-height:1.4em;font-size:13px;color:var(--indigo);padding:4px 16px 6px;font-style:italic;
  max-height:4.2em;overflow:auto;
}
.meeting-live .spk{display:inline;font-weight:600;color:var(--indigo);margin-right:4px}
.meeting-tools{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 12px 0;
}
.meeting-tools button,.meeting-tools select{
  min-height:28px;padding:3px 8px;border-radius:8px;border:0;cursor:pointer;font:11px inherit;
  background:var(--canvas);color:var(--text);
}
.meeting-tools button:focus-visible,.meeting-tools select:focus-visible{outline:none;box-shadow:var(--focus)}
.meeting-hist{
  position:absolute;left:12px;right:12px;top:72px;bottom:72px;z-index:8;
  background:var(--paper);border:1px solid var(--line);border-radius:12px;
  overflow:auto;padding:6px;box-shadow:var(--shadow);
}
.meeting-hist[hidden]{display:none!important}
.meeting-hist button{
  display:block;width:100%;text-align:left;border:0;background:transparent;
  padding:8px 10px;border-radius:8px;cursor:pointer;font:inherit;color:var(--text);
}
.meeting-hist button:hover,.meeting-hist button.active{background:var(--indigo-soft);color:var(--indigo)}
.meeting-hist button small{display:block;margin-top:2px;font-size:11px;color:var(--faint)}
.meeting-hist-empty{padding:18px 10px;text-align:center;color:var(--faint);font-size:12.5px}
.meeting-minutes{
  flex:0 1 36%;min-height:0;overflow:auto;margin:0 12px 8px;
  padding:8px 10px;background:var(--canvas);border-radius:12px;
}
.meeting-minutes[hidden]{display:none!important}
.meeting-actions{
  display:flex;flex-wrap:wrap;gap:8px;padding:8px 12px 12px;
  border-top:1px solid var(--line);
}
.meeting-actions button{
  min-height:36px;padding:6px 12px;border-radius:8px;border:0;cursor:pointer;font:inherit;
  background:var(--canvas);color:var(--text);
}
.meeting-actions button:focus-visible{outline:none;box-shadow:var(--focus)}
.meeting-actions button:disabled{opacity:.45;cursor:not-allowed}
#meetingRec{background:var(--indigo);color:#fff;font-weight:500;flex:1}
.meeting-desk.recording #meetingRec{background:#dc2626;color:#fff}
#meetingMinutesBtn{background:var(--indigo-soft);color:var(--indigo)}
.mark{
  width:52px;height:52px;border-radius:50%;background:#171717;color:#fff;
  display:grid;place-items:center;font-size:20px;font-weight:600;margin:0 auto 10px;
}
.mark.sm{width:26px;height:26px;font-size:11px;margin:0}
.log{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px 22px;display:flex;flex-direction:column;gap:16px}
.msg{max-width:36rem;font-size:14px;line-height:1.55;word-break:break-word}
.msg.user{align-self:flex-end;background:var(--canvas);padding:8px 12px;border-radius:12px 12px 4px 12px;white-space:pre-wrap}
.msg.assistant{align-self:flex-start;color:var(--text);white-space:normal}
.msg.assistant p{margin:0 0 8px}
.msg.assistant p:last-child{margin:0}
.msg.assistant h1,.msg.assistant h2,.msg.assistant h3{font-size:15px;font-weight:600;margin:10px 0 6px}
.msg.assistant ul,.msg.assistant ol{margin:6px 0 6px 1.2em}
.msg.assistant a{color:var(--indigo)}
.msg.assistant pre{background:var(--canvas);padding:8px 10px;border-radius:8px;overflow:auto;font-size:12.5px;line-height:1.45}
.msg.assistant code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.msg.assistant :not(pre)>code{background:var(--canvas);padding:1px 4px;border-radius:4px}
.msg.assistant blockquote{margin:6px 0;padding:0 0 0 10px;border-left:3px solid var(--line);color:var(--secondary)}
.empty{margin:auto;color:var(--secondary);font-size:14px;line-height:1.6;text-align:center;display:flex;flex-direction:column;align-items:center}
.empty strong{display:block;font-size:22px;font-weight:600;color:var(--text);margin-bottom:8px;letter-spacing:-.03em}
.composer{display:flex;flex-direction:column;gap:6px;padding:10px 12px 8px;background:var(--paper);flex-shrink:0;position:relative;z-index:2}
.composer-row{display:flex;align-items:center;gap:6px;min-width:0}
.icon-btn{
  width:44px;height:44px;border:0;background:transparent;border-radius:var(--radius-sm);
  cursor:pointer;color:var(--text);display:grid;place-items:center;flex:none;
}
.icon-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.icon-btn:hover{background:var(--canvas)}
.icon-btn:focus-visible{outline:none;box-shadow:var(--focus)}
.icon-btn:disabled{opacity:.35;cursor:not-allowed}
.field{
  flex:1;display:flex;align-items:flex-end;gap:4px;min-height:48px;padding:4px 8px 4px 14px;
  background:var(--canvas);border-radius:14px;min-width:0;overflow:hidden;
}
.field:focus-within{box-shadow:inset 0 0 0 1.5px rgba(79,70,229,.45);background:var(--paper)}
.field textarea{
  flex:1;min-width:0;width:100%;border:0;background:transparent;outline:none;resize:none;min-height:36px;max-height:120px;
  font:15px/1.35 inherit;color:var(--text);padding:8px 0;
}
.field .icon-btn{position:relative;z-index:1}
.field textarea::placeholder{color:#a3a3a3}
.ghosts{display:flex;gap:4px;padding:0 12px 4px}
.ghost{
  border:0;background:transparent;color:var(--faint);font:11px inherit;padding:6px 8px;border-radius:8px;cursor:pointer;min-height:32px;
}
.ghost:hover{background:var(--canvas);color:var(--text)}
.hint{display:none;padding:0 16px 10px;font-size:11px;color:var(--faint);line-height:1.4}
#chev{display:none}
#settings{display:none}
#newThreadBar{display:none}
.status:empty{display:none}
.status{margin:0 12px 8px;padding:8px 10px;font-size:12px;color:#92400e;background:#fffbeb;border-radius:8px}
.cta-box{
  margin:0 12px 8px;padding:10px 12px;border-radius:12px;
  background:#fffbeb;border:1px solid #fde68a;color:#92400e;
}
.cta-box[hidden]{display:none}
.cta-box p{font-size:12.5px;line-height:1.45}
.cta-actions{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.cta-actions button{
  min-height:36px;padding:6px 12px;border-radius:8px;border:0;cursor:pointer;font:inherit;
}
#attachSilent{background:var(--indigo);color:#fff}
#attachFront{background:var(--canvas);color:var(--text)}
#openConfirm{background:var(--indigo);color:#fff}
.cta-foot{font-size:11px;color:var(--faint)!important;line-height:1.4}
.privacy-sheet{
  position:absolute;inset:0;z-index:6;margin:0;padding:16px 18px 20px;
  overflow:auto;border-radius:0;
  background:#fffbeb;border:0;color:#92400e;
}
.privacy-sheet[hidden],.cta-box[hidden]{display:none!important;pointer-events:none!important}
.privacy-sheet[hidden]{display:none}
.privacy-sheet ol{margin:6px 0 8px;padding-left:1.3em;color:var(--text);font-size:12px;line-height:1.45}
.privacy-sheet .cta-actions button{background:var(--indigo);color:#fff}
.privacy-sheet p{font-size:12.5px;font-weight:600;color:var(--text)}
#meetingVoiceSection{margin-bottom:8px}
.capture-row{display:flex;gap:8px;padding:0 2px;flex-wrap:wrap;position:relative;z-index:1}
#meetingStart,#operateOpen{
  min-height:36px;padding:6px 12px;border-radius:8px;border:0;cursor:pointer;font:inherit;
  background:var(--canvas);color:var(--text);
}
#meetingStart[aria-pressed="true"]{background:var(--indigo-soft);color:var(--indigo)}
#mic[aria-pressed="true"]{background:var(--indigo-soft);color:var(--indigo)}
.hud:not(.expanded) .ghosts{display:none}
.hud.expanded .ghosts{display:none}
.hud.expanded .hint{display:none}
</style>
</head>
<body>
<div class="hud expanded" id="hud">
  <div class="body">
    <nav class="rail" id="secs" aria-label="组合面">
      <button class="rail-btn" data-sec="threads" aria-current="true" type="button" title="对话" aria-label="对话">
        <svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h10M5 17h7"/></svg>
      </button>
      <button class="rail-btn" data-sec="packs" type="button" title="场景" aria-label="场景" hidden>
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/></svg>
      </button>
      <button class="rail-btn" data-sec="knowledge" type="button" title="知识" aria-label="知识" hidden>
        <svg viewBox="0 0 24 24"><path d="M5 5.5h9.2A2.3 2.3 0 0 1 16.5 7.8V19H7.4A2.4 2.4 0 0 1 5 16.6V5.5z"/><path d="M16.5 8h1.4A2.1 2.1 0 0 1 20 10.1V19h-3.5"/></svg>
      </button>
      <button class="rail-btn" data-sec="skills" type="button" title="技能" aria-label="技能" hidden>
        <svg viewBox="0 0 24 24"><path d="M8 15.2 4.8 12 8 8.8M16 8.8 19.2 12 16 15.2M13.1 6.8 10.9 17.2"/></svg>
      </button>
      <button class="rail-btn" data-sec="mcp" type="button" title="MCP" aria-label="MCP" hidden>
        <svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1.2"/><path d="M12 4.6v3.2M12 16.2v3.2M4.6 12H8M16 12h3.4"/></svg>
      </button>
    </nav>
    <aside class="list">
      <div class="list-head"><span id="secHead">历史会话</span><button type="button" id="historyClose">完成</button></div>
      <div class="list-scroll">
        <button class="item" id="newThread" type="button"><strong>新对话</strong><small>快捷提问</small></button>
        <div id="threads"></div>
        <div id="composeList"></div>
      </div>
    </aside>
    <section class="main">
      <div class="brand">
        <span class="brand-id"><span class="mark sm" aria-hidden="true">山</span>CMspark</span>
        <span class="brand-actions">
          <button type="button" id="historyOpen">历史</button>
          <button type="button" id="newChat">新对话</button>
        </span>
      </div>
      <div class="log" id="log">
        <div class="empty" id="empty">
          <div class="mark" aria-hidden="true">山</div>
          <strong>${CHAT_SHELL_TITLE_NONE}</strong>
          回车发送。附件和听写不用开浏览器。
        </div>
      </div>
    </section>
  </div>
  <div class="composer">
    <div class="composer-row">
      <button class="icon-btn" id="newThreadBar" type="button" title="新对话" aria-label="新对话">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <label class="icon-btn" for="files" title="📎 添加附件" aria-label="添加附件">
        <svg viewBox="0 0 24 24"><path d="M8.2 12.8 14 7a2.8 2.8 0 0 1 4 4l-7.4 7.4a4 4 0 0 1-5.7-5.7l7.1-7.1"/></svg>
      </label>
      <input type="file" id="files" multiple hidden>
      <div class="field">
        <textarea id="text" rows="1" placeholder="问 CMspark…" aria-label="发送到当前对话"></textarea>
        <button class="icon-btn" id="mic" type="button" title="听写" aria-label="听写" aria-pressed="false">
          <svg viewBox="0 0 24 24"><rect x="9" y="4" width="6" height="10" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20"/></svg>
        </button>
        <button class="icon-btn" id="sendGo" type="button" title="发送" aria-label="发送">
          <svg viewBox="0 0 24 24"><path d="M5 12h12M13 6l6 6-6 6"/></svg>
        </button>
        <button class="icon-btn" id="chev" type="button" hidden aria-pressed="true" title="${SUMMONER_CHEVRON_COLLAPSE}" aria-label="${SUMMONER_CHEVRON_COLLAPSE}">
          <svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>
        </button>
        <button class="icon-btn" id="settings" type="button" hidden title="设置（快捷键等）" aria-label="设置">
          <svg viewBox="0 0 24 24"><path d="M12.2 2.2a.8.8 0 0 1 .8.8v2.6a.8.8 0 0 1-.8.8H11.8a.8.8 0 0 1-.8-.8V3a.8.8 0 0 1 .8-.8zm0 16a.8.8 0 0 1 .8.8v2.6a.8.8 0 0 1-.8.8H11.8a.8.8 0 0 1-.8-.8V19a.8.8 0 0 1 .8-.8zM19.1 7.4a.8.8 0 0 1 1.1 0l1.9 1.9a.8.8 0 0 1 0 1.1l-2.6 2.6a.8.8 0 0 1-1.1 0 .8.8 0 0 1 0-1.1l1.5-1.5-1.5-1.5a.8.8 0 0 1 0-1.1zM4.9 16.6a.8.8 0 0 1 0-1.1l2.6-2.6a.8.8 0 0 1 1.1 0 .8.8 0 0 1 0 1.1L7.1 15.5l1.5 1.5a.8.8 0 0 1 0 1.1l-1.9 1.9a.8.8 0 0 1-1.1 0zm0-9.2a.8.8 0 0 1 1.1 0l1.9 1.9a.8.8 0 0 1 0 1.1L7.3 13l2.6 2.6a.8.8 0 0 1-1.1 0l-1.9-1.9a.8.8 0 0 1 0-1.1l1.5-1.5-1.5-1.5a.8.8 0 0 1 0-1.1zm14.2 9.2a.8.8 0 0 1 0-1.1l-2.6-2.6a.8.8 0 0 1-1.1 0 .8.8 0 0 1 0 1.1l1.5 1.5-1.5 1.5a.8.8 0 0 1 0 1.1l1.9 1.9a.8.8 0 0 1 1.1 0z"/></svg>
        </button>
      </div>
    </div>
    <div class="capture-row">
      <button type="button" id="meetingStart" aria-pressed="false">开始会议</button>
      <button type="button" id="operateOpen">打开浏览器并打开侧栏</button>
    </div>
    <div class="cta-box" id="ctaBox" hidden>
      <p id="ctaCopy">${SUMMONER_L0_CHROME_DOWN}</p>
      <div class="cta-actions">
        <button type="button" id="attachSilent" title="${SUMMONER_ATTACH_PRIMARY}" aria-label="${SUMMONER_ATTACH_PRIMARY}">${SUMMONER_ATTACH_PRIMARY}</button>
        <button type="button" id="attachFront" title="${SUMMONER_ATTACH_SECONDARY}" aria-label="${SUMMONER_ATTACH_SECONDARY}">${SUMMONER_ATTACH_SECONDARY}</button>
        <button type="button" id="openConfirm" hidden title="${SUMMONER_OPEN_CONFIRM}" aria-label="${SUMMONER_OPEN_CONFIRM}">${SUMMONER_OPEN_CONFIRM}</button>
      </div>
      <p class="cta-foot">${SUMMONER_ATTACH_FOOTNOTE}</p>
    </div>
    <div class="privacy-sheet" id="voicePrivacy" hidden>
      <p>本机听写</p>
      <ol>
        ${VOICE_PRIVACY_ACK_V2_CLAUSES.map((c) => `<li>${escHtml(c)}</li>`).join("\n        ")}
      </ol>
      <div class="cta-actions">
        <button type="button" id="voicePrivacyAck">我已了解</button>
      </div>
    </div>
    <div class="privacy-sheet" id="meetingPrivacy" hidden>
      <div id="meetingVoiceSection">
        <p>本机听写</p>
        <ol>
          ${VOICE_PRIVACY_ACK_V2_CLAUSES.map((c) => `<li>${escHtml(c)}</li>`).join("\n          ")}
        </ol>
      </div>
      <p>会议隐私说明</p>
      <ol>
        ${MEETING_PRIVACY_ACK_V1_CLAUSES.map((c) => `<li>${escHtml(c)}</li>`).join("\n        ")}
      </ol>
      <div class="cta-actions">
        <button type="button" id="meetingPrivacyAck">我已了解</button>
      </div>
    </div>
  </div>
  <div class="ghosts">
    <button class="ghost" id="send" type="button">发送</button>
    <button class="ghost" id="steer" type="button">纠偏</button>
    <button class="ghost" id="queue" type="button">排队</button>
    <button class="ghost" id="stop" type="button">停止</button>
  </div>
  <div class="hint" id="hint">回车发送 · Shift+Enter 排队 · 点击右上角 ⋮ 设置快捷键</div>
  <div class="status" id="status"></div>
  <div class="meeting-desk" id="meetingDesk" hidden>
    <div class="meeting-head">
      <strong>会议</strong>
      <button type="button" class="meeting-back" id="meetingBack">返回对话</button>
    </div>
    <div class="meeting-status">
      <span class="meeting-dot" aria-hidden="true"></span>
      <span id="meetingHint">未录制</span>
      <span id="meetingVoiceMeta"></span>
    </div>
    <div class="meeting-tools">
      <button type="button" id="meetingHistToggle" aria-pressed="false">历史会议</button>
      <label>角色 <select id="meetingK" aria-label="发言人数量"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
      <button type="button" id="meetingDiarize" title="本机声学聚类，匿名发言人N，不是身份识别">自动标说话人</button>
    </div>
    <div class="meeting-hist" id="meetingHistList" hidden></div>
    <div class="meeting-live" id="meetingLive">
      <div class="empty-live" id="meetingEmpty">点「开始录制」后约 8 秒出字。语音识别用侧栏听写设置。说话人是匿名「发言人N」，不是认人。</div>
    </div>
    <div class="meeting-partial" id="meetingPartial"></div>
    <div class="meeting-minutes" id="meetingMinutes" hidden></div>
    <div class="meeting-actions">
      <button type="button" id="meetingRec" aria-pressed="false">开始录制</button>
      <button type="button" id="meetingMinutesBtn" hidden>生成会议纪要</button>
    </div>
  </div>
</div>
<script>
try{
(function(){
  var token=(location.search.match(/[?&]token=([^&]+)/)||[])[1]||"";
  var wanted=(location.search.match(/[?&]thread=([^&]+)/)||[])[1]||"";
  try{if(wanted) wanted=decodeURIComponent(wanted)}catch(e){}
  function url(path){return path+(path.indexOf("?")>=0?"&":"?")+"token="+encodeURIComponent(token)}
  var threadId="";
  var threadReady=null;
  var sendShortcut="Enter";
  api("/api/send-shortcut").then(function(d){
    var s=d&&d.send_shortcut;
    if(s==="Enter"||s==="Cmd+Enter"||s==="Ctrl+Enter") sendShortcut=s;
  }).catch(function(){});
  var voiceSettings={sttEngine:"browser",localModelId:"medium",lang:"zh-CN"};
  function paintMeetingVoiceMeta(){
    var el=$("meetingVoiceMeta");
    if(!el) return;
    var engine=voiceSettings.sttEngine==="local"?"本机":"浏览器";
    el.textContent=engine+" · "+voiceSettings.localModelId;
  }
  function loadVoiceSettings(){
    return api("/api/voice-settings").then(function(d){
      if(!d||typeof d!=="object") return;
      if(d.sttEngine==="browser"||d.sttEngine==="local") voiceSettings.sttEngine=d.sttEngine;
      if(d.localModelId==="small"||d.localModelId==="medium"||d.localModelId==="large-v3-turbo") voiceSettings.localModelId=d.localModelId;
      if(typeof d.lang==="string"&&d.lang) voiceSettings.lang=d.lang;
      paintMeetingVoiceMeta();
    }).catch(function(){});
  }
  loadVoiceSettings();
  var busy=false;
  var threads=[];
  var poll=null;
  function $(id){return document.getElementById(id)}
  function setStatus(t){$("status").textContent=t||""}
  var CHROME_DOWN={
    l0:${JSON.stringify(SUMMONER_L0_CHROME_DOWN)},
    cdp:${JSON.stringify(SUMMONER_CDP_NEEDED)},
    renter:${JSON.stringify(SUMMONER_RENTER_CHROME_DOWN)}
  };
  function showChromeCta(kind){
    var box=$("ctaBox"); if(!box) return;
    box.hidden=false;
    $("ctaCopy").textContent=kind==="renter"?CHROME_DOWN.renter:kind==="cdp"?CHROME_DOWN.cdp:CHROME_DOWN.l0;
    $("attachSilent").hidden=false;
    $("attachFront").hidden=false;
    $("openConfirm").hidden=true;
  }
  function showConfirmCta(){
    var box=$("ctaBox"); if(!box) return;
    box.hidden=false;
    $("ctaCopy").textContent=${JSON.stringify(SUMMONER_CONFIRM_NEED)};
    $("attachSilent").hidden=true;
    $("attachFront").hidden=true;
    $("openConfirm").hidden=false;
  }
  function hideChromeCta(){ var box=$("ctaBox"); if(box) box.hidden=true; }
  function attachChrome(foreground){
    api("/api/attach",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({foreground:!!foreground})}).then(function(d){
      setStatus(d&&(d.message||d.error)||"");
    });
  }
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return c==="&"?"&amp;":c==="<"?"&lt;":"&gt;"})}
  ${OVERLAY_RENDER_MD_JS}
  function placeWindow(){
    var w=${OVERLAY_WINDOW_SIZE.w},h=${OVERLAY_WINDOW_SIZE.h};
    var sw=screen.availWidth||screen.width||w;
    var sh=screen.availHeight||screen.height||h;
    var x=Math.max(0, ((sw-w)/2)|0);
    var y=Math.max(0, ((sh-h)/2)|0);
    try{window.resizeTo(w,h);window.moveTo(x,y)}catch(e){}
  }
  function setExpanded(on){
    $("hud").classList.add("expanded");
    placeWindow();
  }
  function api(path, opts){
    return fetch(url(path), opts).then(function(r){return r.json().catch(function(){return {error:r.statusText}})})
  }
  var voiceAck=false;
  var meetingAck=false;
  var meetingId="";
  var lastMeetingId="";
  var sttLive=false;
  var sttSid="";
  var sttSeq=0;
  var sttBuf=new Uint8Array(0);
  var sttFloat=new Float32Array(0);
  var sttStream=null;
  var sttCtx=null;
  var sttSrc=null;
  var sttProc=null;
  var sttMute=null;
  var sttTimer=null;
  var sttPartialTimer=null;
  var sttFeatsBySid={};
  var meetingFeats=[];
  var meetingLines=[];
  var STT_RATE=16000;
  var STT_FLUSH=32000;
  var STT_CHUNK=256*1024;
  var STT_DICTATION_MS=45000;
  var STT_MEETING_MS=8000;
  var STT_MIC_FAIL="请在系统设置中打开 127.0.0.1 的麦克风";
  var STT_NEED_MODEL="侧栏 ⋯ → 设置 → 听写 → 下载组件/模型";
  function sttUserCopy(code, fallback){
    var c=String(code||"").toLowerCase();
    if(c.indexOf("model")>=0 || c.indexOf("binary")>=0 || c.indexOf("engine")>=0) return STT_NEED_MODEL;
    return fallback || "听写失败";
  }
  function uint8ToB64(u8){
    var binary="";
    var step=0x8000;
    for(var i=0;i<u8.length;i+=step){
      binary+=String.fromCharCode.apply(null, Array.prototype.slice.call(u8.subarray(i, Math.min(i+step, u8.length))));
    }
    return btoa(binary);
  }
  function concatU8(a,b){
    var o=new Uint8Array(a.length+b.length);
    o.set(a,0); o.set(b,a.length); return o;
  }
  function concatF32(a,b){
    var o=new Float32Array(a.length+b.length);
    o.set(a,0); o.set(b,a.length); return o;
  }
  function extractFeat(samples){
    var n=samples.length;
    if(!n) return [0,0,0];
    var energy=0,zc=0,prev=samples[0]||0,diffSum=0;
    for(var i=0;i<n;i++){
      var x=samples[i]||0;
      energy+=x*x;
      if(i>0){
        if((prev>=0&&x<0)||(prev<0&&x>=0)) zc++;
        diffSum+=Math.abs(x-prev);
      }
      prev=x;
    }
    return [Math.log1p(energy/n), zc/n, Math.min(1, diffSum/(n*0.5+1e-9))];
  }
  function floatToS16(input){
    var out=new Uint8Array(input.length*2);
    var view=new DataView(out.buffer);
    for(var i=0;i<input.length;i++){
      var s=input[i];
      if(s>1)s=1; else if(s<-1)s=-1;
      view.setInt16(i*2, s<0?Math.round(s*0x8000):Math.round(s*0x7fff), true);
    }
    return out;
  }
  function resampleMono(input, fromRate, toRate){
    if(fromRate===toRate || !input.length) return input;
    var outLen=Math.max(1, Math.round((input.length*toRate)/fromRate));
    var out=new Float32Array(outLen);
    var ratio=fromRate/toRate;
    for(var i=0;i<outLen;i++){
      var src=i*ratio;
      var i0=Math.floor(src);
      var i1=Math.min(i0+1, input.length-1);
      var t=src-i0;
      out[i]=input[i0]*(1-t)+input[i1]*t;
    }
    return out;
  }
  function teardownStt(){
    sttLive=false;
    if(sttTimer){clearTimeout(sttTimer);sttTimer=null}
    if(sttPartialTimer){clearTimeout(sttPartialTimer);sttPartialTimer=null}
    try{ if(sttProc){sttProc.onaudioprocess=null;sttProc.disconnect()} }catch(e){}
    try{ if(sttMute) sttMute.disconnect(); }catch(e){}
    try{ if(sttSrc) sttSrc.disconnect(); }catch(e){}
    try{ if(sttStream) sttStream.getTracks().forEach(function(t){t.stop()}); }catch(e){}
    try{ if(sttCtx) sttCtx.close(); }catch(e){}
    sttProc=sttMute=sttSrc=sttStream=sttCtx=null;
    sttBuf=new Uint8Array(0);
    sttFloat=new Float32Array(0);
    var mic=$("mic");
    if(mic) mic.setAttribute("aria-pressed","false");
  }
  function flushStt(force){
    if(!sttSid) return;
    var min=force?1:STT_FLUSH;
    while(sttBuf.length>=min){
      var n=Math.min(STT_CHUNK, sttBuf.length);
      if(!force && n<STT_FLUSH) break;
      var slice=sttBuf.subarray(0,n);
      api("/api/stt/chunk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sttSid,seq:sttSeq,data:uint8ToB64(slice)})});
      sttSeq+=1;
      sttBuf=n===sttBuf.length?new Uint8Array(0):new Uint8Array(sttBuf.subarray(n));
    }
  }
  function stopStt(abort){
    var sid=sttSid;
    if(abort){
      teardownStt();
      sttSid="";
      sttSeq=0;
      if(sid) api("/api/stt/abort",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sid})});
      return;
    }
    flushStt(true);
    if(sid) sttFeatsBySid[sid]=extractFeat(sttFloat);
    var total=sttSeq;
    teardownStt();
    sttSid="";
    sttSeq=0;
    if(sid) api("/api/stt/end",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sid,totalSeq:total})});
  }
  function beginPcm(sid, stream){
    var AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){ setStatus(STT_MIC_FAIL); stopStt(true); return; }
    var ctx=new AC();
    sttCtx=ctx;
    var go=function(){
      if(!sttLive || sttSid!==sid){ teardownStt(); return; }
      if(typeof ctx.createScriptProcessor!=="function"){ setStatus("无法捕获麦克风音频"); stopStt(true); return; }
      var src=ctx.createMediaStreamSource(stream);
      sttSrc=src;
      var proc=ctx.createScriptProcessor(4096,1,1);
      sttProc=proc;
      var mute=ctx.createGain();
      mute.gain.value=0;
      sttMute=mute;
      proc.onaudioprocess=function(ev){
        if(!sttLive || sttSid!==sid) return;
        var ch=ev.inputBuffer.getChannelData(0);
        if(!ch||!ch.length) return;
        var copy=new Float32Array(ch.length);
        copy.set(ch);
        var rate=ctx.sampleRate||48000;
        var mono=rate===STT_RATE?copy:resampleMono(copy,rate,STT_RATE);
        if(!mono.length) return;
        sttFloat=concatF32(sttFloat, mono);
        sttBuf=concatU8(sttBuf, floatToS16(mono));
        if(sttBuf.length>=STT_FLUSH) flushStt(false);
      };
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      var windowMs=meetingId?STT_MEETING_MS:STT_DICTATION_MS;
      sttTimer=setTimeout(function(){
        if(!sttLive || sttSid!==sid) return;
        stopStt(false);
      }, windowMs);
      if(meetingId){
        var poll=function(){
          if(!sttLive || sttSid!==sid) return;
          api("/api/stt/partial",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sid})});
          sttPartialTimer=setTimeout(poll,1400);
        };
        sttPartialTimer=setTimeout(poll,1400);
      }
    };
    if(ctx.state==="suspended") ctx.resume().then(go).catch(go);
    else go();
  }
  function startStt(){
    if(sttLive){ stopStt(false); return; }
    if(!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia!=="function"){
      setStatus(STT_MIC_FAIL);
      return;
    }
    var sid="ov-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
    sttSid=sid;
    sttSeq=0;
    sttBuf=new Uint8Array(0);
    sttFloat=new Float32Array(0);
    sttLive=true;
    $("mic").setAttribute("aria-pressed","true");
    navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}}).then(function(stream){
      if(!sttLive || sttSid!==sid){ stream.getTracks().forEach(function(t){t.stop()}); return; }
      sttStream=stream;
      var sttLang=(voiceSettings.lang||"zh-CN").indexOf("zh")===0?"zh":(voiceSettings.lang||"zh");
      var sttModel=voiceSettings.localModelId||"medium";
      var sttMax=meetingId?STT_MEETING_MS:STT_DICTATION_MS;
      return api("/api/stt/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sid,modelId:sttModel,privacy_ack_v2:true,lang:sttLang,maxMs:sttMax})}).then(function(d){
        if(!sttLive || sttSid!==sid){ teardownStt(); return; }
        if(d && (d.type==="voice.stt.error" || d.type==="error" || d.error)){
          setStatus(sttUserCopy(d.code||d.error_code, d.error||d.message));
          stopStt(true);
          return;
        }
        beginPcm(sid, stream);
      });
    }).catch(function(){
      sttLive=false;
      sttSid="";
      $("mic").setAttribute("aria-pressed","false");
      setStatus(STT_MIC_FAIL);
    });
  }
  function renderThreads(filter){
    var q=(filter||"").trim();
    var box=$("threads");
    box.innerHTML="";
    threads.forEach(function(t){
      var title=(t.title||t.alias||t.id||"").trim()||t.id;
      if(q && title.indexOf(q)<0 && String(t.alias||"").indexOf(q)<0) return;
      var row=document.createElement("div");
      row.className="trow";
      var b=document.createElement("button");
      b.className="item"+(t.id===threadId?" active":"");
      b.innerHTML="<strong>"+esc(title)+"</strong>";
      b.onclick=function(){selectThread(t.id)};
      var rn=document.createElement("button");
      rn.className="icon-mini";
      rn.title="重命名";
      rn.setAttribute("aria-label","重命名");
      rn.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4z"/></svg>';
      rn.onclick=function(ev){
        ev.stopPropagation();
        var alias=window.prompt("重命名", title);
        if(!alias||!String(alias).trim()) return;
        api("/api/thread?id="+encodeURIComponent(t.id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({alias:String(alias).trim()})}).then(function(d){
          if(d&&(d.error||d.type==="error")){setStatus(d.error||"无法重命名");return}
          return refresh();
        });
      };
      var tr=document.createElement("button");
      tr.className="icon-mini";
      tr.title="移到回收站";
      tr.setAttribute("aria-label","移到回收站");
      tr.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>';
      tr.onclick=function(ev){
        ev.stopPropagation();
        if(!window.confirm("把「"+title+"」移到回收站？")) return;
        api("/api/thread?id="+encodeURIComponent(t.id),{method:"DELETE"}).then(function(d){
          if(d&&(d.error||d.type==="error")){setStatus(d.error||"无法移到回收站");return}
          var gone=threadId===t.id;
          return refresh().then(function(){
            if(!gone) return;
            if(threads[0]) return selectThread(threads[0].id);
            $("newThread").click();
          });
        });
      };
      row.appendChild(b);
      row.appendChild(rn);
      row.appendChild(tr);
      box.appendChild(row);
    });
  }
  function renderMsgs(messages){
    var log=$("log");
    log.innerHTML="";
    var n=0;
    (messages||[]).forEach(function(m){
      if(!m||(m.role!=="user"&&m.role!=="assistant")) return;
      n++;
      var d=document.createElement("div");
      d.className="msg "+m.role;
      var text=typeof m.content==="string"?m.content:(m.content&&m.content[0]&&m.content[0].text)||"";
      if(m.role==="assistant") d.innerHTML=renderMd(text);
      else d.textContent=text;
      log.appendChild(d);
    });
    if(!n){
      var empty=document.createElement("div");
      empty.className="empty";
      empty.innerHTML="<div class=\\"mark\\" aria-hidden=\\"true\\">山</div><strong>${CHAT_SHELL_TITLE_NONE}</strong>回车发送。附件和听写不用开浏览器。";
      log.appendChild(empty);
    }
    log.scrollTop=log.scrollHeight;
  }
  function syncBusyUi(){
    $("hint").textContent=busy
      ?"回车纠偏 · Shift+Enter 排队 · 忙时附件请等本轮结束 · 点击右上角 ⋮ 设置快捷键"
      :"回车发送 · Shift+Enter 排队 · # 搜标题 · 点击右上角 ⋮ 设置快捷键";
  }
  function selectThread(id){
    threadId=id;
    showHistory(false);
    renderThreads($("text").value.charAt(0)==="#"?$("text").value.slice(1):"");
    return api("/api/lease",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:id})})
      .then(function(d){
        if(d && (d.error || d.error_code || (d.data&&d.data.error_code) || d.type==="error" || d.type==="chat.error" || d.type==="composer.lease.error")){
          setStatus(statusFromEvent(d));
        }
        return api("/api/thread?id="+encodeURIComponent(id));
      })
      .then(function(d){
        renderMsgs(d.messages||[]);
        busy=d.run_status==="llm";
        syncBusyUi();
        if(busy) startPoll(); else stopPoll();
      });
  }
  function startPoll(){
    if(poll) return;
    poll=setInterval(function(){
      if(!threadId) return;
      api("/api/thread?id="+encodeURIComponent(threadId)).then(function(d){
        renderMsgs(d.messages||[]);
        var next=d.run_status==="llm";
        if(next!==busy){busy=next;syncBusyUi()}
        if(!busy) stopPoll();
      });
    },1200);
  }
  function stopPoll(){if(poll){clearInterval(poll);poll=null}}
  function filesToPayload(list){
    var arr=[].slice.call(list||[]);
    return Promise.all(arr.map(function(f){
      return new Promise(function(resolve,reject){
        var r=new FileReader();
        r.onload=function(){
          var s=String(r.result||"");
          var i=s.indexOf(",");
          resolve({name:f.name,type:f.type||"application/octet-stream",content:i>=0?s.slice(i+1):s});
        };
        r.onerror=reject;
        r.readAsDataURL(f);
      });
    }));
  }
  function createThread(){
    return api("/api/threads",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(d){
      var id=d.thread&&d.thread.id;
      if(!id) return Promise.reject(new Error("没有当前对话"));
      return refresh().then(function(){ return selectThread(id); }).then(function(){ return id; });
    });
  }
  function ensureThread(){
    if(threadId) return Promise.resolve(threadId);
    var wait=threadReady||Promise.resolve();
    return wait.then(function(){
      if(threadId) return threadId;
      return createThread();
    });
  }
  function paintUser(text){
    var empty=$("empty");
    if(empty&&empty.parentNode) empty.parentNode.removeChild(empty);
    var d=document.createElement("div");
    d.className="msg user";
    d.textContent=text;
    $("log").appendChild(d);
    $("log").scrollTop=$("log").scrollHeight;
  }
  function send(mode){
    var text=$("text").value;
    if(text.trim().charAt(0)==="#"){
      renderThreads(text.trim().slice(1));
      return;
    }
    var fileEl=$("files");
    var hasFiles=fileEl.files&&fileEl.files.length;
    if(!text.trim() && !hasFiles) return;
    setStatus("发送中…");
    ensureThread().then(function(){
      if(!threadId){setStatus("没有当前对话");return}
      if(hasFiles && (busy || mode==="steer" || mode==="enqueue")){
        setStatus("忙时不能上传附件（run_active）");
        return;
      }
      if(text.trim()) paintUser(text.trim());
      $("text").value="";
      return api("/api/lease",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId})}).then(function(){
        var go=hasFiles
          ? filesToPayload(fileEl.files).then(function(files){
              return api("/api/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,files:files,message:text})});
            })
          : api("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,message:text,mode:mode|| (busy?"steer":"create")})});
        return go;
      });
    }).then(function(d){
      if(!d) return;
      if(d.error||d.type==="error"){setStatus(d.error||"发送失败");return}
      setStatus("已提交");
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  $("send").onclick=function(){send(busy?"steer":"create")};
  $("sendGo").onclick=function(){send(busy?"steer":"create")};
  $("steer").onclick=function(){send("steer")};
  $("queue").onclick=function(){send("enqueue")};
  $("stop").onclick=function(){
    if(!threadId) return;
    api("/api/abort",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId})});
  };
  $("chev").onclick=function(){ setExpanded(true); };
  $("attachSilent").onclick=function(){attachChrome(false)};
  $("attachFront").onclick=function(){attachChrome(true)};
  $("openConfirm").onclick=function(){attachChrome(true)};
  $("settings").onclick=function(){
    alert("快捷键设置需要在 Chrome 侧栏的设置面板中配置。\\n\\n请打开 Chrome 侧栏，点击设置图标，在「模型与推理」部分找到「发送快捷键」设置。\\n\\n召唤器使用相同的快捷键配置。");
  };
  $("mic").onclick=function(){
    if(sttLive){ stopStt(false); return; }
    if(!voiceAck){
      var sheet=$("voicePrivacy");
      if(sheet) sheet.hidden=false;
      return;
    }
    startStt();
  };
  $("voicePrivacyAck").onclick=function(){
    voiceAck=true;
    var sheet=$("voicePrivacy");
    if(sheet) sheet.hidden=true;
    startStt();
  };
  function setMeetingUi(on){
    var b=$("meetingStart");
    if(!b) return;
    b.textContent=on?"会议中":"开始会议";
    b.setAttribute("aria-pressed", on?"true":"false");
  }
  var recStartedAt=0;
  var recTimer=null;
  function fmtElapsed(ms){
    var s=Math.floor(ms/1000);
    if(s<0) s=0;
    var m=Math.floor(s/60);
    s=s%60;
    return (m<10?"0":"")+m+":"+(s<10?"0":"")+s;
  }
  function stopRecClock(){
    if(recTimer){ clearInterval(recTimer); recTimer=null; }
    recStartedAt=0;
  }
  function startRecClock(){
    stopRecClock();
    recStartedAt=Date.now();
    recTimer=setInterval(function(){
      var hint=$("meetingHint");
      if(hint && meetingId) hint.textContent="录制中 "+fmtElapsed(Date.now()-recStartedAt);
    },250);
  }
  function setRecordingUi(on){
    var desk=$("meetingDesk");
    var rec=$("meetingRec");
    var mins=$("meetingMinutesBtn");
    if(desk){
      if(on) desk.classList.add("recording");
      else desk.classList.remove("recording");
    }
    if(rec){
      rec.textContent=on?"结束录制":"开始录制";
      rec.setAttribute("aria-pressed", on?"true":"false");
      rec.disabled=false;
    }
    if(mins){
      if(on || lastMeetingId){
        mins.hidden=false;
        mins.textContent=on?"结束并生成纪要":"生成会议纪要";
      } else {
        mins.hidden=true;
      }
    }
    setMeetingUi(!!meetingId || on);
  }
  function showMeetingDesk(on){
    var d=$("meetingDesk");
    if(!d) return;
    if(on){
      d.hidden=false;
      d.removeAttribute("hidden");
      d.style.display="flex";
      paintMeetingVoiceMeta();
      var hint=$("meetingHint");
      if(hint && !meetingId) hint.textContent="未录制";
      var empty=$("meetingEmpty");
      var live=$("meetingLive");
      if(empty && live && !live.querySelector("p")) empty.hidden=false;
      loadMeetingHistory();
    } else {
      d.hidden=true;
      d.style.display="none";
      showMeetingHistory(false);
    }
  }
  function diarizeK(){
    var sel=$("meetingK");
    var n=sel?parseInt(sel.value,10):2;
    if(n!==3 && n!==4) n=2;
    return n;
  }
  function showMeetingHistory(on){
    var list=$("meetingHistList");
    var btn=$("meetingHistToggle");
    if(!list) return;
    if(on){
      list.hidden=false;
      if(btn) btn.setAttribute("aria-pressed","true");
      loadMeetingHistory();
    } else {
      list.hidden=true;
      if(btn) btn.setAttribute("aria-pressed","false");
    }
  }
  function fmtMeetingWhen(iso){
    var s=String(iso||"");
    if(s.length>=16) return s.slice(0,16).replace("T"," ");
    return s||"";
  }
  function loadMeetingHistory(){
    var list=$("meetingHistList");
    if(!list) return;
    api("/api/meetings").then(function(d){
      var items=(d&&d.meetings)||[];
      list.innerHTML="";
      if(!items.length){
        list.innerHTML="<div class=\\"empty-live meeting-hist-empty\\">还没有历史会议</div>";
        return;
      }
      items.forEach(function(m){
        if(!m||!m.id) return;
        var b=document.createElement("button");
        b.type="button";
        if(m.id===(meetingId||lastMeetingId)) b.className="active";
        var title=(m.title||"会议").trim()||"会议";
        var when=fmtMeetingWhen(m.started_at);
        var st=m.status||"";
        b.innerHTML="<strong>"+esc(title)+"</strong><small>"+esc(when+(st?" · "+st:""))+"</small>";
        b.onclick=function(){ openPastMeeting(m.id); };
        list.appendChild(b);
      });
    }).catch(function(){});
  }
  function paintTranscript(lines){
    var box=$("meetingLive");
    if(!box) return;
    box.innerHTML="";
    meetingLines=[];
    if(!lines||!lines.length){
      box.innerHTML="<div class=\\"empty-live\\" id=\\"meetingEmpty\\">点「开始录制」后约 8 秒出字。语音识别用侧栏听写设置。说话人是匿名「发言人N」，不是认人。</div>";
      return;
    }
    lines.forEach(function(l){
      var text=typeof l==="string"?l:(l&&l.text)||"";
      var sp=l&&typeof l.speaker==="string"?l.speaker:"";
      if(text) appendMeetingLive(text, sp);
    });
  }
  function openPastMeeting(id){
    if(meetingId) endMeetingCapture();
    api("/api/meeting?id="+encodeURIComponent(id)).then(function(d){
      var m=d&&d.meeting;
      if(!m||!m.id){ setStatus("打不开这场会议"); return; }
      lastMeetingId=m.id;
      meetingId="";
      meetingFeats=[];
      showMeetingHistory(false);
      paintTranscript(m.transcript||[]);
      var mins=$("meetingMinutes");
      var md=m.minutes&&(m.minutes.raw_md||m.minutes.md);
      if(mins){
        if(md){ mins.hidden=false; mins.innerHTML=renderMd(md); }
        else { mins.hidden=true; mins.innerHTML=""; }
      }
      var hint=$("meetingHint");
      if(hint) hint.textContent=(m.title||"会议")+" · "+(m.status||"历史");
      setRecordingUi(false);
      setStatus("");
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  function paintDiarized(d){
    var m=d&&d.meeting;
    if(!m||!Array.isArray(m.transcript)) return;
    paintTranscript(m.transcript);
    var method=d.diarize&&d.diarize.method||m.diarize&&m.diarize.method;
    setStatus(method==="text_gap"?"已弱标说话人（按行交替 · 非声学）":"已标匿名发言人（实验 · 非身份识别）");
  }
  function runDiarize(mode){
    var id=meetingId||lastMeetingId;
    if(!id){ setStatus("没有会议"); return; }
    var payload={id:id,k:diarizeK(),privacy_ack_v1:true,mode:mode==="text_gap"?"text_gap":"audio_cluster"};
    if(payload.mode==="audio_cluster"){
      if(meetingFeats.length<2 || meetingFeats.length!==meetingLines.length){
        payload.mode="text_gap";
        setStatus("没有对齐的声学特征，改用弱标（交替）");
      } else {
        payload.features=meetingFeats;
      }
    }
    api("/api/meeting/diarize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(function(d){
      if(d && (d.type==="meeting.error" || d.type==="error" || d.error)){
        setStatus(d.message||d.error||"分角色失败");
        return;
      }
      paintDiarized(d);
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  var diarizeTimer=null;
  function maybeDiarizeLive(){
    if(!meetingId) return;
    if(meetingFeats.length<2) return;
    if(meetingFeats.length!==meetingLines.length) return;
    if(diarizeTimer) clearTimeout(diarizeTimer);
    diarizeTimer=setTimeout(function(){ runDiarize("audio_cluster"); },700);
  }
  function appendMeetingLive(text, speaker){
    var box=$("meetingLive");
    if(!box||!text) return;
    var empty=$("meetingEmpty");
    if(empty) empty.hidden=true;
    var p=document.createElement("p");
    if(speaker){
      p.innerHTML="<span class=\\"spk\\">"+esc(speaker)+"</span> "+esc(text);
    } else {
      p.textContent=text;
    }
    box.appendChild(p);
    box.scrollTop=box.scrollHeight;
    meetingLines.push({text:text,speaker:speaker||""});
  }
  function startMeetingCapture(){
    if(meetingId) return;
    var rec=$("meetingRec");
    if(rec) rec.disabled=true;
    loadVoiceSettings().then(function(){
    if(voiceSettings.sttEngine!=="local"){
      var need=STT_NEED_MODEL;
      setStatus(need);
      var h0=$("meetingHint");
      if(h0) h0.textContent="请在侧栏设置启用本机转写";
      if(rec) rec.disabled=false;
      return;
    }
    meetingFeats=[];
    meetingLines=[];
    sttFeatsBySid={};
    showMeetingHistory(false);
    var part=$("meetingPartial");
    if(part) part.textContent="";
    var mins=$("meetingMinutes");
    if(mins){ mins.hidden=true; mins.innerHTML=""; }
    var live=$("meetingLive");
    if(live) live.innerHTML="<div class=\\"empty-live\\" id=\\"meetingEmpty\\">正在听…约 8 秒出第一段字。</div>";
    showMeetingDesk(true);
    var hint=$("meetingHint");
    if(hint) hint.textContent="正在开始…";
    var payload={};
    if(threadId) payload.thread_id=threadId;
    return api("/api/meeting/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(function(d){
      if(d && (d.type==="meeting.error" || d.type==="error" || d.error)){
        var msg=sttUserCopy(d.code||d.error_code, d.message||d.error||"会议开始失败");
        setStatus(msg);
        if(hint) hint.textContent=msg;
        if(rec) rec.disabled=false;
        return;
      }
      var mid=(d&&d.meeting&&d.meeting.id)||(d&&d.data&&d.data.meeting&&d.data.meeting.id)||"";
      if(typeof mid!=="string" || mid.indexOf("tray-")===0 || mid.indexOf("mtg_")!==0) mid="";
      meetingId=mid;
      if(!meetingId){
        var fail="会议开始失败";
        setStatus(fail);
        if(hint) hint.textContent=fail;
        if(rec) rec.disabled=false;
        return;
      }
      lastMeetingId=meetingId;
      setRecordingUi(true);
      if(hint) hint.textContent="录制中 00:00";
      startRecClock();
      if(!sttLive) startStt();
    }).catch(function(e){
      var msg=String(e&&e.message||e);
      setStatus(msg);
      if(hint) hint.textContent=msg;
      if(rec) rec.disabled=false;
    });
    }).catch(function(e){
      var rec2=$("meetingRec");
      if(rec2) rec2.disabled=false;
      setStatus(String(e&&e.message||e));
    });
  }
  function endMeetingCapture(){
    var id=meetingId;
    meetingId="";
    stopRecClock();
    setRecordingUi(false);
    if(sttLive) stopStt(false);
    var hint=$("meetingHint");
    if(hint) hint.textContent=id?"已结束 · 可生成纪要":"未录制";
    var part=$("meetingPartial");
    if(part) part.textContent="";
    if(!id){ setStatus("未在录制"); return; }
    lastMeetingId=id;
    api("/api/meeting/end",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})}).then(function(d){
      if(d && (d.type==="meeting.error" || d.type==="error" || d.error)){
        setStatus(d.message||d.error||"结束录制失败");
        return;
      }
      setStatus("录制已结束");
      if(meetingFeats.length>=2 && meetingFeats.length===meetingLines.length){
        runDiarize("audio_cluster");
      }
      loadMeetingHistory();
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  function requestMeetingMinutes(){
    var id=meetingId||lastMeetingId;
    if(!id){ setStatus("请先录制"); return; }
    if(meetingId) endMeetingCapture();
    setStatus("正在生成纪要…");
    var hint=$("meetingHint");
    if(hint) hint.textContent="正在生成纪要…";
    api("/api/meeting/minutes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})}).then(function(d){
      if(d && (d.type==="meeting.error" || d.type==="error" || d.error)){
        setStatus(d.message||d.error||"纪要生成失败");
        return;
      }
      var md=(d&&d.minutes&&(d.minutes.raw_md||d.minutes.md))||(d&&d.raw_md)||"";
      if(!md && d&&d.minutes&&typeof d.minutes==="string") md=d.minutes;
      var box=$("meetingMinutes");
      if(box && md){
        box.hidden=false;
        box.innerHTML=renderMd(md);
      }
      setStatus(md?"纪要已生成":"纪要已提交");
      if(hint) hint.textContent=md?"纪要":"纪要已提交";
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  $("meetingStart").onclick=function(){
    if(!meetingAck){
      var sheet=$("meetingPrivacy");
      var vsec=$("meetingVoiceSection");
      if(!voiceAck){
        if(vsec) vsec.hidden=false;
      } else if(vsec) vsec.hidden=true;
      if(sheet) sheet.hidden=false;
      return;
    }
    showMeetingDesk(true);
  };
  $("meetingPrivacyAck").onclick=function(){
    meetingAck=true;
    voiceAck=true;
    var sheet=$("meetingPrivacy");
    if(sheet) sheet.hidden=true;
    showMeetingDesk(true);
  };
  $("meetingRec").onclick=function(){
    if(meetingId){ endMeetingCapture(); return; }
    startMeetingCapture();
  };
  $("meetingHistToggle").onclick=function(){
    var list=$("meetingHistList");
    showMeetingHistory(!(list && !list.hidden));
  };
  $("meetingDiarize").onclick=function(){ runDiarize("audio_cluster"); };
  $("meetingMinutesBtn").onclick=function(){ requestMeetingMinutes(); };
  $("meetingBack").onclick=function(){
    if(meetingId) endMeetingCapture();
    showMeetingDesk(false);
  };
  $("operateOpen").onclick=function(){
    setStatus("正在打开侧栏…");
    api("/api/operate",{method:"POST"}).then(function(d){
      if(d && (d.type==="error" || d.error)){
        setStatus("请点工具栏 C");
        return;
      }
      setStatus("已请浏览器打开侧栏");
    }).catch(function(){setStatus("请点工具栏 C")});
  };
  function showHistory(on){
    var hud=$("hud");
    if(!hud) return;
    if(on){ hud.classList.add("history"); refresh(); }
    else hud.classList.remove("history");
  }
  $("historyOpen").onclick=function(){ showHistory(true); };
  $("historyClose").onclick=function(){ showHistory(false); };
  $("newChat").onclick=function(){ $("newThread").click(); };
  $("newThreadBar").onclick=function(){$("newThread").click()};
  $("newThread").onclick=function(){
    api("/api/threads",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(d){
      var id=d.thread&&d.thread.id;
      if(!id){setStatus("新建失败");return}
      showHistory(false);
      return refresh().then(function(){return selectThread(id)});
    });
  };
  $("text").addEventListener("keydown",function(e){
    if(e.key!=="Enter" || e.isComposing || e.keyCode===229) return;
    if(e.shiftKey && !e.metaKey && !e.ctrlKey){
      if(busy){e.preventDefault();send("enqueue")}
      return;
    }
    var go=false;
    if(sendShortcut==="Enter") go=!e.shiftKey && !e.metaKey && !e.ctrlKey;
    else if(sendShortcut==="Cmd+Enter") go=e.metaKey && !e.ctrlKey;
    else if(sendShortcut==="Ctrl+Enter") go=e.ctrlKey && !e.metaKey;
    if(!go) return;
    e.preventDefault();
    send(busy?"steer":"create");
  });
  $("text").addEventListener("input",function(){
    var v=$("text").value;
    if(v.trim().charAt(0)==="#") renderThreads(v.trim().slice(1));
  });
  function refresh(){
    return api("/api/threads").then(function(d){
      threads=(d.threads||[]).slice().sort(function(a,b){
        return String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||""));
      });
      renderThreads();
    });
  }
  var sec="threads";
  function showSec(name){
    sec=name;
    document.querySelectorAll("#secs [data-sec]").forEach(function(b){
      if(b.getAttribute("data-sec")===name) b.setAttribute("aria-current","true");
      else b.removeAttribute("aria-current");
    });
    setExpanded(true);
    var heads={threads:"对话",packs:"场景",knowledge:"知识",skills:"技能",mcp:"MCP"};
    $("secHead").textContent=heads[name]||name;
    $("newThread").style.display=name==="threads"?"":"none";
    $("threads").style.display=name==="threads"?"":"none";
    $("composeList").style.display=name==="threads"?"none":"";
    if(name==="threads") return refresh();
    loadCompose(name);
  }
  function loadCompose(name){
    var box=$("composeList");
    box.innerHTML="";
    function markEmpty(){
      if(box.children.length) return;
      var p=document.createElement("div");
      p.className="row muted";
      p.innerHTML="<strong>这一栏是空的</strong><small>没有可显示的项目</small>";
      box.appendChild(p);
    }
    if(name==="packs"){
      return api("/api/packs").then(function(d){
        (d.packs||[]).forEach(function(p){
          var b=document.createElement("button");
          b.className="row"+(p.overlay_eligible?"":" muted");
          b.innerHTML="<strong>"+esc(p.name||p.id)+"</strong><small>"+(p.overlay_eligible?"套到当前对话":"召唤器不可用")+"</small>";
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            if(!p.overlay_eligible){setStatus("这个场景不能在召唤器套用");return}
            api("/api/packs/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pack_id:p.id,thread_id:threadId})}).then(function(r){
              setStatus((r&&r.error)||"已套到当前对话");
            });
          };
          box.appendChild(b);
        });
      }).catch(function(e){setStatus(String(e&&e.message||e))}).then(markEmpty);
    }
    if(name==="mcp"){
      return api("/api/mcp").then(function(d){
        (d.servers||[]).forEach(function(s){
          var b=document.createElement("button");
          var on=s.enabled!==false;
          b.className="row";
          b.innerHTML="<strong>"+esc(s.name||"")+"</strong><small>"+(on?"已开":"已关")+"</small>";
          b.onclick=function(){
            api("/api/mcp/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:s.name,enabled:!on})}).then(function(){loadCompose("mcp")});
          };
          box.appendChild(b);
        });
      }).catch(function(e){setStatus(String(e&&e.message||e))}).then(markEmpty);
    }
    if(name==="skills"){
      return Promise.all([api("/api/skills"), threadId?api("/api/thread?id="+encodeURIComponent(threadId)):Promise.resolve({})]).then(function(pair){
        var ids=pair[1].active_skill_ids||[];
        (pair[0].skills||[]).forEach(function(s){
          var on=ids.indexOf(s.name)>=0;
          var b=document.createElement("button");
          b.className="row";
          b.innerHTML="<strong>"+esc(s.title||s.name)+"</strong><small>"+(on?"已用于本对话":"未用")+"</small>";
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            api("/api/skills/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,skill_name:s.name,on:!on})}).then(function(){loadCompose("skills")});
          };
          box.appendChild(b);
        });
      }).catch(function(e){setStatus(String(e&&e.message||e))}).then(markEmpty);
    }
    if(name==="knowledge"){
      return Promise.all([api("/api/knowledge"), threadId?api("/api/thread?id="+encodeURIComponent(threadId)):Promise.resolve({})]).then(function(pair){
        var cur=pair[1].active_knowledge_ids||[];
        (pair[0].docs||[]).forEach(function(k){
          var id=k.name||k.id;
          var on=cur.indexOf(id)>=0;
          var b=document.createElement("button");
          b.className="row";
          b.innerHTML="<strong>"+esc(k.title||id)+"</strong><small>"+(on?"已挂到本对话":"点击挂上")+"</small>";
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            var next=on?cur.filter(function(x){return x!==id}):cur.concat([id]);
            api("/api/knowledge/active",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,ids:next})}).then(function(){loadCompose("knowledge")});
          };
          box.appendChild(b);
        });
      }).catch(function(e){setStatus(String(e&&e.message||e))}).then(markEmpty);
    }
  }
  document.querySelectorAll("#secs [data-sec]").forEach(function(b){
    b.onclick=function(){showSec(b.getAttribute("data-sec"))};
  });
  $("composeList").style.display="none";
  function releaseLease(){
    if(!threadId) return;
    try{
      var body=new Blob([JSON.stringify({thread_id:threadId})],{type:"application/json"});
      navigator.sendBeacon(url("/api/lease/release"), body);
    }catch(e){}
  }
  window.addEventListener("pagehide", function(){
    if(sttLive) stopStt(true);
    if(meetingId){
      try{
        var body=new Blob([JSON.stringify({id:meetingId})],{type:"application/json"});
        navigator.sendBeacon(url("/api/meeting/end"), body);
      }catch(e){}
    }
    releaseLease();
  });
  function statusFromEvent(d){
    if(!d||typeof d!=="object") return "出错了";
    var data=d.data&&typeof d.data==="object"?d.data:{};
    var raw=String(d.error_code||data.error_code||d.error||"");
    var code=raw.indexOf("OVERLAY_STANDBY")>=0?"OVERLAY_STANDBY": raw.indexOf("LEASE_REV_MISMATCH")>=0?"LEASE_REV_MISMATCH": raw;
    var labels={
      run_active:"本轮还在跑 · 回车纠偏或排队",
      queue_full:"排队已满（最多 8 条）",
      steer_queue_full:"纠偏队列已满",
      idle_enqueue:"空闲时直接发送，不必排队",
      OVERLAY_STANDBY:"侧栏占用了输入",
      LEASE_REV_MISMATCH:"侧栏占用了输入",
      LEASE_HOLDER_SURFACE_MISMATCH:"侧栏占用了输入",
      BROWSER_UNAVAILABLE:CHROME_DOWN.cdp,
      settings_hint:"点击右上角 ⋮ 设置快捷键"
    };
    if(code==="BROWSER_UNAVAILABLE"||String(raw).indexOf("BROWSER_UNAVAILABLE")>=0){
      showChromeCta("cdp");
      return CHROME_DOWN.cdp;
    }
    if(/model|binary/i.test(raw)) return STT_NEED_MODEL;
    return labels[code]||d.error||d.message||"出错了";
  }
  try{
    var es=new EventSource(url("/api/events"));
    es.onmessage=function(ev){
      var d; try{d=JSON.parse(ev.data)}catch(e){return}
      var t=d&&d.type;
      if(t==="shell.close"){
        try{window.close()}catch(e){}
        return;
      }
      if(t==="error"||t==="chat.error"){
        setStatus(statusFromEvent(d));
        return;
      }
      if(t==="chat.user"||t==="chat.steered"||t==="chat.enqueued"){
        $("text").value="";
        $("files").value="";
        setStatus(t==="chat.enqueued"?"已排队": t==="chat.steered"?"已纠偏":"已发送");
        busy=t!=="chat.enqueued"?true:busy;
        syncBusyUi();
        startPoll();
        return;
      }
      if(t==="voice.stt.partial"){
        if(meetingId){
          var pt=typeof d.text==="string"?d.text:"";
          var mp=$("meetingPartial");
          if(mp && pt) mp.textContent=pt;
        }
        return;
      }
      if(t==="voice.stt.result"){
        var sid=typeof d.sessionId==="string"?d.sessionId:"";
        var txt=typeof d.text==="string"?d.text.trim():"";
        if(txt && meetingId){
          var feat=sid&&sttFeatsBySid[sid];
          if(feat) meetingFeats.push(feat);
          else meetingFeats.push([0,0,0]);
          appendMeetingLive(txt, "");
          var mp2=$("meetingPartial");
          if(mp2) mp2.textContent="";
          api("/api/meeting/append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:meetingId,text:txt})}).then(function(){ maybeDiarizeLive(); });
        } else if(txt && !meetingId){
          var cur=$("text").value;
          $("text").value=cur&&cur.trim()?cur.replace(/\\s*$/,"")+" "+txt:txt;
        }
        if(sttLive && (!sid || sttSid===sid)) stopStt(false);
        if(meetingId && !sttLive) startStt();
        return;
      }
      if(t==="meeting.diarized"){
        paintDiarized(d);
        return;
      }
      if(t==="voice.stt.error"){
        setStatus(sttUserCopy(d.code||d.error_code, d.message||d.error));
        if(sttLive) stopStt(true);
        return;
      }
      if(t==="meeting.error"){
        setStatus(sttUserCopy(d.code||d.error_code, d.message||d.error||"会议出错"));
        return;
      }
      if(t==="meeting.ended"){
        if(meetingId) lastMeetingId=meetingId;
        meetingId="";
        stopRecClock();
        setRecordingUi(false);
        if(sttLive) stopStt(false);
        var hint=$("meetingHint");
        if(hint) hint.textContent="已结束 · 可生成纪要";
        setStatus("录制已结束");
        return;
      }
      if(t==="meeting.minutes_result"){
        var md=(d&&d.minutes&&(d.minutes.raw_md||d.minutes.md))||d.raw_md||"";
        var box=$("meetingMinutes");
        if(box && md){
          showMeetingDesk(true);
          box.hidden=false;
          box.innerHTML=renderMd(md);
        }
        setStatus(md?"纪要已生成":"纪要已提交");
        return;
      }
      if(t==="mcp.confirm.pending"){
        setStatus(${JSON.stringify(SUMMONER_CONFIRM_NEED)});
        showConfirmCta();
        return;
      }
      if(t==="run_status"){
        busy=d.status==="llm";
        syncBusyUi();
        if(!busy) stopPoll(); else startPoll();
      }
      if(t==="chat.done"||t==="chat.aborted"){
        busy=false;
        syncBusyUi();
        stopPoll();
      }
      if(threadId && (t==="chat.token"||t==="chat.done"||t==="chat.user"||t==="file.uploaded")){
        api("/api/thread?id="+encodeURIComponent(threadId)).then(function(x){renderMsgs(x.messages||[])});
      }
    };
  }catch(e){}
  setExpanded(true);
  threadReady=refresh().then(function(){
    if(wanted) return selectThread(wanted);
    if(threads[0]) return selectThread(threads[0].id);
  }).catch(function(e){setStatus(String(e&&e.message||e))});
})();
}catch(e){try{var s=document.getElementById("status");if(s)s.textContent=String(e&&e.message||e)}catch(x){}}
</script>
</body>
</html>`
