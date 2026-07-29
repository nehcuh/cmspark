// Message router — dispatches incoming WebSocket messages to handlers

import os from "os"
import * as fs from "fs"
import path from "path"
import { URL } from "url"
import OpenAI from "openai"
import type { ThreadManager } from "./threads/thread-manager"
import { serializeThreadToMarkdown, serializeSummaryToMarkdown } from "./threads/markdown-export"
import { summarizeThread } from "./threads/summary-export"
import { resolveVaultPath, profileVault, saveProfile, loadCachedProfile } from "./obsidian/vault-profiler"
import { buildVaultIndex, saveIndex, loadCachedIndex, queryRelatedNotes } from "./obsidian/vault-index"
import { detectTemplates, saveTemplates, loadCachedTemplates, pickTemplate } from "./obsidian/vault-templates"
import { pickFolderNative } from "./obsidian/folder-picker"
import type { SkillEngine } from "./skills/skill-engine"
import { normalizeHostname } from "./skills/site-matcher"
import type { HistoryStore } from "./history/store"
import { getConfig, saveConfig, replaceMcpServers, setMcpEnabled, isMaskedApiKey } from "./config"
import { chatCreate, generateThreadTitle } from "./llm/adapter"
import { parseFile } from "./file-parser"
import type { FileParseResult } from "./file-parser"
import { analyzeImage } from "./llm/vision-pipeline"
import { chunkFile, searchChunks } from "./file-chunker"
import { craftSkill, craftSkillToMarkdown } from "./skills/skill-craft"
import { checkHighRiskExecution } from "./security"
import { securityPolicy } from "./security-policy"
import { getMcpManager } from "./mcp"
import { logger } from "./logger"
import { handleAppsMessage } from "./apps/handlers"
import { handleComputerMessage } from "./computer/handlers"
import { handleComputerModelMessage } from "./computer/model-handlers"
import {
  buildUserEnvPublic,
  deleteUserEnvKeys,
  loadUserEnv,
  redactUserEnvVarsForLog,
  setUserEnvVars,
} from "./user-env"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "./security-confirmation"
import type {
  McpServerConfig,
  McpServerMeta,
} from "./mcp/types"

/**
 * Chat-path hostname for site_knowledge selection only.
 * Prefer extension-sent hostname; optional url fallback (legacy / other clients).
 * Never throws on bad url (Claude review L2).
 */
function normalizeChatHostname(hostname?: unknown, url?: unknown): string | undefined {
  if (typeof hostname === "string") {
    const n = normalizeHostname(hostname)
    if (n) return n
  }
  if (typeof url === "string" && url) {
    try {
      return normalizeHostname(new URL(url).hostname)
    } catch {
      return undefined
    }
  }
  return undefined
}

// Per-thread abort controllers for cancelling in-flight LLM requests
const abortControllers = new Map<string, AbortController>()

/** Abort in-flight LLM for a thread (ADR-015 worker_cancel / chat.abort). */
export function abortThreadChat(threadId: string): boolean {
  if (!threadId) return false
  const controller = abortControllers.get(threadId)
  if (controller) {
    controller.abort()
    abortControllers.delete(threadId)
    return true
  }
  return false
}

/**
 * Inject (or override) the `name:` field in a knowledge doc's YAML frontmatter.
 * Used by directory import to guarantee each file lands at a unique filename —
 * importKnowledge sanitizes the name to a safe filename, and two files sharing
 * the same first-#-heading would otherwise overwrite each other.
 *
 * - If content has no frontmatter, prepend `---\nname: <name>\n---\n`.
 * - If content has frontmatter but no `name:` field, inject it as the first key.
 * - If content already has a `name:` field, replace its value.
 */
function injectKnowledgeName(content: string, name: string): string {
  const startsWithFm = content.startsWith("---")
  if (startsWithFm) {
    const endIdx = content.indexOf("\n---", 3)
    if (endIdx !== -1) {
      const fm = content.slice(0, endIdx)
      const rest = content.slice(endIdx)
      // Replace existing name line, or inject as first key after the opening ---
      if (/^name:.*$/m.test(fm)) {
        const updated = fm.replace(/^name:.*$/m, `name: ${name}`)
        return updated + rest
      }
      // No existing name — insert right after the opening "---"
      return `---\nname: ${name}` + fm.slice(3) + rest
    }
  }
  // No frontmatter at all — wrap the content
  return `---\nname: ${name}\n---\n${content}`
}

interface Services {
  threadManager: ThreadManager
  skillEngine: SkillEngine
  historyStore: HistoryStore
}

interface SessionCallbacks {
  sendToExtension: (data: any) => void
  executeTool: (toolCallId: string, toolName: string, params: any, signal?: AbortSignal) => Promise<{ success: boolean; data?: any; error?: string }>
  broadcast?: (data: any) => void
  /**
   * Origin-bound security-confirmation channel (App tab D2 biometric gates).
   * server.ts wires this exactly like executeTool's sendConfirmation —
   * securityConfirmations.request(..., { originWs: ws }) — so a confirmation
   * carrying a nonce challenge can only be resolved by the originating socket.
   */
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  /**
   * WP4: 面板(WS 连接)标识——computer.evidence.open 的 P6 频率上限按
   * 每面板计数。server.ts 为每个连接生成一个 id。
   */
  panelId?: string
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
      return {
        type: "config.updated",
        config: {
          ...config,
          // Preserve "is set" signal: "***" when an api_key exists, "" otherwise.
          // The frontend normalizes "***" back to "" but uses it as a truthy signal
          // for "已配置" indicators (UX fix: users had no way to tell their key was
          // already saved because the input was always blank).
          llm: { ...config.llm, api_key: config.llm.api_key ? "***" : "" },
          vision: config.vision ? { ...config.vision, api_key: config.vision.api_key ? "***" : "" } : undefined,
        },
      }
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
        if (isMaskedApiKey(normalized.llm.api_key)) delete normalized.llm.api_key
      } else if (cfg.base_url || cfg.model_name || cfg.temperature !== undefined || cfg.context_window !== undefined) {
        normalized.llm = {}
        if (cfg.base_url) normalized.llm.base_url = cfg.base_url
        if (cfg.api_key && !isMaskedApiKey(cfg.api_key)) normalized.llm.api_key = cfg.api_key
        if (cfg.model_name) normalized.llm.model_name = cfg.model_name
        if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
        if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window
      }
      if (cfg.port) normalized.port = cfg.port
      if (Array.isArray(cfg.trusted_domains)) normalized.trusted_domains = cfg.trusted_domains
      if (Array.isArray(cfg.auto_approved_domains)) normalized.auto_approved_domains = cfg.auto_approved_domains
      if (cfg.history_retention_days) normalized.history_retention_days = cfg.history_retention_days
      // `!== undefined` (not truthy) so the UI can disable retention/rotation by sending 0,
      // which the backend treats as "off" (pruneOldLogs / rotateLogFileIfNeeded early-return on <=0).
      if (cfg.log_retention_days !== undefined) normalized.log_retention_days = cfg.log_retention_days
      if (cfg.log_max_file_mb !== undefined) normalized.log_max_file_mb = cfg.log_max_file_mb
      // Security config: normalize flat security_* fields into nested security object.
      // The extension UI sends flattened fields (auto_approve_dangerous, allow_all_schemes)
      // at the top level; re-nest them under `security`, preserving the rest of the
      // current security block (deepMerge fills the partner field from current config).
      if (cfg.security && typeof cfg.security === "object") {
        normalized.security = { ...cfg.security }
      } else if (
        cfg.auto_approve_dangerous !== undefined ||
        cfg.allow_all_schemes !== undefined ||
        cfg.auto_approve_enterprise_tools !== undefined
      ) {
        const current = getConfig()
        normalized.security = { ...(current.security || {}) }
        if (cfg.auto_approve_dangerous !== undefined) {
          normalized.security.auto_approve_dangerous = !!cfg.auto_approve_dangerous
        }
        if (cfg.allow_all_schemes !== undefined) {
          normalized.security.allow_all_schemes = !!cfg.allow_all_schemes
        }
        if (cfg.auto_approve_enterprise_tools !== undefined) {
          normalized.security.auto_approve_enterprise_tools = !!cfg.auto_approve_enterprise_tools
        }
      }
      // Vision config: normalize flat vision_* fields into nested vision object
      if (cfg.vision) {
        normalized.vision = { ...cfg.vision }
        if (isMaskedApiKey(normalized.vision.api_key)) delete normalized.vision.api_key
      } else if (cfg.vision_enabled !== undefined || cfg.vision_base_url || cfg.vision_model_name) {
        const current = getConfig()
        normalized.vision = { ...(current.vision || {}) }
        if (cfg.vision_enabled !== undefined) normalized.vision.enabled = !!cfg.vision_enabled
        if (cfg.vision_api_key && !isMaskedApiKey(cfg.vision_api_key)) normalized.vision.api_key = cfg.vision_api_key
        if (cfg.vision_base_url) normalized.vision.base_url = cfg.vision_base_url
        if (cfg.vision_model_name) normalized.vision.model_name = cfg.vision_model_name
        if (cfg.vision_timeout_ms !== undefined) normalized.vision.timeout_ms = cfg.vision_timeout_ms
        if (cfg.vision_fallback) normalized.vision.fallback = cfg.vision_fallback
      }
      // File upload config: normalize flat file_upload_* fields into nested file_upload object
      if (cfg.file_upload) {
        normalized.file_upload = { ...cfg.file_upload }
      } else if (cfg.file_upload_max_size !== undefined || cfg.file_upload_max_tokens !== undefined || cfg.file_upload_vision !== undefined) {
        const current = getConfig()
        normalized.file_upload = { ...(current.file_upload || {}) }
        if (cfg.file_upload_max_size !== undefined) normalized.file_upload.max_file_size = cfg.file_upload_max_size
        if (cfg.file_upload_max_tokens !== undefined) normalized.file_upload.max_file_tokens = cfg.file_upload_max_tokens
        if (cfg.file_upload_vision !== undefined) normalized.file_upload.enable_vision_analysis = !!cfg.file_upload_vision
      }
      const updated = saveConfig(normalized)
      return {
        type: "config.updated",
        config: {
          ...updated,
          // Same "is set" signal preservation as config.get — see comment there.
          llm: { ...updated.llm, api_key: updated.llm.api_key ? "***" : "" },
          vision: updated.vision ? { ...updated.vision, api_key: updated.vision.api_key ? "***" : "" } : undefined,
        },
      }
    }

    case "config.test":
    case "settings.test": {
      const config = getConfig()
      // If the caller (extension UI) sends llm_override with a valid API key, test that
      // config; otherwise fall back to the companion's stored config (set via tray).
      const override = rest.llm_override as Record<string, unknown> | undefined
      const hasOverrideKey = !!(override?.api_key && !isMaskedApiKey(override.api_key as string))
      const testConfig = hasOverrideKey
        ? {
            api_key:        String(override!.api_key),
            base_url:       String(override!.base_url ?? config.llm.base_url),
            model_name:     String(override!.model_name ?? config.llm.model_name),
          }
        : {
            api_key:    config.llm.api_key,
            base_url:   config.llm.base_url,
            model_name: config.llm.model_name,
          }

      if (!testConfig.api_key || testConfig.api_key === "sk-placeholder" || isMaskedApiKey(testConfig.api_key)) {
        return { type: "config.testResult", ok: false, error: "API Key 未配置" }
      }
      try {
        const client = new OpenAI({
          baseURL: testConfig.base_url,
          apiKey:  testConfig.api_key,
          timeout: 10000,
          maxRetries: 0,
        })
        await client.models.list()
        return { type: "config.testResult", ok: true }
      } catch (e: any) {
        return { type: "config.testResult", ok: false, error: e.message || String(e) }
      }
    }

    case "config.testVision": {
      const config = getConfig()
      if (!config.vision?.enabled) {
        return { type: "config.testVisionResult", ok: false, error: "Vision not enabled" }
      }
      try {
        const client = new OpenAI({
          baseURL: config.vision.base_url,
          apiKey: config.vision.api_key || "ollama",
          timeout: 5000,
          maxRetries: 0,
        })
        await client.models.list()
        return { type: "config.testVisionResult", ok: true, model: config.vision.model_name }
      } catch (e: any) {
        return { type: "config.testVisionResult", ok: false, error: e.message || String(e) }
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
      if (cfg.api_key && !isMaskedApiKey(cfg.api_key)) normalized.llm.api_key = cfg.api_key
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

      // Merge priority: (1) llm_override from extension UI  > (2) thread config_override > (3) global config
      // llm_override is sent by the Chrome extension with its locally-stored API key,
      // allowing per-session credentials that take priority over the companion/tray config.
      const threadForConfig = services.threadManager.get(rest.thread_id)
      const threadLLMOverride = threadForConfig?.config_override || {}
      const effectiveLLMConfig = { ...config.llm }

      // (2) apply thread-level override
      for (const [key, val] of Object.entries(threadLLMOverride)) {
        if (key in effectiveLLMConfig && val !== undefined && val !== null) {
          (effectiveLLMConfig as any)[key] = val
        }
      }

      // (1) apply extension-level llm_override if it carries a valid API key
      const msgOverride = rest.llm_override as Record<string, unknown> | undefined
      if (msgOverride?.api_key && !isMaskedApiKey(msgOverride.api_key as string)) {
        for (const k of ["api_key", "base_url", "model_name", "temperature", "context_window"] as const) {
          if (msgOverride[k] !== undefined && msgOverride[k] !== null) {
            (effectiveLLMConfig as any)[k] = msgOverride[k]
          }
        }
      }

      // Cancel any existing request for this thread
      const existing = abortControllers.get(rest.thread_id)
      if (existing) {
        logger.info("llm.thread_request_superseded", { thread_id: rest.thread_id })
        existing.abort()
        abortControllers.delete(rest.thread_id)
      }

      // ADR-015: cap concurrent multi-agent LLM loops (workers + orchestrators)
      const threadForLlmCap = services.threadManager.get(rest.thread_id)
      const { tryAcquireMultiAgentLlmLoop, releaseMultiAgentLlmLoop } = await import("./orchestrator/llm-loop-gate")
      const loopGate = tryAcquireMultiAgentLlmLoop(threadForLlmCap, rest.thread_id)
      if (!loopGate.ok) {
        return {
          type: "chat.error",
          thread_id: rest.thread_id,
          error: loopGate.error,
          data: { error_code: "MULTI_AGENT_LLM_CAP", active: loopGate.active, cap: loopGate.cap },
        }
      }

      const controller = new AbortController()
      abortControllers.set(rest.thread_id, controller)

      try {
        // Get thread to determine skill and knowledge selection modes
        const thread = services.threadManager.get(rest.thread_id)
        const skillMode = thread?.skill_selection_mode || "auto"
        const knowledgeMode = thread?.knowledge_selection_mode || "auto"

        // Resolve skill IDs based on mode
        // hostname: site_knowledge auto-load only (extension SW sets it; not a trust gate)
        const currentHostname = normalizeChatHostname(rest.hostname, rest.url)
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
          config: effectiveLLMConfig,
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
        releaseMultiAgentLlmLoop(rest.thread_id)
      }
      return null // chatCreate handles streaming internally
    }

    case "file.upload": {
      if (!session) return { type: "error", error: "No session" }

      const { thread_id, files } = rest
      const config = getConfig()
      const fileConfig = config.file_upload || { max_file_size: 10 * 1024 * 1024, allowed_types: [] as string[], max_embedded_images: 20, enable_vision_analysis: true, max_file_tokens: 50000 }

      // Phase 1: Parse all files (text + embedded images)
      const parseResults: FileParseResult[] = []

      for (const file of files) {
        const { name, type, content } = file

        const decodedSize = Math.ceil(content.length * 0.75)
        if (decodedSize > fileConfig.max_file_size) {
          return {
            type: "file.upload_error",
            thread_id,
            error: `文件 "${name}" 过大 (${Math.round(decodedSize / 1024 / 1024)}MB)，最大支持 ${Math.round(fileConfig.max_file_size / 1024 / 1024)}MB`,
          }
        }

        if (fileConfig.allowed_types.length > 0 && !fileConfig.allowed_types.includes(type)) {
          return {
            type: "file.upload_error",
            thread_id,
            error: `不支持的文件类型: ${type}`,
          }
        }

        const buffer = Buffer.from(content, "base64")
        const parseResult = await Promise.race([
          parseFile(buffer, name, type),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`文件 "${name}" 解析超时 (30s)`)), 30000)
          ),
        ])

        if (!parseResult.success) {
          return { type: "file.upload_error", thread_id, error: parseResult.error }
        }

        parseResults.push(parseResult)
      }

      // Phase 2: Vision analysis for embedded images
      const visionEnabled = config.vision?.enabled && fileConfig.enable_vision_analysis !== false
      const finalFileContents: Array<{ filename: string; content: string }> = []

      for (const parseResult of parseResults) {
        let content = parseResult.text

        if (visionEnabled && parseResult.embeddedImages?.length) {
          const visionDescriptions: string[] = []
          for (const img of parseResult.embeddedImages) {
            if (img.format === "note") {
              visionDescriptions.push(img.title)
              continue
            }
            try {
              const visionResult = await analyzeImage(
                {
                  base64: img.base64,
                  width: img.width,
                  height: img.height,
                  url: "",
                  title: img.title,
                },
                config.vision!,
                `分析这张文档内嵌图片 "${img.title}" 的内容，提取所有可见文本和视觉信息。`,
              )
              visionDescriptions.push(`[图片: ${img.title}] ${visionResult.description}`)
            } catch {
              visionDescriptions.push(`[图片: ${img.title}] (视觉分析不可用)`)
            }
          }
          if (visionDescriptions.length > 0) {
            content += `\n\n<!-- 文档内嵌图片分析 -->\n${visionDescriptions.join("\n\n")}`
          }
        } else if (parseResult.embeddedImages?.length) {
          const note = parseResult.embeddedImages
            .filter(i => i.format !== "note")
            .map(i => i.title)
            .join(", ")
          if (note) {
            content += `\n\n[文档包含图片但视觉分析未启用: ${note}]`
          }
        }

        finalFileContents.push({ filename: parseResult.filename, content })
      }

      // Cancel any existing request for this thread
      const existingUpload = abortControllers.get(thread_id)
      if (existingUpload) {
        logger.info("llm.thread_request_superseded", { thread_id })
        existingUpload.abort()
        abortControllers.delete(thread_id)
      }
      const uploadController = new AbortController()
      abortControllers.set(thread_id, uploadController)

      try {
        const userMessage = rest.message || "请分析我上传的文件"
        const threadForConfig = services.threadManager.get(thread_id)
        const threadLLMOverride = threadForConfig?.config_override || {}
        const effectiveLLMConfig = { ...config.llm }
        for (const [key, val] of Object.entries(threadLLMOverride)) {
          if (key in effectiveLLMConfig && val !== undefined && val !== null) {
            (effectiveLLMConfig as any)[key] = val
          }
        }

        // Same skill/knowledge auto-load as chat.create (include site knowledge when hostname set)
        const skillMode = threadForConfig?.skill_selection_mode || "auto"
        const knowledgeMode = threadForConfig?.knowledge_selection_mode || "auto"
        const uploadHostname = normalizeChatHostname(rest.hostname, rest.url)
        const resolvedSkillIds = await services.skillEngine.resolveSkillIdsForThread(
          thread_id,
          skillMode,
          userMessage,
          uploadHostname,
        )
        const resolvedKnowledgeIds = services.skillEngine.resolveKnowledgeIdsForThread(
          thread_id,
          knowledgeMode,
          uploadHostname,
        )
        const allSkillIds = [...new Set([...resolvedSkillIds, ...(rest.skill_ids || [])])]

        await chatCreate({
          threadId: thread_id,
          message: userMessage,
          fileContents: finalFileContents,
          skillIds: allSkillIds,
          knowledgeIds: resolvedKnowledgeIds,
          config: effectiveLLMConfig,
          threadManager: services.threadManager,
          skillEngine: services.skillEngine,
          historyStore: services.historyStore,
          sendToExtension: session.sendToExtension,
          executeTool: session.executeTool,
          signal: uploadController.signal,
        })
      } catch (e: any) {
        if (e.name === "AbortError" || uploadController.signal.aborted) {
          session.sendToExtension({ type: "chat.aborted", thread_id })
        } else {
          session.sendToExtension({ type: "chat.error", thread_id, error: e.message })
        }
      } finally {
        abortControllers.delete(thread_id)
      }

      return { type: "file.uploaded", thread_id, files: finalFileContents.map(f => f.filename) }
    }

    case "file.query_chunks": {
      const { thread_id, query } = rest
      if (!thread_id || !query) return { type: "error", error: "thread_id and query required" }

      const config = getConfig()
      const maxFileTokens = config.file_upload?.max_file_tokens || 50000
      const messages = services.threadManager.getMessages(thread_id)

      // Find the most recent user message containing <document> tags
      let docContent = ""
      let docFilename = ""
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === "user" && msg.content.includes("<document")) {
          // Extract content between <document> tags
          const docRegex = /<document filename="([^"]+)">\n([\s\S]*?)\n<\/document>/g
          let match
          while ((match = docRegex.exec(msg.content)) !== null) {
            docFilename = match[1]
            docContent = match[2]
          }
          if (docContent) break
        }
      }

      if (!docContent) {
        return { type: "file.query_result", thread_id, chunks: [], message: "当前线程中没有上传的文件内容" }
      }

      const chunked = chunkFile(docFilename, docContent, maxFileTokens)
      const matched = searchChunks(chunked.chunks, query, 3)

      if (matched.length === 0) {
        return { type: "file.query_result", thread_id, chunks: [], message: "未找到与查询相关的内容片段" }
      }

      const chunkTexts = matched.map(c =>
        `--- 片段 ${c.index + 1}/${chunked.chunks.length} (约 ${c.tokenEstimate} tokens) ---\n${c.text}`
      ).join("\n\n")

      return {
        type: "file.query_result",
        thread_id,
        chunks: matched.map(c => ({ index: c.index, keywords: c.keywords, tokenEstimate: c.tokenEstimate })),
        content: chunkTexts,
        filename: docFilename,
        totalChunks: chunked.chunks.length,
      }
    }

    case "chat.abort": {
      abortThreadChat(rest.thread_id)
      // ADR-016 G13: abandon worker intents on host BEFORE pending reject + lease release
      try {
        const { abandonWorkerIntents } = await import("./board")
        await abandonWorkerIntents(services.threadManager, rest.thread_id, {
          reason: "chat.abort",
        })
      } catch {
        /* best-effort */
      }
      // ADR-015 GATE2: deny worker-stamped L2 confirmations first (frees admission/flight
      // via L2 finally), then reject CDP pending, then pending-aware lease release.
      try {
        const { rejectPendingForThread, hasPendingForTab, rejectPendingForTab, securityConfirmations } =
          await import("./server")
        securityConfirmations.rejectForWorker(rest.thread_id, "denied")
        rejectPendingForThread(rest.thread_id, `chat.abort:${rest.thread_id}`)
        const { releaseLeasesForThreadPendingAware } = await import("./orchestrator/tab-lease")
        releaseLeasesForThreadPendingAware(rest.thread_id, "chat.abort", {
          hasPendingForTab,
          rejectPendingForTab,
        })
      } catch {
        /* best-effort */
      }
      return { type: "chat.aborted", thread_id: rest.thread_id }
    }

    case "chat.regenerate": {
      if (!session) return { type: "error", error: "No session" }
      const config = getConfig()
      const { thread_id, message_id, message: editedMessage } = rest

      // Merge thread-level config_override with global config
      const threadForRegenConfig = services.threadManager.get(thread_id)
      const regenLLMOverride = threadForRegenConfig?.config_override || {}
      const regenEffectiveLLMConfig = { ...config.llm }
      for (const [key, val] of Object.entries(regenLLMOverride)) {
        if (key in regenEffectiveLLMConfig && val !== undefined && val !== null) {
          (regenEffectiveLLMConfig as any)[key] = val
        }
      }

      const messages = threadManager.getMessages(thread_id)
      const idx = messages.findIndex(m => m.id === message_id)
      if (idx < 0) return { type: "error", error: "Message not found" }

      let userMsg: typeof messages[0] | null = null
      let deleteFromId = message_id

      if (messages[idx].role === "user") {
        // Editing a user message: update its content and regenerate the reply.
        userMsg = messages[idx]
        if (editedMessage !== undefined && editedMessage !== userMsg.content) {
          threadManager.updateMessage(thread_id, message_id, { content: editedMessage })
          userMsg = { ...userMsg, content: editedMessage }
        }
        // Delete everything after this user message.
        const nextAssistantIdx = messages.findIndex((m, i) => i > idx && m.role === "assistant")
        if (nextAssistantIdx >= 0) {
          deleteFromId = messages[nextAssistantIdx].id
        } else {
          // No assistant reply yet; just notify and regenerate.
          deleteFromId = ""
        }
      } else if (messages[idx].role === "assistant") {
        // Regenerating an assistant message: find preceding user message.
        for (let i = idx - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            userMsg = messages[i]
            break
          }
        }
        if (!userMsg) return { type: "error", error: "No user message found before this assistant message" }
      } else {
        return { type: "error", error: "Can only regenerate user or assistant messages" }
      }

      if (deleteFromId) {
        threadManager.deleteMessagesFrom(thread_id, deleteFromId)
      }

      // Notify extension of updated message list
      session.sendToExtension({
        type: "thread.messages",
        messages: threadManager.getMessages(thread_id),
      })

      // Cancel any existing request for this thread
      const existing = abortControllers.get(thread_id)
      if (existing) {
        logger.info("llm.thread_request_superseded", { thread_id })
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
        const currentHostname = normalizeChatHostname(rest.hostname, rest.url)
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
          config: regenEffectiveLLMConfig,
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
    case "thread.cleanup_empty": {
      const deletedIds = threadManager.cleanupEmpty()
      // Notify all connected side panels so their thread lists stay in sync.
      if (session?.broadcast) {
        for (const threadId of deletedIds) {
          session.broadcast({ type: "thread.deleted", thread_id: threadId })
        }
      }
      return { type: "thread.cleanup_empty.completed", deleted_count: deletedIds.length, deleted_ids: deletedIds }
    }
    case "thread.generate_title": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const thread = threadManager.get(rest.thread_id)
      if (!thread) return { type: "error", error: `Thread not found: ${rest.thread_id}` }

      await generateThreadTitle({
        threadId: rest.thread_id,
        threadManager,
        config: getConfig().llm,
        sendToExtension: session?.sendToExtension || (() => {}),
        force: true,
      })

      return { type: "thread.title_generated", thread_id: rest.thread_id, thread: threadManager.get(rest.thread_id) }
    }
    case "thread.list":
      return { type: "thread.list", threads: threadManager.list() }
    case "thread.select":
      return { type: "thread.messages", messages: threadManager.getMessages(rest.thread_id) }
    case "thread.fork": {
      const sourceThread = threadManager.get(rest.thread_id)
      if (!sourceThread) return { type: "error", error: "Thread not found" }

      // Default to an empty alias instead of "分支-${sourceThread.id}". The old
      // default was persisted immediately and then tripped the "alias is set"
      // guard inside generateThreadTitle, so the forked thread was stuck with
      // a meaningless name forever (UI rendered it literally next to the
      // parent it forked from, looking like a duplicate). Empty alias makes
      // the UI fall back to the thread id and lets auto-titling kick in below.
      const newThread = threadManager.create(rest.alias || "")
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

      // Best-effort auto-title: if the forked-in prefix already has a user +
      // assistant exchange, summarize it into a fresh alias. force=false keeps
      // the LLM call cheap (skipped if the user passed an explicit alias), and
      // failure is silent — empty alias just falls back to the thread id in UI.
      const forkedConfig = getConfig().llm
      void generateThreadTitle({
        threadId: newThread.id,
        threadManager,
        config: forkedConfig,
        sendToExtension: session?.sendToExtension || (() => {}),
        force: false,
      })

      return { type: "thread.forked", thread: newThread, messages: threadManager.getMessages(newThread.id) }
    }
    case "thread.update": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const allowedUpdates: Record<string, any> = {}
      const updates = rest.updates || {}
      for (const key of ["alias", "config_override", "tool_whitelist", "pinned_tabs", "active_skill_ids", "skill_selection_mode", "knowledge_selection_mode", "mcp_selection_mode", "active_mcp_server_ids"]) {
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
      // Read from in-memory cache. Mutating handlers (skill.import / skill.delete /
      // skill.craft / etc.) already call skillEngine.refresh() after mutation, so the
      // cache is always fresh w.r.t. API changes. Removing the refresh here avoids a
      // synchronous 4-directory filesystem re-scan on every Skills-tab click and every
      // sidepanel reconnect (audit item 10). For external file edits, use skill.refresh.
      return { type: "skill.list", skills: skillEngine.list() }

    case "skill.refresh":
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list() }

    // --- User env / secrets (ADR-019) — independent of config.json ---
    // set/delete success response type is deliberately `user_env.updated` (same
    // snapshot as the multi-client broadcast) — not a distinct ack. Extension UI
    // (PR-2) must dispatch on `user_env.updated` for both direct reply + broadcast.
    case "user_env.list": {
      // Outbound only via buildUserEnvPublic (R2 / S8)
      const pub = buildUserEnvPublic(loadUserEnv())
      return { type: "user_env.list", ...pub }
    }
    case "user_env.set": {
      const vars = rest.vars
      if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
        return {
          type: "error",
          family: "user_env",
          error: "vars object required",
          error_code: "INVALID_PAYLOAD",
        }
      }
      const varsObj = vars as Record<string, unknown>
      // R1 / S3: never log plaintext values
      logger.info("user_env.set", {
        keys: Object.keys(varsObj),
        vars: redactUserEnvVarsForLog(varsObj),
      })
      const r = setUserEnvVars(varsObj)
      if (!r.ok) {
        return {
          type: "error",
          family: "user_env",
          error: r.error,
          error_code: r.error_code,
        }
      }
      const payload = { type: "user_env.updated" as const, ...r.public }
      try {
        session?.broadcast?.(payload)
      } catch {
        /* best-effort */
      }
      return payload
    }
    case "user_env.delete": {
      const keys = rest.keys
      if (!Array.isArray(keys)) {
        return {
          type: "error",
          family: "user_env",
          error: "keys array required",
          error_code: "INVALID_PAYLOAD",
        }
      }
      const safeKeys = keys.filter((k: unknown): k is string => typeof k === "string")
      logger.info("user_env.delete", { keys: safeKeys })
      const r = deleteUserEnvKeys(safeKeys)
      if (!r.ok) {
        return {
          type: "error",
          family: "user_env",
          error: r.error,
          error_code: r.error_code,
        }
      }
      const payload = { type: "user_env.updated" as const, ...r.public }
      try {
        session?.broadcast?.(payload)
      } catch {
        /* best-effort */
      }
      return payload
    }

    // --- MCP servers ---
    case "mcp.list": {
      return { type: "mcp.list", servers: getMcpManager().listServers() }
    }
    case "mcp.toggle_enabled": {
      const enabled = !!rest.enabled
      setMcpEnabled(enabled)
      // applyConfig is fired via configEvents listener in server.ts
      return { type: "mcp.list", servers: getMcpManager().listServers() }
    }
    case "mcp.add": {
      const name = String(rest.name || "").trim()
      const serverCfg = rest.server as McpServerConfig
      const validation = validateMcpServerConfig(name, serverCfg)
      if (validation) return { type: "error", error: validation }
      const config = getConfig()
      if (config.mcp?.servers?.[name]) {
        return { type: "error", error: `MCP server "${name}" already exists. Use mcp.update to modify.` }
      }
      const wasEmpty = Object.keys(config.mcp?.servers || {}).length === 0
      const newServers = { ...(config.mcp?.servers || {}), [name]: serverCfg }
      replaceMcpServers(newServers)
      // Auto-enable the global kill-switch when the user adds their first server.
      // Without this, the default `mcp.enabled: false` leaves the new server
      // disconnected with no UI surface to flip it (see mcp.toggle_enabled UI gap).
      if (wasEmpty && !config.mcp?.enabled) {
        setMcpEnabled(true)
      }
      return { type: "mcp.servers.updated", servers: getMcpManager().listServers() }
    }
    case "mcp.update": {
      const name = String(rest.name || "").trim()
      const patch = rest.patch as Partial<McpServerConfig>
      const config = getConfig()
      const existing = config.mcp?.servers?.[name]
      if (!existing) return { type: "error", error: `MCP server "${name}" not found` }
      if (hasPrototypePollutionKey(patch)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      const merged = { ...existing, ...patch } as McpServerConfig
      // Re-validate after merge
      const validation = validateMcpServerConfig(name, merged)
      if (validation) return { type: "error", error: validation }
      const newServers = { ...(config.mcp?.servers || {}), [name]: merged }
      replaceMcpServers(newServers)
      return { type: "mcp.servers.updated", servers: getMcpManager().listServers() }
    }
    case "mcp.delete": {
      const name = String(rest.name || "").trim()
      const config = getConfig()
      if (!config.mcp?.servers?.[name]) {
        return { type: "error", error: `MCP server "${name}" not found` }
      }
      const newServers = { ...config.mcp.servers }
      delete newServers[name]
      replaceMcpServers(newServers)
      return { type: "mcp.servers.updated", servers: getMcpManager().listServers() }
    }
    case "mcp.toggle_server": {
      const name = String(rest.name || "").trim()
      const enabled = !!rest.enabled
      const config = getConfig()
      const existing = config.mcp?.servers?.[name]
      if (!existing) return { type: "error", error: `MCP server "${name}" not found` }
      const newServers = { ...(config.mcp?.servers || {}), [name]: { ...existing, enabled } }
      replaceMcpServers(newServers)
      return { type: "mcp.servers.updated", servers: getMcpManager().listServers() }
    }
    case "mcp.set_selection": {
      // Per-thread MCP tool selection mode + active server ids (mirrors skill activation).
      // Persisted via thread.update — handled here as a convenience pass-through.
      const thread = threadManager.get(rest.thread_id)
      if (thread) {
        const patch: any = {}
        if (rest.mcp_selection_mode) patch.mcp_selection_mode = rest.mcp_selection_mode
        if (Array.isArray(rest.active_mcp_server_ids)) patch.active_mcp_server_ids = rest.active_mcp_server_ids
        threadManager.update(rest.thread_id, patch)
      }
      return { type: "mcp.selection_updated", thread_id: rest.thread_id }
    }

    // --- Apps (App tab, WP2) — delegated to apps/handlers.ts so gate/fs deps
    // stay injectable in tests. Mutations validate+normalize before
    // replaceAppsEntries and broadcast apps.updated (mcp.servers.updated parity).
    case "apps.list":
    case "apps.enumerate":
    case "apps.add":
    case "apps.remove":
    case "apps.set_policy":
    case "apps.set_enabled":
    case "apps.set_coordinate_allowed":
      return handleAppsMessage(msg, {
        requestConfirmation: session?.requestConfirmation,
        broadcast: session?.broadcast,
      })
    // --- Coordinate computer-use (A10 global switch; per-app bit lives under
    // apps.set_coordinate_allowed above) ---
    case "computer.get_state":
    case "computer.set_enabled":
    case "computer.evidence.open":
      return handleComputerMessage(msg, {
        requestConfirmation: session?.requestConfirmation,
        broadcast: session?.broadcast,
        // WP4: P6 频率上限按每面板(每 WS 连接)计数。
        panelId: session?.panelId,
      })
    // --- WP5 I3/I4: 模型实验层——开关族四路由 + 观测面/熔断复位；均 settings
    // 双层围栏（validateWsMessage + handler belt），set_enabled(true) 另过
    // 生物识别门（P5：requestConfirmation 通道注入，apps 系 :961-966 先例） ---
    case "computer.model.get_state":
    case "computer.model.reset_circuit_breaker":
    case "computer.model.set_enabled":
    case "computer.model.license_response":
    case "computer.model.download":
    case "computer.model.delete":
      return handleComputerModelMessage(msg, {
        requestConfirmation: session?.requestConfirmation,
        broadcast: session?.broadcast,
      })
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
    case "thread.export_obsidian": {
      // Serialize (a slice of) a thread to Obsidian markdown and return it for UI-side
      // Blob download. Mirrors skill.export. v1 is UI-download only — no file write here.
      const thread = services.threadManager.get(rest.thread_id)
      if (!thread) return { type: "error", error: "thread not found" }
      if (
        rest.scope !== "single" &&
        rest.scope !== "qa_pair" &&
        rest.scope !== "thread" &&
        rest.scope !== "summary"
      ) {
        return { type: "error", error: `invalid scope: ${rest.scope}` }
      }
      const messages = services.threadManager.getMessages(rest.thread_id)
      // For slice scopes, require a valid anchor — otherwise the serializer would silently
      // fall back to exporting the whole thread under a mismatched scope label. Summary and
      // thread scopes consume the whole thread, so no anchor is needed.
      if (rest.scope !== "thread" && rest.scope !== "summary") {
        if (!rest.anchor_message_id) {
          return { type: "error", error: "anchor_message_id is required for single/qa_pair scope" }
        }
        if (!messages.some((m: any) => m.id === rest.anchor_message_id)) {
          return { type: "error", error: "anchor_message_id not found in thread" }
        }
      }
      const obsCfg = getConfig().obsidian
      if (!obsCfg) return { type: "error", error: "obsidian export not configured" }
      // Apply the cached vault profile (P1) if present + matches the configured vault.
      const profile = loadCachedProfile(obsCfg.vault_path)
      // P2: find topically-related vault notes (from the cached index) for the [[wikilinks]] footer.
      const index = loadCachedIndex(obsCfg.vault_path)
      // P2: apply a vault template skeleton (default/first) if templates were detected.
      const template = pickTemplate(loadCachedTemplates(obsCfg.vault_path))
      let relatedNotes: string[] = []
      if (index) {
        const queryText = messages
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => m.content || "")
          .join(" ")
          .slice(0, 5000)
        if (queryText) relatedNotes = queryRelatedNotes(index, queryText, 5)
      }
      const threadMeta = {
        id: thread.id,
        alias: thread.alias,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
      }
      // P3 summary scope: send the (token-budgeted) thread to the LLM, then assemble a
      // summary note (LLM summary + folded full-conversation appendix + footer + template).
      // Mirrors the raw-export shape so the UI's existing download path handles it unchanged.
      if (rest.scope === "summary") {
        const llm = getConfig().llm
        let summary
        try {
          summary = await summarizeThread({
            messages,
            config: llm,
            contextWindow: llm.context_window,
          })
        } catch (e: any) {
          return { type: "error", error: `摘要生成失败: ${e.message || String(e)}` }
        }
        if (!summary) {
          return { type: "error", error: "对话太短或模型未返回可用摘要" }
        }
        const result = serializeSummaryToMarkdown(summary, messages, {
          config: obsCfg,
          thread: threadMeta,
          ...(profile ? { profile } : {}),
          ...(relatedNotes.length ? { relatedNotes } : {}),
          ...(template ? { template } : {}),
        })
        return {
          type: "thread.exported_obsidian",
          content: result.content,
          filename: result.filename,
          format: result.format,
        }
      }
      const result = serializeThreadToMarkdown(messages, {
        scope: rest.scope,
        anchorMessageId: rest.anchor_message_id,
        config: obsCfg,
        thread: threadMeta,
        ...(profile ? { profile } : {}),
        ...(relatedNotes.length ? { relatedNotes } : {}),
        ...(template ? { template } : {}),
      })
      return {
        type: "thread.exported_obsidian",
        content: result.content,
        filename: result.filename,
        format: result.format,
      }
    }
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

    // --- Knowledge ---
    case "knowledge.list":
      skillEngine.refresh()
      return { type: "knowledge.list", docs: skillEngine.listKnowledge() }
    case "knowledge.import": {
      if (rest.file) {
        // Import from binary file (docx/pdf/xlsx/etc.) — parse to markdown first
        const { name, content } = rest.file
        if (!name || !content) throw new Error("knowledge.import file requires 'name' and 'content'")
        const buffer = Buffer.from(String(content), "base64")
        const parsed = await parseFile(buffer, String(name), "application/octet-stream")
        if (!parsed.success) {
          return { type: "error", error: parsed.error }
        }
        const baseName = String(name).replace(/\.[^.]+$/, "")
        // Pass parsed text + fallback name; importKnowledge auto-generates frontmatter
        skillEngine.importKnowledge(parsed.text, baseName)
      } else if (rest.url) {
        // SSRF protection: reuse skill.import URL validation
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
          throw new Error("Redirects are not allowed for knowledge imports")
        }
        if (!response.ok) throw new Error(`Failed to fetch knowledge: ${response.status}`)
        const contentLength = response.headers.get("content-length")
        const maxSize = 10 * 1024 * 1024
        if (contentLength && parseInt(contentLength, 10) > maxSize) {
          throw new Error(`Knowledge file too large: ${contentLength} bytes (max ${maxSize})`)
        }
        const body = await response.text()
        if (body.length > maxSize) {
          throw new Error(`Knowledge file too large: ${body.length} bytes (max ${maxSize})`)
        }
        const urlFallback = path.basename(parsed.pathname || "url-import").replace(/\.[^.]+$/, "") || "url-import"
        skillEngine.importKnowledge(body, urlFallback)
      } else if (rest.content) {
        skillEngine.importKnowledge(rest.content)
      } else {
        throw new Error("knowledge.import requires 'content', 'url', or 'file'")
      }
      skillEngine.refresh()
      return { type: "knowledge.list", docs: skillEngine.listKnowledge() }
    }
    case "knowledge.import_directory": {
      // Companion-side bulk import. The extension-side <input webkitdirectory>
      // crashes Chromium 149's main process (SIGSEGV at 0x38 on CrBrowserMain)
      // when the user picks an iCloud-synced folder with many nested entries —
      // the crash is in native code BEFORE our JS runs, so any extension-side
      // guard (file count, size, try/catch) is too late. Routing the pick
      // through companion's native OS dialog sidesteps the Chromium bug entirely
      // and lets us enforce per-file size + total-count caps server-side.
      const pick = await pickFolderNative()
      if (pick.error) {
        return { type: "knowledge.import_directory_result", error: pick.error }
      }
      if (!pick.path) {
        return { type: "knowledge.import_directory_result", error: "未选择文件夹" }
      }

      const vaultPath = pick.path
      const MAX_FILES = 200
      const MAX_FILE_SIZE = 6 * 1024 * 1024
      const TEXT_EXTS = new Set(["md", "markdown", "txt", "csv", "html", "htm"])
      const BINARY_EXTS = new Set(["docx", "pdf", "xlsx", "pptx", "odt", "rtf"])

      let imported = 0
      let skippedOversize = 0
      let skippedUnsupported = 0
      let failed = 0
      let totalScanned = 0
      const errors: string[] = []

      // Iterative walk — same safety shape as scanVault() in obsidian/vault-profiler.ts:
      // skip dotfiles/dot-dirs (covers .DS_Store, .obsidian, .git, .icloud stubs),
      // never follow symlinks (use Dirent type, not stat), cap total files.
      const stack: string[] = [vaultPath]
      while (stack.length) {
        const dir = stack.pop() as string
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            stack.push(full)
          } else if (entry.isFile()) {
            if (totalScanned >= MAX_FILES) continue
            totalScanned++

            const ext = entry.name.split(".").pop()?.toLowerCase() || ""
            if (!TEXT_EXTS.has(ext) && !BINARY_EXTS.has(ext)) {
              skippedUnsupported++
              continue
            }

            try {
              const stat = fs.statSync(full)
              if (stat.size > MAX_FILE_SIZE) {
                skippedOversize++
                continue
              }

              const baseName = entry.name.replace(/\.[^.]+$/, "")
              // Pass the vault-relative path as nameOverride so importKnowledge
              // uses it instead of the first-#-heading. Without this, two files
              // sharing the same heading (common in Obsidian vaults — daily notes,
              // per-folder READMEs) would sanitize to the same filename and
              // silently overwrite each other. 笨牛棚: 79 .md files collapsed to
              // 5 unique docs without this override.
              const relPath = path.relative(vaultPath, full).replace(/\.[^.]+$/, "")

              if (TEXT_EXTS.has(ext)) {
                const content = fs.readFileSync(full, "utf-8")
                skillEngine.importKnowledge(content, baseName, relPath)
                imported++
              } else {
                const buffer = fs.readFileSync(full)
                const parsed = await parseFile(buffer, entry.name, "application/octet-stream")
                if (parsed.success) {
                  skillEngine.importKnowledge(parsed.text, baseName, relPath)
                  imported++
                } else {
                  failed++
                  if (errors.length < 5) errors.push(`${entry.name}: ${parsed.error}`)
                }
              }
            } catch (e: any) {
              failed++
              if (errors.length < 5) errors.push(`${entry.name}: ${e.message || String(e)}`)
            }
          }
        }
      }

      skillEngine.refresh()

      return {
        type: "knowledge.import_directory_result",
        path: vaultPath,
        imported,
        skippedOversize,
        skippedUnsupported,
        failed,
        totalScanned,
        truncated: totalScanned >= MAX_FILES,
        maxFiles: MAX_FILES,
        errors,
        docs: skillEngine.listKnowledge(),
      }
    }
    case "knowledge.delete":
      skillEngine.deleteKnowledge(rest.name)
      return { type: "knowledge.deleted", name: rest.name }

    // --- Mission Packs (P0) ---
    case "fleet.status": {
      const { buildFleetSnapshot } = await import("./orchestrator/fleet")
      // Stage 3: reap stale intents on active orchestrator hosts when polling fleet
      try {
        const { reapStaleIntents } = await import("./board/intent-claim")
        for (const t of threadManager.list() as any[]) {
          if (t.agent_role === "orchestrator" || (t.board_mode && t.agent_role !== "worker")) {
            await reapStaleIntents(threadManager, t.id)
          }
        }
      } catch {
        /* ignore */
      }
      return buildFleetSnapshot(threadManager)
    }
    case "board.get": {
      const tid = typeof rest.thread_id === "string" ? rest.thread_id : null
      if (!tid) return { type: "error", error: "board.get requires thread_id" }
      const { readBoard, resolveBoardHostThreadId, boardReadForTool } = await import("./board")
      const hostId = resolveBoardHostThreadId(threadManager, tid) || tid
      const toolView = boardReadForTool(threadManager, hostId)
      const raw = readBoard(threadManager, hostId)
      return {
        type: "board.get",
        thread_id: tid,
        host_thread_id: hostId,
        raw_board: raw,
        board: toolView.data?.board ?? null,
        open_intent_count: raw
          ? raw.intents.filter((i) => i.status === "open" || i.status === "claimed").length
          : 0,
      }
    }
    case "board.add_hint": {
      const tid = typeof rest.thread_id === "string" ? rest.thread_id : null
      const text = typeof rest.text === "string" ? rest.text : ""
      if (!tid) return { type: "error", error: "board.add_hint requires thread_id" }
      if (!text.trim()) return { type: "error", error: "board.add_hint requires text" }
      const { addHint, resolveBoardHostThreadId, ensureBoard } = await import("./board")
      const hostId = resolveBoardHostThreadId(threadManager, tid) || tid
      const host = threadManager.get(hostId) as any
      if (host?.board_mode) {
        await ensureBoard(threadManager, hostId, { force: false })
      }
      const r = await addHint(threadManager, hostId, text.trim(), {
        actor_type: "user",
        thread_id: hostId,
      })
      if (!r.ok) return { type: "error", error: r.error }
      return {
        type: "board.add_hint_result",
        thread_id: tid,
        host_thread_id: hostId,
        raw_board: r.board,
      }
    }
    case "fleet.stop_all": {
      const runId = typeof rest.orchestrator_run_id === "string" ? rest.orchestrator_run_id : null
      const { listWorkers } = await import("./orchestrator/spawn")
      const { releaseLeasesForThreadPendingAware } = await import("./orchestrator/tab-lease")
      const { rejectPendingForThread, hasPendingForTab, rejectPendingForTab, securityConfirmations } =
        await import("./server")
      let targets: any[] = []
      if (runId) {
        targets = listWorkers(threadManager, runId)
      } else {
        targets = threadManager.list().filter((t: any) => t.agent_role === "worker")
      }
      const results: any[] = []
      for (const w of targets) {
        abortThreadChat(w.id)
        // G13: abandon intents on host before pending reject + lease release
        let intentsAbandoned = 0
        try {
          const { abandonWorkerIntents } = await import("./board")
          const ab = await abandonWorkerIntents(threadManager, w.id, {
            reason: "fleet.stop_all",
          })
          intentsAbandoned = ab.abandoned
        } catch {
          /* best-effort */
        }
        // GATE2: deny L2 first so admission/flight free via finally; then tools + leases
        const confirmsRejected = securityConfirmations.rejectForWorker(w.id, "denied")
        const rejected = rejectPendingForThread(w.id, `fleet.stop_all:${w.id}`)
        const { released, drained } = releaseLeasesForThreadPendingAware(w.id, "fleet.stop_all", {
          hasPendingForTab,
          rejectPendingForTab,
        })
        threadManager.update(w.id, { paused: true } as any)
        results.push({
          worker_id: w.id,
          rejected,
          released,
          confirms_rejected: confirmsRejected,
          leases_drained: drained,
          intents_abandoned: intentsAbandoned,
        })
      }
      const { buildFleetSnapshot } = await import("./orchestrator/fleet")
      return { type: "fleet.stop_all_result", results, fleet: buildFleetSnapshot(threadManager) }
    }
    case "worker.pause": {
      if (!rest.worker_id) return { type: "error", error: "worker_id required" }
      const w = threadManager.update(String(rest.worker_id), { paused: true } as any)
      if (!w) return { type: "error", error: "worker not found" }
      abortThreadChat(String(rest.worker_id))
      return { type: "worker.updated", worker: w }
    }
    case "worker.resume": {
      if (!rest.worker_id) return { type: "error", error: "worker_id required" }
      const w = threadManager.update(String(rest.worker_id), { paused: false } as any)
      if (!w) return { type: "error", error: "worker not found" }
      return { type: "worker.updated", worker: w }
    }
    case "tab.force_release": {
      if (typeof rest.tab_id !== "number") return { type: "error", error: "tab_id number required" }
      const { forceReleaseTab, completeForceRelease, getTabLease } = await import("./orchestrator/tab-lease")
      const { rejectPendingForThread, hasPendingForTab } = await import("./server")
      const before = getTabLease(rest.tab_id)
      let rejected = 0
      let draining = false
      if (before) {
        const pending = hasPendingForTab(rest.tab_id, before.holderThreadId)
        if (pending) {
          // Mark FORCE_RELEASING while in-flight CDP exists, then drain pending.
          forceReleaseTab(rest.tab_id, rest.by || "user", { hasPending: true })
          draining = true
        }
        rejected = rejectPendingForThread(
          before.holderThreadId,
          `tab.force_release:${rest.tab_id}`,
          rest.tab_id,
        )
        // Pending promises resolved; free the lease (complete FORCE_RELEASING or instant free).
        if (draining) {
          completeForceRelease(rest.tab_id, "force_release_after_reject")
        } else {
          forceReleaseTab(rest.tab_id, rest.by || "user", { hasPending: false })
        }
      } else {
        forceReleaseTab(rest.tab_id, rest.by || "user")
      }
      const { buildFleetSnapshot } = await import("./orchestrator/fleet")
      return {
        type: "tab.force_release_result",
        tab_id: rest.tab_id,
        rejected_pending: rejected,
        was_draining: draining,
        fleet: buildFleetSnapshot(threadManager),
      }
    }
    case "pack.list": {
      const { listInstalledPacks } = await import("./packs/pack-engine")
      return { type: "pack.list", packs: listInstalledPacks(getConfig()) }
    }
    case "pack.install": {
      const { installPackFromDirectory, installPackFromZip } = await import("./packs/pack-engine")
      if (rest.zip_path && typeof rest.zip_path === "string") {
        const r = installPackFromZip(rest.zip_path, skillEngine, { force: !!rest.force })
        if (!r.ok) return { type: "error", error: r.error }
        return { type: "pack.installed", id: r.id, packs: (await import("./packs/pack-engine")).listInstalledPacks() }
      }
      if (rest.dir && typeof rest.dir === "string") {
        const r = installPackFromDirectory(rest.dir, skillEngine, { force: !!rest.force })
        if (!r.ok) return { type: "error", error: r.error }
        return {
          type: "pack.installed",
          id: r.id,
          packs: (await import("./packs/pack-engine")).listInstalledPacks(),
        }
      }
      return { type: "error", error: "pack.install requires dir or zip_path" }
    }
    case "pack.apply": {
      const { applyPack } = await import("./packs/pack-engine")
      if (!rest.pack_id || !rest.thread_id) {
        return { type: "error", error: "pack_id and thread_id required" }
      }
      const r = applyPack(rest.pack_id, rest.thread_id, threadManager, skillEngine, {
        workspace_path: rest.workspace_path,
      })
      if (!r.ok) {
        return { type: "error", error: r.error, code: (r as any).code }
      }
      return { type: "pack.applied", thread: r.thread }
    }
    case "pack.uninstall": {
      const { uninstallPack, listInstalledPacks } = await import("./packs/pack-engine")
      if (!rest.pack_id) return { type: "error", error: "pack_id required" }
      const r = uninstallPack(rest.pack_id, threadManager, skillEngine)
      if (!r.ok) return { type: "error", error: r.error }
      return {
        type: "pack.uninstalled",
        pack_id: rest.pack_id,
        restored_threads: r.restored_threads,
        packs: listInstalledPacks(),
      }
    }
    case "modules.list": {
      const config = getConfig()
      return {
        type: "modules.list",
        capability_profile: config.capability_profile || "community",
        modules: config.modules || {},
      }
    }
    case "modules.set_enabled": {
      const { setModuleEnabled } = await import("./capability/modules")
      if (!rest.module || typeof rest.module !== "string") {
        return { type: "error", error: "module required" }
      }
      if (typeof rest.enabled !== "boolean") {
        return { type: "error", error: "enabled boolean required" }
      }
      const r = setModuleEnabled(rest.module, rest.enabled, rest.by || "user")
      if (!r.ok) return { type: "error", error: r.error }
      return { type: "modules.updated", modules: r.modules }
    }
    case "modules.update": {
      const { updateModuleConfig } = await import("./capability/modules")
      if (!rest.module || typeof rest.module !== "string") {
        return { type: "error", error: "module required" }
      }
      const r = updateModuleConfig(rest.module as any, rest.patch || {})
      if (!r.ok) return { type: "error", error: r.error }
      return { type: "modules.updated", module: r.module, modules: getConfig().modules }
    }
    case "workspace.pick": {
      // Optional thread_id: pick + bind in one step (avoids UI race / stale set)
      const result = await pickFolderNative()
      if (result.error) return { type: "workspace.pick_result", error: result.error }
      if (!result.path) return { type: "workspace.pick_result", error: "未选择文件夹" }
      const { recordNativePick, setWorkspaceRoot } = await import("./capability/workspace")
      let abs = result.path
      try {
        abs = fs.realpathSync(path.resolve(result.path))
      } catch {
        /* keep result.path */
      }
      recordNativePick(abs)
      if (typeof rest.thread_id === "string" && rest.thread_id) {
        const thread = threadManager.get(rest.thread_id)
        if (!thread) {
          return { type: "workspace.pick_result", path: abs, error: `thread not found: ${rest.thread_id}` }
        }
        const bind = setWorkspaceRoot(abs)
        if (!bind.ok) return { type: "workspace.pick_result", path: abs, error: bind.error }
        threadManager.update(rest.thread_id, { workspace_root: bind.path } as any)
        return {
          type: "workspace.pick_result",
          path: bind.path,
          bound: true,
          thread: threadManager.get(rest.thread_id),
        }
      }
      return { type: "workspace.pick_result", path: abs, bound: false }
    }
    case "workspace.set": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      const { setWorkspaceRoot } = await import("./capability/workspace")
      const pathVal = typeof rest.path === "string" ? rest.path : ""
      const r = setWorkspaceRoot(pathVal)
      if (!r.ok) return { type: "error", error: r.error }
      const thread = threadManager.get(rest.thread_id)
      if (!thread) return { type: "error", error: "thread not found" }
      threadManager.update(rest.thread_id, { workspace_root: r.path } as any)
      return { type: "workspace.set_result", thread: threadManager.get(rest.thread_id) }
    }
    case "netsec.authorize_task": {
      if (!rest.thread_id) return { type: "error", error: "thread_id required" }
      if (rest.authorized !== true) {
        return { type: "error", error: "authorized must be true (user must explicitly confirm)" }
      }
      // Require explicit UI confirmation flag from PacksPanel (user clicked confirm)
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "user_gesture required — authorization must follow an explicit UI confirmation",
        }
      }
      const targets = Array.isArray(rest.targets)
        ? rest.targets.filter((t: any) => typeof t === "string" && t.trim())
        : []
      if (targets.length === 0) return { type: "error", error: "targets required" }
      const { getModule } = await import("./capability/modules")
      const { assertTargetsAllowed } = await import("./netsec/scope")
      const mod = getModule("netsec")
      const allowlist = mod?.target_allowlist || []
      const scope = assertTargetsAllowed(targets, allowlist)
      if (!scope.ok) return { type: "error", error: scope.error }
      const thread = threadManager.get(rest.thread_id)
      if (!thread) return { type: "error", error: "thread not found" }
      const auth = {
        authorized: true as const,
        targets,
        at: new Date().toISOString(),
      }
      threadManager.update(rest.thread_id, { netsec_task_auth: auth } as any)
      const { appendCapabilityAudit } = await import("./packs/audit-log")
      appendCapabilityAudit({
        type: "netsec.task_auth",
        targets,
        by: rest.by || "user",
        at: auth.at,
        thread_id: rest.thread_id,
      })
      return { type: "netsec.authorized", thread: threadManager.get(rest.thread_id) }
    }

    case "enterprise.session_trust.status": {
      const { enterpriseSessionTrust, resolveEnterpriseTrustKey } = await import(
        "./capability/enterprise-session-trust"
      )
      const key = resolveEnterpriseTrustKey(rest.thread_id)
      if (!key) return { type: "enterprise.session_trust.status", trust_key: null, grant: null }
      const g = enterpriseSessionTrust.getGrant(key)
      if (!g) return { type: "enterprise.session_trust.status", trust_key: key, grant: null }
      const now = Date.now()
      return {
        type: "enterprise.session_trust.status",
        trust_key: key,
        grant: {
          families: g.families,
          remaining_netsec_ms: enterpriseSessionTrust.remainingMs(key, "netsec", now),
          remaining_shell_ms: enterpriseSessionTrust.remainingMs(key, "shell", now),
          granted_at: g.grantedAt,
          last_interactive_at: g.lastInteractiveAt,
        },
      }
    }
    case "enterprise.session_trust.revoke": {
      const { enterpriseSessionTrust, resolveEnterpriseTrustKey } = await import(
        "./capability/enterprise-session-trust"
      )
      const key = resolveEnterpriseTrustKey(rest.thread_id)
      if (!key) return { type: "error", error: "thread_id required" }
      if (rest.family === "netsec" || rest.family === "shell") {
        enterpriseSessionTrust.revokeFamily(key, rest.family)
      } else {
        enterpriseSessionTrust.revoke(key)
      }
      return { type: "enterprise.session_trust.revoked", trust_key: key, family: rest.family || "all" }
    }

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
    case "obsidian.pick_vault_folder": {
      // Open the OS native folder-picker (companion-side; extensions can't read real paths)
      // and return the chosen vault path. The UI adopts it as the obsidian vault_path.
      const result = await pickFolderNative()
      return {
        type: "obsidian.vault_folder_picked",
        ...(result.path ? { path: result.path } : { error: result.error || "未选择文件夹" }),
      }
    }
    case "obsidian.refresh_profile": {
      // Scan the user's Obsidian vault, extract conventions via LLM, cache the profile (P1).
      // On-demand (user clicks refresh); export then applies the cached profile.
      try {
        const raw = rest.vault_path ? rest.vault_path : getConfig().obsidian?.vault_path
        if (!raw) {
          return { type: "error", error: "vault_path 未设置（请在 设置 → Obsidian 填写）" }
        }
        let resolved: string
        try {
          resolved = resolveVaultPath(raw)
        } catch (e: any) {
          return { type: "error", error: e.message || "invalid vault_path" }
        }
        let stat: fs.Stats
        try {
          stat = fs.statSync(resolved)
        } catch {
          return { type: "error", error: `vault 路径不存在: ${resolved}` }
        }
        if (!stat.isDirectory()) {
          return { type: "error", error: `vault 路径不是目录: ${resolved}` }
        }
        // Persist the resolved vault_path so later exports can find the cached profile.
        const curObs = getConfig().obsidian
        saveConfig({
          obsidian: {
            name_template: curObs?.name_template ?? "{{date}} {{first_user_line}}",
            default_frontmatter: curObs?.default_frontmatter ?? { tags: ["cmspark"] },
            vault_path: resolved,
          },
        })
        const profile = await profileVault({ vaultPath: resolved, config: getConfig().llm })
        if (!profile) {
          return {
            type: "obsidian.profile_ready",
            profile: null,
            reason: "未识别到 vault 结构化约定（空 vault 或 LLM 未提取出）",
          }
        }
        saveProfile(profile)
        // P2: also build the note index for export-time [[wikilinks]] (best-effort, non-blocking —
        // an index failure must not fail the profile refresh).
        let index_count: number | undefined
        try {
          const index = buildVaultIndex(resolved)
          saveIndex(index)
          index_count = index.entries.length
        } catch {
          /* index is best-effort */
        }
        // P2: detect vault templates (best-effort, non-blocking) for export-time skeleton.
        let template_count: number | undefined
        try {
          const templates = detectTemplates(resolved)
          saveTemplates(templates)
          template_count = templates.templates.length
        } catch {
          /* templates best-effort */
        }
        return {
          type: "obsidian.profile_ready",
          profile,
          files_sampled: profile.files_sampled,
          index_count,
          template_count,
        }
      } catch (e: any) {
        return { type: "error", error: `vault 分析失败: ${e.message || String(e)}` }
      }
    }

    // --- History ---
    case "history.query":
      return {
        type: "history.result",
        operations: await historyStore.query(rest),
      }
    case "history.export":
      return {
        type: "history.exported",
        data: await historyStore.exportJSON(rest),
      }

    // --- System ---

    // osascript_eval: execute JS in Chrome tab via AppleScript (bypasses CSP + debugger)
    // SECURITY: This route delegates to session.executeTool which routes to executeCompanionTool
    // in server.ts. The AppleScript is built with static -e arguments and argv passing — no
    // string replacement of user input into the script body.
    case "osascript_eval": {
      const r = rest as { url?: string; expression?: string; code?: string }
      const pageUrl = typeof r.url === "string" ? r.url : ""
      const jsExpr =
        (typeof r.expression === "string" && r.expression) ||
        (typeof r.code === "string" && r.code) ||
        ""
      if (!pageUrl || !jsExpr) {
        return {
          type: "tool.result",
          id: msg.id,
          success: false,
          error:
            "osascript_eval requires url and expression. " +
            "url = fragment matching the Chrome tab (e.g. 'zhihu.com'); " +
            "expression = JS to run in that tab. " +
            `Got url=${pageUrl ? "set" : "missing"}, expression=${jsExpr ? "set" : "missing"}.`,
        }
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
      const actionId = rest.actionId || rest.id
      if (!actionId || typeof actionId !== "string") {
        return { type: "error", error: "actionId required" }
      }

      const ALIASES: Record<string, string> = {
        "read-page": "📖 读取当前页面",
        "screenshot": "📸 截图并分析",
        "extract-data": "📝 提取页面数据",
        "summarize": "📋 总结页面",
        "new-chat": "💬 新对话",
      }
      const PROMPTS: Record<string, string> = {
        "read-page": "请读取当前页面的内容",
        "screenshot": "请截图当前页面并分析截图中的内容",
        "extract-data": "请提取当前页面的主要数据内容",
        "summarize": "请总结当前页面的内容",
        "new-chat": "",
      }

      const alias = ALIASES[actionId] || actionId
      const thread = threadManager.create(alias)
      const prompt = PROMPTS[actionId] ?? ""

      // Always broadcast thread creation so sidepanel can discover it
      if (session?.broadcast) {
        session.broadcast({ type: "thread.created", thread, auto_select: true })
      }

      if (prompt && session?.broadcast) {
        session.broadcast({
          type: "quickAction.start",
          thread_id: thread.id,
          actionId,
          prompt,
          alias,
        })
      }

      return { type: "quickAction.result", id: msg.id, actionId, success: true, thread_id: thread.id }
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
    const val = obj[key]
    if (typeof val === "object" && hasPrototypePollutionKey(val)) return true
  }
  return false
}

// --- MCP helpers ---

const MCP_VALID_TRUST_LEVELS = new Set(["manual", "first-use", "trusted"])
const MCP_VALID_TRANSPORTS = new Set(["stdio", "http"])
const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/** Returns an error string if invalid, or null if OK. */
function validateMcpServerConfig(name: string, cfg: McpServerConfig | undefined): string | null {
  if (!name) return "MCP server name is required"
  if (!MCP_NAME_PATTERN.test(name)) {
    return `Invalid MCP server name "${name}": only letters, digits, underscore, and hyphen allowed`
  }
  if (!cfg) return "MCP server config is required"
  if (hasPrototypePollutionKey(cfg)) return "Invalid MCP server config keys"
  if (!MCP_VALID_TRANSPORTS.has(cfg.transport)) {
    return `Invalid MCP transport "${cfg.transport}" (must be stdio or http)`
  }
  if (cfg.transport === "stdio") {
    if (!cfg.command || typeof cfg.command !== "string") {
      return `MCP stdio server "${name}" requires a command`
    }
    if (cfg.args !== undefined && !Array.isArray(cfg.args)) return `args must be an array`
    if (cfg.env !== undefined && (typeof cfg.env !== "object" || Array.isArray(cfg.env))) {
      return `env must be an object`
    }
    if (cfg.cwd !== undefined && typeof cfg.cwd !== "string") return `cwd must be a string`
  } else {
    if (!cfg.url || typeof cfg.url !== "string") {
      return `MCP http server "${name}" requires a url`
    }
    try {
      new URL(cfg.url)
    } catch {
      return `MCP http server "${name}" has invalid url: ${cfg.url}`
    }
    if (cfg.headers !== undefined && (typeof cfg.headers !== "object" || Array.isArray(cfg.headers))) {
      return `headers must be an object`
    }
  }
  if (!MCP_VALID_TRUST_LEVELS.has(cfg.trust_level)) {
    return `Invalid trust_level "${cfg.trust_level}" (must be manual, first-use, or trusted)`
  }
  if (cfg.roots !== undefined) {
    if (!Array.isArray(cfg.roots)) return `roots must be an array`
    for (const root of cfg.roots) {
      if (!root || typeof root !== "object" || Array.isArray(root)) {
        return `each root must be an object with a uri string`
      }
      if (typeof root.uri !== "string" || !root.uri) {
        return `each root must have a non-empty uri string`
      }
      if (root.name !== undefined && typeof root.name !== "string") {
        return `root name must be a string`
      }
    }
  }
  return null
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
