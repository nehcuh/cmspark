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

// Phase 1 W7 — resolve app token from host_read/host_write params for
// thread-scoped trust + relevantApps in confirmation dialog.
// Phase 1 W8-windows: platform-aware defaults (win32 uses win.* tokens).
function resolveHostUseApp(toolName: string, params: any): string {
  const isWin = os.platform() === "win32"
  if (toolName === "host_read") {
    const app = typeof params?.application === "string" ? params.application : ""
    if (app) return app
    // Phase 0 default when application omitted.
    return isWin ? "win.outlook.classic" : "com.apple.mail"
  }
  if (toolName === "host_write") {
    const kind = typeof params?.kind === "string" ? params.kind : ""
    if (kind === "create") return isWin ? "win.onenote.desktop" : "com.apple.Notes"
    if (kind === "move") return isWin ? "win.fs" : "com.apple.finder"
    return ""
  }
  return ""
}
import { execFile } from "child_process"
import { randomUUID } from "crypto"
import http from "http"
import os from "os"
import { URL } from "url"
import { getConfig, saveConfig, initDataDir, configEvents, CONFIG_CHANGE_EVENT, migrateLegacyModelName } from "./config"
import { handleMessage } from "./message-router"
import { ThreadManager } from "./threads/thread-manager"
import { SkillEngine } from "./skills/skill-engine"
import { HistoryStore } from "./history/store"
import { checkHighRiskExecution, highRiskExecutionDeniedError, isTrustedDomain, isAutoApprovedDomain, isCloudMetadataIp, isPrivateOrLoopbackIp, detectCriticalApis, classifyMcpCall, mergeCapabilities, CRITICAL_MCP_CAPABILITIES, CRITICAL_MCP_META_TOOLS, cookieTrustBlockedPayload } from "./security"
import { SecurityConfirmationManager, type SecurityConfirmationDetails, type SecurityConfirmationDecision, DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from "./security-confirmation"
import { getTrayInstance } from "./menu-bar-agent"
import type { TrayConfirmRequest } from "./tray/tray-adapter"
import {
  isHudSpikeEnabled,
  runHudSpikeInProcess,
  HUD_SPIKE_THREAD_ID,
  HUD_SPIKE_TASK_ID,
} from "./hud/spike"
import {
  enterpriseSessionTrust,
  resolveEnterpriseTrustKey,
  familyOfTool,
  netsecScopeFingerprint,
  type EnterpriseToolFamily,
} from "./capability/enterprise-session-trust"
import { checkNetsecScope } from "./netsec/scope"
import { checkShellScope } from "./capability/shell"
import { getModule, isModuleEnabled } from "./capability/modules"
import { getThreadApprovals } from "./host-use/thread-approvals"
import { APP_TOKEN_PATTERN, type AppEntry, type AppPolicy } from "./apps/types"
import { securityPolicy, getTokenSecret } from "./security-policy"
import { logger, type LogLevel } from "./logger"
import { acquireLock, releaseLock, isProcessRunning, readPidFile, cleanupPidFile, setupGracefulShutdown } from "./daemon"
import { getLockFilePath, getPidFilePath } from "./config"
import { getMcpManager, getMcpConfirmCache, isMcpNamespaced } from "./mcp"
import {
  OSASCRIPT_MACOS_ONLY_ERROR,
  shouldL2GateOsascript,
} from "./bridge/tool-definitions"
import { prepareBrowserDownloadParams } from "./path-sandbox"
import { OSASCRIPT_BIN, applyHardenedProcessPath } from "./process-path"
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
  // Mission Pack P0: install shipped packs (appsec-prd-review) into DATA_DIR
  try {
    const { ensureBuiltinPacksInstalled } = await import("./packs/pack-engine")
    ensureBuiltinPacksInstalled(skillEngine)
  } catch (e: any) {
    logger.warn("packs.builtin_install_failed", { error: e?.message || String(e) })
  }
}

/**
 * Integration tests: ensure module-level ThreadManager exists so outbound B1
 * path (`isToolAllowed` on synthetic holders) is exercised. No-op if already set.
 */
export function seedThreadManagerForTests(): ThreadManager {
  if (!threadManager) {
    threadManager = new ThreadManager()
  }
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

    // Security Pre-flight Checks (P0 - Cookie Trust Domains Gate)
    // Full autonomy cruise (网页+企业巡航+协议解锁三旗全开): user opted into max
    // residual risk — do not block cookie tools solely on trusted_domains.
    const securityCfgEarly = getConfig().security
    const userFullAutonomyCruise =
      securityCfgEarly?.auto_approve_dangerous === true &&
      securityCfgEarly?.auto_approve_enterprise_tools === true &&
      securityCfgEarly?.allow_all_schemes === true
    const COOKIE_TOOLS = ["get_cookies", "set_cookie", "delete_cookie", "list_all_cookies"]
    if (COOKIE_TOOLS.includes(toolName)) {
      let isSafe = false
      let targetDomain = ""

      if (toolName === "get_cookies") {
        targetDomain = finalParams.domain || ""
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "set_cookie") {
        targetDomain = finalParams.domain || ""
        if (!targetDomain && finalParams.url) {
          targetDomain = getDomainFromUrl(finalParams.url)
        }
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "delete_cookie") {
        targetDomain = finalParams.domain || ""
        if (!targetDomain && finalParams.url) {
          targetDomain = getDomainFromUrl(finalParams.url)
        }
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "list_all_cookies") {
        // list_all_cookies is global; only safe if "*" is in trusted domains
        isSafe = isTrustedDomain("*")
        targetDomain = "Global / All Domains"
      }

      if (!isSafe && userFullAutonomyCruise) {
        isSafe = true
        logger.warn("security.cookie_trust_waived", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          target_domain: targetDomain || "unknown",
          reason: "full_autonomy_cruise",
        })
      }

      if (!isSafe) {
        // Plain-language path: Cookie 信任域 ≠ 全自动巡航 / auto_approved_domains.
        const result = cookieTrustBlockedPayload(targetDomain || "unknown", toolName)
        logger.warn("security.cookie_blocked", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          target_domain: targetDomain || "unknown",
          error_code: "COOKIE_TRUST_DENIED",
        })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
    }

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

    // L2 confirmation gate (evaluate / osascript_eval / host_read). Each of
    // these tools reaches host-side or browser-DOM state that requires explicit
    // user approval. NOTE: host_read is the first tool in this gate that reads
    // host-side USER DATA (Mail inbox) rather than browser-DOM or fixed
    // AppleScript.
    //
    // Under security.allow_all_schemes=true (god-mode), this gate is skipped
    // and the auto-approved path at line ~428 logs `security.auto_approved`
    // with `reason:"god_mode"` — that is the audit trail. God-mode itself is
    // gated upstream: enabling via UI requires the confirmation phrase, OR
    // the user can set it directly in config.json (per ADR-010, both paths
    // are explicit user opt-in). Vault-app bundle ids (1Password / Keychain /
    // etc) are still blocked unconditionally downstream in
    // host-use/darwin/blacklist.ts.
    //
    // Phase 1 W8-windows (adversary amendment A3): when a host_write L2
    // dialog will show on win32 and Windows Hello is unavailable, the
    // manual-nonce challenge rides INSIDE this same dialog. Declared here so
    // the executor can consume the prevalidated nonce after approval.
    let winL2NonceChallenge: string | undefined
    // App tab WP3: the tier this host_app call took through the gate
    // ("l2" | "app_whitelist" | "thread_trust" | "god_mode" | "global_toggle"),
    // forwarded to the executor for the apps.launch audit event.
    let hostAppTier: string | undefined
    // App tab WP3 (adversary 接线警示 ①): host_app joins the L2 gate tool
    // list — on win32 only. Off win32 the gate is skipped entirely so the
    // executor can return the typed platform error without a pointless dialog.
    const L2_GATE_TOOLS = [
      "evaluate",
      "osascript_eval",
      "host_read",
      "host_write",
      "shell_exec",
      "netsec_port_scan",
      // ADR-015: real HITL — LLM cannot self-approve spawn/ask via user_confirmed flag
      "spawn_worker",
      "ask_user",
      // ADR-016 G5/G6/G9: board_complete requires Confirm Center + canComplete
      "board_complete",
      // S41 multi-adv: durable skill-library write (content/path/zip) — L2 + forceConfirm
      "skill_install",
    ]
    const hostAppGated = toolName === "host_app" && (os.platform() === "win32" || os.platform() === "darwin")
    const hostCliGated = toolName === "host_cli" && (os.platform() === "win32" || os.platform() === "darwin")
    // Coordinate computer-use (WP1): critical-class — the task-level L2 dialog
    // is originWs-bound, and input injection is NEVER thread-trusted. God-mode
    // alone / auto_approve alone still forceConfirm; only three-flag
    // userFullAutonomy waives forceConfirm (same algebra as other critical tools).
    // Session-trust / unattended grant may skip initial L2 via hostComputerTrustSkip
    // (designed carve-out, not god-mode). Off win32 or darwin the gate is skipped
    // so the executor returns the typed platform error.
    const hostComputerGated = toolName === "host_computer" &&
      (os.platform() === "win32" || os.platform() === "darwin")
    // P0 platform filter: osascript_eval is macOS-only. Fail before L2 confirmation
    // so Windows/Linux never show a pointless confirm dialog (same idea as hostAppGated
    // skipping off-platform). Defense-in-depth still remains in executeCompanionTool.
    if (toolName === "osascript_eval" && !shouldL2GateOsascript(os.platform())) {
      const result = { success: false, error: OSASCRIPT_MACOS_ONLY_ERROR }
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }
    if ((L2_GATE_TOOLS.includes(toolName) || hostAppGated || hostCliGated || hostComputerGated) && !finalParams.security_token) {
      // shell_exec / netsec use command|targets for L2 preview text (not code/expression).
      // spawn_worker / ask_user use role/question summaries for the Confirm Center.
      const code = String(
        finalParams.code ||
          finalParams.expression ||
          finalParams.command ||
          (Array.isArray(finalParams.targets) ? finalParams.targets.join(", ") : "") ||
          (toolName === "spawn_worker"
            ? `Spawn worker role=${finalParams.role_label || finalParams.roleLabel || "worker"} alias=${finalParams.alias || ""} pack=${finalParams.pack_id || "none"} allow=${Array.isArray(finalParams.tool_allow) ? finalParams.tool_allow.join(",") : "default"}`
            : "") ||
          (toolName === "ask_user" ? String(finalParams.question || finalParams.prompt || "") : "") ||
          (toolName === "host_cli"
            ? `host_cli app=${finalParams.app || ""} sub=${finalParams.subcommand || ""}`
            : "") ||
          (toolName === "board_complete"
            ? `board_complete empty_complete=${!!finalParams.empty_complete} supporting=${Array.isArray(finalParams.supporting_fact_ids) ? finalParams.supporting_fact_ids.join(",") : ""} residual=${Array.isArray(finalParams.residual_risks) ? finalParams.residual_risks.slice(0, 3).join(" | ") : ""} reason=${finalParams.empty_complete_reason || finalParams.goal_summary || ""}`
            : "") ||
          (toolName === "skill_install"
            ? (() => {
                try {
                  // Lazy require keeps createToolExecutor load light; preview is best-effort.
                  const {
                    skillInstallOverwritePreview,
                    classifySkillInstallSource,
                    expandUserPath,
                  } = require("./skills/skill-install") as typeof import("./skills/skill-install")
                  const prev = skillInstallOverwritePreview(finalParams)
                  let tier = ""
                  const srcRaw = finalParams.path || finalParams.zip_path
                  if (srcRaw && typeof srcRaw === "string") {
                    try {
                      const fs = require("fs") as typeof import("fs")
                      const pathMod = require("path") as typeof import("path")
                      const resolved = fs.realpathSync(pathMod.resolve(expandUserPath(srcRaw)))
                      tier = classifySkillInstallSource(resolved)
                    } catch {
                      tier = "unresolved"
                    }
                  } else if (finalParams.content) {
                    tier = "content"
                  }
                  return `skill_install path=${finalParams.path || ""} zip=${finalParams.zip_path || ""} content_len=${typeof finalParams.content === "string" ? finalParams.content.length : 0} name=${prev.name || ""} overwrite=${prev.overwrite ? "true" : "false"} dest=${prev.dest_path || ""} source_tier=${tier}`
                } catch {
                  return `skill_install path=${finalParams.path || ""} zip=${finalParams.zip_path || ""} content_len=${typeof finalParams.content === "string" ? finalParams.content.length : 0}`
                }
              })()
            : "") ||
          "",
      )
      // skill_install: hard-deny outside home/Downloads/tmp/data BEFORE L2 dialog
      // (user home is allowed — L2 is the authorization; no pointless confirm then fail).
      if (toolName === "skill_install") {
        try {
          const {
            isSkillInstallSourceAllowed,
            expandUserPath,
            skillInstallSourceDeniedError,
          } = require("./skills/skill-install") as typeof import("./skills/skill-install")
          const fs = require("fs") as typeof import("fs")
          const pathMod = require("path") as typeof import("path")
          const srcField =
            typeof finalParams.path === "string" && finalParams.path.trim()
              ? ("path" as const)
              : typeof finalParams.zip_path === "string" && finalParams.zip_path.trim()
                ? ("zip_path" as const)
                : null
          if (srcField) {
            const raw = String(finalParams[srcField])
            try {
              const resolved = fs.realpathSync(pathMod.resolve(expandUserPath(raw)))
              if (!isSkillInstallSourceAllowed(resolved)) {
                const denied = skillInstallSourceDeniedError(srcField)
                const result = {
                  success: false,
                  error: denied.error,
                  data: { hint_zh: denied.hint_zh },
                }
                logToolFinish(toolCallId, toolName, startedAt, result)
                return result
              }
            } catch {
              // Missing path: let executor return path-not-found after L2 or fail here without dialog
              const result = {
                success: false,
                error: `${srcField} not found: ${raw}`,
              }
              logToolFinish(toolCallId, toolName, startedAt, result)
              return result
            }
          }
        } catch {
          /* preview/precheck best-effort — executor still enforces */
        }
      }
      const lengthCheck = securityPolicy.checkLength(toolName, code)
      if (!lengthCheck.ok) {
        const result = { success: false, error: lengthCheck.error }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }

      // Resolve acting domain so we can skip the confirmation dialog when the
      // user has whitelisted the domain (or enabled the global auto-approve).
      // evaluate({tabId}) → resolve via tabUrlCache. osascript_eval is EXCLUDED
      // from domain-based auto-approval: it is a fixed AppleScript wrapper that
      // only executes the supplied JS expression inside a Chrome tab via
      // `execute t javascript` (see the osascript_eval template below + §6.2) —
      // NOT arbitrary host AppleScript (no `do shell script`/keychain/Finder).
      // Its `url` parameter only locates a Chrome tab, not a meaningful trust
      // anchor, so whitelisting it by URL would let an attacker hide a
      // destructive JS payload behind a whitelisted URL. osascript_eval still
      // respects the global auto_approve_dangerous toggle (explicit user opt-in
      // for unattended workflows).
      const relevantDomain = toolName === "evaluate"
        ? getDomainFromUrl(getCachedTabUrl(finalParams.tabId) || "")
        : ""
      // Phase 1 W7 — relevant app for host_read/host_write (bundle id).
      // Used to populate inline-checkbox trust option in confirmation dialog.
      const relevantApp = (toolName === "host_read" || toolName === "host_write")
        ? resolveHostUseApp(toolName, finalParams)
        : ""

      // App tab WP3 — host_app policy resolution. The tier decision is made
      // HERE (the gate), never by the LLM and never from a tool param:
      //   apps.enabled kill-switch → typed error (no dialog)
      //   unknown token / disabled entry / non-gui kind / bad action → typed error
      //   policy "auto"   → skip L2 (L0 no-arg launch only), audit app_whitelist
      //   policy "ai"     → first launch in thread: L2 WITH trust checkbox;
      //                     trusted thread: skip (kind "app-launch", owner decision 2)
      //   policy "manual" → always L2, NO trust checkbox offered
      let hostApp: { token: string; entry: AppEntry; policy: AppPolicy } | null = null
      if (hostAppGated) {
        const appToken = String(finalParams.app || "")
        const action = String(finalParams.action || "")
        const fail = (error: string) => {
          const result = { success: false, error }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        if (!APP_TOKEN_PATTERN.test(appToken)) {
          return fail(`host_app: invalid app token "${appToken}" (expected [win|mac].app.<slug> / [win|mac].cli.<slug>)`)
        }
        if (action !== "launch") {
          return fail(`host_app: unsupported action "${action}" — Phase 1 supports "launch" (plain no-arg start) only`)
        }
        const appsCfg = getConfig().apps
        if (!appsCfg || appsCfg.enabled === false) {
          return fail(`host_app: the Apps feature is disabled (apps.enabled=false in config.json)`)
        }
        const entry = appsCfg.entries?.[appToken]
        if (!entry) {
          return fail(`host_app: unknown app token "${appToken}" — not in the App-tab whitelist. Only launch apps from the system-prompt app index; NEVER guess tokens.`)
        }
        if (!entry.enabled) {
          return fail(`host_app: app "${entry.display_name}" (${appToken}) is disabled in the App tab`)
        }
        if (entry.kind !== "gui") {
          return fail(`host_app: "${appToken}" is a CLI app — the CLI track is Phase-2 and cannot be launched yet`)
        }
        hostApp = { token: appToken, entry, policy: entry.policy }
      }
      // Coordinate computer-use (WP1) — pre-dialog fail-fast checks + A3
      // dialog payload (task + target app + EVERY type.text literal + budget).
      // The tier decision is made HERE; the dialog is critical-class and never
      // thread-trusted. forceConfirm (below) holds under god-mode alone; only
      // three-flag userFullAutonomy clears it. hostComputerTrustSkip may still
      // mint a token without dialog when session trust / unattended grant applies.
      let computerPreview = ""
      // WP4: L2 标注截图 + 三段式 caption(best-effort;undefined = 无图降级)。
      let computerL2PreviewImage: string | undefined
      let computerL2PreviewCaption: string | undefined
      // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24): when the session
      // already has a live trust grant for this app AND every type.text literal
      // in the new task was in the previously-approved corpus AND no credential
      // latch is set AND the grant is not idle-expired, skip the initial L2
      // dialog and mint the security_token directly. The grant's lastTouchedAt
      // is refreshed by isTrusted(); corpus does not need re-accumulation (the
      // skip-eligible task's corpus is by definition a subset of the stored one).
      let hostComputerTrustSkip = false
      /** ADR-021 audit: "session_trust_corpus_subset" | "unattended_session_grant" */
      let hostComputerTrustSkipReason: "session_trust_corpus_subset" | "unattended_session_grant" | null =
        null
      if (hostComputerGated) {
        const { assertCoordinateAllowed } = await import("./computer/policy")
        // Y3 (WP2): the preview text comes from the PURE builder — task text
        // JSON-escaped against layout spoofing, every injectable action
        // enumerated verbatim; unit-tested in computer-preview.test.ts.
        const { buildComputerL2Preview } = await import("./computer/preview")
        const failC = (error: string) => {
          const result = { success: false, error }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        try {
          const entryC = assertCoordinateAllowed(getConfig(), String(finalParams.app || ""))
          const budgetN = Math.min(Math.max(1, Number(finalParams.budget) || 15), 30)
          // R1 (§E.6.2): global single-task invariant — a second computer
          // task is refused BEFORE the L2 dialog while one is executing (no
          // queue, no wait). This early check only spares a pointless dialog;
          // the AUTHORITATIVE check-and-set is in executeCompanionTool, which
          // closes the race where both tasks passed this gate before either
          // registered.
          if (computerTaskAbort.size > 0) {
            return failC(
              "host_computer refused: another computer task is already executing (global single-task invariant, plan §E.6.2) [COMPUTER_TASK_BUSY] — wait for it to finish or abort it from the panel.",
            )
          }
          // Y7: session rate gate — a saturated 60s window refuses the task
          // BEFORE the L2 dialog; a runaway agent must not burn human clicks.
          const limiter = await computerRateLimiter()
          if (limiter.saturated()) {
            return failC(
              `host_computer refused: session injection rate limit reached (${limiter.countInWindow()}/30 in the last 60s) [RATE_LIMITED] — wait for the window to drain before starting another computer task.`,
            )
          }
          // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24 + Pi final
          // review caveat 1 budget gate 2026-07-24): G1 trust skip gate.
          // Consult session trust for (sessionId, app); require the new task's
          // type corpus to be a subset of the prior approved corpus AND the
          // budget to not exceed the largest previously-approved budget.
          // isTrusted() already enforces idle expiry (30 min, anchored to last
          // interactive approve) and credential latch — those need no separate
          // check here.
          if (sessionId && finalParams.app) {
            const {
              getComputerSessionTrust,
              resolveComputerTrustKey,
              trustKeyAllowsInitialSkip,
              g1InitialSkipEligible,
            } = await import("./computer/session-trust")
            const trust = getComputerSessionTrust()
            const appToken = String(finalParams.app)
            // Grill Q1=C: prefer chat thread for "本会话"; strip inject-only param.
            const chatThreadId =
              typeof (finalParams as any).__thread_id === "string"
                ? String((finalParams as any).__thread_id)
                : typeof (finalParams as any).thread_id === "string"
                  ? String((finalParams as any).thread_id)
                  : undefined
            const trustKey = resolveComputerTrustKey(chatThreadId, sessionId)
            const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
            const actionCount = actionsArr.length
            const typeCorpus: string[] = []
            let experimentalFlag = false
            for (const a of actionsArr) {
              if (a && typeof a === "object" && (a as any).action === "type" && typeof (a as any).text === "string") {
                typeCorpus.push(String((a as any).text))
              }
              if (a && typeof a === "object" && (a as any).experimental === true) experimentalFlag = true
            }
            // Grill Q2/Q3: single pure gate (g1InitialSkipEligible) — no drift vs tests.
            const maxBudget = trust.maxBudgetSeen(trustKey, appToken)
            const maxActions = trust.maxActionsSeen(trustKey, appToken)
            const modelEnabled = getConfig().computer?.modelEnabled === true
            if (
              g1InitialSkipEligible({
                trust,
                trustKey,
                app: appToken,
                typeCorpus,
                budget: budgetN,
                actionCount,
                experimental: experimentalFlag,
                // L-QW-2: config-level block — action.experimental alone is insufficient
                modelEnabled,
              })
            ) {
              hostComputerTrustSkip = true
              hostComputerTrustSkipReason = "session_trust_corpus_subset"
              logger.info("computer.session_trust.task_auto_approved", {
                tool_call_id: toolCallId,
                trust_key: trustKey,
                chat_thread_id: chatThreadId ?? null,
                app: appToken,
                type_corpus_size: typeCorpus.length,
                budget: budgetN,
                max_budget_seen: maxBudget,
                actions: actionCount,
                max_actions_seen: maxActions,
                explicit_opt_in: true,
              })
            } else {
              // ADR-021: process-memory unattended grant (sibling of G1, not god/auto_approve).
              // assertCoordinateAllowed already passed → coordinateAllowed true for this app.
              const { evaluateUnattendedHostComputerSkip, isUnattendedArmed } = await import(
                "./computer/unattended-grant"
              )
              const unattendedSkip = evaluateUnattendedHostComputerSkip({
                coordinateAllowed: true,
                experimental: experimentalFlag,
                modelEnabled,
                credentialLatched: trust.hasCredentialLatch(trustKey, appToken),
                budget: budgetN,
                actionCount,
              })
              if (unattendedSkip) {
                hostComputerTrustSkip = true
                hostComputerTrustSkipReason = "unattended_session_grant"
                logger.info("computer.unattended.task_auto_approved", {
                  tool_call_id: toolCallId,
                  trust_key: trustKey,
                  chat_thread_id: chatThreadId ?? null,
                  app: appToken,
                  budget: budgetN,
                  actions: actionCount,
                  reason: "unattended_session_grant",
                })
              } else {
                logger.info("computer.session_trust.skip_missed", {
                  tool_call_id: toolCallId,
                  trust_key: trustKey,
                  chat_thread_id: chatThreadId ?? null,
                  app: appToken,
                  trusted: trust.isTrusted(trustKey, appToken),
                  explicit_opt_in: trust.hasExplicitOptIn(trustKey, appToken),
                  key_allows_skip: trustKeyAllowsInitialSkip(trustKey),
                  corpus_eligible: trust.corpusContains(trustKey, appToken, typeCorpus),
                  budget_eligible: maxBudget > 0 && budgetN <= maxBudget,
                  actions_eligible: maxActions > 0 && actionCount <= maxActions,
                  experimental: experimentalFlag,
                  max_budget_seen: maxBudget,
                  max_actions_seen: maxActions,
                  unattended_armed: isUnattendedArmed(),
                })
              }
            }
          } else if (finalParams.app) {
            // No sessionId — G1 needs session; unattended is process-global (ADR-021).
            const { evaluateUnattendedHostComputerSkip, isUnattendedArmed } = await import(
              "./computer/unattended-grant"
            )
            const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
            let experimentalFlag = false
            for (const a of actionsArr) {
              if (a && typeof a === "object" && (a as any).experimental === true) experimentalFlag = true
            }
            if (
              evaluateUnattendedHostComputerSkip({
                coordinateAllowed: true,
                experimental: experimentalFlag,
                modelEnabled: getConfig().computer?.modelEnabled === true,
                credentialLatched: false,
                budget: budgetN,
                actionCount: actionsArr.length,
              })
            ) {
              hostComputerTrustSkip = true
              hostComputerTrustSkipReason = "unattended_session_grant"
              logger.info("computer.unattended.task_auto_approved", {
                tool_call_id: toolCallId,
                app: String(finalParams.app || ""),
                budget: budgetN,
                actions: actionsArr.length,
                reason: "unattended_session_grant",
                no_session_id: true,
              })
            } else if (isUnattendedArmed()) {
              logger.info("computer.unattended.skip_missed", {
                tool_call_id: toolCallId,
                experimental: experimentalFlag,
              })
            }
          }
          computerPreview = buildComputerL2Preview({
            task: String(finalParams.task || ""),
            appDisplayName: entryC.display_name,
            appToken: entryC.token,
            budget: budgetN,
            actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
            extraLines: [limiter.statusLine()],
          })
          // WP4 (护栏 a,对抗裁决定案):L2 标注截图 helper 的调用点固定在这
          // 里——全部廉价前门(assertCoordinateAllowed / COMPUTER_TASK_BUSY /
          // rate-limit)通过之后、L2 对话框发出之前;后续重构不得挪前(每次
          // 确认 ≤5s 的代价只对真实候选任务支付)。best-effort:helper 失败/
          // 超时/非 win32|darwin/无 exe(AUMID 条目)一律降级无图,绝不影响确认门。
          if (os.platform() === "darwin" && (entryC.bundleId || entryC.exe?.path)) {
            try {
              const { buildComputerL2PreviewImage } = await import("./computer/l2-preview-image")
              const { MacScreenCapturer, MacLocator, MacWindowEnumerator, MacPreviewBuilder } = await import("./computer/darwin-adapters")
              const l2img = await buildComputerL2PreviewImage(
                {
                  windows: new MacWindowEnumerator(),
                  capturer: new MacScreenCapturer(),
                  locator: new MacLocator(),
                  previewBuilder: new MacPreviewBuilder(),
                  log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
                },
                {
                  exePath: entryC.bundleId ?? entryC.exe?.path ?? "",
                  appDisplayName: entryC.display_name,
                  actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
                  timeoutMs: 5000,
                },
              )
              if (l2img) {
                computerL2PreviewImage = l2img.image
                computerL2PreviewCaption = l2img.caption
              }
            } catch (helperErr: any) {
              // best-effort:helper 异常绝不拒飞任务(降级无图)。
              logger.info("computer.l2preview.failed", { tool_call_id: toolCallId, error: helperErr?.message || String(helperErr) })
            }
          } else if (os.platform() === "win32" && entryC.exe?.path) {
            try {
              const { buildComputerL2PreviewImage } = await import("./computer/l2-preview-image")
              const { PsScreenCapturer, PsLocator, PsWindowEnumerator, PsPreviewBuilder } = await import("./computer/win-adapters")
              const l2img = await buildComputerL2PreviewImage(
                {
                  windows: new PsWindowEnumerator(),
                  capturer: new PsScreenCapturer(),
                  locator: new PsLocator(),
                  previewBuilder: new PsPreviewBuilder(),
                  log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
                },
                {
                  exePath: entryC.exe.path,
                  appDisplayName: entryC.display_name,
                  actions: Array.isArray(finalParams.actions) ? finalParams.actions : [],
                  timeoutMs: 5000,
                },
              )
              if (l2img) {
                computerL2PreviewImage = l2img.image
                computerL2PreviewCaption = l2img.caption
              }
            } catch (helperErr: any) {
              // best-effort:helper 异常绝不拒飞任务(降级无图)。
              logger.info("computer.l2preview.failed", { tool_call_id: toolCallId, error: helperErr?.message || String(helperErr) })
            }
          }
        } catch (err: any) {
          return failC(err?.message || String(err))
        }
      }
      const securityConfig = getConfig().security
      // skipL2 = auto_approve_dangerous || allow_all_schemes || (domain whitelist)
      //         || (Phase 1 W7: thread-scoped host_read trust).
      // allow_all_schemes (GOD-MODE) bypasses Layer 2 too — see config.ts SecurityConfig.
      // Phase 1 W7 Q1 blocker: thread-scoped trust applies to READ only.
      // Writes always go through confirmation (biometric tier is preserved).
      let threadTrusted = false
      if (toolName === "host_read" && relevantApp && sessionId) {
        threadTrusted = getThreadApprovals().has(sessionId, relevantApp, "read")
        if (threadTrusted) {
          logger.info("security.thread_auto_approved", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            thread_id: sessionId,
            bundle_id: relevantApp,
            kind: "read",
          })
        }
      }
      // App tab WP3 (owner decision 2 — W7 Blocker-1 "app-launch" exception):
      // under policy "ai", a launch already trusted in this thread skips L2.
      // "manual" NEVER consults thread-trust (even if a stale entry existed).
      if (hostApp && hostApp.policy === "ai" && sessionId) {
        threadTrusted = getThreadApprovals().has(sessionId, hostApp.token, "app-launch")
        if (threadTrusted) {
          logger.info("security.thread_auto_approved", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            thread_id: sessionId,
            bundle_id: hostApp.token,
            kind: "app-launch",
          })
        }
      }
      // App tab WP3 (owner decision 1): auto = 仅启动免确认 — an L0 no-arg
      // launch of an auto-policy app skips L2. (P1 ships launch only; any
      // future with-args op must NOT inherit this skip — adversary D3.)
      const appWhitelisted = hostApp?.policy === "auto"
      let skipConfirmation = securityConfig.auto_approve_dangerous === true
        || securityConfig.allow_all_schemes === true
        || (relevantDomain !== "" && isAutoApprovedDomain(relevantDomain))
        || threadTrusted
        || appWhitelisted
      // Q5 (L-CLI-5): after host_cli output in this thread, force L2 for host_cli
      // and host_app until the next real user message.
      try {
        const { isCliOutputTainted } = require("./apps/cli-q5") as typeof import("./apps/cli-q5")
        const q5Thread =
          typeof (finalParams as any).__thread_id === "string"
            ? String((finalParams as any).__thread_id)
            : sessionId
        if (isCliOutputTainted(q5Thread) && (toolName === "host_cli" || toolName === "host_app")) {
          skipConfirmation = false
          logger.info("security.cli_q5_force_l2", { tool_name: toolName, thread: q5Thread })
        }
      } catch { /* ignore */ }
      // §6.2 CRITICAL_API_GATE: detectCriticalApis() is the never-auto-approved
      // subset of detectDangerousApis() (exfil + sandbox-escape + obfuscation
      // variants). Domain whitelist / god-mode alone / auto_approve_dangerous
      // alone still force interactive confirmation for a non-empty critical set
      // (domain trust ≠ page-content trust; M3' invariant). Only three-flag
      // full autonomy cruise (auto_approve_dangerous + enterprise + allow_all
      // schemes) waives forceConfirm — residual risk is explicit product choice.
      //
      // Coordinate computer-use: critical-class BY DESIGN (plan §E.3) — the
      // capability itself is the critical surface; waived only under full
      // autonomy cruise (same three-flag gate).
      // shell_exec / netsec_port_scan: force interactive confirm unless Plan A/B
      // enterprise skip (scope ∩ first) or full autonomy. God-mode /
      // auto_approve_dangerous alone still do NOT skip these (ADR-014 G1).
      // spawn_worker / ask_user / board_complete: real HITL (never LLM self-approve)
      const capabilityForceConfirm =
        toolName === "shell_exec" ||
        toolName === "netsec_port_scan" ||
        toolName === "spawn_worker" ||
        toolName === "ask_user" ||
        toolName === "board_complete" ||
        toolName === "host_cli" || // L-CLI-9: god-mode never skips host_cli L2
        toolName === "skill_install" // S41: durable skill write — god-mode never skips
      const userFullAutonomy =
        securityConfig.auto_approve_dangerous === true &&
        securityConfig.auto_approve_enterprise_tools === true &&
        securityConfig.allow_all_schemes === true
      const criticalApis = hostComputerGated
        ? ["computer.coordinate_injection"]
        : capabilityForceConfirm
          ? [toolName]
          : detectCriticalApis(code)
      // Waive forceConfirm only under three-flag full autonomy cruise.
      // Browser scripts under domain whitelist / god-mode alone still forceConfirm.
      const forceConfirm = criticalApis.length > 0 && !userFullAutonomy
      if (criticalApis.length > 0 && userFullAutonomy) {
        logger.info("security.critical_api_waived", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          critical_apis: criticalApis,
          reason: "full_autonomy_cruise",
          relevant_domain: relevantDomain || undefined,
        })
      }

      // Plan A/B: enterprise L2 skip for shell/netsec only (G1–G5)
      let enterpriseSkip = false
      let enterpriseSkipReason: "enterprise_global" | "enterprise_session" | null = null
      let enterpriseFamily: EnterpriseToolFamily | null = familyOfTool(toolName)
      let enterpriseScopeFingerprint: string | undefined
      if (enterpriseFamily) {
        if (enterpriseFamily === "netsec") {
          const mod = getModule("netsec")
          const thread = actingThreadId ? threadManager.get(actingThreadId) : null
          const scope = checkNetsecScope({
            targets: Array.isArray(finalParams.targets) ? finalParams.targets.map(String) : [],
            allowlist: mod?.target_allowlist || [],
            requireTaskAuth: mod?.require_task_auth !== false,
            taskAuth: (thread as any)?.netsec_task_auth || null,
            moduleEnabled: isModuleEnabled("netsec"),
          })
          if (!scope.ok) {
            return {
              success: false,
              error: scope.error,
              data: { error_code: "NETSEC_SCOPE_DENIED" },
            }
          }
          enterpriseScopeFingerprint = netsecScopeFingerprint(
            scope.allowlist,
            (thread as any)?.netsec_task_auth?.targets,
          )
        } else {
          const scope = checkShellScope(String(finalParams.command || ""))
          if (!scope.ok) {
            return {
              success: false,
              error: scope.error,
              data: { error_code: "SHELL_SCOPE_DENIED" },
            }
          }
        }
        const sec = securityConfig
        const trustKey = resolveEnterpriseTrustKey(actingThreadId)
        if (sec?.auto_approve_enterprise_tools === true) {
          enterpriseSkip = true
          enterpriseSkipReason = "enterprise_global"
        } else if (
          trustKey &&
          enterpriseSessionTrust.isActive(
            trustKey,
            enterpriseFamily,
            Date.now(),
            enterpriseFamily === "netsec" ? enterpriseScopeFingerprint : null,
          )
        ) {
          enterpriseSkip = true
          enterpriseSkipReason = "enterprise_session"
        }
      }

      // G1: enterpriseSkip is sibling of hostComputerTrustSkip — do not only clear forceConfirm
      if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip) {
        // Audit item 2: default-deny. ALL evaluate/osascript_eval calls require
        // interactive confirmation unless whitelisted above. The regex match
        // (safety.dangerousApis) becomes a risk-preview escalation hint shown to
        // the user — it no longer gates WHETHER to confirm, only HOW SCARY the
        // preview looks.
        const safety = checkHighRiskExecution(toolName, code)
        if (ws.readyState !== WebSocket.OPEN) {
          const result = {
            success: false,
            error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, "unavailable"),
            data: { dangerous_apis_found: safety.dangerousApis },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        logger.warn("security.confirmation.requested", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          dangerous_apis: safety.dangerousApis,
          critical_apis: criticalApis,
          force_confirm: forceConfirm,
        })
        // Phase 1 W8-windows (adversary amendment A3 — single-dialog nonce
        // routing): for host_write on win32, probe Windows Hello availability
        // BEFORE showing this L2 dialog. When Hello is unavailable, the
        // manual-nonce challenge is attached to THIS SAME request (the
        // extension renders an inline paste-blocked nonce input,
        // App.tsx:299-377) — no second executor-internal prompt on the
        // normal path. The standalone executor prompt is retained only for
        // the skip-L2 path (god-mode / auto-approve).
        if (toolName === "host_write" && os.platform() === "win32") {
          const { probeWindowsHello } = await import("./host-use/win")
          if (!(await probeWindowsHello())) {
            const { generateManualNonce } = await import("./host-use/nonce")
            winL2NonceChallenge = generateManualNonce()
            // Adversary amendment 7a: dedicated downgrade audit event.
            logger.info("security.biometric.downgrade", {
              tool_call_id: toolCallId,
              reason: "windows_hello_unavailable",
            })
          }
        }
        // ADR-015 GATE1: order = (optional flight reserve) → L2 admission → SOFT → confirm.
        // SOFT after admission so softDeadline (= confirm timeout) cannot expire mid-queue.
        // Flight reserve for shell/netsec so approve is never followed by *_BUSY.
        const { TAB_L2_TOOLS } = await import("./orchestrator/constants")
        let tabL2SoftHeld = false
        let tabL2HardPromoted = false
        let flightReserved: "shell_exec" | "netsec_port_scan" | null = null
        const flightOwner = String(actingThreadId || "unknown")

        if (toolName === "shell_exec" || toolName === "netsec_port_scan") {
          const { tryAcquireFlight, releaseFlight } = await import("./orchestrator/single-flight")
          const flight = tryAcquireFlight(toolName, flightOwner)
          if (!flight.ok) {
            const result = {
              success: false,
              error: flight.error,
              data: {
                error_code: toolName === "shell_exec" ? "SHELL_BUSY" : "NETSEC_BUSY",
                holder: flight.holder,
              },
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
          flightReserved = toolName
          // releaseFlight referenced only for deny/timeout paths below
          void releaseFlight
        }

        let decision: Awaited<ReturnType<typeof securityConfirmations.request>> | undefined
        try {
        // L2 FIFO admission FIRST (≤1 per orchestrator_run, ≤2 process-wide)
        const maForL2 = actingThreadId && threadManager
          ? (threadManager.get(actingThreadId) as any)
          : null
        const { acquireL2Admission, releaseL2Admission } = await import("./orchestrator/l2-admission")
        const admit = await acquireL2Admission({
          orchestratorRunId: maForL2?.orchestrator_run_id,
          threadId: actingThreadId,
        })
        if (!admit.ok) {
          if (flightReserved) {
            const { releaseFlight } = await import("./orchestrator/single-flight")
            releaseFlight(flightReserved, flightOwner)
            flightReserved = null
          }
          const result = {
            success: false,
            error: admit.error,
            data: { error_code: "L2_ADMISSION_TIMEOUT" },
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        const l2AdmitKey = admit.key

        // Exclusive SOFT / HELD_PENDING_L2 after admission (TAB_L2_TOOLS) — multi-agent only.
        // Normal single-agent evaluate still goes through Confirm / L2 admission without
        // taking a tab lease (see early HARD gate above).
        {
          const {
            isMultiAgentThread: isMaThread,
            anyTabLeaseHeld: anyLeaseHeld,
            acquireOrRenewTabLease,
          } = await import("./orchestrator")
          const multiForSoft = isMaThread(maForL2) || anyLeaseHeld()
          if (
            multiForSoft &&
            TAB_L2_TOOLS.has(toolName) &&
            typeof finalParams.tabId === "number" &&
            actingThreadId
          ) {
            const soft = acquireOrRenewTabLease({
              tabId: finalParams.tabId,
              holderThreadId: actingThreadId,
              needsL2: true,
              confirmId: toolCallId,
            })
            if (!soft.ok) {
              releaseL2Admission(l2AdmitKey)
              if (flightReserved) {
                const { releaseFlight } = await import("./orchestrator/single-flight")
                releaseFlight(flightReserved, flightOwner)
                flightReserved = null
              }
              const result = {
                success: false,
                error: soft.error,
                data: {
                  error_code: soft.error_code,
                  tab_id: soft.tab_id,
                  holder_thread_id: soft.holder_thread_id,
                },
              }
              logToolFinish(toolCallId, toolName, startedAt, result)
              return result
            }
            tabL2SoftHeld = true
          }
        }

        try {
        decision = await (async () => {
          // P0a — pre-generate confirmationId so WS + tray channels share it.
          // Whichever resolves first wins (manager.pending is keyed by id, first
          // responder claims it). See capability-token-round1-synthesis §P0a.
          const sharedConfirmId = randomUUID()

          // Build the same preview text for the tray dialog as the WS Side Panel
          // gets (computerPreview for host_computer; otherwise the tool's code).
          const traySummary = hostComputerGated && computerPreview
            ? computerPreview
            : hostApp
              ? `Launch app "${hostApp.entry.display_name}" (${hostApp.token}) — no arguments`
              : code
          const tray = getTrayInstance()
          // Tray dialog only when Swift backend can actually show a native
          // confirm (S42 P1 Compat-C5). systray2/readline return a never-resolving
          // Promise — marking them trayEligible lied on Windows/Linux and held
          // Promise.race with a dead contender. Win Hello nonce still needs Side Panel.
          let trayBackendIsSwift = false
          try {
            const { detectTrayBackend } = require("./tray/tray-adapter") as typeof import("./tray/tray-adapter")
            trayBackendIsSwift = detectTrayBackend() === "swift"
          } catch {
            trayBackendIsSwift = false
          }
          const trayEligible = !!tray && !winL2NonceChallenge && trayBackendIsSwift
          const trayReq: TrayConfirmRequest | null = trayEligible
            ? {
                id: sharedConfirmId,
                toolName: isOutboundMcpCall ? `[Outbound] ${toolName}` : toolName,
                riskLevel: forceConfirm
                  ? "high"
                  : safety.dangerousApis.length > 0 || isOutboundMcpCall ? "medium" : "low",
                // Truncate to keep NSWindow readable — full text goes to Side Panel.
                summary: traySummary.length > 800 ? traySummary.slice(0, 800) + "…" : traySummary,
                criticalApis,
                timeoutMs: DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS,
              }
            : null
          const trayPromise = trayReq && tray
            ? tray.showConfirmDialog(trayReq).then((r) => ({
                source: "tray" as const,
                approved: r.approved,
              }))
              // C-P0-7 (2026-07-24 diagnosis): swallow tray adapter rejects
              // (IPC error, Swift crash, adapter bug). Without this, the
              // rejection propagates through Promise.race and the wsPromise
              // lingers in securityConfirmations.pending until the 45s
              // timeout — meanwhile the user gets no UI and the tool call
              // hangs. Now: a rejected tray promise resolves to null, the
              // race picks wsPromise (the only remaining contender), and
              // the Side Panel dialog still works.
              .catch(() => null as null | { source: "tray"; approved: boolean })
            : null

          // C-P0-6: register this sharedConfirmId against the active ws so
          // ws.on("close") can cancel the tray dialog if the WS dies first.
          if (trayPromise) {
            let set = activeTrayConfirmsByWs.get(ws)
            if (!set) {
              set = new Set()
              activeTrayConfirmsByWs.set(ws, set)
            }
            set.add(sharedConfirmId)
          }

          // ADR-015 Confirm Center: stamp multi-agent identity when known
          const maThread = actingThreadId && threadManager
            ? (threadManager.get(actingThreadId) as any)
            : null
          const multiAgentFields =
            maThread && (maThread.agent_role === "worker" || maThread.agent_role === "orchestrator" || maThread.parent_thread_id)
              ? {
                  workerId: actingThreadId,
                  parentThreadId: maThread.parent_thread_id || undefined,
                  orchestratorRunId: maThread.orchestrator_run_id || undefined,
                  workerRoleLabel: maThread.worker_role_label || maThread.alias || undefined,
                  tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
                }
              : actingThreadId
                ? {
                    workerId: actingThreadId,
                    tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
                  }
                : {}

          // ADR-016 G6: board_complete Confirm digest (goal, trust hist, claims, residual, empty flag)
          let boardCompleteDigestForConfirm: any = undefined
          if (toolName === "board_complete" && threadManager && actingThreadId) {
            try {
              const { readBoard, buildBoardCompleteDigest, resolveBoardHostThreadId } =
                await import("./board")
              const hostId =
                resolveBoardHostThreadId(threadManager, String(actingThreadId)) ||
                String(actingThreadId)
              const b = readBoard(threadManager, hostId)
              if (b) {
                boardCompleteDigestForConfirm = buildBoardCompleteDigest(b, {
                  supporting_fact_ids: Array.isArray(finalParams.supporting_fact_ids)
                    ? finalParams.supporting_fact_ids.map(String)
                    : [],
                  residual_risks: Array.isArray(finalParams.residual_risks)
                    ? finalParams.residual_risks.map(String)
                    : [],
                  empty_complete: finalParams.empty_complete === true,
                  empty_complete_reason:
                    finalParams.empty_complete_reason != null
                      ? String(finalParams.empty_complete_reason)
                      : null,
                })
              }
            } catch {
              /* digest is best-effort for UI */
            }
          }

          // ADR-022 L8: outbound MCP must not depend on Side Panel focus alone.
          // Fan-out confirm to every authenticated panel; leave origin unbound
          // (any authenticated peer may respond). Nonce/host_computer still
          // origin-bound when NOT outbound (A1).
          const sendConfirm = (data: any) => {
            const payload = JSON.stringify(data)
            if (isOutboundMcpCall) {
              for (const c of clients) {
                if (c.readyState === WebSocket.OPEN && wsAuth.get(c)?.authenticated === true) {
                  try {
                    c.send(payload)
                  } catch {
                    /* best-effort fan-out */
                  }
                }
              }
              // Executor-bound socket always (extension peer; tests without clients set)
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(payload)
                } catch {
                  /* ignore */
                }
              }
            } else if (ws.readyState === WebSocket.OPEN) {
              ws.send(payload)
            }
          }
          if (isOutboundMcpCall) {
            logger.info("outbound_mcp.confirm_fanout", {
              tool_call_id: toolCallId,
              tool_name: toolName,
              caller: String((finalParams as any).__outbound_caller_id || ""),
              tray: !!trayEligible,
            })
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const notifier = require("node-notifier") as {
                notify: (o: { title?: string; message?: string; sound?: boolean }) => void
              }
              notifier.notify({
                title: "CMspark 需要确认",
                message: `Outbound MCP 请求: ${toolName} — 请在托盘或 Side Panel 批准/拒绝`,
                sound: true,
              })
            } catch {
              /* optional — non-Swift platforms */
            }
          }

          const confirmOriginOpts =
            isOutboundMcpCall
              ? undefined // L8: any authenticated peer + tray may resolve
              : winL2NonceChallenge || hostComputerGated
                ? { originWs: ws }
                : undefined

          const wsPromise = securityConfirmations.request(
            sendConfirm,
            {
              toolName,
              dangerousApis: safety.dangerousApis,
              // App tab WP3: no code to preview — show WHAT will be launched.
              // host_computer (A3): show the task + app + EVERY type.text literal.
              code: hostComputerGated
                ? computerPreview
                : hostApp
                  ? `Launch app "${hostApp.entry.display_name}" (${hostApp.token}) — no arguments`
                  : code,
              relevantDomains: relevantDomain ? [relevantDomain] : [],
              // App tab WP3: the thread-trust checkbox (relevantApps) is offered
              // ONLY under policy "ai". "manual" must never show it (owner
              // decision 2); "auto" never reaches this dialog.
              // host_computer (grill Q2 2026-07-26): offer app token so the
              // panel can show "本会话自动同意同类操作" (session trust opt-in,
              // NOT ThreadApprovals / not write-biometric skip).
              relevantApps: hostComputerGated
                ? (finalParams.app ? [String(finalParams.app)] : [])
                : hostApp
                  ? (hostApp.policy === "ai" ? [hostApp.token] : [])
                  : (relevantApp ? [relevantApp] : []),
              criticalApis,
              ...(forceConfirm ? { riskLevel: "high" as const, autoConfirmEligible: false } : {}),
              // Plan A: offer enterprise session trust when B is off and tool is shell/netsec
              ...(enterpriseFamily &&
              securityConfig.auto_approve_enterprise_tools !== true
                ? { offerEnterpriseSessionTrust: true }
                : {}),
              ...(winL2NonceChallenge ? { nonceChallenge: winL2NonceChallenge } : {}),
              // P1 (WP4): computer 类确认的完整预览文本走独立字段,绕过
              // code_preview 的 CODE_PREVIEW_LIMIT=1200 截断(30 动作 + 2000
              // 语料的逐条枚举对人完整可见);其余工具不设置,修复面收窄。
              ...(hostComputerGated && computerPreview ? { fullPreview: computerPreview } : {}),
              // WP4 (§F.1): L2 标注截图 + 三段式非绑定 caption(best-effort,
              // 仅存在时下发;绝不进入工具结果/LLM 上下文——P2 不变量)。
              ...(computerL2PreviewImage ? { previewImage: computerL2PreviewImage } : {}),
              ...(computerL2PreviewCaption ? { previewCaption: computerL2PreviewCaption } : {}),
              ...multiAgentFields,
              // ADR-016 G6: attach board_complete digest when available
              ...(toolName === "board_complete" && boardCompleteDigestForConfirm
                ? { boardCompleteDigest: boardCompleteDigestForConfirm }
                : {}),
            },
            confirmOriginOpts,
            // P0a: pre-generated id shared with tray.
            sharedConfirmId,
          )

          if (!trayPromise) {
            // No tray (or Windows-nonce path) — straight WS, original behavior.
            return wsPromise
          }

          // Race: first responder wins. Loser is silenced (manager.pending.delete
          // means the second response is a no-op; tray dialog is closed via cancel).
          // trayPromise may resolve to null if the tray adapter rejected (C-P0-7).
          const winner: { source: "ws"; decision: SecurityConfirmationDecision } | { source: "tray"; approved: boolean } | null =
            await Promise.race([
              wsPromise.then((d): { source: "ws"; decision: SecurityConfirmationDecision } => ({
                source: "ws", decision: d,
              })),
              trayPromise,
            ])
          // C-P0-6: confirmation resolved (one way or another) — drop from
          // activeTrayConfirmsByWs so ws.close doesn't try to cancel a dialog
          // that's already gone.
          activeTrayConfirmsByWs.get(ws)?.delete(sharedConfirmId)

          if (winner === null) {
            // Tray rejected — fall back to WS-only path. wsPromise still races
            // in the rest of this async block; just bypass tray-cancellation.
            return await wsPromise
          }
          if (winner.source === "ws") {
            tray!.cancelConfirm(sharedConfirmId)
            return winner.decision
          }
          // Tray responded first — propagate to manager so the WS Side Panel also
          // gets its resolved message (extension closes its dialog). respond() is
          // the privileged path that bypasses originWs check; tray is a trusted
          // single-instance local channel, no rogue-peer risk.
          securityConfirmations.respond(sharedConfirmId, winner.approved)
          return await wsPromise
        })()
        } finally {
          releaseL2Admission(l2AdmitKey)
        }
        if (!decision || !decision.approved) {
          if (flightReserved) {
            const { releaseFlight } = await import("./orchestrator/single-flight")
            releaseFlight(flightReserved, flightOwner)
            flightReserved = null
          }
          const reason =
            !decision ? "unavailable" : decision.reason === "approved" ? "unavailable" : decision.reason
          const result = {
            success: false,
            error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, reason),
            data: { dangerous_apis_found: safety.dangerousApis },
          }
          logger.warn("security.confirmation.denied", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            reason,
            dangerous_apis: safety.dangerousApis,
          })
          if (forceConfirm) {
            logger.warn("security.critical_capability_denied", {
              tool_call_id: toolCallId,
              tool_name: toolName,
              critical_apis: criticalApis,
              god_mode_active: securityConfig.allow_all_schemes === true,
              auto_approve_active: securityConfig.auto_approve_dangerous === true,
              relevant_domain: relevantDomain,
              reason,
            })
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        if (tabL2SoftHeld && typeof finalParams.tabId === "number" && actingThreadId) {
          const { hardReacquireAfterConfirm } = await import("./orchestrator")
          const hard = hardReacquireAfterConfirm({
            tabId: finalParams.tabId,
            holderThreadId: actingThreadId,
            confirmId: toolCallId,
          })
          if (!hard.ok) {
            // SOFT/HELD_PENDING_L2 released in outer finally (!tabL2HardPromoted)
            if (flightReserved) {
              const { releaseFlight } = await import("./orchestrator/single-flight")
              releaseFlight(flightReserved, flightOwner)
              flightReserved = null
            }
            const result = {
              success: false,
              error: hard.error,
              data: {
                error_code: hard.error_code,
                tab_id: hard.tab_id,
                holder_thread_id: hard.holder_thread_id,
              },
            }
            logToolFinish(toolCallId, toolName, startedAt, result)
            return result
          }
          tabL2HardPromoted = true
        }
        // Transfer flight ownership to executeCompanionTool (re-entrant same owner).
        // Clear local flag without releaseFlight so finally does not free it.
        flightReserved = null
        logger.info("security.confirmation.approved", { tool_call_id: toolCallId, tool_name: toolName })
        // UX-spike 2026-07-23: record per-session re-L2 trust for computer-use.
        // The INITIAL task L2 just gated the whole task; subsequent mid-task
        // re-L2 pauses (FOREGROUND-YIELD that escaped self-UI recovery,
        // budget exhaustion, dialog-suspected) in THIS session for THIS app
        // will auto-approve. Only reL2() in the executor consults this — the
        // initial L2 above always asks. See computer/session-trust.ts.
        //
        // P5 / Grok v4.1 §3.2 (Pi re-confirm PROCEED 2026-07-24): on interactive
        // approve, ALSO clear the credential latch (user just re-consented with
        // a fresh preview) AND extend the type corpus with this task's type.text
        // literals — so a future task with the same-or-subset corpus is eligible
        // for the G1 trust skip above.
        if (hostComputerGated && finalParams.app) {
          const { getComputerSessionTrust, resolveComputerTrustKey } = await import("./computer/session-trust")
          const trust = getComputerSessionTrust()
          const appToken = String(finalParams.app)
          const chatThreadId =
            typeof (finalParams as any).__thread_id === "string"
              ? String((finalParams as any).__thread_id)
              : typeof (finalParams as any).thread_id === "string"
                ? String((finalParams as any).thread_id)
                : undefined
          const trustKey = resolveComputerTrustKey(chatThreadId, sessionId)
          // Grill Q2: always grant for task-local reL2 silence; explicitOptIn
          // only when user checked the session auto-approve box.
          const explicitOptIn = decision.addToSessionTrust === true
          trust.grant(trustKey, appToken, { explicitOptIn })
          trust.clearCredentialLatch(trustKey, appToken)
          const budgetRec = Number(finalParams.budget) || 15
          trust.recordBudget(trustKey, appToken, budgetRec)
          const actionsArr = Array.isArray(finalParams.actions) ? finalParams.actions : []
          // User test 2026-07-26 (#wrsihk): LLM often task-splits into 1-action
          // host_computer calls. Recording only actions.length left
          // maxActionsSeen=1 so the next 2-click task failed actions_eligible
          // even after explicit opt-in. The L2 preview already gates on
          // budget — treat approved budget as the actions floor when larger.
          trust.recordActions(
            trustKey,
            appToken,
            Math.max(actionsArr.length, budgetRec),
          )
          const typeTexts: string[] = []
          for (const a of actionsArr) {
            if (a && typeof a === "object" && (a as any).action === "type" && typeof (a as any).text === "string") {
              typeTexts.push(String((a as any).text))
            }
          }
          if (typeTexts.length > 0) {
            trust.extendCorpus(trustKey, appToken, typeTexts)
          }
          logger.info("computer.session_trust.granted", {
            tool_call_id: toolCallId,
            trust_key: trustKey,
            chat_thread_id: chatThreadId ?? null,
            app: appToken,
            corpus_extended_by: typeTexts.length,
            budget_recorded: budgetRec,
            actions_recorded: actionsArr.length,
            explicit_opt_in: explicitOptIn,
          })
        }
        if (hostApp) hostAppTier = "l2"
        // Plan A: record enterprise session grant when user checked the box (per-family G3)
        if (
          decision?.approved &&
          decision.addToEnterpriseSessionTrust === true &&
          enterpriseFamily
        ) {
          const ek = resolveEnterpriseTrustKey(actingThreadId)
          if (ek) {
            enterpriseSessionTrust.grant(ek, [enterpriseFamily], {
              scopeFingerprint:
                enterpriseFamily === "netsec" ? enterpriseScopeFingerprint : undefined,
            })
            logger.info("security.enterprise_session_trust.granted", {
              tool_call_id: toolCallId,
              tool_name: toolName,
              family: enterpriseFamily,
              trust_key: ek,
              thread_id: actingThreadId ?? null,
            })
          }
        }
        if (forceConfirm) {
          logger.info("security.critical_capability_confirmed", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            critical_apis: criticalApis,
            god_mode_active: securityConfig.allow_all_schemes === true,
            auto_approve_active: securityConfig.auto_approve_dangerous === true,
            enterprise_auto_approve: securityConfig.auto_approve_enterprise_tools === true,
            relevant_domain: relevantDomain,
          })
        }
        } finally {
          // Pair tabL2SoftHeld with finally: release SOFT/HELD_PENDING_L2 on any
          // non-success exit (throw / deny / timeout / hard re-acquire fail).
          // Successful hard promote sets tabL2HardPromoted and keeps HARD.
          if (
            tabL2SoftHeld &&
            !tabL2HardPromoted &&
            typeof finalParams.tabId === "number" &&
            actingThreadId
          ) {
            try {
              const { releaseSoftOrPendingL2 } = await import("./orchestrator")
              releaseSoftOrPendingL2({
                tabId: finalParams.tabId,
                holderThreadId: actingThreadId,
                confirmId: toolCallId,
              })
            } catch {
              /* best-effort */
            }
          }
          // Exception path: flight still reserved and not transferred to execute → free it.
          // Deny paths release+null explicitly; approve sets flightReserved=null without release.
          if (flightReserved) {
            try {
              const { releaseFlight } = await import("./orchestrator/single-flight")
              releaseFlight(flightReserved, flightOwner)
            } catch {
              /* best-effort */
            }
          }
        }
      } else if (enterpriseSkip) {
        logger.info("security.enterprise_auto_approved", {
          tool_call_id: toolCallId,
          tool: toolName,
          reason: enterpriseSkipReason,
          thread_id: actingThreadId ?? null,
          targets:
            enterpriseFamily === "netsec" && Array.isArray(finalParams.targets)
              ? finalParams.targets.map(String)
              : undefined,
          command_prefix:
            enterpriseFamily === "shell"
              ? String(finalParams.command || "").slice(0, 64)
              : undefined,
        })
      } else {
        // App tab WP3: app_whitelist / thread_trust reasons precede the
        // domain_whitelist fallback (host_app never carries a domain).
        // P5 (Pi final-review caveat 3 2026-07-24): hostComputerTrustSkip has
        // its own audit reason so silent-skip is distinguishable from god-mode
        // / whitelist in the audit log.
        const autoReason = hostComputerTrustSkip
          ? (hostComputerTrustSkipReason || "session_trust_corpus_subset")
          : securityConfig.allow_all_schemes ? "god_mode"
          : securityConfig.auto_approve_dangerous ? "global_toggle"
          : appWhitelisted ? "app_whitelist"
          : threadTrusted ? "thread_trust"
          : "domain_whitelist"
        if (hostApp) hostAppTier = autoReason
        logger.info("security.auto_approved", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          domain: relevantDomain || "unknown",
          ...(hostApp ? { app: hostApp.token, app_policy: hostApp.policy } : {}),
          reason: autoReason,
        })
      }
      // Issue a fresh token (post-approval or for auto-approved skip path).
      // Phase 1 W8 bugfix (Kimi+Pi advisor Fix C): use bindingPayloadFor via
      // issueTokenFor so issuance and validation CANNOT diverge per tool.
      const approvedToken = securityPolicy.issueTokenFor(toolName, finalParams)
      finalParams = { ...finalParams, security_token: approvedToken.token }
    } else if (toolName === "evaluate" && finalParams.security_token) {
      // P0-4 (audit H2): evaluate is forwarded to the extension — unlike osascript_eval
      // (validated companion-side in executeCompanionTool), the evaluate security_token was
      // previously never checked, so confirm/exec binding was unenforced. When a token is
      // already present (replay/stale path where the confirmation block above was skipped
      // because security_token was pre-set), validate it binds to the code being executed.
      const evalCode = String(finalParams.code || "")
      const tokenValid = securityPolicy.validateToken(
        String(finalParams.security_token), "evaluate", evalCode,
      )
      if (!tokenValid) {
        const result = { success: false, error: "Invalid or expired security token for evaluate" }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      // §6.2 token-replay audit: this branch is reached when a pre-existing
      // security_token skipped the confirmation block above (agent replayed a
      // prior approved token). The token binds to evalCode and is one-time, so a
      // stale replay is already rejected above — but if the bound code carries a
      // critical API, surface it as an audit event so critical-capability use on
      // the no-confirm path stays traceable under god-mode / auto-approve.
      const replayCritical = detectCriticalApis(evalCode)
      if (replayCritical.length > 0) {
        const replayCfg = getConfig().security
        logger.info("security.critical_capability_token_replay", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          critical_apis: replayCritical,
          god_mode_active: replayCfg.allow_all_schemes === true,
          auto_approve_active: replayCfg.auto_approve_dangerous === true,
        })
      }
    }

    // Audit item 12: navigate / create_tab trust-domain gate. Agents can otherwise
    // drive the browser to ANY URL (including chrome://, file://, data:, or attacker
    // domains) with no confirmation — a credential-phishing / internal-page-pivot
    // vector via prompt injection. Require confirmation for URLs whose host is not
    // in trusted_domains or auto_approved_domains; block non-http(s) schemes outright.
    const URL_GATE_TOOLS = ["navigate", "create_tab", "set_tab_url"]
    if (URL_GATE_TOOLS.includes(toolName)) {
      const rawUrl = String(finalParams.url || "")
      let parsedUrl: URL | null = null
      try { parsedUrl = new URL(rawUrl) } catch { /* invalid URL — handled below */ }
      if (!parsedUrl || !rawUrl) {
        const result = { success: false, error: `Invalid URL for ${toolName}: ${rawUrl}` }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      const securityConfig = getConfig().security
      // Layer 1 — scheme hard-block. skipL1 = allow_all_schemes (GOD-MODE). When
      // bypassed, emit a prominent audit log (javascript: flagged) so god-mode
      // navigations stay traceable, then fall through to the Layer 2 domain gate.
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        if (securityConfig.allow_all_schemes !== true) {
          const result = {
            success: false,
            error: `Security Block: ${toolName} to ${parsedUrl.protocol} scheme is not allowed. Only http/https URLs are permitted.`,
          }
          logger.warn("security.url_scheme_blocked", { tool_call_id: toolCallId, tool_name: toolName, scheme: parsedUrl.protocol })
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        // GOD-MODE bypass of Layer 1. javascript: is especially dangerous — it
        // runs arbitrary script in the target tab's origin — so flag it explicitly.
        logger.warn("security.godmode_bypassed", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          layer: "scheme",
          scheme: parsedUrl.protocol,
          javascript: parsedUrl.protocol === "javascript:",
          url: rawUrl,
        })
      }
      const host = parsedUrl.hostname
      // skipL2 = trusted || autoApproved || auto_approve_dangerous || allow_all_schemes.
      const skipUrlConfirmation = isTrustedDomain(host)
        || isAutoApprovedDomain(host)
        || securityConfig.auto_approve_dangerous === true
        || securityConfig.allow_all_schemes === true
      if (!skipUrlConfirmation) {
        if (ws.readyState !== WebSocket.OPEN) {
          const result = {
            success: false,
            error: `Security Block: ${toolName} to untrusted domain "${host}" requires user confirmation, but the WebSocket is not connected.`,
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        logger.warn("security.url_confirmation.requested", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          url: rawUrl,
          host,
          outbound: isOutboundMcpCall,
        })
        // S42 P1: outbound navigate must not depend on a single Side Panel focus
        // (L8). Fan-out + unbound origin for outbound; Side Panel path stays
        // origin-bound so another peer cannot cross-approve.
        const decision = await securityConfirmations.request(
          (data) => {
            const payload = JSON.stringify(data)
            if (isOutboundMcpCall) {
              for (const c of clients) {
                if (c.readyState === WebSocket.OPEN && wsAuth.get(c)?.authenticated === true) {
                  try {
                    c.send(payload)
                  } catch {
                    /* best-effort fan-out */
                  }
                }
              }
              // Always notify the executor-bound socket (extension peer / tests).
              // Fan-out alone misses peers not in `clients` (integration harness).
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(payload)
                } catch {
                  /* ignore */
                }
              }
            } else if (ws.readyState === WebSocket.OPEN) {
              ws.send(payload)
            }
          },
          {
            toolName: isOutboundMcpCall ? `[Outbound] ${toolName}` : toolName,
            dangerousApis: [],
            code: `navigate(${rawUrl})`,
            relevantDomains: [host],
          },
          isOutboundMcpCall ? {} : { originWs: ws },
        )
        if (!decision.approved) {
          const reason = decision.reason === "approved" ? "unavailable" : decision.reason
          const result = {
            success: false,
            error: `Security Block: ${toolName} to "${rawUrl}" was ${reason === "denied" ? "denied by user" : reason}.`,
          }
          logger.warn("security.url_confirmation.denied", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            url: rawUrl,
            reason,
          })
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        logger.info("security.url_confirmation.approved", { tool_call_id: toolCallId, tool_name: toolName, url: rawUrl })
      } else if (!isTrustedDomain(host)) {
        // Skipped specifically because of auto_approved_domains, the global toggle,
        // or god-mode (not because the host was already cookie-trusted). Log so
        // audits can tell the bypass paths apart.
        logger.info("security.url_auto_approved", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          host,
          reason: securityConfig.allow_all_schemes ? "god_mode"
            : securityConfig.auto_approve_dangerous ? "global_toggle" : "domain_whitelist",
        })
      }
    }

    // analyze_image_fetch is an INTERNAL phase-2 tool, dispatched only by the
    // analyze_image branch below via dispatchToExtension (which does NOT re-enter
    // this function). It is not in the LLM tool schema, so a top-level call here
    // means a malformed/hallucinated request — reject it rather than let it fall
    // through to the default forward and fetch an arbitrary URL past the gate.
    if (toolName === "analyze_image_fetch") {
      const result = {
        success: false,
        error: "Security Block: analyze_image_fetch is an internal tool and cannot be called directly.",
      }
      logger.warn("security.image_fetch_direct_call_rejected", { tool_call_id: toolCallId })
      logToolFinish(toolCallId, toolName, startedAt, result)
      return result
    }

    // M4 (§6.1) — analyze_image IMAGE_FETCH_GATE. Unlike URL_GATE_TOOLS, the
    // image URL is not known until the extension resolves the <img> element, and
    // the SSRF fetch happens inside the extension's <all_urls> service worker.
    // So this is a two-phase dispatch:
    //   phase 1 analyze_image → extension resolves the element, returns either
    //     {type:"canvas", image_base64} (same-origin; zero new exfil capability
    //     since screenshot already captures those pixels → UNGATED) or
    //     {type:"fetch_required", candidate_url} (cross-origin canvas-tainted).
    //   phase 2 analyze_image_fetch → dispatched ONLY after the gate approves;
    //     extension fetches candidate_url → image_base64 (adapter VISION_TOOLS
    //     then runs vision, same as today).
    // Neither god-mode (allow_all_schemes) nor auto_approve_dangerous bypasses
    // this gate — only trusted/auto-approved domains skip confirmation.
    if (toolName === "analyze_image") {
      const phase1 = await dispatchToExtension(toolCallId, "analyze_image", finalParams, ws)
      const p1 = phase1?.data
      // Path A (canvas → image_base64) or any error: return as-is. The adapter's
      // VISION_TOOLS post-processing runs vision when image_base64 is present.
      if (phase1?.success !== true || !p1 || p1.type !== "fetch_required") {
        logToolFinish(toolCallId, toolName, startedAt, phase1)
        return phase1
      }
      const candidateUrl = String(p1.candidate_url || "")
      let parsedCu: URL | null = null
      try { parsedCu = new URL(candidateUrl) } catch { /* invalid → blocked below */ }
      const scheme = parsedCu?.protocol || ""
      const host = parsedCu?.hostname || ""
      const isPriv = isPrivateOrLoopbackIp(host)
      const metadata = isCloudMetadataIp(host)
      const schemeOk = scheme === "http:" || scheme === "https:"
      // `data:` never reaches path B (it does not taint the canvas → path A);
      // file:/ftp:/javascript:/blob:/etc. are not http(s) → hard-block.
      if (!parsedCu || !schemeOk || metadata) {
        const reason = !parsedCu ? "invalid_url" : metadata ? "cloud_metadata_endpoint" : "blocked_scheme"
        logger.warn("security.image_fetch_blocked", {
          tool_call_id: toolCallId, tool_name: toolName,
          candidate_url: candidateUrl, scheme, host, is_private_ip: isPriv, reason,
        })
        const result = {
          success: false,
          error: `Security Block: analyze_image cannot read ${metadata ? "a cloud metadata endpoint" : `${scheme || "non-http(s)"} URL`}${candidateUrl ? ` (${candidateUrl})` : ""}.`,
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
      const trusted = isTrustedDomain(host)
      const autoApproved = isAutoApprovedDomain(host)
      if (trusted || autoApproved) {
        logger.info("security.image_fetch_auto_approved", {
          tool_call_id: toolCallId, tool_name: toolName,
          candidate_url: candidateUrl, scheme, host, is_private_ip: isPriv,
          reason: trusted ? "trusted_domain" : "auto_approved_domain",
        })
      } else {
        // Non-trusted public URL or (non-metadata) private IP → confirm.
        if (ws.readyState !== WebSocket.OPEN) {
          const result = {
            success: false,
            error: `Security Block: analyze_image needs to read an untrusted image source (${candidateUrl}) which requires confirmation, but the WebSocket is not connected.`,
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        const decision = await securityConfirmations.request(
          (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)) },
          {
            toolName: "analyze_image_fetch",
            dangerousApis: [],
            code: `analyze_image_fetch(${candidateUrl})`,
            relevantDomains: [host],
            defenseLayer: 2,
            riskLevel: "high",
          },
        )
        if (!decision.approved) {
          const reason = decision.reason === "approved" ? "unavailable" : decision.reason
          logger.info("security.image_fetch_denied", {
            tool_call_id: toolCallId, tool_name: toolName,
            candidate_url: candidateUrl, scheme, host, is_private_ip: isPriv, reason,
          })
          const result = {
            success: false,
            error: `Security Block: analyze_image read of "${candidateUrl}" was ${reason === "denied" ? "denied by user" : reason}.`,
          }
          logToolFinish(toolCallId, toolName, startedAt, result)
          return result
        }
        logger.warn("security.image_fetch_confirmed", {
          tool_call_id: toolCallId, tool_name: toolName,
          candidate_url: candidateUrl, scheme, host, is_private_ip: isPriv,
        })
      }
      // Gate passed → phase 2 fetch. Synthetic id keeps the LLM-facing
      // tool_call_id for the final result while correlating the internal fetch.
      const phase2 = await dispatchToExtension(`${toolCallId}__image_fetch`, "analyze_image_fetch", {
        tabId: finalParams.tabId,
        candidate_url: candidateUrl,
        selector: finalParams.selector,
      }, ws)
      logToolFinish(toolCallId, toolName, startedAt, phase2)
      return phase2
    }

    // Companion-side tools (executed locally, not forwarded to extension)
    const COMPANION_TOOLS = [
      "osascript_eval",
      "host_read",
      "host_write",
      "host_app",
      "host_computer",
      "use_skill",
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
export function handleToolResult(msg: any) {
  const { tool_call_id, result, error } = msg
  const pending = pendingToolCalls.get(tool_call_id)
  if (pending) {
    clearTimeout(pending.timer)
    pendingToolCalls.delete(tool_call_id)
    if (error) {
      pending.resolve({ success: false, error: error.message || String(error) })
    } else {
      pending.resolve(result)
    }
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
    pendingToolCalls.set(toolCallId, { resolve: finish as any, reject: finish as any, timer })
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
export function applyConnectionCloseGracePeriod(): void {
  for (const [id, pending] of pendingToolCalls) {
    clearTimeout(pending.timer)
    logger.warn("tool.connection_closed", { tool_call_id: id })
    pending.timer = setTimeout(() => {
      if (pendingToolCalls.has(id)) {
        pendingToolCalls.delete(id)
        pending.resolve({ success: false, error: "WebSocket disconnected" })
      }
    }, WS_DISCONNECT_GRACE_MS)
  }
}

// --- Companion-side tool executor (runs locally, not forwarded to extension) ---

/**
 * Optional execution context for companion tools. Phase 1 W8-windows uses
 * this for the manual-nonce fallback routing (adversary amendment A3):
 *   - Normal path: the L2 dialog carried the nonce challenge; its validated
 *     value arrives as prevalidatedNonce and the executor skips re-prompting.
 *   - skip-L2 path (god-mode / auto-approve): the standalone executor prompt
 *     via sendConfirmation is the sole remaining user gate and IS required.
 */
interface CompanionToolExecOptions {
  /** ws-bound + originWs-bound confirmation request channel (amendment A1). */
  sendConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  /** Nonce challenge already validated inside the L2 dialog. */
  prevalidatedNonce?: string
  /** App tab WP3: tier the L2 gate assigned to a host_app call (apps.launch audit). */
  appLaunchTier?: string
  /** WP2 (§E.4): broadcast channel for computer-task progress events. */
  broadcast?: (data: any) => void
  /**
   * #au4dch B2: unicast to the origin tool-executor socket only (same as tool.start).
   * Must NOT use broadcast for shell stdout/stderr tails (secrets on multi-client).
   */
  sendOrigin?: (data: any) => void
  /**
   * UX-spike 2026-07-23: the WS session id for computer-use per-session re-L2
   * trust. Forwarded from the createToolExecutor closure (where sessionId
   * lives) into runComputerTask deps; absent = every re-L2 asks.
   */
  computerSessionId?: string
}

async function executeCompanionTool(toolName: string, params: any, toolCallId?: string, execOpts?: CompanionToolExecOptions): Promise<any> {
  switch (toolName) {
    case "spawn_worker": {
      const parentId = params.__thread_id || params._thread_id || params.parent_thread_id
      if (!parentId) return { success: false, error: "spawn_worker requires parent thread (__thread_id)" }
      // Real HITL: L2 forceConfirm issues security_token. LLM user_confirmed is NOT trusted.
      if (!params.security_token) {
        return {
          success: false,
          error:
            "spawn_worker requires interactive L2 confirmation (security_token). Do not set user_confirmed yourself — the Confirm Center must approve spawn (ADR-015).",
        }
      }
      const tokenOk = securityPolicy.validateTokenFor(String(params.security_token), "spawn_worker", params)
      if (!tokenOk) {
        return { success: false, error: "Invalid or expired security token for spawn_worker" }
      }
      const { spawnWorkerThread } = await import("./orchestrator/spawn")
      const intentId =
        typeof params.intent_id === "string" && params.intent_id.trim()
          ? params.intent_id.trim()
          : null
      const r = spawnWorkerThread(threadManager, {
        parentThreadId: String(parentId),
        roleLabel: params.role_label || params.roleLabel,
        alias: params.alias,
        roleAllow: Array.isArray(params.tool_allow) ? params.tool_allow : null,
        roleDeny: Array.isArray(params.tool_deny) ? params.tool_deny : undefined,
        packId: params.pack_id || null,
        userConfirmed: true, // L2 approval above is the sole user-confirm authority
        intentId,
      })
      if (!r.ok) return { success: false, error: r.error }
      // Optional pack.apply after spawn (role template — never elevates capability_profile / modules)
      let packApply: { ok: boolean; error?: string } | null = null
      if (params.pack_id && typeof params.pack_id === "string") {
        try {
          const { applyPack } = await import("./packs/pack-engine")
          if (!skillEngine) {
            packApply = { ok: false, error: "skillEngine not initialized; worker created with mission_pack_id only" }
          } else {
            const ar = applyPack(String(params.pack_id), r.worker.id, threadManager, skillEngine)
            packApply = ar.ok ? { ok: true } : { ok: false, error: ar.error }
          }
        } catch (e: any) {
          packApply = { ok: false, error: e?.message || String(e) }
        }
      }
      // ADR-016 Stage 3: claim intent on host board after worker exists
      let intentClaim: { ok: boolean; error?: string; intent_id?: string } | null = null
      if (intentId) {
        try {
          const { claimIntent } = await import("./board/intent-claim")
          const cr = await claimIntent(threadManager, {
            hostThreadId: String(parentId),
            intentId,
            workerThreadId: r.worker.id,
          })
          if (!cr.ok) {
            intentClaim = { ok: false, error: cr.error, intent_id: intentId }
          } else {
            intentClaim = { ok: true, intent_id: intentId }
          }
        } catch (e: any) {
          intentClaim = { ok: false, error: e?.message || String(e), intent_id: intentId }
        }
      }
      const workerAfter = threadManager.get(r.worker.id)
      return {
        success: true,
        data: {
          worker_id: r.worker.id,
          orchestrator_run_id: r.orchestrator_run_id,
          tool_whitelist: workerAfter?.tool_whitelist ?? r.worker.tool_whitelist,
          agent_role: r.worker.agent_role,
          mission_pack_id: workerAfter?.mission_pack_id ?? params.pack_id ?? null,
          pack_apply: packApply,
          assigned_intent_id: intentId,
          intent_claim: intentClaim,
        },
      }
    }
    case "ask_user": {
      // Binary HITL via L2 Confirm Center (approve = yes, deny = no). Free-text answers are P2.
      if (!params.security_token) {
        return {
          success: false,
          error: "ask_user requires interactive L2 confirmation (security_token). Present the question; user approves or denies in Confirm Center.",
        }
      }
      const q = String(params.question || params.prompt || "")
      if (!q.trim()) return { success: false, error: "ask_user requires non-empty question" }
      const askOk = securityPolicy.validateTokenFor(String(params.security_token), "ask_user", params)
      if (!askOk) {
        return { success: false, error: "Invalid or expired security token for ask_user" }
      }
      return {
        success: true,
        data: {
          question: q,
          answer: "approved",
          note: "User approved in Confirm Center (binary HITL). Free-text ask_user is P2.",
        },
      }
    }
    case "list_workers": {
      const parentId = params.__thread_id || params._thread_id
      const parent = parentId ? threadManager.get(String(parentId)) : null
      const runId = params.orchestrator_run_id || (parent as any)?.orchestrator_run_id
      if (!runId) return { success: false, error: "orchestrator_run_id required (spawn workers first)" }
      const { listWorkers } = await import("./orchestrator/spawn")
      const workers = listWorkers(threadManager, String(runId)).map((w: any) => ({
        id: w.id,
        alias: w.alias,
        worker_role_label: w.worker_role_label,
        paused: !!w.paused,
        tool_whitelist: w.tool_whitelist,
      }))
      return { success: true, data: { orchestrator_run_id: runId, workers } }
    }
    case "get_worker_status": {
      const wid = params.worker_id || params.thread_id
      if (!wid) return { success: false, error: "worker_id required" }
      const w = threadManager.get(String(wid)) as any
      if (!w) return { success: false, error: `worker not found: ${wid}` }
      const { listTabLocks } = await import("./orchestrator/tab-lease")
      const locks = listTabLocks().filter((l) => l.holder_thread_id === w.id)
      return {
        success: true,
        data: {
          id: w.id,
          alias: w.alias,
          agent_role: w.agent_role,
          parent_thread_id: w.parent_thread_id,
          orchestrator_run_id: w.orchestrator_run_id,
          paused: !!w.paused,
          tab_locks: locks,
        },
      }
    }
    case "list_tab_locks": {
      const { listTabLocks } = await import("./orchestrator/tab-lease")
      return { success: true, data: { locks: listTabLocks() } }
    }
    case "collect_handback": {
      // ADR-016 Task 3: board mode / mission_board → structured Fact/Intent merge;
      // free-form-only rejected with recoverable HANDBACK_MISSING_STRUCTURE.
      // G3: wire resolveToolCall from worker/host recorded tool results (fail-closed).
      const wid = params.worker_id
      if (!wid) return { success: false, error: "worker_id required" }
      const callerId = params.__thread_id || params._thread_id || null
      const {
        collectWorkerHandback,
        resolveToolCallFromThreadMessages,
        resolveBoardHostThreadId,
      } = await import("./board")
      const workerId = String(wid)
      const hostId =
        resolveBoardHostThreadId(threadManager, workerId) ||
        (callerId ? resolveBoardHostThreadId(threadManager, String(callerId)) : null)
      const resolveToolCall = resolveToolCallFromThreadMessages(
        threadManager,
        workerId,
        hostId,
      )
      return collectWorkerHandback(threadManager, {
        workerId,
        callerThreadId: callerId ? String(callerId) : null,
        forceStructured: params.expect_structured === true,
        resolveToolCall,
      })
    }
    case "board_read": {
      // ADR-016 optional read: orchestrator allowlist; workers only if Pack grants
      // G4: returns framed model projection + export_summary trust labels
      const tid = params.__thread_id || params._thread_id
      if (!tid) return { success: false, error: "board_read requires thread context (__thread_id)" }
      const { boardReadForTool } = await import("./board")
      return boardReadForTool(threadManager, String(tid))
    }
    case "board_claim_intent": {
      const parentId = params.__thread_id || params._thread_id
      if (!parentId) return { success: false, error: "board_claim_intent requires host thread" }
      const intentId = String(params.intent_id || "")
      const workerId = String(params.worker_id || "")
      if (!intentId || !workerId) {
        return { success: false, error: "intent_id and worker_id required" }
      }
      const { claimIntent } = await import("./board/intent-claim")
      const r = await claimIntent(threadManager, {
        hostThreadId: String(parentId),
        intentId,
        workerThreadId: workerId,
      })
      if (!r.ok) return { success: false, error: r.error, data: { error_code: r.error_code } }
      threadManager.update(workerId, { assigned_intent_id: intentId } as any)
      return { success: true, data: { intent: r.intent } }
    }
    case "board_heartbeat_intent": {
      const workerId = params.__thread_id || params._thread_id
      if (!workerId) return { success: false, error: "thread required" }
      const intentId = String(params.intent_id || "")
      if (!intentId) return { success: false, error: "intent_id required" }
      const { resolveBoardHostThreadId } = await import("./board")
      const hostId = resolveBoardHostThreadId(threadManager, String(workerId))
      if (!hostId) return { success: false, error: "board host not found" }
      const { heartbeatIntent } = await import("./board/intent-claim")
      const r = await heartbeatIntent(threadManager, {
        hostThreadId: hostId,
        intentId,
        workerThreadId: String(workerId),
      })
      if (!r.ok) return { success: false, error: r.error, data: { error_code: r.error_code } }
      return { success: true, data: { intent: r.intent } }
    }
    case "board_complete": {
      // ADR-016 G5/G6/G9: L2 + hard canComplete; no LLM self-approve
      const tid = params.__thread_id || params._thread_id
      if (!tid) return { success: false, error: "board_complete requires thread context (__thread_id)" }
      const caller = threadManager.get(String(tid)) as any
      if (!caller) return { success: false, error: `thread not found: ${tid}` }
      if (caller.agent_role === "worker") {
        return {
          success: false,
          error: "workers cannot call board_complete",
          error_code: "BOARD_COMPLETE_FORBIDDEN",
        }
      }
      // Strip LLM user_confirmed / forged trust elevation
      if (params.user_confirmed === true) {
        return {
          success: false,
          error:
            "board_complete rejects LLM user_confirmed self-approve; Confirm Center must approve (ADR-016 G5)",
          error_code: "BOARD_COMPLETE_SELF_APPROVE",
        }
      }
      if (!params.security_token) {
        return {
          success: false,
          error:
            "board_complete requires interactive L2 confirmation (security_token). Do not set user_confirmed yourself — the Confirm Center must approve complete (ADR-016).",
          error_code: "BOARD_COMPLETE_L2_REQUIRED",
        }
      }
      const tokenOk = securityPolicy.validateTokenFor(
        String(params.security_token),
        "board_complete",
        params,
      )
      if (!tokenOk) {
        return { success: false, error: "Invalid or expired security token for board_complete" }
      }
      const {
        completeBoard,
        canComplete,
        readBoard,
        buildBoardCompleteDigest,
        resolveBoardHostThreadId,
      } = await import("./board")
      const hostId = resolveBoardHostThreadId(threadManager, String(tid)) || String(tid)
      const board = readBoard(threadManager, hostId)
      const completeParams = {
        supporting_fact_ids: Array.isArray(params.supporting_fact_ids)
          ? params.supporting_fact_ids.map(String)
          : [],
        residual_risks: Array.isArray(params.residual_risks)
          ? params.residual_risks.map(String)
          : [],
        goal_summary: params.goal_summary != null ? String(params.goal_summary) : null,
        empty_complete: params.empty_complete === true,
        empty_complete_reason:
          params.empty_complete_reason != null ? String(params.empty_complete_reason) : null,
      }
      // Pre-check for digest even on reject
      if (board) {
        const pre = canComplete(board, completeParams)
        if (!pre.ok) {
          return {
            success: false,
            error: pre.error,
            error_code: pre.error_code,
            data: { digest: buildBoardCompleteDigest(board, completeParams) },
          }
        }
      }
      const result = await completeBoard(
        threadManager,
        hostId,
        completeParams,
        {
          actor_type: "orchestrator",
          thread_id: String(tid),
          orchestrator_run_id: caller.orchestrator_run_id ?? null,
          tool_name: "board_complete",
        },
      )
      if (!result.ok) {
        return {
          success: false,
          error: result.error,
          error_code: result.error_code,
          recoverable: result.recoverable,
          data: { digest: (result as any).digest },
        }
      }
      return {
        success: true,
        data: {
          status: result.board.status,
          completed_at: result.board.completed_at,
          digest: (result as any).digest || (board ? buildBoardCompleteDigest(result.board, completeParams) : null),
          board: {
            fact_count: result.board.facts.length,
            intent_count: result.board.intents.length,
            goal: result.board.goal,
            status: result.board.status,
          },
        },
      }
    }
    case "wait_workers": {
      // Frozen as poll-only (ADR-015): no async barrier / sleep in tool path.
      const parentId = params.__thread_id || params._thread_id
      const parent = parentId ? threadManager.get(String(parentId)) : null
      const runId = params.orchestrator_run_id || (parent as any)?.orchestrator_run_id
      if (!runId) return { success: false, error: "orchestrator_run_id required" }
      // ADR-016 Stage 3: reap stale claimed intents on host board
      let intentsReaped = 0
      let openIntents = 0
      if (parentId) {
        try {
          const { reapStaleIntents, countOpenIntents } = await import("./board/intent-claim")
          const rr = await reapStaleIntents(threadManager, String(parentId))
          intentsReaped = rr.reaped
          openIntents = countOpenIntents(threadManager, String(parentId))
        } catch {
          /* ignore */
        }
      }
      const { listWorkers } = await import("./orchestrator/spawn")
      const { multiAgentLlmLoopSnapshot } = await import("./orchestrator/llm-loop-gate")
      const workers = listWorkers(threadManager, String(runId))
      const llm = multiAgentLlmLoopSnapshot()
      return {
        success: true,
        data: {
          poll_only: true,
          note: "wait_workers is poll-only (no barrier). Re-call or use HITL; check llm_loops for concurrent worker LLM activity.",
          llm_loops: llm,
          intents_reaped: intentsReaped,
          open_intent_count: openIntents,
          workers: workers.map((w: any) => ({
            id: w.id,
            alias: w.alias,
            paused: !!w.paused,
            llm_active: llm.holders.includes(w.id),
            assigned_intent_id: w.assigned_intent_id || null,
          })),
        },
      }
    }
    case "worker_cancel": {
      const wid = params.worker_id
      if (!wid) return { success: false, error: "worker_id required" }
      const w = threadManager.get(String(wid)) as any
      if (!w) return { success: false, error: `worker not found: ${wid}` }
      // G13: abandon worker intents on host BEFORE pending reject + lease release
      let intentsAbandoned = 0
      try {
        const { abandonWorkerIntents } = await import("./board")
        const ab = await abandonWorkerIntents(threadManager, String(wid), {
          reason: "worker_cancel",
        })
        intentsAbandoned = ab.abandoned
      } catch {
        /* best-effort board abandon */
      }
      // GATE2: deny worker-stamped L2 first (mirror stop_thread / fleet.stop_all)
      const confirmsRejected = securityConfirmations.rejectForWorker(String(wid), "denied")
      const rejected = rejectPendingForThread(String(wid), `worker_cancel:${wid}`)
      const { releaseLeasesForThreadPendingAware } = await import("./orchestrator/tab-lease")
      const { released, drained } = releaseLeasesForThreadPendingAware(
        String(wid),
        "worker_cancel",
        { hasPendingForTab, rejectPendingForTab },
      )
      // Best-effort: message-router abortControllers if registered
      try {
        const { abortThreadChat } = await import("./message-router")
        if (typeof abortThreadChat === "function") abortThreadChat(String(wid))
      } catch {
        /* optional */
      }
      return {
        success: true,
        data: {
          worker_id: wid,
          intents_abandoned: intentsAbandoned,
          rejected_pending: rejected,
          leases_released: released,
          confirms_rejected: confirmsRejected,
          leases_drained: drained,
        },
      }
    }
    case "workspace_list_dir": {
      const { workspaceListDir } = await import("./capability/workspace")
      const tid = params.__thread_id || params._thread_id
      const thread = tid ? threadManager.get(tid) : null
      return workspaceListDir(thread?.workspace_root, params.path || ".")
    }
    case "workspace_read_file": {
      const { workspaceReadFile } = await import("./capability/workspace")
      const tid = params.__thread_id || params._thread_id
      const thread = tid ? threadManager.get(tid) : null
      if (!params.path) return { success: false, error: "path required" }
      return workspaceReadFile(thread?.workspace_root, params.path)
    }
    case "ensure_project_dir": {
      const { ensureProjectDir } = await import("./capability/project-dir")
      const tid = params.__thread_id || params._thread_id
      const thread = tid ? threadManager.get(tid) : null
      const name = typeof params.name === "string" ? params.name : ""
      if (!name.trim()) return { success: false, error: "name required" }
      const prefer =
        params.prefer === "workspace" || params.prefer === "home" || params.prefer === "auto"
          ? params.prefer
          : "auto"
      const r = ensureProjectDir({
        name,
        workspaceRoot: (thread as any)?.workspace_root ?? null,
        prefer,
      })
      if (!r.ok) {
        return {
          success: false,
          error: r.error,
          data: { error_code: "PROJECT_DIR_FAILED", suggested_action: "pick_workspace_or_retry" },
        }
      }
      return {
        success: true,
        data: {
          path: r.path,
          created: r.created,
          source: r.source,
          base: r.base,
          relative: r.relative,
          hint:
            "Write files under this path with MCP filesystem (create_directory for subfolders if needed). " +
            "If MCP reports Access denied, the user can approve adding this directory to allowlist.",
        },
      }
    }
    case "skill_install": {
      // Composition: install into user skills root only (not repo / ~/.claude).
      // S41 multi-adv: L2 forceConfirm — require security_token (bindingPayloadFor skill_install).
      // Thread id defaults to "default" to match issueTokenFor at the L2 gate.
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          params.security_token,
          "skill_install",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for skill_install" }
        }
      } else {
        return { success: false, error: "skill_install requires L2 security_token confirmation" }
      }
      const { skillInstall } = await import("./skills/skill-install")
      const r = skillInstall(skillEngine, {
        path: params.path,
        zip_path: params.zip_path,
        content: params.content,
      })
      if (!r.ok) {
        return { success: false, error: r.error, data: { skills_root: r.skills_root } }
      }
      return {
        success: true,
        data: {
          name: r.name,
          dest_path: r.dest_path,
          skills_root: r.skills_root,
          hint_zh: r.hint_zh,
        },
      }
    }
    case "shell_exec": {
      if (params.security_token) {
        const valid = securityPolicy.validateToken(params.security_token, "shell_exec", params.command || "")
        if (!valid) return { success: false, error: "Invalid or expired security token for shell_exec" }
      } else {
        return { success: false, error: "shell_exec requires L2 security_token confirmation" }
      }
      const tid = params.__thread_id || params._thread_id
      const flightOwner = String(tid || "unknown")
      const { tryAcquireFlight, releaseFlight } = await import("./orchestrator/single-flight")
      // Re-entrant OK when L2 path already reserved for this owner
      const flight = tryAcquireFlight("shell_exec", flightOwner)
      if (!flight.ok) return { success: false, error: flight.error, data: { error_code: "SHELL_BUSY", holder: flight.holder } }
      try {
        const { shellExec } = await import("./capability/shell")
        const thread = tid ? threadManager.get(tid) : null
        const cwd = params.cwd || thread?.workspace_root || undefined
        return await shellExec({
          command: params.command,
          cwd,
          threadId: tid,
          onProgress: (p) => {
            // #au4dch ST-2 / SH-A2 / B2: live tails unicast to origin only
            // (never broadcast — tails may contain secrets). Old clients ignore type.
            if (!toolCallId) return
            try {
              execOpts?.sendOrigin?.({
                type: "tool.progress",
                thread_id: tid || null,
                tool_call_id: toolCallId,
                tool_name: "shell_exec",
                elapsed_ms: p.elapsed_ms,
                stdout_tail: p.stdout_tail,
                stderr_tail: p.stderr_tail,
              })
            } catch {
              /* best-effort */
            }
          },
        })
      } finally {
        releaseFlight("shell_exec", flightOwner)
      }
    }
    case "netsec_port_scan": {
      if (params.security_token) {
        const valid = securityPolicy.validateToken(
          params.security_token,
          "netsec_port_scan",
          JSON.stringify(params.targets || []),
        )
        if (!valid) return { success: false, error: "Invalid or expired security token for netsec_port_scan" }
      } else {
        return { success: false, error: "netsec_port_scan requires L2 security_token confirmation" }
      }
      const tid = params.__thread_id || params._thread_id
      const flightOwner = String(tid || "unknown")
      const { tryAcquireFlight, releaseFlight } = await import("./orchestrator/single-flight")
      const flight = tryAcquireFlight("netsec_port_scan", flightOwner)
      if (!flight.ok) {
        return { success: false, error: flight.error, data: { error_code: "NETSEC_BUSY", holder: flight.holder } }
      }
      try {
        const { netsecPortScan } = await import("./netsec/scan")
        const thread = tid ? threadManager.get(tid) : null
        return await netsecPortScan({
          targets: params.targets || [],
          ports: params.ports,
          taskAuth: (thread as any)?.netsec_task_auth || null,
          threadId: tid,
        })
      } finally {
        releaseFlight("netsec_port_scan", flightOwner)
      }
    }
    case "use_skill": {
      const skillName = params.name
      if (!skillName) {
        return { success: false, error: "skill name required" }
      }
      const content = skillEngine.loadContent(skillName)
      if (!content) {
        return { success: false, error: `Skill not found or has no content: ${skillName}` }
      }
      return { success: true, data: { name: skillName, content } }
    }
    case "record_experience": {
      const { target, skill_name, category, content, tags, domain } = params
      const skillName = target === "site"
        ? (domain || skill_name || "unknown-site").replace(/\./g, "-")
        : (skill_name || `exp-${Date.now()}`)
      const entry = {
        id: `exp-${Date.now()}`,
        category: category || "tip",
        content: String(content),
        recorded_at: new Date().toISOString(),
        confirmed_at: null,
        stale: false,
        stale_reason: "",
        replaced_by: "",
      }
      try {
        skillEngine.createExperienceSkill(
          skillName,
          target === "site" ? "site_knowledge" : "domain_knowledge",
          target === "site" ? (domain || "") : undefined,
          tags,
          entry,
        )
        return {
          success: true,
          data: { skill_name: skillName, entry_id: entry.id, message: `Experience recorded to ${skillName}` },
        }
      } catch (err: any) {
        return { success: false, error: `Failed to record experience: ${err.message}` }
      }
    }
    case "osascript_eval": {
      // Normalize evaluate-style aliases + resolve missing url from tabId / tabUrlCache.
      // LLMs routinely call osascript_eval with only {expression} (see history t9rh1o).
      // Adapter injects pinned tabId; we map that (or any recent cached tab) to a URL
      // fragment so the AppleScript tab-matcher can find the tab.
      let pageUrl = typeof params.url === "string" ? params.url.trim() : ""
      let jsExpr =
        (typeof params.expression === "string" && params.expression) ||
        (typeof params.code === "string" && params.code) ||
        ""
      if (!pageUrl && typeof params.tabId === "number") {
        pageUrl = getCachedTabUrl(params.tabId) || ""
        if (pageUrl) {
          logger.info("osascript_eval.url_resolved_from_tabId", {
            tab_id: params.tabId,
            url_prefix: pageUrl.slice(0, 80),
          })
        }
      }
      if (!pageUrl && tabUrlCache.size > 0) {
        // Last-resort: most recently cached tab (Map insertion order). Prefer https tabs.
        let fallback = ""
        for (const u of tabUrlCache.values()) {
          if (typeof u === "string" && u.startsWith("http")) fallback = u
        }
        if (fallback) {
          pageUrl = fallback
          logger.info("osascript_eval.url_resolved_from_cache_fallback", {
            url_prefix: pageUrl.slice(0, 80),
            cache_size: tabUrlCache.size,
          })
        }
      }
      if (!jsExpr) {
        return {
          success: false,
          error:
            "osascript_eval requires expression (JS to run in the Chrome tab). " +
            "Optional: url fragment (e.g. 'example.com') or tabId from list_tabs.",
        }
      }
      if (!pageUrl) {
        return {
          success: false,
          error:
            "osascript_eval: no url and no tab URL in cache. " +
            "Call list_tabs first, then pass url (fragment matching the tab) or tabId. " +
            "Example: {url: 'example.com', expression: 'document.title'}",
        }
      }
      // Validate security token instead of boolean flag
      if (params.security_token) {
        const valid = securityPolicy.validateToken(params.security_token, "osascript_eval", jsExpr)
        if (!valid) {
          return { success: false, error: "Invalid or expired security token" }
        }
      } else {
        const safety = checkHighRiskExecution("osascript_eval", jsExpr)
        if (safety.blocked) {
          return {
            success: false,
            error: safety.error,
            data: { dangerous_apis_found: safety.dangerousApis },
          }
        }
      }
      const lengthCheck = securityPolicy.checkLength("osascript_eval", jsExpr)
      if (!lengthCheck.ok) {
        return { success: false, error: lengthCheck.error }
      }
      if (!shouldL2GateOsascript(os.platform())) {
        return { success: false, error: OSASCRIPT_MACOS_ONLY_ERROR }
      }
      // Use execFile with absolute OSASCRIPT_BIN + -e argv (P0 injection + PATH harden).
      // Bare "osascript" fails with spawn ENOTDIR when process PATH contains a *file*
      // (seen in packaged .app: PATH=/…/cmspark-agent.js). Absolute path bypasses PATH.
      // CAPABILITY INVARIANT (§6.2): this template ONLY runs `execute t javascript
      // jsExpr` — it executes the supplied JS inside a Chrome tab, NOT arbitrary
      // host AppleScript. NEVER introduce `do shell script` / `tell application
      // "Finder"` / keychain access here: doing so would widen the capability
      // boundary that §6.2's CRITICAL_API_GATE and the L2 confirmation gate assume.
      // `pageUrl` and `jsExpr` are passed as argv (after `--`), never interpolated.
      const { promisify } = await import("util")
      const execFileAsync = promisify(execFile)
      try {
        const result = await execFileAsync(OSASCRIPT_BIN, [
          "-e", "on run argv",
          "-e", "  set pageUrl to item 1 of argv",
          "-e", "  set jsExpr to item 2 of argv",
          "-e", "  tell application \"Google Chrome\"",
          "-e", "    set foundTab to false",
          "-e", "    set resultText to \"\"",
          "-e", "    repeat with w in windows",
          "-e", "      repeat with t in tabs of w",
          "-e", "        if URL of t contains pageUrl then",
          "-e", "          set resultText to execute t javascript jsExpr",
          "-e", "          set foundTab to true",
          "-e", "          exit repeat",
          "-e", "        end if",
          "-e", "      end repeat",
          "-e", "      if foundTab then exit repeat",
          "-e", "    end repeat",
          "-e", "    if not foundTab then return \"TAB_NOT_FOUND\"",
          "-e", "    return resultText",
          "-e", "  end tell",
          "-e", "end run",
          "--", pageUrl, jsExpr,
        ], {
          encoding: "utf-8" as const,
          timeout: 10000,
        } as any)
        const output = String(result.stdout).trim()
        if (output === "TAB_NOT_FOUND") {
          return { success: false, error: `Tab matching URL not found in Chrome` }
        }
        return { success: true, data: { result: output } }
      } catch (err: any) {
        return { success: false, error: `osascript_eval error: ${err.message || String(err)}` }
      }
    }
    case "host_read": {
      // Phase 0 computer-use spike — see docs/decisions/computer-use-round2-synthesis.md.
      // Delegates to companion/src/host-use/ which dispatches on process.platform.
      // Darwin spawns dist/cmspark-host (ad-hoc signed Swift binary); Linux/Win
      // stubs throw NotImplementedOnPlatform — caught below and surfaced as
      // {success:false}. Single source of truth for platform check lives in
      // host-use/index.ts (Standards review M2: drop duplicate guard here).
      //
      // Kimi Round 2 Critical: validate security_token like osascript_eval does.
      // Without this, any non-empty security_token string in params bypasses
      // the L2 gate at server.ts:303 and host_read executes without confirmation.
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          String(params.security_token),
          "host_read",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for host_read" }
        }
      }
      try {
        const { hostRead } = await import("./host-use")
        const application = typeof params.application === "string" ? params.application : undefined
        const maxChars = typeof params.max_chars === "number" ? params.max_chars : undefined
        const result = await hostRead({ application, maxChars })
        // Grill G5/Q6: Mail read verified when required structured fields non-empty.
        const { evaluateMailReadVerify } = await import("./host-use/darwin/notes-verify")
        const v = evaluateMailReadVerify(result)
        return {
          success: true,
          data: {
            ...result,
            posted: true,
            verified: v.verified,
            ...(v.reason ? { verify_note: v.reason } : {}),
            // Golden-path friendly summary for LLM (do not invent content).
            summary: v.verified
              ? `From: ${result.sender} | Subject: ${result.subject} | Date: ${result.date_received}`
              : undefined,
          },
        }
      } catch (err: any) {
        return { success: false, error: `host_read error: ${err.message || String(err)}` }
      }
    }
    case "host_write": {
      // Phase 1 W8 (Kimi+Pi advisor Option A): ALL writes go through biometric
      // tier per Round 2 §4.2. W6 ask-once behavior replaced.
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          String(params.security_token),
          "host_write",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for host_write" }
        }
      }
      const hostPlatform = os.platform()
      if (hostPlatform !== "darwin" && hostPlatform !== "linux" && hostPlatform !== "win32") {
        return {
          success: false,
          error: `host_write is macOS/Linux/Windows-only in Phase 1 (platform=${hostPlatform})`,
        }
      }
      try {
        const isWin = hostPlatform === "win32"
        // Phase 1 W8-windows: win32 dispatches to the COM/fs-based WinHostAdapter.
        const adapter = isWin
          ? (await import("./host-use/win/adapter")).getWinAdapter()
          : (await import("./host-use/darwin/adapter")).getDarwinAdapter()
        const kind = String(params.kind) as "create" | "move" | "update" | "delete"

        // Phase 1 W8/W9: biometric verification BEFORE writeOne.
        // - darwin (W8): Touch ID via Swift binary subprocess
        // - win32  (W8): Windows Hello UserConsentVerifier (OS-hosted dialog,
        //   unsigned-safe); hardware absent → manual-nonce downgrade
        // - linux  (W9): 6-char manual nonce typed by user (paste-blocked)
        const reasonMap: Record<string, string> = {
          create: isWin ? "Create a new OneNote page" : "Create a new Note",
          move: "Move a file",
          update: "Update an existing item",
          delete: "Delete an item (destructive)",
        }
        const biometricReason = reasonMap[kind] || `host_write ${kind}`

        let nonce: string
        let method: "touchid" | "windows-hello" | "manual-nonce"
        if (hostPlatform === "darwin") {
          const { biometricVerify } = await import("./host-use/darwin")
          nonce = await biometricVerify(toolCallId || "no-tool-call-id", biometricReason)
          method = "touchid"
        } else if (isWin) {
          const { tryWindowsHello } = await import("./host-use/win")
          const hello = await tryWindowsHello(toolCallId || "no-tool-call-id", biometricReason)
          if ("ok" in hello) {
            nonce = hello.nonce
            method = "windows-hello"
          } else if ("cancelled" in hello) {
            // Adversary H1: cancel → denied, NEVER downgrade on cancel.
            throw new Error("host_write denied: Windows Hello verification cancelled by user")
          } else {
            // Hello unavailable → manual-nonce downgrade (Round 2 §2.3 tier,
            // triggered by real hardware state — not process-forgeable).
            if (execOpts?.prevalidatedNonce) {
              // Normal path (amendment A3): the challenge rode inside the L2
              // dialog and was already validated there — no second prompt.
              nonce = execOpts.prevalidatedNonce
              method = "manual-nonce"
            } else {
              // skip-L2 path (god-mode / auto-approve): the standalone
              // executor prompt is the sole remaining user gate — REQUIRED.
              if (!execOpts?.sendConfirmation) {
                throw new Error(
                  "host_write: manual-nonce fallback unavailable (no confirmation channel)",
                )
              }
              const { generateManualNonce } = await import("./host-use/nonce")
              const challenge = generateManualNonce()
              // Adversary amendment 7a: dedicated downgrade audit event.
              logger.info("security.biometric.downgrade", {
                tool_call_id: toolCallId,
                reason: "windows_hello_unavailable",
              })
              const decision = await execOpts.sendConfirmation({
                toolName: "host_write",
                dangerousApis: [],
                code: `host_write ${kind} — Windows Hello unavailable; type the 6-char code to approve`,
                nonceChallenge: challenge,
              })
              if (!decision.approved) {
                throw new Error(`host_write denied: manual-nonce confirmation ${decision.reason}`)
              }
              nonce = challenge
              method = "manual-nonce"
            }
          }
        } else {
          // Phase 1 W9 Linux path: not yet wired through SecurityConfirmationManager
          // (Linux companion itself is RUNBOOK-only in Phase 1 ship). The nonce
          // generator + WS protocol are in place; integration pending Phase 2.
          const { generateLinuxNonce } = await import("./host-use/darwin")
          nonce = generateLinuxNonce()
          method = "manual-nonce"
          // TODO Phase 2: send security.confirmation.request with nonceChallenge,
          // wait for response with nonceResponse, validate match, reject after 3 fails.
          // For now Linux returns the generated nonce but no writeOne execution
          // (Phase 1 writeOne adapters exist for darwin + win32 only).
          return {
            success: false,
            error: `host_write on Linux: biometric nonce generated (${nonce}) but Linux has no writeOne adapter in Phase 1 (darwin + win32 only). Linux implementation pending Phase 2.`,
          }
        }
        logger.info("security.biometric.verified", {
          tool_call_id: toolCallId,
          tool_name: "host_write",
          kind,
          nonce,
          method,
        })

        let payload: any
        if (kind === "create") {
          if (typeof params.body !== "string") {
            return { success: false, error: "host_write create: body required" }
          }
          payload = { kind: "create", body: params.body }
        } else if (kind === "move") {
          if (typeof params.destination !== "string" || typeof params.source_path !== "string") {
            return {
              success: false,
              error: "host_write move: source_path + destination required",
            }
          }
          payload = {
            kind: "move",
            destination: params.destination,
            source_path: params.source_path,
          }
        } else if (kind === "update") {
          if (typeof params.body !== "string") {
            return { success: false, error: "host_write update: body required" }
          }
          payload = { kind: "update", body: params.body }
        } else if (kind === "delete") {
          payload = { kind: "delete" }
        } else {
          return { success: false, error: `host_write: unknown kind "${kind}"` }
        }
        // TargetId for Phase 1 W6/W8:
        //   darwin create/update/delete (Notes): "macos:com.apple.Notes:default:note-default"
        //   darwin move (Finder):                "macos:com.apple.finder:default:file-source"
        //   win32  create/update/delete (OneNote): "win:onenote:default:note-default"
        //   win32  move (fs):                      "win:fs:default:file-source"
        const syntheticTarget = isWin
          ? (kind === "move"
              ? "win:fs:default:file-source"
              : "win:onenote:default:note-default")
          : (kind === "move"
              ? "macos:com.apple.finder:default:file-source"
              : "macos:com.apple.Notes:default:note-default")
        const target = adapter.validateTargetId(syntheticTarget)
        const result = await adapter.writeOne(target, payload)
        // Grill G4: Notes create — posted after writeOne; verified via list-notes
        // re-read (S-semantic success contract).
        let verified = false
        let verifyNote: string | undefined
        if (!isWin && kind === "create" && typeof params.body === "string") {
          try {
            const { evaluateNotesCreateVerify } = await import("./host-use/darwin/notes-verify")
            let listedIds: string[] = []
            if (typeof (adapter as any).listReadTargets === "function") {
              try {
                const listed = await (adapter as any).listReadTargets("note", { limit: 100 })
                listedIds = Array.isArray(listed) ? listed.map(String) : []
              } catch {
                listedIds = []
              }
            }
            const reReadBody =
              typeof (result as any).body_preview === "string"
                ? String((result as any).body_preview)
                : typeof (result as any).name === "string"
                  ? String((result as any).name)
                  : ""
            const v = evaluateNotesCreateVerify({
              body: params.body,
              targetId: result.target_id,
              reReadBody,
              listedIds,
            })
            verified = v.verified
            verifyNote = v.reason
          } catch (ve: any) {
            verified = false
            verifyNote = `verify failed: ${ve?.message || String(ve)}`
          }
        } else if (kind === "create") {
          verified = false
          verifyNote = "semantic re-read not available on this platform/kind"
        } else {
          // move: writeOne success only — no path re-read yet (honest: not body-grade verified)
          verified = false
          verifyNote = "move: posted only; path re-read not implemented"
        }
        return {
          success: true,
          data: {
            ...result,
            biometric_nonce: nonce,
            posted: true,
            verified,
            ...(verifyNote ? { verify_note: verifyNote } : {}),
          },
        }
      } catch (err: any) {
        return { success: false, error: `host_write error: ${err.message || String(err)}` }
      }
    }
    case "host_app": {
      // App tab WP3 — L0 no-arg launch of a user-whitelisted app (win32, P1).
      // Adversary 接线警示 ③: THIS is the executor validate branch of the
      // three-place gate wiring (① L2 gate tool list, ② bindingPayloadFor).
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          String(params.security_token),
          "host_app",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for host_app" }
        }
      }
      const isMac = os.platform() === "darwin"
      const isWin = os.platform() === "win32"
      if (!isWin && !isMac) {
        return { success: false, error: `host_app requires macOS or Windows (platform=${os.platform()})` }
      }
      // Belt re-validation of the gate's preconditions — config may have
      // changed between gate and execution, and tests reach the executor
      // directly. The gate already produced the user-facing typed errors;
      // these are the same checks in the same order.
      const appToken = String(params.app || "")
      const action = String(params.action || "")
      if (!APP_TOKEN_PATTERN.test(appToken)) {
        return { success: false, error: `host_app: invalid app token "${appToken}"` }
      }
      if (action !== "launch") {
        return { success: false, error: `host_app: unsupported action "${action}" — Phase 1 supports "launch" only` }
      }
      const appsCfg = getConfig().apps
      if (!appsCfg || appsCfg.enabled === false) {
        return { success: false, error: "host_app: the Apps feature is disabled (apps.enabled=false in config.json)" }
      }
      const entry = appsCfg.entries?.[appToken]
      if (!entry) {
        return { success: false, error: `host_app: unknown app token "${appToken}" — not in the App-tab whitelist` }
      }
      if (!entry.enabled) {
        return { success: false, error: `host_app: app "${entry.display_name}" (${appToken}) is disabled in the App tab` }
      }
      if (entry.kind !== "gui") {
        return { success: false, error: `host_app: "${appToken}" is a CLI app — the CLI track is Phase-2` }
      }
      const launchStartedAt = Date.now()
      try {
        const { launchApp } = await import("./apps/launch")
        const outcome = await launchApp(entry)
        // Design §7.10: per-app audit {token, action, policy, tier_used,
        // confirmation_id?, evidence, duration_ms}. confirmation_id is not
        // plumbed through the gate; tool_call_id is the correlation key.
        logger.info("apps.launch", {
          tool_call_id: toolCallId,
          token: appToken,
          action,
          policy: entry.policy,
          tier_used: execOpts?.appLaunchTier ?? "unknown",
          launched: outcome.launched,
          evidence: outcome.evidence,
          duration_ms: outcome.duration_ms,
        })
        return {
          success: true,
          data: {
            token: appToken,
            action,
            display_name: entry.display_name,
            launched: outcome.launched,
            evidence: outcome.evidence,
            ...(outcome.detail ? { detail: outcome.detail } : {}),
          },
        }
      } catch (err: any) {
        logger.warn("apps.launch", {
          tool_call_id: toolCallId,
          token: appToken,
          action,
          policy: entry.policy,
          tier_used: execOpts?.appLaunchTier ?? "unknown",
          launched: false,
          error: err?.message || String(err),
          duration_ms: Date.now() - launchStartedAt,
        })
        return { success: false, error: `host_app launch failed: ${err?.message || String(err)}` }
      }
    }

    case "host_cli": {
      // Apps Phase-2: structured CLI (L-CLI-*). Three-place gate: ① L2 list ② binding ③ here.
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          String(params.security_token),
          "host_cli",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for host_cli" }
        }
      } else {
        return { success: false, error: "host_cli requires L2 security_token confirmation" }
      }
      const isMac = os.platform() === "darwin"
      const isWin = os.platform() === "win32"
      if (!isWin && !isMac) {
        return { success: false, error: `host_cli requires macOS or Windows (platform=${os.platform()})` }
      }
      const appToken = String(params.app || "")
      const subcommand = String(params.subcommand || "")
      if (!APP_TOKEN_PATTERN.test(appToken) || !appToken.includes(".cli.")) {
        return { success: false, error: `host_cli: invalid CLI app token "${appToken}"` }
      }
      const appsCfg = getConfig().apps
      if (!appsCfg || appsCfg.enabled === false) {
        return { success: false, error: "host_cli: the Apps feature is disabled" }
      }
      const entry = appsCfg.entries?.[appToken]
      if (!entry || entry.kind !== "cli") {
        return { success: false, error: `host_cli: unknown or non-cli token "${appToken}"` }
      }
      if (!entry.enabled) {
        return { success: false, error: `host_cli: "${entry.display_name}" is disabled` }
      }
      if (entry.policy === "auto") {
        // L-CLI-1 belt: config tamper may set auto — still never silent (token already required)
      }
      try {
        const { prepareCliExecution, runCliExecFile } = await import("./apps/cli-exec")
        const { markCliOutputSeen } = await import("./apps/cli-q5")
        const prepared = prepareCliExecution(entry, {
          app: appToken,
          subcommand,
          flags: params.flags,
          args: params.args,
        })
        if (!prepared.ok) {
          return { success: false, error: `host_cli: ${prepared.error}` }
        }
        // Dangerous risk: still require L2 (already have token); biometric floor deferred to L2 dialog riskLevel
        const result = await runCliExecFile(prepared.exe, prepared.argv, {
          timeoutMs: prepared.timeoutMs,
          maxOutputBytes: prepared.maxOutputBytes,
        })
        const threadForQ5 =
          typeof (params as any).__thread_id === "string"
            ? String((params as any).__thread_id)
            : execOpts?.computerSessionId
        if (threadForQ5) markCliOutputSeen(threadForQ5)
        logger.info("cli.exec", {
          tool_call_id: toolCallId,
          token: appToken,
          subcommand,
          risk: prepared.risk,
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          timed_out: result.timed_out === true,
        })
        // Caller wraps with wrapUntrusted; return plain text fields
        if (!result.ok && result.timed_out) {
          return {
            success: false,
            error: `host_cli timed out after ${prepared.timeoutMs}ms`,
            data: { stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code },
          }
        }
        return {
          success: result.exit_code === 0,
          data: {
            token: appToken,
            subcommand,
            risk: prepared.risk,
            exit_code: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
            duration_ms: result.duration_ms,
            argv: prepared.argv,
          },
          ...(result.exit_code !== 0
            ? { error: `host_cli exit ${result.exit_code}${result.stderr ? ": " + result.stderr.slice(0, 200) : ""}` }
            : {}),
        }
      } catch (err: any) {
        return { success: false, error: `host_cli error: ${err?.message || String(err)}` }
      }
    }

    case "host_computer": {
      // Coordinate computer-use (WP1). The task-level L2 dialog ran in the
      // gate above (critical-class, originWs-bound); the security token binds
      // app + task + the full action draft (A3 corpus hash included).
      if (params.security_token) {
        const valid = securityPolicy.validateTokenFor(
          String(params.security_token),
          "host_computer",
          params,
        )
        if (!valid) {
          return { success: false, error: "Invalid or expired security token for host_computer" }
        }
      }
      const isMac = os.platform() === "darwin"
      const isWin = os.platform() === "win32"
      if (!isWin && !isMac) {
        return { success: false, error: `host_computer requires macOS or Windows (platform=${os.platform()})` }
      }
      // R1 (§E.6.2): global single-task invariant — at most ONE coordinate
      // computer task executes process-wide, across threadIds. The pre-dialog
      // gate refuses early; THIS synchronous check-and-set is authoritative
      // (no await between check and set → race-free) and closes the race
      // where both tasks passed the gate inside their own L2 dialogs. The
      // entry is registered BEFORE the estop preflight / clearEstopFlag so a
      // concurrent second task can never clear the running task's fresh
      // emergency-stop press, and it is released in the finally below on
      // EVERY exit path (success / refusal / abort / throw).
      const computerTaskId = randomUUID()
      if (computerTaskAbort.size > 0) {
        logger.warn("computer.task.busy", { tool_call_id: toolCallId })
        return {
          success: false,
          error: "host_computer refused: another computer task is already executing (global single-task invariant, plan §E.6.2) [COMPUTER_TASK_BUSY] — wait for it to finish or abort it from the panel.",
          data: { error_code: "COMPUTER_TASK_BUSY" },
        }
      }
      computerTaskAbort.set(computerTaskId, false)
      try {
        // NOTE (2026-07-21 crash): the Windows estop preflight used to run
        // here, UNCONDITIONALLY — on macOS it spawned powershell.exe, whose
        // async spawn ENOENT escaped as an uncaughtException and killed the
        // daemon. The win preflight now lives in the Windows branch below;
        // macOS runs only the darwin-estop preflight.
        const { runComputerTask } = await import("./computer/executor")

        let result: Awaited<ReturnType<typeof runComputerTask>>

        if (isMac) {
          // macOS WP3: darwin adapters
          const darwinEstop = await import("./computer/darwin-estop")
          const darwinEstopOk = await darwinEstop.ensureEstopHelper()
          if (!darwinEstopOk.ok) {
            logger.warn("computer.estop.unavailable", { tool_call_id: toolCallId, reason: darwinEstopOk.reason })
            return {
              success: false,
              error: `host_computer refused: emergency-stop unavailable (${darwinEstopOk.reason})`,
              data: { error_code: "EMERGENCY_STOP_UNAVAILABLE" },
            }
          }
          darwinEstop.clearEstopFlag()

          const {
            MacScreenCapturer,
            MacLocator,
            MacInputInjector,
            MacWindowEnumerator,
            MacSecurityEnvironment,
            MacAxLocator,
            MacPreviewBuilder,
            startMacAxWindowWatcher,
            MacAxProber,
          } = await import("./computer/darwin-adapters")
          const { MacEvidenceSealer } = await import("./computer/darwin-evidence")
          const { ComputerEvidence } = await import("./computer/evidence")
          const { writeBackUiaVerdict } = await import("./computer/uia")

          const macSealer = new MacEvidenceSealer()

          result = await runComputerTask(
            {
              task: String(params.task || ""),
              app: String(params.app || ""),
              actions: Array.isArray(params.actions) ? params.actions : [],
              ...(typeof params.budget === "number" ? { budget: params.budget } : {}),
              taskId: computerTaskId,
            },
            {
              capturer: new MacScreenCapturer(),
              locator: new MacLocator(),
              injector: new MacInputInjector(darwinEstop.estopFlagPath()),
              windows: new MacWindowEnumerator(),
              securityEnv: new MacSecurityEnvironment(),
              uiaLocator: new MacAxLocator(),
              evidenceFactory: (taskId) => new ComputerEvidence(taskId, macSealer),
              confirm: execOpts?.sendConfirmation ?? (async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const })),
              config: getConfig(),
              sessionId: execOpts?.computerSessionId,
              log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
              abortCheck: () =>
                computerTaskAbort.get(computerTaskId)
                  ? "panel"
                  : darwinEstop.consumeEstopFlag()
                    ? "hotkey"
                    : darwinEstop.estopHeartbeatLost()
                      ? "estop-lost"
                      : null,
              onEvent: (ev) => {
                try { execOpts?.broadcast?.({ type: "computer.task.event", ...ev }) } catch { /* best-effort */ }
              },
              previewBuilder: new MacPreviewBuilder(),
              onActionInjected: () => {
                try { computerRateLimiterSingleton?.record() } catch { /* best-effort */ }
              },
              uiaProber: new MacAxProber(),
              uiaWatcherFactory: (t, opts) => startMacAxWindowWatcher(t, opts),
              // Qwen3-VL works on macOS (MPS/CPU via Python transformers)
              ...(await (async () => {
                try {
                  const { resolveModelAdmissionSafe } = await import("./computer/model-admission")
                  const { computerModelSession } = await import("./computer/model-handlers")
                  const adm = await resolveModelAdmissionSafe({
                    config: getConfig().computer,
                    holder: computerModelSession,
                    deps: {
                      broadcast: (m) => { try { execOpts?.broadcast?.(m) } catch { /* best-effort */ } },
                      log: (event, payload) => logger.info(event, { tool_call_id: toolCallId, ...payload }),
                      stillEnabled: () => getConfig().computer?.modelEnabled === true,
                    },
                  })
                  return {
                    tinyclickLocator: adm.locator,
                    ...(adm.locator
                      ? {}
                      : { tinyclickSkipReason: adm.reason || "model-not-admitted" }),
                  }
                } catch (e) {
                  return {
                    tinyclickLocator: null,
                    tinyclickSkipReason:
                      e instanceof Error ? `admission-error:${e.message.slice(0, 80)}` : "model-admission-error",
                  }
                }
              })()),
              onUiaVerdict: (token, verdict, probedAt) => {
                const wb = writeBackUiaVerdict(token, verdict, probedAt)
                logger.info("computer.uia.writeback", { tool_call_id: toolCallId, token, applied: wb.applied, reason: wb.reason })
              },
            },
          )
        } else {
          // Windows: original adapter wiring
          // WP2 (§E.6): emergency-stop preflight — the hotkey helper must be
          // alive (ready.json heartbeat < 3s) before ANY injection task starts.
          // Spawns the helper when missing; refuses fail-closed when it cannot
          // come up: an injection loop with no kill switch must never run.
          // WINDOWS-ONLY: macOS runs the darwin-estop preflight in its branch
          // above; the ps1 helper must never be spawned off-win32.
          const { ensureEstopHelper, clearEstopFlag, consumeEstopFlag, estopFlagPath, estopHeartbeatLost } = await import("./computer/estop")
          const estop = computerEstopEnsureOverride ? await computerEstopEnsureOverride() : await ensureEstopHelper()
          if (!estop.ok) {
            logger.warn("computer.estop.unavailable", { tool_call_id: toolCallId, reason: estop.reason })
            return {
              success: false,
              error: `host_computer refused: emergency-stop unavailable (${estop.reason}). The computer-estop.ps1 helper must be running with a working hotkey.`,
              data: { error_code: "EMERGENCY_STOP_UNAVAILABLE" },
            }
          }
          // A STALE flag (pressed before this task) must not abort the new run.
          // N3: a press landing in the ms-window between this clear and the
          // executor's first abortCheck is lost — accepted: the single-task
          // gate above bounds that window to THIS task's own startup (no other
          // task can clear a fresh press), and the user can simply press again.
          clearEstopFlag()
          const { PsScreenCapturer, PsLocator, PsInputInjector, PsWindowEnumerator, PsSecurityEnvironment, PsPreviewBuilder, PsEvidenceSealer, PsUiaLocator, startUiaWindowWatcher } = await import("./computer/win-adapters")
          const { PsUiaProber, writeBackUiaVerdict } = await import("./computer/uia")
          const { ComputerEvidence, runEvidenceJanitor } = await import("./computer/evidence")
          // A7.2: 7-day TTL janitor — best-effort, never blocks the task.
          try { runEvidenceJanitor({}) } catch { /* best-effort */ }
          // X6: sweep %TEMP% raw captures stranded by crashed companion
          try {
            const { sweepComputerTempCaptures } = await import("./computer/win-adapters")
            const swept = sweepComputerTempCaptures()
            if (swept.removed.length > 0) {
              logger.info("computer.temp.swept", { removed: swept.removed.length })
            }
          } catch { /* best-effort */ }
          const sealer = new PsEvidenceSealer()
          // WP5-I4 TinyClick admission
          const { resolveTinyClickAdmissionSafe } = await import("./computer/model-admission")
          const { computerModelSession } = await import("./computer/model-handlers")
          const tinyclickAdmission = await resolveTinyClickAdmissionSafe({
            config: getConfig().computer,
            holder: computerModelSession,
            deps: {
              broadcast: (m) => { try { execOpts?.broadcast?.(m) } catch { /* best-effort */ } },
              log: (event, payload) => logger.info(event, { tool_call_id: toolCallId, ...payload }),
              stillEnabled: () => getConfig().computer?.modelEnabled === true,
            },
          })

          result = await runComputerTask(
            {
              task: String(params.task || ""),
              app: String(params.app || ""),
              actions: Array.isArray(params.actions) ? params.actions : [],
              ...(typeof params.budget === "number" ? { budget: params.budget } : {}),
              taskId: computerTaskId,
            },
            {
              capturer: new PsScreenCapturer(),
              locator: new PsLocator(),
              injector: new PsInputInjector(undefined, estopFlagPath()),
              windows: new PsWindowEnumerator(),
              securityEnv: new PsSecurityEnvironment(),
              uiaLocator: new PsUiaLocator(),
              evidenceFactory: (taskId) => new ComputerEvidence(taskId, sealer),
              confirm: execOpts?.sendConfirmation ?? (async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const })),
              config: getConfig(),
              sessionId: execOpts?.computerSessionId,
              log: (event, data) => logger.info(event, { tool_call_id: toolCallId, ...data }),
              abortCheck: () =>
                computerTaskAbort.get(computerTaskId)
                  ? "panel"
                  : consumeEstopFlag()
                    ? "hotkey"
                    : estopHeartbeatLost()
                      ? "estop-lost"
                      : null,
              onEvent: (ev) => {
                try { execOpts?.broadcast?.({ type: "computer.task.event", ...ev }) } catch { /* best-effort */ }
              },
              previewBuilder: new PsPreviewBuilder(),
              onActionInjected: () => {
                try { computerRateLimiterSingleton?.record() } catch { /* best-effort */ }
              },
              uiaProber: new PsUiaProber(),
              uiaWatcherFactory: (t, opts) => startUiaWindowWatcher(t, opts),
              tinyclickLocator: tinyclickAdmission.locator,
              ...(tinyclickAdmission.locator
                ? {}
                : { tinyclickSkipReason: tinyclickAdmission.reason || "model-not-admitted" }),
              onUiaVerdict: (token, verdict, probedAt) => {
                const wb = writeBackUiaVerdict(token, verdict, probedAt)
                logger.info("computer.uia.writeback", { tool_call_id: toolCallId, token, applied: wb.applied, reason: wb.reason })
              },
            },
          )
        }
        if (!result.success) {
          return {
            success: false,
            error: result.error,
            data: { error_code: result.errorCode, task_id: result.taskId, evidence_dir: result.evidenceDir, steps: result.steps },
          }
        }
        return {
          success: true,
          data: {
            task_id: result.taskId,
            completed: result.completedActions,
            total: result.totalActions,
            evidence_dir: result.evidenceDir,
            steps: result.steps,
            // Grill G1: posted ≠ verified. LLM must not claim "已发送" unless verified_steps cover write steps.
            posted_steps: result.posted_steps ?? 0,
            verified_steps: result.verified_steps ?? 0,
            note:
              (result.verified_steps ?? 0) < (result.posted_steps ?? 0)
                ? "Some inject steps posted events but were not semantically verified (posted≠verified)."
                : undefined,
          },
        }
      } catch (err: any) {
        logger.warn("computer.task.error", { tool_call_id: toolCallId, error: err?.message || String(err) })
        return { success: false, error: `host_computer error: ${err?.message || String(err)}` }
      } finally {
        // R1 (§E.6.2): release the single-task slot on EVERY exit path —
        // success, typed refusal, abort, or throw. Runs after the return
        // value is computed; delete is idempotent.
        computerTaskAbort.delete(computerTaskId)
      }
    }
    default:
      return { success: false, error: `Unknown companion tool: ${toolName}` }
  }
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
        `仅把该子目录加入 allowlist（须在你的主目录下，不是整盘）。拒绝则保持当前配置。`,
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
export function redactConfigForBroadcast(config: any): any {
  if (!config || typeof config !== "object") return config

  const redacted: any = { ...config }

  if (config.llm && typeof config.llm === "object") {
    redacted.llm = {
      ...config.llm,
      api_key: config.llm.api_key ? "***" : "",
    }
  }

  if (config.vision && typeof config.vision === "object") {
    redacted.vision = {
      ...config.vision,
      api_key: config.vision.api_key ? "***" : "",
    }
  }

  if (config.mcp && typeof config.mcp === "object") {
    const serversIn = config.mcp.servers
    if (serversIn && typeof serversIn === "object") {
      const serversOut: Record<string, any> = {}
      for (const [name, raw] of Object.entries(serversIn as Record<string, any>)) {
        if (!raw || typeof raw !== "object") {
          serversOut[name] = raw
          continue
        }
        const server: any = { ...raw }
        if (server.env && typeof server.env === "object") {
          const env: Record<string, string> = {}
          for (const k of Object.keys(server.env)) {
            env[k] = "***"
          }
          server.env = env
        }
        if (server.headers && typeof server.headers === "object") {
          const headers: Record<string, string> = {}
          for (const k of Object.keys(server.headers)) {
            headers[k] = "***"
          }
          server.headers = headers
        }
        serversOut[name] = server
      }
      // Shallow-copy mcp so we do not mutate caller's servers map; top-level
      // ...config already shared the mcp ref until we replace it here.
      redacted.mcp = { ...config.mcp, servers: serversOut }
    }
    // When servers is absent, redacted.mcp already shares config.mcp from the
    // top-level spread — no secrets to mask on that path.
  }

  return redacted
}

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

// --- WS message validation ---

export interface WsValidationResult {
  valid: boolean
  error?: string
}

export function validateWsMessage(msg: any): WsValidationResult {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { valid: false, error: "Message must be an object" }
  }
  if (typeof msg.type !== "string" || !msg.type) {
    return { valid: false, error: "Message type must be a non-empty string" }
  }

  // Known message types with required field validation
  const validators: Record<string, (m: any) => WsValidationResult> = {
    "chat.create": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.create requires thread_id" }
      if (typeof m.message !== "string") return { valid: false, error: "chat.create requires message string" }
      if (m.skill_ids !== undefined && !Array.isArray(m.skill_ids)) return { valid: false, error: "skill_ids must be an array" }
      // Optional site-knowledge context (not a security gate)
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      return { valid: true }
    },
    "chat.abort": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.abort requires thread_id" }
      return { valid: true }
    },
    "chat.regenerate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.regenerate requires thread_id" }
      if (typeof m.message_id !== "string" || !m.message_id) return { valid: false, error: "chat.regenerate requires message_id" }
      if (m.message !== undefined && typeof m.message !== "string") return { valid: false, error: "chat.regenerate message must be a string" }
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      return { valid: true }
    },
    "thread.create": (m) => {
      if (m.alias !== undefined && typeof m.alias !== "string") return { valid: false, error: "alias must be a string" }
      if (m.id !== undefined && typeof m.id !== "string") return { valid: false, error: "id must be a string" }
      return { valid: true }
    },
    "thread.delete": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.delete requires thread_id" }
      return { valid: true }
    },
    "thread.cleanup_empty": () => ({ valid: true }),
    "thread.select": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.select requires thread_id" }
      return { valid: true }
    },
    "thread.fork": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.fork requires thread_id" }
      if (typeof m.message_id !== "string" || !m.message_id) return { valid: false, error: "thread.fork requires message_id" }
      return { valid: true }
    },
    "thread.update": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.update requires thread_id" }
      if (!m.updates || typeof m.updates !== "object") return { valid: false, error: "thread.update requires updates object" }
      return { valid: true }
    },
    "skill.activate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.activate requires thread_id" }
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.activate requires skill_name" }
      return { valid: true }
    },
    "skill.deactivate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.deactivate requires thread_id" }
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.deactivate requires skill_name" }
      return { valid: true }
    },
    "skill.import": (m) => {
      if (!m.url && !m.content) return { valid: false, error: "skill.import requires url or content" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      if (m.content !== undefined && typeof m.content !== "string") return { valid: false, error: "content must be a string" }
      return { valid: true }
    },
    "skill.delete": (m) => {
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.delete requires skill_name" }
      return { valid: true }
    },
    "skill.export": (m) => {
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.export requires skill_name" }
      return { valid: true }
    },
    "skill.craft": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.craft requires thread_id" }
      return { valid: true }
    },
    "config.set": (m) => {
      if (!m.config || typeof m.config !== "object") return { valid: false, error: "config.set requires config object" }
      return { valid: true }
    },
    "history.query": () => ({ valid: true }),
    "history.export": () => ({ valid: true }),
    "security.confirmation.response": (m) => {
      if (typeof m.confirmation_id !== "string" || !m.confirmation_id) return { valid: false, error: "confirmation_id required" }
      if (typeof m.approved !== "boolean") return { valid: false, error: "approved must be a boolean" }
      return { valid: true }
    },
    "computer.task.abort": (m) => {
      if (typeof m.task_id !== "string" || !m.task_id) return { valid: false, error: "computer.task.abort requires task_id (a task id or '*')" }
      return { valid: true }
    },
    "computer.evidence.open": (m) => {
      if (typeof m.task_id !== "string" || !m.task_id) return { valid: false, error: "computer.evidence.open requires task_id" }
      return { valid: true }
    },
    "computer.model.get_state": () => ({ valid: true }),
    // WP5 I3 登记项③（plan:480 M3）：熔断手动复位仅接受设置页声明来源——
    // 未知类型默认放行（本函数尾部），故此条目是真围栏；handler 层二次核查。
    "computer.model.reset_circuit_breaker": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.reset_circuit_breaker requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    // WP5-I4 WI-4.2 开关族（plan:538）：四路由同样仅设置页来源（双层围栏第一
    // 层；handler belt 为第二层，P6）。set_enabled/license_response 另强制形状。
    "computer.model.set_enabled": (m) => {
      if (typeof m.enabled !== "boolean") return { valid: false, error: "computer.model.set_enabled requires enabled:boolean" }
      if (m.source !== "settings") return { valid: false, error: 'computer.model.set_enabled requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.license_response": (m) => {
      // D9: reset_decline clears a prior decline without accepting the license text.
      const isReset = m.reset_decline === true || m.resetDecline === true
      if (!isReset && typeof m.accepted !== "boolean") {
        return { valid: false, error: "computer.model.license_response requires accepted:boolean (or reset_decline:true)" }
      }
      if (m.source !== "settings") return { valid: false, error: 'computer.model.license_response requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.download": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.download requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.delete": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.delete requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.set_variant": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.set_variant requires source:"settings" (settings-page only)' }
      if (m.variant !== "2b" && m.variant !== "4b" && m.variant !== "8b") {
        return { valid: false, error: 'computer.model.set_variant requires variant:"2b"|"4b"|"8b"' }
      }
      return { valid: true }
    },
    "computer.model.set_download_source": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_download_source requires source:"settings" (settings-page only)' }
      }
      const ds = m.downloadSource
      if (ds !== "auto" && ds !== "huggingface" && ds !== "hf-mirror" && ds !== "modelscope") {
        return {
          valid: false,
          error: 'computer.model.set_download_source requires downloadSource:"auto"|"huggingface"|"hf-mirror"|"modelscope"',
        }
      }
      return { valid: true }
    },
    "computer.model.set_model_root": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_model_root requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.pick_model_root": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.pick_model_root requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.set_python_mode": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_python_mode requires source:"settings"' }
      }
      if (m.mode !== "isolated" && m.mode !== "system") {
        return { valid: false, error: 'computer.model.set_python_mode requires mode:"isolated"|"system"' }
      }
      return { valid: true }
    },
    "computer.model.pick_python_path": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.pick_python_path requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.ensure_python_env": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.ensure_python_env requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.install_deps": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.install_deps requires source:"settings"' }
      }
      return { valid: true }
    },
    "tool.result": (m) => {
      if (typeof m.tool_call_id !== "string" || !m.tool_call_id) return { valid: false, error: "tool.result requires tool_call_id" }
      return { valid: true }
    },
    "log.event": (m) => {
      if (typeof m.event !== "string" || !m.event) return { valid: false, error: "log.event requires event string" }
      return { valid: true }
    },
    "system.ping": () => ({ valid: true }),
    // P0-2B: the ONLY message an unauthenticated peer may send. proof is verified
    // against HMAC-SHA256(sharedSecret, nonce) in the connection handler.
    "auth.handshake": (m) => {
      if (typeof m.proof !== "string" || !m.proof) {
        return { valid: false, error: "auth.handshake requires proof string" }
      }
      return { valid: true }
    },
    "executeQuickAction": (m) => {
      const aid = m.actionId || m.id
      if (typeof aid !== "string" || !aid) return { valid: false, error: "executeQuickAction requires actionId" }
      return { valid: true }
    },
    "file.upload": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "file.upload requires thread_id" }
      if (!Array.isArray(m.files) || m.files.length === 0) return { valid: false, error: "files array required" }
      if (m.files.length > 10) return { valid: false, error: "最多上传 10 个文件" }
      for (const f of m.files) {
        if (!f.name || !f.type || !f.content) return { valid: false, error: "每个文件需要 name, type, content 字段" }
        if (typeof f.name !== "string" || typeof f.type !== "string" || typeof f.content !== "string") return { valid: false, error: "文件字段均为 string 类型" }
      }
      if (m.message !== undefined && typeof m.message !== "string") return { valid: false, error: "message 必须为字符串" }
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      return { valid: true }
    },
    "file.query_chunks": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "file.query_chunks requires thread_id" }
      if (typeof m.query !== "string" || !m.query) return { valid: false, error: "query required" }
      return { valid: true }
    },
    "mcp.list": () => ({ valid: true }),
    "mcp.toggle_enabled": (m) => {
      if (typeof m.enabled !== "boolean") return { valid: false, error: "mcp.toggle_enabled requires boolean enabled" }
      return { valid: true }
    },
    "mcp.add": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.add requires name" }
      if (!m.server || typeof m.server !== "object") return { valid: false, error: "mcp.add requires server config object" }
      return { valid: true }
    },
    "mcp.update": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.update requires name" }
      if (!m.patch || typeof m.patch !== "object") return { valid: false, error: "mcp.update requires patch object" }
      return { valid: true }
    },
    "mcp.delete": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.delete requires name" }
      return { valid: true }
    },
    "mcp.toggle_server": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.toggle_server requires name" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "mcp.toggle_server requires boolean enabled" }
      return { valid: true }
    },
    "mcp.set_selection": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "mcp.set_selection requires thread_id" }
      return { valid: true }
    },
    // Mission Pack / enterprise modules
    "pack.list": () => ({ valid: true }),
    "pack.install": (m) => {
      if (!m.dir && !m.zip_path) return { valid: false, error: "pack.install requires dir or zip_path" }
      return { valid: true }
    },
    "pack.apply": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.apply requires pack_id" }
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "pack.apply requires thread_id" }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.apply requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "pack.unapply": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "pack.unapply requires thread_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.unapply requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "pack.uninstall": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.uninstall requires pack_id" }
      return { valid: true }
    },
    "pack.get": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.get requires pack_id" }
      return { valid: true }
    },
    "pack.save_user": (m) => {
      if (typeof m.name !== "string" || !m.name.trim()) {
        return { valid: false, error: "pack.save_user requires name" }
      }
      if (typeof m.system_prompt_append !== "string" || !m.system_prompt_append.trim()) {
        return { valid: false, error: "pack.save_user requires system_prompt_append" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.save_user requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "pack.delete_user": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) {
        return { valid: false, error: "pack.delete_user requires pack_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.delete_user requires user_gesture:true" }
      }
      return { valid: true }
    },
    "pack.suggest_config": (m) => {
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.suggest_config requires user_gesture:true" }
      }
      const hasBrief = typeof m.brief === "string" && m.brief.trim().length > 0
      const hasName = typeof m.name === "string" && m.name.trim().length > 0
      const hasPrompt =
        typeof m.system_prompt_append === "string" && m.system_prompt_append.trim().length > 0
      if (!hasBrief && !hasName && !hasPrompt) {
        return {
          valid: false,
          error: "pack.suggest_config requires brief, name, or system_prompt_append",
        }
      }
      return { valid: true }
    },
    "modules.list": () => ({ valid: true }),
    "modules.set_enabled": (m) => {
      if (typeof m.module !== "string" || !m.module) return { valid: false, error: "modules.set_enabled requires module" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "modules.set_enabled requires enabled boolean" }
      return { valid: true }
    },
    "modules.update": (m) => {
      if (typeof m.module !== "string" || !m.module) return { valid: false, error: "modules.update requires module" }
      if (!m.patch || typeof m.patch !== "object") return { valid: false, error: "modules.update requires patch object" }
      return { valid: true }
    },
    "outbound_mcp.grants.list": () => ({ valid: true }),
    "outbound_mcp.grants.issue": (m) => {
      if (typeof m.caller_id !== "string" || !m.caller_id.trim()) {
        return { valid: false, error: "outbound_mcp.grants.issue requires caller_id" }
      }
      return { valid: true }
    },
    "outbound_mcp.grants.revoke": (m) => {
      if (typeof m.grant_id !== "string" || !m.grant_id.trim()) {
        return { valid: false, error: "outbound_mcp.grants.revoke requires grant_id" }
      }
      return { valid: true }
    },
    "outbound_mcp.grants.revoke_all": () => ({ valid: true }),
    "outbound_mcp.set_require_grant": (m) => {
      if (typeof m.require_grant !== "boolean") {
        return { valid: false, error: "outbound_mcp.set_require_grant requires require_grant boolean" }
      }
      return { valid: true }
    },
    // ADR-015 multi-agent fleet / Confirm Center
    "fleet.status": () => ({ valid: true }),
    "fleet.stop_all": () => ({ valid: true }),
    "worker.pause": (m) => {
      if (typeof m.worker_id !== "string" || !m.worker_id) return { valid: false, error: "worker.pause requires worker_id" }
      return { valid: true }
    },
    "worker.resume": (m) => {
      if (typeof m.worker_id !== "string" || !m.worker_id) return { valid: false, error: "worker.resume requires worker_id" }
      return { valid: true }
    },
    "tab.force_release": (m) => {
      if (typeof m.tab_id !== "number") return { valid: false, error: "tab.force_release requires tab_id number" }
      return { valid: true }
    },
    "board.get": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "board.get requires thread_id" }
      return { valid: true }
    },
    "board.add_hint": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "board.add_hint requires thread_id" }
      if (typeof m.text !== "string" || !m.text.trim()) return { valid: false, error: "board.add_hint requires text" }
      return { valid: true }
    },
    "workspace.pick": () => ({ valid: true }),
    "workspace.clear": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "workspace.clear requires thread_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "workspace.clear requires user_gesture:true" }
      }
      return { valid: true }
    },
    "workspace.set": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "workspace.set requires thread_id" }
      if (typeof m.path !== "string" || !m.path) return { valid: false, error: "workspace.set requires path" }
      return { valid: true }
    },
    "netsec.authorize_task": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "netsec.authorize_task requires thread_id" }
      if (m.authorized !== true) return { valid: false, error: "netsec.authorize_task requires authorized:true" }
      if (m.user_gesture !== true) return { valid: false, error: "netsec.authorize_task requires user_gesture:true" }
      if (!Array.isArray(m.targets) || m.targets.length === 0) return { valid: false, error: "netsec.authorize_task requires targets[]" }
      return { valid: true }
    },
    "apps.list": () => ({ valid: true }),
    "apps.enumerate": () => ({ valid: true }),
    "apps.add": (m) => {
      const hasPath = typeof m.path === "string" && m.path.length > 0
      const hasAumid = typeof m.aumid === "string" && m.aumid.length > 0
      const hasBundleId = typeof m.bundleId === "string" && m.bundleId.length > 0
      // At least one identifier: path (Windows), aumid (UWP), or bundleId (macOS)
      if (!hasPath && !hasAumid && !hasBundleId) {
        return { valid: false, error: "apps.add requires at least one of path / aumid / bundleId" }
      }
      if (m.policy !== undefined && !["auto", "ai", "manual"].includes(m.policy)) {
        return { valid: false, error: "apps.add policy must be auto, ai, or manual" }
      }
      if (m.display_name !== undefined && typeof m.display_name !== "string") {
        return { valid: false, error: "apps.add display_name must be a string" }
      }
      return { valid: true }
    },
    "apps.remove": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.remove requires token" }
      return { valid: true }
    },
    "apps.set_policy": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.set_policy requires token" }
      if (!["auto", "ai", "manual"].includes(m.policy)) return { valid: false, error: "apps.set_policy policy must be auto, ai, or manual" }
      return { valid: true }
    },
    "apps.set_enabled": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.set_enabled requires token" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "apps.set_enabled requires boolean enabled" }
      return { valid: true }
    },
    "tab.navigated": (m) => {
      if (typeof m.tabId !== "number") return { valid: false, error: "tab.navigated requires tabId number" }
      if (typeof m.url !== "string" || !m.url) return { valid: false, error: "tab.navigated requires url string" }
      return { valid: true }
    },
  }

  const validator = validators[msg.type]
  if (validator) {
    return validator(msg)
  }

  // Unknown types are allowed through (handled by message-router default case)
  return { valid: true }
}

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
    broadcastToClients({ type: "mcp.servers.updated", servers: metas })
  })
  mcpManager.on("status_changed", (meta) => {
    broadcastToClients({ type: "mcp.server.status_changed", server: meta })
  })
  mcpManager.on("tools_changed", () => {
    broadcastToClients({ type: "mcp.servers.updated", servers: mcpManager.listServers() })
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
      config: redactConfigForBroadcast(updatedConfig),
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
            st.authenticated = true
            clearTimeout(st.timer)
            logger.info("ws.authenticated", {})
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
              ws.send(JSON.stringify({ type: "auth.ok" }))
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
          handleToolResult(msg)
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
        if (msg.type === "chat.abort") {
          flipAllComputerTaskAborts()
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

        const response = await handleMessage(
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
          },
        )

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
      applyConnectionCloseGracePeriod()
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
