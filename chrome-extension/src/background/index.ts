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
  browserBridge = new BrowserBridge(pageSanitizer)
  keepAlive = new KeepAlive()

  wsClient = new WSClient({
    url: "ws://127.0.0.1:23401",
    onMessage: handleCompanionMessage,
    onStateChange: handleStateChange,
  })

  wsClient.connect()
  keepAlive.start(() => wsClient.ping())
  setupMessageHandlers()
}

function handleStateChange(state: "connected" | "connecting" | "disconnected") {
  updateBadge(state)

  if (state === "disconnected") {
    scheduleDisconnectNotification()
  } else if (state === "connected") {
    cancelDisconnectNotification()
    clearDisconnectedNotification()
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

      case "chat.send":
        wsClient.send({
          type: "chat.create",
          thread_id: message.threadId,
          message: message.message,
          skill_ids: message.skillIds,
        })
        sendResponse({ ok: true })
        return true

      case "chat.abort":
        wsClient.send({ type: "chat.abort", thread_id: message.threadId })
        sendResponse({ ok: true })
        return true

      case "config.set":
        wsClient.send({ type: "config.set", config: message.config })
        sendResponse({ ok: true })
        return true

      case "config.test":
        wsClient.send({ type: "config.test" })
        sendResponse({ ok: true })
        return true

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
        wsClient.send({ type: "thread.delete", thread_id: message.threadId })
        sendResponse({ ok: true })
        return true

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
