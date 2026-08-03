/**
 * Outbound MCP default profile (Phase 0) — curated L1 subset.
 * Names use cmspark__* prefix (brief L5).
 */

/** Tools allowed on the default outbound profile. */
export const OUTBOUND_MCP_ALLOWLIST = [
  "cmspark__list_tabs",
  "cmspark__navigate",
  "cmspark__get_page_text",
  "cmspark__click",
  "cmspark__type",
  "cmspark__screenshot",
  "cmspark__wait_for",
  "cmspark__downloads_find",
] as const

export type OutboundMcpToolName = (typeof OUTBOUND_MCP_ALLOWLIST)[number]

/** Tools that stream page content / pixels to an external LLM (L3+). */
export const OUTBOUND_MCP_EXFIL_CLASS = new Set<string>([
  "cmspark__get_page_text",
  "cmspark__screenshot",
])

/** Internal tool name (without cmspark__ prefix) mapping. */
export function outboundToInternalName(name: string): string | null {
  if (!name.startsWith("cmspark__")) return null
  return name.slice("cmspark__".length)
}

export function isOutboundAllowed(name: string): boolean {
  return (OUTBOUND_MCP_ALLOWLIST as readonly string[]).includes(name)
}

export function isOutboundForbidden(name: string): boolean {
  if (isOutboundAllowed(name)) return false
  // Any other name is forbidden on default profile
  return true
}

export const OUTBOUND_DISCLOSURE_ZH =
  "此 MCP 调用将把页面文本/截图发送给外部编程 Agent 使用的云端模型。仅在你已确认该任务与数据分类允许时继续。"
