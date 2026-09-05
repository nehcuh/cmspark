/**
 * Site op-memory — negative cache for L1 CDP tools (qg44es / WAVE-1 residual).
 *
 * WAVE-1 typed errors + DOM-script volume cap did not stop retry storms because:
 *   - MAX_SAME_TOOL_RECOVERABLE_FAILURES is per chatCreate and resets on 「继续」
 *   - the model hops click → get_element_info → type → press_key (name counter resets)
 *   - locator keys differ every try so A never fires (hgrsix / #357)
 *
 * This module:
 *   A. Locator ban: (thread, origin, tool, locator) fail N times → peek-refuse
 *   B. Tab attach freeze: CDP_ATTACH_FAILED / WRONG_ORIGIN on a tab → refuse
 *      other CDP tools on that tab until navigate/set_tab_url on THAT tabId
 *      (list_tabs/create_tab do not thaw)
 *   C. Origin CDP streak (#357): (thread, origin) CDP interactive fails
 *      SITE_ORIGIN_FAIL_ESCALATE times (cross locator + tool) → peek-refuse
 *      with suggested_action escalate_to_host_computer (L2 still required).
 *      Only http(s) origins aggregate (origin:unknown / chrome-extension: never).
 *      Attach freeze does not increment the origin counter.
 * Survives chatCreate / 「继续」 (in-process Map). Origin change is a new key.
 *
 * Shared counter for #358 rebase: `originFails` + `getOriginFailCount`.
 * snapshotOriginCdpFails / hydrateOriginCdpFails are the read/restore seam
 * (this ticket does not write files; persist stays #358).
 */

import { platform } from "node:os"
import { originKeyFromUrl } from "./dom-script-budget.js"

export const SITE_LOCATOR_FAIL_BAN = 2
export const SITE_ATTACH_FAIL_BAN = 1
/** Same (thread, origin) CDP interactive failures before origin-level escalate. */
export const SITE_ORIGIN_FAIL_ESCALATE = 4
export const EVALUATE_NULL_RESULT = "EVALUATE_NULL_RESULT"

const CDP_INTERACTIVE = new Set([
  "click",
  "dblclick",
  "type",
  "hover",
  "fill_form",
  "get_element_info",
  "select_option",
  "press_key",
  "drag_and_drop",
  "evaluate",
  "wait_for",
  "get_page_html",
  "get_page_text",
  "scroll",
  "scroll_to",
])

/** Only these successes may thaw a frozen tab. create_tab/list_tabs must never. */
export const SITE_OP_THAW_TOOLS = new Set(["navigate", "set_tab_url"])

export function shouldThawAfterSuccess(toolName: string): boolean {
  return SITE_OP_THAW_TOOLS.has(toolName)
}

export const SITE_OP_EXPERIENCE_MAX = 24

const ATTACH_CODES = new Set(["CDP_ATTACH_FAILED", "WRONG_ORIGIN"])

export function isCdpInteractiveTool(toolName: string): boolean {
  return CDP_INTERACTIVE.has(toolName)
}

/** Collapse newlines / cap so locators cannot become fake prompt headings. */
export function sanitizeLocatorFragment(raw: string, max = 160): string {
  return String(raw || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[|#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

export function locatorKeyForTool(toolName: string, params: Record<string, unknown>): string {
  if (toolName === "press_key" && typeof params.key === "string") {
    return `key:${sanitizeLocatorFragment(params.key, 32)}`
  }
  const text = typeof params.text === "string" ? sanitizeLocatorFragment(params.text) : ""
  if (text) return `text:${text}`
  const selector = typeof params.selector === "string" ? sanitizeLocatorFragment(params.selector) : ""
  if (selector) return `css:${selector}`
  if (toolName === "fill_form" && Array.isArray(params.fields) && params.fields[0]) {
    const f = params.fields[0] as Record<string, unknown>
    const ft = typeof f.text === "string" ? sanitizeLocatorFragment(f.text) : ""
    if (ft) return `text:${ft}`
    const fs = typeof f.selector === "string" ? sanitizeLocatorFragment(f.selector) : ""
    if (fs) return `css:${fs}`
  }
  return "none"
}

/** Strip www so https://www.zhihu.com and https://zhihu.com share a key. */
export function canonicalizeSiteOrigin(origin: string): string {
  if (!origin || origin === "origin:unknown") return origin || "origin:unknown"
  return origin.replace(/^(https?:\/\/)www\./i, "$1")
}

/**
 * Prefer tabs.get/cache URL. If the tool has a tabId but cache is cold, do NOT
 * trust LLM params.url (wait_for / get_page_html poison).
 */
export function originForSiteOp(params: Record<string, unknown>, tabUrl?: string | null): string {
  if (tabUrl && String(tabUrl).trim()) return canonicalizeSiteOrigin(originKeyFromUrl(tabUrl))
  if (typeof params.tabId === "number") return "origin:unknown"
  if (typeof params.url === "string" && params.url.trim()) {
    return canonicalizeSiteOrigin(originKeyFromUrl(params.url))
  }
  return "origin:unknown"
}

/** Origin streak / persist only for real http(s) sites — not origin:unknown or chrome-extension:. */
export function isAggregatableSiteOrigin(origin: string): boolean {
  return /^https?:\/\//i.test(origin || "")
}

function originFailKey(origin: string): string {
  if (/^https?:\/\//i.test(origin || "")) return canonicalizeSiteOrigin(originKeyFromUrl(origin))
  return canonicalizeSiteOrigin(origin || "")
}

export function shouldPersistSiteOpExperience(existingContents: string[], content: string): boolean {
  if (!content || existingContents.includes(content)) return false
  const n = existingContents.filter((c) => c.startsWith("DO NOT retry")).length
  return n < SITE_OP_EXPERIENCE_MAX
}

export type SiteOpBan =
  | { banned: false }
  | {
      banned: true
      error_code: "SITE_OP_BANNED" | "TAB_ATTACH_FROZEN" | "SITE_OP_ESCALATE"
      locator: string
    }

export type OriginCdpFailState = { fails: number; lastCode: string }

type LocatorState = { fails: number; lastCode: string }

type ThreadMem = {
  locators: Record<string, LocatorState>
  frozenTabs: Set<number>
  /** #357 origin streak; #358 may persist via snapshot/hydrate. */
  originFails: Record<string, OriginCdpFailState>
}

const mem = new Map<string, ThreadMem>()

export function resetSiteOpMemoryForTests(): void {
  mem.clear()
}

function stateFor(threadId: string): ThreadMem {
  let s = mem.get(threadId)
  if (!s) {
    s = { locators: {}, frozenTabs: new Set(), originFails: {} }
    mem.set(threadId, s)
  } else if (!s.originFails) {
    s.originFails = {}
  }
  return s
}

/** Shared read face for #358 rebase — same key as record/peek (originForSiteOp / http(s) host). */
export function getOriginFailCount(threadId: string, origin: string): number {
  const key = originFailKey(origin)
  if (!isAggregatableSiteOrigin(key)) return 0
  return stateFor(threadId).originFails[key]?.fails ?? 0
}

/** #358 read seam: dump per-origin CDP fail counters (http(s) only; no locators / frozen tabs). */
export function snapshotOriginCdpFails(threadId: string): Record<string, OriginCdpFailState> {
  const s = mem.get(threadId)
  if (!s?.originFails) return {}
  const out: Record<string, OriginCdpFailState> = {}
  for (const [k, v] of Object.entries(s.originFails)) {
    if (!isAggregatableSiteOrigin(k)) continue
    out[k] = { fails: v.fails, lastCode: v.lastCode }
  }
  return out
}

/** #358 restore seam. Skips non-http(s) keys. Does not clear locators or frozen tabs. */
export function hydrateOriginCdpFails(
  threadId: string,
  snapshot: Record<string, OriginCdpFailState>,
): void {
  const s = stateFor(threadId)
  for (const [k, v] of Object.entries(snapshot || {})) {
    if (!k || !v || typeof v.fails !== "number" || v.fails < 0) continue
    const key = originFailKey(k)
    if (!isAggregatableSiteOrigin(key)) continue
    s.originFails[key] = { fails: v.fails, lastCode: String(v.lastCode || "UNKNOWN") }
  }
}

/**
 * evaluate success:true with result null/undefined is not a live completion
 * (X CSP empty_completion / #357). Click and real 0/false/"" stay success.
 */
export function coerceEvaluateNullResult(
  toolName: string,
  toolResult: { success: boolean; data?: any; error?: string },
): { success: boolean; data?: any; error?: string } {
  if (toolName !== "evaluate" || !toolResult.success) return toolResult
  const data = toolResult.data
  const result = data == null ? undefined : data.result
  if (result !== null && result !== undefined) return toolResult
  return {
    success: false,
    error:
      "EVALUATE_NULL_RESULT: evaluate returned result:null — script evaluation failed " +
      "(empty_completion / CSP); do not treat as success",
    data: {
      error_code: EVALUATE_NULL_RESULT,
      evaluate_kind: data?.evaluate_kind,
    },
  }
}

function locatorMapKey(origin: string, tool: string, locator: string): string {
  return `${origin}|${tool}|${locator}`
}

export function peekSiteOpBan(
  threadId: string,
  toolName: string,
  params: Record<string, unknown>,
  tabUrl?: string | null,
): SiteOpBan {
  if (!isCdpInteractiveTool(toolName)) return { banned: false }
  const s = stateFor(threadId)
  const tabId = typeof params.tabId === "number" ? params.tabId : undefined
  if (tabId != null && s.frozenTabs.has(tabId)) {
    return { banned: true, error_code: "TAB_ATTACH_FROZEN", locator: "attach" }
  }
  const origin = originForSiteOp(params, tabUrl)
  if (isAggregatableSiteOrigin(origin)) {
    const originSt = s.originFails[origin]
    if (originSt && originSt.fails >= SITE_ORIGIN_FAIL_ESCALATE) {
      return { banned: true, error_code: "SITE_OP_ESCALATE", locator: "origin" }
    }
  }
  const locator = locatorKeyForTool(toolName, params)
  const st = s.locators[locatorMapKey(origin, toolName, locator)]
  if (st && st.fails >= SITE_LOCATOR_FAIL_BAN) {
    return { banned: true, error_code: "SITE_OP_BANNED", locator }
  }
  // Tool-hop of the same locator (click → get_element_info) still banned.
  if (locator !== "none" && locator !== "attach") {
    const any = s.locators[locatorMapKey(origin, "*", locator)]
    if (any && any.fails >= SITE_LOCATOR_FAIL_BAN) {
      return { banned: true, error_code: "SITE_OP_BANNED", locator }
    }
  }
  return { banned: false }
}

export function recordSiteOpFailure(
  threadId: string,
  toolName: string,
  params: Record<string, unknown>,
  errorCode: string | undefined,
  tabUrl?: string | null,
): {
  justBanned: boolean
  origin: string
  locator: string
  fails: number
  originFails: number
  /** True when this http(s) origin just reached / is at the escalate threshold. Not justBanned. */
  originEscalateDue: boolean
} {
  const origin = originForSiteOp(params, tabUrl)
  const locator = locatorKeyForTool(toolName, params)
  const empty = { justBanned: false, origin, locator, fails: 0, originFails: 0, originEscalateDue: false }
  if (!isCdpInteractiveTool(toolName)) return empty
  const s = stateFor(threadId)
  const tabId = typeof params.tabId === "number" ? params.tabId : undefined
  const code = errorCode || "UNKNOWN"
  if (ATTACH_CODES.has(code) && tabId != null) {
    const was = s.frozenTabs.has(tabId)
    s.frozenTabs.add(tabId)
    return {
      justBanned: !was,
      origin,
      locator: "attach",
      fails: SITE_ATTACH_FAIL_BAN,
      originFails: isAggregatableSiteOrigin(origin) ? (s.originFails[origin]?.fails || 0) : 0,
      originEscalateDue: false,
    }
  }
  const k = locatorMapKey(origin, toolName, locator)
  const prev = s.locators[k] || { fails: 0, lastCode: code }
  prev.fails += 1
  prev.lastCode = code
  s.locators[k] = prev
  if (locator !== "none" && locator !== "attach") {
    const anyK = locatorMapKey(origin, "*", locator)
    const any = s.locators[anyK] || { fails: 0, lastCode: code }
    any.fails += 1
    any.lastCode = code
    s.locators[anyK] = any
  }
  let originFails = 0
  let originEscalateDue = false
  if (isAggregatableSiteOrigin(origin)) {
    const ost = s.originFails[origin] || { fails: 0, lastCode: code }
    ost.fails += 1
    ost.lastCode = code
    s.originFails[origin] = ost
    originFails = ost.fails
    originEscalateDue = ost.fails >= SITE_ORIGIN_FAIL_ESCALATE
  }
  return {
    justBanned: prev.fails === SITE_LOCATOR_FAIL_BAN,
    origin,
    locator,
    fails: prev.fails,
    originFails,
    originEscalateDue,
  }
}

/** Only navigate/set_tab_url on this tabId may thaw (debugger might work again). list_tabs/create_tab must not. */
export function thawTabIfPresent(threadId: string, tabId: number | undefined): void {
  if (typeof tabId !== "number") return
  stateFor(threadId).frozenTabs.delete(tabId)
}

function originEscalateError(): string {
  const plat = platform()
  const n = SITE_ORIGIN_FAIL_ESCALATE
  const confirm =
    "That ALWAYS pops a confirm (无人值守/三旗 will NOT skip it). NEVER treat this as auto-approved CU."
  const listTabsHint = " Run list_tabs to refresh tab origins."
  if (plat === "linux") {
    return (
      `SITE_OP_BANNED: CDP interactive tools already failed ${n}+ times on this origin ` +
      "(across locators/tools) — do not retry click/type/evaluate here. " +
      "host_computer is NOT available on this platform (Linux). list_tabs or stop; there is no third JS injection path."
    )
  }
  const cu =
    "After this origin fail streak / CDP attach freeze / DOM-script cap, you MAY call host_computer on the Chrome app token. " +
    confirm
  const osa =
    plat === "darwin"
      ? " osascript_eval is a last-resort macOS JS path after CDP+scripting both fail."
      : ""
  return (
    `SITE_OP_BANNED: CDP interactive tools already failed ${n}+ times on this origin ` +
    `(across locators/tools) — do not retry click/type/evaluate here. ${cu}${osa}${listTabsHint}`
  )
}

export function bannedSiteOpResult(ban: Extract<SiteOpBan, { banned: true }>): {
  success: false
  error: string
  data: {
    error_code: string
    suggested_action: "stop_or_change_task" | "list_tabs" | "escalate_to_host_computer"
    locator: string
  }
} {
  if (ban.error_code === "TAB_ATTACH_FROZEN") {
    return {
      success: false,
      error: "TAB_ATTACH_FROZEN: CDP attach already failed on this tab; list_tabs or stop — do not hop click/type/evaluate",
      data: {
        error_code: "TAB_ATTACH_FROZEN",
        suggested_action: "list_tabs",
        locator: "attach",
      },
    }
  }
  if (ban.error_code === "SITE_OP_ESCALATE") {
    return {
      success: false,
      error: originEscalateError(),
      data: {
        error_code: "SITE_OP_ESCALATE",
        suggested_action: "escalate_to_host_computer",
        locator: "origin",
      },
    }
  }
  return {
    success: false,
    error: `SITE_OP_BANNED: already failed ${ban.locator} — do not retry the same locator/tool on this origin`,
    data: {
      error_code: "SITE_OP_BANNED",
      suggested_action: "stop_or_change_task",
      locator: ban.locator,
    },
  }
}

export function formatSiteOpMemoryPrompt(threadId: string, hostname?: string): string {
  const s = mem.get(threadId)
  if (!s) return ""
  const lines: string[] = []
  if (s.frozenTabs.size > 0) {
    lines.push(
      `Frozen tabs (CDP attach failed): ${[...s.frozenTabs].join(", ")}. ` +
        `Do NOT call click/type/evaluate/get_element_info/press_key on them. list_tabs first.`,
    )
  }
  const hostHint = hostname ? hostname.replace(/^www\./, "") : ""
  const banned: string[] = []
  for (const [k, st] of Object.entries(s.locators)) {
    if (st.fails < SITE_LOCATOR_FAIL_BAN) continue
    const [origin, tool, locator] = k.split("|")
    if (hostHint && origin && !origin.includes(hostHint) && !hostHint.includes(origin.replace(/^https?:\/\//, ""))) {
      continue
    }
    banned.push(`- ${tool} ${locator} on ${origin} (${st.lastCode}, ${st.fails}×)`)
  }
  if (banned.length) {
    lines.push("Do NOT retry these locators (site op-memory):\n" + banned.slice(0, 24).join("\n"))
  }
  const originEsc: string[] = []
  for (const [origin, st] of Object.entries(s.originFails || {})) {
    if (st.fails < SITE_ORIGIN_FAIL_ESCALATE) continue
    if (!isAggregatableSiteOrigin(origin)) continue
    if (hostHint && origin && !origin.includes(hostHint) && !hostHint.includes(origin.replace(/^https?:\/\//, ""))) {
      continue
    }
    originEsc.push(
      `- origin ${origin} CDP fail streak ${st.fails}× (last ${st.lastCode}) — do not retry CDP; escalate to host_computer (Chrome token, ALWAYS confirms) or osascript_eval`,
    )
  }
  if (originEsc.length) {
    lines.push("Origin CDP escalate (#357):\n" + originEsc.slice(0, 8).join("\n"))
  }
  if (!lines.length) return ""
  return `## Site op-memory (machine)\n${lines.join("\n")}`
}

export function siteOpExperienceLine(origin: string, tool: string, locator: string, code: string): string {
  return `DO NOT retry ${tool} ${locator} on ${origin}: last ${code}`
}
