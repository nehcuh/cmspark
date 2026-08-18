// CMspark Browser Agent — Background Service Worker
// WebSocket client, CDP manager, tab manager, cookie ops

import { WSClient } from "./ws-client"
import { BrowserBridge } from "./browser-bridge"
import { KeepAlive } from "./keep-alive"
import { PageSanitizer, pageSanitizer } from "./page-sanitizer"
import { buildSecurityConfirmationWsPayload } from "./security-confirmation-payload"
import { handleNotebooklmExport } from "./notebooklm-handler"
import { cancelBatch, getActiveBatch, resumeIfPending, startBatch } from "./notebooklm-import-orchestrator"
import { createNotebook, listNotebooks } from "../notebooklm/notebook-api"
import { createNotebookViaRpc } from "../notebooklm/rpc-client"
import { suggestNotebookName } from "../notebooklm/notebook-name-suggester"
import { extractAiChatRunner } from "../notebooklm/ai-chat-extractor"
import { extractPageLinksRunner } from "../notebooklm/page-link-extractor"
import { discoverFeed, fetchFeed, fetchMultipleFeeds, parseOpml } from "../notebooklm/rss-parser"
import { fetchPlaylist, getYouTubeApiKey, parsePlaylistId, setYouTubeApiKey } from "../notebooklm/youtube-api"
import {
  closeCockpit,
  cockpitStatus,
  focusCockpit,
  openOrFocusCockpit,
} from "./cockpit-window"
import {
  openOrFocusThreadGraph,
  prepareThreadGraphSnapshot,
  readThreadGraphSnapshot,
  type ThreadGraphSlim,
} from "./thread-graph"
import {
  getHydrateSnapshot,
  noteComputerTaskEvent,
  noteSecurityConfirmationGone,
  noteSecurityConfirmationRequest,
} from "./computer-task-mirror"
import { getActiveTabHostname } from "./active-tab-hostname"
import {
  buildLogEventPayload,
  forwardFailureConsoleLevel,
  shouldReportForwardFailureToCompanion,
} from "./log-forward-policy"
import { shouldRefuseWsFrame } from "./ws-frame-budget"

let wsClient: WSClient
let browserBridge: BrowserBridge
let keepAlive: KeepAlive
type LogLevel = "debug" | "info" | "warn" | "error"

// Extension's cached copy of the companion global config.
// Kept in sync via config.set (extension-initiated) and config.updated (companion broadcast).
/**
 * Non-secret LLM/UI prefs mirrored for SW restarts.
 * P2 residual ARCH-02: NEVER store api_key / vision_api_key here — Companion
 * config.json is the sole secret SoT (A1 topology).
 */
interface ExtensionConfig {
  base_url: string
  model_name: string
  temperature?: number
  context_window?: number
  vision_enabled?: boolean
  vision_base_url?: string
  vision_model_name?: string
  vision_timeout_ms?: number
  vision_fallback?: string
}
let extensionConfig: ExtensionConfig | null = null

/** Strip secrets from a stored blob (migration for pre-ARCH-02 installs). */
function stripSecretsFromExtensionConfig(raw: Record<string, unknown> | null | undefined): ExtensionConfig {
  const src = raw || {}
  return {
    base_url: typeof src.base_url === "string" ? src.base_url : "",
    model_name: typeof src.model_name === "string" ? src.model_name : "",
    temperature: typeof src.temperature === "number" ? src.temperature : undefined,
    context_window: typeof src.context_window === "number" ? src.context_window : undefined,
    vision_enabled: typeof src.vision_enabled === "boolean" ? src.vision_enabled : undefined,
    vision_base_url: typeof src.vision_base_url === "string" ? src.vision_base_url : undefined,
    vision_model_name: typeof src.vision_model_name === "string" ? src.vision_model_name : undefined,
    vision_timeout_ms: typeof src.vision_timeout_ms === "number" ? src.vision_timeout_ms : undefined,
    vision_fallback: typeof src.vision_fallback === "string" ? src.vision_fallback : undefined,
  }
}

function loadExtensionConfig() {
  chrome.storage.local.get(["extensionConfig", "extensionLLMConfig"], (result) => {
    if (result.extensionConfig) {
      const stripped = stripSecretsFromExtensionConfig(result.extensionConfig as Record<string, unknown>)
      extensionConfig = stripped
      // Rewrite storage without secrets if old blob still had keys
      const hadSecrets =
        !!(result.extensionConfig as any)?.api_key || !!(result.extensionConfig as any)?.vision_api_key
      if (hadSecrets) {
        chrome.storage.local.set({ extensionConfig: stripped })
      }
    } else if (result.extensionLLMConfig) {
      // Migrate legacy extensionLLMConfig — drop api_key deliberately
      const legacy = result.extensionLLMConfig as any
      extensionConfig = stripSecretsFromExtensionConfig({
        base_url: legacy.base_url || "",
        model_name: legacy.model_name || "",
        temperature: legacy.temperature,
        context_window: legacy.context_window,
      })
      chrome.storage.local.set({ extensionConfig })
      chrome.storage.local.remove("extensionLLMConfig")
    }
  })
}

/**
 * Persist non-secret prefs only. Companion remains sole holder of api keys
 * (config.set / config.updated never write secrets into chrome.storage).
 */
function saveExtensionConfig(cfg: Record<string, unknown>) {
  // Support both flat (legacy settings.set) and nested (config.set) formats
  const llm = (cfg.llm as Record<string, unknown> | undefined) ?? cfg
  const vision = cfg.vision as Record<string, unknown> | undefined

  const next: ExtensionConfig = {
    base_url: String(llm.base_url ?? extensionConfig?.base_url ?? ""),
    model_name: String(llm.model_name ?? extensionConfig?.model_name ?? ""),
    temperature: llm.temperature !== undefined ? Number(llm.temperature) : extensionConfig?.temperature,
    context_window: llm.context_window !== undefined ? Number(llm.context_window) : extensionConfig?.context_window,
  }

  // Vision non-secret fields only
  if (cfg.vision_enabled !== undefined) {
    next.vision_enabled = !!cfg.vision_enabled
  } else if (vision?.enabled !== undefined) {
    next.vision_enabled = !!vision.enabled
  } else if (extensionConfig?.vision_enabled !== undefined) {
    next.vision_enabled = extensionConfig.vision_enabled
  }

  if (cfg.vision_base_url !== undefined) {
    next.vision_base_url = cfg.vision_base_url as string
  } else if (vision?.base_url !== undefined) {
    next.vision_base_url = vision.base_url as string
  } else if (extensionConfig?.vision_base_url !== undefined) {
    next.vision_base_url = extensionConfig.vision_base_url
  }

  if (cfg.vision_model_name !== undefined) {
    next.vision_model_name = cfg.vision_model_name as string
  } else if (vision?.model_name !== undefined) {
    next.vision_model_name = vision.model_name as string
  } else if (extensionConfig?.vision_model_name !== undefined) {
    next.vision_model_name = extensionConfig.vision_model_name
  }

  if (cfg.vision_timeout_ms !== undefined) {
    next.vision_timeout_ms = Number(cfg.vision_timeout_ms)
  } else if (vision?.timeout_ms !== undefined) {
    next.vision_timeout_ms = Number(vision.timeout_ms)
  } else if (extensionConfig?.vision_timeout_ms !== undefined) {
    next.vision_timeout_ms = extensionConfig.vision_timeout_ms
  }

  if (cfg.vision_fallback !== undefined) {
    next.vision_fallback = cfg.vision_fallback as string
  } else if (vision?.fallback !== undefined) {
    next.vision_fallback = vision.fallback as string
  } else if (extensionConfig?.vision_fallback !== undefined) {
    next.vision_fallback = extensionConfig.vision_fallback
  }

  // Explicit: never persist api_key / vision_api_key even if present on wire
  extensionConfig = next
  chrome.storage.local.set({ extensionConfig: next })
}

const NOTIFICATION_ID = "cmspark-companion-disconnected"
const DISCONNECT_DEBOUNCE_MS = 3000
let disconnectNotificationTimer: ReturnType<typeof setTimeout> | null = null
let lastNotifiedState: "connected" | "disconnected" | null = null
/** Once-per-session warn for sidepanel_forward_failed (then console.debug). */
let sidepanelForwardFailedWarned = false

function logToCompanion(level: LogLevel, event: string, data: Record<string, unknown> = {}) {
  try {
    const payload = buildLogEventPayload(level, event, data)
    // Local fan-out so Side Panel / Cockpit live log works WITHOUT companion
    // echo-to-sender (echo was half of the log.event tight loop — dual-review
    // log-event-echo-loop-rca). Best-effort; no receivers is fine.
    try {
      chrome.runtime.sendMessage(payload).catch(() => {})
    } catch {
      /* no UI listeners */
    }
    if (wsClient?.getState() === "connected") {
      wsClient.send(payload)
    }
  } catch {
    // Logging must never affect extension behavior.
  }
}

function showDisconnectedNotification() {
  if (lastNotifiedState === "disconnected") return
  lastNotifiedState = "disconnected"

  try {
    chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: "CMspark Agent 未运行",
      message: "Companion 守护进程未启动，请点击菜单栏图标启动",
      priority: 1,
    })
  } catch {
    // Notifications may fail in some contexts; ignore gracefully.
  }
}

function clearDisconnectedNotification() {
  if (lastNotifiedState === "connected") return
  lastNotifiedState = "connected"

  try {
    chrome.notifications.clear(NOTIFICATION_ID)
  } catch {
    // Ignore clear failures.
  }
}

function scheduleDisconnectNotification() {
  if (disconnectNotificationTimer) return
  disconnectNotificationTimer = setTimeout(() => {
    disconnectNotificationTimer = null
    if (wsClient?.getState() === "disconnected") {
      showDisconnectedNotification()
    }
  }, DISCONNECT_DEBOUNCE_MS)
}

function cancelDisconnectNotification() {
  if (disconnectNotificationTimer) {
    clearTimeout(disconnectNotificationTimer)
    disconnectNotificationTimer = null
  }
}

function init() {
  loadExtensionConfig()
  browserBridge = new BrowserBridge(pageSanitizer)
  keepAlive = new KeepAlive()

  wsClient = new WSClient({
    url: "ws://127.0.0.1:23401",
    onMessage: handleCompanionMessage,
    onStateChange: handleStateChange,
  })

  wsClient.connect()
  keepAlive.start(() => wsClient.checkAndReconnect())
  setupMessageHandlers()

  // Long-lived ports keep the service worker alive while UI surfaces are open
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "cmspark-sidepanel") {
      logToCompanion("info", "extension.sidepanel_port_connected", {})
      port.onDisconnect.addListener(() => {
        logToCompanion("info", "extension.sidepanel_port_disconnected", {})
      })
      return
    }
    if (port.name === "cmspark-cockpit") {
      logToCompanion("info", "extension.cockpit_port_connected", {})
      port.onDisconnect.addListener(() => {
        logToCompanion("info", "extension.cockpit_port_disconnected", {})
      })
    }
  })
}

function handleStateChange(state: "connected" | "connecting" | "disconnected") {
  updateBadge(state)

  if (state === "disconnected") {
    scheduleDisconnectNotification()
  } else if (state === "connected") {
    cancelDisconnectNotification()
    clearDisconnectedNotification()
    // Fetch global config from companion on connect
    wsClient.send({ type: "config.get" })
  }
}

// --- Badge ---

function updateBadge(state: "connected" | "connecting" | "disconnected") {
  const config = {
    connected: { text: "ON", color: "#4CAF50" },
    connecting: { text: "...", color: "#FFC107" },
    disconnected: { text: "OFF", color: "#F44336" },
  }
  const c = config[state]
  chrome.action.setBadgeText({ text: c.text })
  chrome.action.setBadgeBackgroundColor({ color: c.color })
  logToCompanion(state === "disconnected" ? "warn" : "info", "extension.ws_state_changed", { state })
}

// --- Companion message routing ---

/** P2: pending companion llm.oneshot RPC (id → resolve) */
const pendingLlmOneshot = new Map<
  string,
  (r: { ok: boolean; text?: string; error?: string }) => void
>()

async function handleCompanionMessage(msg: any) {
  // P2 ARCH-01: oneshot LLM results for NotebookLM name suggest
  if (msg.type === "llm.oneshot_result" && typeof msg.id === "string") {
    const resolve = pendingLlmOneshot.get(msg.id)
    if (resolve) {
      pendingLlmOneshot.delete(msg.id)
      resolve({
        ok: msg.ok === true,
        text: typeof msg.text === "string" ? msg.text : undefined,
        error: typeof msg.error === "string" ? msg.error : undefined,
      })
    }
    return
  }

  // Forward quick action trigger to side panel
  if (msg.type === "quickAction.start") {
    chrome.runtime.sendMessage(msg).then(() => {
      // Sidepanel received the message — it will handle chat creation
    }).catch(() => {
      // Sidepanel not open — start chat directly from background so the
      // quick action still works even when the sidepanel is closed.
      const { thread_id, prompt } = msg
      if (thread_id && prompt) {
        // Quick action with sidepanel closed: still pass active-tab hostname for site knowledge.
        getActiveTabHostname().then((hostname) => {
          wsClient.send({
            type: "chat.create",
            thread_id,
            message: prompt,
            ...(hostname ? { hostname } : {}),
          })
        }).catch(() => {
          wsClient.send({
            type: "chat.create",
            thread_id,
            message: prompt,
          })
        })
      }
      logToCompanion("debug", "extension.quickaction_fallback_to_background", { actionId: msg.actionId })
    })
    return
  }

  // Keep our local cache in sync with the companion's global config.
  // The companion is the single source of truth; both tray settings and
  // extension settings feed into the same config.json.
  if (msg.type === "config.updated") {
    saveExtensionConfig(msg.config || {})
  }

  if (msg.type === "security.config") {
    // No-op: extension no longer performs HMAC token validation.
    // Companion-side confirmation is the sole authority; extension does not gate evaluate.
    return
  }

  if (msg.type === "tool.execute") {
    const toolMeta = {
      tool_call_id: msg.tool_call_id,
      tool_name: msg.tool_name,
    }
    logToCompanion("info", "extension.tool.start", toolMeta)
    try {
      const result = await browserBridge.execute(msg.tool_name, msg.params)
      logToCompanion(result?.success === true ? "info" : "warn", "extension.tool.finish", {
        ...toolMeta,
        success: result?.success === true,
        error: result?.error,
      })
      wsClient.send({
        type: "tool.result",
        tool_call_id: msg.tool_call_id,
        result,
      })
    } catch (e: any) {
      const error = e.message || String(e)
      logToCompanion("error", "extension.tool.exception", { ...toolMeta, error })
      wsClient.send({
        type: "tool.result",
        tool_call_id: msg.tool_call_id,
        error: { message: error },
      })
    }
    return
  }

  // Mirror for Cockpit hydrate (separate React tree)
  if (msg.type === "computer.task.event") {
    noteComputerTaskEvent(msg)
  }
  if (msg.type === "security.confirmation.request") {
    noteSecurityConfirmationRequest(msg)
  }
  if (
    msg.type === "security.confirmation.resolved" ||
    msg.type === "security.confirmation.expired"
  ) {
    noteSecurityConfirmationGone(msg.confirmation_id)
  }

  // P1 content-split (D10′): open/focus Cockpit for ANY security confirm
  // (Panel MinimalConfirm; heavy preview/nonce/whitelist in ConfirmElevated).
  // Also L2 task start (covers tray-initiated CU when Side Panel is closed — D16).
  // Focus is background-driven — Cockpit must not self-focus on every confirm.
  const anySecurityConfirm = msg.type === "security.confirmation.request"
  const computerTaskStart =
    msg.type === "computer.task.event" &&
    (msg.event === "started" || msg.event === "paused")
  if (anySecurityConfirm || computerTaskStart) {
    openOrFocusCockpit().catch(() => {})
  }

  // Forward streaming tokens and other messages to side panel + cockpit.
  // CRITICAL: on failure do NOT logToCompanion — that + companion log.event
  // echo-to-sender formed a tight localhost WS loop when no UI listeners
  // (Side Panel/Cockpit closed). See dual-review log-event-echo-loop-rca.
  chrome.runtime.sendMessage(msg).catch((e: any) => {
    const type = typeof msg?.type === "string" ? msg.type : "unknown"
    if (shouldReportForwardFailureToCompanion(type)) {
      // Intentionally unreachable today (policy always false). Kept so a
      // future opt-in cannot forget the loop hazard without touching policy.
      logToCompanion("debug", "extension.sidepanel_forward_failed", {
        message_type: type,
        error: e?.message || String(e),
      })
      return
    }
    const { level, nextWarned } = forwardFailureConsoleLevel(sidepanelForwardFailedWarned)
    sidepanelForwardFailedWarned = nextWarned
    const err = e?.message || String(e)
    if (level === "warn") {
      console.warn("[cmspark] sidepanel_forward_failed (once/session)", type, err)
    } else {
      console.debug("[cmspark] sidepanel_forward_failed", type, err)
    }
  })
}

// --- Message handlers for popup/side panel ---

function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Outer guard: any uncaught throw in a case would otherwise leave the
    // sender with lastError "The message port closed before a response was received."
    try {
      return handleRuntimeMessage(message, sendResponse)
    } catch (e: any) {
      try {
        sendResponse({ ok: false, error: e?.message || String(e) })
      } catch {
        /* channel already closed */
      }
      return true
    }
  })
}

/** Sync dispatch for extension UI → SW messages. Returns whether the channel is kept open. */
function handleRuntimeMessage(message: any, sendResponse: (r?: any) => void): boolean {
    switch (message?.type) {
      case "getStatus":
        sendResponse({
          connectionState: wsClient?.getState?.() ?? "disconnected",
        })
        return true

      // P1 C-RACE-07: DisconnectedBanner force reconnect (reset backoff)
      case "ws.forceReconnect":
        try {
          wsClient?.forceReconnect?.()
          sendResponse({ ok: true, connectionState: wsClient?.getState?.() ?? "disconnected" })
        } catch (e: any) {
          sendResponse({ ok: false, error: e?.message || String(e) })
        }
        return true

      // Side Panel → SW diagnostic breadcrumbs (no file bytes).
      case "diag.file_upload": {
        const phase = typeof message.phase === "string" ? message.phase : "unknown"
        logToCompanion("info", `extension.file_upload.${phase}`, {
          thread_id: message.thread_id ?? message.threadId ?? null,
          connection: message.connection ?? null,
          isProcessing: message.isProcessing ?? null,
          mapBusy: message.mapBusy ?? null,
          file_count: message.file_count ?? null,
          files: Array.isArray(message.files) ? message.files : undefined,
          sw_error: message.sw_error ?? null,
          ok: message.ok ?? null,
          diag: message.diag ?? null,
          ws: wsClient?.getDiag?.() ?? null,
        })
        sendResponse({ ok: true })
        return true
      }

      case "chat.send": {
        // Config is kept in sync with companion via config.set / config.updated.
        // The companion uses its global config; no per-request override is needed.
        // hostname: site_knowledge auto-load only (not a trust/cookie gate). Dual-review 2026-07-28.
        //
        // Echo user turn to all UI surfaces (Side Panel + Cockpit). Companion does
        // not rebroadcast the user message; each React tree has its own store, so
        // Cockpit-only optimistic ADD would never appear in the panel history.
        const threadId = message.threadId as string | undefined
        const userText = typeof message.message === "string" ? message.message : ""
        const clientMessageId =
          (typeof message.clientMessageId === "string" && message.clientMessageId) ||
          (threadId ? `${threadId}_user_${Date.now()}` : `user_${Date.now()}`)
        const echoUser = (sent: boolean) => {
          if (!sent || !threadId || !userText.trim()) return
          chrome.runtime
            .sendMessage({
              type: "chat.user",
              thread_id: threadId,
              message_id: clientMessageId,
              content: userText,
              created_at: new Date().toISOString(),
            })
            .catch(() => {
              /* panel/cockpit may be closed */
            })
        }
        getActiveTabHostname().then((hostname) => {
          const sent = wsClient.send({
            type: "chat.create",
            thread_id: message.threadId,
            message: message.message,
            skill_ids: message.skillIds,
            ...(hostname ? { hostname } : {}),
            ...(Array.isArray(message.context_refs) ? { context_refs: message.context_refs } : {}),
          })
          if (!sent) {
            chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，请检查 Companion 是否已启动" })
          } else {
            echoUser(true)
          }
          sendResponse({ ok: sent })
        }).catch(() => {
          const sent = wsClient.send({
            type: "chat.create",
            thread_id: message.threadId,
            message: message.message,
            skill_ids: message.skillIds,
            ...(Array.isArray(message.context_refs) ? { context_refs: message.context_refs } : {}),
          })
          if (sent) echoUser(true)
          sendResponse({ ok: sent })
        })
        return true
      }

      case "file.upload": {
        // Diagnostics: locate where uploads die (panel → SW → WS → companion).
        // Never log base64 content — only names/sizes/types/payload estimate.
        const filesArr = Array.isArray(message.files) ? message.files : []
        const fileMeta = filesArr.map((f: any) => ({
          name: typeof f?.name === "string" ? f.name : "?",
          type: typeof f?.type === "string" ? f.type : "",
          size: typeof f?.size === "number" ? f.size : undefined,
          content_b64_len: typeof f?.content === "string" ? f.content.length : 0,
        }))
        const contentB64Total = fileMeta.reduce(
          (n: number, f: { content_b64_len: number }) => n + (f.content_b64_len || 0),
          0,
        )
        // Rough JSON envelope size excluding double-counting: names + b64 body.
        const approxPayloadBytes = contentB64Total + 512 + fileMeta.length * 128
        const diagBase = {
          thread_id: message.threadId || null,
          message_len:
            typeof message.message === "string" ? message.message.length : 0,
          file_count: filesArr.length,
          files: fileMeta,
          approx_payload_bytes: approxPayloadBytes,
          approx_payload_mb: Math.round((approxPayloadBytes / (1024 * 1024)) * 1000) / 1000,
          ws: wsClient?.getDiag?.() ?? { state: "unknown" },
        }
        logToCompanion("info", "extension.file_upload.sw_received", diagBase)

        const doSend = (hostname?: string) => {
          const payload = {
            type: "file.upload",
            thread_id: message.threadId,
            files: message.files,
            message: message.message || "",
            skill_ids: message.skillIds || [],
            ...(hostname ? { hostname } : {}),
          }
          let jsonBytes = 0
          try {
            jsonBytes = new TextEncoder().encode(JSON.stringify(payload)).length
          } catch {
            jsonBytes = -1
          }
          if (shouldRefuseWsFrame(jsonBytes)) {
            chrome.runtime.sendMessage({
              type: "file.upload_error",
              thread_id: message.threadId,
              error: "附件总体积过大，请少选几个文件",
            })
            sendResponse({ ok: false, diag: { sent: false, json_bytes: jsonBytes, over_companion_10mb: true } })
            return true
          }
          const before = wsClient?.getDiag?.() ?? null
          const sent = wsClient.send(payload)
          const after = wsClient?.getDiag?.() ?? null
          logToCompanion(sent ? "info" : "warn", "extension.file_upload.ws_send", {
            ...diagBase,
            sent,
            hostname: hostname || null,
            json_bytes: jsonBytes,
            json_mb: jsonBytes > 0 ? Math.round((jsonBytes / (1024 * 1024)) * 1000) / 1000 : null,
            ws_before: before,
            ws_after: after,
            // 10MB companion MAX_WS_MESSAGE_SIZE — flag client-side estimate
            over_companion_10mb: jsonBytes > 10 * 1024 * 1024,
          })
          if (!sent) {
            // S45 dual-review nit: stamp upload_error so Side Panel clears the
            // correct mapBusy after mid-upload thread switch (not bare `error`).
            const tid =
              typeof message.threadId === "string" && message.threadId
                ? message.threadId
                : typeof message.thread_id === "string"
                  ? message.thread_id
                  : null
            chrome.runtime.sendMessage({
              type: tid ? "file.upload_error" : "error",
              error: "Companion 未连接，请检查 Companion 是否已启动",
              ...(tid ? { thread_id: tid } : {}),
            })
          }
          sendResponse({
            ok: sent,
            diag: {
              sent,
              json_bytes: jsonBytes,
              ws: after,
              file_count: filesArr.length,
            },
          })
        }

        getActiveTabHostname()
          .then((hostname) => {
            doSend(hostname || undefined)
          })
          .catch((e: any) => {
            logToCompanion("warn", "extension.file_upload.hostname_failed", {
              ...diagBase,
              error: e?.message || String(e),
            })
            doSend(undefined)
          })
        return true
      }

      case "chat.abort":
        wsClient.send({
          type: "chat.abort",
          thread_id: message.threadId || message.thread_id,
        })
        sendResponse({ ok: true })
        return true

      // Stop one in-flight shell_exec process tree without aborting the whole chat.
      case "shell.exec.abort": {
        const sent = wsClient.send({
          type: "shell.exec.abort",
          tool_call_id: message.tool_call_id || message.toolCallId || null,
          thread_id: message.thread_id || message.threadId || null,
        })
        sendResponse({ ok: sent })
        return true
      }

      case "chat.regenerate": {
        getActiveTabHostname().then((hostname) => {
          const sent = wsClient.send({
            type: "chat.regenerate",
            thread_id: message.thread_id,
            message_id: message.message_id,
            message: message.message,
            ...(hostname ? { hostname } : {}),
          })
          if (!sent) {
            chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，无法重新生成" })
          }
          sendResponse({ ok: sent })
        }).catch(() => {
          const sent = wsClient.send({
            type: "chat.regenerate",
            thread_id: message.thread_id,
            message_id: message.message_id,
            message: message.message,
          })
          sendResponse({ ok: sent })
        })
        return true
      }

      case "config.set": {
        // Persist locally so settings survive SW restarts, then forward to companion
        // so it becomes the global source of truth.
        // P1-1: pass through non-empty confirmation_phrase for security flag arm step-up.
        // Empty string is omitted (companion rejects empty as missing_phrase anyway).
        // P0-4: report actual ws send result (same as acp.* forward) — do not claim ok
        // when Companion is disconnected.
        saveExtensionConfig(message.config || {})
        const armPhrase =
          typeof message.confirmation_phrase === "string"
            ? message.confirmation_phrase.trim()
            : ""
        if (!wsClient) {
          sendResponse({ ok: false, error: "Service worker 未初始化，请重载扩展" })
          return true
        }
        const sent = wsClient.send({
          type: "config.set",
          config: message.config,
          ...(armPhrase ? { confirmation_phrase: armPhrase } : {}),
        })
        if (!sent) {
          sendResponse({
            ok: false,
            error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接",
          })
          return true
        }
        sendResponse({ ok: true })
        return true
      }

      case "config.test": {
        // message.llmOverride: unsaved UI fields (protocol/profile/url/key) for the probe.
        // Always forward object when present so protocol is tested before Save;
        // companion merges api_key only when non-masked.
        const raw = message.llmOverride
        const llmOverride =
          raw && typeof raw === "object"
            ? raw
            : null
        wsClient.send({ type: "config.test", llm_override: llmOverride })
        sendResponse({ ok: true })
        return true
      }

      case "config.testVision":
        // Forward to companion; result comes back as config.testVisionResult via WebSocket
        wsClient.send({ type: "config.testVision" })
        sendResponse({ ok: true })
        return true

      case "config.get":
        wsClient.send({ type: "config.get" })
        // Response will come async through onMessage
        sendResponse({ ok: true })
        return true

      // P0-2B WS pairing: store the shared secret (pasted from
      // `cmspark-agent settings --ws-secret`) and (re)connect to authenticate.
      case "ws.setSecret": {
        const secret = typeof message.secret === "string" ? message.secret.trim() : ""
        if (!secret) {
          sendResponse({ ok: false, error: "密钥不能为空" })
          return true
        }
        wsClient.setSecret(secret)
        logToCompanion("info", "extension.ws_secret_set", {})
        sendResponse({ ok: true })
        return true
      }

      // Whether a pairing secret is already stored (for the Settings UI status).
      case "ws.getPairingStatus": {
        wsClient.hasSecret().then((paired) => sendResponse({ paired }))
        return true // keep the channel open for the async response
      }

      case "security.confirmation.response":
        // Forward full Side Panel fields: add_to_whitelist, nonce_response,
        // add_to_thread_whitelist, stop_thread. Companion handleSecurityConfirmationResponse
        // already consumes these (server.ts ~1481-1515). Dropping them silently
        // breaks whitelist persistence, nonce challenge, and thread trust.
        noteSecurityConfirmationGone(message.confirmation_id)
        wsClient.send(buildSecurityConfirmationWsPayload(message))
        sendResponse({ ok: true })
        return true

      case "thread.select":
        wsClient.send({ type: "thread.select", thread_id: message.threadId })
        sendResponse({ ok: true })
        return true

      case "thread.update":
        wsClient.send({ type: "thread.update", thread_id: message.threadId || message.thread_id, updates: message.updates })
        sendResponse({ ok: true })
        return true

      case "thread.delete":
        // Align with companion: omit/unknown → hard; only explicit "trash" soft-deletes.
        wsClient.send({
          type: "thread.delete",
          thread_id: message.thread_id || message.threadId,
          mode: message.mode === "trash" ? "trash" : "hard",
        })
        sendResponse({ ok: true })
        return true

      case "thread.batch_delete": {
        const ids = Array.isArray(message.thread_ids) ? message.thread_ids : []
        // Multi-select product default is recycle bin; permanent only with mode hard.
        wsClient.send({
          type: "thread.batch_delete",
          thread_ids: ids,
          mode: message.mode === "hard" ? "hard" : "trash",
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.restore": {
        wsClient.send({
          type: "thread.restore",
          thread_id: message.thread_id,
          thread_ids: message.thread_ids,
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.suggest_cleanup": {
        wsClient.send({
          type: "thread.suggest_cleanup",
          from: message.from,
          to: message.to,
          include_workers: message.include_workers === true,
          except_thread_id: message.except_thread_id || undefined,
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.list": {
        wsClient.send({
          type: "thread.list",
          include_trashed: message.include_trashed === true,
          only_trashed: message.only_trashed === true,
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.batch_auto_title": {
        wsClient.send({
          type: "thread.batch_auto_title",
          thread_ids: Array.isArray(message.thread_ids) ? message.thread_ids : undefined,
          only_empty: message.only_empty !== false,
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.extract_digest": {
        const payload: Record<string, unknown> = { type: "thread.extract_digest" }
        if (Array.isArray(message.thread_ids)) payload.thread_ids = message.thread_ids
        if (message.thread_id) payload.thread_id = message.thread_id
        if (message.force) payload.force = true
        wsClient.send(payload)
        sendResponse({ ok: true })
        return true
      }

      case "thread.related": {
        wsClient.send({
          type: "thread.related",
          thread_id: message.thread_id,
          limit: typeof message.limit === "number" ? message.limit : 5,
        })
        sendResponse({ ok: true })
        return true
      }

      case "thread.cleanup_empty":
        wsClient.send({
          type: "thread.cleanup_empty",
          except_thread_id: message.except_thread_id || undefined,
        })
        sendResponse({ ok: true })
        return true

      case "thread.generate_title":
        wsClient.send({ type: "thread.generate_title", thread_id: message.thread_id })
        sendResponse({ ok: true })
        return true

      case "thread.fork": {
        const sent = wsClient.send({ type: "thread.fork", thread_id: message.thread_id, message_id: message.message_id })
        if (!sent) {
          chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，无法创建分支" })
        }
        sendResponse({ ok: sent })
        return true
      }

      case "thread.create": {
        // P1: SW single-flight for blank auto-create (Panel + Cockpit each run useWebSocket).
        // Empty alias + client id = auto blank; drop concurrent creates within 2s window.
        const alias = message.alias || ""
        const isBlankAuto = !alias && typeof message.id === "string" && message.id
        if (isBlankAuto) {
          const now = Date.now()
          const g = globalThis as any
          if (g.__cmsparkBlankCreateUntil && now < g.__cmsparkBlankCreateUntil) {
            sendResponse({ ok: true, deduped: true })
            return true
          }
          g.__cmsparkBlankCreateUntil = now + 2000
        }
        wsClient.send({ type: "thread.create", alias, id: message.id })
        sendResponse({ ok: true })
        return true
      }

      case "page.import_notebooklm": {
        // v1: extension-only. Extracts current tab content via chrome.scripting,
        // formats as frontmatter Markdown, returns to caller for Blob download.
        // No companion round-trip (Round 2 architecture decision: Z over X).
        //
        // `.catch` is mandatory: any future regression that throws synchronously inside
        // handleNotebooklmExport (instead of being caught and returned as {ok:false})
        // would otherwise leave the message channel hanging — caller's `await
        // sendMessage` never resolves. (Phase 4 review catch.)
        handleNotebooklmExport()
          .then(sendResponse)
          .catch(e => sendResponse({ ok: false, error: `Background handler crashed: ${e?.message || String(e)}` }))
        return true
      }

      // ---------- v1.1: NotebookLM online importer ----------
      case "notebooklm.list_notebooks": {
        listNotebooks()
          .then(result => sendResponse(result))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e), notebooks: [] }))
        return true
      }
      case "notebooklm.start_batch": {
        const items = Array.isArray(message.items) ? message.items : []
        const notebookId = typeof message.notebook_id === "string" ? message.notebook_id : undefined
        startBatch(items, notebookId)
          .then(state => sendResponse({ ok: true, state }))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "notebooklm.cancel_batch": {
        cancelBatch()
          .then(() => sendResponse({ ok: true }))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "notebooklm.get_batch_state": {
        sendResponse({ ok: true, state: getActiveBatch() })
        return false
      }

      // ---------- v1.2: pathways + notebook create ----------
      case "notebooklm.create_notebook": {
        const name = typeof message.name === "string" ? message.name : ""
        if (!name.trim()) {
          sendResponse({ ok: false, error: "Notebook name required" })
          return false
        }
        // v1.3: RPC-first. The old DOM-automation createNotebook is unreliable
        // (untitled notebooks, false positives). RPC returns definitive notebookId.
        createNotebookViaRpc(name)
          .then(sendResponse)
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }

      case "notebooklm.suggest_notebook_name": {
        // P2: Companion one-shot LLM (no extension storage api_key / direct fetch)
        const companionOneshot = (req: {
          systemPrompt: string
          userContent: string
        }) =>
          new Promise<{ ok: boolean; text?: string; error?: string }>((resolve) => {
            const id = crypto.randomUUID()
            const timer = setTimeout(() => {
              pendingLlmOneshot.delete(id)
              resolve({ ok: false, error: "timeout" })
            }, 12_000)
            pendingLlmOneshot.set(id, (r) => {
              clearTimeout(timer)
              resolve(r)
            })
            const sent = wsClient.send({
              type: "llm.oneshot",
              id,
              system_prompt: req.systemPrompt,
              user_content: req.userContent,
            })
            if (!sent) {
              clearTimeout(timer)
              pendingLlmOneshot.delete(id)
              resolve({ ok: false, error: "companion_disconnected" })
            }
          })
        suggestNotebookName(companionOneshot)
          .then(sendResponse)
          .catch((e) =>
            sendResponse({ ok: false, source: "none", error: e?.message || String(e) }),
          )
        return true
      }

      case "notebooklm.extract_page_links": {
        ;(async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) {
              sendResponse({ ok: false, error: "No active tab" })
              return
            }
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: extractPageLinksRunner,
            })
            const frame = results?.[0] as any
            if (frame?.error) {
              sendResponse({ ok: false, error: `Injection error: ${frame.error}` })
              return
            }
            sendResponse(frame?.result || { ok: false, error: "No result" })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || String(e) })
          }
        })()
        return true
      }

      case "notebooklm.extract_ai_chat": {
        ;(async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) {
              sendResponse({ ok: false, error: "No active tab" })
              return
            }
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: extractAiChatRunner,
            })
            const frame = results?.[0] as any
            if (frame?.error) {
              sendResponse({ ok: false, error: `Injection error: ${frame.error}` })
              return
            }
            sendResponse(frame?.result || { ok: false, error: "No result" })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || String(e) })
          }
        })()
        return true
      }

      case "notebooklm.fetch_feed": {
        const url = typeof message.url === "string" ? message.url : ""
        if (!url) {
          sendResponse({ ok: false, error: "URL required" })
          return false
        }
        ;(async () => {
          try {
            const feed = await fetchFeed(url)
            if (feed) {
              sendResponse({ ok: true, feed })
              return
            }
            const discovered = await discoverFeed(url)
            if (discovered) {
              const feed2 = await fetchFeed(discovered)
              if (feed2) {
                sendResponse({ ok: true, feed: feed2, discoveredFrom: discovered })
                return
              }
            }
            sendResponse({ ok: false, error: "无法解析为 RSS / Atom feed（也尝试了自动发现）" })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || String(e) })
          }
        })()
        return true
      }

      case "notebooklm.parse_opml": {
        const text = typeof message.text === "string" ? message.text : ""
        try {
          const feeds = parseOpml(text)
          sendResponse({ ok: true, feeds })
        } catch (e: any) {
          sendResponse({ ok: false, error: e?.message || String(e) })
        }
        return false
      }

      case "notebooklm.fetch_multiple_feeds": {
        const urls: string[] = Array.isArray(message.urls) ? message.urls : []
        ;(async () => {
          try {
            const feeds = await fetchMultipleFeeds(urls)
            sendResponse({ ok: true, feeds })
          } catch (e: any) {
            sendResponse({ ok: false, error: e?.message || String(e) })
          }
        })()
        return true
      }

      case "notebooklm.fetch_youtube_playlist": {
        const url = typeof message.url === "string" ? message.url : ""
        const playlistId = parsePlaylistId(url)
        if (!playlistId) {
          sendResponse({ ok: false, error: "无法解析 playlist ID（确认是 YouTube playlist URL）" })
          return false
        }
        fetchPlaylist(playlistId)
          .then(sendResponse)
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }

      case "notebooklm.set_youtube_api_key": {
        const key = typeof message.key === "string" ? message.key : ""
        setYouTubeApiKey(key)
          .then(() => sendResponse({ ok: true }))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }

      case "notebooklm.get_youtube_api_key": {
        getYouTubeApiKey()
          .then(key => sendResponse({ ok: true, key }))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }

      case "thread.list":
      case "thread.export_obsidian":
      case "obsidian.pick_vault_folder":
      case "obsidian.refresh_profile":
      case "skill.list":
      case "skill.refresh":
      case "skill.craft":
      case "skill.activate":
      case "skill.deactivate":
      case "skill.export":
      case "skill.import":
      case "skill.import-folder":
      case "skill.import-files":
      case "skill.import-path":
      case "skill.delete":
      case "knowledge.list":
      case "knowledge.import":
      case "knowledge.import_directory":
      case "knowledge.delete":
      case "pack.list":
      case "pack.install":
      case "pack.apply":
      case "pack.unapply":
      case "pack.uninstall":
      case "pack.get":
      case "pack.save_user":
      case "pack.delete_user":
      case "pack.suggest_config":
      case "modules.list":
      case "modules.set_enabled":
      case "modules.update":
      // Outbound MCP L4+ grants (Settings)
      case "outbound_mcp.grants.list":
      case "outbound_mcp.grants.issue":
      case "outbound_mcp.grants.revoke":
      case "outbound_mcp.grants.revoke_all":
      case "outbound_mcp.set_require_grant":
      case "fleet.status":
      case "fleet.stop_all":
      case "worker.pause":
      case "worker.resume":
      case "tab.force_release":
      case "board.get":
      case "board.add_hint":
      case "workspace.pick":
      case "workspace.set":
      case "workspace.clear":
      case "netsec.authorize_task":
      case "enterprise.session_trust.status":
      case "enterprise.session_trust.revoke":
      // ADR-021 unattended desktop (process-memory grant; phrase on arm)
      case "security.unattended.arm":
      case "security.unattended.disarm":
      case "security.unattended.status":
      case "history.query":
      case "history.export":
      case "mcp.list":
      case "mcp.toggle_enabled":
      case "mcp.add":
      case "mcp.update":
      case "mcp.delete":
      case "mcp.toggle_server":
      case "mcp.set_selection":
      // ADR-019 user-env / Secrets (auth-gated companion handlers; never store values here)
      case "user_env.list":
      case "user_env.set":
      case "user_env.delete":
      case "apps.list":
      case "apps.enumerate":
      case "apps.add":
      case "apps.remove":
      case "apps.set_policy":
      case "apps.set_enabled":
      // 编程接力 ACP (Composition live session)
      case "acp.list":
      case "acp.rediscover":
      case "acp.adopt_discovered":
      case "acp.session.cancel":
      case "acp.session.followup":
      case "acp.session.prompt":
      case "acp.ui_start":
      case "acp.apply_diff":
      // B-lite S1: one-line git status for Coding Agent Panel context bar
      case "coding.git_status":
      case "acp.workspace_status":
      // 坐标 computer-use(WP4):每应用坐标开关(AppsPanel 卡片菜单;开启由
      // companion 生物识别门承担)、急停按钮(任务条)、全局态只读行、证据目录打开。
      case "apps.set_coordinate_allowed":
      case "computer.task.abort":
      case "computer.get_state":
      case "computer.set_enabled":
      case "computer.evidence.open":
      // WP5-I4 实验层开关族:设置页六路由透传。开启由 companion 生物识别门
      // 承担(D2,同 :727-728 坐标开关先例);license/download/delete/reset 由
      // companion validateWsMessage + handler belt 双层围栏(source:"settings"
      // 在面板侧固定注入,扩展不做信任判定)。
      case "computer.model.get_state":
      case "computer.model.set_enabled":
      case "computer.model.license_response":
      case "computer.model.download":
      case "computer.model.delete":
      case "computer.model.reset_circuit_breaker":
      case "computer.model.set_variant":
      case "computer.model.set_download_source":
      case "computer.model.set_model_root":
      case "computer.model.pick_model_root":
      case "computer.model.set_python_mode":
      case "computer.model.pick_python_path":
      case "computer.model.ensure_python_env":
      case "computer.model.install_deps":
      // Path B M0 voice.model.* (settings dual fence; companion validate + handler belt).
      case "voice.model.get_state":
      case "voice.model.download":
      case "voice.model.cancel":
      case "voice.model.delete":
      case "voice.model.set_active":
      case "voice.model.set_engine":
      // Path B: download cmspark-whisper runtime (settings). Missing cases were
      // reported as「扩展版本过旧」via Unknown message type map — not a version skew.
      case "voice.binary.download":
      case "voice.binary.cancel":
      // Path B M1/M2 voice.stt.* (runtime Side Panel; companion origin fence + session service).
      // M2 near-rt: partial_request must be forwarded or SW returns "Unknown message type"
      // (settings maps that to「扩展版本过旧或不匹配」— false alarm).
      case "voice.stt.start":
      case "voice.stt.chunk":
      case "voice.stt.end":
      case "voice.stt.abort":
      case "voice.stt.partial_request":
      // Dictation+ D1b ASR Refiner (text-only)
      case "voice.refine.request":
      case "voice.refine.abort":
      // Dictation+ D2 hold state → companion tray indicator (control plane, no audio)
      case "voice.dictation.hold_state":
      // Meeting minutes scene (Mtg0 paste + Mtg1 live capture)
      case "meeting.create":
      case "meeting.start":
      case "meeting.end":
      case "meeting.list":
      case "meeting.delete":
      case "meeting.get":
      case "meeting.set_transcript":
      case "meeting.append_transcript":
      case "meeting.apply_silence_cut":
      case "meeting.set_speakers":
      case "meeting.bulk_speaker":
      case "meeting.import_text":
      case "meeting.auto_diarize":
      case "meeting.generate_minutes":
      case "meeting.set_status": {
        // Forward to companion. Always call sendResponse so Side Panel callbacks
        // never see "The message port closed before a response was received"
        // (that lastError fires when no listener answers — default used to return
        // false without sendResponse, and any throw before sendResponse did the same).
        try {
          if (!wsClient) {
            sendResponse({ ok: false, error: "Service worker 未初始化，请重载扩展" })
            return true
          }
          const sent = wsClient.send(message)
          if (!sent) {
            sendResponse({
              ok: false,
              error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接",
            })
            return true
          }
          sendResponse({ ok: true })
        } catch (e: any) {
          sendResponse({ ok: false, error: e?.message || String(e) })
        }
        return true
      }

      // Thread graph (Obsidian-style full-page tab) — design TG-1…TG-5
      case "thread_graph.prepare": {
        const threads = (Array.isArray(message.threads) ? message.threads : []) as ThreadGraphSlim[]
        const focusId = message.focus_id || message.focusId || null
        prepareThreadGraphSnapshot(threads, focusId)
          .then((snap) => sendResponse({ ok: true, count: snap.threads.length, ts: snap.ts }))
          .catch((e: any) => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "thread_graph.open": {
        const threads = (Array.isArray(message.threads) ? message.threads : null) as ThreadGraphSlim[] | null
        const focusId = message.focus_id || message.focusId || null
        const run = async () => {
          if (threads) await prepareThreadGraphSnapshot(threads, focusId)
          const tabId = await openOrFocusThreadGraph(focusId)
          return { ok: tabId != null, tabId }
        }
        run()
          .then((r) => sendResponse(r))
          .catch((e: any) => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "thread_graph.bootstrap": {
        // Dual-review nit: single contract — read session snapshot only
        readThreadGraphSnapshot()
          .then((snap) => sendResponse({ ok: true, snapshot: snap }))
          .catch((e: any) => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "thread_graph.open_thread": {
        const threadId = message.thread_id || message.threadId
        if (!threadId || typeof threadId !== "string") {
          sendResponse({ ok: false, error: "thread_id required" })
          return true
        }
        // Companion + side panel store
        wsClient.send({ type: "thread.select", thread_id: threadId })
        // Notify side panel pages (graph stays open — TG-3)
        try {
          chrome.runtime.sendMessage({ type: "thread_graph.thread_selected", thread_id: threadId })
        } catch {
          /* no listeners */
        }
        // Focus side panel if possible
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const winId = tabs[0]?.windowId
          if (winId != null && chrome.sidePanel?.open) {
            chrome.sidePanel.open({ windowId: winId }).catch(() => {})
          }
        })
        sendResponse({ ok: true })
        return true
      }

      // UI Mode P1 — L2 Cockpit window lifecycle (does not stop computer tasks)
      case "cockpit.open": {
        openOrFocusCockpit()
          .then((windowId) => sendResponse({ ok: windowId != null, windowId }))
          .catch((e: any) => sendResponse({ ok: false, error: e?.message || String(e) }))
        return true
      }
      case "cockpit.focus": {
        focusCockpit()
          .then((ok) => sendResponse({ ok }))
          .catch(() => sendResponse({ ok: false }))
        return true
      }
      case "cockpit.close": {
        closeCockpit()
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }))
        return true
      }
      case "cockpit.status":
        sendResponse(cockpitStatus())
        return true

      case "cockpit.hydrate":
        // Cockpit boot: return mirrored computer task + pending confirms
        sendResponse({ ok: true, ...getHydrateSnapshot() })
        return true

      default:
        // Always answer when the sender used a callback; silent return false
        // surfaces as chrome.runtime.lastError "message port closed…".
        try {
          sendResponse({
            ok: false,
            error: `Unknown message type: ${typeof message?.type === "string" ? message.type : "?"}`,
          })
        } catch {
          /* channel already closed */
        }
        return true
    }
}

// M1 (audit P2-1): keep the companion's tabUrlCache (the evaluate auto-approve
// trust anchor) current by pushing every tab URL change. Without this, a tab can
// navigate from a trusted domain to an untrusted one and the companion keeps
// auto-approving evaluate against the STALE trusted hostname (cross-domain bypass).
//
// Registered at TOP-LEVEL module scope (not inside init()) so Chrome wakes the
// service worker when a navigation fires even while it was suspended (MV3). The
// callback guards on wsClient state — if the WS is down, the push is dropped
// (the cache is refreshed by the next list_tabs; tools can't run over a down WS
// anyway). Every scheme is pushed (including chrome://) so a trusted→non-web
// navigation also invalidates the trust anchor — filtering to http(s) would
// re-introduce the very staleness this fixes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  // onUpdated also fires for title/favicon/status; only a URL change is trust-relevant.
  if (typeof changeInfo.url !== "string" || !changeInfo.url) return
  try {
    if (wsClient?.getState() === "connected") {
      wsClient.send({ type: "tab.navigated", tabId, url: changeInfo.url })
    }
  } catch {
    // Cache-sync must never affect extension behavior.
  }
})

init()

// v1.1: resume any in-flight NotebookLM batch import that was interrupted by SW
// restart (MV3 idle timeout / memory pressure). The persisted state in
// chrome.storage.local is the source of truth — closure state is lost on SW death.
resumeIfPending().catch(e => console.error("[notebooklm] resume failed:", e))
