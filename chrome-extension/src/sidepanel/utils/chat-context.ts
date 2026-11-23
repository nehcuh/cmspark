import { useMemo, useSyncExternalStore } from "react"

export interface ChatContextOptions {
  automatic_knowledge?: boolean
  include_page?: boolean
  knowledge_ids?: string[]
  skill_ids?: string[]
}

const prefix = "cmspark.chat-context."
const changeEvent = "cmspark:chat-context-changed"
export const maxContextSources = 32

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(changeEvent, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(changeEvent, callback)
  }
}

export function useChatContext(threadId: string | null): ChatContextOptions | undefined {
  const value = useSyncExternalStore(subscribe, () => {
    try { return threadId ? localStorage.getItem(prefix + threadId) : null } catch { return null }
  })
  return useMemo(() => {
    if (value) {
      try { return JSON.parse(value) as ChatContextOptions } catch { return undefined }
    }
  }, [value])
}

export function saveChatContext(threadId: string, options: ChatContextOptions) {
  const value = {
    ...(options.automatic_knowledge === false ? { automatic_knowledge: false } : {}),
    ...(options.include_page === false ? { include_page: false } : {}),
    ...(options.knowledge_ids?.length ? { knowledge_ids: options.knowledge_ids } : {}),
    ...(options.skill_ids ? { skill_ids: options.skill_ids } : {}),
  }
  if (Object.keys(value).length) localStorage.setItem(prefix + threadId, JSON.stringify(value))
  else localStorage.removeItem(prefix + threadId)
  window.dispatchEvent(new Event(changeEvent))
}
