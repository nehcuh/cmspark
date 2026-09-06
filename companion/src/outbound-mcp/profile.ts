import {
  OUTBOUND_L1_DEFAULT_PROFILE,
  OUTBOUND_L1_INTERACT_PROFILE,
} from "./outbound-grants"

/**
 * Outbound MCP profiles (ADR-022 P1 named profiles).
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

/**
 * #410 — interact-profile extras (NOT part of OUTBOUND_MCP_ALLOWLIST).
 * L1 interactive completeness (ADR-022 P1 reserved interact profile).
 * get_page_html / analyze_image carry DOM/pixel exfil → OUTBOUND_MCP_EXFIL_CLASS
 * (same allow_page_export gate as page text / screenshot — no new flag).
 */
export const OUTBOUND_MCP_INTERACT_EXTRAS = [
  "cmspark__scroll",
  "cmspark__get_element_info",
  "cmspark__press_key",
  "cmspark__select_option",
  "cmspark__hover",
  "cmspark__dblclick",
  "cmspark__fill_form",
  "cmspark__drag_and_drop",
  "cmspark__create_tab",
  "cmspark__get_page_html",
  "cmspark__analyze_image",
] as const

/**
 * Profile → granted canonical tool set. interact is a superset of the default
 * 8: an interact key keeps list_tabs / navigate / click / … and adds the
 * interactive completeness set above (issue #410 产品句: interact 钥匙可
 * 「滚动长页、看清元素再点击、填表单」). Default key set is byte-identical.
 */
export const OUTBOUND_PROFILE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  [OUTBOUND_L1_DEFAULT_PROFILE]: OUTBOUND_MCP_ALLOWLIST,
  [OUTBOUND_L1_INTERACT_PROFILE]: [
    ...OUTBOUND_MCP_ALLOWLIST,
    ...OUTBOUND_MCP_INTERACT_EXTRAS,
  ],
}

/** Canonical tools granted by a (non-empty) set of profiles, default first. */
export function outboundToolsForProfiles(profiles: Iterable<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const order = [
    OUTBOUND_L1_DEFAULT_PROFILE,
    OUTBOUND_L1_INTERACT_PROFILE,
  ]
  const profileSet = new Set(
    Array.from(profiles).filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    ),
  )
  const merged = new Set<string>()
  for (const p of order) {
    if (profileSet.size > 0 && !profileSet.has(p)) continue
    for (const t of OUTBOUND_PROFILE_TOOLS[p] ?? []) merged.add(t)
  }
  // Unset profiles (empty input) = caller-level default grant semantics.
  if (profileSet.size === 0) {
    for (const t of OUTBOUND_MCP_ALLOWLIST) merged.add(t)
  }
  for (const t of merged) {
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/** True iff `canonical` is granted on at least one of `profiles`. */
export function outboundToolAllowedOnProfiles(
  canonical: string,
  profiles: Iterable<string>,
): boolean {
  return outboundToolsForProfiles(profiles).includes(canonical)
}

/** Tools that stream page content / pixels / DOM to an external LLM (L3+). */
export const OUTBOUND_MCP_EXFIL_CLASS = new Set<string>([
  "cmspark__get_page_text",
  "cmspark__screenshot",
  // #410 interact-profile DOM / pixel reads share the same allow_page_export
  // gate as page text / screenshot (design 3.1.3: reuse, no new flag).
  "cmspark__get_page_html",
  "cmspark__analyze_image",
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
