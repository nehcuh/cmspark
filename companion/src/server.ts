// Companion server — WebSocket server, message routing, tool execution bridge

import { WebSocket } from "ws"
import { randomUUID } from "crypto"
import { URL } from "url"
import { getConfig, saveConfig, initDataDir, DATA_DIR } from "./config"
import { bootGcVoiceSttTmp, getSttSessionService } from "./voice/stt-session-service"
import { gcExpiredMeetingAudio } from "./meeting/meeting-store"
import { ThreadManager } from "./threads/thread-manager"
import { SkillEngine } from "./skills/skill-engine"
import { HistoryStore } from "./history/store"
import { SecurityConfirmationManager } from "./security-confirmation"
import { getTrayInstance } from "./menu-bar-agent"
import { logger } from "./logger"
import { getMcpConfirmCache, isMcpNamespaced } from "./mcp"
import {
  bindMcpDispatchRuntime,
  executeMcpTool,
  executeMcpMetaTool,
} from "./mcp/dispatch"
export {
  bindMcpDispatchRuntime,
  executeMcpTool,
  executeMcpMetaTool,
  enhanceMcpError,
} from "./mcp/dispatch"
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
import { runBrowserDownloadAdmission } from "./tool/browser-download-admission"
import { isCompanionTool } from "./bridge/companion-tools"
export { runBrowserDownloadAdmission } from "./tool/browser-download-admission"
import { runMultiAgentToolPregate } from "./orchestrator/tool-pregate"
export { runMultiAgentToolPregate } from "./orchestrator/tool-pregate"
import {
  rejectPendingForThread,
  hasPendingForTab,
  rejectPendingForTab,
  dispatchToExtension,
  forwardToolToExtension,
  bindToolForwardRuntime,
} from "./ws/tool-forward"
export {
  TOOL_EXECUTION_TIMEOUT_MS,
  BROWSER_DOWNLOAD_MAX_TIMEOUT_MS,
  resolveToolDispatchTimeoutMs,
  pendingToolCalls,
  rejectPendingForThread,
  hasPendingForTab,
  rejectPendingForTab,
  handleToolResult,
  dispatchToExtension,
  forwardToolToExtension,
  bindToolForwardRuntime,
} from "./ws/tool-forward"
import {
  applyTabNavigated,
  getCachedTabUrl,
  getTabUrlCache,
  refreshTabUrlCache,
} from "./ws/tab-url-cache"
export {
  applyTabNavigated,
  getCachedTabUrl,
  getTabUrlCache,
  refreshTabUrlCache,
  clearTabUrlCacheForTests,
} from "./ws/tab-url-cache"
import { normalizeShellCwd } from "./capability/shell"
import { normalizeNetsecPorts } from "./netsec/scan"

// --- WS lifecycle (C10-H2: body in ws/lifecycle.ts) ---
import {
  broadcastToClients,
  bindWsLifecycle,
  getWsClients,
  getWsAuthState,
} from "./ws/lifecycle"
export {
  broadcastToClients,
  isAllowedWsOrigin,
  handleHealthzRequest,
  pickAuthenticatedClientWs,
  ensureOutboundToolRunnerWired,
  applyConnectionCloseGracePeriod,
  setupBroadcastAuthForTests,
  startServer,
  bindWsLifecycle,
  getWsClients,
  getWsAuthState,
} from "./ws/lifecycle"

import {
  flipAllComputerTaskAborts,
  getComputerTaskAbortRegistry,
} from "./computer/task-abort-registry"

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

function getDomainFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString)
    return parsed.hostname
  } catch {
    return ""
  }
}

// C-P0-6 (2026-07-24 diagnosis): track active tray confirmation IDs per WS so
// that when a WS disconnects mid-confirmation, we can cancel the corresponding
// tray dialog. Without this, the Swift dialog stays modal until its own timeout
// even though the requesting WS is gone. The tray adapter is a singleton with
// its own pendingConfirms Map; cancelConfirm(id) is a no-op if id isn't pending.
const activeTrayConfirmsByWs = new WeakMap<WebSocket, Set<string>>()

// wsAuth / clients / wss live in ws/lifecycle.ts (C10-H2)

// Core services — initialized on first connection
let threadManager: ThreadManager
let skillEngine: SkillEngine
let historyStore: HistoryStore

// pendingToolCalls / rejectPending* / hasPendingForTab / handleToolResult /
// dispatchToExtension / forwardToolToExtension live in ws/tool-forward.ts (C10-G)
// — re-exported above.

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

// tabUrlCache → ws/tab-url-cache.ts (day dual-review nit: colocation)
// applyTabNavigated / getCachedTabUrl / refreshTabUrlCache re-exported above.

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
  bindMcpDispatchFromServerLocals()
  bindToolForwardFromServerLocals()
}

/**
 * Integration tests: ensure module-level ThreadManager exists so outbound B1
 * path (`isToolAllowed` on synthetic holders) is exercised. No-op if already set.
 */
export function seedThreadManagerForTests(): ThreadManager {
  if (!threadManager) {
    threadManager = new ThreadManager()
  }
  // Re-bind so executeCompanionTool / executeMcpTool / tool-forward see the seeded manager
  // (tests may skip full initServices).
  bindCompanionDispatchFromServerLocals()
  bindMcpDispatchFromServerLocals()
  bindToolForwardFromServerLocals()
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

// FREEZE (C10 multi-adv 2026-08-10 / phase-A..H 2026-08-11):
// - ADR-015 multi-agent pre-gate → orchestrator/tool-pregate.ts
//   (runMultiAgentToolPregate: tab lease / pack whitelist / HOST_CHROME).
// - L2 security admission → tool/l2-admission.ts (runL2ToolAdmission).
// - Cookie trust + URL navigate admission → tool/url-cookie-admission.ts
//   (runCookieTrustAdmission / runUrlNavigateAdmission).
// - analyze_image IMAGE_FETCH two-phase gate → tool/image-fetch-admission.ts
//   (runImageFetchAdmission).
// - browser_download path sandbox → tool/browser-download-admission.ts
//   (runBrowserDownloadAdmission).
// - MCP namespaced + meta dispatch → mcp/dispatch.ts
//   (executeMcpTool / executeMcpMetaTool; bind via bindMcpDispatchRuntime).
// - Extension tool-forward (pending map / dispatch / default forward post-process)
//   → ws/tool-forward.ts (forwardToolToExtension / dispatchToExtension /
//   handleToolResult / pendingToolCalls; bind via bindToolForwardRuntime).
// - security.confirmation.response → security/confirm-response.ts (C10-H1)
//   (handleSecurityConfirmationResponse; inject via ConfirmResponseDeps).
// - WS lifecycle / startServer → ws/lifecycle.ts (C10-H2)
//   (isAllowedWsOrigin, healthz, broadcast, grace, startServer; bindWsLifecycle).
// - createToolExecutor is the pure orchestration shell: pregate call / cookie /
//   browser_download / L2 call / URL gate / image gate call / companion dispatch /
//   MCP / forwardToolToExtension (no pending-map / send / timeout body here).
// - NEW companion-side tool *cases* → tool/companion-dispatch.ts (or capability/*).
// - NEW WS validators → ws/validate.ts.
// Do not re-inflate server.ts with multi-agent pregate, L2 algebra, cookie/URL/image/
// browser_download/MCP gate bodies, extension-forward plumbing, confirm-response, or business tool bodies.
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
    // Static imports (day dual-review nit: avoid hot-path require()).
    if (toolName === "shell_exec") {
      const thr = actingThreadId ? threadManager.get(actingThreadId) : null
      const cwd = normalizeShellCwd(finalParams, thr?.workspace_root)
      const { working_directory: _wd, ...restShell } = finalParams as Record<string, any>
      finalParams = { ...restShell, cwd }
    } else if (toolName === "netsec_port_scan") {
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

    // ADR-015 multi-agent pre-gate — extracted to orchestrator/tool-pregate.ts (C10-F)
    const pregate = await runMultiAgentToolPregate({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      actingThreadId,
      isOutboundMcpCall,
      logToolFinish,
      getThreadManager: () => threadManager,
      hasPendingForTab,
      toolDisplayNameZh,
    })
    if (!pregate.ok) return pregate.result
    finalParams = pregate.finalParams

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

    // browser_download path sandbox — extracted to tool/browser-download-admission.ts (C10-E1)
    const bdOutcome = runBrowserDownloadAdmission({
      toolName,
      finalParams,
      toolCallId,
      startedAt,
      actingThreadId,
      logToolFinish,
      getThreadManager: () => threadManager,
    })
    if (!bdOutcome.ok) return bdOutcome.result
    finalParams = bdOutcome.finalParams

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
      clients: getWsClients(),
      wsAuthGet: (w) => getWsAuthState(w),
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
      clients: getWsClients(),
      wsAuthGet: (w) => getWsAuthState(w),
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
    // P2: SoT is companion/src/bridge/companion-tools.ts
    if (isCompanionTool(toolName)) {
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

    // Extension forward — pending map / timeout / tabUrlCache post-process in
    // ws/tool-forward.ts (C10-G). createToolExecutor stays pure orchestration.
    return forwardToolToExtension({
      toolCallId,
      toolName,
      finalParams,
      ws,
      actingThreadId,
      startedAt,
      logToolFinish,
    })
  }
}

// --- security.confirmation.response (C10-H1: body in security/confirm-response.ts) ---
// FREEZE: whitelist persist / stop_thread drain / thread-whitelist algebra lives there.
import {
  handleSecurityConfirmationResponse as handleSecurityConfirmationResponseImpl,
  type ConfirmResponseDeps,
} from "./security/confirm-response"
export type { ConfirmResponseDeps }

/**
 * Process a `security.confirmation.response` from a WS peer.
 * Thin wrapper: injects server-owned deps into security/confirm-response.ts (C10-H1).
 * Public signature unchanged for integration tests.
 */
export async function handleSecurityConfirmationResponse(
  ws: WebSocket,
  msg: any,
  sessionId?: string,
): Promise<void> {
  return handleSecurityConfirmationResponseImpl(ws, msg, sessionId, {
    securityConfirmations,
    getConfig,
    saveConfig,
    getThreadManager: () => threadManager,
    rejectPendingForThread,
    hasPendingForTab,
    rejectPendingForTab,
  })
}

// applyConnectionCloseGracePeriod → ws/lifecycle.ts (C10-H2)

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
    getTabUrlCache,
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

// --- Extension tool-forward (C10-G: body in ws/tool-forward.ts) ---
// FREEZE: pending map / dispatch / default forward post-process live there.
// tabUrlCache: ws/tab-url-cache.ts (shared with L2/companion-dispatch).
function bindToolForwardFromServerLocals(): void {
  bindToolForwardRuntime({
    getTabUrlCache,
    refreshTabUrlCache,
    getThreadManager: () => threadManager,
  })
}

// --- MCP tool dispatch (C10-E2: body in mcp/dispatch.ts) ---
// FREEZE: NEW MCP capability-gate / trust_level / meta-tool policy lives in
// mcp/dispatch.ts. Do not re-inflate executeMcpTool / executeMcpMetaTool here.
// Imports + re-exports of executeMcpTool / executeMcpMetaTool / enhanceMcpError /
// bindMcpDispatchRuntime are at the top of this file (with other tool extractions).

function bindMcpDispatchFromServerLocals(): void {
  bindMcpDispatchRuntime({
    getThreadManager: () => threadManager,
    securityConfirmations,
    broadcastToClients,
  })
}

// Eager bind so createToolExecutor companion / MCP / extension-forward paths work
// in integration tests that skip full initServices (re-bound after initServices /
// seedThreadManagerForTests). Getters read live module vars — threadManager may
// still be undefined until seed/init; requireRt runs at call time.
// Placed after broadcastToClients / securityConfirmations / computerTaskAbort so
// references are definitely initialized.
bindCompanionDispatchFromServerLocals()
bindMcpDispatchFromServerLocals()
bindToolForwardFromServerLocals()

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

// setupBroadcastAuthForTests → ws/lifecycle.ts (C10-H2)

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

// --- WS lifecycle bind (C10-H2: body in ws/lifecycle.ts) ---
// FREEZE: startServer / origin gate / healthz / broadcast / grace-period live there.
// server owns services + createToolExecutor; lifecycle owns wss/clients/wsAuth.
function clearMcpSession(ws: WebSocket): void {
  const sessionId = mcpSessionByWs.get(ws)
  if (sessionId) {
    getMcpConfirmCache().clearSession(sessionId)
    mcpSessionByWs.delete(ws)
  }
}

bindWsLifecycle({
  createToolExecutor,
  handleSecurityConfirmationResponse,
  initServices,
  getThreadManager: () => threadManager,
  getSkillEngine: () => skillEngine,
  getHistoryStore: () => historyStore,
  securityConfirmations,
  handleComputerTaskAbort,
  flipAllComputerTaskAborts,
  probeChatModel,
  getMcpSessionId: (ws) => mcpSessionByWs.get(ws),
  clearMcpSession,
  getActiveMcpSessions: () => new Set(Array.from(mcpSessionByWs.values())),
  activeTrayConfirmsByWs,
})
