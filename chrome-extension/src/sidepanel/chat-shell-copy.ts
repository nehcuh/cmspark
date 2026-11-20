import type { Message } from "./types"

export function parseGenerationLimit(value: unknown): Message["generation_limit"] {
  return value === "output_budget" || value === "context_window" || value === "length" ? value : undefined
}

export function truncationHonestyChip(msg: {
  content?: string
  reasoning_content?: string
  truncated?: boolean
  incomplete_tools?: boolean
  finish_reason?: string | null
  generation_limit?: Message["generation_limit"]
  tool_calls?: unknown[]
}): string | null {
  if (msg.tool_calls?.length && !msg.incomplete_tools) return null
  const content = String(msg.content || "").trim()
  const reasoning = String(msg.reasoning_content || "").trim()
  const reason = String(msg.finish_reason || "").toLowerCase()
  if (reason === "aborted" || reason === "abort") return "已停止生成"
  const limit = parseGenerationLimit(msg.generation_limit)
  if (limit === "context_window" || reason === "model_context_window_exceeded" || reason === "context_length_exceeded") {
    return "已到上下文上限"
  }
  if (limit === "output_budget" || reason === "max_tokens" || reason === "max_output_tokens") {
    return !content && reasoning ? "思考用尽输出上限" : "单次输出预算用尽"
  }
  if (limit === "length" || reason === "length" || msg.truncated) return "达到长度限制"
  if (!content && reasoning) return "模型未返回内容"
  return null
}

export const CHAT_SHELL_TITLE_PAGE = "要对这页做什么？"
export const CHAT_SHELL_TITLE_NONE = "要我帮你做什么？"
export const CHAT_SHELL_PAGE_CHIP_PREFIX = "当前页："
export const CHAT_SHELL_CHIPS = [
  { label: "总结这一页", fill: "请总结当前页面的要点" },
  { label: "用更简单的话讲这一页", fill: "用更简单的话讲这一页在干什么" },
  { label: "列出我能在这页替你做的操作", fill: "列出当前页我可以替你执行的操作" },
] as const

export function chatShellEmpty(pageTitle: string | null): {
  title: string
  pageChip: string | null
  chips: { label: string; fill: string }[]
} {
  const title = (pageTitle || "").trim()
  if (!title) {
    return { title: CHAT_SHELL_TITLE_NONE, pageChip: null, chips: [] }
  }
  return {
    title: CHAT_SHELL_TITLE_PAGE,
    pageChip: `${CHAT_SHELL_PAGE_CHIP_PREFIX}${title}`,
    chips: CHAT_SHELL_CHIPS.map((c) => ({ label: c.label, fill: c.fill })),
  }
}
