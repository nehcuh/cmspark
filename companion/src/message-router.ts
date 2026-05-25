// Message router — dispatches incoming WebSocket messages to handlers

import { execSync } from "child_process"
import os from "os"
import type { ThreadManager } from "./threads/thread-manager"
import type { SkillEngine } from "./skills/skill-engine"
import type { HistoryStore } from "./history/store"
import { getConfig, saveConfig } from "./config"
import { chatCreate } from "./llm/adapter"

interface Services {
  threadManager: ThreadManager
  skillEngine: SkillEngine
  historyStore: HistoryStore
}

interface SessionCallbacks {
  sendToExtension: (data: any) => void
  executeTool: (toolCallId: string, toolName: string, params: any) => Promise<{ success: boolean; data?: any; error?: string }>
}

export async function handleMessage(
  msg: any,
  services: Services,
  session?: SessionCallbacks,
): Promise<any> {
  const { type, ...rest } = msg
  const { threadManager, skillEngine, historyStore } = services

  switch (type) {
    // --- Config ---
    case "config.get": {
      const config = getConfig()
      return { type: "config.updated", config: { ...config, llm: { ...config.llm, api_key: "***" } } }
    }
    case "config.set": {
      const cfg = rest.config
      // Normalize: if caller sends flat LLM fields, nest them under llm
      const normalized: any = {}
      if (cfg.llm) {
        normalized.llm = cfg.llm
      } else if (cfg.base_url || cfg.model_name || cfg.temperature !== undefined || cfg.context_window !== undefined) {
        normalized.llm = {}
        if (cfg.base_url) normalized.llm.base_url = cfg.base_url
        if (cfg.api_key) normalized.llm.api_key = cfg.api_key
        if (cfg.model_name) normalized.llm.model_name = cfg.model_name
        if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
        if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window
      }
      if (cfg.port) normalized.port = cfg.port
      if (cfg.trusted_domains) normalized.trusted_domains = cfg.trusted_domains
      if (cfg.history_retention_days) normalized.history_retention_days = cfg.history_retention_days
      saveConfig(normalized)
      return { type: "config.updated", config: normalized }
    }

    case "config.test": {
      // Test LLM connection
      return { type: "config.testResult", ok: true }
    }

    // --- Chat ---
    case "chat.create": {
      if (!session) return { type: "error", error: "No session" }
      const config = getConfig()
      await chatCreate({
        threadId: rest.thread_id,
        message: rest.message,
        skillIds: rest.skill_ids || [],
        config: config.llm,
        threadManager: services.threadManager,
        skillEngine: services.skillEngine,
        historyStore: services.historyStore,
        sendToExtension: session.sendToExtension,
        executeTool: session.executeTool,
      })
      return null // chatCreate handles streaming internally
    }

    case "chat.abort":
      // TODO: abort ongoing LLM requests for thread
      return { type: "chat.aborted", thread_id: rest.thread_id }

    // --- Threads ---
    case "thread.create":
      return { type: "thread.created", thread: threadManager.create(rest.alias) }
    case "thread.delete":
      threadManager.delete(rest.thread_id)
      return { type: "thread.deleted", thread_id: rest.thread_id }
    case "thread.list":
      return { type: "thread.list", threads: threadManager.list() }
    case "thread.select":
      return { type: "thread.messages", messages: threadManager.getMessages(rest.thread_id) }

    // --- Skills ---
    case "skill.list":
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    case "skill.activate":
      skillEngine.activate(rest.thread_id, rest.skill_name)
      return { type: "skill.activated", skill_name: rest.skill_name }
    case "skill.deactivate":
      skillEngine.deactivate(rest.thread_id, rest.skill_name)
      return { type: "skill.deactivated", skill_name: rest.skill_name }
    case "skill.export":
      return { type: "skill.exported", content: skillEngine.exportSkill(rest.skill_name) }
    case "skill.import":
      if (rest.url) {
        // Import from URL — fetch content first
        const response = await fetch(rest.url)
        if (!response.ok) throw new Error(`Failed to fetch skill: ${response.status}`)
        const content = await response.text()
        skillEngine.importSkill(content)
      } else if (rest.content) {
        skillEngine.importSkill(rest.content)
      } else {
        throw new Error("skill.import requires 'content' or 'url'")
      }
      // Refresh and return updated list
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    case "skill.delete":
      skillEngine.deleteSkill(rest.skill_name)
      return { type: "skill.deleted", skill_name: rest.skill_name }

    // --- History ---
    case "history.query":
      return {
        type: "history.result",
        operations: historyStore.query(rest),
      }
    case "history.export":
      return {
        type: "history.exported",
        data: historyStore.exportJSON(rest),
      }

    // --- System ---

    // osascript_eval: execute JS in Chrome tab via AppleScript (bypasses CSP + debugger)
    case "osascript_eval": {
      const { url: pageUrl, expression: jsExpr } = rest as { url: string; expression: string }
      if (!pageUrl || !jsExpr) {
        sendMessage({ type: "tool.result", id: message.id, success: false, error: "url and expression required" })
        break
      }
      try {
        if (os.platform() !== "darwin") {
          sendMessage({ type: "tool.result", id: message.id, success: false, error: "osascript_eval is macOS-only. Use get_page_text via tabId instead (cross-platform)." })
          break
        }
        // Escape JS for AppleScript string: backslash + double-quote
        const escapedJs = jsExpr
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, " ")
        const script = `
          tell application "Google Chrome"
            repeat with w in windows
              repeat with t in tabs of w
                if URL of t starts with "${pageUrl}" then
                  set resultText to execute t javascript "${escapedJs}"
                  return resultText
                end if
              end repeat
            end repeat
            return "TAB_NOT_FOUND"
          end tell
        `
        const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
          encoding: "utf-8",
          timeout: 10000,
        }).trim()
        if (output === "TAB_NOT_FOUND") {
          sendMessage({ type: "tool.result", id: message.id, success: false, error: `Tab with URL "${pageUrl}" not found in Chrome` })
        } else {
          sendMessage({ type: "tool.result", id: message.id, success: true, data: { result: output } })
        }
      } catch (err: any) {
        sendMessage({ type: "tool.result", id: message.id, success: false, error: `osascript_eval error: ${err.message}` })
      }
      break
    }

    // --- Original System ---
    case "system.ping":
      return { type: "system.pong" }

    default:
      return { type: "error", error: `Unknown message type: ${type}` }
  }
}
