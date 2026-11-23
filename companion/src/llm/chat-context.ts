export interface ChatContextOptions {
  automatic_knowledge?: boolean
  include_page?: boolean
  knowledge_ids?: string[]
  skill_ids?: string[]
}

export interface ChatContextInput {
  chat_context?: ChatContextOptions
  context_tab_id?: number
  hostname?: string
  url?: string
  skill_ids?: string[]
}

export function validChatContext(value: unknown): value is ChatContextOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(([key, item]) => {
    if (key === "automatic_knowledge" || key === "include_page") return typeof item === "boolean"
    if (key !== "knowledge_ids" && key !== "skill_ids") return false
    return Array.isArray(item) && item.length <= 32 &&
      item.every(id => typeof id === "string" && id.trim().length > 0 && id.length <= 256)
  })
}
