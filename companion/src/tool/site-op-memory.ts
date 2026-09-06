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

/**
 * #357/#358 shared primitive: per (thread, origin) aggregated CDP-interactive
 * failure counter (`originFails`, threshold SITE_ORIGIN_FAIL_ESCALATE).
 * Cross-tool, cross-locator — the hgrsix blind spot where every failure had a
 * fresh locator so per-locator bans never fired. #357 escalates the peek on it;
 * #358 auto-persists site experience off the same counter.
 */
/** Max persisted entries rehydrated into a fresh thread per origin. */
export const SITE_ORIGIN_HYDRATE_MAX = 8

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
  const n = existingContents.filter(
    (c) => c.startsWith("DO NOT retry") || c.startsWith("[auto] DO NOT retry"),
  ).length
  return n < SITE_OP_EXPERIENCE_MAX
}

/**
 * #358: the only free dimension of a persisted auto-experience line is the
 * locator fragment (LLM-controlled tool params). Refuse injection-style text so
 * a poisoned locator cannot become a stored "experience" that later re-enters
 * prompts via hydration. This is the structured-validation gate — the LLM's own
 * prose never reaches the persist path at all (content is machine-assembled).
 */
const SITE_OP_LOCATOR_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)/i,
  /(system|developer)\s+(prompt|message|instruction)/i,
  /\bpretend\b.{0,24}\b(you\s+are|as\s+if)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\b(exfiltrat|steal|leak|send|upload)\b[^.]{0,40}\b(cookie|token|password|secret|credential|api[_-]?key)/i,
  /\b(call|invoke|run|execute)\b\s+(shell_exec|osascript|host_computer|host_write|netsec)/i,
]

export function isSafeSiteOpLocatorText(text: string): boolean {
  const t = String(text || "")
  return !SITE_OP_LOCATOR_INJECTION_PATTERNS.some((re) => re.test(t))
}

/** #358: machine-assembled, [auto]-marked experience line (never LLM prose). */
export function autoSiteOpExperienceLine(origin: string, tool: string, locator: string, code: string): string {
  return `[auto] DO NOT retry ${tool} ${locator} on ${origin}: last ${code}`
}

const PERSISTED_LINE_RE =
  /^\[auto\] DO NOT retry ([a-z_]+) (.+?) on (https?:\/\/[^\s]+): last ([A-Z0-9_]+)$/

/**
 * Strict inverse of autoSiteOpExperienceLine. Only exact-template [auto] lines
 * parse — free-form text, manual experience lines, or anything a user/hand-edit
 * mangled returns null and can never hydrate into a machine ban or a prompt.
 */
export function parsePersistedSiteOpLine(content: string): {
  origin: string
  tool: string
  locator: string
  code: string
} | null {
  const m = PERSISTED_LINE_RE.exec(String(content || "").trim())
  if (!m) return null
  return { tool: m[1], locator: m[2], origin: m[3], code: m[4] }
}

export type SiteOpBan =
  | { banned: false }
  | {
      banned: true
      error_code: "SITE_OP_BANNED" | "TAB_ATTACH_FROZEN" | "SITE_OP_ESCALATE"
      locator: string
    }

export type OriginCdpFailState = { fails: number; lastCode: string }

type LocatorState = { fails: number; lastCode: string; persisted?: boolean }

type ThreadMem = {
  locators: Record<string, LocatorState>
  frozenTabs: Set<number>
  /** #357 origin streak — the single shared counter (#358 persist keys off it too). */
  originFails: Record<string, OriginCdpFailState>
  /** #358: origins already auto-persisted this process (once per thread+origin). */
  persistedOrigins: Set<string>
  hydratedOrigins: Set<string>
}

const mem = new Map<string, ThreadMem>()

export function resetSiteOpMemoryForTests(): void {
  mem.clear()
}

function stateFor(threadId: string): ThreadMem {
  let s = mem.get(threadId)
  if (!s) {
    s = {
      locators: {},
      frozenTabs: new Set(),
      originFails: {},
      persistedOrigins: new Set(),
      hydratedOrigins: new Set(),
    }
    mem.set(threadId, s)
  } else {
    if (!s.originFails) s.originFails = {}
    if (!s.persistedOrigins) s.persistedOrigins = new Set()
    if (!s.hydratedOrigins) s.hydratedOrigins = new Set()
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
  /** #358: threshold met on the shared counter and nothing persisted for this origin this process. */
  originPersistDue: boolean
} {
  const origin = originForSiteOp(params, tabUrl)
  const locator = locatorKeyForTool(toolName, params)
  const empty = {
    justBanned: false,
    origin,
    locator,
    fails: 0,
    originFails: 0,
    originEscalateDue: false,
    originPersistDue: false,
  }
  if (!isCdpInteractiveTool(toolName)) return empty
  const s = stateFor(threadId)
  const tabId = typeof params.tabId === "number" ? params.tabId : undefined
  const code = errorCode || "UNKNOWN"
  if (ATTACH_CODES.has(code) && tabId != null) {
    const was = s.frozenTabs.has(tabId)
    s.frozenTabs.add(tabId)
    // Attach failure is transport, not an interaction-path failure — it never
    // aggregates toward the origin counter (#357 peek / #358 persist inherit).
    return {
      justBanned: !was,
      origin,
      locator: "attach",
      fails: SITE_ATTACH_FAIL_BAN,
      originFails: isAggregatableSiteOrigin(origin) ? (s.originFails[origin]?.fails || 0) : 0,
      originEscalateDue: false,
      originPersistDue: false,
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
  let originPersistDue = false
  if (isAggregatableSiteOrigin(origin)) {
    const ost = s.originFails[origin] || { fails: 0, lastCode: code }
    ost.fails += 1
    ost.lastCode = code
    s.originFails[origin] = ost
    originFails = ost.fails
    originEscalateDue = ost.fails >= SITE_ORIGIN_FAIL_ESCALATE
    originPersistDue = originEscalateDue && !s.persistedOrigins.has(origin)
  }
  return {
    justBanned: prev.fails === SITE_LOCATOR_FAIL_BAN,
    origin,
    locator,
    fails: prev.fails,
    originFails,
    originEscalateDue,
    originPersistDue,
  }
}

/** #358: call after a persist attempt (even if every line dedup-skipped) — once per thread+origin per process. */
export function markOriginExperiencePersisted(threadId: string, origin: string): void {
  const key = originFailKey(origin)
  if (!isAggregatableSiteOrigin(key)) return
  stateFor(threadId).persistedOrigins.add(key)
}

/**
 * #358 (round-2 MAJOR-3): every distinct failed (tool, locator) path recorded for
 * this origin, in failure order, per-line injection-gated — so the hgrsix form
 * (fresh locator each round) persists ALL dead paths, not just the crossing one.
 */
export function collectOriginFailedLocators(
  threadId: string,
  origin: string,
  cap = SITE_ORIGIN_HYDRATE_MAX,
): Array<{ tool: string; locator: string; code: string; fails: number }> {
  const key = originFailKey(origin)
  if (!isAggregatableSiteOrigin(key)) return []
  const s = stateFor(threadId)
  const prefix = `${key}|`
  const out: Array<{ tool: string; locator: string; code: string; fails: number }> = []
  for (const [k, st] of Object.entries(s.locators)) {
    if (!k.startsWith(prefix)) continue
    const [o, tool, locator] = k.split("|")
    if (o !== key || tool === "*" || !locator || locator === "none" || locator === "attach") continue
    if (st.fails < 1) continue
    if (!isSafeSiteOpLocatorText(locator)) continue
    out.push({ tool, locator, code: st.lastCode, fails: st.fails })
    if (out.length >= cap) break
  }
  return out
}

/**
 * #358 cross-thread hydration: restore persisted [auto] experience entries into
 * a fresh thread's in-memory locator bans. Only exact-template [auto] lines
 * parse; stale (user-refuted) and off-host entries are skipped. Restored bans
 * are per-locator (`*` tool-hop key) — never a whole-origin ban.
 * Returns the number of restored entries (for tests/telemetry).
 */
export function hydratePersistedSiteOpExperience(
  threadId: string,
  hostname: string,
  entries: ReadonlyArray<{ content: string; stale?: boolean }>,
): number {
  const host = String(hostname || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase()
  if (!host) return 0
  const originHint = host
  const s = stateFor(threadId)
  if (s.hydratedOrigins.has(originHint)) return 0
  s.hydratedOrigins.add(originHint)
  let restored = 0
  for (const e of entries) {
    if (e.stale) continue
    const parsed = parsePersistedSiteOpLine(e.content)
    if (!parsed) continue
    // Round-2 MAJOR-2: disk entries are user-editable — re-run the injection gate
    // here so a template-conformant [auto] line with a poisoned locator cannot
    // ride past the persist-side check into a machine ban / prompt.
    if (!isSafeSiteOpLocatorText(parsed.locator)) continue
    const entryHost = parsed.origin
      .replace(/^https?:\/\//, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase()
    if (entryHost !== originHint) continue
    const k = locatorMapKey(parsed.origin, "*", parsed.locator)
    const prev = s.locators[k]
    if (!prev) {
      s.locators[k] = {
        fails: SITE_LOCATOR_FAIL_BAN,
        lastCode: parsed.code,
        persisted: true,
      }
      restored += 1
      if (restored >= SITE_ORIGIN_HYDRATE_MAX) break
    }
  }
  return restored
}

/** Only navigate/set_tab_url on this tabId may thaw (debugger might work again). list_tabs/create_tab must not. */
export function thawTabIfPresent(threadId: string, tabId: number | undefined): void {
  if (typeof tabId !== "number") return
  stateFor(threadId).frozenTabs.delete(tabId)
}

function originEscalateError(cuArmed: boolean): string {
  const plat = platform()
  const n = SITE_ORIGIN_FAIL_ESCALATE
  const confirm =
    "That ALWAYS pops a confirm (无人值守/三旗 will NOT skip it). NEVER treat this as auto-approved CU."
  const listTabsHint = " Run list_tabs to refresh tab origins."
  if (plat === "linux") {
    // #409 CI-fix: CU never exists on Linux — arming changes nothing. The
    // honest guidance is declare_blocked, same as the unarmed branch.
    return (
      `SITE_OP_BANNED: CDP interactive tools already failed ${n}+ times on this origin ` +
      "(across locators/tools) — do not retry click/type/evaluate here. " +
      "host_computer is NOT available on this platform (Linux); arming CU changes nothing. " +
      "Call loop_declare_blocked, or stop/change the task; there is no third JS injection path." +
      listTabsHint
    )
  }
  // #409-A: unarmed CU must not be advertised as a MAY-call escalation — the
  // call would die COMPUTER_DISABLED. Same caliber as buildSteerText unarmed
  // branch: declare blocked, wait for the user to arm, loop never flips the flag.
  if (!cuArmed) {
    return (
      `SITE_OP_BANNED: CDP interactive tools already failed ${n}+ times on this origin ` +
      "(across locators/tools) — do not retry click/type/evaluate here. " +
      "Coordinate CU is NOT armed (computer.coordinateEnabled=false): do NOT call host_computer either — it would fail COMPUTER_DISABLED. " +
      "Call loop_declare_blocked, or wait for the user to arm 坐标计算机使用 in Settings and restore from checkpoint. " +
      "The loop will never flip this flag itself." +
      listTabsHint
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

export function bannedSiteOpResult(
  ban: Extract<SiteOpBan, { banned: true }>,
  opts?: { cuArmed?: boolean },
): {
  success: false
  error: string
  data: {
    error_code: string
    suggested_action: "stop_or_change_task" | "list_tabs" | "escalate_to_host_computer" | "declare_blocked"
    locator: string
  }
} {
  // #409-A: default unarmed (fail-closed) — an absent caller must never get
  // host_computer advertising when CU is actually disabled.
  const cuArmed = opts?.cuArmed === true
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
    // Linux has no host surface at all — never suggest escalating to a tool
    // that cannot exist there, even when the config flag says armed.
    const escalatePossible = cuArmed && platform() !== "linux"
    return {
      success: false,
      error: originEscalateError(cuArmed),
      data: {
        error_code: "SITE_OP_ESCALATE",
        suggested_action: escalatePossible ? "escalate_to_host_computer" : "declare_blocked",
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

function resolveFormatCuArmed(opts?: { cuArmed?: boolean }): boolean {
  // Explicit opts (tests) win. Adapter calls without opts → live loopRouteCaps
  // (same lazy-require as #414 adapter.ts bannedSiteOpResult). Fail-closed.
  if (opts && Object.prototype.hasOwnProperty.call(opts, "cuArmed")) {
    return opts.cuArmed === true
  }
  try {
    const { loopRouteCaps } = require("../loop/tier-bind") as typeof import("../loop/tier-bind")
    return loopRouteCaps().cuArmed === true
  } catch {
    return false
  }
}

export function formatSiteOpMemoryPrompt(
  threadId: string,
  hostname?: string,
  opts?: { cuArmed?: boolean },
): string {
  const s = mem.get(threadId)
  if (!s) return ""
  const cuArmed = resolveFormatCuArmed(opts)
  const escalatePossible = cuArmed && platform() !== "linux"
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
    banned.push(
      `- ${tool} ${locator} on ${origin} (${st.lastCode}${st.persisted ? ", persisted" : ""}, ${st.fails}×)`,
    )
  }
  if (banned.length) {
    const alt = escalatePossible
      ? "Prefer an alternative path " +
        "(different locator, navigate to reset, host_computer under Rule 12 confirm, or osascript_eval) " +
        "instead of re-probing the same locator."
      : platform() === "linux"
        ? "Call loop_declare_blocked (host_computer is NOT available on Linux; arming CU changes nothing) " +
          "instead of re-probing the same locator."
        : "Call loop_declare_blocked; do not call host_computer (CU unarmed / COMPUTER_DISABLED). " +
          "The loop will never flip coordinateEnabled. Prefer a different locator or navigate instead of re-probing."
    lines.push(
      "Do NOT retry these locators (site op-memory):\n" +
        banned.slice(0, 24).join("\n") +
        "\nPersisted failures carry over from earlier sessions. " +
        alt,
    )
  }
  const originEsc: string[] = []
  for (const [origin, st] of Object.entries(s.originFails || {})) {
    if (st.fails < SITE_ORIGIN_FAIL_ESCALATE) continue
    if (!isAggregatableSiteOrigin(origin)) continue
    if (hostHint && origin && !origin.includes(hostHint) && !hostHint.includes(origin.replace(/^https?:\/\//, ""))) {
      continue
    }
    const esc = escalatePossible
      ? `do not retry CDP; escalate to host_computer (Chrome token, ALWAYS confirms) or osascript_eval`
      : platform() === "linux"
        ? `do not retry CDP; call loop_declare_blocked (host_computer is NOT available on Linux; arming CU changes nothing)`
        : `do not retry CDP; call loop_declare_blocked (do NOT call host_computer — COMPUTER_DISABLED). Loop never flips coordinateEnabled`
    originEsc.push(
      `- origin ${origin} CDP fail streak ${st.fails}× (last ${st.lastCode}) — ${esc}`,
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
