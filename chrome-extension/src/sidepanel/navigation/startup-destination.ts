import { projectCopy } from "./project-copy"

export function commitStartupNavigation(input: {
  commitGeneration: number
  currentGeneration: number
  rememberedThreadId: string | null
  threads: Array<{ id: string; trashed_at?: string | null }>
  activeThreadId: string | null
  connection: "connected" | "connecting" | "disconnected"
  listArrived: boolean
}): { ignored: true; reason: "stale-generation" } | { ignored: false; layer: "session" | "projects"; activeThreadId: string | null; selectThread: false | string; homeCopy: string | null; remembered: string | null } {
  if (input.commitGeneration !== input.currentGeneration) return { ignored: true, reason: "stale-generation" }
  const usable = (id: string | null) => !!id && input.threads.some(thread => thread.id === id && !thread.trashed_at)
  if (!input.listArrived && input.rememberedThreadId) {
    return { ignored: false, layer: "session", activeThreadId: input.rememberedThreadId, selectThread: false, homeCopy: null, remembered: input.rememberedThreadId }
  }
  if (usable(input.rememberedThreadId) && input.rememberedThreadId) {
    return { ignored: false, layer: "session", activeThreadId: input.rememberedThreadId, selectThread: input.connection === "connected" && input.activeThreadId !== input.rememberedThreadId ? input.rememberedThreadId : false, homeCopy: null, remembered: input.rememberedThreadId }
  }
  if (input.listArrived && input.rememberedThreadId) {
    return { ignored: false, layer: "projects", activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreInvalid, remembered: null }
  }
  return { ignored: false, layer: "projects", activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreNone, remembered: null }
}

export function decideActiveThreadList(input: {
  activeThreadId: string | null
  rememberedThreadId: string | null
  incoming: Array<{ id: string; trashed_at?: string | null }>
  listScope: "active" | "trash" | "all"
}): { createBlank: false; selectIncomingFirst: false; activeThreadId: string | null; selectThread: false | string; homeCopy: string | null } {
  if (input.listScope !== "active") {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.activeThreadId, selectThread: false, homeCopy: null }
  }
  const usable = input.incoming.filter(thread => !thread.trashed_at)
  if (input.activeThreadId && usable.some(thread => thread.id === input.activeThreadId)) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.activeThreadId, selectThread: false, homeCopy: null }
  }
  if (input.rememberedThreadId && usable.some(thread => thread.id === input.rememberedThreadId)) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.rememberedThreadId, selectThread: input.rememberedThreadId, homeCopy: null }
  }
  if (input.rememberedThreadId) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreInvalid }
  }
  return { createBlank: false, selectIncomingFirst: false, activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreNone }
}
