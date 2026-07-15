// CMspark Browser Agent — Background Service Worker
// WebSocket client, CDP manager, tab manager, cookie ops

import { WSClient } from "./ws-client"
import { BrowserBridge } from "./browser-bridge"
import { KeepAlive } from "./keep-alive"
import { PageSanitizer, pageSanitizer } from "./page-sanitizer"
import { handleNotebooklmExport } from "./notebooklm-handler"
import { cancelBatch, getActiveBatch, resumeIfPending, startBatch } from "./notebooklm-import-orchestrator"
import { listNotebooks } from "../notebooklm/notebook-api"

let wsClient: WSClient
let browserBridge: BrowserBridge
let keepAlive: KeepAlive
type LogLevel = "debug" | "info" | "warn" | "error"

// Extension's cached copy of the companion global config.
// Kept in sync via config.set (extension-initiated) and config.updated (companion broadcast).
// Persisted in chrome.storage.local so settings survive service-worker restarts.
interface ExtensionConfig {
  api_key: string
  base_url: string
  model_name: string
  temperature?: number
  context_window?: number
  vision_enabled?: boolean
  vision_api_key?: string
  vision_base_url?: string
  vision_model_name?: string
  vision_timeout_ms?: number
  vision_fallback?: string
}
let extensionConfig: ExtensionConfig | null = null

function loadExtensionConfig() {
  chrome.storage.local.get(["extensionConfig", "extensionLLMConfig"], (result) => {
    if (result.extensionConfig) {
      extensionConfig = result.extensionConfig as ExtensionConfig
    } else if (result.extensionLLMConfig) {
      // Migrate legacy extensionLLMConfig to the new full extensionConfig
      const legacy = result.extensionLLMConfig as any
      extensionConfig = {
        api_key: legacy.api_key || "",
        base_url: legacy.base_url || "",
        model_name: legacy.model_name || "",
        temperature: legacy.temperature,
        context_window: legacy.context_window,
      }
      chrome.storage.local.set({ extensionConfig })
      chrome.storage.local.remove("extensionLLMConfig")
    }
  })
}

/**
 * Check if an API key is masked (i.e., a placeholder like "***" or "sk-****xyz").
 * This prevents accidentally overwriting a real key with a masked placeholder.
 */
function isMaskedApiKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== "string") return false
  if (key === "***") return true
  // Any occurrence of 4+ consecutive asterisks indicates masking.
  if (key.includes("****")) return true
  // Some UIs use dots instead of asterisks
  if (key.includes("....") && key.length >= 10) return true
  return false
}

/** Persist the full config locally so it survives SW restarts. */
function saveExtensionConfig(cfg: Record<string, unknown>) {
  // Support both flat (legacy settings.set) and nested (config.set) formats
  const llm = (cfg.llm as Record<string, unknown> | undefined) ?? cfg
  const vision = cfg.vision as Record<string, unknown> | undefined

  const next: ExtensionConfig = {
    // Skip masked/empty API keys to keep the existing value
    api_key: typeof llm.api_key === "string" && llm.api_key && !isMaskedApiKey(llm.api_key)
      ? llm.api_key
      : (extensionConfig?.api_key || ""),
    base_url: String(llm.base_url ?? extensionConfig?.base_url ?? ""),
    model_name: String(llm.model_name ?? extensionConfig?.model_name ?? ""),
    temperature: llm.temperature !== undefined ? Number(llm.temperature) : extensionConfig?.temperature,
    context_window: llm.context_window !== undefined ? Number(llm.context_window) : extensionConfig?.context_window,
  }

  // Vision: support both flat fields (from extension UI) and nested vision object (from companion)
  if (cfg.vision_enabled !== undefined) {
    next.vision_enabled = !!cfg.vision_enabled
  } else if (vision?.enabled !== undefined) {
    next.vision_enabled = !!vision.enabled
  } else if (extensionConfig?.vision_enabled !== undefined) {
    next.vision_enabled = extensionConfig.vision_enabled
  }

  // Skip masked vision API keys
  if (cfg.vision_api_key !== undefined && !isMaskedApiKey(cfg.vision_api_key as string)) {
    next.vision_api_key = cfg.vision_api_key as string
  } else if (vision?.api_key !== undefined && !isMaskedApiKey(vision.api_key as string)) {
    next.vision_api_key = vision.api_key as string
  } else if (extensionConfig?.vision_api_key !== undefined) {
    next.vision_api_key = extensionConfig.vision_api_key
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

  extensionConfig = next
  chrome.storage.local.set({ extensionConfig })
}

const NOTIFICATION_ID = "cmspark-companion-disconnected"
const DISCONNECT_DEBOUNCE_MS = 3000
let disconnectNotificationTimer: ReturnType<typeof setTimeout> | null = null
let lastNotifiedState: "connected" | "disconnected" | null = null

function logToCompanion(level: LogLevel, event: string, data: Record<string, unknown> = {}) {
  try {
    if (wsClient?.getState() === "connected") {
      wsClient.send({ type: "log.event", source: "extension", level, event, data })
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

  // Long-lived port from sidepanel — keeps the service worker alive while sidepanel is open
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "cmspark-sidepanel") return
    logToCompanion("info", "extension.sidepanel_port_connected", {})
    port.onDisconnect.addListener(() => {
      logToCompanion("info", "extension.sidepanel_port_disconnected", {})
    })
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

async function handleCompanionMessage(msg: any) {
  // Forward quick action trigger to side panel
  if (msg.type === "quickAction.start") {
    chrome.runtime.sendMessage(msg).then(() => {
      // Sidepanel received the message — it will handle chat creation
    }).catch(() => {
      // Sidepanel not open — start chat directly from background so the
      // quick action still works even when the sidepanel is closed.
      const { thread_id, prompt } = msg
      if (thread_id && prompt) {
        wsClient.send({
          type: "chat.create",
          thread_id,
          message: prompt,
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

  // Forward streaming tokens and other messages to side panel
  chrome.runtime.sendMessage(msg).catch((e: any) => {
    logToCompanion("debug", "extension.sidepanel_forward_failed", {
      message_type: msg?.type || "unknown",
      error: e?.message || String(e),
    })
    // side panel may not be open — that's fine
  })
}

// --- Message handlers for popup/side panel ---

function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case "getStatus":
        sendResponse({
          connectionState: wsClient.getState(),
        })
        return true

      case "chat.send": {
        // Config is kept in sync with companion via config.set / config.updated.
        // The companion uses its global config; no per-request override is needed.
        const sent = wsClient.send({
          type: "chat.create",
          thread_id: message.threadId,
          message: message.message,
          skill_ids: message.skillIds,
        })
        if (!sent) {
          chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，请检查 Companion 是否已启动" })
        }
        sendResponse({ ok: sent })
        return true
      }

      case "file.upload": {
        const sent = wsClient.send({
          type: "file.upload",
          thread_id: message.threadId,
          files: message.files,
          message: message.message || "",
          skill_ids: message.skillIds || [],
        })
        if (!sent) {
          chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，请检查 Companion 是否已启动" })
        }
        sendResponse({ ok: sent })
        return true
      }

      case "chat.abort":
        wsClient.send({ type: "chat.abort", thread_id: message.threadId })
        sendResponse({ ok: true })
        return true

      case "chat.regenerate": {
        const sent = wsClient.send({
          type: "chat.regenerate",
          thread_id: message.thread_id,
          message_id: message.message_id,
          message: message.message,
        })
        if (!sent) {
          chrome.runtime.sendMessage({ type: "error", error: "Companion 未连接，无法重新生成" })
        }
        sendResponse({ ok: sent })
        return true
      }

      case "config.set":
        // Persist locally so settings survive SW restarts, then forward to companion
        // so it becomes the global source of truth.
        saveExtensionConfig(message.config || {})
        wsClient.send({ type: "config.set", config: message.config })
        sendResponse({ ok: true })
        return true

      case "config.test": {
        // message.llmOverride: config from the extension's settings UI (before saving).
        // Used only for connection testing; actual chat uses the synced global config.
        const llmOverride = (message.llmOverride?.api_key && message.llmOverride.api_key !== "***")
          ? message.llmOverride
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
        wsClient.send({
          type: "security.confirmation.response",
          confirmation_id: message.confirmation_id,
          approved: message.approved === true,
          // Forward the whitelist patterns chosen in the dialog so the companion
          // can persist them into auto_approved_domains. Dropping this field
          // (regression) silently makes "add to whitelist" a no-op: the companion
          // sees an empty array, skips saveConfig, and every future evaluate on
          // the same domain re-prompts.
          add_to_whitelist: Array.isArray(message.add_to_whitelist) ? message.add_to_whitelist : [],
        })
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
        wsClient.send({ type: "thread.delete", thread_id: message.thread_id || message.threadId })
        sendResponse({ ok: true })
        return true

      case "thread.cleanup_empty":
        wsClient.send({ type: "thread.cleanup_empty" })
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

      case "thread.create":
        wsClient.send({ type: "thread.create", alias: message.alias || "", id: message.id })
        sendResponse({ ok: true })
        return true

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

      case "thread.list":
      case "thread.export_obsidian":
      case "obsidian.pick_vault_folder":
      case "obsidian.refresh_profile":
      case "skill.list":
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
      case "history.query":
      case "history.export":
      case "mcp.list":
      case "mcp.toggle_enabled":
      case "mcp.add":
      case "mcp.update":
      case "mcp.delete":
      case "mcp.toggle_server":
      case "mcp.set_selection":
        // Forward to companion
        wsClient.send(message)
        sendResponse({ ok: true })
        return true

      default:
        return false
    }
  })
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
