import { buildFleetSnapshot } from "../../orchestrator/fleet"
import { chooseFleetFollowup, type FleetFollowupAction } from "../../orchestrator/fleet-continuity"
import type { ThreadManager } from "../../threads/thread-manager"

type Session = { surface?: string; isCurrentSession?: () => boolean; broadcast?: (frame: unknown) => void }

export function handleFleetFollowupChoice(
  request: { thread_id: string; offer_id: string; action: FleetFollowupAction; user_gesture?: boolean },
  tm: ThreadManager,
  session?: Session,
) {
  if (session?.surface !== "panel" || session.isCurrentSession?.() !== true || request.user_gesture !== true) {
    return { type: "error", error: "需要在主对话中选择子任务的后续处理方式" }
  }
  const ok = chooseFleetFollowup(tm, request.thread_id, request.offer_id, request.action)
  const snapshot = buildFleetSnapshot(tm)
  if (ok) session.broadcast?.(snapshot)
  return ok ? snapshot : { ...snapshot, followup_error: { thread_id: request.thread_id, message: "子任务状态已更新，请使用当前选项。" } }
}
