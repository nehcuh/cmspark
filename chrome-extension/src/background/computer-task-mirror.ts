// SW-side mirror of computer task + pending security confirms for Cockpit hydrate.
// Cockpit is a separate React tree; mid-open must not show empty TaskDock / no abort.
// Spec must-fix: dual-surface rehydrate (P0+P1 impl review Q2).

import { reduceComputerTaskEvent } from "../sidepanel/utils/computer-utils"
import type {
  ComputerTaskEventView,
  ComputerTaskState,
  SecurityConfirmationRequest,
} from "../sidepanel/types"

// reduceComputerTaskEvent import — computer-utils doesn't need chrome.
// Types only from sidepanel.

let computerTask: ComputerTaskState | null = null
const pendingConfirms = new Map<string, SecurityConfirmationRequest>()

export function noteComputerTaskEvent(msg: Record<string, unknown>): void {
  if (typeof msg.taskId !== "string" || typeof msg.event !== "string") return
  computerTask = reduceComputerTaskEvent(computerTask, msg as unknown as ComputerTaskEventView)
  // Drop finished tasks after linger window is panel's job; keep for hydrate so
  // reopen still shows terminal state briefly. Clear when a new started replaces.
  if (computerTask?.status === "finished") {
    // keep until next started (reducer replaces on started)
  }
}

export function noteSecurityConfirmationRequest(msg: Record<string, unknown>): void {
  const id = msg.confirmation_id
  if (typeof id !== "string" || !id) return
  // Store a shallow copy of the request-shaped fields the UI needs
  pendingConfirms.set(id, msg as unknown as SecurityConfirmationRequest)
}

export function noteSecurityConfirmationGone(confirmationId: unknown): void {
  if (typeof confirmationId === "string") {
    pendingConfirms.delete(confirmationId)
  }
}

export function getHydrateSnapshot(): {
  computerTask: ComputerTaskState | null
  pendingConfirmations: SecurityConfirmationRequest[]
} {
  return {
    computerTask,
    pendingConfirmations: Array.from(pendingConfirms.values()),
  }
}

/** Test helper */
export function _resetMirrorForTests(): void {
  computerTask = null
  pendingConfirms.clear()
}
