import { retireComputerReadonlyThread } from "../computer/readonly-session"
import { cancelDeferredLlmKick, releaseMultiAgentLlmLoop, setThreadRunActiveProbe } from "../orchestrator/llm-loop-gate"
import { clearNextRun, dropSteer } from "./run-queues"

const controllers = new Map<string, AbortController>()
const panels = new Map<string, string>()
// Keep the generation after releasing a controller. A settled run may still
// drain nextRun, unless a successor claimed its thread in the meantime.
const generations = new Map<string, number>()

export function isThreadRunActive(threadId: string): boolean {
  return controllers.has(threadId)
}

setThreadRunActiveProbe(isThreadRunActive)

export function listLlmActiveThreadIds(): string[] {
  return [...controllers.keys()]
}

function advanceGeneration(threadId: string): number {
  const generation = (generations.get(threadId) ?? 0) + 1
  generations.set(threadId, generation)
  return generation
}

export function isCurrentRunGeneration(threadId: string, generation: number): boolean {
  return generations.get(threadId) === generation
}

/** Publish the successor before the caller cancels or drains its predecessor. */
export function claimThreadRun(threadId: string, panelId?: string) {
  const previous = controllers.get(threadId)
  const generation = advanceGeneration(threadId)
  const controller = new AbortController()
  controllers.set(threadId, controller)
  if (panelId) panels.set(threadId, panelId)
  return { generation, controller, previous }
}

export function ownsThreadRun(threadId: string, controller: AbortController): boolean {
  return controllers.get(threadId) === controller
}

/** Only the caller who installed the controller may release the slot. */
export function releaseRunController(threadId: string, controller: AbortController | null): void {
  if (controller && ownsThreadRun(threadId, controller)) {
    controllers.delete(threadId)
    panels.delete(threadId)
  }
}

export function finishThreadRun(threadId: string, generation: number, controller: AbortController): void {
  if (!isCurrentRunGeneration(threadId, generation)) return
  releaseRunController(threadId, controller)
  releaseMultiAgentLlmLoop(threadId)
}

export function installKickAbortController(threadId: string): AbortController | null {
  return isThreadRunActive(threadId) ? null : claimThreadRun(threadId).controller
}

export function abortThreadChat(
  threadId: string,
  opts?: { clearQueue?: boolean },
): { stopped: boolean; cancelled: number } {
  if (!threadId) return { stopped: false, cancelled: 0 }
  retireComputerReadonlyThread(threadId)
  // Releasing the gate synchronously drains deferred kicks.
  cancelDeferredLlmKick(threadId)
  const controller = controllers.get(threadId)
  if (controller) {
    controller.abort()
    controllers.delete(threadId)
    panels.delete(threadId)
    advanceGeneration(threadId)
    releaseMultiAgentLlmLoop(threadId)
  }
  dropSteer(threadId)
  return { stopped: !!controller, cancelled: opts?.clearQueue ? clearNextRun(threadId) : 0 }
}

export function abortLlmLoopsForPanel(panelId: string | undefined | null): number {
  if (!panelId) return 0
  let stopped = 0
  for (const [threadId, owner] of [...panels]) {
    if (owner === panelId && abortThreadChat(threadId).stopped) stopped++
  }
  return stopped
}

export function __testSetLlmActiveForTests(threadId: string, active: boolean): void {
  if (active) claimThreadRun(threadId)
  else {
    controllers.delete(threadId)
    generations.delete(threadId)
    panels.delete(threadId)
  }
}

export function __testSetLlmOwnerForTests(threadId: string, panelId: string | null): void {
  if (!threadId) return
  if (panelId) panels.set(threadId, panelId)
  else panels.delete(threadId)
}
