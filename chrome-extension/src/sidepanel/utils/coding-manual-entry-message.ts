import type { AgentAction } from "../store/agentStore"

/** UI-only actual producer replies, never an execution receipt or generic ACP error guess. */
export function codingManualEntryAction(message: Record<string, unknown>): AgentAction | null {
  if (typeof message.session_id !== "string" || !message.session_id ||
      typeof message.thread_id !== "string" || !message.thread_id ||
      typeof message.request_id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(message.request_id)) return null
  const identity = { sessionId: message.session_id, threadId: message.thread_id, requestId: message.request_id }
  if (message.type === "error" && message.family === "acp" && message.request_type === "acp.session.prepare_manual_entry")
    return { type: "ACP_MANUAL_ENTRY_RESULT", ...identity,
      error: typeof message.error === "string" && message.error ? message.error : "无法准备交互启动命令。" }
  if (message.type !== "acp.session.manual_entry") return null
  if (typeof message.command_line !== "string" || !message.command_line ||
      new TextEncoder().encode(message.command_line).byteLength > 32 * 1024 ||
      (message.shell !== "cmd.exe" && message.shell !== "POSIX sh"))
    return { type: "ACP_MANUAL_ENTRY_RESULT", ...identity, error: "收到的交互启动命令无效；请重试。" }
  return { type: "ACP_MANUAL_ENTRY_RESULT", ...identity, commandLine: message.command_line, shell: message.shell }
}
