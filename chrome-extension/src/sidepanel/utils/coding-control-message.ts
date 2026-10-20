import type { AgentAction } from "../store/agentStore"

/** Actual Companion control receipts/errors. Reducer checks immutable stored session ownership. */
export function codingControlAction(message: Record<string, unknown>): AgentAction | null {
  if (typeof message.session_id !== "string" || !message.session_id ||
      typeof message.thread_id !== "string" || !message.thread_id) return null
  if (message.type === "acp.session.cancel.ack") return {
    type: "ACP_CANCEL_RECEIPT", sessionId: message.session_id, threadId: message.thread_id,
  }
  if (message.type === "error" && message.family === "acp" && message.request_type === "acp.session.cancel") return {
    type: "ACP_CONTROL_ERROR", sessionId: message.session_id, threadId: message.thread_id,
    error: typeof message.error === "string" && message.error ? message.error : "编程助手错误",
  }
  if (message.type === "error" && message.family === "acp" &&
      typeof message.request_type === "string" &&
      ["acp.session.followup", "acp.session.prompt", "acp.apply_diff"].includes(message.request_type)) return {
    type: "ACP_OPERATION_ERROR", sessionId: message.session_id, threadId: message.thread_id,
    error: typeof message.error === "string" && message.error ? message.error : "编程助手错误",
  }
  // Older/other replies cannot borrow the current view's private capture or guess Stop.
  return null
}
