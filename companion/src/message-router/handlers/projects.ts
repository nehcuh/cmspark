import type { ThreadManager } from "../../threads/thread-manager"
import { ProjectError, validateProjectRequest, type ProjectMethod } from "../../threads/project-store"
import { projectConfirmationActivity, projectRunAdmissionActivity } from "../../threads/project-activity"
import { getAcpManager } from "../../acp/manager"
import { peekEmbedIntent } from "../../acp/open-local-terminal"
import { isPtyBusy } from "../../pty/session"
import { hasPendingTerminalOpen } from "../../pty/handler"
import { listPendingToolsForThread } from "../../ws/tool-forward"
import { listActiveShellRunIds } from "../../capability/shell"

export function projectThreadActivity(id: string, llmActive: (id: string) => boolean): "idle" | "busy" | "unknown" {
  const admission = projectRunAdmissionActivity(id)
  if (admission !== "idle") return admission
  const confirms = projectConfirmationActivity()
  if (confirms !== "idle") return confirms
  if (llmActive(id) || listPendingToolsForThread(id).length ||
    getAcpManager().hasProjectThreadActivity(id) ||
    peekEmbedIntent(id) || isPtyBusy() || hasPendingTerminalOpen() || listActiveShellRunIds().length) return "busy"
  return "idle"
}

/** Public DTO enrichment only. Never stores project projections in ThreadManager's index. */
export function projectThreadProjection(tm: ThreadManager, thread: any): any {
  if (!thread || typeof thread.id !== "string" || typeof thread.created_at !== "string") return thread
  const { project_id: _old, project_metadata_unavailable: _unavailable, ...row } = thread
  try { return { ...row, project_id: tm.projects.projectId(thread) } }
  catch { return { ...row, project_metadata_unavailable: true } }
}
export function projectReplyProjection(tm: ThreadManager, reply: any): any {
  if (!reply || typeof reply !== "object") return reply
  if (reply.thread) reply = { ...reply, thread: projectThreadProjection(tm, reply.thread) }
  if (reply.type === "thread.list" && Array.isArray(reply.threads)) {
    try { const ids = tm.projects.projectIds(reply.threads); reply = { ...reply, threads: reply.threads.map((t: any) => ({ ...t, project_id: ids.get(t.id) || null, project_metadata_unavailable: undefined })) } }
    catch { reply = { ...reply, project_metadata_unavailable: true, threads: reply.threads.map((t: any) => ({ ...t, project_id: undefined, project_metadata_unavailable: true })) } }
  }
  if (reply.type === "thread.messages") {
    const thread = projectThreadProjection(tm, tm.get(reply.thread_id))
    reply = { ...reply, project_id: thread?.project_id, project_metadata_unavailable: thread?.project_metadata_unavailable }
  }
  return reply
}
export function handleProjectMessage(type: ProjectMethod, rest: Record<string, any>, tm: ThreadManager,
  surface: unknown, llmActive: (id: string) => boolean): any {
  const { id: _correlation, ...data } = rest
  try {
    if (surface !== "panel" && surface !== "summoner") throw new ProjectError("PROJECT_METHOD_DENIED")
    validateProjectRequest(type, data)
    if (type === "project.list") return { type: "project.state", ...tm.projects.list() }
    let committedThread: any
    const result = tm.projects.mutate(type, data, { thread: id => {
      const thread = tm.get(id)
      if (type === "thread.project.set") committedThread = thread
      return thread
    }, busy: id => projectThreadActivity(id, llmActive) })
    // The atomic write has completed. Use the committed result instead of re-reading disk.
    return { type: "project.changed", ...result, operation_id: data.operation_id,
      ...(committedThread ? { thread: { ...committedThread, project_id: result.project_id } } : {}) }
  } catch (error) {
    const fault = error instanceof ProjectError ? error : new ProjectError("PROJECT_STORE_INVALID")
    return { type: "project.error", error_code: fault.code, error: fault.message,
      ...(typeof data.operation_id === "string" && /^[0-9a-f-]{36}$/.test(data.operation_id) ? { operation_id: data.operation_id } : {}) }
  }
}
