// WebSocket hook for Side Panel — communicates with background service worker

import { useEffect, useRef } from "react"
import { useAgentStore } from "../store/agentStore"

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function useWebSocket() {
  const { state, dispatch } = useAgentStore()
  const streamingRef = useRef("")
  const initializedRef = useRef(false)
  const activeThreadRef = useRef<string | null>(null)

  // Keep refs in sync
  activeThreadRef.current = state.activeThreadId

  useEffect(() => {
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

        case "tool.result":
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `${msg.tool_call_id}_result`,
              thread_id: activeThreadRef.current || "",
              role: "tool",
              content: JSON.stringify(msg.result, null, 2),
              tool_calls: [{
                id: msg.tool_call_id,
                tool_name: msg.tool_name,
                params: {},
                result: msg.result,
                status: msg.result?.success ? "success" : "error",
              }],
              created_at: new Date().toISOString(),
            },
          })
          break

        case "config.updated":
          dispatch({ type: "SET_CONFIG", config: msg.config })
          break

        case "thread.created":
          dispatch({ type: "ADD_THREAD", thread: msg.thread })
          break

        case "thread.list":
          dispatch({ type: "SET_THREADS", threads: msg.threads })
          break

        case "thread.messages":
          dispatch({ type: "SET_MESSAGES", messages: msg.messages })
          break

        case "skill.list":
          dispatch({ type: "SET_SKILLS", skills: msg.skills })
          break

        case "skill.imported":
        case "skill.deleted":
          chrome.runtime.sendMessage({ type: "skill.list" })
          break

        case "history.result":
          dispatch({ type: "SET_OPERATIONS", operations: msg.operations })
          break

        case "connected": {
          dispatch({ type: "SET_CONNECTION", state: "connected" })
          // Request initial data if first connect
          if (!initializedRef.current) {
            initializedRef.current = true
            chrome.runtime.sendMessage({ type: "thread.list" })
            chrome.runtime.sendMessage({ type: "skill.list" })
          }
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
      }
    }
    chrome.runtime.onMessage.addListener(messageListener)

    // Poll connection status from background
    const pollStatus = () => {
      chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) return
        if (response) {
          dispatch({ type: "SET_CONNECTION", state: response.connectionState })
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
