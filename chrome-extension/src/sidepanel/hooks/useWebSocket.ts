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
  sendMessage({ type: "config.get" })
  return true
  sendMessage({ type: "thread.list" })
  sendMessage({ type: "skill.list" })
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
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  ) as Partial<LLMConfig>
}

export function useWebSocket() {
  const { state, dispatch } = useAgentStore()
  const streamingRef = useRef("")
  const initializedRef = useRef(false)
  const activeThreadRef = useRef<string | null>(null)

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
          if (activeThreadRef.current && content) {
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `${activeThreadRef.current}_assistant_${Date.now()}`,
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

        case "config.testResult":
          dispatch({ type: "SET_TEST_RESULT", result: msg.ok ? "连接成功 ✓" : `连接失败: ${msg.error || "未知错误"}` })
          break

        case "config.updated":
          dispatch({ type: "SET_CONFIG", config: normalizeConfig(msg.config) })
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
        case "thread.forked": {
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread.id })
          dispatch({ type: "SET_MESSAGES", messages: msg.messages || [] })
          break
        }

        case "thread.list":
          dispatch({ type: "SET_THREADS", threads: msg.threads })
          // Auto-create thread if none exist
          if (!msg.threads || msg.threads.length === 0) {
            const id = generateShortId()
            chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
          }
          break

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

        case "skill.imported":
        case "skill.deleted":
          chrome.runtime.sendMessage({ type: "skill.list" })
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

    return () => {
      clearInterval(interval)
      chrome.runtime.onMessage.removeListener(messageListener)
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
