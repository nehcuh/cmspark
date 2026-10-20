import { getOwnedPtyContext, readPtyTail } from "./session"
import { terminalTailUnavailable, type TerminalTailResult } from "./tail"
import { resolveEffectiveExecutionPolicy, type ExecutionPolicy } from "../tool/plan-readonly"
import { markAcpHandbackSeen } from "../acp/taint"

type Thread = { execution_policy?: ExecutionPolicy | null; parent_thread_id?: string | null; agent_role?: string | null }
/** Private executor closure. No origin/thread authority comes from the tool JSON. */
export function bindTerminalTailReader(originWs: unknown, actingThreadId: string | undefined,
  getThread: (id: string) => Thread | null | undefined, authenticated: () => boolean): (id: string) => TerminalTailResult {
  return id => {
    if (!authenticated() || !actingThreadId || typeof id !== "string") return terminalTailUnavailable()
    const thread = getThread(actingThreadId)
    if (!thread || thread.agent_role === "worker" || resolveEffectiveExecutionPolicy(actingThreadId, getThread) === "plan_readonly") return terminalTailUnavailable()
    const context = getOwnedPtyContext(id, originWs)
    if (!context || context.threadId !== actingThreadId) return terminalTailUnavailable()
    const result = readPtyTail(id, originWs, actingThreadId)
    // Synchronous; no await between current identity checks, snapshot and taint.
    if (result.success) markAcpHandbackSeen(actingThreadId)
    return result
  }
}
