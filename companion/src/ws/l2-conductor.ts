import { getComputerTaskAbortRegistry } from "../computer/task-abort-registry"

export const L2_CONDUCTOR_ELSEWHERE = "L2_CONDUCTOR_ELSEWHERE" as const

export type ChatCreateConductorError = {
  type: "chat.error"
  thread_id: string
  error: string
  data: { error_code: typeof L2_CONDUCTOR_ELSEWHERE }
}

export function isComputerTaskLive(
  registry: Map<string, boolean> = getComputerTaskAbortRegistry(),
): boolean {
  return registry.size > 0
}

/** Overlay must not conduct while host_computer is LIVE. HUD/Cockpit stays conductor. */
export function gateChatCreateOnConductor(
  thread_id: string,
  surface: unknown,
  registry: Map<string, boolean> = getComputerTaskAbortRegistry(),
): ChatCreateConductorError | null {
  if (!isComputerTaskLive(registry)) return null
  if (surface !== "summoner") return null
  return {
    type: "chat.error",
    thread_id,
    error: "L2_CONDUCTOR_ELSEWHERE: continue in the confirm surface",
    data: { error_code: L2_CONDUCTOR_ELSEWHERE },
  }
}
