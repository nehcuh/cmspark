// WebSocket server lifecycle: origin gate, healthz, clients/auth maps, broadcast,
// connection handlers, startServer. Extracted from server.ts (C10 Phase H2) —
// zero intentional behavior change.
//
// FREEZE: NEW WS connection / auth.handshake / healthz / broadcast-auth algebra
// lives HERE. server.ts keeps createToolExecutor + service singletons and binds
// deps via bindWsLifecycle. lifecycle MUST NOT import server.ts.
//
// Module state owned here: wss, clients, wsAuth, outboundRunnerWs.
// mcpSessionByWs / activeTrayConfirmsByWs stay server-owned (createToolExecutor)
// and are injected via WsLifecycleDeps.

import { WebSocketServer, WebSocket } from "ws"
import { randomUUID } from "crypto"
import http from "http"
import {
  getConfig,
  saveConfig,
  configEvents,
  CONFIG_CHANGE_EVENT,
  migrateLegacyModelName,
  getLockFilePath,
  getPidFilePath,
} from "../config"
import { handleMessage, redactMcpServersForBroadcast } from "../message-router"
import { redactConfigForWire } from "../config-redact"
import type { ThreadManager } from "../threads/thread-manager"
import type { SkillEngine } from "../skills/skill-engine"
import type { HistoryStore } from "../history/store"
import type { SecurityConfirmationManager } from "../security-confirmation"
import { getTrayInstance } from "../menu-bar-agent"
import {
  isHudSpikeEnabled,
  runHudSpikeInProcess,
  HUD_SPIKE_THREAD_ID,
  HUD_SPIKE_TASK_ID,
} from "../hud/spike"
import { logger, type LogLevel } from "../logger"
import { applyTabNavigated } from "./tab-url-cache"
import {
  acquireLock,
  releaseLock,
  isProcessRunning,
  readPidFile,
  cleanupPidFile,
  setupGracefulShutdown,
} from "../daemon"
import { getMcpManager, getMcpConfirmCache } from "../mcp"
import { applyHardenedProcessPath } from "../process-path"
import {
  getOrCreateSharedSecret,
  consumeSecretFreshlyGenerated,
  consumeSecretPersistFailed,
  issueChallenge,
  verifyProof,
  markPaired,
  AUTH_TIMEOUT_MS,
} from "../ws-auth"
import { allowInboundLogEvent } from "../log-event-gate"
import { pendingToolCalls, handleToolResult } from "./tool-forward"
import { validateWsMessage } from "./validate"
import { assertSummonerAllowed, applySummonerPayloadPolicy } from "./summoner-acl"
import { broadcastOverlayLeasesOnSocketClose, stampCmsparkSurface } from "./composer-lease"
import { normalizeVisionBaseUrl } from "../llm/vision-pipeline"
import {
  bindExtensionPeerPicker,
  notifyExtensionPeerAuthenticated,
} from "./extension-peer"

export { waitForExtensionPeer } from "./extension-peer"

// ---------------------------------------------------------------------------
// Constants + module state
// ---------------------------------------------------------------------------

const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB
/** Match extension SW refuse so HMAC peers get file.upload_error, not 1009. */
const WS_FRAME_HEADROOM = 256 * 1024
const WS_SOFT_MAX = MAX_WS_MESSAGE_SIZE - WS_FRAME_HEADROOM
/** Cap concurrent unauthenticated sockets during handshake window (pre-auth DoS). */
const MAX_UNAUTHENTICATED_WS = 8
const PORT = 23401
const WS_DISCONNECT_GRACE_MS = 5000

let wss: WebSocketServer
let clients: Set<WebSocket> = new Set()
let outboundRunnerWs: WebSocket | null = null

// P0-2B: per-connection authentication state. A peer is UNauthenticated until it
// completes the ws-auth challenge–response handshake (auth.handshake). Every app
// message is rejected (and the connection terminated) until then, so a local
// process that forged the Origin header still cannot drive the agent without the
// shared secret. See ws-auth.ts and docs for the threat model.
export type WsAuthState = {
  nonce: string
  authenticated: boolean
  timer: NodeJS.Timeout
  origin?: string
  /** Handshake surface. Omitted / non-summoner → tray (not ACL-gated). */
  surface?: "tray" | "summoner"
}

const wsAuth = new WeakMap<WebSocket, WsAuthState>()

/** Accessor for createToolExecutor / L2 admission (server-owned orchestration). */
export function getWsClients(): Set<WebSocket> {
  return clients
}

/** Accessor for createToolExecutor / L2 + URL admission. */
export function getWsAuthState(ws: WebSocket): WsAuthState | undefined {
  return wsAuth.get(ws)
}

// ---------------------------------------------------------------------------
// Runtime bind (server-owned services + createToolExecutor)
// ---------------------------------------------------------------------------

export type ToolExecutorFn = (
  toolCallId: string,
  toolName: string,
  params: any,
  signal?: AbortSignal,
  invokeOpts?: { trustedOutbound?: boolean },
) => Promise<{ success: boolean; data?: any; error?: string }>

export type WsLifecycleDeps = {
  createToolExecutor: (ws: WebSocket) => ToolExecutorFn
  handleSecurityConfirmationResponse: (
    ws: WebSocket,
    msg: any,
    sessionId?: string,
  ) => Promise<void>
  initServices: () => Promise<void>
  getThreadManager: () => ThreadManager
  getSkillEngine: () => SkillEngine
  getHistoryStore: () => HistoryStore
  securityConfirmations: SecurityConfirmationManager
  handleComputerTaskAbort: (
    ws: { readyState: number; send: (data: string) => void },
    msg: { task_id?: unknown },
  ) => { taskId: string; matched: number }
  flipAllComputerTaskAborts: () => number
  probeChatModel: (config: ReturnType<typeof getConfig>) => Promise<void>
  getMcpSessionId: (ws: WebSocket) => string | undefined
  clearMcpSession: (ws: WebSocket) => void
  getActiveMcpSessions: () => Set<string>
  activeTrayConfirmsByWs: WeakMap<WebSocket, Set<string>>
}

let _rt: WsLifecycleDeps | null = null

export function bindWsLifecycle(deps: WsLifecycleDeps): void {
  _rt = deps
}

function requireRt(): WsLifecycleDeps {
  if (!_rt) {
    throw new Error(
      "ws lifecycle not bound — call bindWsLifecycle after createToolExecutor exists",
    )
  }
  return _rt
}

// ---------------------------------------------------------------------------
// Local helpers (message logging; only used by startServer connection handler)
// ---------------------------------------------------------------------------

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"])

function safeLogLevel(level: unknown): LogLevel {
  return typeof level === "string" && LOG_LEVELS.has(level as LogLevel) ? (level as LogLevel) : "info"
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

// ---------------------------------------------------------------------------
// Origin gate / healthz / pick peer / outbound runner
// ---------------------------------------------------------------------------

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
    const { handleOutboundMcpHttp } = await import("../outbound-mcp/companion-http")
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

bindExtensionPeerPicker(pickAuthenticatedClientWs)

/**
 * Ensure outbound HTTP runner is wired to createToolExecutor(extensionWs).
 * Synchronous so invoke never races an empty runner after auth.
 * Extension-only: no extension peer → EXTENSION_UNAVAILABLE (fast fail).
 */
export function ensureOutboundToolRunnerWired(): boolean {
  // Lazy require avoids circular import at module load (companion-http is light).
  const { setOutboundToolRunner } = require("../outbound-mcp/companion-http") as typeof import("../outbound-mcp/companion-http")
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
  const executeTool = requireRt().createToolExecutor(ws)
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

/**
 * Grace-period cleanup applied when a WebSocket connection drops mid-tool-call.
 * Replaces each pending tool's normal timeout timer with a shorter (5s) grace
 * timer that rejects with "WebSocket disconnected" — giving a reconnecting
 * extension a brief window to deliver a late tool.result.
 *
 * Extracted from ws.on("close") in startServer() so integration tests can
 * exercise the cleanup path (audit item 6) without spinning up the full server.
 */
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

/** Origin used when tests seed an authenticated Chrome extension peer. */
export const TEST_EXTENSION_ORIGIN = "chrome-extension://test"

/**
 * Seed wsAuth so createToolExecutor L1 dispatch treats `ws` as an authenticated
 * Chrome extension peer. Tests must not rely on missing-origin fallback
 * (that would re-break tray: missing origin stays BROWSER_UNAVAILABLE).
 */
export function seedExtensionWsAuthForTests(
  ws: WebSocket,
  opts?: { origin?: string; authenticated?: boolean },
): void {
  const prev = wsAuth.get(ws)
  if (prev?.timer) {
    try {
      clearTimeout(prev.timer)
    } catch {
      /* ignore */
    }
  }
  const timer = setTimeout(() => {}, 60_000)
  timer.unref()
  wsAuth.set(ws, {
    nonce: prev?.nonce ?? "test-nonce",
    authenticated: opts?.authenticated !== false,
    timer,
    origin: opts?.origin ?? TEST_EXTENSION_ORIGIN,
  })
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
  for (const client of authenticatedClients) {
    seedExtensionWsAuthForTests(client)
  }
  for (const client of unauthenticatedClients) {
    seedExtensionWsAuthForTests(client, { authenticated: false, origin: "" })
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
    } = await import("../computer/unattended-grant")
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
  void requireRt().probeChatModel(config)

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
    const { setOutboundRunnerRefresh, setOutboundExfilConfirmer } = require("../outbound-mcp/companion-http") as typeof import("../outbound-mcp/companion-http")
    setOutboundRunnerRefresh(() => {
      ensureOutboundToolRunnerWired()
    })
    // First-exfil operator HITL (Task 10): same singleton as L8, injected so
    // companion-http does not import server.ts.
    setOutboundExfilConfirmer({
      securityConfirmations: requireRt().securityConfirmations,
      getClients: getWsClients,
      wsAuthGet: (w) => getWsAuthState(w),
      getOriginatingWs: pickAuthenticatedClientWs,
    })
  } catch (e: any) {
    logger.warn("outbound_mcp.refresh_hook_failed", { error: e?.message || String(e) })
  }

  logger.info("server.start", {
    port,
    model_name: config.llm.model_name,
    base_url: config.llm.base_url,
  })

  // 编程接力 live progress → Side Panel (acp.session.event)
  // + handback auto-inject into thread messages
  try {
    const { ensureAcpBroadcast } = await import("../acp/handlers")
    const { getAcpManager } = await import("../acp/manager")
    ensureAcpBroadcast(broadcastToClients)
    getAcpManager().setTerminalSink(({ session, kind, code }) => {
      try {
        const {
          commitThreadAlias,
          formatAcpProvisionalAlias,
          acpTokenFromMode,
        } = require("../threads/alias-commit") as typeof import("../threads/alias-commit")
        const tm = requireRt().getThreadManager()
        const token = acpTokenFromMode({
          mode: session.mode,
          failed: kind === "failed" || (code != null && code !== 0),
          cancelled: kind === "cancelled",
          partial: session.partial === true,
        })
        const next = formatAcpProvisionalAlias(session.agent_id || "agent", token)
        const committed = commitThreadAlias({
          threadManager: tm,
          threadId: session.thread_id,
          next,
          class: "provisional_acp",
        })
        if (committed.ok) {
          const thread = tm.get(session.thread_id)
          if (thread) broadcastToClients({ type: "thread.updated", thread })
        }
      } catch (err: any) {
        logger.warn("acp.alias_commit_failed", { error: err?.message || String(err) })
      }
    })
    getAcpManager().setHandbackSink(({ session, handback }) => {
      try {
        const { formatHandbackChatMessage } = require("../acp/handback-format") as typeof import("../acp/handback-format")
        const tm = requireRt().getThreadManager()
        const content = formatHandbackChatMessage({
          agentId: session.agent_id,
          mode: session.mode || "review_readonly",
          partial: session.partial,
          handback,
          diffSummary: session.diff_summary || null,
          paths: (session.pending_diffs || []).map((d) => d.relPath).filter(Boolean),
        })
        const msg = tm.addMessage(session.thread_id, {
          thread_id: session.thread_id,
          role: "assistant",
          content,
        })
        broadcastToClients({
          type: "acp.handback.message",
          thread_id: session.thread_id,
          message: msg,
          session_id: session.session_id,
          pending_diffs: (session.pending_diffs || []).map((d) => ({
            path: d.relPath,
            isNew: d.isNew,
            isDelete: d.isDelete,
            // applyable: new files with body, or existing files with parseable hunks
            applyable:
              !d.isDelete &&
              ((d.isNew && d.newContent != null) ||
                (Array.isArray(d.hunks) && d.hunks.length > 0) ||
                d.newContent != null),
          })),
          mode: session.mode,
        })
      } catch (err: any) {
        logger.warn("acp.handback_inject_failed", { error: err?.message || String(err) })
      }
    })
  } catch (e: any) {
    logger.warn("acp.broadcast_hook_failed", { error: e?.message || String(e) })
  }

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
      const visionUrl = normalizeVisionBaseUrl(config.vision.base_url)
      const { throwIfLlmEndpointBlocked } = await import("../security")
      await throwIfLlmEndpointBlocked(visionUrl)
      const OpenAI = (await import("openai")).default
      const visionClient = new OpenAI({
        baseURL: visionUrl,
        apiKey: config.vision.api_key || "ollama",
        timeout: 5000,
        maxRetries: 0,
      })
      await visionClient.models.list()
      console.log(`[cmspark-agent] Vision model: ${config.vision.model_name} @ ${visionUrl}`)
    } catch (e: any) {
      console.warn(`[cmspark-agent] Vision model unavailable: ${e.message}`)
      console.warn(`[cmspark-agent] Screenshot analysis will use fallback: ${config.vision.fallback}`)
    }
  }

  // Pre-initialize services (async: loads SQLite WASM)
  await requireRt().initServices()

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
              securityConfirmations: requireRt().securityConfirmations,
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
    // exactly once via `await requireRt().initServices()` at boot (line ~835) before the WS
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

    const executeTool = requireRt().createToolExecutor(ws)

    // WP4: 每连接面板标识——computer.evidence.open 的 P6 频率上限按它计数。
    const panelId = randomUUID()
    // P0 CORR-02: stamp for close-time LLM abort of this peer's loops
    ;(ws as any).__cmsparkPanelId = panelId

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
        if (rawLen > WS_SOFT_MAX) {
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
        // #239: tray reports overlay spawn failure. "error" is a response type,
        // not a request — relay before validateWsMessage so Side Panel toasts.
        if (
          msg?.type === "error" &&
          typeof msg.error_code === "string" &&
          msg.error_code.startsWith("OVERLAY_SHELL_")
        ) {
          const auth = wsAuth.get(ws)
          if (auth?.surface === "tray") {
            broadcastToClients({
              type: "error",
              error_code: msg.error_code,
              error: typeof msg.error === "string" && msg.error ? msg.error : "无法弹出对话框",
            })
          }
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
            const { negotiateProtocolVersion, authOkProtocolFields } = require("../protocol") as typeof import("../protocol")
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
            const rawSurface = (msg as { surface?: unknown }).surface
            st.surface = rawSurface === "summoner" ? "summoner" : "tray"
            clearTimeout(st.timer)
            logger.info("ws.authenticated", { protocol_version: nego.negotiated, surface: st.surface })
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
            // PR-B Task 8: wake waitForExtensionPeer on extension auth.ok only.
            // pickAuthenticatedClientWs already requires chrome-extension:// +
            // authenticated; notify no-ops if pick() would still fail.
            if (/^chrome-extension:\/\//i.test(st.origin || "")) {
              notifyExtensionPeerAuthenticated(ws)
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
        // S21: per-connection ACL keyed off handshake surface. Do not origin-cleave
        // (tray skill.list must keep working). auth.handshake already returned above.
        const gate = assertSummonerAllowed(authState.surface, msg.type)
        if (!gate.ok) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: gate.error, error_code: gate.error_code }))
          }
          return
        }
        const payloadGate = applySummonerPayloadPolicy(authState.surface, msg)
        if (!payloadGate.ok) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: payloadGate.error, error_code: payloadGate.error_code }))
          }
          return
        }
        // S20: overwrite always after ACL. Never trust a client-supplied field.
        stampCmsparkSurface(msg, authState.surface)
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
          const sid = requireRt().getMcpSessionId(ws)
          await requireRt().handleSecurityConfirmationResponse(ws, msg, sid)
          return
        }

        // WP2 (§E.6): panel emergency stop for a RUNNING computer task.
        // task_id targets one run (the id is broadcast in the task events);
        // "*" is the panic button — aborts every running task. Stopping
        // injection is always the safe direction, so any authenticated panel
        // connection may send this (no origin binding). F1: the semantics live
        // in handleComputerTaskAbort (exported, tested at the socket seam).
        if (msg.type === "computer.task.abort") {
          requireRt().handleComputerTaskAbort(ws, msg)
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
          requireRt().flipAllComputerTaskAborts()
          try {
            const { abortShellRunsForThread } = await import("../capability/shell")
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
            const { abortShellRunById, abortShellRunsForThread } = await import("../capability/shell")
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
          const decision = await requireRt().securityConfirmations.request(
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
          void requireRt().securityConfirmations.request(
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
          const ok = requireRt().securityConfirmations.respond(id, approved)
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
            { threadManager: requireRt().getThreadManager(), skillEngine: requireRt().getSkillEngine(), historyStore: requireRt().getHistoryStore() },
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
                requireRt().securityConfirmations.request(
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
              surface: wsAuth.get(ws)?.surface,
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
      // #219: tray Swift overlay and C-thin web shell can both be online as
      // surface=summoner. clients/wsAuth already dropped this socket above, so
      // count the REMAINING authenticated summoners and only drop overlay
      // holds when the last one dies.
      let survivingSummoners = 0
      if (closedAuth?.surface === "summoner") {
        for (const client of clients) {
          const auth = wsAuth.get(client)
          if (auth?.authenticated === true && auth.surface === "summoner") {
            survivingSummoners += 1
          }
        }
      }
      broadcastOverlayLeasesOnSocketClose(
        closedAuth?.surface,
        (msg) => broadcastToClients(msg),
        undefined,
        survivingSummoners,
      )
      // P0 CORR-02: abort in-flight LLM/tool loops owned by this panel
      try {
        const panelId = (ws as any).__cmsparkPanelId as string | undefined
        if (panelId) {
          const { abortLlmLoopsForPanel } = require("../message-router") as typeof import("../message-router")
          const n = abortLlmLoopsForPanel(panelId)
          if (n > 0) {
            logger.info("ws.close_aborted_llm", { panelId, count: n })
          }
        }
      } catch {
        /* best-effort — avoid circular init issues */
      }
      // Rebind or clear outbound MCP runner if this was the dispatch peer
      try {
        ensureOutboundToolRunnerWired()
      } catch {
        /* best-effort */
      }
      applyConnectionCloseGracePeriod(ws)
      requireRt().securityConfirmations.rejectAll("disconnect", ws)
      // C-P0-6: cancel tray dialogs racing THIS socket only. Overlay close
      // still rejectAll(overlay) + cancelConfirm ids on the overlay key
      // (empty after Task 7 — tray map is keyed by trayOwnerWs, never overlay).
      // Do NOT cancelConfirm the extension peer's set; operator confirms live.
      // cancelConfirm is a no-op if the id isn't pending (race already resolved).
      const tray = getTrayInstance()
      if (tray) {
        const activeIds = requireRt().activeTrayConfirmsByWs.get(ws)
        if (activeIds) {
          for (const id of activeIds) {
            tray.cancelConfirm(id)
          }
          activeIds.clear()
          requireRt().activeTrayConfirmsByWs.delete(ws)
        }
      }
      // Audit item 8: clear the per-session MCP confirm-cache so approvals
      // don't leak across reconnects (memory + a stale "approved" entry could
      // wrongly auto-approve a tool call from whatever reconnects next).
      requireRt().clearMcpSession(ws)
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
    const active = requireRt().getActiveMcpSessions()
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
      requireRt().getHistoryStore()?.close()
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
