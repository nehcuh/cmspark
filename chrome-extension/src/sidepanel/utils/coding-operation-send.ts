import type { AgentAction, CodingSessionState } from "../store/agentStore"

/** Forwarding feedback belongs to the captured owner; it never changes lifecycle. */
export function sendCodingOperation(
  session: Pick<CodingSessionState, "sessionId" | "threadId">,
  dispatch: (action: AgentAction) => void,
  request: { type: "acp.session.prompt" | "acp.session.followup" | "acp.apply_diff" | "acp.ui_start"; text?: string; goal?: string; mode?: string; cloud_disclosure_accepted?: boolean },
) {
  const identity = { sessionId: session.sessionId, threadId: session.threadId }
  dispatch({ type: "ACP_OPERATION_REQUEST", ...identity })
  const observe = (response: { ok?: boolean; error?: unknown } | undefined, thrown?: string) => {
    const error = thrown || chrome.runtime.lastError?.message ||
      (response?.ok === true ? "" : typeof response?.error === "string" && response.error
        ? response.error : "编程请求尚未确认转发，请检查连接后再决定是否重试。")
    if (error) dispatch({ type: "ACP_OPERATION_ERROR", ...identity, error })
  }
  try {
    chrome.runtime.sendMessage({ ...request, session_id: identity.sessionId, thread_id: identity.threadId }, observe)
  } catch (error) { observe(undefined, error instanceof Error ? error.message : "编程请求转发失败，请检查连接。") }
}
