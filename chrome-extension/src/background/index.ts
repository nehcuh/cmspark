// CMspark Browser Agent — Background Service Worker
// WebSocket client, CDP manager, tab manager, cookie ops

import { WSClient } from "./ws-client"
import { BrowserBridge } from "./browser-bridge"
import { KeepAlive } from "./keep-alive"

let wsClient: WSClient
let browserBridge: BrowserBridge
let keepAlive: KeepAlive

function init() {
  browserBridge = new BrowserBridge()
  keepAlive = new KeepAlive()

  wsClient = new WSClient({
    url: "ws://127.0.0.1:23401",
    onMessage: handleCompanionMessage,
    onStateChange: updateBadge,
  })

  wsClient.connect()
  keepAlive.start(() => wsClient.ping())
  setupMessageHandlers()
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
}

// --- Companion message routing ---

async function handleCompanionMessage(msg: any) {
  if (msg.type === "tool.execute") {
    try {
      const result = await browserBridge.execute(msg.tool_name, msg.params)
      wsClient.send({
        type: "tool.result",
        tool_call_id: msg.tool_call_id,
        result,
      })
    } catch (e: any) {
      wsClient.send({
        type: "tool.result",
        tool_call_id: msg.tool_call_id,
        error: { message: e.message || String(e) },
      })
    }
    return
  }

  // Forward streaming tokens and other messages to side panel
  chrome.runtime.sendMessage(msg).catch(() => {
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
          config: browserBridge.getConfig(),
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

      case "config.get":
        wsClient.send({ type: "config.get" })
        // Response will come async through onMessage
        sendResponse({ ok: true })
        return true

      case "thread.select":
      case "thread.create":
      case "thread.delete":
      case "thread.list":
      case "skill.list":
      case "skill.activate":
      case "skill.deactivate":
      case "skill.export":
      case "skill.import":
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
