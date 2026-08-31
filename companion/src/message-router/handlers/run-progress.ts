// L0 RunProgress toggle (slice 6 PR-B Task 5). Thin family so message-router
// keeps only the case label for ws-router-validator-lockstep.
// Overlay write is denied by SUMMONER_ALLOW (do not add this type there).

import type { ThreadManager } from "../../threads/thread-manager"
import { userToggle } from "../../threads/run-progress"

export function handleRunProgressToggle(
  rest: Record<string, unknown>,
  threadManager: ThreadManager,
): Record<string, unknown> {
  const threadId = typeof rest.thread_id === "string" ? rest.thread_id : ""
  const itemId = typeof rest.item_id === "string" ? rest.item_id : ""
  if (!threadId) return { type: "error", error: "thread_id required" }
  if (!itemId) return { type: "error", error: "item_id required" }
  const thread = threadManager.get(threadId)
  if (!thread) return { type: "error", error: `Thread not found: ${threadId}` }
  // Sticky explicit clear — do not coerce null → { items: [] }.
  if (thread.run_progress === null) {
    return { type: "thread.updated", thread }
  }
  const current = thread.run_progress ?? { items: [] }
  const next = userToggle(current, itemId)
  try {
    const updated = threadManager.update(threadId, { run_progress: next })
    if (!updated) return { type: "error", error: `Thread not found: ${threadId}` }
    return { type: "thread.updated", thread: updated }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { type: "error", error: message }
  }
}
