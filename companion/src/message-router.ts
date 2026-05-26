// Message router — dispatches incoming WebSocket messages to handlers

import { execSync } from "child_process"
import os from "os"
import OpenAI from "openai"
import type { ThreadManager } from "./threads/thread-manager"
import type { SkillEngine } from "./skills/skill-engine"
import type { HistoryStore } from "./history/store"
import { getConfig, saveConfig } from "./config"
import { chatCreate } from "./llm/adapter"
import { craftSkill } from "./skills/skill-craft"
import { checkHighRiskExecution } from "./security"

// Per-thread abort controllers for cancelling in-flight LLM requests
const abortControllers = new Map<string, AbortController>()

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
        normalized.llm = { ...cfg.llm }
        if (normalized.llm.api_key === "***") delete normalized.llm.api_key
      } else if (cfg.base_url || cfg.model_name || cfg.temperature !== undefined || cfg.context_window !== undefined) {
        normalized.llm = {}
        if (cfg.base_url) normalized.llm.base_url = cfg.base_url
        if (cfg.api_key && cfg.api_key !== "***") normalized.llm.api_key = cfg.api_key
        if (cfg.model_name) normalized.llm.model_name = cfg.model_name
        if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
        if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window
      }
      if (cfg.port) normalized.port = cfg.port
      if (Array.isArray(cfg.trusted_domains)) normalized.trusted_domains = cfg.trusted_domains
      if (cfg.history_retention_days) normalized.history_retention_days = cfg.history_retention_days
      const updated = saveConfig(normalized)
      return { type: "config.updated", config: { ...updated, llm: { ...updated.llm, api_key: "***" } } }
    }

    case "config.test": {
      const config = getConfig()
      if (!config.llm.api_key || config.llm.api_key === "sk-placeholder") {
        return { type: "config.testResult", ok: false, error: "API Key 未配置" }
      }
      try {
        const client = new OpenAI({
          baseURL: config.llm.base_url,
          apiKey: config.llm.api_key,
          timeout: 10000,
          maxRetries: 0,
        })
        await client.models.list()
        return { type: "config.testResult", ok: true }
      } catch (e: any) {
        return { type: "config.testResult", ok: false, error: e.message || String(e) }
      }
    }

    // --- Chat ---
    case "chat.create": {
      if (!session) return { type: "error", error: "No session" }
      const config = getConfig()

      // Cancel any existing request for this thread
      const existing = abortControllers.get(rest.thread_id)
      if (existing) {
        existing.abort()
        abortControllers.delete(rest.thread_id)
      }

      const controller = new AbortController()
      abortControllers.set(rest.thread_id, controller)

      try {
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
          signal: controller.signal,
        })
      } catch (e: any) {
        if (e.name === "AbortError" || controller.signal.aborted) {
          session.sendToExtension({ type: "chat.aborted", thread_id: rest.thread_id })
        } else {
          session.sendToExtension({ type: "chat.error", thread_id: rest.thread_id, error: e.message })
        }
      } finally {
        abortControllers.delete(rest.thread_id)
      }
      return null // chatCreate handles streaming internally
    }

    case "chat.abort": {
      const controller = abortControllers.get(rest.thread_id)
      if (controller) {
        controller.abort()
        abortControllers.delete(rest.thread_id)
      }
      return { type: "chat.aborted", thread_id: rest.thread_id }
    }

    // --- Threads ---
    case "thread.create":
      return { type: "thread.created", thread: threadManager.create(rest.alias, rest.id) }
    case "thread.delete":
      threadManager.delete(rest.thread_id)
      return { type: "thread.deleted", thread_id: rest.thread_id }
    case "thread.list":
      return { type: "thread.list", threads: threadManager.list() }
    case "thread.select":
      return { type: "thread.messages", messages: threadManager.getMessages(rest.thread_id) }
    case "thread.update": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const allowedUpdates: Record<string, any> = {}
      const updates = rest.updates || {}
      for (const key of ["alias", "config_override", "tool_whitelist", "pinned_tabs", "active_skill_ids"]) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          allowedUpdates[key] = updates[key]
        }
      }
      const thread = threadManager.update(rest.thread_id, allowedUpdates)
      if (!thread) return { type: "error", error: `Thread not found: ${rest.thread_id}` }
      return { type: "thread.updated", thread }
    }

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
      return { type: "skill.exported", ...skillEngine.exportSkill(rest.skill_name) }
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
    case "skill.import-folder":
      if (!rest.zip_data) throw new Error("skill.import-folder requires 'zip_data'")
      skillEngine.importSkillFolder(rest.zip_data)
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }

    case "skill.import-path": {
      if (!rest.dir_path) throw new Error("skill.import-path requires 'dir_path'")
      skillEngine.importSkillFromPath(rest.dir_path)
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    }
    case "skill.import-files": {
      if (!rest.files || !Array.isArray(rest.files)) throw new Error("skill.import-files requires 'files' array")
      skillEngine.importSkillFiles(rest.files)
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    }
    case "skill.delete":
      skillEngine.deleteSkill(rest.skill_name)
      return { type: "skill.deleted", skill_name: rest.skill_name }

    // --- Skill-craft ---
    case "skill.craft": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const config = getConfig()
      try {
        const skill = await craftSkill({
          threadId: rest.thread_id,
          threadManager: services.threadManager,
          messageIds: rest.message_ids,
          messageCount: rest.message_count,
          config: config.llm,
        })
        if (!skill) {
          return { type: "skill.crafted", skill: null, reason: "未发现可提取的操作模式" }
        }
        return { type: "skill.crafted", skill }
      } catch (e: any) {
        return { type: "skill.crafted", skill: null, error: e.message || String(e) }
      }
    }

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
        return { type: "tool.result", id: msg.id, success: false, error: "url and expression required" }
      }
      if (session) {
        const result = await session.executeTool(msg.id || `osascript_${Date.now()}`, "osascript_eval", { url: pageUrl, expression: jsExpr })
        return { type: "tool.result", id: msg.id, ...result }
      }
      const safety = checkHighRiskExecution("osascript_eval", jsExpr)
      if (safety.blocked) {
        return {
          type: "tool.result",
          id: msg.id,
          success: false,
          error: safety.error,
          data: { dangerous_apis_found: safety.dangerousApis },
        }
      }
      try {
        if (os.platform() !== "darwin") {
          return { type: "tool.result", id: msg.id, success: false, error: "osascript_eval is macOS-only. Use get_page_text via tabId instead (cross-platform)." }
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
                if URL of t contains "${pageUrl}" then
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
          return { type: "tool.result", id: msg.id, success: false, error: `Tab with URL "${pageUrl}" not found in Chrome` }
        } else {
          return { type: "tool.result", id: msg.id, success: true, data: { result: output } }
        }
      } catch (err: any) {
        return { type: "tool.result", id: msg.id, success: false, error: `osascript_eval error: ${err.message}` }
      }
    }

    // --- Original System ---
    case "system.ping":
      return { type: "system.pong" }

    default:
      return { type: "error", error: `Unknown message type: ${type}` }
  }
}
