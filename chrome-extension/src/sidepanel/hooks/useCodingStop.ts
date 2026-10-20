import { useEffect, useState, useRef } from "react"
import { codingSessionBelongsToThread, useAgentStore, type CodingSessionState } from "../store/agentStore"

/** Shared panel/chip control. Runtime success is forwarding, never lifecycle completion. */
export function useCodingStop(session: CodingSessionState | null) {
  const { state, dispatch } = useAgentStore()
  const currentState = useRef(state)
  currentState.current = state
  const [ownerError, setOwnerError] = useState("")
  useEffect(() => { setOwnerError("") }, [session?.sessionId, session?.threadId])
  useEffect(() => {
    if (!session?.stopPending) return
    const target = session
    const timer = window.setTimeout(() => {
      dispatch({ type: "ACP_CONTROL_ERROR", sessionId: target.sessionId, threadId: target.threadId,
        error: "停止尚未确认，请检查连接后重试；会话状态以本机回执为准。" })
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [session?.sessionId, session?.threadId, session?.stopPending, dispatch])
  const stop = () => {
    if (currentState.current.activeThreadSelectionRevision !== state.activeThreadSelectionRevision ||
        currentState.current.activeCodingSelectionRevision !== state.activeCodingSelectionRevision) return
    if (!session?.sessionId || !codingSessionBelongsToThread(session, state.activeThreadId)) {
      setOwnerError("无法停止：当前会话不属于此对话，请返回所属对话后重试。")
      return
    }
    if (session.stopPending || session.state === "closed" || session.cacheCompacted) return
    setOwnerError("")
    const target = session
    dispatch({ type: "ACP_CONTROL_REQUEST", sessionId: target.sessionId, threadId: target.threadId })
    const observe = (response: { ok?: boolean; error?: string } | undefined, thrown?: string) => {
      const error = thrown || chrome.runtime.lastError?.message ||
        (response?.ok === true ? "" : response?.error || "停止请求未发送成功，请重试。")
      // The immutable owner/session reducer fence permits a late error only on its original row.
      if (error) dispatch({ type: "ACP_CONTROL_ERROR", sessionId: target.sessionId, threadId: target.threadId, error })
    }
    try {
      chrome.runtime.sendMessage({ type: "acp.session.cancel", session_id: target.sessionId, thread_id: target.threadId }, observe)
    } catch (error) { observe(undefined, error instanceof Error ? error.message : String(error)) }
  }
  return { stop, pending: session?.stopPending === true, error: session?.controlError || ownerError }
}
