// Companion server — WebSocket server, message routing, tool execution bridge

import { WebSocketServer, WebSocket } from "ws"

/** User-facing tool labels for scene whitelist errors (product SoT §14.1). */
function toolDisplayNameZh(toolName: string): string {
  const map: Record<string, string> = {
    workspace_list_dir: "列出工作区文件",
    workspace_read_file: "读取工作区文件",
    ensure_project_dir: "创建会话项目目录",
    evaluate: "在页面执行脚本",
    shell_exec: "执行本机命令",
    netsec_port_scan: "端口扫描",
    host_computer: "电脑操控",
    host_read: "读取本机应用数据",
    host_write: "写入本机应用数据",
    host_app: "启动本机应用",
    host_cli: "执行白名单 CLI",
    navigate: "打开网页",
    screenshot: "截图",
    get_page_text: "读取页面文字",
    get_page_html: "读取页面 HTML",
  }
  return map[toolName] || `工具「${toolName}」`
}

import { randomUUID } from "crypto"
import http from "http"
import os from "os"
import { URL } from "url"
import { getConfig, saveConfig, initDataDir, configEvents, CONFIG_CHANGE_EVENT, migrateLegacyModelName, DATA_DIR } from "./config"
import { bootGcVoiceSttTmp, getSttSessionService } from "./voice/stt-session-service"
import { gcExpiredMeetingAudio } from "./meeting/meeting-store"
import { handleMessage, redactMcpServersForBroadcast } from "./message-router"
import { redactConfigForWire } from "./config-redact"
import { ThreadManager } from "./threads/thread-manager"
import { SkillEngine } from "./skills/skill-engine"
import { HistoryStore } from "./history/store"
import { classifyMcpCall, mergeCapabilities, CRITICAL_MCP_CAPABILITIES, CRITICAL_MCP_META_TOOLS } from "./security"
import { SecurityConfirmationManager } from "./security-confirmation"
import { getTrayInstance } from "./menu-bar-agent"
import {
  isHudSpikeEnabled,
  runHudSpikeInProcess,
  HUD_SPIKE_THREAD_ID,
  HUD_SPIKE_TASK_ID,
} from "./hud/spike"
import { getThreadApprovals } from "./host-use/thread-approvals"
import { logger, type LogLevel } from "./logger"
import { acquireLock, releaseLock, isProcessRunning, readPidFile, cleanupPidFile, setupGracefulShutdown } from "./daemon"
import { getLockFilePath, getPidFilePath } from "./config"
import { getMcpManager, getMcpConfirmCache, isMcpNamespaced } from "./mcp"
import { prepareBrowserDownloadParams } from "./path-sandbox"
import { runL2ToolAdmission } from "./tool/l2-admission"
export { runL2ToolAdmission, L2_GATE_TOOLS, isFullAutonomyCruise } from "./tool/l2-admission"
import { runCookieTrustAdmission, runUrlNavigateAdmission } from "./tool/url-cookie-admission"
export {
  runCookieTrustAdmission,
  runUrlNavigateAdmission,
  COOKIE_TOOLS,
  URL_GATE_TOOLS,
} from "./tool/url-cookie-admission"
import { runImageFetchAdmission } from "./tool/image-fetch-admission"
export { runImageFetchAdmission } from "./tool/image-fetch-admission"
import { applyHardenedProcessPath } from "./process-path"
import {
  getOrCreateSharedSecret,
  consumeSecretFreshlyGenerated,
  consumeSecretPersistFailed,
  issueChallenge,
  verifyProof,
  markPaired,
  AUTH_TIMEOUT_MS,
} from "./ws-auth"
import { allowInboundLogEvent } from "./log-event-gate"
import {
  flipAllComputerTaskAborts,
  getComputerTaskAbortRegistry,
} from "./computer/task-abort-registry"

const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB
/** Cap concurrent unauthenticated sockets during handshake window (pre-auth DoS). */
const MAX_UNAUTHENTICATED_WS = 8

const PORT = 23401
// Exported for integration tests (audit item 6). Production reads the const directly.
export const TOOL_EXECUTION_TIMEOUT_MS = 15000
/** browser_download may wait up to 120s; companion WS timeout must not undercut extension. */
export const BROWSER_DOWNLOAD_MAX_TIMEOUT_MS = 120_000
export function resolveToolDispatchTimeoutMs(toolName: string, params?: any): number {
  if (toolName === "browser_download") {
    const t = typeof params?.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.floor(params.timeoutMs)
      : 60_000
    return Math.min(BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000, Math.max(TOOL_EXECUTION_TIMEOUT_MS, t + 5_000))
  }
  return TOOL_EXECUTION_TIMEOUT_MS
}

/**
 * P0-2 (audit C1): only chrome-extension:// origins may open a WebSocket to the companion.
 * Web origins (http/https/file) are rejected so a page the user visits cannot connect to
 * ws://127.0.0.1:23401 and drive the agent (config.set / list_all_cookies / evaluate ...).
 * The browser sets the WS Origin from the page/worker origin and page JS cannot forge it.
 * Exported for unit testing the gate without spinning up the full server.
 * Residual risks (intentionally out of P0 scope):
 *  - ANY chrome extension (not just CMspark) matches — this is a scheme-level gate only. Pinning
 *    to the specific extension id requires a config step / P2.
 *  - A local process can still spoof the Origin header (curl -H); that needs the P2 shared-secret
 *    handshake. The id charset is restricted to [A-Za-z0-9_-] so CRLF/control chars are rejected.
 */
export function isAllowedWsOrigin(origin: string | undefined | null): boolean {
  if (typeof origin !== "string") return false
  // Trusted extension (Chrome side panel / popup / service worker). Page JS cannot
  // forge the browser-set Origin, so this reliably excludes visited web pages.
  if (/^chrome-extension:\/\/[A-Za-z0-9_-]+$/i.test(origin)) return true
  // Trusted first-party tray client (the local Node menu-bar agent, a sibling of
  // this server in the same codebase). A web page CANNOT set an arbitrary Origin —
  // the browser enforces the real page origin — so this only ever matches the local
  // tray, which must still complete the #35 HMAC handshake below. The shared secret
  // is the real gate; the Origin is only a first filter (a local process can spoof
  // either, which is exactly why P0-2B layered the HMAC challenge on top).
  if (origin === "cmspark-tray://local") return true
  return false
}

/**
 * L12 healthz handler. Mounted on the same loopback HTTP server that carries the
 * WebSocket upgrade. Liveness probes (launchd/docker/supervisor) call this
 * without any WS handshake, so it is intentionally outside the shared-secret
 * auth flow and exposes no sensitive state.
 */
/**
 * Loopback HTTP (healthz + outbound-mcp invoke). Async-capable wrapper used as
 * http.createServer handler.
 */
export function handleHealthzRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  void handleLoopbackHttp(req, res)
}

async function handleLoopbackHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const pathOnly = req.url ? req.url.split("?")[0] : ""
  if (req.method === "GET" && pathOnly === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }))
    return
  }

  // Outbound MCP bridge (ADR-022 P0c) — auth inside handler
  try {
    const { handleOutboundMcpHttp } = await import("./outbound-mcp/companion-http")
    const secret = getOrCreateSharedSecret()
    const handled = await handleOutboundMcpHttp(req, res, secret)
    if (handled) return
  } catch (err: any) {
    logger.warn("outbound_mcp.http_error", { error: err?.message || String(err) })
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error_code: "INTERNAL", error: "outbound http error" }))
    }
    return
  }

  res.writeHead(404, { "Content-Type": "text/plain" })
  res.end("Not Found")
}

/**
 * Pick an authenticated **Chrome extension** WS for outbound CDP tool dispatch.
 * S42 P1: tray (`cmspark-tray://local`) authenticates but does NOT handle
 * tool.execute — never bind outbound runner to tray (was 15s timeout residual).
 */
export function pickAuthenticatedClientWs(): WebSocket | null {
  for (const c of clients) {
    const st = wsAuth.get(c)
    if (c.readyState !== WebSocket.OPEN || st?.authenticated !== true) continue
    const origin = st.origin || ""
    if (/^chrome-extension:\/\//i.test(origin)) {
      return c
    }
  }
  return null
}

let outboundRunnerWs: WebSocket | null = null

/**
 * Ensure outbound HTTP runner is wired to createToolExecutor(extensionWs).
 * Synchronous so invoke never races an empty runner after auth.
 * Extension-only: no extension peer → EXTENSION_UNAVAILABLE (fast fail).
 */
export function ensureOutboundToolRunnerWired(): boolean {
  // Lazy require avoids circular import at module load (companion-http is light).
  const { setOutboundToolRunner } = require("./outbound-mcp/companion-http") as typeof import("./outbound-mcp/companion-http")
  const ws = pickAuthenticatedClientWs()
  if (!ws) {
    setOutboundToolRunner(null)
    outboundRunnerWs = null
    return false
  }
  // Prefer rebinding when a better peer appears (extension reconnect).
  if (outboundRunnerWs === ws) {
    return true
  }
  const origin = wsAuth.get(ws)?.origin || ""
  const executeTool = createToolExecutor(ws)
  // trustedOutbound: only this Bearer-gated runner may re-apply __outbound_mcp
  // (S42 multi-adv P0 — params alone are not a trust boundary).
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    return executeTool(toolCallId, internalTool, params, undefined, {
      trustedOutbound: true,
    })
  })
  outboundRunnerWs = ws
  logger.info("outbound_mcp.runner_wired", {
    origin: origin || "<none>",
    prefers_extension: true,
  })
  return true
}

function getDomainFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString)
    return parsed.hostname
  } catch {
    return ""
  }
}

let wss: WebSocketServer
let clients: Set<WebSocket> = new Set()

// C-P0-6 (2026-07-24 diagnosis): track active tray confirmation IDs per WS so
// that when a WS disconnects mid-confirmation, we can cancel the corresponding
// tray dialog. Without this, the Swift dialog stays modal until its own timeout
// even though the requesting WS is gone. The tray adapter is a singleton with
// its own pendingConfirms Map; cancelConfirm(id) is a no-op if id isn't pending.
const activeTrayConfirmsByWs = new WeakMap<WebSocket, Set<string>>()

// P0-2B: per-connection authentication state. A peer is UNauthenticated until it
// completes the ws-auth challenge–response handshake (auth.handshake). Every app
// message is rejected (and the connection terminated) until then, so a local
// process that forged the Origin header still cannot drive the agent without the
// shared secret. See ws-auth.ts and server.ts:1418-1420 for the threat model.
const wsAuth = new WeakMap<
  WebSocket,
  { nonce: string; authenticated: boolean; timer: NodeJS.Timeout; origin?: string }
>()

// Core services — initialized on first connection
let threadManager: ThreadManager
let skillEngine: SkillEngine
let historyStore: HistoryStore

// Pending tool execution promises: toolCallId → { resolve, reject, timer }
// Exported for integration tests (audit item 6) so tests can inspect timer cleanup
// and double-resolution behavior. Production code uses the Map directly.
export const pendingToolCalls = new Map<string, {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
  /** ADR-015: bind ownership for worker-cancel + lease expiry drain */
  thread_id?: string
  tabId?: number
  tool_name?: string
  /**
   * SEC-E: socket that received tool.execute. Close grace and tool.result
   * acceptance are scoped to this peer so tray reconnect cannot kill extension tools.
   */
  originWs?: WebSocket
}>()

/** Reject in-flight extension tools owned by a thread (worker-cancel / lease drain). */
export function rejectPendingForThread(
  threadId: string,
  reason: string,
  tabIdFilter?: number,
): number {
  let n = 0
  for (const [id, pending] of [...pendingToolCalls.entries()]) {
    if (pending.thread_id !== threadId) continue
    if (tabIdFilter != null && pending.tabId !== tabIdFilter) continue
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
    pending.resolve({ success: false, error: reason })
    n++
  }
  return n
}

export function hasPendingForTab(tabId: number, holderThreadId: string): boolean {
  for (const pending of pendingToolCalls.values()) {
    if (pending.thread_id === holderThreadId && pending.tabId === tabId) return true
  }
  return false
}

export function rejectPendingForTab(
  tabId: number,
  holderThreadId: string,
  reason: string,
): number {
  return rejectPendingForThread(holderThreadId, reason, tabId)
}

// Wire tab-lease sweeps to pending CDP so internal sweepExpired never silent-FREEs in-flight tabs.
// Lazy import avoids circular init; register once on first executor use as well.
// hasPendingConfirmation binds soft expire to live Confirm Center (GATE2).
void import("./orchestrator/tab-lease")
  .then(({ registerTabLeasePendingHooks }) => {
    registerTabLeasePendingHooks({
      hasPendingForTab,
      rejectPendingForTab,
      hasPendingConfirmation: (confirmId, holderThreadId) => {
        if (confirmId && securityConfirmations.isPending(confirmId)) return true
        return securityConfirmations.hasPendingForWorker(holderThreadId)
      },
    })
  })
  .catch(() => {
    /* tests may load before package graph is ready */
  })

// Cache of tabId → url, used by the evaluate auto-approve gate to resolve the
// acting domain (so we can decide whether to skip the confirmation dialog).
// Populated from list_tabs results AND — critically — kept current by the
// extension's tab.navigated push (applyTabNavigated below). Without that push a
// tab can navigate from a trusted domain to an untrusted one and the gate would
// keep auto-approving evaluate against the STALE trusted hostname (a cross-domain
// bypass — a security UNDER-prompt, not the harmless over-prompt earlier comments
// claimed). Unknown/missing entries resolve to "" → the gate confirms (safe default).
// Residual: a microsecond TOCTOU between the gate's cache read and the forwarded
// evaluate, and a push lost while the WS is disconnected (next list_tabs refreshes).
const tabUrlCache = new Map<number, string>()

function refreshTabUrlCache(tabs: any[]): void {
  if (!Array.isArray(tabs)) return
  for (const t of tabs) {
    if (t && typeof t.id === "number" && typeof t.url === "string") {
      tabUrlCache.set(t.id, t.url)
    }
  }
}

function getCachedTabUrl(tabId: number | undefined | null): string | undefined {
  if (typeof tabId !== "number") return undefined
  return tabUrlCache.get(tabId)
}

/**
 * Apply a tab-navigation push from the extension (M1 / audit P2-1). Updates the
 * cached URL so the evaluate auto-approve gate sees the CURRENT origin, not a
 * stale one. Exported so tests can drive it directly (the WS message handler is
 * the only production caller). Logs when the cached domain changes — surfacing
 * trust-anchor transitions in the audit trail.
 */
export function applyTabNavigated(tabId: number, url: string): void {
  const previous = getCachedTabUrl(tabId)
  tabUrlCache.set(tabId, url)
  const prevDomain = previous ? getDomainFromUrl(previous) : ""
  const nextDomain = getDomainFromUrl(url)
  if (prevDomain && prevDomain !== nextDomain) {
    logger.info("ws.tab.navigated_domain_changed", { tab_id: tabId, from: prevDomain, to: nextDomain })
  }
}

// Exported for integration tests (audit item 2 / 12) so tests can drive
// securityConfirmations.respond(...) when simulating user approval/denial.
export const securityConfirmations = new SecurityConfirmationManager()

// N5 (P3a HUD spike): when a confirm becomes terminal, fan-out to tray popover
// + HUD so multi-surface UI clears. WS origin already gets resolved via pending.send.
// Spike scope = HUD + tray only; multi-client WS fan-out deferred (dual-review P4).
// Wire ownership: server owns the manager singleton — do not construct a second manager.
securityConfirmations.setOnTerminal(({ confirmationId, reason }) => {
  try {
    const tray = getTrayInstance()
    if (!tray) return
    tray.cancelConfirm(confirmationId)
    tray.cancelHudConfirm?.(confirmationId)
    tray.notifyHudConfirmResolved?.(confirmationId, reason)
  } catch {
    /* never break confirm resolve path */
  }
})

// Audit item 8: tool-name patterns that signal destructive operations. Matching
// tools bypass the server's trust_level and always require per-call confirmation
// (manual mode). The patterns cover the common verbs across filesystem / shell /
// git / database MCP servers; the regex is intentionally permissive on prefixes
// (e.g. "write_file", "delete_record", "exec_query", "rm_path") to err on the
// side of caution.
const DESTRUCTIVE_MCP_TOOL_PATTERN = /\b(write|delete|exec|commit|rm|remove|shell|curl|wget|spawn|fork|kill|drop|truncate|wipe|destroy)\b/i

// Per-connection MCP session IDs (randomUUID from createToolExecutor) keyed by
// the WebSocket they belong to. Used by ws.on("close") to clear the
// McpConfirmCache for that session — without this, stale first-use approvals
// linger in the module-level singleton forever (memory leak + the approval
// persists for whatever reconnects with a different sessionId).
const mcpSessionByWs = new Map<WebSocket, string>()

/**
 * WP2 (§E.6): running computer-task abort registry lives in
 * computer/task-abort-registry.ts so unattended disarm can flip flags too.
 */
const computerTaskAbort = getComputerTaskAbortRegistry()

/**
 * Exported for integration tests (R1, §E.6.2): direct access to the running-
 * task registry so tests can seed a fake in-flight task and assert the
 * single-task mutex. Production code never calls this.
 */
export function getComputerTaskRegistryForTests(): Map<string, boolean> {
  return computerTaskAbort
}

/** Re-export for integration tests (chat.abort / unattended disarm). */
export { flipAllComputerTaskAborts }

/**
 * WP2 (§E.6) F1: computer.task.abort WS handler — extracted from the message
 * dispatch so the abort semantics are testable at the socket boundary.
 * task_id targets one run (the id is broadcast in the task events); "*" is
 * the panic button — aborts every running task. Stopping injection is always
 * the safe direction, so any authenticated panel connection may send this
 * (no origin binding). The flag flip is UNCONDITIONAL: the abort takes
 * effect even when the ack can no longer be delivered (socket closing at
 * the WS seam) — the send alone is guarded by the OPEN check. Returns the
 * ack payload (also used by the dispatch to send the ack).
 */

export function handleComputerTaskAbort(
  ws: { readyState: number; send: (data: string) => void },
  msg: { task_id?: unknown },
): { taskId: string; matched: number } {
  const tid = typeof msg.task_id === "string" ? msg.task_id : ""
  let matched = 0
  if (tid === "*") {
    matched = flipAllComputerTaskAborts()
  } else if (tid && computerTaskAbort.has(tid)) {
    computerTaskAbort.set(tid, true)
    matched = 1
  }
  if (matched > 0) logger.warn("computer.task.abort.requested", { taskId: tid, matched })
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "computer.task.abort.ack", task_id: tid, matched }))
  }
  return { taskId: tid, matched }
}

/**
 * Exported for integration tests (R1): substitute the estop preflight so the
 * host_computer handler can be exercised end-to-end without spawning the real
 * ps helper / injecting. Pass null to restore production behavior.
 */
let computerEstopEnsureOverride: (() => Promise<{ ok: boolean; reason?: string }>) | null = null
export function setComputerEstopEnsureForTests(fn: (() => Promise<{ ok: boolean; reason?: string }>) | null): void {
  computerEstopEnsureOverride = fn
}

/**
 * WP2 (Y7): session-level injection rate limiter (process singleton). The
 * pre-dialog gate refuses new computer tasks while the 60s window is
 * saturated; the handler records every successful injection. Lazily created
 * via dynamic import so non-Windows startups never load the module.
 */
let computerRateLimiterSingleton: import("./computer/rate-limit").InjectionRateLimiter | null = null
async function computerRateLimiter(): Promise<import("./computer/rate-limit").InjectionRateLimiter> {
  if (!computerRateLimiterSingleton) {
    const { InjectionRateLimiter } = await import("./computer/rate-limit")
    computerRateLimiterSingleton = new InjectionRateLimiter()
  }
  return computerRateLimiterSingleton
}

/**
 * Exported for integration tests (audit item 6 pattern): the per-connection
 * session id createToolExecutor registered for this socket. Tests need it to
 * drive handleSecurityConfirmationResponse with the SAME session id the gate
 * used, so W7/WP3 thread-scoped trust grants line up with later gate checks.
 */
export function getSessionIdForTests(ws: WebSocket): string | undefined {
  return mcpSessionByWs.get(ws)
}
const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"])

function safeLogLevel(level: unknown): LogLevel {
  return typeof level === "string" && LOG_LEVELS.has(level as LogLevel) ? level as LogLevel : "info"
}

function summarizeMessage(msg: any): Record<string, unknown> {
  const summary: Record<string, unknown> = { type: msg?.type || "unknown" }
  if (msg?.thread_id !== undefined) summary.thread_id = msg.thread_id
  if (msg?.threadId !== undefined) summary.thread_id = msg.threadId
  if (msg?.tool_name !== undefined) summary.tool_name = msg.tool_name
  if (msg?.tool_call_id !== undefined) summary.tool_call_id = msg.tool_call_id
  if (Array.isArray(msg?.skill_ids)) summary.skill_count = msg.skill_ids.length
  return summary
}

function summarizeToolParams(params: any): Record<string, unknown> {
  const safeParams = params || {}
  const summary: Record<string, unknown> = {
    keys: Object.keys(safeParams),
  }
  for (const key of ["tabId", "url", "domain", "selector", "threadId", "thread_id"]) {
    if (safeParams[key] !== undefined) summary[key] = safeParams[key]
  }
  if (safeParams.code !== undefined) summary.code_length = String(safeParams.code).length
  if (safeParams.expression !== undefined) summary.expression_length = String(safeParams.expression).length
  return summary
}

function summarizeToolResult(result: any): Record<string, unknown> {
  const data = result?.data
  return {
    success: result?.success === true,
    error: result?.error,
    data_keys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 20) : undefined,
  }
}

function logToolFinish(toolCallId: string, toolName: string, startedAt: number, result: any) {
  const level = result?.success === true ? "info" : "warn"
  logger.log(level, "tool.finish", {
    tool_call_id: toolCallId,
    tool_name: toolName,
    duration_ms: Date.now() - startedAt,
    ...summarizeToolResult(result),
  })
}

async function initServices() {
  await initDataDir()
  threadManager = new ThreadManager()
  skillEngine = new SkillEngine(getConfig().llm)
  historyStore = new HistoryStore()
  await historyStore.waitReady()
  // Path B M1: init STT session service + boot-time orphan GC under DATA_DIR/tmp/voice-stt/
  try {
    getSttSessionService({ dataDir: DATA_DIR })
    const removed = await bootGcVoiceSttTmp(DATA_DIR)
    if (removed > 0) {
      logger.info("voice.stt.tmp.boot_gc", { removed })
    }
  } catch (e: any) {
    logger.warn("voice.stt.tmp.boot_gc_failed", { error: e?.message || String(e) })
  }
  // P1 Meeting: retain_until audio GC at boot + every 6h
  try {
    const meetingGc = gcExpiredMeetingAudio(DATA_DIR)
    if (meetingGc.purged > 0 || meetingGc.scanned > 0) {
      logger.info("meeting.audio_gc.boot", meetingGc)
    }
  } catch (e) {
    logger.warn("meeting.audio_gc.boot_failed", {
      err: e instanceof Error ? e.message : String(e),
    })
  }
  setInterval(() => {
    try {
      const r = gcExpiredMeetingAudio(DATA_DIR)
      if (r.purged > 0) logger.info("meeting.audio_gc.periodic", r)
    } catch (e) {
      logger.warn("meeting.audio_gc.periodic_failed", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }, 6 * 60 * 60 * 1000).unref?.()
  // Mission Pack P0: install shipped packs (appsec-prd-review) into DATA_DIR
  try {
    const { ensureBuiltinPacksInstalled, reconcilePackTrustOnBoot } = await import(
      "./packs/pack-engine"
    )
    ensureBuiltinPacksInstalled(skillEngine)
    // S46: restore orphan Trust after crash mid-apply / missing thread cookie
    const rec = reconcilePackTrustOnBoot(threadManager)
    if (rec.action !== "none") {
      logger.warn("packs.trust_reconcile", {
        action: rec.action,
        thread_id: rec.journal?.thread_id,
        pack_id: rec.journal?.pack_id,
      })
    }
  } catch (e: any) {
    logger.warn("packs.builtin_install_failed", { error: e?.message || String(e) })
  }
  bindCompanionDispatchFromServerLocals()
}

/**
 * Integration tests: ensure module-level ThreadManager exists so outbound B1
 * path (`isToolAllowed` on synthetic holders) is exercised. No-op if already set.
 */
export function seedThreadManagerForTests(): ThreadManager {
  if (!threadManager) {
    threadManager = new ThreadManager()
  }
  // Re-bind so executeCompanionTool sees the seeded manager (tests may skip full initServices).
  bindCompanionDispatchFromServerLocals()
  return threadManager
}

/**
 * Per-invoke options for createToolExecutor.
 * S42 multi-adv P0: outbound provenance must NEVER be trusted from tool params
 * (LLM / generic zod fallback can inject `__outbound_mcp`). Only the companion-http
 * runner (or tests) may pass `trustedOutbound: true` after Bearer auth.
 */
export type ToolExecuteInvokeOpts = {
  trustedOutbound?: boolean
}

export type ToolExecutorFn = (
  toolCallId: string,
  toolName: string,
  params: any,
  signal?: AbortSignal,
  invokeOpts?: ToolExecuteInvokeOpts,
) => Promise<{ success: boolean; data?: any; error?: string }>

// FREEZE (C10 multi-adv 2026-08-10 / phase-A..D 2026-08-11):
// - L2 security admission → tool/l2-admission.ts (runL2ToolAdmission).
// - Cookie trust + URL navigate admission → tool/url-cookie-admission.ts
//   (runCookieTrustAdmission / runUrlNavigateAdmission).
// - analyze_image IMAGE_FETCH two-phase gate → tool/image-fetch-admission.ts
//   (runImageFetchAdmission).
// - createToolExecutor is the orchestration shell: multi-agent / cookie / browser_download /
//   L2 call / URL gate / image gate call / companion dispatch / extension forward.
// - NEW companion-side tool *cases* → tool/companion-dispatch.ts (or capability/*).
// - NEW WS validators → ws/validate.ts.
// Do not re-inflate server.ts with L2 algebra, cookie/URL/image gate bodies, or business tool bodies.
// Exported for integration tests (audit item 6).
export function createToolExecutor(ws: WebSocket): ToolExecutorFn {
  // Per-connection session id — used as the key for MCP first-use confirmation cache
  // so approvals don't bleed across browser sessions.
  const sessionId = randomUUID()
  // Audit item 8: register the (ws, sessionId) pair so ws.on("close") can clean
  // up the per-session MCP confirm-cache. Without this, stale approvals leak.
  mcpSessionByWs.set(ws, sessionId)
  return async (
    toolCallId: string,
    toolName: string,
    params: any,
    signal?: AbortSignal,
    invokeOpts?: ToolExecuteInvokeOpts,
  ): Promise<{ success: boolean; data?: any; error?: string }> => {
    let finalParams = params || {}
    // #au4dch DL-1: normalize dotted alias → downloads_find
    if (toolName === "downloads.find") {
      toolName = "downloads_find"
    }
    // P1.0 D18 / BD-ALIAS: normalize legacy "download" → browser_download so path sandbox,
    // worker deny, TAB_LEASE, and dispatch timeout all apply. Never forward unsandboxed
    // downloadPath via the extension alias path.
    if (toolName === "download") {
      toolName = "browser_download"
    }
    // Phase 1 W8 bugfix: STRIP any LLM-provided security_token before L2 gate.
    // The token field is in zod schema (kept for forward-compat / audit), but
    // LLMs sometimes hallucinate or replay stale tokens, skipping the L2 gate
    // and then failing validateToken inside executeCompanionTool (the
    // "Invalid or expired security token" error). Real tokens are ONLY issued
    // companion-side after user approval — never legitimately possessed by
    // the LLM at call time. Strip always; L2 gate re-issues fresh per call.
    if (finalParams.security_token) {
      logger.warn("security.token.stripped_llm_provided", {
        tool_call_id: toolCallId,
        tool_name: toolName,
      })
      const { security_token: _stripped, ...rest } = finalParams
      finalParams = rest
    }
    // S42 multi-adv P0: strip client/LLM __outbound_* always. Re-apply only when
    // invokeOpts.trustedOutbound (companion-http runner after Bearer auth).
    // Generic tool schemas use z.record(z.unknown()) and would otherwise let a
    // pack/worker bypass isToolAllowed via `"__outbound_mcp": true`.
    const inboundOutboundMcp = (finalParams as any).__outbound_mcp === true
    const inboundOutboundCaller =
      typeof (finalParams as any).__outbound_caller_id === "string"
        ? String((finalParams as any).__outbound_caller_id)
        : undefined
    if (
      Object.prototype.hasOwnProperty.call(finalParams, "__outbound_mcp") ||
      Object.prototype.hasOwnProperty.call(finalParams, "__outbound_caller_id")
    ) {
      if (!invokeOpts?.trustedOutbound) {
        logger.warn("security.outbound_flag.stripped_untrusted", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          had_flag: inboundOutboundMcp,
        })
      }
      const {
        __outbound_mcp: _om,
        __outbound_caller_id: _oc,
        ...restOb
      } = finalParams as Record<string, unknown>
      finalParams = restOb
    }
    if (invokeOpts?.trustedOutbound === true && inboundOutboundMcp) {
      finalParams = {
        ...finalParams,
        __outbound_mcp: true,
        ...(inboundOutboundCaller
          ? { __outbound_caller_id: inboundOutboundCaller }
          : {}),
      }
    }
    // Normalize tabId to a number. LLMs occasionally pass "123" as a string;
    // without this, getCachedTabUrl and the navigate/set_tab_url cache update
    // would silently skip (typeof !== "number"), reintroducing the C1 stale-
    // cache window and breaking domain auto-approval for that tabId.
    if (finalParams.tabId != null) {
      const n = typeof finalParams.tabId === "number"
        ? finalParams.tabId
        : Number(finalParams.tabId)
      finalParams.tabId = Number.isFinite(n) ? n : undefined
    }
    const startedAt = Date.now()
    // --- ADR-015 multi-agent gates (before L2 / cookie / dispatch) ---
    // Resolve acting thread first so tool.start carries thread_id (run-state W0/W2).
    const actingThreadId =
      typeof (finalParams as any).__thread_id === "string"
        ? String((finalParams as any).__thread_id)
        : typeof (finalParams as any)._thread_id === "string"
          ? String((finalParams as any)._thread_id)
          : undefined
    // C7/C8 multi-adv: normalize shell cwd / netsec ports BEFORE L2 bind + preview
    // so issueToken payload === execute payload (no post-approve expansion).
    if (toolName === "shell_exec") {
      const { normalizeShellCwd } = require("./capability/shell") as typeof import("./capability/shell")
      const thr = actingThreadId ? threadManager.get(actingThreadId) : null
      const cwd = normalizeShellCwd(finalParams, thr?.workspace_root)
      const { working_directory: _wd, ...restShell } = finalParams as Record<string, any>
      finalParams = { ...restShell, cwd }
    } else if (toolName === "netsec_port_scan") {
      const { normalizeNetsecPorts } = require("./netsec/scan") as typeof import("./netsec/scan")
      finalParams = {
        ...finalParams,
        ports: normalizeNetsecPorts((finalParams as any).ports),
      }
    }
    // Notify extension: tool execution started (show in sidebar)
    ws.send(JSON.stringify({
      type: "tool.start",
      tool_call_id: toolCallId,
      tool_name: toolName,
      params: summarizeToolParams(finalParams),
      ...(actingThreadId ? { thread_id: actingThreadId } : {}),
    }))
    logger.info("tool.start", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      params: summarizeToolParams(finalParams),
      thread_id: actingThreadId,
    })
    // Only true when re-applied under trustedOutbound — never from raw LLM params.
    const isOutboundMcpCall = (finalParams as any).__outbound_mcp === true
    try {
      const {
        TAB_LEASE_TOOLS,
        isMultiAgentThread,
        anyTabLeaseHeld,
        acquireOrRenewTabLease,
        sweepExpired,
      } = await import("./orchestrator")
      sweepExpired({ hasPendingForTab })

      // ADR-022 L9: Side Panel wins — if non-outbound actor targets a tab held
      // by outbound_mcp:*, force-release so dual-entry does not thrash.
      if (
        !isOutboundMcpCall &&
        TAB_LEASE_TOOLS.has(toolName) &&
        typeof finalParams.tabId === "number"
      ) {
        try {
          const { sidePanelWinsReleaseOutboundLease } = await import("./outbound-mcp/dual-entry")
          sidePanelWinsReleaseOutboundLease(finalParams.tabId, actingThreadId)
        } catch {
          /* best-effort */
        }
      }

      // ADR-022 L8/L9 adversary B1: outbound injects synthetic __thread_id
      // (`outbound_mcp:<caller>`) for lease holder identity, but that id is NOT a
      // ThreadManager thread — isToolAllowed would always deny. Outbound surface is
      // already gated by gateOutboundCall + disclosure + dual-entry lease; skip the
      // multi-agent / pack whitelist path for isOutboundMcpCall.
      if (actingThreadId && threadManager && !isOutboundMcpCall) {
        const th = threadManager.get(actingThreadId) as any
        if (th?.paused) {
          const result = {
            success: false,
            error: `worker_paused:${actingThreadId} — resume before dispatching tools`,
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        // isToolAllowed hard gate (Mission Pack / scene tool surface)
        // Orthogonal to god-mode / auto_approve (ADR-014 + scene UX SoT).
        if (!threadManager.isToolAllowed(actingThreadId, toolName)) {
          const packId = typeof th?.mission_pack_id === "string" ? th.mission_pack_id : null
          const toolLabel = toolDisplayNameZh(toolName)
          const { sceneToolNotAllowedError } = await import("./capability/user-gate-copy")
          const sceneHint = sceneToolNotAllowedError(toolLabel, packId)
          const result = {
            success: false,
            error: sceneHint,
            data: {
              error_code: "tool_not_allowed",
              error_level: "recoverable" as const,
              tool_name: toolName,
              mission_pack_id: packId,
              suggested_action: packId ? "unapply_pack" : "check_tool_whitelist",
              user_hint_zh: sceneHint.split("\n")[0],
            },
          }
          logger.warn("security.tool_whitelist_blocked", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            thread_id: actingThreadId,
            mission_pack_id: packId,
          })
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        const multi =
          isMultiAgentThread(th) || anyTabLeaseHeld()
        if (TAB_LEASE_TOOLS.has(toolName) && multi && typeof finalParams.tabId !== "number") {
          const result = {
            success: false,
            error: "TAB_ID_REQUIRED: multi-agent mode forbids silent active-tab; pass explicit numeric tabId",
            data: { error_code: "TAB_ID_REQUIRED" },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        if (multi) {
          // Defense-in-depth for extension screenshot/analyze_image fallback
          ;(finalParams as any).__require_tab_id = true
        }
        // Early exclusive HARD for tab tools — multi-agent only (ADR-015).
        // Outbound MCP already leased in companion-http (L9); skip double-acquire here
        // when isOutboundMcpCall (holder is outbound_mcp:*).
        // Normal single-agent chats must not take per-worker tab leases: browse /
        // AppSec often opens many tabs and max_tabs_leased_per_worker=2 would
        // hard-fail as non_recoverable (thread 1gfd6t). When any multi-agent
        // lease is already held, multi is true so exclusivity still covers peers.
        // GATE2: auto-approve / domain-whitelist / god-mode must still hold exclusive
        // lease — previously willEnterL2 skipped HARD and skipConfirmation skipped SOFT.
        // Interactive L2 path upgrades same-holder HARD → HELD_PENDING_L2 below.
        if (
          multi &&
          !isOutboundMcpCall &&
          TAB_LEASE_TOOLS.has(toolName) &&
          typeof finalParams.tabId === "number" &&
          actingThreadId
        ) {
          const leaseRes = acquireOrRenewTabLease({
            tabId: finalParams.tabId,
            holderThreadId: actingThreadId,
            needsL2: false,
          })
          if (!leaseRes.ok) {
            const result = {
              success: false,
              error: leaseRes.error,
              data: {
                error_code: leaseRes.error_code,
                tab_id: leaseRes.tab_id,
                holder_thread_id: leaseRes.holder_thread_id,
              },
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
        }
      }
      // host_computer vs any tab lease (Q4): block Chrome window ops while tabs leased
      if (toolName === "host_computer" && anyTabLeaseHeld()) {
        const blob = JSON.stringify(finalParams || {}).toLowerCase()
        const chromeHint =
          blob.includes("chrome") ||
          blob.includes("chromium") ||
          blob.includes("google chrome") ||
          blob.includes("com.google.chrome")
        if (chromeHint) {
          const result = {
            success: false,
            error:
              "host_computer blocked on Chrome while tab leases are held — force-release tab leases first (ADR-015 Q4)",
            data: { error_code: "HOST_CHROME_TAB_LEASE" },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
      }
    } catch (gateErr: any) {
      // Fail closed: never skip multi-agent exclusivity on gate exception (ADR-015)
      logger.warn("orchestrator.gate_error", { error: gateErr?.message || String(gateErr) })
      const result = {
        success: false,
        error: `ORCHESTRATOR_GATE_ERROR: ${gateErr?.message || String(gateErr)}`,
        data: { error_code: "ORCHESTRATOR_GATE_ERROR" },
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }

    // Cookie trust domain gate — extracted to tool/url-cookie-admission.ts (C10-C)
    const cookieOutcome = runCookieTrustAdmission({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      logToolFinish,
      getDomainFromUrl,
    })
    if (!cookieOutcome.ok) return cookieOutcome.result

    // P1.0 browser_download: path sandbox + worker path policy BEFORE extension dispatch.
    // auto_approve_dangerous must NOT relax this (roots stay Downloads-only). No L2 for default Downloads.
    if (toolName === "browser_download") {
      let isWorker = false
      if (actingThreadId && threadManager) {
        try {
          const th = threadManager.get(actingThreadId) as any
          isWorker = th?.agent_role === "worker"
        } catch { /* ignore */ }
      }
      const prepared = prepareBrowserDownloadParams({ params: finalParams, isWorker })
      if (!prepared.ok) {
        const result = {
          success: false,
          error: prepared.error,
          data: prepared.data || { error_code: prepared.error_code },
        }
        logger.warn(
          prepared.error_code === "PATH_ESCAPE"
            ? "browser_download.path_escape"
            : prepared.error_code === "WORKER_PATH_DENIED"
              ? "browser_download.worker_path_denied"
              : "browser_download.rejected",
          { tool_call_id: toolCallId, error_code: prepared.error_code, is_worker: isWorker },
        )
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      finalParams = prepared.params
      logger.info("browser_download.start", {
        tool_call_id: toolCallId,
        tabId: finalParams.tabId,
        path_root: prepared.downloadPath,
        has_text: !!finalParams.text,
        has_selector: !!finalParams.selector,
        is_worker: isWorker,
      })
    }

    // L2 confirmation gate — extracted to tool/l2-admission.ts (C10-B)
    const l2Outcome = await runL2ToolAdmission({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      ws,
      sessionId,
      actingThreadId,
      isOutboundMcpCall,
      logToolFinish,
      securityConfirmations,
      getThreadManager: () => threadManager,
      getCachedTabUrl,
      getDomainFromUrl,
      computerRateLimiter,
      activeTrayConfirmsByWs,
      clients,
      wsAuthGet: (w) => wsAuth.get(w),
    })
    if (!l2Outcome.ok) {
      return l2Outcome.result
    }
    finalParams = l2Outcome.finalParams
    const winL2NonceChallenge = l2Outcome.winL2NonceChallenge
    const hostAppTier = l2Outcome.hostAppTier

    // URL scheme+domain gate — extracted to tool/url-cookie-admission.ts (C10-C)
    const urlOutcome = await runUrlNavigateAdmission({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      ws,
      isOutboundMcpCall,
      logToolFinish,
      securityConfirmations,
      clients,
      wsAuthGet: (w) => wsAuth.get(w),
    })
    if (!urlOutcome.ok) return urlOutcome.result

    // IMAGE_FETCH two-phase gate — extracted to tool/image-fetch-admission.ts (C10-D)
    const imageOutcome = await runImageFetchAdmission({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      ws,
      logToolFinish,
      securityConfirmations,
      dispatchToExtension,
    })
    if (imageOutcome !== null) {
      return imageOutcome
    }

    // Companion-side tools (executed locally, not forwarded to extension)
    const COMPANION_TOOLS = [
      "osascript_eval",
      "host_read",
      "host_write",
      "host_app",
      "host_cli",
      "host_computer",
      "use_skill",
      "thread_recall",
      "skill_install",
      "record_experience",
      "workspace_list_dir",
      "workspace_read_file",
      "ensure_project_dir",
      "shell_exec",
      "netsec_port_scan",
      // ADR-015 orchestrator
      "spawn_worker",
      "list_workers",
      "get_worker_status",
      "list_tab_locks",
      "collect_handback",
      "board_read",
      "board_complete",
      "board_claim_intent",
      "board_heartbeat_intent",
      "wait_workers",
      "worker_cancel",
      "ask_user",
    ]
    if (COMPANION_TOOLS.includes(toolName)) {
      try {
        // Thread id already injected by adapter as __thread_id (computer-use precedent)
        const result = await executeCompanionTool(toolName, finalParams, toolCallId, {
          // Propagate chat.abort / supersede so shell_exec can killProcessTree.
          signal,
          // Executor-internal confirmation channel (Phase 1 W8-windows
          // skip-L2 manual-nonce prompt). Adversary amendment A1: ALWAYS
          // origin-bound — a ws-bound send alone binds only the outbound
          // direction; without originWs any loopback WS peer could burn the
          // 3 nonce attempts (DoS).
          sendConfirmation: (details) =>
            securityConfirmations.request(
              (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(data))
                }
              },
              details,
              { originWs: ws },
            ),
          // Amendment A3: set only when the L2 dialog above carried this
          // challenge and was approved (respondFrom resolves "approved" for
          // a challenge-carrying request only after an exact match).
          prevalidatedNonce: winL2NonceChallenge,
          // App tab WP3: tier the gate decided for host_app (audit only).
          appLaunchTier: hostAppTier,
          // WP2 (§E.4): computer-task progress events go to every
          // authenticated panel (the owner's own live view).
          broadcast: broadcastToClients,
          // #au4dch B2: shell tool.progress tails stay on origin socket only
          sendOrigin: (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify(data))
              } catch {
                /* best-effort */
              }
            }
          },
          // Grill Q1: re-L2 trust key = thread:… when chat thread known.
          computerSessionId: (() => {
            try {
              const { resolveComputerTrustKey } = require("./computer/session-trust") as typeof import("./computer/session-trust")
              const tid =
                typeof (finalParams as any).__thread_id === "string"
                  ? String((finalParams as any).__thread_id)
                  : undefined
              return resolveComputerTrustKey(tid, sessionId)
            } catch {
              return sessionId
            }
          })(),
        })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      } catch (err: any) {
        const result = { success: false, error: err.message }
        logger.error("tool.exception", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
    }

    // MCP meta tools — Resources/Prompts access (executed locally via McpManager)
    if (toolName === "mcp_list_resources" || toolName === "mcp_read_resource" || toolName === "mcp_get_prompt") {
      try {
        const result = await executeMcpMetaTool(toolName, finalParams, sessionId, ws)
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      } catch (err: any) {
        const result = { success: false, error: err.message || String(err) }
        logger.error("tool.exception", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
    }

    // MCP namespaced tools — mcp__<server>__<tool>
    if (isMcpNamespaced(toolName)) {
      try {
        const result = await executeMcpTool(toolName, finalParams, sessionId, ws, startedAt, signal)
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      } catch (err: any) {
        const result = { success: false, error: err.message || String(err) }
        logger.error("tool.exception", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
    }

    // Send tool execution command to extension
    return new Promise((resolve, reject) => {
      const finishAndResolve = (result: any) => {
        // Refresh tab URL cache when list_tabs returns, so the evaluate
        // whitelist gate can resolve tabId → hostname on the next call.
        if (toolName === "list_tabs" && result?.success && Array.isArray(result.data)) {
          refreshTabUrlCache(result.data)
          // ADR-015: surface lease holders so LLMs avoid TAB_LOCKED retry storms
          try {
            const { lockMetaForTab } = require("./orchestrator/tab-lease") as typeof import("./orchestrator/tab-lease")
            result.data = result.data.map((t: any) => {
              if (!t || typeof t.id !== "number") return t
              const meta = lockMetaForTab(t.id)
              return {
                ...t,
                locked_by_thread_id: meta.locked_by_thread_id,
                lease_state: meta.lease_state,
                lease_expires_at: meta.lease_expires_at,
              }
            })
          } catch {
            /* ignore enrichment failures */
          }
        }
        // Synchronize cache after LLM-initiated navigation. A successful
        // navigate/set_tab_url means the cached URL for this tabId is now stale;
        // updating it prevents a prompt-injection attack where a malicious page
        // (or attacker-controlled agent flow) navigates a whitelisted tab to an
        // attacker domain and the next evaluate({tabId}) is auto-approved
        // against the OLD (still-whitelisted) hostname.
        // NOTE: page-initiated navigation via window.location is a residual risk
        // requiring chrome.tabs.onUpdated subscription on the extension side.
        if (
          result?.success === true &&
          (toolName === "navigate" || toolName === "set_tab_url") &&
          typeof finalParams.tabId === "number" &&
          typeof finalParams.url === "string"
        ) {
          tabUrlCache.set(finalParams.tabId, finalParams.url)
        }
        // Cache the new tab created by create_tab so the next evaluate({tabId})
        // can be domain-whitelisted without waiting for a fresh list_tabs.
        if (
          toolName === "create_tab" &&
          result?.success === true &&
          result.data &&
          typeof result.data.id === "number" &&
          typeof result.data.url === "string"
        ) {
          tabUrlCache.set(result.data.id, result.data.url)
          // ADR-015: auto HARD-hold new tab for multi-agent creators only.
          // Normal single-agent create_tab must not consume the per-worker lease
          // budget (max 2) — AppSec / multi-tab browse open many tabs.
          if (actingThreadId) {
            try {
              const {
                autoHoldCreatedTab,
                anyTabLeaseHeld,
              } = require("./orchestrator/tab-lease") as typeof import("./orchestrator/tab-lease")
              const { isMultiAgentThread } = require("./orchestrator") as typeof import("./orchestrator")
              const th = threadManager?.get(actingThreadId) as any
              if (isMultiAgentThread(th) || anyTabLeaseHeld()) {
                autoHoldCreatedTab(result.data.id, actingThreadId)
              }
            } catch {
              /* ignore */
            }
          }
        }
        if (toolName === "close_tab" && result?.success === true && typeof finalParams.tabId === "number") {
          try {
            const { releaseTabLease } = require("./orchestrator/tab-lease") as typeof import("./orchestrator/tab-lease")
            releaseTabLease(finalParams.tabId, "close_tab", actingThreadId)
          } catch {
            /* ignore */
          }
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        resolve(result)
      }
      const dispatchTimeoutMs = resolveToolDispatchTimeoutMs(toolName, finalParams)
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: `Tool execution timeout (${dispatchTimeoutMs}ms): ${toolName}` }
        logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: dispatchTimeoutMs })
        finishAndResolve(result)
      }, dispatchTimeoutMs)

      pendingToolCalls.set(toolCallId, {
        resolve: finishAndResolve,
        reject,
        timer,
        thread_id: actingThreadId,
        tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
        tool_name: toolName,
        originWs: ws,
      })

      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "tool.execute",
            tool_call_id: toolCallId,
            tool_name: toolName,
            params: finalParams,
          }))
        } catch (err: any) {
          clearTimeout(timer)
          pendingToolCalls.delete(toolCallId)
          const result = { success: false, error: `WebSocket send failed: ${err.message || String(err)}` }
          logger.error("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
          finishAndResolve(result)
        }
      } else {
        clearTimeout(timer)
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: "WebSocket not connected" }
        logger.warn("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: result.error })
        finishAndResolve(result)
      }
    })
  }
}

// Exported for integration tests (audit item 6).
export function handleToolResult(msg: any, fromWs?: WebSocket) {
  const { tool_call_id, result, error } = msg
  const pending = pendingToolCalls.get(tool_call_id)
  if (!pending) return
  // SEC-E: only the dispatch peer may resolve (prevents other loopback peers spoofing results)
  if (fromWs && pending.originWs && pending.originWs !== fromWs) {
    logger.warn("tool.result_origin_mismatch", {
      tool_call_id,
      tool_name: pending.tool_name,
    })
    return
  }
  clearTimeout(pending.timer)
  pendingToolCalls.delete(tool_call_id)
  if (error) {
    pending.resolve({ success: false, error: error.message || String(error) })
  } else {
    pending.resolve(result)
  }
}

/**
 * Dispatch a single tool execution to the extension and await its result via
 * the `pendingToolCalls` / `handleToolResult` correlation (same plumbing the
 * default forward branch uses). Factored out so the analyze_image two-phase
 * gate (§6.1) can issue a phase-1 resolve and a phase-2 fetch without
 * duplicating the send/timeout/pending-map dance. Resolves to a tool-result
 * object `{ success, data?, error? }`; never rejects (timeouts and send
 * failures are returned as `{ success: false, error }`).
 */
function dispatchToExtension(
  toolCallId: string,
  toolName: string,
  params: any,
  ws: WebSocket,
): Promise<{ success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { success: boolean; data?: any; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingToolCalls.delete(toolCallId)
      resolve(result)
    }
    const timer = setTimeout(() => {
      const result = { success: false, error: `Tool execution timeout (${TOOL_EXECUTION_TIMEOUT_MS}ms): ${toolName}` }
      logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: TOOL_EXECUTION_TIMEOUT_MS })
      finish(result)
    }, TOOL_EXECUTION_TIMEOUT_MS)
    pendingToolCalls.set(toolCallId, {
      resolve: finish as any,
      reject: finish as any,
      timer,
      tool_name: toolName,
      originWs: ws,
    })
    if (ws.readyState !== WebSocket.OPEN) {
      const result = { success: false, error: "WebSocket not connected" }
      logger.warn("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: result.error })
      finish(result)
      return
    }
    try {
      ws.send(JSON.stringify({ type: "tool.execute", tool_call_id: toolCallId, tool_name: toolName, params }))
    } catch (err: any) {
      const result = { success: false, error: `WebSocket send failed: ${err.message || String(err)}` }
      logger.error("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
      finish(result)
    }
  })
}

/**
 * Process a `security.confirmation.response` from a WS peer: resolve the
 * pending confirmation (origin-bound via respondFrom), then — only when this
 * response is authoritative AND approved — persist the add_to_whitelist
 * patterns into auto_approved_domains. Patterns are validated against the
 * domains actually shown in the dialog, so a loopback peer cannot ship
 * ["*", "*.com", "attacker.com"] and poison the gate.
 *
 * Extracted from the ws.on("message") handler in startServer() so integration
 * tests can exercise the persistence path (the extension's add_to_whitelist
 * forwarding) without booting the full server. Logic is unchanged.
 */
export async function handleSecurityConfirmationResponse(ws: WebSocket, msg: any, sessionId?: string): Promise<void> {
  const confirmationId = String(msg.confirmation_id || "")
  const approved = msg.approved === true
  // stop_thread: Confirm Center "stop" — deny confirm AND authoritatively
  // abort+drain the stamped worker (do not rely solely on client chat.abort).
  const stopThread = msg.stop_thread === true
  const clientStopThreadId =
    typeof msg.stop_thread_id === "string" && msg.stop_thread_id.length > 0
      ? String(msg.stop_thread_id)
      : undefined

  // Validate add_to_whitelist against the domains actually shown in the
  // dialog. Without this check, any loopback WS peer could ship a
  // crafted response with add_to_whitelist: ["*", "*.com", "attacker.com"]
  // and permanently bypass the dangerous-tool gate.
  const rawWhitelist: string[] = Array.isArray(msg.add_to_whitelist)
    ? msg.add_to_whitelist.map((p: any) => String(p || "").trim()).filter(Boolean)
    : []
  const relevantDomains = securityConfirmations.getRelevantDomains(confirmationId) || []
  const allowedPatterns = new Set<string>()
  for (const d of relevantDomains) {
    const lower = d.toLowerCase()
    allowedPatterns.add(lower)
    allowedPatterns.add(`*.${lower}`)
  }
  const validPatterns: string[] = []
  const rejectedPatterns: string[] = []
  for (const p of rawWhitelist) {
    if (allowedPatterns.has(p.toLowerCase())) {
      validPatterns.push(p)
    } else {
      rejectedPatterns.push(p)
    }
  }
  if (rejectedPatterns.length > 0) {
    logger.warn("security.whitelist.invalid_patterns_rejected", {
      confirmation_id: confirmationId,
      relevant_domains: relevantDomains,
      rejected: rejectedPatterns,
    })
  }

  // Phase 1 W7 — Validate add_to_thread_whitelist (boolean) for host_use tools.
  // Validates the requested bundle id against relevantApps originally shown.
  // Same anti-injection contract as add_to_whitelist above.
  const rawThreadWhitelist: boolean = msg.add_to_thread_whitelist === true
  const relevantApps = securityConfirmations.getRelevantApps(confirmationId) || []
  // Capture metadata BEFORE respondFrom() deletes the pending entry.
  const confirmationToolName = securityConfirmations.getToolName(confirmationId)
  const stampedWorkerId = securityConfirmations.getWorkerId(confirmationId)
  let threadWhitelistApp: string | null = null
  if (rawThreadWhitelist && relevantApps.length > 0) {
    // The first (and currently only) relevant app is what the user was shown.
    // User cannot type a different bundle id — the checkbox is grayed-out
    // pre-filled by the extension UI.
    threadWhitelistApp = relevantApps[0]
  } else if (rawThreadWhitelist && relevantApps.length === 0) {
    // WS injection attempt: client sent add_to_thread_whitelist=true for a
    // confirmation that didn't show any app checkbox.
    logger.warn("security.thread_whitelist.relevant_apps_missing", {
      confirmation_id: confirmationId,
    })
  }

  // Resolve the confirmation FIRST so a saveConfig failure cannot hang the
  // approved tool call. Persistence runs after, best-effort. By the time the
  // LLM's next tool call reaches the whitelist gate (next macrotask),
  // fs.writeFileSync has completed.
  //
  // Phase 1 W8-windows / W9: pass the typed manual nonce into respondFrom.
  // The extension sends nonce_response (uppercased by the UI); matching is
  // case-insensitive. Adversary amendment A4: nonce_retry / nonce_locked are
  // dedicated audit events and must NOT be lumped into
  // origin_mismatch_or_unknown.
  const nonceResponse = typeof msg.nonce_response === "string" ? msg.nonce_response : undefined
  // Grill Q2: host_computer session auto-approve checkbox (validated in respondFrom
  // against relevantApps non-empty).
  const addToSessionTrust = msg.add_to_session_trust === true
  const addToEnterpriseSessionTrust = msg.add_to_enterprise_session_trust === true
  // stop_thread always resolves as deny (even if client sent approved:true)
  const effectiveApproved = stopThread ? false : approved
  const respondResult = securityConfirmations.respondFrom(confirmationId, effectiveApproved, ws, nonceResponse, {
    addToSessionTrust: stopThread ? false : addToSessionTrust,
    addToEnterpriseSessionTrust: stopThread ? false : addToEnterpriseSessionTrust,
  })
  const responded = respondResult.outcome === "resolved"
  if (respondResult.outcome === "unknown" || respondResult.outcome === "origin_mismatch") {
    // Either no such pending entry, or the response arrived on a different
    // socket than the one the confirmation was issued to. [C-SEC-2]: do not
    // silently drop — log so operators can spot the pattern (e.g., a rogue
    // local process trying to self-approve).
    logger.warn("security.confirmation.origin_mismatch_or_unknown", {
      confirmation_id: confirmationId,
      approved_requested: approved,
      stop_thread: stopThread,
    })
  } else if (respondResult.outcome === "nonce_retry") {
    // Wrong code typed — entry stays pending; the client got a
    // security.confirmation.nonce_retry with attempts_left.
    logger.warn("security.confirmation.nonce_retry", {
      confirmation_id: confirmationId,
      attempts_left: respondResult.attemptsLeft,
    })
  } else if (respondResult.outcome === "nonce_locked") {
    // Max attempts exhausted — confirmation resolved denied.
    logger.warn("security.confirmation.nonce_locked", {
      confirmation_id: confirmationId,
      attempts_left: 0,
      reason: "max nonce attempts exceeded",
    })
  }

  // ADR-015 GATE1/GATE2: authoritative stop — abort LLM + reject pending + release leases.
  // Prefer server-stamped worker_id over client stop_thread_id (anti-wrong-target).
  // Note: this response already denied the *current* confirmation via respondFrom;
  // rejectForWorker clears any *other* open confirms for the same worker.
  if (stopThread && responded) {
    const stopTarget =
      (stampedWorkerId && stampedWorkerId.length > 0 ? stampedWorkerId : undefined) ||
      clientStopThreadId
    if (stopTarget) {
      try {
        // G13: abandon intents before pending reject + lease release
        let intentsAbandoned = 0
        try {
          const { abandonWorkerIntents } = await import("./board")
          const ab = await abandonWorkerIntents(threadManager, stopTarget, {
            reason: "stop_thread",
          })
          intentsAbandoned = ab.abandoned
        } catch {
          /* best-effort */
        }
        const confirmsRejected = securityConfirmations.rejectForWorker(stopTarget, "denied")
        const rejected = rejectPendingForThread(stopTarget, `stop_thread:${confirmationId}`)
        const { releaseLeasesForThreadPendingAware } = await import("./orchestrator/tab-lease")
        const { released, drained } = releaseLeasesForThreadPendingAware(
          stopTarget,
          `stop_thread:${confirmationId}`,
          { hasPendingForTab, rejectPendingForTab },
        )
        try {
          const { abortThreadChat } = await import("./message-router")
          if (typeof abortThreadChat === "function") abortThreadChat(stopTarget)
        } catch {
          /* optional if router not loaded */
        }
        // stop_thread must also kill in-flight shell_exec (same gap as chat.abort)
        try {
          const { abortShellRunsForThread } = await import("./capability/shell")
          const shellKilled = abortShellRunsForThread(stopTarget)
          if (shellKilled > 0) {
            logger.warn("shell.abort.stop_thread", {
              stop_target: stopTarget,
              matched: shellKilled,
            })
          }
        } catch {
          /* best-effort */
        }
        logger.info("security.confirmation.stop_thread", {
          confirmation_id: confirmationId,
          stop_target: stopTarget,
          stamped_worker_id: stampedWorkerId || null,
          client_stop_thread_id: clientStopThreadId || null,
          rejected_pending: rejected,
          leases_released: released,
          confirms_rejected: confirmsRejected,
          leases_drained: drained,
          intents_abandoned: intentsAbandoned,
        })
      } catch (err: any) {
        logger.warn("security.confirmation.stop_thread_failed", {
          confirmation_id: confirmationId,
          stop_target: stopTarget,
          error: err?.message || String(err),
        })
      }
    } else {
      logger.warn("security.confirmation.stop_thread_no_target", {
        confirmation_id: confirmationId,
      })
    }
  }

  // Only persist whitelist additions when the confirmation was actually
  // resolved by THIS response. If respondFrom returned false (origin mismatch,
  // unknown id, or already-expired entry), the response is not authoritative —
  // accepting its add_to_whitelist payload would let any loopback WS peer that
  // can guess a confirmation_id poison auto_approved_domains without ever
  // resolving the prompt.
  if (responded && effectiveApproved && validPatterns.length > 0) {
    try {
      const current = getConfig().auto_approved_domains || []
      const seen = new Set(current.map((d: string) => d.toLowerCase()))
      // Lowercase + dedupe on persist. validPatterns is already validated
      // case-insensitively, so storing the lowercase form keeps config tidy
      // (matchDomain lowercases both sides, so matching is unaffected). Adding
      // to `seen` as we go also dedupes within this single response.
      const newPatterns: string[] = []
      for (const p of validPatterns) {
        const lower = p.toLowerCase()
        if (!seen.has(lower)) {
          seen.add(lower)
          newPatterns.push(lower)
        }
      }
      if (newPatterns.length > 0) {
        saveConfig({ auto_approved_domains: [...current, ...newPatterns] })
        logger.info("security.whitelist.added", {
          confirmation_id: confirmationId,
          patterns: newPatterns,
        })
      }
    } catch (err: any) {
      // Persistence is best-effort — don't fail the tool call.
      logger.error("security.whitelist.persist_failed", {
        confirmation_id: confirmationId,
        error: err?.message || String(err),
      })
    }
  } else if (!responded && validPatterns.length > 0) {
    // Defensive: log every attempt to add via a non-authoritative response so
    // operators can spot a peer probing confirmation ids.
    logger.warn("security.whitelist.add_ignored_non_authoritative", {
      confirmation_id: confirmationId,
      valid_patterns: validPatterns,
    })
  }

  // Phase 1 W7 — Record thread-scoped trust when user approved with
  // add_to_thread_whitelist=true. Only for read operations (Q1 blocker:
  // writes always require biometric per call, never thread-trusted).
  if (responded && effectiveApproved && threadWhitelistApp) {
    const toolName = confirmationToolName
    if (toolName === "host_read" && sessionId) {
      getThreadApprovals().add(sessionId, threadWhitelistApp, "read")
      logger.info("security.thread_whitelist.added", {
        confirmation_id: confirmationId,
        thread_id: sessionId,
        bundle_id: threadWhitelistApp,
        kind: "read",
      })
    } else if (toolName === "host_app" && sessionId) {
      // App tab WP3 — owner decision 2 (2026-07-18, W7 Blocker-1 amendment):
      // L0 no-arg app launch MAY be thread-trusted under kind "app-launch".
      // Reachable only when the gate offered the checkbox (policy "ai" —
      // "manual" never offers it; the checkbox payload is validated against
      // the relevantApps shown, so an injected grant for a manual app is
      // impossible here). The gate additionally never consults trust for
      // "manual", and apps.remove/set_policy/set_enabled(false) clear it.
      getThreadApprovals().add(sessionId, threadWhitelistApp, "app-launch")
      logger.info("security.thread_whitelist.added", {
        confirmation_id: confirmationId,
        thread_id: sessionId,
        bundle_id: threadWhitelistApp,
        kind: "app-launch",
      })
    } else if (toolName === "host_write") {
      // Q1 ship blocker: writes NEVER thread-trust. Log rejection so
      // operators can spot a buggy/malicious client attempting bypass.
      logger.warn("security.thread_whitelist.write_rejected", {
        confirmation_id: confirmationId,
        bundle_id: threadWhitelistApp,
        reason: "biometric per-call is non-negotiable for writes (W7 Q1 blocker)",
      })
    }
  }
}

/**
 * Grace-period cleanup applied when a WebSocket connection drops mid-tool-call.
 * Replaces each pending tool's normal timeout timer with a shorter (5s) grace
 * timer that rejects with "WebSocket disconnected" — giving a reconnecting
 * extension a brief window to deliver a late tool.result.
 *
 * Extracted from ws.on("close") in startServer() so integration tests can
 * exercise the cleanup path (audit item 6) without spinning up the full server.
 */
const WS_DISCONNECT_GRACE_MS = 5000
/**
 * SEC-E: when `closedWs` is set, only grace-kill pending tools owned by that
 * socket. Global (no arg) still drains all — reserved for process shutdown.
 */
export function applyConnectionCloseGracePeriod(closedWs?: WebSocket): void {
  for (const [id, pending] of pendingToolCalls) {
    if (closedWs && pending.originWs && pending.originWs !== closedWs) {
      continue
    }
    // Legacy entries without originWs: only kill on global drain, or if no other clients
    if (closedWs && !pending.originWs) {
      // Prefer not to kill unscoped entries on a single peer close (safe default)
      continue
    }
    clearTimeout(pending.timer)
    logger.warn("tool.connection_closed", {
      tool_call_id: id,
      scoped: !!closedWs,
    })
    pending.timer = setTimeout(() => {
      if (pendingToolCalls.has(id)) {
        pendingToolCalls.delete(id)
        pending.resolve({ success: false, error: "WebSocket disconnected" })
      }
    }, WS_DISCONNECT_GRACE_MS)
  }
}

// --- Companion-side tool executor (runs locally, not forwarded to extension) ---

// --- Companion tool dispatch (C10-B: body in tool/companion-dispatch.ts) ---
// FREEZE: NEW companion-side tool cases go in tool/companion-dispatch.ts (or a
// dedicated capability/* module), not back into server.ts.
import {
  bindCompanionDispatchRuntime,
  executeCompanionTool,
  type CompanionToolExecOptions,
  type CompanionDispatchRuntime,
} from "./tool/companion-dispatch"
export type { CompanionToolExecOptions, CompanionDispatchRuntime }
export { bindCompanionDispatchRuntime, executeCompanionTool }

function bindCompanionDispatchFromServerLocals(): void {
  bindCompanionDispatchRuntime({
    getThreadManager: () => threadManager,
    getSkillEngine: () => skillEngine,
    getCachedTabUrl,
    getTabUrlCache: () => tabUrlCache,
    computerTaskAbort,
    computerRateLimiter,
    getComputerRateLimiterSingleton: () => computerRateLimiterSingleton,
    securityConfirmations,
    getComputerEstopEnsureOverride: () => computerEstopEnsureOverride,
    rejectPendingForThread,
    hasPendingForTab,
    rejectPendingForTab,
  })
}


// --- MCP tool executors ---

/**
 * Execute an MCP namespaced tool (mcp__<server>__<tool>). Enforces the per-server
 * trust_level policy: manual = always prompt, first-use = prompt once per session,
 * trusted = never prompt for non-critical. Critical caps (file-write/exec/…) still
 * force L2 unless full-autonomy cruise (三旗). Approval cache is session-scoped.
 */
async function executeMcpTool(
  toolName: string,
  params: any,
  sessionId: string,
  ws: WebSocket,
  startedAt: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const manager = getMcpManager()
  const route = manager.resolveToolName(toolName)
  if (!route) {
    return { success: false, error: `MCP tool ${toolName} not found (server may be disconnected)` }
  }

  // Manual MCP selection must gate dispatch (not only LLM catalog filtering).
  try {
    const actingTid =
      typeof (params as any)?.__thread_id === "string"
        ? String((params as any).__thread_id)
        : sessionId
    const thr = actingTid ? threadManager.get(actingTid) : null
    const mode = thr?.mcp_selection_mode || "auto"
    if (mode === "manual") {
      const active = new Set(thr?.active_mcp_server_ids || [])
      if (!active.has(route.serverName)) {
        return {
          success: false,
          error: `MCP server "${route.serverName}" is not in this thread's active selection (mcp_selection_mode=manual)`,
        }
      }
    }
  } catch {
    /* unexpected thread lookup — fail closed below only when mode is known */
  }

  const configuredTrustLevel = manager.getTrustLevel(route.serverName) ?? "first-use"
  // Audit item 8: destructive-looking tool names ALWAYS require per-call confirmation,
  // regardless of the server's configured trust_level. A first-use approval for a
  // filesystem-write tool shouldn't auto-apply to the next 10 write/delete calls —
  // that's exactly the prompt-injection amplification path the audit flagged.
  const isDestructiveName = DESTRUCTIVE_MCP_TOOL_PATTERN.test(route.toolName)
  const trustLevel = isDestructiveName ? "manual" : configuredTrustLevel
  if (isDestructiveName && configuredTrustLevel !== "manual") {
    logger.warn("mcp.destructive_force_manual", {
      server: route.serverName, tool: route.toolName,
      configured: configuredTrustLevel, effective: "manual",
    })
  }

  const cache = getMcpConfirmCache()
  const cacheKey = { sessionId, serverName: route.serverName, toolName: route.toolName }

  const needsConfirm =
    trustLevel === "manual" ||
    (trustLevel === "first-use" && !cache.isApproved(cacheKey))

  // §6.3 MCP_CAPABILITY_GATE (follow-up C): capability classification that
  // survives trusted/first-use-cache/god-mode — mirror of §6.2. Even a `trusted`
  // server or a first-use-cached tool must confirm when the call touches a
  // critical capability (file-write/exec/network-egress/db-mutate/unknown).
  // god-mode / trust_level bypass the UI prompt, not this capability boundary
  // (same invariant as §6.1.5/§6.2). Without this, a `trusted` filesystem
  // server's `save_file` (name evades DESTRUCTIVE_MCP_TOOL_PATTERN) or a
  // `fetch_data` tool called with an attacker URL would execute zero-confirmation.
  //
  // Phase 2-B: merge the server's user-declared `security_capabilities`
  // (primary source) with classifyMcpCall inference (defense-in-depth) via
  // mergeCapabilities. Fail-safe union (Option C, kimi-approved): a positively-
  // inferred critical capability can NEVER be suppressed by a declaration; a
  // declaration only escalates or resolves the "unknown" sentinel.
  const declaredCaps = manager.getServerConfig(route.serverName)?.security_capabilities
  const mcpMerged = mergeCapabilities(classifyMcpCall(route.toolName, params), declaredCaps)
  const mcpCaps = mcpMerged.capabilities
  const forceMcpConfirm = mcpCaps.some(c => CRITICAL_MCP_CAPABILITIES.has(c))
  // Full autonomy cruise (三旗: auto_approve_dangerous + enterprise + allow_all_schemes)
  // — same algebra as shell_exec / §6.2 forceConfirm waive. God-mode or enterprise
  // alone still force critical MCP confirms (including file-write). Product: user
  // opted into max residual risk; do not keep a second silent deny path for MCP writes.
  const securityConfigEarly = getConfig().security
  const userFullAutonomyCruise =
    securityConfigEarly?.auto_approve_dangerous === true &&
    securityConfigEarly?.auto_approve_enterprise_tools === true &&
    securityConfigEarly?.allow_all_schemes === true
  // kimi suggestion: make the trust grant auditable. When a declaration RESOLVED
  // an "unknown" (inference found nothing, user vouched), warn so it's traceable.
  if (mcpMerged.declaredResolvedUnknown) {
    logger.warn("mcp.declared_resolved_unknown", {
      server: route.serverName,
      tool: route.toolName,
      declared: declaredCaps,
      trust_level: trustLevel,
    })
  }

  if ((needsConfirm || forceMcpConfirm) && userFullAutonomyCruise) {
    logger.info("mcp.confirm.waived", {
      server: route.serverName,
      tool: route.toolName,
      trust_level: trustLevel,
      session: sessionId,
      capabilities: mcpCaps,
      declared_capabilities: declaredCaps ?? [],
      force_confirm_would_have: forceMcpConfirm,
      needs_confirm_would_have: needsConfirm,
      reason: "full_autonomy_cruise",
    })
  } else if (needsConfirm || forceMcpConfirm) {
    if (ws.readyState !== WebSocket.OPEN) {
      return {
        success: false,
        error: `Security Block: MCP tool ${route.serverName}/${route.toolName} cannot be confirmed (extension disconnected)`,
      }
    }
    const securityConfig = getConfig().security
    logger.info("mcp.confirm.requested", {
      server: route.serverName,
      tool: route.toolName,
      trust_level: trustLevel,
      session: sessionId,
      capabilities: mcpCaps,
      declared_capabilities: declaredCaps ?? [],
      force_confirm: forceMcpConfirm,
    })
    const decision = await securityConfirmations.request(
      (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data))
        }
      },
      {
        toolName,
        dangerousApis: mcpCaps,
        code: safeJsonStringify(params, 1200),
        riskLevel: "medium",
        ...(forceMcpConfirm ? { criticalApis: mcpCaps, riskLevel: "high" as const, autoConfirmEligible: false } : {}),
      },
      // Trust multi-peer (P1-2): MCP tool confirm bound to requesting socket.
      { originWs: ws },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      if (forceMcpConfirm) {
        logger.warn("security.mcp_critical_denied", {
          server: route.serverName,
          tool: route.toolName,
          capabilities: mcpCaps,
          declared_capabilities: declaredCaps ?? [],
          god_mode_active: securityConfig.allow_all_schemes === true,
          auto_approve_active: securityConfig.auto_approve_dangerous === true,
          trust_level: trustLevel,
          reason,
        })
      }
      return {
        success: false,
        error: `Security Block: MCP tool ${route.serverName}/${route.toolName} ${reason} by user`,
      }
    }
    // Only cache first-use approvals for NON-critical calls. Critical calls
    // (forceMcpConfirm) confirm every time — args can change between calls, and
    // a cached approval must not auto-apply to a later destructive invocation
    // (mirror of DESTRUCTIVE_MCP_TOOL_PATTERN → manual at server.ts:1117).
    if (trustLevel === "first-use" && !forceMcpConfirm) {
      cache.approve(cacheKey)
    }
    logger.info("mcp.confirm.approved", { server: route.serverName, tool: route.toolName })
    if (forceMcpConfirm) {
      logger.warn("security.mcp_critical_confirmed", {
        server: route.serverName,
        tool: route.toolName,
        capabilities: mcpCaps,
        declared_capabilities: declaredCaps ?? [],
        god_mode_active: securityConfig.allow_all_schemes === true,
        auto_approve_active: securityConfig.auto_approve_dangerous === true,
        trust_level: trustLevel,
      })
    }
  } else if (trustLevel === "first-use") {
    // Audit item 8: count this invocation against the per-tool approval's call cap.
    // When the cap (default 10) is hit, the next isApproved() returns false and
    // the user is re-prompted. recordCall is a no-op for bulk-trust / manual paths.
    // (forceMcpConfirm is false here — critical calls never reach this branch.)
    cache.recordCall(cacheKey)
  }

  const callStartedAt = Date.now()
  const runOnce = async (): Promise<{ success: boolean; data?: any; error?: string; rawErr?: string }> => {
    try {
      const result = await manager.callTool(route, params || {}, signal)
      if (result?.isError) {
        const errMsg = extractMcpError(result)
        return {
          success: false,
          rawErr: errMsg,
          error: enhanceMcpError(
            `MCP ${route.serverName}/${route.toolName} returned error: ${errMsg}`,
            route,
            params,
          ),
        }
      }
      return { success: true, data: result?.content ?? result }
    } catch (err: any) {
      const rawErr = err?.message || String(err)
      return { success: false, rawErr, error: enhanceMcpError(rawErr, route, params) }
    }
  }

  let outcome = await runOnce()
  const durationMs = Date.now() - callStartedAt

  // P2: access denied under home → L2 offer to add allow-dir, then one retry
  if (!outcome.success && outcome.rawErr) {
    const expanded = await tryExpandFilesystemAllowDirOnDenial({
      route,
      params,
      rawErr: outcome.rawErr,
      toolName,
      ws,
    })
    if (expanded.retried) {
      if (expanded.ok) {
        outcome = await runOnce()
      } else if (expanded.error) {
        outcome = {
          success: false,
          error: enhanceMcpError(expanded.error, route, params),
        }
      }
    }
  }

  broadcastToClients({
    type: "mcp.tool_call_finished",
    serverName: route.serverName,
    toolName: route.toolName,
    namespacedName: toolName,
    durationMs: Date.now() - callStartedAt,
    success: !!outcome.success,
    ...(outcome.success ? {} : { error: outcome.error }),
  })
  if (outcome.success) return { success: true, data: outcome.data }
  return { success: false, error: outcome.error || "MCP call failed" }
}

/**
 * When MCP filesystem denies a path under the user home, ask the user (L2) whether
 * to add that directory to the server's allowlist, then hot-reload + signal retry.
 */
async function tryExpandFilesystemAllowDirOnDenial(opts: {
  route: { serverName: string; toolName: string }
  params: any
  rawErr: string
  toolName: string
  ws: WebSocket
}): Promise<{ retried: boolean; ok?: boolean; error?: string }> {
  const { canOfferAllowDirExpand, addFilesystemAllowDir } = await import("./mcp/allow-dir-expand")

  // Pre-check filesystem server + home path BEFORE L2 (Pi nit: no misleading prompt)
  const pre = canOfferAllowDirExpand({
    serverName: opts.route.serverName,
    rawErr: opts.rawErr,
    params: opts.params,
  })
  if (!pre.offer) {
    // Not applicable — leave original error; do not claim we retried
    return { retried: false }
  }

  if (opts.ws.readyState !== WebSocket.OPEN) {
    return {
      retried: true,
      ok: false,
      error:
        `MCP path denied (${pre.dir}); extension disconnected — cannot ask to expand allowlist. ` +
        `Open Side Panel → MCP to add the path manually. Underlying: ${opts.rawErr}`,
    }
  }

  logger.info("mcp.allow_dir.propose", {
    server: opts.route.serverName,
    tool: opts.route.toolName,
    dir: pre.dir,
  })

  const decision = await securityConfirmations.request(
    (data) => {
      if (opts.ws.readyState === WebSocket.OPEN) opts.ws.send(JSON.stringify(data))
    },
    {
      toolName: opts.toolName,
      dangerousApis: ["mcp-allow-dir-expand"],
      code:
        `允许 MCP filesystem 访问目录：\n${pre.dir}\n\n` +
        `仅把该目录加入 allowlist（可在主目录内或之外；不会放开整盘/系统目录）。拒绝则保持当前配置。`,
      riskLevel: "medium",
      autoConfirmEligible: false,
      criticalApis: ["mcp-allow-dir-expand"],
    },
    { originWs: opts.ws },
  )

  if (!decision.approved) {
    logger.info("mcp.allow_dir.denied", { dir: pre.dir, reason: decision.reason })
    return {
      retried: true,
      ok: false,
      error:
        `User declined adding MCP allow-dir ${pre.dir}. Access denied. Underlying: ${opts.rawErr}`,
    }
  }

  const added = await addFilesystemAllowDir(opts.route.serverName, pre.dir)
  if (!added.ok) {
    return {
      retried: true,
      ok: false,
      error: `Failed to expand allow-dir: ${added.error}. Underlying: ${opts.rawErr}`,
    }
  }
  logger.info("mcp.allow_dir.added", { server: opts.route.serverName, dir: pre.dir })
  return { retried: true, ok: true }
}

/**
 * Wrap a raw MCP error message with an actionable hint for the LLM. The LLM
 * has no signal whether to retry (transient), narrow the request (too much
 * data), or skip the tool entirely without these hints — bare "MCP call failed:
 * MCP timeout" leaves it to guess, and the default guess is identical retry.
 *
 * Exported for unit tests (audit item 18).
 */
export function enhanceMcpError(
  rawErr: string,
  route: { serverName: string; toolName: string },
  params: any,
): string {
  const ctx = `MCP ${route.serverName}/${route.toolName}`
  // Timeout — the server may be slow / busy / hung. Suggest retry + narrowing.
  if (/MCP timeout/i.test(rawErr)) {
    const argHint = params && typeof params === "object" && Object.keys(params).length > 0
      ? " or try smaller/simpler arguments"
      : ""
    return `MCP call to ${ctx} timed out. The server may be slow, busy, or hung. You can retry once${argHint}, or skip this tool and continue. Underlying error: ${rawErr}`
  }
  // Abort (chat.abort fired or external cancellation)
  if (/MCP call aborted/i.test(rawErr)) {
    return `MCP call to ${ctx} was cancelled (likely because the user clicked stop or a new chat replaced this one). Do not retry automatically; wait for the user's next instruction.`
  }
  // Server not connected / disconnected mid-call — usually transient (restart
  // in progress, or applyConfig diff triggered a stop+start).
  if (/not connected|Connection Closed|disconnect|EPIPE|ECONNRESET/i.test(rawErr)) {
    return `MCP server ${route.serverName} is unavailable right now (status: disconnected / restarting). Wait a moment and retry, or pick a different tool. Underlying error: ${rawErr}`
  }
  // Server-not-found — config issue, not transient.
  if (/MCP server .* not found/i.test(rawErr)) {
    return `${rawErr} This usually means the server was removed from the config or has not finished starting yet. Check the MCP panel and retry.`
  }
  // Capability-gating error — caller is asking for something the server doesn't support.
  if (/does not advertise/i.test(rawErr)) {
    return `${rawErr} Use a different tool that the server actually exposes.`
  }
  // Official filesystem server: create nested path without parents (thread 6zhrh6).
  // Keep tokens "parent directory" / "does not exist" for classifyError recoverability.
  // Write-like tools get mkdir guidance; read tools get "path missing / list parent" (Pi nit 5).
  if (/parent directory does not exist/i.test(rawErr) || /ENOENT/i.test(rawErr)) {
    const pathHint =
      params && typeof params === "object"
        ? String((params as any).path || (params as any).parent || "")
        : ""
    const pathPart = pathHint ? ` (path: ${pathHint})` : ""
    const writeLike = /write|create|mkdir|move|copy|edit|append|delete|remove|unlink|rename|put|save/i.test(
      route.toolName || "",
    )
    if (writeLike || /parent directory does not exist/i.test(rawErr)) {
      return (
        `MCP filesystem path missing parent${pathPart}. ` +
        `parent directory does not exist — call ensure_project_dir first, or create_directory ` +
        `on each missing segment under an allowed root, then retry the write. ` +
        `Do not invent paths outside MCP allow-dirs. Underlying: ${rawErr}`
      )
    }
    return (
      `MCP filesystem path not found${pathPart}. ` +
      `List the parent directory or correct the path, then retry. Underlying: ${rawErr}`
    )
  }
  // Path outside allowlist — user may need MCP panel allow-dir (not god-mode).
  if (
    /access denied|not allowed|outside|allowed director/i.test(rawErr) ||
    /path.*not.*within/i.test(rawErr)
  ) {
    return (
      `MCP ${route.serverName} denied path access (not in allowlist or roots). ` +
      `Ask the user to open Side Panel → MCP → edit filesystem server → add the parent directory ` +
      `to allow paths (or use a path under already-allowed roots such as home). ` +
      `God-mode does not expand MCP allow-dirs. Underlying: ${rawErr}`
    )
  }
  // Fallback — keep the original but prefix with context so the LLM knows which
  // server/tool produced it (multi-server setups would otherwise be ambiguous).
  return `MCP call to ${ctx} failed: ${rawErr}`
}

/** Execute mcp_list_resources / mcp_read_resource / mcp_get_prompt.
 *
 *  §6.3 Phase 2-A (follow-up C): this is a SEPARATE MCP dispatch path from
 *  executeMcpTool — the meta-tools are not namespaced (`isMcpNamespaced` is
 *  false), so Phase 1's capability gate never saw them. Historically this
 *  function had NO gate at all, so `mcp_read_resource({server, uri})` read
 *  arbitrary URIs (file:///etc/passwd, data:, http://…) on a trusted server
 *  zero-confirmation. Now: mcp_read_resource / mcp_get_prompt force-confirm
 *  (CRITICAL_MCP_META_TOOLS, never cached, god-mode-unaware — mirror of Phase 1);
 *  mcp_list_resources is gated purely by trust_level (D8-consistent). */
async function executeMcpMetaTool(
  toolName: string,
  params: any,
  sessionId: string,
  ws: WebSocket,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const manager = getMcpManager()
  const args = params || {}
  const serverName = String(args.server || "").trim()
  if (!serverName) return { success: false, error: "MCP server name is required" }

  const forceMetaConfirm = CRITICAL_MCP_META_TOOLS.has(toolName)
  const configuredTrustLevel = manager.getTrustLevel(serverName) ?? "first-use"
  const cache = getMcpConfirmCache()
  const cacheKey = { sessionId, serverName, toolName }
  const needsConfirm =
    forceMetaConfirm ||
    configuredTrustLevel === "manual" ||
    (configuredTrustLevel === "first-use" && !cache.isApproved(cacheKey))
  const securityConfigMeta = getConfig().security
  const userFullAutonomyCruiseMeta =
    securityConfigMeta?.auto_approve_dangerous === true &&
    securityConfigMeta?.auto_approve_enterprise_tools === true &&
    securityConfigMeta?.allow_all_schemes === true

  if (needsConfirm && userFullAutonomyCruiseMeta) {
    logger.info("mcp.meta.confirm.waived", {
      tool: toolName,
      server: serverName,
      trust_level: configuredTrustLevel,
      session: sessionId,
      force_confirm_would_have: forceMetaConfirm,
      reason: "full_autonomy_cruise",
    })
  } else if (needsConfirm) {
    if (ws.readyState !== WebSocket.OPEN) {
      return {
        success: false,
        error: `Security Block: MCP meta-tool ${toolName} (${serverName}) cannot be confirmed (extension disconnected)`,
      }
    }
    const securityConfig = securityConfigMeta
    // Capability label for the audit/UI (the meta-tool's operation kind).
    const metaCap = toolName === "mcp_read_resource" ? "resource-read" : "prompt-injection"
    logger.info("mcp.meta.confirm.requested", {
      tool: toolName, server: serverName, trust_level: configuredTrustLevel,
      session: sessionId, force_confirm: forceMetaConfirm,
    })
    const decision = await securityConfirmations.request(
      (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)) },
      {
        toolName,
        dangerousApis: forceMetaConfirm ? [metaCap] : [],
        code: safeJsonStringify(params, 1200),
        riskLevel: forceMetaConfirm ? "high" : "medium",
        ...(forceMetaConfirm ? { criticalApis: [metaCap], autoConfirmEligible: false } : {}),
      },
      // Trust multi-peer (P1-2): MCP meta confirm bound to requesting socket.
      { originWs: ws },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      if (forceMetaConfirm) {
        logger.warn("security.mcp_meta_critical_denied", {
          tool: toolName, server: serverName,
          god_mode_active: securityConfig.allow_all_schemes === true,
          auto_approve_active: securityConfig.auto_approve_dangerous === true,
          trust_level: configuredTrustLevel, reason,
        })
      }
      return {
        success: false,
        error: `Security Block: MCP meta-tool ${toolName} (${serverName}) ${reason} by user`,
      }
    }
    // Only cache first-use approvals for NON-critical meta-tools (mcp_list_resources).
    // Critical meta-tools confirm every time (never cached).
    if (configuredTrustLevel === "first-use" && !forceMetaConfirm) {
      cache.approve(cacheKey)
    }
    if (forceMetaConfirm) {
      logger.warn("security.mcp_meta_critical_confirmed", {
        tool: toolName, server: serverName,
        god_mode_active: securityConfig.allow_all_schemes === true,
        auto_approve_active: securityConfig.auto_approve_dangerous === true,
        trust_level: configuredTrustLevel,
      })
    }
  } else if (configuredTrustLevel === "first-use") {
    cache.recordCall(cacheKey)
  }

  try {
    switch (toolName) {
      case "mcp_list_resources": {
        const resources = await manager.listResources(serverName)
        return { success: true, data: { server: serverName, resources } }
      }
      case "mcp_read_resource": {
        const uri = String(args.uri || "").trim()
        if (!uri) return { success: false, error: "Resource uri is required" }
        const result = await manager.readResource(serverName, uri)
        return { success: true, data: result }
      }
      case "mcp_get_prompt": {
        const name = String(args.name || "").trim()
        if (!name) return { success: false, error: "Prompt name is required" }
        const result = await manager.getPrompt(serverName, name, args.arguments)
        return { success: true, data: result }
      }
      default:
        return { success: false, error: `Unknown MCP meta tool: ${toolName}` }
    }
  } catch (err: any) {
    const rawErr = err.message || String(err)
    // Capability mismatch: give the LLM concrete guidance toward namespaced tools.
    if (/does not advertise/i.test(rawErr)) {
      const client = manager.listServers().find((s) => s.name === serverName)
      const toolNames = client?.tools.map((t) => `mcp__${serverName}__${t.name}`) ?? []
      const toolHint = toolNames.length > 0
        ? ` Available namespaced tools on this server: ${toolNames.join(", ")}.`
        : ""
      return {
        success: false,
        error: `${rawErr}${toolHint} Do not retry mcp_list_resources / mcp_read_resource / mcp_get_prompt against this server; use the namespaced tools instead.`,
      }
    }
    return { success: false, error: rawErr }
  }
}

function safeJsonStringify(value: any, limit: number): string {
  try {
    const s = JSON.stringify(value ?? {})
    return s.length > limit ? s.slice(0, limit) + "…" : s
  } catch {
    return String(value)
  }
}

function extractMcpError(result: any): string {
  if (!result) return "unknown error"
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item?.text) return String(item.text)
      if (typeof item === "string") return item
    }
  }
  return JSON.stringify(result).slice(0, 500)
}

/**
 * Broadcast a message to all AUTHENTICATED WebSocket clients (MCP status
 * updates, computer.task.event progress + preview JPEGs, config.updated).
 *
 * X3 (adversary WP2): outbound payloads turned sensitive in WP2 — per-step
 * desktop preview JPEGs ride this channel. The inbound gate (P0-2B) already
 * rejects pre-handshake messages, but the outbound side used to check only
 * readyState, letting a forged-Origin localhost peer siphon every broadcast
 * inside the 5s handshake window (and reconnect indefinitely). Mirror the
 * inbound semantics: no completed auth.handshake, NO broadcasts.
 */
export function broadcastToClients(data: any): void {
  if (!wss) return
  const message = JSON.stringify(data)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && wsAuth.get(client)?.authenticated === true) {
      try {
        client.send(message)
      } catch {
        // ignore send failures (client disconnect)
      }
    }
  }
}

/**
 * Redact secrets from a CompanionConfig (or partial) before broadcasting
 * config.updated over WebSocket. Masks llm/vision api_key and mcp.servers
 * env/headers *values* while preserving key names so the UI can still list
 * which env vars / header names are configured.
 *
 * SRV-1: callers must applyConfig / persist with the unredacted original.
 * Exported for pure unit tests (no startServer).
 */
/** Wire-safe config redaction (config.updated / config.get SoT). Re-export for tests. */
export { redactConfigForWire as redactConfigForBroadcast } from "./config-redact"

/**
 * Exported for integration tests (X3): aim broadcastToClients at a test
 * WebSocketServer and seed wsAuth entries (both states), so the REAL
 * broadcast path runs without booting startServer (singleton wss + UDS lock
 * + MCP manager). Pass null to detach. Mirrors getSessionIdForTests /
 * setComputerEstopEnsureForTests.
 */
export function setupBroadcastAuthForTests(
  server: WebSocketServer | null,
  authenticatedClients: WebSocket[] = [],
  unauthenticatedClients: WebSocket[] = [],
): void {
  wss = server as WebSocketServer
  for (const [client, authenticated] of [
    ...authenticatedClients.map((c): [WebSocket, boolean] => [c, true]),
    ...unauthenticatedClients.map((c): [WebSocket, boolean] => [c, false]),
  ]) {
    const timer = setTimeout(() => {}, 60000)
    timer.unref()
    wsAuth.set(client, { nonce: "test-nonce", authenticated, timer })
  }
}

// --- WS message validation (C10-A: body in ws/validate.ts) ---
// Import for local use (connection handler) + re-export for tests/public API.
import { validateWsMessage, type WsValidationResult } from "./ws/validate"
export { validateWsMessage, type WsValidationResult }


/**
 * Best-effort, non-blocking startup probe. When an API key is configured, ask
 * the provider's /models endpoint whether the configured chat model is actually
 * advertised. Warns (never throws) on mismatch or failure, so an unreachable
 * provider cannot delay or block startup. Catches the "wrong/renamed/deprecated
 * model id → 400 on first message" footgun (e.g. DeepSeek retiring
 * deepseek-chat/deepseek-reasoner on 2026-07-24 in favor of deepseek-v4-pro /
 * deepseek-v4-flash) without becoming a hard dependency on provider reachability.
 *
 * `warn` is injectable so tests can capture warnings without mocking the logger.
 */
export type ModelProbeWarn = (event: string, ctx: Record<string, unknown>) => void

export async function probeChatModel(
  config: ReturnType<typeof getConfig>,
  warn: ModelProbeWarn = (event, ctx) => logger.warn(event, ctx),
): Promise<void> {
  const { base_url, api_key, model_name } = config.llm
  if (!api_key) return // nothing to probe without a key

  // L10: Anthropic Messages has no OpenAI-style /models listing used by this probe.
  // Soft-skip so protocol=anthropic never hits Bearer GET {base}/models (wrong auth/shape).
  // P1 may add protocol-aware listing; P0 does not block startup.
  const protocol = config.llm.protocol ?? "openai"
  if (protocol === "anthropic") {
    return
  }

  try {
    const url = base_url.replace(/\/+$/, "") + "/models"
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${api_key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      warn("startup.model_probe.http_error", { status: res.status, model_name })
      return
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (data?.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === "string")
    if (ids.length === 0) return // unexpected payload shape — don't false-alarm
    if (!ids.includes(model_name)) {
      warn("startup.model_probe.model_not_listed", {
        model_name,
        available_sample: ids.slice(0, 12),
      })
    }
  } catch (e) {
    warn("startup.model_probe.failed", {
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function startServer(options: { onShutdown?: () => void } = {}) {
  // Drop file-in-PATH / empty PATH before any tool spawn (osascript, shell_exec, …).
  // Packaged .app has been observed with PATH=…/cmspark-agent.js → spawn ENOTDIR.
  const pathFix = applyHardenedProcessPath()
  if (pathFix.changed) {
    logger.warn("startup.path_hardened", {
      before_prefix: pathFix.before.slice(0, 120),
      after_prefix: pathFix.after.slice(0, 120),
    })
  }

  // Migrate deprecated DeepSeek model ids (deepseek-chat/deepseek-reasoner, retiring
  // 2026-07-24) to deepseek-v4-flash BEFORE the probe, so the probe validates the
  // migrated name. Idempotent; rewrites via the atomic saveConfig path and warns so
  // the user knows their config.json changed.
  const migration = migrateLegacyModelName()
  if (migration.migrated) {
    // deepseek-reasoner loses its name-based thinking mode under V4 (mode is selected
    // by a separate parameter CMspark does not send) — call that out so the user can
    // opt into deepseek-v4-pro for a stronger reasoning model.
    const note =
      migration.from === "deepseek-reasoner"
        ? "DeepSeek retires deepseek-chat/deepseek-reasoner on 2026-07-24; llm.model_name auto-updated to deepseek-v4-flash. You used deepseek-reasoner (thinking mode) — set deepseek-v4-pro to keep a stronger reasoning model."
        : "DeepSeek retires deepseek-chat/deepseek-reasoner on 2026-07-24; llm.model_name auto-updated to deepseek-v4-flash. Set it to deepseek-v4-pro for the higher-tier model."
    logger.warn("config.model_migrated", { from: migration.from, to: migration.to, note })
  }
  const config = getConfig()
  // C1 multi-adv (Pi nit): grant is process-memory; dual-write cruise can stick across
  // restart. If a durable pre-arm snapshot exists, restore cruise flags at boot.
  try {
    const {
      registerCruiseRestoreHandler,
      reconcileUnattendedCruiseOnBoot,
    } = await import("./computer/unattended-grant")
    registerCruiseRestoreHandler((snap) => {
      const cur = getConfig()
      saveConfig({
        security: {
          ...(cur.security || {}),
          auto_approve_dangerous: snap ? snap.auto_approve_dangerous : false,
          auto_approve_enterprise_tools: snap ? snap.auto_approve_enterprise_tools : false,
          allow_all_schemes: snap ? snap.allow_all_schemes : false,
        },
      })
    })
    const bootCruise = reconcileUnattendedCruiseOnBoot()
    if (bootCruise.restored) {
      logger.info("security.unattended.cruise_boot_restored", {
        auto_approve_dangerous: bootCruise.snap?.auto_approve_dangerous,
        auto_approve_enterprise_tools: bootCruise.snap?.auto_approve_enterprise_tools,
        allow_all_schemes: bootCruise.snap?.allow_all_schemes,
      })
    }
  } catch (e: any) {
    logger.warn("security.unattended.cruise_boot_reconcile_failed", {
      error: e?.message || String(e),
    })
  }
  // Best-effort model-validity probe — fire-and-forget; never blocks or crashes startup.
  void probeChatModel(config)

  // P0-2B: materialize the WS shared secret BEFORE any peer can connect. On first
  // run it is generated + persisted (0o600, ~/.cmspark-agent/ws_secret); the user
  // must paste it once into the extension Settings to pair. Until paired, the
  // extension cannot authenticate and all app messages are rejected.
  getOrCreateSharedSecret()
  if (consumeSecretFreshlyGenerated()) {
    logger.warn("ws.shared_secret_generated", {})
    console.log(
      "[cmspark-agent] 🔑 First run: generated a WebSocket pairing secret.\n" +
      "    Paste it once into the extension (Settings → 连接 → WS 配对密钥).\n" +
      "    Re-view anytime: `cmspark-agent settings --ws-secret`.",
    )
  }
  // The in-memory secret authenticates this run regardless, but if it could not
  // be persisted the extension will have to re-pair after the next restart.
  if (consumeSecretPersistFailed()) {
    logger.error("ws.shared_secret_persist_failed", {})
    console.error(
      "[cmspark-agent] ⚠ Could not persist the WebSocket pairing secret to disk. " +
      "Pairing will not survive a restart — check permissions on the data directory.",
    )
  }
  const port = config.port || PORT

  // --- UDS Lock: check for existing instance ---
  const lockPath = getLockFilePath()
  const lockAcquired = await acquireLock(lockPath)
  if (!lockAcquired) {
    // Lock exists — check if the owning process is still alive
    const pid = readPidFile(getPidFilePath())
    if (pid && isProcessRunning(pid)) {
      console.error("[cmspark-agent] Another instance is already running (pid: " + pid + ")")
      logger.error("server.start_failed", { reason: "already_running", pid })
      process.exit(1)
    }
    // Stale lock — clean up and continue
    console.log("[cmspark-agent] Cleaning up stale lock from dead process (pid: " + (pid || "unknown") + ")")
    cleanupPidFile(getPidFilePath())
    releaseLock(lockPath)
    // Try again
    const retryAcquired = await acquireLock(lockPath)
    if (!retryAcquired) {
      console.error("[cmspark-agent] Failed to acquire lock after cleanup")
      process.exit(1)
    }
  }

  // Outbound MCP: refresh tool runner before each HTTP invoke
  try {
    const { setOutboundRunnerRefresh } = require("./outbound-mcp/companion-http") as typeof import("./outbound-mcp/companion-http")
    setOutboundRunnerRefresh(() => {
      ensureOutboundToolRunnerWired()
    })
  } catch (e: any) {
    logger.warn("outbound_mcp.refresh_hook_failed", { error: e?.message || String(e) })
  }

  logger.info("server.start", {
    port,
    model_name: config.llm.model_name,
    base_url: config.llm.base_url,
  })

  // Warn if no API key configured
  if (!config.llm.api_key || config.llm.api_key === "sk-placeholder") {
    console.warn("[cmspark-agent] ⚠️  No API key configured!")
    console.warn("[cmspark-agent]    Set DEEPSEEK_API_KEY environment variable or configure in the extension settings.")
    console.warn("[cmspark-agent]    Example: DEEPSEEK_API_KEY=sk-xxx npm start")
    logger.warn("config.api_key_missing")
  } else {
    const key = config.llm.api_key
    let masked: string
    if (key.length <= 8) {
      masked = "***"
    } else {
      masked = key.slice(0, 4) + "***" + key.slice(-4)
    }
    console.log(`[cmspark-agent] Using API key: ${masked}`)
  }
  console.log(`[cmspark-agent] Model: ${config.llm.model_name} @ ${config.llm.base_url}`)

  // Vision model health check
  if (config.vision?.enabled) {
    try {
      const OpenAI = (await import("openai")).default
      const visionClient = new OpenAI({
        baseURL: config.vision.base_url,
        apiKey: config.vision.api_key || "ollama",
        timeout: 5000,
        maxRetries: 0,
      })
      await visionClient.models.list()
      console.log(`[cmspark-agent] Vision model: ${config.vision.model_name} @ ${config.vision.base_url}`)
    } catch (e: any) {
      console.warn(`[cmspark-agent] Vision model unavailable: ${e.message}`)
      console.warn(`[cmspark-agent] Screenshot analysis will use fallback: ${config.vision.fallback}`)
    }
  }

  // Pre-initialize services (async: loads SQLite WASM)
  await initServices()

  // Start MCP manager (loads configured MCP servers in the background).
  // IMPORTANT: register event listeners BEFORE calling start() — start() awaits
  // all client connections and emits "servers_updated" / "status_changed" during
  // that window; registering listeners afterwards means we miss the first wave.
  const mcpManager = getMcpManager()
  mcpManager.on("servers_updated", (metas) => {
    broadcastToClients({
      type: "mcp.servers.updated",
      servers: redactMcpServersForBroadcast(metas || []),
    })
  })
  mcpManager.on("status_changed", (meta) => {
    const [redacted] = redactMcpServersForBroadcast(meta ? [meta] : [])
    broadcastToClients({ type: "mcp.server.status_changed", server: redacted ?? meta })
  })
  mcpManager.on("tools_changed", () => {
    broadcastToClients({
      type: "mcp.servers.updated",
      servers: redactMcpServersForBroadcast(mcpManager.listServers()),
    })
  })
  try {
    await mcpManager.start(config.mcp)
  } catch (err: any) {
    logger.warn("mcp.manager.start_failed", { error: err?.message || String(err) })
  }

  // L12: share one loopback HTTP server between the healthz liveness probe and the
  // WebSocket upgrade. This is the ws-recommended pattern and keeps the loopback-only
  // trust boundary unchanged. We listen explicitly so we can close the httpServer on
  // shutdown (M9 regression guard).
  const httpServer = http.createServer(handleHealthzRequest)
  httpServer.listen(port, "127.0.0.1")

  wss = new WebSocketServer({
    server: httpServer,
    // Reject frames above MAX_WS_MESSAGE_SIZE before full buffering (handler also checks).
    maxPayload: MAX_WS_MESSAGE_SIZE,
    // P0-2 (audit C1): reject non-extension origins to close the web-page attack vector —
    // HTTP pages / file:// / other browser extensions can otherwise open a loopback WS and
    // drive the agent (config.set, list_all_cookies, evaluate, ...). Browsers set the WS Origin
    // from the page/worker origin and page JS cannot forge it, so this is robust against web
    // origins. MV3 Service Worker / popup / side panel all send Origin: chrome-extension://<id>,
    // so legitimate extension connections are not blocked.
    // NOTE: this does NOT stop a local process — a local attacker can freely set the Origin
    // header (curl -H "Origin: chrome-extension://..."). The local-process vector needs a
    // shared-secret handshake (P2 / P0-2B) and is intentionally out of P0 scope.
    verifyClient: (info, cb) => {
      const origin = info.origin
      const ok = isAllowedWsOrigin(origin)
      if (!ok) {
        logger.warn("ws.rejected_origin", {
          origin: origin || "<none>",
          remote: info.req.socket.remoteAddress,
        })
        cb(false, 403, "Forbidden")
      } else {
        cb(true)
      }
    },
  })

  httpServer.on("listening", () => {
    console.log(`[cmspark-agent] Companion started on ws://127.0.0.1:${port}`)
    logger.info("server.listening", { port })
    // P3a HUD spike: if tray is co-located in this process, run full in-process
    // open→hydrate→confirm→standby. Dual-process (normal tray + server) is driven
    // from menu-bar-agent when CMSPARK_HUD_SPIKE=1 on both sides.
    if (isHudSpikeEnabled()) {
      console.log("[cmspark-agent] CMSPARK_HUD_SPIKE=1 — waiting for in-process tray or dual-process tray WS")
      logger.info("hud.spike.enabled", {})
      setTimeout(() => {
        void (async () => {
          const tray = getTrayInstance()
          if (tray?.openHudAsync) {
            const result = await runHudSpikeInProcess({
              tray,
              securityConfirmations,
              log: (m, e) => logger.info("hud.spike", { msg: m, ...e }),
            })
            logger.info("hud.spike.in_process_result", result as any)
            console.log("[cmspark-agent] HUD spike (in-process):", result)
          } else {
            logger.info("hud.spike.awaiting_tray_client", {
              note: "No in-process tray; menu-bar dual-process path will open HUD",
            })
          }
        })()
      }, 2500)
    }
  })

  // Broadcast config changes to AUTHENTICATED WebSocket clients only + apply MCP diff.
  // SRV-1: never fan out to OPEN-but-unauthenticated sockets (handshake window);
  // redact llm/vision api_key and mcp.servers env/headers values before send.
  // applyConfig MUST receive the unredacted config (secrets needed for process spawn).
  configEvents.on(CONFIG_CHANGE_EVENT, async (updatedConfig: any) => {
    broadcastToClients({
      type: "config.updated",
      config: redactConfigForWire(updatedConfig),
      source: "companion",
    })

    // Apply MCP diff (start/stop/restart servers based on what changed)
    try {
      await mcpManager.applyConfig(updatedConfig.mcp)
    } catch (err: any) {
      logger.warn("mcp.apply_config_failed", { error: err?.message || String(err) })
    }
  })

  wss.on("connection", (ws, req) => {
    // Note: services (threadManager / skillEngine / historyStore) are initialized
    // exactly once via `await initServices()` at boot (line ~835) before the WS
    // server starts listening. A previous version re-ran initServices() here on
    // first connection — that was a no-op duplicate at best, and a real race at
    // worst (replacing the module-level historyStore with a fresh instance whose
    // this.db was still null, silently dropping records during the init window).
    // Removed in audit item 14.
    // WeakMap is not iterable — count via clients set (entries already in wsAuth).
    let unauthCount = 0
    for (const c of clients) {
      const st = wsAuth.get(c)
      if (st && !st.authenticated) unauthCount++
    }
    if (unauthCount >= MAX_UNAUTHENTICATED_WS) {
      logger.warn("ws.unauth_cap_exceeded", { unauth: unauthCount, cap: MAX_UNAUTHENTICATED_WS })
      try {
        ws.close(1013, "Too many unauthenticated connections")
      } catch { /* ignore */ }
      try {
        ws.terminate()
      } catch { /* ignore */ }
      return
    }
    clients.add(ws)
    const peerOrigin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined
    console.log(`[cmspark-agent] Client connected (${clients.size} total)`)
    logger.info("ws.client_connected", { clients: clients.size, origin: peerOrigin || "<none>" })

    // P0-2B: challenge this peer immediately. It must reply (auth.handshake) with
    // proof = HMAC-SHA256(sharedSecret, nonce) within AUTH_TIMEOUT_MS, else we
    // terminate. No app message is processed until the handshake completes.
    const sharedSecret = getOrCreateSharedSecret()
    const challengeNonce = issueChallenge()
    const authTimer = setTimeout(() => {
      const st = wsAuth.get(ws)
      if (st && !st.authenticated) {
        logger.warn("ws.auth_timeout", {})
        try { ws.terminate() } catch { /* closing */ }
      }
    }, AUTH_TIMEOUT_MS)
    wsAuth.set(ws, {
      nonce: challengeNonce,
      authenticated: false,
      timer: authTimer,
      origin: peerOrigin,
    })
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "auth.challenge", nonce: challengeNonce }))
    }

    const executeTool = createToolExecutor(ws)

    // WP4: 每连接面板标识——computer.evidence.open 的 P6 频率上限按它计数。
    const panelId = randomUUID()

    // Ping/pong keepalive — terminate clients that don't respond within 30s
    let pongReceived = true
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        if (!pongReceived) {
          ws.terminate()
          return
        }
        pongReceived = false
        ws.ping()
      }
    }, 30000)

    ws.on("message", async (raw) => {
      let msg: any
      try {
        // WebSocket message size limit (P0)
        const rawLen = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(raw.toString())
        if (rawLen > MAX_WS_MESSAGE_SIZE) {
          // Peek type + thread_id without full parse (prefix search) for diagnostics
          // and to stamp file.upload_error so UI can clear the right mapBusy.
          const peek = (() => {
            try {
              const s = Buffer.isBuffer(raw) ? raw.subarray(0, 400).toString("utf8") : String(raw).slice(0, 400)
              const typeM = s.match(/"type"\s*:\s*"([^"]+)"/)
              const tidM = s.match(/"thread_id"\s*:\s*"([^"]+)"/)
              return { type: typeM?.[1] || null, thread_id: tidM?.[1] || null }
            } catch {
              return { type: null, thread_id: null }
            }
          })()
          logger.warn("ws.message_too_large", {
            size: rawLen,
            max: MAX_WS_MESSAGE_SIZE,
            peek: peek.type,
            thread_id: peek.thread_id,
          })
          if (ws.readyState === WebSocket.OPEN) {
            // S45 P1: upload oversized → stamped file.upload_error (not bare error)
            if (peek.type === "file.upload" && peek.thread_id) {
              ws.send(
                JSON.stringify({
                  type: "file.upload_error",
                  error: "Message too large",
                  thread_id: peek.thread_id,
                }),
              )
            } else {
              ws.send(JSON.stringify({ type: "error", error: "Message too large" }))
            }
          }
          return
        }
        msg = JSON.parse(raw.toString())
        // Early breadcrumb for file uploads — before auth/validation so we can
        // see packets that die at those gates (diag for stuck attachment UX).
        if (msg?.type === "file.upload") {
          const files = Array.isArray(msg.files) ? msg.files : []
          logger.info("ws.file_upload.received", {
            thread_id: typeof msg.thread_id === "string" ? msg.thread_id : null,
            raw_bytes: rawLen,
            file_count: files.length,
            files: files.map((f: any) => ({
              name: typeof f?.name === "string" ? f.name : null,
              type: typeof f?.type === "string" ? f.type : null,
              content_b64_len: typeof f?.content === "string" ? f.content.length : 0,
              has_name: !!f?.name,
              has_type: !!f?.type,
              has_content: typeof f?.content === "string" && f.content.length > 0,
            })),
            authenticated: wsAuth.get(ws)?.authenticated === true,
          })
        }
        // P0-2B: an unauthenticated peer may send ONLY auth.handshake. Any other
        // message — including ones that would fail structural validation below —
        // terminates the connection immediately. Without this early gate a forged-
        // Origin local process could send malformed known-type messages to harvest
        // the API structure (the validator echoes field requirements) and linger
        // for the full 5s handshake timeout. Structural validation runs only after
        // this auth check.
        if (!wsAuth.get(ws)?.authenticated && msg?.type !== "auth.handshake") {
          logger.warn("ws.unauthenticated_message", { type: msg?.type })
          try { ws.terminate() } catch { /* closing */ }
          return
        }
        // Stricter message validation (P2)
        const validation = validateWsMessage(msg)
        if (!validation.valid) {
          logger.warn("ws.invalid_message", {
            error: validation.error,
            msg_type: typeof msg?.type === "string" ? msg.type : typeof msg,
            ...(msg?.type === "file.upload"
              ? {
                  thread_id: msg.thread_id ?? null,
                  file_count: Array.isArray(msg.files) ? msg.files.length : null,
                }
              : {}),
          })
          if (ws.readyState === WebSocket.OPEN) {
            // S45 P1: file.upload validation fails with stamped upload_error so
            // Side Panel can clear the correct thread mapBusy after switch.
            if (
              msg?.type === "file.upload" &&
              typeof msg.thread_id === "string" &&
              msg.thread_id
            ) {
              ws.send(
                JSON.stringify({
                  type: "file.upload_error",
                  error: `Invalid message: ${validation.error}`,
                  thread_id: msg.thread_id,
                }),
              )
            } else {
              ws.send(JSON.stringify({ type: "error", error: `Invalid message: ${validation.error}` }))
            }
          }
          return
        }
        // P0-2B: auth.handshake is the ONLY message an unauthenticated peer may
        // send. Verify proof = HMAC-SHA256(sharedSecret, nonce); on success mark
        // the connection authenticated, clear the timeout, and deliver the
        // app-level "connected" state. Bad/missing proof → terminate.
        // Keep in sync with companion/tests/integration/ws-auth-handshake.test.ts
        // (which replicates this exact gate, since no test calls startServer()).
        if (msg.type === "auth.handshake") {
          const st = wsAuth.get(ws)
          if (!st) {
            try { ws.terminate() } catch { /* closing */ }
            return
          }
          // Idempotent: ignore a duplicate handshake on an already-authenticated
          // connection instead of re-emitting auth.ok + connected.
          if (st.authenticated) return
          if (verifyProof(sharedSecret, st.nonce, String(msg.proof))) {
            // ARCH-PROTO-1: negotiate protocol_version from client (optional legacy omit → min)
            const { negotiateProtocolVersion, authOkProtocolFields } = require("./protocol") as typeof import("./protocol")
            const nego = negotiateProtocolVersion(msg.protocol_version)
            if (!nego.ok) {
              logger.warn("ws.protocol_rejected", {
                error: nego.error,
                client: (nego as any).client,
              })
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(
                    JSON.stringify({
                      type: "auth.failed",
                      error: nego.error,
                      ...authOkProtocolFields(),
                    }),
                  )
                } catch { /* closing */ }
              }
              try { ws.terminate() } catch { /* closing */ }
              return
            }
            st.authenticated = true
            clearTimeout(st.timer)
            logger.info("ws.authenticated", { protocol_version: nego.negotiated })
            // Record (idempotently) that some peer has paired, so the tray can stop
            // auto-surfacing the pairing secret. Best-effort; never blocks auth.
            markPaired()
            // Wire outbound MCP HTTP → createToolExecutor(this peer)
            try {
              ensureOutboundToolRunnerWired()
            } catch (wireErr: any) {
              logger.warn("outbound_mcp.wire_failed", { error: wireErr?.message || String(wireErr) })
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "auth.ok",
                  ...authOkProtocolFields(),
                  negotiated_protocol_version: nego.negotiated,
                }),
              )
              ws.send(JSON.stringify({ type: "connected" }))
              // Push current coordinate state immediately so the extension always
              // has fresh data after connect/reconnect — without this, the extension
              // caches a stale coordinateEnabled value from before a companion restart.
              const cfg = getConfig()
              ws.send(JSON.stringify({
                type: "computer.state",
                coordinateEnabled: cfg.computer?.coordinateEnabled === true,
              }))
            }
          } else {
            logger.warn("ws.auth_failed", {})
            try { ws.terminate() } catch { /* closing */ }
          }
          return
        }
        // Every other message requires a completed handshake — otherwise a local
        // process that forged the Origin header could send config.set / mcp.add /
        // history.export before authenticating.
        const authState = wsAuth.get(ws)
        if (!authState?.authenticated) {
          logger.warn("ws.unauthenticated_message", { type: msg.type })
          try { ws.terminate() } catch { /* closing */ }
          return
        }
        if (msg.type !== "system.ping") {
          logger.debug("ws.message.received", summarizeMessage(msg))
        }

        // Intercept tool.result — these resolve pending promises
        if (msg.type === "tool.result") {
          handleToolResult(msg, ws)
          return
        }

        if (msg.type === "security.confirmation.response") {
          // Phase 1 W7: pass per-connection session id (used as thread proxy)
          // so handleSecurityConfirmationResponse can record thread-scoped trust.
          const sid = mcpSessionByWs.get(ws)
          await handleSecurityConfirmationResponse(ws, msg, sid)
          return
        }

        // WP2 (§E.6): panel emergency stop for a RUNNING computer task.
        // task_id targets one run (the id is broadcast in the task events);
        // "*" is the panic button — aborts every running task. Stopping
        // injection is always the safe direction, so any authenticated panel
        // connection may send this (no origin binding). F1: the semantics live
        // in handleComputerTaskAbort (exported, tested at the socket seam).
        if (msg.type === "computer.task.abort") {
          handleComputerTaskAbort(ws, msg)
          return
        }

        // P0-B: chat.abort also stops any running host_computer task so the
        // user does not need a separate 急停. Silent registry flip only —
        // no computer.task.abort.ack (avoids double-ack if UI also sends
        // computer.task.abort). Fall through to handleMessage for AbortController
        // + chat.aborted. Lives here (not message-router) to avoid a
        // message-router→server import cycle.
        //
        // Same path must kill in-flight shell_exec process trees (thread-scoped).
        // AbortController alone only cancels the LLM stream — shell kept running.
        if (msg.type === "chat.abort") {
          flipAllComputerTaskAborts()
          try {
            const { abortShellRunsForThread } = await import("./capability/shell")
            const tid = typeof msg.thread_id === "string" ? msg.thread_id : ""
            if (tid) {
              const n = abortShellRunsForThread(tid)
              if (n > 0) logger.warn("shell.abort.chat_abort", { thread_id: tid, matched: n })
            }
          } catch {
            /* best-effort */
          }
        }

        // Individual shell stop (Side Panel tool card) — does not abort the whole chat.
        if (msg.type === "shell.exec.abort") {
          try {
            const { abortShellRunById, abortShellRunsForThread } = await import("./capability/shell")
            const toolCallId =
              typeof msg.tool_call_id === "string" && msg.tool_call_id ? msg.tool_call_id : ""
            const tid = typeof msg.thread_id === "string" ? msg.thread_id : ""
            let matched = 0
            if (toolCallId && abortShellRunById(toolCallId)) matched = 1
            else if (tid) matched = abortShellRunsForThread(tid)
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "shell.exec.abort.ack",
                  tool_call_id: toolCallId || null,
                  thread_id: tid || null,
                  matched,
                }),
              )
            }
            if (matched > 0) {
              logger.warn("shell.exec.abort.requested", {
                tool_call_id: toolCallId || null,
                thread_id: tid || null,
                matched,
              })
            }
          } catch (e: any) {
            logger.warn("shell.exec.abort.failed", { error: e?.message || String(e) })
          }
          return
        }

        // Audit item 3 (gate): bulk history export requires explicit user
        // confirmation. Without this, any local process that connects to the
        // loopback WS could drain history.db (operation metadata: URLs visited,
        // tools called, timing) with no audit trail. The redaction in
        // HistoryStore.record (item 3 part 1) already removed cookie values +
        // evaluate code from the DB, but the metadata is still sensitive enough
        // to warrant an explicit approval.
        if (msg.type === "history.export") {
          if (ws.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "history.exported",
              data: [],
              error: "WebSocket not connected; cannot request export confirmation.",
            }))
            return
          }
          logger.warn("history.export.confirmation.requested", {
            thread_id: msg.thread_id,
            from: msg.from,
            to: msg.to,
          })
          const decision = await securityConfirmations.request(
            (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)) },
            {
              toolName: "history.export",
              dangerousApis: [],
              code: `export(${JSON.stringify({ thread_id: msg.thread_id, from: msg.from, to: msg.to })})`,
            },
            { originWs: ws },
          )
          if (!decision.approved) {
            const reason = decision.reason === "approved" ? "unavailable" : decision.reason
            logger.warn("history.export.confirmation.denied", { reason })
            ws.send(JSON.stringify({
              type: "history.exported",
              data: [],
              error: `History export was ${reason === "denied" ? "denied by user" : reason}.`,
            }))
            return
          }
          logger.info("history.export.confirmation.approved", {})
          // Fall through to handleMessage — the actual export runs.
        }

        if (msg.type === "log.event") {
          // Rate-limit per connection (backstop; primary loop break is extension
          // not re-logging forward failures + no echo below).
          if (!allowInboundLogEvent(ws)) {
            return
          }
          const eventName = typeof msg.event === "string" && msg.event ? msg.event : "extension.event"
          const source = typeof msg.source === "string" && msg.source ? msg.source : "extension"
          logger.log(safeLogLevel(msg.level), eventName, msg.data && typeof msg.data === "object" ? msg.data : {}, source)
          // Do NOT echo log.event back to the sender. Echo + extension
          // sidepanel_forward_failed → logToCompanion formed a tight WS loop
          // when Side Panel/Cockpit were closed (tens of GB, dual-end CPU).
          // Live log UI: extension fans out its own logs locally via
          // chrome.runtime.sendMessage in logToCompanion (see background/index.ts).
          return
        }

        // P3a HUD spike (env-gated dual-process): tray client owns Swift UI;
        // server owns SecurityConfirmationManager (plan wire ownership).
        if (msg.type === "hud.spike.start") {
          if (!isHudSpikeEnabled()) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "hud.spike.error", error: "CMSPARK_HUD_SPIKE is not 1" }))
            }
            return
          }
          const confirmationId = randomUUID()
          const timeoutMs = typeof msg.timeout_ms === "number" ? msg.timeout_ms : 45_000
          logger.info("hud.spike.start", { confirmation_id: confirmationId })
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "hud.spike.show_confirm",
              id: confirmationId,
              tool_name: "evaluate",
              risk_level: "high",
              summary: "HUD spike confirm — Allow or Deny",
              timeout_ms: timeoutMs,
              thread_id: HUD_SPIKE_THREAD_ID,
              task_id: HUD_SPIKE_TASK_ID,
            }))
          }
          void securityConfirmations.request(
            () => { /* HUD is elevated surface; no Side Panel push */ },
            {
              toolName: "evaluate",
              dangerousApis: [],
              code: "/* hud spike */",
              riskLevel: "high",
            },
            undefined,
            confirmationId,
          ).then((d) => {
            logger.info("hud.spike.confirm_terminal", {
              confirmation_id: confirmationId,
              approved: d.approved,
              reason: d.reason,
            })
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "hud.spike.done",
                confirmation_id: confirmationId,
                approved: d.approved,
                reason: d.reason,
              }))
            }
          })
          return
        }
        if (msg.type === "hud.spike.confirm_response") {
          if (!isHudSpikeEnabled()) return
          const id = typeof msg.id === "string" ? msg.id : ""
          const approved = msg.approved === true
          if (!id) return
          const ok = securityConfirmations.respond(id, approved)
          logger.info("hud.spike.confirm_response", { confirmation_id: id, approved, ok })
          return
        }
        if (msg.type === "hud.spike.abort") {
          if (!isHudSpikeEnabled()) return
          logger.info("hud.spike.abort", {
            thread_id: msg.thread_id,
            task_id: msg.task_id || HUD_SPIKE_TASK_ID,
          })
          return
        }

        // M1 (audit P2-1): the extension pushes the current URL whenever a tab
        // navigates, keeping tabUrlCache (the evaluate auto-approve trust anchor)
        // current. validateWsMessage already enforced tabId:number + url:string.
        // Fire-and-forget — no ack needed.
        if (msg.type === "tab.navigated") {
          applyTabNavigated(msg.tabId, msg.url)
          return
        }

        let response: any
        try {
          response = await handleMessage(
            msg,
            { threadManager, skillEngine, historyStore },
            {
              sendToExtension: (data: any) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(data))
                }
              },
              executeTool,
              // App tab D2 biometric gates (apps.add/set_policy →auto): same
              // origin-bound confirmation channel as executeTool's
              // sendConfirmation above — nonce-carrying confirmations resolve
              // only on the socket that requested them (amendment A1).
              requestConfirmation: (details) =>
                securityConfirmations.request(
                  (data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify(data))
                    }
                  },
                  details,
                  { originWs: ws },
                ),
              broadcast: (data: any) => {
                const message = JSON.stringify(data)
                for (const client of clients) {
                  try {
                    // Y-e: mirror broadcastToClients (X3) — never fan out to
                    // unauthenticated connections inside the handshake window.
                    if (client.readyState === WebSocket.OPEN && wsAuth.get(client)?.authenticated === true) {
                      client.send(message)
                    }
                  } catch { /* ignore disconnected */ }
                }
              },
              // WP4: 每连接面板标识(computer.evidence.open P6 频率上限计数)。
              panelId,
              // Path B M1: origin class for voice.stt.* (chrome-extension vs tray).
              origin: peerOrigin,
            },
          )
        } catch (handlerErr: any) {
          // Keep Companion alive on STT/tool handler throws (was process-killing via unhandledRejection).
          logger.error("ws.handleMessage.threw", {
            type: typeof msg?.type === "string" ? msg.type : undefined,
            error: handlerErr?.message || String(handlerErr),
          })
          response = {
            type: "error",
            error: handlerErr?.message || "handler failed",
            family: typeof msg?.type === "string" ? String(msg.type).split(".")[0] : "ws",
          }
        }

        if (response && ws.readyState === WebSocket.OPEN) {
          // Echo the request id so clients can match this response to a pending
          // request. Without it, request-type responses (e.g. skill.list) are
          // indistinguishable from server pushes and may be re-issued by clients
          // that dispatch by type.
          ws.send(JSON.stringify({ ...response, id: msg?.id }))
        }
      } catch (e: any) {
        logger.error("ws.message_error", { error: e.message || String(e) })
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", id: msg?.id, error: e.message }))
        }
      }
    })

    ws.on("close", () => {
      clearInterval(pingInterval)
      clients.delete(ws)
      // P0-2B: clear the per-connection auth timer + state.
      const closedAuth = wsAuth.get(ws)
      if (closedAuth) {
        clearTimeout(closedAuth.timer)
        wsAuth.delete(ws)
      }
      // Rebind or clear outbound MCP runner if this was the dispatch peer
      try {
        ensureOutboundToolRunnerWired()
      } catch {
        /* best-effort */
      }
      applyConnectionCloseGracePeriod(ws)
      securityConfirmations.rejectAll("disconnect", ws)
      // C-P0-6: cancel any tray dialogs that were racing this WS. Without this,
      // the Swift dialog stays modal until its own timeout. cancelConfirm is
      // a no-op if the id isn't pending (race already resolved).
      const tray = getTrayInstance()
      if (tray) {
        const activeIds = activeTrayConfirmsByWs.get(ws)
        if (activeIds) {
          for (const id of activeIds) {
            tray.cancelConfirm(id)
          }
          activeIds.clear()
          activeTrayConfirmsByWs.delete(ws)
        }
      }
      // Audit item 8: clear the per-session MCP confirm-cache so approvals
      // don't leak across reconnects (memory + a stale "approved" entry could
      // wrongly auto-approve a tool call from whatever reconnects next).
      const sessionId = mcpSessionByWs.get(ws)
      if (sessionId) {
        getMcpConfirmCache().clearSession(sessionId)
        mcpSessionByWs.delete(ws)
      }
      console.log(`[cmspark-agent] Client disconnected (${clients.size} remaining)`)
      logger.info("ws.client_disconnected", { clients: clients.size })
    })

    ws.on("pong", () => {
      pongReceived = true
    })

    // P0-2B: the app-level "connected" state is sent AFTER auth.handshake
    // succeeds (in the message handler above), not here — an unauthenticated
    // peer must not receive it. The stale "security secret" comments below
    // referred to the removed HMAC-token iteration; ws-auth.ts is the successor.
  })

  wss.on("error", (err) => {
    console.error("[cmspark-agent] Server error:", err)
    logger.error("server.error", { error: err })
  })

  // Audit item 8: periodic sweep of stale MCP confirm-cache sessions. The
  // primary cleanup path is ws.on("close") → clearSession (above), but if a
  // connection is dropped without firing close (process exit, network loss),
  // approvals would otherwise linger in the module-level singleton forever.
  // Every 5 min, drop any session not in the active-sessions set.
  const mcpPruneTimer = setInterval(() => {
    const active = new Set(Array.from(mcpSessionByWs.values()))
    getMcpConfirmCache().pruneStaleSessions(active)
  }, 5 * 60 * 1000)
  mcpPruneTimer.unref?.()

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[cmspark-agent] Shutting down (${signal})...`)
    logger.info("server.shutdown", { signal })
    // Stop MCP servers first (terminates child processes) before closing WS.
    // Wrap in a timeout — a stuck MCP transport must not block shutdown indefinitely.
    try {
      await Promise.race([
        mcpManager.shutdown(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("MCP shutdown timed out after 5s")), 5000)),
      ])
    } catch (err: any) {
      logger.warn("mcp.shutdown_failed", { error: err?.message || String(err) })
    }
    // P0-1 (audit C2): flush history.db before exiting. Previously close() was never
    // called on shutdown, so every normal SIGTERM/SIGINT lost the session's audit records.
    try {
      historyStore?.close()
    } catch (err: any) {
      logger.warn("history.close_failed", { error: err?.message || String(err) })
    }
    try {
      wss.close()
    } catch {
      // ignore
    }
    // L12 / M9: with `{server}` wiring, wss.close() does NOT close our http.Server.
    // Close it explicitly so the process exits and the port is released.
    try {
      await Promise.race([
        new Promise<void>((resolve) => httpServer.close(() => resolve())),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("HTTP server close timed out after 3s")), 3000)),
      ])
    } catch {
      // ignore
    }
    try {
      releaseLock(getLockFilePath())
    } catch {
      // ignore
    }
    try {
      options.onShutdown?.()
    } catch (err: any) {
      logger.warn("shutdown.hook_failed", { error: err?.message || String(err) })
    }
  }
  setupGracefulShutdown((signal) => shutdown(signal))
}
