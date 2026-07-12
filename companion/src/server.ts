// Companion server — WebSocket server, message routing, tool execution bridge

import { WebSocketServer, WebSocket } from "ws"
import { execFile } from "child_process"
import { randomUUID } from "crypto"
import os from "os"
import { URL } from "url"
import { getConfig, saveConfig, initDataDir, configEvents, CONFIG_CHANGE_EVENT, migrateLegacyModelName } from "./config"
import { handleMessage } from "./message-router"
import { ThreadManager } from "./threads/thread-manager"
import { SkillEngine } from "./skills/skill-engine"
import { HistoryStore } from "./history/store"
import { checkHighRiskExecution, highRiskExecutionDeniedError, isTrustedDomain, isAutoApprovedDomain, isCloudMetadataIp, isPrivateOrLoopbackIp, detectCriticalApis, classifyMcpCall, CRITICAL_MCP_CAPABILITIES, CRITICAL_MCP_META_TOOLS } from "./security"
import { SecurityConfirmationManager } from "./security-confirmation"
import { securityPolicy, getTokenSecret } from "./security-policy"
import { logger, type LogLevel } from "./logger"
import { acquireLock, releaseLock, isProcessRunning, readPidFile, cleanupPidFile } from "./daemon"
import { getLockFilePath, getPidFilePath } from "./config"
import { getMcpManager, getMcpConfirmCache, isMcpNamespaced } from "./mcp"
import {
  getOrCreateSharedSecret,
  consumeSecretFreshlyGenerated,
  consumeSecretPersistFailed,
  issueChallenge,
  verifyProof,
  AUTH_TIMEOUT_MS,
} from "./ws-auth"

const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB

const PORT = 23401
// Exported for integration tests (audit item 6). Production reads the const directly.
export const TOOL_EXECUTION_TIMEOUT_MS = 15000

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
  return typeof origin === "string" && /^chrome-extension:\/\/[A-Za-z0-9_-]+$/i.test(origin)
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

// P0-2B: per-connection authentication state. A peer is UNauthenticated until it
// completes the ws-auth challenge–response handshake (auth.handshake). Every app
// message is rejected (and the connection terminated) until then, so a local
// process that forged the Origin header still cannot drive the agent without the
// shared secret. See ws-auth.ts and server.ts:1418-1420 for the threat model.
const wsAuth = new WeakMap<WebSocket, { nonce: string; authenticated: boolean; timer: NodeJS.Timeout }>()

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
}>()

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
}

// Exported for integration tests (audit item 6).
export function createToolExecutor(ws: WebSocket) {
  // Per-connection session id — used as the key for MCP first-use confirmation cache
  // so approvals don't bleed across browser sessions.
  const sessionId = randomUUID()
  // Audit item 8: register the (ws, sessionId) pair so ws.on("close") can clean
  // up the per-session MCP confirm-cache. Without this, stale approvals leak.
  mcpSessionByWs.set(ws, sessionId)
  return async (toolCallId: string, toolName: string, params: any, signal?: AbortSignal): Promise<{ success: boolean; data?: any; error?: string }> => {
    let finalParams = params || {}
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
    // Notify extension: tool execution started (show in sidebar)
    ws.send(JSON.stringify({
      type: "tool.start",
      tool_call_id: toolCallId,
      tool_name: toolName,
      params: summarizeToolParams(finalParams),
    }))
    logger.info("tool.start", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      params: summarizeToolParams(finalParams),
    })

    // Security Pre-flight Checks (P0 - Cookie Trust Domains Gate)
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

      if (!isSafe) {
        const result = {
          success: false,
          error: `Security Block: Access to cookie for domain "${targetDomain || "unknown"}" is blocked. This domain is not in the trusted_domains list. Please configure trusted domains in settings.`,
        }
        logger.warn("security.cookie_blocked", { tool_call_id: toolCallId, tool_name: toolName, target_domain: targetDomain || "unknown" })
        logToolFinish(toolCallId, toolName, startedAt, result)
        return result
      }
    }

    if ((toolName === "evaluate" || toolName === "osascript_eval") && !finalParams.security_token) {
      const code = String(finalParams.code || finalParams.expression || "")
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
      const securityConfig = getConfig().security
      // skipL2 = auto_approve_dangerous || allow_all_schemes || (domain whitelist).
      // allow_all_schemes (GOD-MODE) bypasses Layer 2 too — see config.ts SecurityConfig.
      const skipConfirmation = securityConfig.auto_approve_dangerous === true
        || securityConfig.allow_all_schemes === true
        || (relevantDomain !== "" && isAutoApprovedDomain(relevantDomain))
      // §6.2 CRITICAL_API_GATE: detectCriticalApis() is the never-auto-approved
      // subset of detectDangerousApis() (exfil + sandbox-escape + obfuscation
      // variants). Even when skipConfirmation is true (god-mode / global toggle
      // / domain whitelist), a non-empty critical set forces interactive
      // confirmation — god-mode bypasses the UI prompt, not this capability
      // boundary (mirror of §6.1.5). Without this, a fetch/exfil payload would
      // execute zero-confirmation under god-mode.
      const criticalApis = detectCriticalApis(code)
      const forceConfirm = criticalApis.length > 0

      if (!skipConfirmation || forceConfirm) {
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
        const decision = await securityConfirmations.request(
          (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(data))
            }
          },
          {
            toolName,
            dangerousApis: safety.dangerousApis,
            code,
            relevantDomains: relevantDomain ? [relevantDomain] : [],
            criticalApis,
            ...(forceConfirm ? { riskLevel: "high" as const, autoConfirmEligible: false } : {}),
          },
        )
        if (!decision.approved) {
          const reason = decision.reason === "approved" ? "unavailable" : decision.reason
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
        logger.info("security.confirmation.approved", { tool_call_id: toolCallId, tool_name: toolName })
        if (forceConfirm) {
          logger.info("security.critical_capability_confirmed", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            critical_apis: criticalApis,
            god_mode_active: securityConfig.allow_all_schemes === true,
            auto_approve_active: securityConfig.auto_approve_dangerous === true,
            relevant_domain: relevantDomain,
          })
        }
      } else {
        logger.info("security.auto_approved", {
          tool_call_id: toolCallId,
          tool_name: toolName,
          domain: relevantDomain || "unknown",
          reason: securityConfig.allow_all_schemes ? "god_mode"
            : securityConfig.auto_approve_dangerous ? "global_toggle" : "domain_whitelist",
        })
      }
      // Issue a fresh token (post-approval or for auto-approved skip path)
      const approvedToken = securityPolicy.issueToken(toolName, code)
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
        })
        const decision = await securityConfirmations.request(
          (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(data))
            }
          },
          {
            toolName,
            dangerousApis: [],
            code: `navigate(${rawUrl})`,
            relevantDomains: [host],
          },
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
    const COMPANION_TOOLS = ["osascript_eval", "use_skill", "record_experience"]
    if (COMPANION_TOOLS.includes(toolName)) {
      try {
        const result = await executeCompanionTool(toolName, finalParams)
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
        }
        logToolFinish(toolCallId, toolName, startedAt, result)
        resolve(result)
      }
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: `Tool execution timeout (${TOOL_EXECUTION_TIMEOUT_MS}ms): ${toolName}` }
        logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: TOOL_EXECUTION_TIMEOUT_MS })
        finishAndResolve(result)
      }, TOOL_EXECUTION_TIMEOUT_MS)

      pendingToolCalls.set(toolCallId, { resolve: finishAndResolve, reject, timer })

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
export async function handleSecurityConfirmationResponse(ws: WebSocket, msg: any): Promise<void> {
  const confirmationId = String(msg.confirmation_id || "")
  const approved = msg.approved === true

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

  // Resolve the confirmation FIRST so a saveConfig failure cannot hang the
  // approved tool call. Persistence runs after, best-effort. By the time the
  // LLM's next tool call reaches the whitelist gate (next macrotask),
  // fs.writeFileSync has completed.
  const responded = securityConfirmations.respondFrom(confirmationId, approved, ws)
  if (!responded) {
    // Either no such pending entry, or the response arrived on a different
    // socket than the one the confirmation was issued to. [C-SEC-2]: do not
    // silently drop — log so operators can spot the pattern (e.g., a rogue
    // local process trying to self-approve).
    logger.warn("security.confirmation.origin_mismatch_or_unknown", {
      confirmation_id: confirmationId,
      approved_requested: approved,
    })
  }

  // Only persist whitelist additions when the confirmation was actually
  // resolved by THIS response. If respondFrom returned false (origin mismatch,
  // unknown id, or already-expired entry), the response is not authoritative —
  // accepting its add_to_whitelist payload would let any loopback WS peer that
  // can guess a confirmation_id poison auto_approved_domains without ever
  // resolving the prompt.
  if (responded && approved && validPatterns.length > 0) {
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

async function executeCompanionTool(toolName: string, params: any): Promise<any> {
  switch (toolName) {
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
      const { url: pageUrl, expression: jsExpr } = params
      if (!pageUrl || !jsExpr) {
        return { success: false, error: "url and expression required" }
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
      if (os.platform() !== "darwin") {
        return { success: false, error: "osascript_eval is macOS-only. Use get_page_text with tabId instead (cross-platform)." }
      }
      // Use execFile with -e arguments and argv passing to avoid string injection (P0).
      // CAPABILITY INVARIANT (§6.2): this template ONLY runs `execute t javascript
      // jsExpr` — it executes the supplied JS inside a Chrome tab, NOT arbitrary
      // host AppleScript. NEVER introduce `do shell script` / `tell application
      // "Finder"` / keychain access here: doing so would widen the capability
      // boundary that §6.2's CRITICAL_API_GATE and the L2 confirmation gate assume.
      // `pageUrl` and `jsExpr` are passed as argv (after `--`), never interpolated.
      const { promisify } = await import("util")
      const execFileAsync = promisify(execFile)
      try {
        const result = await execFileAsync("osascript", [
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
    default:
      return { success: false, error: `Unknown companion tool: ${toolName}` }
  }
}

// --- MCP tool executors ---

/**
 * Execute an MCP namespaced tool (mcp__<server>__<tool>). Enforces the per-server
 * trust_level policy: manual = always prompt, first-use = prompt once per session,
 * trusted = never prompt. Approval cache is session-scoped to avoid cross-session bleed.
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
  const mcpCaps = classifyMcpCall(route.toolName, params)
  const forceMcpConfirm = mcpCaps.some(c => CRITICAL_MCP_CAPABILITIES.has(c))

  if (needsConfirm || forceMcpConfirm) {
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
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      if (forceMcpConfirm) {
        logger.warn("security.mcp_critical_denied", {
          server: route.serverName,
          tool: route.toolName,
          capabilities: mcpCaps,
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
  try {
    const result = await manager.callTool(route, params || {}, signal)
    const durationMs = Date.now() - callStartedAt
    broadcastToClients({
      type: "mcp.tool_call_finished",
      serverName: route.serverName,
      toolName: route.toolName,
      namespacedName: toolName,
      durationMs,
      success: !result?.isError,
    })
    if (result?.isError) {
      const errMsg = extractMcpError(result)
      return { success: false, error: `MCP ${route.serverName}/${route.toolName} returned error: ${errMsg}` }
    }
    return { success: true, data: result?.content ?? result }
  } catch (err: any) {
    // Audit item 18: surface actionable hints so the LLM can self-correct
    // instead of blindly retrying with identical args. Also emit the
    // tool_call_finished notification with success:false so the UI flags the
    // failed call (previously only the success path emitted it).
    const durationMs = Date.now() - callStartedAt
    broadcastToClients({
      type: "mcp.tool_call_finished",
      serverName: route.serverName,
      toolName: route.toolName,
      namespacedName: toolName,
      durationMs,
      success: false,
      error: err?.message || String(err),
    })
    const rawErr = err?.message || String(err)
    return { success: false, error: enhanceMcpError(rawErr, route, params) }
  }
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

  if (needsConfirm) {
    if (ws.readyState !== WebSocket.OPEN) {
      return {
        success: false,
        error: `Security Block: MCP meta-tool ${toolName} (${serverName}) cannot be confirmed (extension disconnected)`,
      }
    }
    const securityConfig = getConfig().security
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

/** Broadcast a message to all connected WebSocket clients (used for MCP status updates). */
function broadcastToClients(data: any): void {
  if (!wss) return
  const message = JSON.stringify(data)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message)
      } catch {
        // ignore send failures (client disconnect)
      }
    }
  }
}

// --- WS message validation ---

interface WsValidationResult {
  valid: boolean
  error?: string
}

function validateWsMessage(msg: any): WsValidationResult {
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

export async function startServer() {
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

  wss = new WebSocketServer({
    port,
    host: "127.0.0.1",
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

  wss.on("listening", () => {
    console.log(`[cmspark-agent] Companion started on ws://127.0.0.1:${port}`)
    logger.info("server.listening", { port })
  })

  // Broadcast config changes to all connected WebSocket clients + apply MCP diff
  configEvents.on(CONFIG_CHANGE_EVENT, async (updatedConfig: any) => {
    const message = JSON.stringify({
      type: "config.updated",
      config: {
        ...updatedConfig,
        llm: { ...updatedConfig.llm, api_key: "***" },
        vision: updatedConfig.vision
          ? { ...updatedConfig.vision, api_key: updatedConfig.vision.api_key ? "***" : "" }
          : undefined,
      },
      source: "companion",
    })
    for (const client of clients) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message)
        }
      } catch { /* ignore disconnected */ }
    }

    // Apply MCP diff (start/stop/restart servers based on what changed)
    try {
      await mcpManager.applyConfig(updatedConfig.mcp)
    } catch (err: any) {
      logger.warn("mcp.apply_config_failed", { error: err?.message || String(err) })
    }
  })

  wss.on("connection", (ws) => {
    // Note: services (threadManager / skillEngine / historyStore) are initialized
    // exactly once via `await initServices()` at boot (line ~835) before the WS
    // server starts listening. A previous version re-ran initServices() here on
    // first connection — that was a no-op duplicate at best, and a real race at
    // worst (replacing the module-level historyStore with a fresh instance whose
    // this.db was still null, silently dropping records during the init window).
    // Removed in audit item 14.
    clients.add(ws)
    console.log(`[cmspark-agent] Client connected (${clients.size} total)`)
    logger.info("ws.client_connected", { clients: clients.size })

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
    wsAuth.set(ws, { nonce: challengeNonce, authenticated: false, timer: authTimer })
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "auth.challenge", nonce: challengeNonce }))
    }

    const executeTool = createToolExecutor(ws)

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
          logger.warn("ws.message_too_large", { size: rawLen, max: MAX_WS_MESSAGE_SIZE })
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: "Message too large" }))
          }
          return
        }
        msg = JSON.parse(raw.toString())
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
          logger.warn("ws.invalid_message", { error: validation.error, msg_type: typeof msg })
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: `Invalid message: ${validation.error}` }))
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
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "auth.ok" }))
              ws.send(JSON.stringify({ type: "connected" }))
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
          await handleSecurityConfirmationResponse(ws, msg)
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
          const eventName = typeof msg.event === "string" && msg.event ? msg.event : "extension.event"
          const source = typeof msg.source === "string" && msg.source ? msg.source : "extension"
          logger.log(safeLogLevel(msg.level), eventName, msg.data && typeof msg.data === "object" ? msg.data : {}, source)
          // Forward to sidepanel for live log display
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg))
          }
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
            broadcast: (data: any) => {
              const message = JSON.stringify(data)
              for (const client of clients) {
                try {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(message)
                  }
                } catch { /* ignore disconnected */ }
              }
            },
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
      applyConnectionCloseGracePeriod()
      securityConfirmations.rejectAll("disconnect", ws)
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
  const shutdown = (signal: string) => {
    console.log(`\n[cmspark-agent] Shutting down (${signal})...`)
    logger.info("server.shutdown", { signal })
    // Stop MCP servers first (terminates child processes) before closing WS
    mcpManager.shutdown().catch((err) => {
      logger.warn("mcp.shutdown_failed", { error: err?.message || String(err) })
    }).finally(() => {
      // P0-1 (audit C2): flush history.db before exiting. Previously close() was never
      // called on shutdown, so every normal SIGTERM/SIGINT lost the session's audit records.
      try { historyStore?.close() } catch (err: any) {
        logger.warn("history.close_failed", { error: err?.message || String(err) })
      }
      wss.close()
      releaseLock(getLockFilePath())
      process.exit(0)
    })
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}
