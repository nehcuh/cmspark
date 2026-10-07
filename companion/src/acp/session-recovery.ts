import { getAcpManager } from "./manager"
import { resolveAcpThreadId } from "./thread-id"
import type { AcpSessionRecord } from "./types"

export type AcpSessionSummary = Pick<AcpSessionRecord, "session_id" | "agent_id" | "state">

export function currentAcpSessions(threadId: string): AcpSessionSummary[] {
  if (!threadId) return []
  return getAcpManager().listSessionsForThread(threadId).slice(-10)
    .map(({ session_id, agent_id, state }) => ({ session_id, agent_id, state }))
}

/** Missing runtime handles are recoverable; new starts still use the existing L2 gate. */
export function acpSessionLookupFailure(params: Record<string, unknown>, sessionId: string) {
  const sessions = currentAcpSessions(resolveAcpThreadId(params))
  return {
    success: false,
    error_code: sessionId ? "ACP_SESSION_NOT_FOUND" : "ACP_SESSION_ID_REQUIRED",
    error: sessionId
      ? "ACP 会话不存在或已失效；后台重启会清空 ACP 会话。不要继续使用历史 session_id。先查询当前会话；若没有，重新 acp_propose_session，再用返回的新 session_id 经确认 acp_start_session。"
      : "ACP 查询需要 session_id，不能使用 agent_id 代替。使用本线程当前会话 ID；若没有，重新 acp_propose_session，再经确认 acp_start_session。",
    data: {
      current_sessions: sessions,
      suggested_action: sessions.length ? "use_current_acp_session" : "propose_new_acp_session",
      data_not_instruction: true,
    },
  }
}
