import type { AgentAction, AgentState, CodingSessionState } from "../store/agentStore"

export type CodingSelectionCapture = { threadRevision: number; selectionRevision: number }
export function captureCodingSelection(state: Pick<AgentState, "activeThreadSelectionRevision" | "activeCodingSelectionRevision">): CodingSelectionCapture {
  return { threadRevision: state.activeThreadSelectionRevision, selectionRevision: state.activeCodingSelectionRevision }
}
type Request = { type: "acp.session.prompt" | "acp.session.followup" | "acp.apply_diff" | "acp.ui_start"; text?: string; goal?: string; mode?: string; cloud_disclosure_accepted?: boolean; agent_id?: string; workspace_root?: string; page_context?: string; page_url?: string; page_title?: string; repo_hint?: string }
type Pending = CodingSelectionCapture & { sessionId: string; threadId: string; requestType: Request["type"] }
const pending = new Map<string, Pending>()
const key = (row: Pick<Pending, "sessionId" | "threadId" | "requestType">) => JSON.stringify([row.threadId, row.sessionId, row.requestType])

/** Disconnect/unmount retires only local feedback correlation, never execution authority. */
export function clearCodingOperationFeedback(): void { pending.clear() }

/** Consume a single actual reply only when its original local request can be identified. */
export function takeCodingOperationReply(message: Record<string, unknown>): AgentAction | null {
  if (message.type === "error" && message.family !== "acp") return null
  const requestType = message.type === "error" ? message.request_type
    : message.type === "acp.ui_start.accepted" || message.type === "acp.ui_start.denied" ? "acp.ui_start"
    : message.type === "acp.apply_diff.result" || message.type === "acp.apply_diff.denied" ? "acp.apply_diff"
    : message.type === "acp.session.prompt.accepted" || message.type === "acp.session.prompt.denied" ? "acp.session.prompt" : undefined
  if (typeof message.session_id !== "string" || typeof message.thread_id !== "string") return null
  const ownerRows = [...pending.values()].filter(row => row.threadId === message.thread_id)
  let matches = ownerRows.filter(row => row.sessionId === message.session_id && row.requestType === requestType)
  if (!matches.length && typeof message.parent_session_id === "string") {
    matches = ownerRows.filter(row => row.sessionId === message.parent_session_id &&
      (row.requestType === "acp.session.followup" && (requestType === "acp.ui_start" || requestType === "acp.session.followup") || row.requestType === "acp.session.prompt" && requestType === "acp.session.prompt"))
  }
  if (!matches.length && message.parent_session_id === undefined && requestType === "acp.ui_start") {
    matches = ownerRows.filter(row => row.sessionId === "" && row.requestType === "acp.ui_start")
  }
  if (matches.length !== 1) return null // missing/ambiguous old wire cannot borrow today's view
  const row = matches[0]!
  pending.delete(key(row))
  const error = typeof message.error === "string" && message.error ? message.error
    : message.type === "acp.ui_start.denied" || message.type === "acp.session.prompt.denied" || message.type === "acp.apply_diff.denied" ? "编程请求已取消。" : ""
  return error ? { type: "ACP_OPERATION_ERROR", ...row, error } : { type: "ACP_OPERATION_SETTLED", ...row,
    ...(message.session_id !== row.sessionId ? { resultSessionId: message.session_id } : {}) }
}

/** Forwarding is not execution success. Captures stay local, never on wire or in persistence. */
export function sendCodingOperation(
  session: Pick<CodingSessionState, "sessionId" | "threadId">,
  dispatch: (action: AgentAction) => void,
  request: Request,
  capture: CodingSelectionCapture,
  current: () => boolean = () => true,
  onForwardResult?: (error: string | null) => void,
): boolean {
  if (!current()) return false
  const identity = { sessionId: session.sessionId, threadId: session.threadId, ...capture }
  const row: Pending = { ...identity, requestType: request.type }, id = key(row)
  if (pending.has(id) || pending.size >= 64) {
    dispatch({ type: "ACP_OPERATION_ERROR", ...identity, error: "该编程操作仍在等待本机回执，请勿重复发送；连接中断后请重新核对。" })
    return false
  }
  pending.set(id, row)
  dispatch({ type: "ACP_OPERATION_REQUEST", ...identity })
  const observe = (response: { ok?: boolean; error?: unknown } | undefined, thrown?: string) => {
    if (pending.get(id) !== row) return
    const error = thrown || chrome.runtime.lastError?.message ||
      (response?.ok === true ? "" : typeof response?.error === "string" && response.error
        ? response.error : "编程请求尚未确认转发，请检查连接后再决定是否重试。")
    if (error) {
      pending.delete(id)
      dispatch({ type: "ACP_OPERATION_ERROR", ...identity, error })
      if (current()) onForwardResult?.(error)
    } else if (current()) onForwardResult?.(null)
  }
  try {
    chrome.runtime.sendMessage({ ...request, ...(identity.sessionId ? { session_id: identity.sessionId } : {}), thread_id: identity.threadId }, observe)
  } catch (error) { observe(undefined, error instanceof Error ? error.message : "编程请求转发失败，请检查连接。") }
  return true
}
