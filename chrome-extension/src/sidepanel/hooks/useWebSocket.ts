// WebSocket hook for Side Panel — communicates with background service worker

import { useEffect, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import type { LLMConfig } from "../types"

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function requestInitialSidePanelData(
  sendMessage: (message: object) => void,
  initializedRef: { current: boolean },
): boolean {
  if (initializedRef.current) return false
  initializedRef.current = true
  sendMessage({ type: "thread.list" })
  sendMessage({ type: "skill.list" })
  sendMessage({ type: "knowledge.list" })
  sendMessage({ type: "config.get" })
  sendMessage({ type: "mcp.list" })
  return true
}

export function normalizeConfig(config: any): Partial<LLMConfig> {
  if (!config) return {}
  const llm = config.llm || config
  const normalized: Partial<LLMConfig> = {
    base_url: llm.base_url,
    api_key: llm.api_key === "***" ? "" : llm.api_key,
    model_name: llm.model_name,
    temperature: llm.temperature,
    context_window: llm.context_window,
  }
  if (Array.isArray(config.trusted_domains)) {
    normalized.trusted_domains = config.trusted_domains
  }
  if (Array.isArray(config.auto_approved_domains)) {
    normalized.auto_approved_domains = config.auto_approved_domains
  }
  // Security: flatten nested config.security.auto_approve_dangerous → LLMConfig.auto_approve_dangerous
  if (config.security && typeof config.security.auto_approve_dangerous === "boolean") {
    normalized.auto_approve_dangerous = config.security.auto_approve_dangerous
  }
  // Vision config fields (flattened from config.vision)
  const vision = config.vision
  if (vision) {
    normalized.vision_enabled = !!vision.enabled
    normalized.vision_api_key = vision.api_key === "***" ? "" : vision.api_key
    normalized.vision_base_url = vision.base_url
    normalized.vision_model_name = vision.model_name
    normalized.vision_timeout_ms = vision.timeout_ms
    normalized.vision_fallback = vision.fallback
  } else {
    // Explicitly disable vision when companion sends no vision block
    normalized.vision_enabled = false
  }
  // File upload config fields (flattened from config.file_upload)
  const fileUpload = config.file_upload
  if (fileUpload) {
    normalized.file_upload_max_size = fileUpload.max_file_size
    normalized.file_upload_max_tokens = fileUpload.max_file_tokens
    normalized.file_upload_vision = !!fileUpload.enable_vision_analysis
  }
  // Obsidian export: flatten config.obsidian.vault_path
  if (config.obsidian && typeof config.obsidian.vault_path === "string") {
    normalized.obsidian_vault_path = config.obsidian.vault_path
  }
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  ) as Partial<LLMConfig>
}

export function useWebSocket() {
  const { state, dispatch } = useAgentStore()
  const streamingRef = useRef("")
  const initializedRef = useRef(false)
  const activeThreadRef = useRef<string | null>(null)
  const blankThreadCreatedRef = useRef(false)

  // Keep refs in sync
  activeThreadRef.current = state.activeThreadId

  useEffect(() => {
    const requestInitialData = () => requestInitialSidePanelData((message) => {
      chrome.runtime.sendMessage(message)
    }, initializedRef)
    // Restore send shortcut preference
    chrome.storage.local.get("sendShortcut", (result) => {
      if (result.sendShortcut) {
        dispatch({ type: "SET_SEND_SHORTCUT", shortcut: result.sendShortcut })
      }
    })

    // Listen for messages from background (broadcast via chrome.runtime.sendMessage)
    const messageListener = (msg: any) => {
      switch (msg.type) {
        case "chat.token":
          streamingRef.current = msg.content
          dispatch({ type: "SET_STREAMING", content: msg.content })
          break

        case "chat.done": {
          const content = streamingRef.current
          streamingRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          if (activeThreadRef.current && content) {
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                // Prefer the companion's persisted message id (echoed in chat.done) so the
                // UI id matches what's stored — anchor-based features (per-message export)
                // then work on the just-received response without a thread reload. Fall back
                // to a client id only if the companion didn't echo one.
                id: msg.message_id || `${activeThreadRef.current}_assistant_${Date.now()}`,
                thread_id: activeThreadRef.current,
                role: "assistant",
                content,
                created_at: new Date().toISOString(),
              },
            })
          }
          break
        }

        case "chat.aborted":
          streamingRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `${activeThreadRef.current}_abort_${Date.now()}`,
              thread_id: activeThreadRef.current || "",
              role: "assistant",
              content: "⏹ 已停止生成",
              created_at: new Date().toISOString(),
            },
          })
          break

        case "log.event": {
          const log = msg.data
          if (log && log.level !== "debug") {
            dispatch({
              type: "ADD_LOG",
              entry: {
                ts: msg.ts || log.ts || new Date().toISOString(),
                level: log.level || "info",
                source: log.source || "unknown",
                event: log.event || "unknown",
                data: log.data || {},
              },
            })
          }
          break
        }

        case "chat.error":
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `${activeThreadRef.current}_error_${Date.now()}`,
              thread_id: activeThreadRef.current || "",
              role: "assistant",
              content: `❌ ${msg.error}`,
              created_at: new Date().toISOString(),
            },
          })
          break

        case "tool.start":
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: msg.tool_call_id,
              thread_id: activeThreadRef.current || "",
              role: "tool",
              content: "",
              tool_calls: [{
                id: msg.tool_call_id,
                tool_name: msg.tool_name,
                params: msg.params || {},
                result: null,
                status: "running",
              }],
              created_at: new Date().toISOString(),
            },
          })
          break

        case "tool.result":
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: {
              result: msg.result,
              status: msg.result?.success ? "success" : "error",
            },
          })
          break

        case "tool.vision_start":
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: { vision_status: "analyzing" },
          })
          break

        case "tool.vision_done":
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: {
              vision_status: msg.error ? "error" : (msg.cached ? "cached" : "done"),
              vision_latency_ms: msg.latency_ms,
            },
          })
          break

        case "config.testVisionResult":
          dispatch({
            type: "SET_TEST_RESULT",
            result: msg.ok
              ? `视觉模型连接成功 ✓ (${msg.model || ""})`
              : `视觉模型连接失败: ${msg.error || "未知错误"}`,
          })
          break

        case "config.testResult":
          dispatch({ type: "SET_TEST_RESULT", result: msg.ok ? "连接成功 ✓" : `连接失败: ${msg.error || "未知错误"}` })
          break

        case "config.updated":
          dispatch({ type: "SET_CONFIG", config: normalizeConfig(msg.config) })
          if (msg.source === "companion" && msg.config?.llm) {
            dispatch({ type: "SET_COMPANION_CONFIG", config: normalizeConfig(msg.config) as any })
          }
          break

        case "security.confirmation.request":
          dispatch({
            type: "ADD_SECURITY_CONFIRMATION",
            request: {
              confirmation_id: msg.confirmation_id,
              tool_name: msg.tool_name,
              dangerous_apis: Array.isArray(msg.dangerous_apis) ? msg.dangerous_apis : [],
              code_preview: msg.code_preview || "",
              timeout_ms: msg.timeout_ms,
              requested_at: msg.requested_at,
              risk_score: msg.risk_score ?? 0,
              risk_category: msg.risk_category ?? "unknown",
              risk_level: msg.risk_level ?? "high",
              auto_confirm_eligible: msg.auto_confirm_eligible ?? false,
              defense_layer: msg.defense_layer,
              relevant_domains: Array.isArray(msg.relevant_domains) ? msg.relevant_domains : [],
            },
          })
          break

        case "security.confirmation.resolved":
        case "security.confirmation.expired":
          dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: msg.confirmation_id })
          break

        case "thread.created": {
          // Upsert: don't duplicate if already added locally
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          // Auto-select when:
          //  - quick action explicitly requests it, OR
          //  - no thread is currently active (fresh load: our new blank thread)
          if ((msg.auto_select || !activeThreadRef.current) && activeThreadRef.current !== msg.thread.id) {
            dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread.id })
            dispatch({ type: "SET_MESSAGES", messages: [] })
          }
          break
        }

        case "thread.updated": {
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          // Sync skill_selection_mode if this is the active thread
          if (msg.thread?.id === activeThreadRef.current && msg.thread?.skill_selection_mode) {
            dispatch({ type: "SET_SKILL_SELECTION_MODE", mode: msg.thread.skill_selection_mode })
          }
          // Sync knowledge_selection_mode if this is the active thread
          if (msg.thread?.id === activeThreadRef.current && msg.thread?.knowledge_selection_mode) {
            dispatch({ type: "SET_KNOWLEDGE_SELECTION_MODE", mode: msg.thread.knowledge_selection_mode })
          }
          break
        }
        case "thread.deleted": {
          dispatch({ type: "REMOVE_THREAD", threadId: msg.thread_id })
          break
        }
        case "thread.cleanup_empty.completed": {
          const count = msg.deleted_count || 0
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: "info",
              source: "extension",
              event: "cleanup_empty_threads",
              data: { deleted_count: count, deleted_ids: msg.deleted_ids || [] },
            },
          })
          // Refresh thread list to stay in sync after bulk deletion.
          chrome.runtime.sendMessage({ type: "thread.list" })
          break
        }
        case "thread.title_generated": {
          if (msg.thread) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          }
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: "info",
              source: "extension",
              event: "thread_title_generated",
              data: { thread_id: msg.thread_id, alias: msg.thread?.alias },
            },
          })
          break
        }
        case "thread.forked": {
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread.id })
          dispatch({ type: "SET_MESSAGES", messages: msg.messages || [] })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          break
        }

        case "thread.list":
          dispatch({ type: "SET_THREADS", threads: msg.threads })
          // Only create a fresh blank thread on first load when there are no
          // existing threads. Creating one on every thread.list refresh (for
          // example when the side panel is reopened or becomes visible again)
          // causes empty threads to pile up in the conversation history.
          if (msg.threads.length === 0 && !blankThreadCreatedRef.current) {
            blankThreadCreatedRef.current = true
            const id = generateShortId()
            chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
          }
          break

        case "quickAction.start": {
          const { thread_id, prompt, alias } = msg
          if (!thread_id) break
          // Create thread in UI
          dispatch({
            type: "UPSERT_THREAD",
            thread: {
              id: thread_id,
              alias: alias || "",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              config_override: {} as any,
              tool_whitelist: null,
              pinned_tabs: [],
              active_skill_ids: [],
            },
          })
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread_id })
          dispatch({ type: "SET_MESSAGES", messages: [] })
          // Only auto-send message if prompt is non-empty
          if (prompt) {
            dispatch({ type: "SET_PROCESSING", isProcessing: true })
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `${thread_id}_qa_${Date.now()}`,
                thread_id,
                role: "user",
                content: prompt,
                created_at: new Date().toISOString(),
              },
            })
            // Send chat message through background to companion
            chrome.runtime.sendMessage({
              type: "chat.send",
              threadId: thread_id,
              message: prompt,
            })
          }
          break
        }

        case "thread.messages":
          dispatch({ type: "SET_MESSAGES", messages: msg.messages })
          break

        case "skill.auto_matched":
          const autoSkills = (msg.skills || []).map((s: any) => s.name).join(", ")
          if (autoSkills) {
            dispatch({
              type: "SET_AUTO_SKILLS",
              names: autoSkills,
            })
          }
          break

        case "skill.list":
          dispatch({ type: "SET_SKILLS", skills: msg.skills })
          break

        case "mcp.list":
        case "mcp.servers.updated":
          if (Array.isArray(msg.servers)) {
            dispatch({ type: "SET_MCP_SERVERS", servers: msg.servers })
          }
          break

        case "mcp.server.status_changed": {
          const server = msg.server
          if (server && server.name) {
            dispatch({ type: "UPDATE_MCP_SERVER_STATUS", server })
          }
          break
        }

        case "mcp.tool_call_started":
        case "mcp.tool_call_finished":
          // Best-effort UI hint — no store change required; could log to console.
          // Future enhancement: surface as a transient toast.
          break

        case "knowledge.list":
          dispatch({ type: "SET_KNOWLEDGE_DOCS", docs: msg.docs || [] })
          break

        case "skill.exported": {
          const { content, format, skill_name } = msg
          if (content) {
            const mimeType = format === "zip" ? "application/zip" : "text/markdown"
            const ext = format === "zip" ? ".zip" : ".md"
            // Decode: zip is base64, markdown is plain text
            const isBase64 = format === "zip"
            const bytes = isBase64
              ? Uint8Array.from(atob(content), c => c.charCodeAt(0))
              : new TextEncoder().encode(content)
            const blob = new Blob([bytes], { type: mimeType })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${skill_name}${ext}`
            a.click()
            URL.revokeObjectURL(url)
          }
          break
        }

        case "thread.exported_obsidian": {
          const { content, filename } = msg
          if (content) {
            const blob = new Blob([new TextEncoder().encode(content)], { type: "text/markdown" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename || "export.md"
            a.click()
            URL.revokeObjectURL(url)
          }
          // P3: a pending summary export just resolved (download or not) — clear its spinner.
          dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: null })
          break
        }

        case "obsidian.profile_ready": {
          const profile = msg.profile
          if (profile) {
            // Summarize what was learned: notes sampled + (P2) vault index size + template count.
            const parts = [`分析了 ${msg.files_sampled ?? profile.files_sampled ?? "?"} 篇笔记`]
            if (msg.index_count != null) parts.push(`索引 ${msg.index_count} 篇`)
            if (msg.template_count != null && msg.template_count > 0) parts.push(`模板 ${msg.template_count} 个`)
            dispatch({
              type: "SET_OBSIDIAN_PROFILE_STATUS",
              status: { ok: true, message: `✓ Vault 档案已更新（${parts.join(" · ")}）` },
            })
          } else {
            dispatch({
              type: "SET_OBSIDIAN_PROFILE_STATUS",
              status: { ok: false, message: msg.reason || "未识别到 vault 结构化约定" },
            })
          }
          break
        }

        case "skill.imported":
        case "skill.deleted":
          chrome.runtime.sendMessage({ type: "skill.list" })
          break

        case "knowledge.imported":
        case "knowledge.deleted":
          chrome.runtime.sendMessage({ type: "knowledge.list" })
          break

        case "error":
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `error_${Date.now()}`,
              thread_id: activeThreadRef.current || "",
              role: "assistant",
              content: `\u274c ${msg.error || "Unknown error"}`,
              created_at: new Date().toISOString(),
            },
          })
          // P3: a failed summary export surfaces as an error chat message \u2014 clear its spinner.
          dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: null })
          break

        case "history.result":
          dispatch({ type: "SET_OPERATIONS", operations: msg.operations })
          break

        case "connected": {
          dispatch({ type: "SET_CONNECTION", state: "connected" })
          requestInitialData()
          break
        }
      }
    }
    chrome.runtime.onMessage.addListener(messageListener)

    // Poll connection status from background
    const pollStatus = () => {
      chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) return
        if (response) {
          dispatch({ type: "SET_CONNECTION", state: response.connectionState })
          if (response.connectionState === "connected") {
            requestInitialData()
          } else {
            initializedRef.current = false
          }
        }
      })
    }

    pollStatus()
    const interval = setInterval(pollStatus, 3000)

    // Refresh thread list when sidepanel becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        chrome.runtime.sendMessage({ type: "thread.list" })
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Long-lived port connection to keep the service worker alive while sidepanel is open
    const port = chrome.runtime.connect({ name: "cmspark-sidepanel" })

    return () => {
      clearInterval(interval)
      chrome.runtime.onMessage.removeListener(messageListener)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      port.disconnect()
    }
  }, [dispatch])

  const send = (msg: object) => {
    chrome.runtime.sendMessage(msg)
  }

  return {
    connectionState: state.connectionState,
    send,
  }
}
