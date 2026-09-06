/**
 * Outbound MCP default profile (Phase 0) — curated L1 subset.
 *
 * Canonical / facade names stay `cmspark__*` (ADR-022 L5).
 * MCP stdio `tools/list` advertises the suffix only (`list_tabs`) so clients
 * that qualify tools as `server__tool` (Grok) emit `cmspark__list_tabs`
 * instead of the rejected `cmspark__cmspark__list_tabs` (exactly one `__`).
 * CallTool and HTTP invoke both run `canonicalOutboundMcpName` so short names
 * and `cmspark__*` aliases hit the same allowlist / exfil gates.
 */

export const OUTBOUND_MCP_NAME_PREFIX = "cmspark__"

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

/** MCP tools/list name: strip the canonical `cmspark__` prefix. */
export function outboundMcpWireName(canonical: string): string {
  return canonical.startsWith(OUTBOUND_MCP_NAME_PREFIX)
    ? canonical.slice(OUTBOUND_MCP_NAME_PREFIX.length)
    : canonical
}

/**
 * Map an MCP CallTool name to the canonical `cmspark__*` allowlist name.
 * Accepts both the wire suffix (`list_tabs`) and the old prefixed alias.
 */
export function canonicalOutboundMcpName(wireName: string): string {
  const n = (wireName || "").trim()
  if (!n) return n
  if (n.startsWith(OUTBOUND_MCP_NAME_PREFIX)) return n
  return `${OUTBOUND_MCP_NAME_PREFIX}${n}`
}

/**
 * Shape of a canonical name after `canonicalOutboundMcpName`:
 * `cmspark__` + a single identifier (`list_tabs`), no extra `__`.
 * Used only to split PROFILE_FORBIDDEN copy (illegal format vs off-profile).
 * Not a second allowlist.
 */
export function isCanonicalOutboundMcpNameShape(canonical: string): boolean {
  if (!canonical.startsWith(OUTBOUND_MCP_NAME_PREFIX)) return false
  const rest = canonical.slice(OUTBOUND_MCP_NAME_PREFIX.length)
  return /^[a-z][a-z0-9_]*$/.test(rest) && !rest.includes("__")
}

/** Audit / error-string cap: tool names only, never args or page body. */
export function redactOutboundMcpWireName(raw: string, max = 160): string {
  return String(raw || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .slice(0, max)
}

/** Internal tool name (without cmspark__ prefix) mapping. */
export function outboundToInternalName(name: string): string | null {
  if (!name.startsWith(OUTBOUND_MCP_NAME_PREFIX)) return null
  return name.slice(OUTBOUND_MCP_NAME_PREFIX.length)
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
