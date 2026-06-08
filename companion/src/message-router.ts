// Message router — dispatches incoming WebSocket messages to handlers

import os from "os"
import { URL } from "url"
import OpenAI from "openai"
import type { ThreadManager } from "./threads/thread-manager"
import type { SkillEngine } from "./skills/skill-engine"
import type { HistoryStore } from "./history/store"
import { getConfig, saveConfig } from "./config"
import { chatCreate } from "./llm/adapter"
import { craftSkill, craftSkillToMarkdown } from "./skills/skill-craft"
import { checkHighRiskExecution } from "./security"
import { securityPolicy } from "./security-policy"

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
      // Reject prototype pollution keys (P0)
      if (hasPrototypePollutionKey(cfg)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      // Normalize: if caller sends flat LLM fields, nest them under llm
      const normalized: any = {}
      if (cfg.llm) {
        normalized.llm = sanitizeConfig({ ...cfg.llm })
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

    case "config.test":
    case "settings.test": {
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

    case "settings.get": {
      const config = getConfig()
      return {
        type: "settings.result",
        settings: {
          api_key: config.llm.api_key ? "***" : "",
          base_url: config.llm.base_url,
          model_name: config.llm.model_name,
          temperature: config.llm.temperature,
          context_window: config.llm.context_window,
        },
      }
    }
    case "settings.set": {
      const cfg = rest.settings || {}
      // Reject prototype pollution keys (P0)
      if (hasPrototypePollutionKey(cfg)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      const normalized: any = { llm: {} }
      if (cfg.api_key && cfg.api_key !== "***") normalized.llm.api_key = cfg.api_key
      if (cfg.base_url) normalized.llm.base_url = cfg.base_url
      if (cfg.model_name) normalized.llm.model_name = cfg.model_name
      if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
      if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window

      // Validate temperature
      if (normalized.llm.temperature !== undefined) {
        const t = parseFloat(normalized.llm.temperature)
        if (isNaN(t) || t < 0 || t > 2) {
          return { type: "error", error: "temperature 应为 0.0 - 2.0 之间的数字" }
        }
      }
      // Validate context_window
      if (normalized.llm.context_window !== undefined) {
        const cw = parseInt(normalized.llm.context_window, 10)
        if (isNaN(cw) || cw < 1000 || cw > 10000000) {
          return { type: "error", error: "context_window 应为 1000 - 10000000 之间的整数" }
        }
      }
      // Validate base_url
      if (normalized.llm.base_url) {
        try { new URL(normalized.llm.base_url) } catch {
          return { type: "error", error: "无效的 base_url" }
        }
      }

      const updated = saveConfig(normalized)
      return {
        type: "settings.saved",
        settings: {
          api_key: updated.llm.api_key ? "***" : "",
          base_url: updated.llm.base_url,
          model_name: updated.llm.model_name,
          temperature: updated.llm.temperature,
          context_window: updated.llm.context_window,
        },
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
        // Get thread to determine skill and knowledge selection modes
        const thread = services.threadManager.get(rest.thread_id)
        const skillMode = thread?.skill_selection_mode || "auto"
        const knowledgeMode = thread?.knowledge_selection_mode || "auto"

        // Resolve skill IDs based on mode
        const currentHostname = rest.hostname || (rest.url ? new URL(rest.url).hostname : undefined)
        const resolvedSkillIds = await services.skillEngine.resolveSkillIdsForThread(
          rest.thread_id,
          skillMode,
          rest.message,
          currentHostname,
        )

        // Resolve knowledge IDs based on mode
        const resolvedKnowledgeIds = services.skillEngine.resolveKnowledgeIdsForThread(
          rest.thread_id,
          knowledgeMode,
          currentHostname,
        )

        // Merge with any explicitly requested skill_ids from client
        const allSkillIds = [...new Set([...resolvedSkillIds, ...(rest.skill_ids || [])])]

        // For auto mode, notify about auto-matched skills
        if (skillMode === "auto") {
          const matched = await services.skillEngine.matchSkills(rest.message)
          const domainMatches = matched.filter(m => m.confidence >= 20)
          if (domainMatches.length > 0) {
            session.sendToExtension({
              type: "skill.auto_matched",
              skills: domainMatches,
            })
          }
        }

        await chatCreate({
          threadId: rest.thread_id,
          message: rest.message,
          skillIds: allSkillIds,
          knowledgeIds: resolvedKnowledgeIds,
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

    case "chat.regenerate": {
      if (!session) return { type: "error", error: "No session" }
      const config = getConfig()
      const { thread_id, message_id } = rest

      const messages = threadManager.getMessages(thread_id)
      const idx = messages.findIndex(m => m.id === message_id)
      if (idx < 0) return { type: "error", error: "Message not found" }
      if (messages[idx].role !== "assistant") {
        return { type: "error", error: "Can only regenerate assistant messages" }
      }

      // Find preceding user message
      let userMsg = null
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i]
          break
        }
      }
      if (!userMsg) return { type: "error", error: "No user message found before this assistant message" }

      // Delete this assistant message and everything after it
      threadManager.deleteMessagesFrom(thread_id, message_id)

      // Notify extension of updated message list
      session.sendToExtension({
        type: "thread.messages",
        messages: threadManager.getMessages(thread_id),
      })

      // Cancel any existing request for this thread
      const existing = abortControllers.get(thread_id)
      if (existing) {
        existing.abort()
        abortControllers.delete(thread_id)
      }
      const controller = new AbortController()
      abortControllers.set(thread_id, controller)

      try {
        // Get thread to determine skill and knowledge selection modes
        const thread = services.threadManager.get(thread_id)
        const skillMode = thread?.skill_selection_mode || "auto"
        const knowledgeMode = thread?.knowledge_selection_mode || "auto"

        // Resolve skill IDs based on mode
        const currentHostname = rest.hostname || (rest.url ? new URL(rest.url).hostname : undefined)
        const resolvedSkillIds = await services.skillEngine.resolveSkillIdsForThread(
          thread_id,
          skillMode,
          userMsg.content,
          currentHostname,
        )

        // Resolve knowledge IDs based on mode
        const resolvedKnowledgeIds = services.skillEngine.resolveKnowledgeIdsForThread(
          thread_id,
          knowledgeMode,
          currentHostname,
        )

        // Merge with any explicitly requested skill_ids from client
        const allSkillIds = [...new Set([...resolvedSkillIds, ...(rest.skill_ids || [])])]

        // For auto mode, notify about auto-matched skills
        if (skillMode === "auto") {
          const matched = await services.skillEngine.matchSkills(userMsg.content)
          const domainMatches = matched.filter(m => m.confidence >= 20)
          if (domainMatches.length > 0) {
            session.sendToExtension({ type: "skill.auto_matched", skills: domainMatches })
          }
        }

        await chatCreate({
          threadId: thread_id,
          message: userMsg.content,
          skillIds: allSkillIds,
          knowledgeIds: resolvedKnowledgeIds,
          config: config.llm,
          threadManager: services.threadManager,
          skillEngine: services.skillEngine,
          historyStore: services.historyStore,
          sendToExtension: session.sendToExtension,
          executeTool: session.executeTool,
          signal: controller.signal,
          skipUserMessage: true,
        })
      } catch (e: any) {
        if (e.name === "AbortError" || controller.signal.aborted) {
          session.sendToExtension({ type: "chat.aborted", thread_id })
        } else {
          session.sendToExtension({ type: "chat.error", thread_id, error: e.message })
        }
      } finally {
        abortControllers.delete(thread_id)
      }
      return null
    }

    // --- Threads ---
    case "thread.create": {
      try {
        return { type: "thread.created", thread: threadManager.create(rest.alias, rest.id, rest.config_override) }
      } catch (e: any) {
        return { type: "error", error: e.message || String(e) }
      }
    }
    case "thread.delete":
      threadManager.delete(rest.thread_id)
      return { type: "thread.deleted", thread_id: rest.thread_id }
    case "thread.list":
      return { type: "thread.list", threads: threadManager.list() }
    case "thread.select":
      return { type: "thread.messages", messages: threadManager.getMessages(rest.thread_id) }
    case "thread.fork": {
      const sourceThread = threadManager.get(rest.thread_id)
      if (!sourceThread) return { type: "error", error: "Thread not found" }

      const newThread = threadManager.create(rest.alias || `分支-${sourceThread.id}`)
      const messages = threadManager.getMessages(rest.thread_id)
      const idx = messages.findIndex(m => m.id === rest.message_id)
      const msgsToCopy = idx >= 0 ? messages.slice(0, idx + 1) : messages

      for (const msg of msgsToCopy) {
        threadManager.addMessage(newThread.id, {
          thread_id: newThread.id,
          role: msg.role,
          content: msg.content,
          tool_calls: msg.tool_calls,
        })
      }

      threadManager.update(newThread.id, {
        active_skill_ids: sourceThread.active_skill_ids,
        pinned_tabs: sourceThread.pinned_tabs,
      })

      return { type: "thread.forked", thread: newThread, messages: threadManager.getMessages(newThread.id) }
    }
    case "thread.update": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const allowedUpdates: Record<string, any> = {}
      const updates = rest.updates || {}
      for (const key of ["alias", "config_override", "tool_whitelist", "pinned_tabs", "active_skill_ids", "skill_selection_mode", "knowledge_selection_mode"]) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          allowedUpdates[key] = updates[key]
        }
      }
      try {
        const thread = threadManager.update(rest.thread_id, allowedUpdates)
        if (!thread) return { type: "error", error: `Thread not found: ${rest.thread_id}` }
        return { type: "thread.updated", thread }
      } catch (e: any) {
        return { type: "error", error: e.message || String(e) }
      }
    }

    // --- Skills ---
    case "skill.list":
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    case "skill.activate": {
      skillEngine.activate(rest.thread_id, rest.skill_name)
      const thread = threadManager.get(rest.thread_id)
      if (thread) {
        const active = thread.active_skill_ids || []
        if (!active.includes(rest.skill_name)) {
          threadManager.update(rest.thread_id, { active_skill_ids: [...active, rest.skill_name] })
        }
      }
      return { type: "skill.activated", skill_name: rest.skill_name }
    }
    case "skill.deactivate": {
      skillEngine.deactivate(rest.thread_id, rest.skill_name)
      const thread = threadManager.get(rest.thread_id)
      if (thread) {
        const active = thread.active_skill_ids || []
        threadManager.update(rest.thread_id, { active_skill_ids: active.filter(s => s !== rest.skill_name) })
      }
      return { type: "skill.deactivated", skill_name: rest.skill_name }
    }
    case "skill.export":
      return { type: "skill.exported", ...skillEngine.exportSkill(rest.skill_name) }
    case "skill.import": {
      if (rest.url) {
        // SSRF protection: protocol whitelist, block internal IPs (P0)
        const urlStr = String(rest.url)
        let parsed: URL
        try {
          parsed = new URL(urlStr)
        } catch {
          return { type: "error", error: "Invalid URL" }
        }
        const allowedProtocols = ["http:", "https:"]
        if (!allowedProtocols.includes(parsed.protocol)) {
          return { type: "error", error: `URL protocol not allowed: ${parsed.protocol}` }
        }
        const hostname = parsed.hostname
        if (isInternalIp(hostname)) {
          return { type: "error", error: "Internal IP addresses are not allowed" }
        }
        // Fetch with timeout, redirect limit, and size cap (P1)
        const controller = new AbortController()
        const fetchTimeout = setTimeout(() => controller.abort(), 30000)
        let response: Response
        try {
          response = await fetch(urlStr, {
            signal: controller.signal,
            redirect: "manual",
          })
        } finally {
          clearTimeout(fetchTimeout)
        }
        if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
          throw new Error("Redirects are not allowed for skill imports")
        }
        if (!response.ok) throw new Error(`Failed to fetch skill: ${response.status}`)
        // Cap response body size (10MB max)
        const contentLength = response.headers.get("content-length")
        const maxSize = 10 * 1024 * 1024
        if (contentLength && parseInt(contentLength, 10) > maxSize) {
          throw new Error(`Skill file too large: ${contentLength} bytes (max ${maxSize})`)
        }
        const body = await response.text()
        if (body.length > maxSize) {
          throw new Error(`Skill file too large: ${body.length} bytes (max ${maxSize})`)
        }
        skillEngine.importSkill(body)
      } else if (rest.content) {
        skillEngine.importSkill(rest.content)
      } else {
        throw new Error("skill.import requires 'content' or 'url'")
      }
      // Refresh and return updated list
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }
    }
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
          messageCount: rest.message_count || 20,
          config: config.llm,
        })
        if (!skill) {
          return { type: "skill.crafted", skill: null, reason: "未发现可提取的操作模式" }
        }

        // Auto-save and auto-activate the crafted skill
        const markdown = craftSkillToMarkdown(skill)
        services.skillEngine.importSkill(markdown)
        services.skillEngine.activate(rest.thread_id, skill.name)

        // Update thread's active_skill_ids
        const thread = services.threadManager.get(rest.thread_id)
        if (thread) {
          const active = thread.active_skill_ids || []
          if (!active.includes(skill.name)) {
            services.threadManager.update(rest.thread_id, { active_skill_ids: [...active, skill.name] })
          }
        }

        return {
          type: "skill.crafted",
          skill,
          auto_saved: true,
          auto_activated: true,
        }
      } catch (e: any) {
        return { type: "error", error: `技能生成失败: ${e.message || String(e)}` }
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
    // SECURITY: This route delegates to session.executeTool which routes to executeCompanionTool
    // in server.ts. The AppleScript is built with static -e arguments and argv passing — no
    // string replacement of user input into the script body.
    case "osascript_eval": {
      const { url: pageUrl, expression: jsExpr } = rest as { url: string; expression: string }
      if (!pageUrl || !jsExpr) {
        return { type: "tool.result", id: msg.id, success: false, error: "url and expression required" }
      }
      // Security check runs regardless of session availability
      if (rest.security_token) {
        const valid = securityPolicy.validateToken(String(rest.security_token), "osascript_eval", jsExpr)
        if (!valid) {
          return { type: "tool.result", id: msg.id, success: false, error: "Invalid or expired security token" }
        }
      } else {
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
      }
      if (!session) {
        return { type: "tool.result", id: msg.id, success: false, error: "No session available for osascript_eval" }
      }
      const result = await session.executeTool(msg.id || `osascript_${Date.now()}`, "osascript_eval", { url: pageUrl, expression: jsExpr, security_token: rest.security_token })
      return { type: "tool.result", id: msg.id, ...result }
    }

    // --- Quick Actions (from menu bar tray) ---
    case "executeQuickAction": {
      const actionId = rest.id
      if (!actionId || typeof actionId !== "string") {
        return { type: "error", error: "id required" }
      }
      if (!session) {
        return { type: "error", error: "No active browser session" }
      }

      if (actionId === "new-chat") {
        const thread = threadManager.create("")
        return { type: "quickAction.result", id: actionId, success: true, thread_id: thread.id, message: `新线程已创建: ${thread.id}` }
      }

      // Map read / extract / screenshot to tool calls
      const TOOL_MAP: Record<string, { tool: string; params: Record<string, any> }> = {
        "read-page":    { tool: "get_page_text", params: {} },
        "screenshot":   { tool: "take_screenshot", params: {} },
        "extract-data": { tool: "get_page_text", params: { selector: "main, article, .content, #content" } },
      }

      // --- Summarize: get page text then call LLM for a brief summary ---
      if (actionId === "summarize") {
        try {
          const pageResult = await session.executeTool(
            `qa-summarize-${Date.now()}`,
            "get_page_text",
            {},
          )
          if (!pageResult.success || !pageResult.data?.text) {
            return { type: "quickAction.result", id: actionId, success: false, error: "无法获取页面内容" }
          }
          const pageText: string = pageResult.data.text
          const config = getConfig()
          if (!config.llm.api_key || config.llm.api_key === "sk-placeholder") {
            return { type: "quickAction.result", id: actionId, success: false, error: "LLM 未配置，无法生成总结" }
          }
          const client = new OpenAI({ baseURL: config.llm.base_url, apiKey: config.llm.api_key, timeout: 15000, maxRetries: 0 })
          const resp = await client.chat.completions.create({
            model: config.llm.model_name,
            temperature: 0.3,
            max_tokens: 256,
            messages: [
              { role: "system", content: "用一句话总结以下网页内容（不超过80字）。直接给出总结，不要添加前缀。" },
              { role: "user", content: pageText.slice(0, 8000) },
            ],
          })
          const summary = resp.choices[0]?.message?.content?.trim() || "（总结为空）"
          return { type: "quickAction.result", id: actionId, success: true, message: summary }
        } catch (err: any) {
          return { type: "quickAction.result", id: actionId, success: false, error: `总结失败: ${err.message}` }
        }
      }

      const mapped = TOOL_MAP[actionId]
      if (!mapped) {
        return { type: "error", error: `Unknown quick action: ${actionId}` }
      }

      try {
        const result = await session.executeTool(
          `qa-${actionId}-${Date.now()}`,
          mapped.tool,
          mapped.params,
        )
        if (actionId === "read-page" || actionId === "extract-data") {
          const text = result.data?.text || ""
          const preview = text.slice(0, 500).replace(/\s+/g, " ").trim()
          return { type: "quickAction.result", id: actionId, success: true, message: preview || "页面内容为空", fullText: text }
        }
        if (actionId === "screenshot") {
          return { type: "quickAction.result", id: actionId, success: true, imageData: result.data }
        }
        return { type: "quickAction.result", id: actionId, ...result }
      } catch (err: any) {
        return { type: "error", error: `Quick action failed: ${err.message}` }
      }
    }

    // --- Original System ---
    case "system.ping":
      return { type: "system.pong" }

    default:
      return { type: "error", error: `Unknown message type: ${type}` }
  }
}

// --- Security helpers ---

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])

function hasPrototypePollutionKey(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) return true
    // Also check if any value is a pollution key string (e.g., {"foo": "__proto__"})
    const val = obj[key]
    if (typeof val === "string" && PROTOTYPE_POLLUTION_KEYS.has(val)) return true
    if (typeof val === "object" && hasPrototypePollutionKey(val)) return true
  }
  return false
}

function sanitizeConfig(obj: Record<string, any>): Record<string, any> {
  const result = Object.create(null)
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue
    const val = obj[key]
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = sanitizeConfig(val)
    } else {
      result[key] = val
    }
  }
  return result
}

function isInternalIp(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()

  // Block localhost variants
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") {
    return true
  }

  // Block DNS rebinding patterns (domains that embed IP addresses or resolve to internal IPs)
  // e.g., 127.0.0.1.nip.io, 127-0-0-1.local, 192.168.1.1.xip.io
  if (/\b\d{1,3}[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3}\b/.test(h)) return true
  if (/\b127[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3}\b/.test(h)) return true
  if (/\b10[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3}\b/.test(h)) return true
  if (/\b192[-.]168[-.]\d{1,3}[-.]\d{1,3}\b/.test(h)) return true

  // Block private IPv4 ranges
  const parts = h.split(".").map(Number)
  if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0/8
    if (parts[0] === 0) return true
  }

  // Block IPv6 loopback variants
  // ::1, ::ffff:127.0.0.1, fe80::1, etc.
  if (h.startsWith("::1") || h.startsWith("::ffff:127.") || h.startsWith("fe80::") || h.startsWith("fe80:")) {
    return true
  }
  // Block IPv6 private addresses (fc00::/7, includes fd00::/8)
  if (h.startsWith("fc") || h.startsWith("fd")) {
    // Validate it's actually an IPv6 address starting with fc/fd
    if (/^f[c-d][0-9a-f]:/i.test(h) || /^f[c-d][0-9a-f][0-9a-f]:/i.test(h)) return true
  }
  // Block IPv6 link-local (fe80::/10)
  if (/^fe[8-9a-b][0-9a-f]:/i.test(h) || /^fe[8-9a-b][0-9a-f][0-9a-f]:/i.test(h)) return true

  return false
}
