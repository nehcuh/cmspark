// Single-pass message scan for list enrichment + cleanup input (no extra I/O).
// Spec: docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md

import {
  firstPartyHeadLine,
  isAcpFailTemplate,
  looksLikeAcpText,
} from "./cleanup-rules"

export type AcpListMeta = {
  outcome: "ok" | "partial" | "fail" | "cancelled"
  agent_id?: string
  goal_preview?: string
}

export type ThreadMessageInspect = {
  message_count: number
  user_message_count: number
  assistant_chars: number
  looks_like_acp: boolean
  assistant_excerpt: string
  acp_list: AcpListMeta | null
}

function contentOf(m: { content?: unknown }): string {
  const c = m?.content
  if (typeof c === "string") return c
  if (c == null) return ""
  try {
    return JSON.stringify(c)
  } catch {
    return String(c)
  }
}

/** Parse first-party handback head we wrote — not the untrusted body. */
export function parseAcpHead(text: string): AcpListMeta | null {
  const m = String(text || "").match(
    /【编程接力\s*·\s*([a-zA-Z0-9_-]{1,32})\s*·\s*([a-zA-Z0-9_]+)】([^\n]*)/,
  )
  if (!m) return null
  const agent_id = m[1]
  const rest = m[3] || ""
  let outcome: AcpListMeta["outcome"] = "ok"
  if (isAcpFailTemplate(firstPartyHeadLine(text))) outcome = "fail"
  else if (rest.includes("部分")) outcome = "partial"
  else if (rest.includes("取消")) outcome = "cancelled"
  return { outcome, agent_id }
}

export function inspectThreadMessages(
  msgs: Array<{ role?: string; content?: unknown }>,
): ThreadMessageInspect {
  const list = Array.isArray(msgs) ? msgs : []
  let user_message_count = 0
  let assistant_chars = 0
  let looks_like_acp = false
  let assistant_excerpt = ""
  let acp_list: AcpListMeta | null = null

  for (const m of list) {
    const text = contentOf(m)
    if (m.role === "user") user_message_count++
    if (m.role === "assistant") {
      assistant_chars += text.replace(/\s+/g, "").length
      if (!assistant_excerpt) assistant_excerpt = text.slice(0, 400)
      if (looksLikeAcpText(text)) {
        looks_like_acp = true
        if (!acp_list) acp_list = parseAcpHead(text)
      }
    }
  }

  if (looks_like_acp && !acp_list) {
    acp_list = {
      outcome: isAcpFailTemplate(firstPartyHeadLine(assistant_excerpt)) ? "fail" : "ok",
    }
  }

  return {
    message_count: list.length,
    user_message_count,
    assistant_chars,
    looks_like_acp,
    assistant_excerpt,
    acp_list,
  }
}
