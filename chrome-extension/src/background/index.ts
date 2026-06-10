// CMspark Browser Agent — Background Service Worker
// WebSocket client, CDP manager, tab manager, cookie ops

import { WSClient } from "./ws-client"
import { BrowserBridge } from "./browser-bridge"
import { KeepAlive } from "./keep-alive"
import { setSecuritySecret } from "./security-token"
import { PageSanitizer, pageSanitizer } from "./page-sanitizer"

let wsClient: WSClient
let browserBridge: BrowserBridge
let keepAlive: KeepAlive
type LogLevel = "debug" | "info" | "warn" | "error"

// Extension's own LLM config, stored separately from companion's config.
// Takes priority over the companion/tray config when sending chat requests.
// Persisted in chrome.storage.local so it survives service-worker restarts.
interface ExtensionLLMConfig {
  api_key:        string
  base_url:       string
  model_name:     string
  temperature?:   number
  context_window?: number
}
let extensionLLMConfig: ExtensionLLMConfig | null = null

function loadExtensionLLMConfig() {
  chrome.storage.local.get("extensionLLMConfig", (result) => {
    if (result.extensionLLMConfig?.api_key) {
      extensionLLMConfig = result.extensionLLMConfig as ExtensionLLMConfig
    }
  })
}

/** Persist extension LLM config when user saves settings. */
function saveExtensionLLMConfig(cfg: Record<string, unknown>) {
  // Support both flat (legacy settings.set) and nested (config.set) formats
  const llm = (cfg.llm as Record<string, unknown> | undefined) ?? cfg
  const apiKey = llm.api_key as string | undefined
  if (!apiKey || apiKey === "***") return  // Don't save masked or empty keys
  extensionLLMConfig = {
    api_key:        apiKey,
    base_url:       String(llm.base_url ?? extensionLLMConfig?.base_url ?? ""),
    model_name:     String(llm.model_name ?? extensionLLMConfig?.model_name ?? ""),
    temperature:    llm.temperature !== undefined ? Number(llm.temperature) : extensionLLMConfig?.temperature,
    context_window: llm.context_window !== undefined ? Number(llm.context_window) : extensionLLMConfig?.context_window,
  }
  chrome.storage.local.set({ extensionLLMConfig })
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
  loadExtensionLLMConfig()
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

  if (msg.type === "security.config") {
    if (typeof msg.secret === "string" && msg.secret) {
      setSecuritySecret(msg.secret)
    }
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
        // Include the extension's locally-stored LLM config so the companion
        // can prefer it over its own (tray-configured) stored config.
        const llmOverride = extensionLLMConfig?.api_key ? extensionLLMConfig : null
        const sent = wsClient.send({
          type: "chat.create",
          thread_id: message.threadId,
          message: message.message,
          skill_ids: message.skillIds,
          llm_override: llmOverride,
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

      case "config.set":
        // Persist the API key locally before forwarding to companion
        saveExtensionLLMConfig(message.config || {})
        wsClient.send({ type: "config.set", config: message.config })
        sendResponse({ ok: true })
        return true

      case "config.test": {
        // message.llmOverride: config from the extension's settings UI (before saving)
        // Falls back to extensionLLMConfig (last saved), then to companion's stored config
        const llmOverride = (message.llmOverride?.api_key && message.llmOverride.api_key !== "***")
          ? message.llmOverride
          : extensionLLMConfig?.api_key ? extensionLLMConfig : null
        wsClient.send({ type: "config.test", llm_override: llmOverride })
        sendResponse({ ok: true })
        return true
      }

      case "config.get":
        wsClient.send({ type: "config.get" })
        // Response will come async through onMessage
        sendResponse({ ok: true })
        return true

      case "security.confirmation.response":
        wsClient.send({
          type: "security.confirmation.response",
          confirmation_id: message.confirmation_id,
          approved: message.approved === true,
        })
        sendResponse({ ok: true })
        return true

      case "security.setPrivilege":
        wsClient.send({
          type: "security.setPrivilege",
          privilege: message.privilege,
          enabled: message.enabled,
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

      case "thread.list":
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
      case "history.query":
      case "history.export":
        // Forward to companion
        wsClient.send(message)
        sendResponse({ ok: true })
        return true

      default:
        return false
    }
  })
}

init()
