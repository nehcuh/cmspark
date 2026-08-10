// Message router — dispatches incoming WebSocket messages to handlers
// FREEZE (C10 multi-adv 2026-08-10 / phase-A 2026-08-11):
// NEW business handlers must not grow this file — extract a family module under
// message-router/handlers/ (see handlers/config.ts) and keep a thin case arm here
// so ws-router-validator-lockstep still sees the case labels. Prefer
// handleXMessage(rest) over inlining multi-hundred-line cases.
// Deferred: full family split for chat/thread/skill/pack/mcp/…

import os from "os"
import * as fs from "fs"
import path from "path"
import { URL } from "url"
import type { ThreadManager } from "./threads/thread-manager"
import { serializeThreadToMarkdown, serializeSummaryToMarkdown } from "./threads/markdown-export"
import { summarizeThread } from "./threads/summary-export"
import {
  aliasFromFirstUserText,
  extractThreadDigest,
  extractThreadDigestQueued,
  isDigestStale,
} from "./threads/digest"
import { suggestCleanupRules } from "./threads/cleanup-rules"
import { buildContextRefsSystemSegment, type ContextRefInput } from "./threads/context-refs"
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
import { OSASCRIPT_MACOS_ONLY_ERROR } from "./bridge/tool-definitions"
import { getMcpManager } from "./mcp"
import { logger } from "./logger"
import { handleAppsMessage } from "./apps/handlers"
import { handleComputerMessage } from "./computer/handlers"
import { handleComputerModelMessage } from "./computer/model-handlers"
import { handleVoiceModelMessage } from "./voice/whisper-handlers"
import { handleVoiceSttMessage } from "./voice/stt-handlers"
import { handleVoiceRefineMessage } from "./voice/refine-handlers"
import { handleDictationHoldState } from "./voice/dictation-hotkey"
import { handleMeetingMessage } from "./meeting/meeting-handlers"
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
import { releaseMultiAgentLlmLoop } from "./orchestrator/llm-loop-gate"
import {
  handleConfigFamily,
  hasPrototypePollutionKey,
} from "./message-router/handlers/config"

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
/**
 * SEC-D: generation token per thread so a superseded run's `finally` cannot
 * delete the successor AbortController or release the multi-agent LLM gate.
 */
const llmLoopGeneration = new Map<string, number>()

/** Run-state: threads with an in-flight LLM abort controller. */
export function listLlmActiveThreadIds(): string[] {
  return [...abortControllers.keys()]
}

/**
 * Test-only: mark a thread as LLM-busy (in-flight abort controller).
 * Production code must not call this — use the chat path instead.
 */
export function __testSetLlmActiveForTests(threadId: string, active: boolean): void {
  if (active) {
    abortControllers.set(threadId, new AbortController())
    llmLoopGeneration.set(threadId, (llmLoopGeneration.get(threadId) || 0) + 1)
  } else {
    abortControllers.delete(threadId)
    llmLoopGeneration.delete(threadId)
  }
}

/** Abort in-flight LLM for a thread (ADR-015 worker_cancel / chat.abort). */
export function abortThreadChat(threadId: string): boolean {
  if (!threadId) return false
  const controller = abortControllers.get(threadId)
  if (controller) {
    controller.abort()
    abortControllers.delete(threadId)
    // Bump generation so any late finally from this run cannot reclaim the slot
    // or clobber a successor. Because finally will CAS-skip release, we must
    // free the multi-agent gate here (Pi REJECT: abort leaked MULTI_AGENT_LLM_CAP).
    llmLoopGeneration.set(threadId, (llmLoopGeneration.get(threadId) || 0) + 1)
    // Free gate here: finally will CAS-skip release after generation bump.
    releaseMultiAgentLlmLoop(threadId)
    return true
  }
  return false
}

function nextLlmGeneration(threadId: string): number {
  const gen = (llmLoopGeneration.get(threadId) || 0) + 1
  llmLoopGeneration.set(threadId, gen)
  return gen
}

/** Drain extension tools + L2 for a thread when superseding (mirror chat.abort core). */
async function drainThreadOnSupersede(threadId: string, reason: string): Promise<void> {
  try {
    const { rejectPendingForThread, securityConfirmations } = await import("./server")
    securityConfirmations.rejectForWorker(threadId, "denied")
    rejectPendingForThread(threadId, reason)
  } catch {
    /* best-effort */
  }
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
  /**
   * Path B M1: WS Origin at connection time (chrome-extension:// vs tray).
   * voice.stt.* handlers refuse non-extension peers (ADR-023 §7.2).
   */
  origin?: string
}

export async function handleMessage(
  msg: any,
  services: Services,
  session?: SessionCallbacks,
): Promise<any> {
  const { type, ...rest } = msg
  const { threadManager, skillEngine, historyStore } = services

  switch (type) {
    // --- Config (C10-C: handlers/config.ts) ---
    case "config.get":
    case "config.set":
    case "config.test":
    case "settings.test":
    case "config.testVision":
    case "settings.get":
    case "settings.set": {
      const cfgResult = await handleConfigFamily(type, rest)
      if (cfgResult !== null) return cfgResult
      return { type: "error", error: `Unhandled config type: ${type}` }
    }

    // --- Chat ---
    case "chat.create": {
      if (!session) return { type: "error", error: "No session" }
      // Dual-review residual: do not run LLM against soft-deleted / paused threads
      {
        const thrGate = services.threadManager.get(rest.thread_id)
        if (!thrGate) {
          return { type: "chat.error", thread_id: rest.thread_id, error: "Thread not found" }
        }
        if (thrGate.trashed_at) {
          return {
            type: "chat.error",
            thread_id: rest.thread_id,
            error: "thread_trashed",
            data: { error_code: "thread_trashed" },
          }
        }
        if (thrGate.paused) {
          return {
            type: "chat.error",
            thread_id: rest.thread_id,
            error: "thread_paused",
            data: { error_code: "thread_paused" },
          }
        }
      }
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

      // Cancel any existing request for this thread (SEC-D: do not delete map yet —
      // predecessor finally uses generation CAS so it cannot clobber successor).
      const existing = abortControllers.get(rest.thread_id)
      if (existing) {
        logger.info("llm.thread_request_superseded", { thread_id: rest.thread_id })
        existing.abort()
        await drainThreadOnSupersede(rest.thread_id, `chat.supersede:${rest.thread_id}`)
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

      const myGeneration = nextLlmGeneration(rest.thread_id)
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

        // P1.5: resolve @ thread context refs (summary_card, fallback-first)
        let contextRefsSegment: string | undefined
        const rawRefs = rest.context_refs
        if (Array.isArray(rawRefs) && rawRefs.length > 0) {
          const sources = []
          for (const ref of rawRefs.slice(0, 8) as ContextRefInput[]) {
            if (!ref || ref.type !== "thread" || typeof ref.id !== "string") continue
            // full mode forbidden by default
            if (ref.mode === "full") continue
            const thr = services.threadManager.get(ref.id)
            if (!thr || thr.trashed_at) continue
            // Single message-file read for previews (+ optional async digest)
            const pair = services.threadManager.getUserPreviewPair(thr.id, 120)
            sources.push({
              id: thr.id,
              alias: thr.alias,
              digest: thr.digest,
              first_user_preview: pair.first,
              last_user_preview: pair.last,
              titleFromClient: typeof ref.title === "string" ? ref.title : undefined,
            })
            // Background digest fill: de-duped + concurrency-capped (max 2)
            if (!thr.digest || isDigestStale(thr.digest, pair.messages)) {
              void extractThreadDigestQueued({
                threadId: thr.id,
                messages: pair.messages,
                config: effectiveLLMConfig,
                source: "on_at_ref",
              })
                .then((dig) => {
                  if (!dig) return
                  const next = services.threadManager.update(thr.id, { digest: dig })
                  if (!next) return
                  // Push so Side Panel tags view / row pills update without full reload
                  const payload = {
                    type: "thread.digest_updated",
                    thread_id: thr.id,
                    digest: next.digest,
                    thread: next,
                  }
                  session?.broadcast?.(payload)
                  session?.sendToExtension?.(payload)
                })
                .catch(() => {
                  /* ignore */
                })
            }
          }
          contextRefsSegment = buildContextRefsSystemSegment(sources) || undefined
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
          contextRefsSegment,
        })
      } catch (e: any) {
        // Only emit aborted UI if this generation is still current (SEC-D)
        if (llmLoopGeneration.get(rest.thread_id) === myGeneration) {
          if (e.name === "AbortError" || controller.signal.aborted) {
            session.sendToExtension({ type: "chat.aborted", thread_id: rest.thread_id })
          } else {
            session.sendToExtension({ type: "chat.error", thread_id: rest.thread_id, error: e.message })
          }
        }
      } finally {
        // SEC-D generation CAS: predecessor must not free successor controller/gate
        if (llmLoopGeneration.get(rest.thread_id) === myGeneration) {
          if (abortControllers.get(rest.thread_id) === controller) {
            abortControllers.delete(rest.thread_id)
          }
          releaseMultiAgentLlmLoop(rest.thread_id)
        }
      }
      return null // chatCreate handles streaming internally
    }

    case "file.upload": {
      if (!session) return { type: "error", error: "No session" }

      const { thread_id, files } = rest
      const config = getConfig()
      const fileConfig = config.file_upload || { max_file_size: 10 * 1024 * 1024, allowed_types: [] as string[], max_embedded_images: 20, enable_vision_analysis: true, max_file_tokens: 50000 }

      // S45: persist parse/type failures so mid-upload thread switch still shows
      // the error when the user returns (UI gates ADD_MESSAGE for foreign threads).
      const uploadError = (error: string) => {
        try {
          if (typeof thread_id === "string" && thread_id) {
            services.threadManager.addMessage(thread_id, {
              thread_id,
              role: "assistant",
              content: `\u274c ${error}`,
            })
          }
        } catch {
          /* best-effort — still return WS error */
        }
        return { type: "file.upload_error" as const, thread_id, error }
      }

      logger.info("file.upload.start", {
        thread_id,
        count: Array.isArray(files) ? files.length : 0,
        names: Array.isArray(files) ? files.map((f: any) => f?.name).filter(Boolean) : [],
        types: Array.isArray(files) ? files.map((f: any) => f?.type || "") : [],
        content_b64_lens: Array.isArray(files)
          ? files.map((f: any) => (typeof f?.content === "string" ? f.content.length : 0))
          : [],
        max_file_size: fileConfig.max_file_size,
        allowed_types_count: Array.isArray(fileConfig.allowed_types)
          ? fileConfig.allowed_types.length
          : 0,
        vision: !!(config.vision?.enabled && fileConfig.enable_vision_analysis !== false),
      })

      const pushUploadStatus = (phase: string, message: string, extra?: Record<string, unknown>) => {
        session.sendToExtension({
          type: "file.upload_status",
          thread_id,
          phase,
          message,
          ...extra,
        })
      }

      // Phase 1: Parse all files (text + embedded images)
      // Wrap the whole parse/vision path so timeouts / unexpected throws become
      // file.upload_error (UI clears busy). Uncaught throws only send type:"error"
      // which historically left the Side Panel stuck on "思考中".
      const parseResults: FileParseResult[] = []
      let finalFileContents: Array<{ filename: string; content: string }> = []

      try {
        const fileCount = Array.isArray(files) ? files.length : 0
        for (let fi = 0; fi < files.length; fi++) {
          const file = files[fi]
          const { name, type, content } = file

          pushUploadStatus(
            "parsing",
            fileCount > 1
              ? `正在解析文档 (${fi + 1}/${fileCount})：${name}`
              : `正在解析文档：${name}`,
            { filename: name },
          )

          const decodedSize = Math.ceil(content.length * 0.75)
          if (decodedSize > fileConfig.max_file_size) {
            return uploadError(
              `文件 "${name}" 过大 (${Math.round(decodedSize / 1024 / 1024)}MB)，最大支持 ${Math.round(fileConfig.max_file_size / 1024 / 1024)}MB`,
            )
          }

          if (fileConfig.allowed_types.length > 0 && !fileConfig.allowed_types.includes(type)) {
            return uploadError(
              `不支持的文件类型: ${type}（请确认扩展名为 .docx/.pdf 等支持格式）`,
            )
          }

          const buffer = Buffer.from(content, "base64")
          let parseResult: Awaited<ReturnType<typeof parseFile>>
          try {
            parseResult = await Promise.race([
              parseFile(buffer, name, type),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`文件 "${name}" 解析超时 (30s)`)), 30000)
              ),
            ])
          } catch (parseErr: any) {
            logger.warn("file.upload.parse_failed", {
              thread_id,
              filename: name,
              error: parseErr?.message || String(parseErr),
            })
            return uploadError(parseErr?.message || `文件 "${name}" 解析失败`)
          }

          if (!parseResult.success) {
            return uploadError(parseResult.error)
          }

          parseResults.push(parseResult)
        }

        // Phase 2: Vision analysis for embedded images
        const visionEnabled = config.vision?.enabled && fileConfig.enable_vision_analysis !== false

        for (const parseResult of parseResults) {
          let content = parseResult.text

          if (visionEnabled && parseResult.embeddedImages?.length) {
            const imgs = parseResult.embeddedImages.filter(i => i.format !== "note")
            if (imgs.length > 0) {
              pushUploadStatus(
                "vision",
                `正在分析文档内嵌图片（${imgs.length} 张）…`,
                { filename: parseResult.filename, image_count: imgs.length },
              )
            }
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
      } catch (phaseErr: any) {
        logger.error("file.upload.phase_error", {
          thread_id,
          error: phaseErr?.message || String(phaseErr),
        })
        return uploadError(phaseErr?.message || "文件处理失败")
      }

      logger.info("file.upload.parsed", {
        thread_id,
        files: finalFileContents.map(f => ({
          filename: f.filename,
          chars: f.content.length,
        })),
      })

      pushUploadStatus("chat", "文档已解析，模型思考中…")

      // Same gates as chat.create: paused, multi-agent LLM cap, supersede CAS
      {
        const thrGate = services.threadManager.get(thread_id)
        if (!thrGate) {
          return uploadError("Thread not found")
        }
        if (thrGate.trashed_at) {
          return uploadError("thread_trashed")
        }
        if (thrGate.paused) {
          return uploadError("thread_paused")
        }
      }
      const existingUpload = abortControllers.get(thread_id)
      if (existingUpload) {
        logger.info("llm.thread_request_superseded", { thread_id })
        existingUpload.abort()
        await drainThreadOnSupersede(thread_id, `file.upload.supersede:${thread_id}`)
      }
      const { tryAcquireMultiAgentLlmLoop, releaseMultiAgentLlmLoop: releaseUploadLlm } =
        await import("./orchestrator/llm-loop-gate")
      const threadForUploadCap = services.threadManager.get(thread_id)
      const uploadLoopGate = tryAcquireMultiAgentLlmLoop(threadForUploadCap, thread_id)
      if (!uploadLoopGate.ok) {
        return uploadError(uploadLoopGate.error)
      }
      const uploadGeneration = nextLlmGeneration(thread_id)
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

        logger.info("file.upload.chat_start", {
          thread_id,
          user_message_len: userMessage.length,
          files: finalFileContents.map(f => ({
            filename: f.filename,
            chars: f.content.length,
          })),
          skill_count: allSkillIds.length,
          knowledge_count: resolvedKnowledgeIds?.length ?? 0,
          model: effectiveLLMConfig.model_name,
        })

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
        logger.info("file.upload.chat_done", { thread_id })
      } catch (e: any) {
        logger.warn("file.upload.chat_error", {
          thread_id,
          error: e?.message || String(e),
          aborted: e?.name === "AbortError" || uploadController.signal.aborted,
        })
        if (llmLoopGeneration.get(thread_id) === uploadGeneration) {
          if (e.name === "AbortError" || uploadController.signal.aborted) {
            session.sendToExtension({ type: "chat.aborted", thread_id })
          } else {
            session.sendToExtension({ type: "chat.error", thread_id, error: e.message })
          }
        }
      } finally {
        if (llmLoopGeneration.get(thread_id) === uploadGeneration) {
          if (abortControllers.get(thread_id) === uploadController) {
            abortControllers.delete(thread_id)
          }
          releaseUploadLlm(thread_id)
        }
      }

      logger.info("file.upload.complete", {
        thread_id,
        files: finalFileContents.map(f => f.filename),
      })
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

      {
        const thrGate = services.threadManager.get(thread_id)
        if (!thrGate) return { type: "error", error: "Thread not found" }
        if (thrGate.trashed_at) {
          return {
            type: "chat.error",
            thread_id,
            error: "thread_trashed",
            data: { error_code: "thread_trashed" },
          }
        }
        if (thrGate.paused) {
          return {
            type: "chat.error",
            thread_id,
            error: "thread_paused",
            data: { error_code: "thread_paused" },
          }
        }
      }

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

      // Cancel any existing request for this thread (SEC-D generation CAS)
      const existing = abortControllers.get(thread_id)
      if (existing) {
        logger.info("llm.thread_request_superseded", { thread_id })
        existing.abort()
        await drainThreadOnSupersede(thread_id, `chat.regenerate.supersede:${thread_id}`)
      }
      const { tryAcquireMultiAgentLlmLoop, releaseMultiAgentLlmLoop: releaseRegenLlm } =
        await import("./orchestrator/llm-loop-gate")
      const threadForRegenCap = services.threadManager.get(thread_id)
      const regenLoopGate = tryAcquireMultiAgentLlmLoop(threadForRegenCap, thread_id)
      if (!regenLoopGate.ok) {
        return {
          type: "chat.error",
          thread_id,
          error: regenLoopGate.error,
          data: {
            error_code: "MULTI_AGENT_LLM_CAP",
            active: regenLoopGate.active,
            cap: regenLoopGate.cap,
          },
        }
      }
      const myGeneration = nextLlmGeneration(thread_id)
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
        if (llmLoopGeneration.get(thread_id) === myGeneration) {
          if (e.name === "AbortError" || controller.signal.aborted) {
            session.sendToExtension({ type: "chat.aborted", thread_id })
          } else {
            session.sendToExtension({ type: "chat.error", thread_id, error: e.message })
          }
        }
      } finally {
        if (llmLoopGeneration.get(thread_id) === myGeneration) {
          if (abortControllers.get(thread_id) === controller) {
            abortControllers.delete(thread_id)
          }
          releaseRegenLlm(thread_id)
        }
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
    case "thread.delete": {
      // Dual-review B1: keep single-delete default HARD for tray/legacy callers.
      // Soft-delete only when UI explicitly passes mode:"trash".
      const mode = rest.mode === "trash" ? "trash" : "hard"
      // Busy reject (defense-in-depth; batch already does this)
      if (listLlmActiveThreadIds().includes(rest.thread_id)) {
        return {
          type: "error",
          error: "thread_busy",
          thread_id: rest.thread_id,
          data: { error_code: "thread_busy" },
        }
      }
      try {
        const thr = threadManager.get(rest.thread_id)
        if (thr) {
          const { releaseTrustBeforeThreadGone } = await import("./packs/pack-engine")
          releaseTrustBeforeThreadGone(thr, "thread.delete", threadManager)
        }
      } catch {
        /* best-effort */
      }
      if (mode === "trash") {
        const trashed = threadManager.trash(rest.thread_id)
        if (!trashed) return { type: "error", error: `Thread not found: ${rest.thread_id}` }
        if (session?.broadcast) {
          session.broadcast({ type: "thread.trashed", thread_id: rest.thread_id, thread: trashed })
        }
        return { type: "thread.trashed", thread_id: rest.thread_id, thread: trashed, mode: "trash" }
      }
      threadManager.delete(rest.thread_id)
      // S51: broadcast hard-delete so multi-panel lists stay in sync (batch path already does).
      if (session?.broadcast) {
        session.broadcast({ type: "thread.deleted", thread_id: rest.thread_id, mode: "hard" })
      }
      return { type: "thread.deleted", thread_id: rest.thread_id, mode: "hard" }
    }
    /**
     * Thread History IA: multi-select delete.
     * mode: "trash" (default, P1.5) | "hard"
     * Pre-dev pins: withIndexLock; per-id releaseTrust; max 50; busy reject;
     * best-effort ok[]+failed[]; history.db ops intentionally retained.
     */
    case "thread.batch_delete": {
      const rawIds = rest.thread_ids
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return { type: "error", error: "thread.batch_delete requires non-empty thread_ids" }
      }
      if (rawIds.length > 50) {
        return { type: "error", error: "thread.batch_delete max 50 threads per request" }
      }
      const mode = rest.mode === "hard" ? "hard" : "trash"
      const busy = new Set(listLlmActiveThreadIds())
      const ok: string[] = []
      const failed: Array<{ id: string; reason: string }> = []

      await threadManager.withIndexLock(async () => {
        let releaseTrust:
          | ((thr: any, by: string, tm?: typeof threadManager) => boolean)
          | null = null
        try {
          const mod = await import("./packs/pack-engine")
          releaseTrust = mod.releaseTrustBeforeThreadGone
        } catch {
          releaseTrust = null
        }

        for (const raw of rawIds) {
          const id = typeof raw === "string" ? raw : ""
          if (!id) {
            failed.push({ id: String(raw ?? ""), reason: "invalid_id" })
            continue
          }
          if (busy.has(id)) {
            failed.push({ id, reason: "thread_busy" })
            continue
          }
          const thr = threadManager.get(id)
          if (!thr) {
            failed.push({ id, reason: "not_found" })
            continue
          }
          try {
            releaseTrust?.(thr, "thread.batch_delete", threadManager)
          } catch {
            /* best-effort trust release */
          }
          try {
            if (mode === "hard") {
              threadManager.delete(id)
              ok.push(id)
              session?.broadcast?.({ type: "thread.deleted", thread_id: id, mode: "hard" })
            } else {
              const t = threadManager.trash(id)
              if (!t) {
                failed.push({ id, reason: "trash_failed" })
                continue
              }
              ok.push(id)
              session?.broadcast?.({ type: "thread.trashed", thread_id: id, thread: t })
            }
          } catch (e: any) {
            failed.push({ id, reason: e?.message || "delete_failed" })
          }
        }
      })

      return {
        type: "thread.batch_deleted",
        ok,
        failed,
        deleted_ids: ok,
        deleted_count: ok.length,
        mode,
      }
    }

    case "thread.restore": {
      const ids: string[] = Array.isArray(rest.thread_ids)
        ? rest.thread_ids.filter((id: unknown) => typeof id === "string" && id)
        : rest.thread_id
          ? [String(rest.thread_id)]
          : []
      if (ids.length === 0) {
        return { type: "error", error: "thread.restore requires thread_id or thread_ids" }
      }
      const restored: string[] = []
      const failed: Array<{ id: string; reason: string }> = []
      for (const id of ids) {
        const t = threadManager.restore(id)
        if (!t) {
          failed.push({ id, reason: "not_found" })
          continue
        }
        restored.push(id)
        session?.broadcast?.({ type: "thread.updated", thread: t })
      }
      return { type: "thread.restored", restored, failed, restored_count: restored.length }
    }

    case "thread.suggest_cleanup": {
      const includeWorkers = rest.include_workers === true
      const from = typeof rest.from === "string" ? rest.from : null
      const to = typeof rest.to === "string" ? rest.to : null
      const threads = threadManager.list({ include_trashed: false }).map((t) => {
        const msgs = threadManager.getMessages(t.id)
        const users = msgs.filter((m) => m.role === "user")
        const first = users[0]
        const firstLen = first ? String(first.content || "").trim().length : 0
        return {
          id: t.id,
          alias: t.alias,
          updated_at: t.updated_at,
          created_at: t.created_at,
          agent_role: t.agent_role,
          parent_thread_id: t.parent_thread_id,
          message_count: msgs.length,
          first_user_preview: threadManager.getFirstUserPreview(t.id),
          first_user_len: firstLen,
          has_assistant: msgs.some((m) => m.role === "assistant"),
        }
      })
      const suggestions = suggestCleanupRules(threads, {
        from,
        to,
        include_workers: includeWorkers,
      })
      return {
        type: "thread.cleanup_suggestions",
        suggestions,
        count: suggestions.length,
        mode: "rules",
      }
    }
    case "thread.cleanup_empty": {
      try {
        const { releaseTrustBeforeThreadGone } = await import("./packs/pack-engine")
        for (const t of threadManager.list()) {
          if (threadManager.getMessages(t.id).length === 0) {
            releaseTrustBeforeThreadGone(t, "thread.cleanup_empty", threadManager)
          }
        }
      } catch {
        /* best-effort */
      }
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
    case "thread.list": {
      // Lazy purge expired trash (30d) — no daemon scheduler required.
      // S51: clear any leftover trust cookies on trashed rows WITHOUT re-restore
      // (release already ran at trash time; pre-S51 rows may still hold a cookie).
      try {
        const { clearTrustCookieWithoutRestore, isPackTrustSnapshot } = await import(
          "./packs/pack-engine"
        )
        for (const t of threadManager.list({ only_trashed: true })) {
          if (isPackTrustSnapshot(t.mission_pack_trust_snapshot)) {
            clearTrustCookieWithoutRestore(t, threadManager, "thread.list_trash_cookie_clear")
          }
        }
      } catch {
        /* best-effort */
      }
      try {
        const purged = threadManager.purgeExpiredTrash(30)
        for (const id of purged) {
          session?.broadcast?.({ type: "thread.deleted", thread_id: id, mode: "hard", reason: "trash_ttl" })
        }
      } catch {
        /* best-effort */
      }
      const includeTrashed = rest.include_trashed === true
      const onlyTrashed = rest.only_trashed === true
      // listWithPreviews is single-pass (preview + stale); no second getMessages
      const threads = threadManager.listWithPreviews({
        include_trashed: includeTrashed,
        only_trashed: onlyTrashed,
      })
      const trashCount = threadManager.list({ only_trashed: true }).length
      // Dual-review B2: echo list scope so extension does not auto-create /
      // auto-select when response is trash-scoped or include_trashed.
      return {
        type: "thread.list",
        threads,
        trash_count: trashCount,
        include_trashed: includeTrashed,
        only_trashed: onlyTrashed,
        list_scope: onlyTrashed ? "trash" : includeTrashed ? "all" : "active",
      }
    }

    /**
     * P0.5: rule-based batch title from first user message (no LLM).
     * only_empty default true; optional thread_ids filter.
     */
    case "thread.batch_auto_title": {
      const onlyEmpty = rest.only_empty !== false
      const filterIds: string[] | null = Array.isArray(rest.thread_ids)
        ? rest.thread_ids.filter((id: unknown) => typeof id === "string" && id)
        : null
      if (filterIds && filterIds.length > 50) {
        return { type: "error", error: "thread.batch_auto_title max 50 thread_ids" }
      }
      const targets = filterIds
        ? filterIds.map((id) => threadManager.get(id)).filter(Boolean)
        : threadManager.list()
      const updated: Array<{ id: string; alias: string }> = []
      const skipped: Array<{ id: string; reason: string }> = []

      for (const thr of targets as any[]) {
        if (!thr) continue
        if (onlyEmpty && String(thr.alias || "").trim()) {
          skipped.push({ id: thr.id, reason: "alias_set" })
          continue
        }
        const preview = threadManager.getFirstUserPreview(thr.id, 200)
        if (!preview) {
          skipped.push({ id: thr.id, reason: "no_user_message" })
          continue
        }
        const alias = aliasFromFirstUserText(preview, 40)
        if (!alias) {
          skipped.push({ id: thr.id, reason: "empty_title" })
          continue
        }
        const next = threadManager.update(thr.id, { alias })
        if (next) {
          updated.push({ id: next.id, alias: next.alias })
          session?.broadcast?.({ type: "thread.updated", thread: next })
        }
      }
      return {
        type: "thread.batch_auto_title.completed",
        updated,
        skipped,
        updated_count: updated.length,
      }
    }

    /**
     * P1: extract short digest (tldr/tags/bullets) into index.
     * Concurrent same-id extracts serialize via withThreadLock.
     */
    case "thread.extract_digest": {
      const ids: string[] = Array.isArray(rest.thread_ids)
        ? rest.thread_ids.filter((id: unknown) => typeof id === "string" && id)
        : rest.thread_id
          ? [String(rest.thread_id)]
          : []
      if (ids.length === 0) {
        return { type: "error", error: "thread.extract_digest requires thread_id or thread_ids" }
      }
      if (ids.length > 20) {
        return { type: "error", error: "thread.extract_digest max 20 threads per request" }
      }
      const force = rest.force === true
      const cfg = getConfig().llm
      if (!cfg?.api_key) {
        return { type: "error", error: "LLM API key not configured" }
      }
      const ok: string[] = []
      const failed: Array<{ id: string; reason: string }> = []

      for (const id of ids) {
        try {
          await threadManager.withThreadLock(id, async () => {
            const thr = threadManager.get(id)
            if (!thr) {
              failed.push({ id, reason: "not_found" })
              return
            }
            const messages = threadManager.getMessages(id)
            if (!force && thr.digest && !isDigestStale(thr.digest, messages)) {
              ok.push(id)
              session?.sendToExtension?.({
                type: "thread.digest_updated",
                thread_id: id,
                digest: thr.digest,
                thread: thr,
              })
              return
            }
            const digest = await extractThreadDigest({
              messages,
              config: cfg,
              source: "manual",
            })
            if (!digest) {
              failed.push({ id, reason: "no_content" })
              return
            }
            const next = threadManager.update(id, { digest })
            if (!next) {
              failed.push({ id, reason: "update_failed" })
              return
            }
            ok.push(id)
            const payload = {
              type: "thread.digest_updated",
              thread_id: id,
              digest: next.digest,
              thread: next,
            }
            session?.broadcast?.(payload)
            // also push to origin if broadcast misses (belt)
            session?.sendToExtension?.(payload)
          })
        } catch (e: any) {
          failed.push({ id, reason: e?.message || "extract_failed" })
        }
      }
      return {
        type: "thread.extract_digest.completed",
        ok,
        failed,
        extracted_count: ok.length,
      }
    }
    case "thread.select": {
      const thr = threadManager.get(rest.thread_id)
      if (!thr) return { type: "error", error: `Thread not found: ${rest.thread_id}` }
      // Soft-deleted: still allow reading messages in trash view, but flag so UI can warn.
      // Block switching into chat loop for trashed threads from normal select is product-side;
      // companion returns messages + trashed so extension can refuse activation.
      return {
        type: "thread.messages",
        messages: threadManager.getMessages(rest.thread_id),
        thread_id: rest.thread_id,
        trashed: !!thr.trashed_at,
      }
    }
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
          // Wave E P1-2: preserve thinking for UI/export continuity on fork
          ...(msg.reasoning_content != null
            ? { reasoning_content: msg.reasoning_content }
            : {}),
        })
      }

      // Wave E P1-2: copy Composition surface (skills/knowledge/modes/whitelist/MCP).
      // Do NOT copy Trust (mission_pack_trust_snapshot / auto_approve) or runtime
      // handoff meta — fork is a new request path; pack id/snapshot optional for
      // unapply UX without re-applying Trust gesture.
      threadManager.update(newThread.id, {
        active_skill_ids: sourceThread.active_skill_ids,
        pinned_tabs: sourceThread.pinned_tabs,
        ...(sourceThread.active_knowledge_ids !== undefined
          ? { active_knowledge_ids: [...sourceThread.active_knowledge_ids] }
          : {}),
        ...(sourceThread.skill_selection_mode !== undefined
          ? { skill_selection_mode: sourceThread.skill_selection_mode }
          : {}),
        ...(sourceThread.knowledge_selection_mode !== undefined
          ? { knowledge_selection_mode: sourceThread.knowledge_selection_mode }
          : {}),
        ...(sourceThread.tool_whitelist !== undefined
          ? {
              tool_whitelist: sourceThread.tool_whitelist
                ? [...sourceThread.tool_whitelist]
                : null,
            }
          : {}),
        ...(sourceThread.mcp_selection_mode !== undefined
          ? { mcp_selection_mode: sourceThread.mcp_selection_mode }
          : {}),
        ...(sourceThread.active_mcp_server_ids !== undefined
          ? { active_mcp_server_ids: [...(sourceThread.active_mcp_server_ids || [])] }
          : {}),
        ...(sourceThread.workspace_root !== undefined
          ? { workspace_root: sourceThread.workspace_root }
          : {}),
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
      for (const key of [
        "alias",
        "config_override",
        "tool_whitelist",
        "pinned_tabs",
        "active_skill_ids",
        "active_knowledge_ids",
        "skill_selection_mode",
        "knowledge_selection_mode",
        "mcp_selection_mode",
        "active_mcp_server_ids",
        "digest",
      ]) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          allowedUpdates[key] = updates[key]
        }
      }
      // C6 multi-adv: worker cannot open full surface or re-add HARD_DENY tools via update
      if (Object.prototype.hasOwnProperty.call(allowedUpdates, "tool_whitelist")) {
        const existing = threadManager.get(rest.thread_id)
        if (existing?.agent_role === "worker") {
          const { WORKER_HARD_DENY } = await import("./orchestrator/constants")
          const wl = allowedUpdates.tool_whitelist
          if (wl === null) {
            return {
              type: "error",
              error:
                "thread.update: worker cannot set tool_whitelist=null (full surface). HARD_DENY tools remain denied.",
              code: "worker_whitelist_elevation",
            }
          }
          if (Array.isArray(wl)) {
            allowedUpdates.tool_whitelist = wl.filter(
              (t: unknown) => typeof t === "string" && !WORKER_HARD_DENY.has(t),
            )
          }
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
      // list() → ensureFresh(): cheap mtime/size fingerprint; full re-parse only when
      // disk changed (external drops). API mutations already refresh() (audit item 10).
      // Force full rescan: skill.refresh.
      return { type: "skill.list", skills: skillEngine.list() }

    case "skill.refresh":
      // Force full re-scan (ignore fingerprint) — Skills panel 「刷新」
      skillEngine.refresh()
      return { type: "skill.list", skills: skillEngine.list(), refreshed: true }

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
      // SEC: never ship env/headers secrets on the wire (config.updated already redacts)
      return { type: "mcp.list", servers: redactMcpServersForBroadcast(getMcpManager().listServers()) }
    }
    case "mcp.toggle_enabled": {
      const enabled = !!rest.enabled
      setMcpEnabled(enabled)
      // applyConfig is fired via configEvents listener in server.ts
      return { type: "mcp.list", servers: redactMcpServersForBroadcast(getMcpManager().listServers()) }
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
      // SEC-B: stdio = arbitrary local spawn; require origin-bound L2 (force high)
      // before replaceMcpServers → applyConfig → StdioClientTransport.
      const stdioGate = await requireMcpStdioSpawnConfirm(session, name, serverCfg, "add")
      if (stdioGate) return stdioGate
      const wasEmpty = Object.keys(config.mcp?.servers || {}).length === 0
      const newServers = { ...(config.mcp?.servers || {}), [name]: serverCfg }
      replaceMcpServers(newServers)
      // Auto-enable the global kill-switch when the user adds their first server
      // after clearing all servers (or on older configs that still had mcp.enabled=false).
      // Without this, a user-disabled kill-switch leaves the new server disconnected
      // with no UI surface to recover (see mcp.toggle_enabled UI gap).
      if (wasEmpty && !config.mcp?.enabled) {
        setMcpEnabled(true)
      }
      return {
        type: "mcp.servers.updated",
        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),
      }
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
      // Pi REJECT #2: UI re-sends "***" for redacted env/headers — restore disk secrets
      const merged = mergeMcpServerPreservingSecrets(existing, patch)
      // Re-validate after merge
      const validation = validateMcpServerConfig(name, merged)
      if (validation) return { type: "error", error: validation }
      // SEC-B: re-confirm when stdio spawn surface changes (incl. enable false→true)
      if (mcpStdioSpawnSurfaceChanged(existing, merged)) {
        const stdioGate = await requireMcpStdioSpawnConfirm(session, name, merged, "update")
        if (stdioGate) return stdioGate
      }
      const newServers = { ...(config.mcp?.servers || {}), [name]: merged }
      replaceMcpServers(newServers)
      return {
        type: "mcp.servers.updated",
        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),
      }
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
      return {
        type: "mcp.servers.updated",
        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),
      }
    }
    case "mcp.toggle_server": {
      const name = String(rest.name || "").trim()
      const enabled = !!rest.enabled
      const config = getConfig()
      const existing = config.mcp?.servers?.[name]
      if (!existing) return { type: "error", error: `MCP server "${name}" not found` }
      const newServers = { ...(config.mcp?.servers || {}), [name]: { ...existing, enabled } }
      // Enabling a previously disabled stdio server spawns the process — same trust as add.
      if (enabled && existing.enabled === false && existing.transport === "stdio") {
        const stdioGate = await requireMcpStdioSpawnConfirm(
          session,
          name,
          { ...existing, enabled: true },
          "update",
        )
        if (stdioGate) return stdioGate
      }
      replaceMcpServers(newServers)
      return {
        type: "mcp.servers.updated",
        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),
      }
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
    case "computer.model.set_variant":
    case "computer.model.set_download_source":
    case "computer.model.set_model_root":
    case "computer.model.pick_model_root":
    case "computer.model.set_python_mode":
    case "computer.model.pick_python_path":
    case "computer.model.ensure_python_env":
    case "computer.model.install_deps":
      return handleComputerModelMessage(msg, {
        requestConfirmation: session?.requestConfirmation,
        broadcast: session?.broadcast,
      })
    // Path B M0 — voice.model.* / voice.binary.* (settings dual fence; ADR-023 L7)
    case "voice.model.get_state":
    case "voice.model.download":
    case "voice.model.cancel":
    case "voice.model.delete":
    case "voice.model.set_active":
    case "voice.model.set_engine":
    case "voice.binary.download":
    case "voice.binary.cancel":
      return handleVoiceModelMessage(msg, {
        broadcast: session?.broadcast,
        origin: session?.origin,
      })
    // Path B M1 — voice.stt.* (origin chrome-extension:// fence; NOT source:settings)
    case "voice.stt.start":
    case "voice.stt.chunk":
    case "voice.stt.partial_request":
    case "voice.stt.end":
    case "voice.stt.abort":
      return handleVoiceSttMessage(msg, {
        origin: session?.origin,
        peerId: session?.panelId,
        send: session?.sendToExtension,
      })
    // Dictation+ D1b — ASR Refiner (text-only; chrome-extension origin fence)
    case "voice.refine.request":
    case "voice.refine.abort":
      return handleVoiceRefineMessage(msg, {
        origin: session?.origin,
        peerId: session?.panelId,
        send: session?.sendToExtension,
      })
    case "voice.dictation.hold_state":
      return handleDictationHoldState(
        msg,
        { origin: session?.origin },
        {
          onHoldChange: (active, chord) => {
            // System notification as Mode B indicator (SoT §5.6 "CMspark · 草稿")
            if (!active) return
            try {
              const notifier = require("node-notifier") as {
                notify: (o: Record<string, unknown>) => void
              }
              notifier.notify({
                title: "CMspark · 草稿",
                message: chord
                  ? `按住听写中（${chord}）· 松手结束`
                  : "按住听写中 · 松手结束",
                timeout: 2,
              })
            } catch {
              /* optional */
            }
          },
        },
      )
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
    case "meeting.set_status":
      return handleMeetingMessage(msg, {
        origin: session?.origin,
        peerId: session?.panelId,
        send: session?.sendToExtension,
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
      // Wave D: include model thinking in export only when client opts in.
      const includeReasoning = rest.include_reasoning === true
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
          include_reasoning: includeReasoning,
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
        include_reasoning: includeReasoning,
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
        const urlStr = String(rest.url)
        const { assertOutboundFetchUrlAllowed } = await import("./security")
        const ssrf = assertOutboundFetchUrlAllowed(urlStr)
        if (ssrf) return { type: "error", error: ssrf }
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
      // listKnowledge() → ensureFresh() (same fingerprint path as skills)
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
        const urlStr = String(rest.url)
        const { assertOutboundFetchUrlAllowed } = await import("./security")
        const ssrf = assertOutboundFetchUrlAllowed(urlStr)
        if (ssrf) return { type: "error", error: ssrf }
        let parsed: URL
        try {
          parsed = new URL(urlStr)
        } catch {
          return { type: "error", error: "Invalid URL" }
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
      const parentId =
        typeof rest.parent_thread_id === "string" && rest.parent_thread_id
          ? rest.parent_thread_id
          : null
      const { listWorkers } = await import("./orchestrator/spawn")
      const { releaseLeasesForThreadPendingAware } = await import("./orchestrator/tab-lease")
      const { rejectPendingForThread, hasPendingForTab, rejectPendingForTab, securityConfirmations } =
        await import("./server")
      let targets: any[] = []
      // Precedence: run scope > parent scope > process-wide residual cleanup.
      if (runId) {
        targets = listWorkers(threadManager, runId)
      } else if (parentId) {
        // S45: host/worker without run stamp — only workers under this parent.
        targets = threadManager
          .list()
          .filter(
            (t: any) =>
              t.agent_role === "worker" &&
              (t.parent_thread_id === parentId || t.id === parentId),
          )
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
      // UI-only path: require user_gesture so LLM/tool channels cannot self-apply.
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "pack.apply requires user_gesture:true (apply only from Side Panel)",
          code: "user_gesture_required",
        }
      }
      const { applyPack } = await import("./packs/pack-engine")
      if (!rest.pack_id || !rest.thread_id) {
        return { type: "error", error: "pack_id and thread_id required" }
      }
      // allowTrust: only Side Panel user_gesture may write global Trust B.
      // force_takeover: only after UI conflict confirm (still requires user_gesture).
      const forceTakeover = rest.force_takeover === true
      const r = applyPack(rest.pack_id, rest.thread_id, threadManager, skillEngine, {
        workspace_path: rest.workspace_path,
        allowTrust: true,
        forceTakeoverTrust: forceTakeover,
        // C5: phrase required when pack Trust writes cruise flags
        confirmation_phrase: rest.confirmation_phrase,
      })
      if (!r.ok) {
        return {
          type: "error",
          error: r.error,
          code: (r as any).code,
          holders: Array.isArray((r as any).holders) ? (r as any).holders : undefined,
        }
      }
      return { type: "pack.applied", thread: r.thread }
    }
    case "pack.unapply": {
      // UI-only RPC — never an LLM tool (see product SoT §14.1).
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "pack.unapply requires user_gesture:true",
          code: "user_gesture_required",
        }
      }
      if (!rest.thread_id || typeof rest.thread_id !== "string") {
        return { type: "error", error: "pack.unapply requires thread_id" }
      }
      const { unapplyPack } = await import("./packs/pack-engine")
      const r = unapplyPack(rest.thread_id, threadManager, skillEngine)
      if (!r.ok) return { type: "error", error: r.error, code: (r as any).code }
      return { type: "pack.unapplied", thread: r.thread }
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
    case "pack.get": {
      const { getPackDetail } = await import("./packs/pack-engine")
      if (!rest.pack_id || typeof rest.pack_id !== "string") {
        return { type: "error", error: "pack.get requires pack_id" }
      }
      const r = getPackDetail(rest.pack_id, skillEngine)
      if (!r.ok) return { type: "error", error: r.error }
      return { type: "pack.get", pack: r.pack }
    }
    case "pack.save_user": {
      // UI-only: user-authored scene templates (system prompt + skills + MCP)
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "pack.save_user requires user_gesture:true (Side Panel only)",
          code: "user_gesture_required",
        }
      }
      const { saveUserPack, applyPack } = await import("./packs/pack-engine")
      let toolsInput: { mode: "allowlist" | "intersect" | "unchanged"; allow?: string[]; deny?: string[] } | undefined
      if (rest.tools && typeof rest.tools === "object") {
        const tm = (rest.tools as any).mode
        if (tm === "allowlist" || tm === "intersect" || tm === "unchanged") {
          toolsInput = {
            mode: tm,
            allow: Array.isArray((rest.tools as any).allow) ? (rest.tools as any).allow : [],
            deny: Array.isArray((rest.tools as any).deny) ? (rest.tools as any).deny : [],
          }
        }
      }
      // Product B: trust policy (null = clear; object = set; omit = preserve on update)
      let trustInput: any = undefined
      if (rest.trust === null) {
        trustInput = null
      } else if (rest.trust && typeof rest.trust === "object") {
        const t = rest.trust as any
        trustInput = {
          set_enterprise_profile: t.set_enterprise_profile === true,
          enable_modules: Array.isArray(t.enable_modules) ? t.enable_modules : [],
          auto_approve_dangerous: t.auto_approve_dangerous === true,
          auto_approve_enterprise_tools: t.auto_approve_enterprise_tools === true,
          allow_all_schemes: t.allow_all_schemes === true,
          skip_l2: t.skip_l2 === true,
        }
      }
      const r = saveUserPack(
        {
          id: typeof rest.id === "string" ? rest.id : undefined,
          name: typeof rest.name === "string" ? rest.name : "",
          description: typeof rest.description === "string" ? rest.description : undefined,
          system_prompt_append:
            typeof rest.system_prompt_append === "string" ? rest.system_prompt_append : "",
          skill_ids: Array.isArray(rest.skill_ids) ? rest.skill_ids : [],
          knowledge_ids: Array.isArray(rest.knowledge_ids) ? rest.knowledge_ids : [],
          mcp_server_ids: Array.isArray(rest.mcp_server_ids) ? rest.mcp_server_ids : [],
          tools: toolsInput,
          trust: trustInput,
          suitable_for: typeof rest.suitable_for === "string" ? rest.suitable_for : undefined,
          unsuitable_for: typeof rest.unsuitable_for === "string" ? rest.unsuitable_for : undefined,
          tools_summary_zh: typeof rest.tools_summary_zh === "string" ? rest.tools_summary_zh : undefined,
        },
        skillEngine,
      )
      if (!r.ok) return { type: "error", error: r.error, code: (r as any).code }

      // Optional: save then apply to current thread (P1)
      const applyThreadId =
        typeof rest.apply_thread_id === "string" && rest.apply_thread_id.trim()
          ? rest.apply_thread_id.trim()
          : null
      if (applyThreadId) {
        // Same gesture as save — allow Trust B write for user scenes.
        // force_takeover only after UI conflict confirm on re-apply path.
        // C5: confirmation_phrase required when Trust writes cruise flags.
        const forceTakeover = rest.force_takeover === true
        const ar = applyPack(r.id, applyThreadId, threadManager, skillEngine, {
          allowTrust: true,
          forceTakeoverTrust: forceTakeover,
          confirmation_phrase: rest.confirmation_phrase,
        })
        if (!ar.ok) {
          return {
            type: "pack.saved_user",
            id: r.id,
            packs: r.packs,
            apply_error: ar.error,
            apply_code: (ar as any).code,
            holders: Array.isArray((ar as any).holders) ? (ar as any).holders : undefined,
          }
        }
        return {
          type: "pack.saved_user",
          id: r.id,
          packs: r.packs,
          applied: true,
          thread: ar.thread,
        }
      }
      return { type: "pack.saved_user", id: r.id, packs: r.packs }
    }
    case "pack.delete_user": {
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "pack.delete_user requires user_gesture:true",
          code: "user_gesture_required",
        }
      }
      if (!rest.pack_id || typeof rest.pack_id !== "string") {
        return { type: "error", error: "pack.delete_user requires pack_id" }
      }
      const { deleteUserPack } = await import("./packs/pack-engine")
      const r = deleteUserPack(rest.pack_id, threadManager, skillEngine)
      if (!r.ok) return { type: "error", error: r.error, code: (r as any).code }
      return {
        type: "pack.deleted_user",
        pack_id: rest.pack_id,
        restored_threads: r.restored_threads,
        packs: r.packs,
      }
    }
    case "pack.suggest_config": {
      // UI-only suggestion — does NOT write packs; user must confirm + save.
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "pack.suggest_config requires user_gesture:true",
          code: "user_gesture_required",
        }
      }
      const { suggestSceneConfig } = await import("./packs/suggest-scene")
      const { getConfig } = await import("./config")
      const cfg = getConfig()
      const skillsMeta = skillEngine.list().map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
      }))
      let mcpMeta: Array<{ name: string; description?: string }> = []
      try {
        const { getMcpManager } = await import("./mcp/manager")
        mcpMeta = getMcpManager()
          .listServers()
          .map((s: any) => ({
            name: s.name,
            description:
              typeof s.config?.description === "string"
                ? s.config.description
                : typeof s.description === "string"
                  ? s.description
                  : undefined,
          }))
      } catch {
        // Fall back to configured server keys only
        const servers = (cfg as any).mcp?.servers
        if (servers && typeof servers === "object") {
          mcpMeta = Object.keys(servers).map((name) => ({ name }))
        }
      }
      const llm =
        cfg.llm?.base_url && cfg.llm?.model_name
          ? {
              base_url: cfg.llm.base_url,
              api_key: cfg.llm.api_key || "",
              model_name: cfg.llm.model_name,
              temperature: typeof cfg.llm.temperature === "number" ? cfg.llm.temperature : 0.3,
            }
          : null
      const modeRaw = typeof rest.mode === "string" ? rest.mode : "recommend"
      const mode =
        modeRaw === "generate" || modeRaw === "optimize" || modeRaw === "recommend"
          ? modeRaw
          : "recommend"
      if (mode === "optimize") {
        const p =
          typeof rest.system_prompt_append === "string" ? rest.system_prompt_append.trim() : ""
        if (!p) {
          return {
            type: "error",
            error: "pack.suggest_config mode=optimize requires non-empty system_prompt_append",
          }
        }
      }
      const suggestion = await suggestSceneConfig({
        brief: typeof rest.brief === "string" ? rest.brief : "",
        name: typeof rest.name === "string" ? rest.name : undefined,
        existingPrompt:
          typeof rest.system_prompt_append === "string" ? rest.system_prompt_append : undefined,
        skills: skillsMeta,
        mcp: mcpMeta,
        llm,
        mode,
      })
      return { type: "pack.suggest_config", suggestion }
    }
    case "modules.list": {
      const config = getConfig()
      return {
        type: "modules.list",
        capability_profile: config.capability_profile || "community",
        modules: config.modules || {},
      }
    }
    // --- Outbound MCP L4+ grants (Settings UI) ---
    case "outbound_mcp.grants.list": {
      const {
        listOutboundGrants,
      } = await import("./outbound-mcp/outbound-grants")
      const config = getConfig()
      return {
        type: "outbound_mcp.grants.list",
        require_grant: config.outbound_mcp?.require_grant === true,
        grants: listOutboundGrants(),
      }
    }
    case "outbound_mcp.grants.issue": {
      const { issueOutboundGrant } = await import("./outbound-mcp/outbound-grants")
      const caller_id =
        typeof rest.caller_id === "string" ? rest.caller_id.trim() : ""
      if (!caller_id) {
        return { type: "error", error: "caller_id required" }
      }
      const label =
        typeof rest.label === "string" && rest.label.trim()
          ? rest.label.trim()
          : caller_id
      let ttl_ms: number | undefined
      if (rest.ttl_ms !== undefined && rest.ttl_ms !== null && rest.ttl_ms !== "") {
        const n = Number(rest.ttl_ms)
        if (!Number.isFinite(n) || n < 0) {
          return { type: "error", error: "ttl_ms must be a non-negative number (0 = no expiry)" }
        }
        ttl_ms = n
      }
      try {
        const issued = issueOutboundGrant({ label, caller_id, ttl_ms })
        const { listOutboundGrants } = await import("./outbound-mcp/outbound-grants")
        return {
          type: "outbound_mcp.grants.issued",
          // Raw token shown once in UI — never re-fetchable
          grant: {
            id: issued.id,
            label: issued.label,
            caller_id: issued.caller_id,
            profile: issued.profile,
            expires_at: issued.expires_at,
            created_at: issued.created_at,
            token: issued.token,
          },
          grants: listOutboundGrants(),
          require_grant: getConfig().outbound_mcp?.require_grant === true,
        }
      } catch (e: any) {
        return { type: "error", error: e?.message || String(e) }
      }
    }
    case "outbound_mcp.grants.revoke": {
      const { revokeOutboundGrant, listOutboundGrants } = await import(
        "./outbound-mcp/outbound-grants"
      )
      const id = typeof rest.grant_id === "string" ? rest.grant_id.trim() : ""
      if (!id) return { type: "error", error: "grant_id required" }
      const ok = revokeOutboundGrant(id)
      if (!ok) return { type: "error", error: `grant not found: ${id}` }
      return {
        type: "outbound_mcp.grants.list",
        grants: listOutboundGrants(),
        require_grant: getConfig().outbound_mcp?.require_grant === true,
        revoked_id: id,
      }
    }
    case "outbound_mcp.grants.revoke_all": {
      const { revokeAllOutboundGrants, listOutboundGrants } = await import(
        "./outbound-mcp/outbound-grants"
      )
      const n = revokeAllOutboundGrants()
      return {
        type: "outbound_mcp.grants.list",
        grants: listOutboundGrants(),
        require_grant: getConfig().outbound_mcp?.require_grant === true,
        revoked_count: n,
      }
    }
    case "outbound_mcp.set_require_grant": {
      if (typeof rest.require_grant !== "boolean") {
        return { type: "error", error: "require_grant boolean required" }
      }
      const current = getConfig()
      saveConfig({
        outbound_mcp: {
          ...(current.outbound_mcp || {}),
          require_grant: rest.require_grant,
        },
      })
      const {
        listOutboundGrants,
      } = await import("./outbound-mcp/outbound-grants")
      return {
        type: "outbound_mcp.grants.list",
        require_grant: getConfig().outbound_mcp?.require_grant === true,
        grants: listOutboundGrants(),
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
    case "workspace.clear": {
      // UI-only: unbind workspace from thread (does not delete files).
      if (!rest.thread_id || typeof rest.thread_id !== "string") {
        return { type: "error", error: "workspace.clear requires thread_id" }
      }
      if (rest.user_gesture !== true) {
        return {
          type: "error",
          error: "workspace.clear requires user_gesture:true",
          code: "user_gesture_required",
        }
      }
      const thread = threadManager.get(rest.thread_id)
      if (!thread) return { type: "error", error: "thread not found" }
      threadManager.update(rest.thread_id, { workspace_root: null } as any)
      return { type: "workspace.clear_result", thread: threadManager.get(rest.thread_id) }
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

    // ADR-021: process-memory unattended desktop grant (not config SoT)
    case "security.unattended.arm": {
      const {
        armUnattended,
        captureCruiseSnapshot,
        registerCruiseRestoreHandler,
      } = await import("./computer/unattended-grant")
      // Ensure TTL expire path can restore dual-write (idempotent re-register)
      registerCruiseRestoreHandler((snap) => {
        const current = getConfig()
        saveConfig({
          security: {
            ...(current.security || {}),
            auto_approve_dangerous: snap ? snap.auto_approve_dangerous : false,
            auto_approve_enterprise_tools: snap ? snap.auto_approve_enterprise_tools : false,
            allow_all_schemes: snap ? snap.allow_all_schemes : false,
          },
        })
        logger.info("security.unattended.cruise_restored", {
          had_snapshot: !!snap,
          via: "ttl_or_handler",
        })
      })
      // S36 P0: server-side dual-ack (UI checkboxes alone are not a trust boundary)
      const ackDesktop = rest.ack_desktop === true
      const ackSession = rest.ack_session === true
      if (!ackDesktop || !ackSession) {
        return {
          type: "error",
          error:
            "Arming unattended desktop requires ack_desktop=true and ack_session=true (Settings dual-ack).",
        }
      }
      const includeProtocol = rest.include_protocol === true
      // C1: capture pre-arm cruise BEFORE dual-write so disarm/TTL can restore
      const current = getConfig()
      captureCruiseSnapshot({
        auto_approve_dangerous: current.security?.auto_approve_dangerous === true,
        auto_approve_enterprise_tools: current.security?.auto_approve_enterprise_tools === true,
        allow_all_schemes: current.security?.allow_all_schemes === true,
      })
      const result = armUnattended({
        confirmation_phrase: rest.confirmation_phrase,
        include_protocol: includeProtocol,
        max_budget_cap: rest.max_budget_cap,
        max_actions_cap: rest.max_actions_cap,
      })
      if (!result.ok) {
        const { discardCruiseSnapshot } = await import("./computer/unattended-grant")
        discardCruiseSnapshot()
        return { type: "error", error: result.error }
      }
      // Packaging dual-write: exact cruise target vector (CU skip still only via grant).
      // Phrase + acks already validated — safe to persist flags.
      // allow_all_schemes is set exactly to include_protocol (clear sticky residual).
      saveConfig({
        security: {
          ...(current.security || {}),
          auto_approve_dangerous: true,
          auto_approve_enterprise_tools: true,
          allow_all_schemes: includeProtocol,
        },
      })
      logger.info("security.unattended.arm_ok", {
        include_protocol: includeProtocol,
        expires_at: result.status.expiresAt,
      })
      return { type: "security.unattended.status", ...result.status }
    }
    case "security.unattended.disarm": {
      const {
        disarmUnattended,
        restoreCruiseFromSnapshot,
        registerCruiseRestoreHandler,
        getCruiseSnapshot,
      } = await import("./computer/unattended-grant")
      const { flipAllComputerTaskAborts } = await import("./computer/task-abort-registry")
      const { securityPolicy } = await import("./security-policy")
      // C1: restore pre-arm cruise when grant or snapshot present (Pi nit: bare disarm
      // without prior arm must not clobber intentionally-set cruise flags).
      registerCruiseRestoreHandler((snap) => {
        const current = getConfig()
        saveConfig({
          security: {
            ...(current.security || {}),
            auto_approve_dangerous: snap ? snap.auto_approve_dangerous : false,
            auto_approve_enterprise_tools: snap ? snap.auto_approve_enterprise_tools : false,
            allow_all_schemes: snap ? snap.allow_all_schemes : false,
          },
        })
      })
      const hadSnapshot = !!getCruiseSnapshot()
      const status = disarmUnattended()
      const clearCruise = rest.clear_cruise === true
      const { shouldRestoreCruiseOnDisarm } = await import("./computer/unattended-grant")
      let cruiseRestored = false
      if (
        shouldRestoreCruiseOnDisarm({
          had_grant: status.had_grant,
          had_snapshot: hadSnapshot,
          clear_cruise: clearCruise,
        })
      ) {
        // clear_cruise:true forces restore/clear even without snapshot (user intent to wipe cruise)
        restoreCruiseFromSnapshot({
          forceNull: clearCruise && !hadSnapshot && !status.had_grant,
        })
        cruiseRestored = true
      }
      // S36 P0/F3: disarm stops in-flight host_computer injects
      const aborted = flipAllComputerTaskAborts()
      if (aborted > 0) {
        logger.warn("security.unattended.disarm_aborted_computer_tasks", { matched: aborted })
      }
      // S-F3 residual: drop live host_computer L2 tokens so post-disarm re-entry re-gates
      const purged = securityPolicy.purgeIssuedTokensForTool("host_computer")
      if (purged > 0) {
        logger.info("security.unattended.disarm_purged_tokens", { tool: "host_computer", purged })
      }
      const { had_grant: _hg, ...statusPublic } = status
      return {
        type: "security.unattended.status",
        ...statusPublic,
        computer_tasks_aborted: aborted,
        tokens_purged: purged,
        cruise_restored: cruiseRestored,
      }
    }
    case "security.unattended.status": {
      const { getUnattendedStatus } = await import("./computer/unattended-grant")
      const status = getUnattendedStatus()
      return { type: "security.unattended.status", ...status }
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
      // Absolute first: platform fail-closed before param/security noise (P0).
      if (os.platform() !== "darwin") {
        return {
          type: "tool.result",
          id: msg.id,
          success: false,
          error: OSASCRIPT_MACOS_ONLY_ERROR,
        }
      }
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

// --- Security helpers (hasPrototypePollutionKey → handlers/config.ts) ---

// --- MCP helpers ---

const MCP_VALID_TRUST_LEVELS = new Set(["manual", "first-use", "trusted"])
const MCP_VALID_TRANSPORTS = new Set(["stdio", "http"])
const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * SEC-B: authenticated mcp.add/update stdio must not spawn without L2.
 * Fail closed when no origin-bound confirmation channel (tests without session
 * cannot silently register spawners).
 */
async function requireMcpStdioSpawnConfirm(
  session: SessionCallbacks | undefined,
  name: string,
  cfg: McpServerConfig,
  action: "add" | "update",
): Promise<{ type: "error"; error: string } | null> {
  if (cfg.transport !== "stdio") return null
  if (!session?.requestConfirmation) {
    return {
      type: "error",
      error:
        "MCP stdio server requires interactive L2 confirmation (requestConfirmation channel missing)",
    }
  }
  const cmd = typeof cfg.command === "string" ? cfg.command : ""
  const args = Array.isArray(cfg.args) ? cfg.args.map(String).join(" ") : ""
  const cwd = typeof cfg.cwd === "string" ? cfg.cwd : "(default)"
  const decision = await session.requestConfirmation({
    toolName: `mcp.${action}_stdio`,
    dangerousApis: ["child_process.spawn", "mcp.stdio"],
    code: [
      `MCP ${action} stdio server "${name}"`,
      `command: ${cmd}`,
      `args: ${args}`,
      `cwd: ${cwd}`,
      `enabled: ${cfg.enabled !== false}`,
    ].join("\n"),
    riskLevel: "high",
    autoConfirmEligible: false,
    criticalApis: ["mcp.stdio.spawn"],
  })
  if (!decision.approved) {
    return {
      type: "error",
      error: `MCP stdio server ${action} denied (${decision.reason})`,
    }
  }
  return null
}

/** True when update changes the spawn surface (not mere trust_level / display). */
function mcpStdioSpawnSurfaceChanged(
  existing: McpServerConfig,
  merged: McpServerConfig,
): boolean {
  if (merged.transport === "stdio" && existing.transport !== "stdio") return true
  if (merged.transport !== "stdio") return false
  // Pi REJECT #1: enabling a disabled stdio server spawns the process
  const wasEnabled = existing.enabled !== false
  const willEnable = merged.enabled !== false
  if (!wasEnabled && willEnable) return true
  // Narrow after transport check — union members differ by transport.
  const ex = existing as Extract<McpServerConfig, { transport: "stdio" }> | McpServerConfig
  const mg = merged as Extract<McpServerConfig, { transport: "stdio" }>
  const exCmd = "command" in ex ? ex.command : undefined
  const mgCmd = mg.command
  if (exCmd !== mgCmd) return true
  const exArgs = "args" in ex ? ex.args : undefined
  const mgArgs = mg.args
  if (JSON.stringify(exArgs || []) !== JSON.stringify(mgArgs || [])) return true
  const exCwd = "cwd" in ex ? ex.cwd : undefined
  const mgCwd = mg.cwd
  if ((exCwd || "") !== (mgCwd || "")) return true
  const exEnv = "env" in ex ? ex.env : undefined
  const mgEnv = mg.env
  if (JSON.stringify(exEnv || {}) !== JSON.stringify(mgEnv || {})) return true
  return false
}

/** Restore env/headers when client echoes redacted `***` placeholders (list→edit→save). */
function restoreMaskedRecord(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (incoming === undefined) return existing
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === "***" && existing && typeof existing[k] === "string") {
      out[k] = existing[k]
    } else if (v !== "***") {
      out[k] = v
    }
    // v === "***" with no existing key → drop (never persist mask literal)
  }
  return out
}

function mergeMcpServerPreservingSecrets(
  existing: McpServerConfig,
  patch: Partial<McpServerConfig>,
): McpServerConfig {
  const merged = { ...existing, ...patch } as any
  const exAny = existing as any
  if (patch && typeof (patch as any).env === "object") {
    merged.env = restoreMaskedRecord(exAny.env, (patch as any).env)
  }
  if (patch && typeof (patch as any).headers === "object") {
    merged.headers = restoreMaskedRecord(exAny.headers, (patch as any).headers)
  }
  return merged as McpServerConfig
}

/** Mask env/headers on MCP metas for WS list/update broadcasts. */
export function redactMcpServersForBroadcast(
  servers: McpServerMeta[] | Array<Record<string, any>>,
): any[] {
  return (servers || []).map((s) => {
    const copy: any = { ...s }
    if (copy.config && typeof copy.config === "object") {
      const cfg = { ...copy.config }
      if (cfg.env && typeof cfg.env === "object") {
        const env: Record<string, string> = {}
        for (const k of Object.keys(cfg.env)) env[k] = "***"
        cfg.env = env
      }
      if (cfg.headers && typeof cfg.headers === "object") {
        const headers: Record<string, string> = {}
        for (const k of Object.keys(cfg.headers)) headers[k] = "***"
        cfg.headers = headers
      }
      copy.config = cfg
    }
    return copy
  })
}

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
