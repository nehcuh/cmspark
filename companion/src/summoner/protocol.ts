/**
 * Summoner overlay stdin codecs (window / hotkey / hydrate only).
 *
 * Line-delimited JSON on the existing tray pipe (same channel as HUD).
 * Companion → Swift uses `cmd`; Swift → Companion uses `type`.
 *
 * UI lock: two-phase capture (plaintext hydrate + composer). Overlay never
 * renders Allow/Deny — there is no `summoner.confirm.*` dialect. Chat tokens
 * travel this pipe; `chat.create` itself stays on the summoner WS.
 *
 * Plan: docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md Task 7
 *
 * GitHub: #324 — optional hydrate.cruise_label is display-only. This file's
 * confirm-dialect lock (`isSummonerConfirmDialect`) is unchanged.
 */

import { sanitizeOverlayCruiseLabel } from "../security/autopilot-tier"

/** Title-search capability copy. Overlay never searches message body. */
export const SUMMONER_SEARCH_HINT = "只搜标题，不搜正文" as const
export type SummonerSearchHint = typeof SUMMONER_SEARCH_HINT

/** Overlay workbench list cap (threads / packs / MCP / skills / knowledge). */
export const SUMMONER_RAIL_LIST_CAP = 64

export type SummonerBrowser = "attached" | "detached"

// ── Companion → Swift payloads ──────────────────────────────────────────────

export type SummonerOpenPayload = {
  thread_id: string
}

export type SummonerHydratePayload = {
  thread_id: string
  lines: string[]
  browser: SummonerBrowser
  search_hint: SummonerSearchHint
  /** #324 derived cruise chip copy. Optional for backward compat. Swift must display as-is. */
  cruise_label?: string
}

export type SummonerTokenPayload = {
  text: string
}

export type SummonerErrorPayload = {
  message: string
  error_code?: string
}

// ── Companion → Swift command objects ───────────────────────────────────────

export type SummonerOpenCmd = { cmd: "summoner.open" } & SummonerOpenPayload
export type SummonerCloseCmd = { cmd: "summoner.close" }
export type SummonerHydrateCmd = { cmd: "summoner.hydrate" } & SummonerHydratePayload
export type SummonerTokenCmd = { cmd: "summoner.token" } & SummonerTokenPayload
export type SummonerDoneCmd = { cmd: "summoner.done" }
export type SummonerErrorCmd = { cmd: "summoner.error" } & SummonerErrorPayload
export type SummonerHotkeyPromptCmd = { cmd: "summoner.hotkey.prompt" }
export type SummonerHotkeySetCmd = { cmd: "summoner.hotkey.set"; combo: string }
export type SummonerDictateCmd = { cmd: "summoner.dictate"; text: string }
export type SummonerSettingsPayload = {
  resume_idle_minutes: number
  chrome_foreground: boolean
}
export type SummonerSettingsCmd = { cmd: "summoner.settings" } & SummonerSettingsPayload
export type SummonerToolCmd = { cmd: "summoner.tool"; name: string }
export type SummonerMcpCmd = { cmd: "summoner.mcp"; names: string[] }
export type SummonerHit = { id: string; title: string; when: string }
export type SummonerHitsPayload = { hits: SummonerHit[] }
export type SummonerHitsCmd = { cmd: "summoner.hits" } & SummonerHitsPayload
export type SummonerThreadsCmd = { cmd: "summoner.threads"; threads: SummonerHit[] }

// ── #433 P1 search wire (spec §3a) ───────────────────────────────────────────

export type SummonerThreadSearchHit = {
  id: string
  title: string
  alias?: string
  when: string
  snippet: string
  score: number
}
export type SummonerThreadSearchResultsCmd = {
  cmd: "summoner.thread.search.results"
  hits: SummonerThreadSearchHit[]
}

export type SummonerKnowledgeSearchHit = {
  id: string
  title: string
  folder?: string
  snippet: string
  score: number
}
export type SummonerKnowledgeSearchResultsCmd = {
  cmd: "summoner.knowledge.search.results"
  hits: SummonerKnowledgeSearchHit[]
}

export type SummonerPeekResultPayload = {
  thread_id: string
  title: string
  markdown: string
  truncated: boolean
  redacted_hits: number
}
export type SummonerPeekResultCmd = {
  cmd: "summoner.peek.result"
} & SummonerPeekResultPayload
export type SummonerPackRow = { id: string; name: string; overlay_eligible: boolean }
export type SummonerPacksCmd = { cmd: "summoner.packs"; packs: SummonerPackRow[] }
export type SummonerMcpServerRow = { name: string; enabled: boolean; transport: string }
export type SummonerMcpServersCmd = { cmd: "summoner.mcp.servers"; servers: SummonerMcpServerRow[] }
export type SummonerSkillRow = { name: string; title: string; on: boolean }
export type SummonerSkillsCmd = { cmd: "summoner.skills"; skills: SummonerSkillRow[] }
export type SummonerKnowledgeRow = { id: string; title: string; attached: boolean }
export type SummonerKnowledgeCmd = { cmd: "summoner.knowledge"; docs: SummonerKnowledgeRow[] }

export type SummonerOutboundCmd =
  | SummonerOpenCmd
  | SummonerCloseCmd
  | SummonerHydrateCmd
  | SummonerTokenCmd
  | SummonerDoneCmd
  | SummonerErrorCmd
  | SummonerHotkeyPromptCmd
  | SummonerHotkeySetCmd
  | SummonerDictateCmd
  | SummonerSettingsCmd
  | SummonerToolCmd
  | SummonerMcpCmd
  | SummonerHitsCmd
  | SummonerThreadsCmd
  | SummonerPacksCmd
  | SummonerMcpServersCmd
  | SummonerSkillsCmd
  | SummonerKnowledgeCmd
  | SummonerThreadSearchResultsCmd
  | SummonerKnowledgeSearchResultsCmd
  | SummonerPeekResultCmd

// ── Swift → Companion events ────────────────────────────────────────────────

export type SummonerReadyEvt = { type: "summoner.ready" }
export type SummonerClosedEvt = { type: "summoner.closed" }
export type SummonerSubmitEvt = {
  type: "summoner.submit"
  thread_id: string
  text: string
  enqueue?: boolean
}
export type SummonerSearchEvt = { type: "summoner.search"; query: string }
export type SummonerSelectEvt = { type: "summoner.select"; thread_id: string }
export type SummonerAttachChromeEvt = { type: "summoner.attach_chrome"; foreground?: boolean }
export type SummonerContinueEvt = { type: "summoner.continue" }
export type SummonerHotkeyChosenEvt = { type: "summoner.hotkey.chosen"; combo: string }
export type SummonerComposingEvt = { type: "summoner.composing"; on: boolean }
export type SummonerMicStartEvt = { type: "summoner.mic.start" }
export type SummonerMicChunkEvt = { type: "summoner.mic.chunk"; seq: number; data: string }
export type SummonerMicEndEvt = { type: "summoner.mic.end" }
export type SummonerMicWavEvt = { type: "summoner.mic.wav"; data: string }
export type SummonerNewThreadEvt = { type: "summoner.new_thread" }
export type SummonerThreadRenameEvt = { type: "summoner.thread.rename"; thread_id: string; alias: string }
export type SummonerThreadTrashEvt = { type: "summoner.thread.trash"; thread_id: string }
export type SummonerFilesEvt = {
  type: "summoner.files"
  thread_id: string
  files: Array<{ name: string; type: string; content: string }>
}
export type SummonerPackApplyEvt = { type: "summoner.pack.apply"; pack_id: string }
export type SummonerMcpToggleEvt = { type: "summoner.mcp.toggle"; name: string; enabled: boolean }
export type SummonerMcpAddEvt = { type: "summoner.mcp.add"; name: string; command: string }
export type SummonerSkillToggleEvt = { type: "summoner.skill.toggle"; name: string; on: boolean }
export type SummonerKnowledgeAttachEvt = { type: "summoner.knowledge.attach"; id: string }
export type SummonerKnowledgeImportEvt = {
  type: "summoner.knowledge.import"
  name: string
  mime: string
  content: string
}
export type SummonerSettingsSetEvt = { type: "summoner.settings.set" } & SummonerSettingsPayload

// #433 P1 search events (Swift → Companion)
export type SummonerThreadSearchEvt = { type: "summoner.thread.search"; query: string }
export type SummonerKnowledgeSearchEvt = { type: "summoner.knowledge.search"; query: string }
export type SummonerPeekEvt = { type: "summoner.peek"; thread_id: string }
export type SummonerCiteThreadEvt = { type: "summoner.cite_thread"; thread_id: string }

export type SummonerInboundEvt =
  | SummonerReadyEvt
  | SummonerClosedEvt
  | SummonerSubmitEvt
  | SummonerSearchEvt
  | SummonerSelectEvt
  | SummonerAttachChromeEvt
  | SummonerContinueEvt
  | SummonerHotkeyChosenEvt
  | SummonerComposingEvt
  | SummonerMicStartEvt
  | SummonerMicChunkEvt
  | SummonerMicEndEvt
  | SummonerMicWavEvt
  | SummonerNewThreadEvt
  | SummonerThreadRenameEvt
  | SummonerThreadTrashEvt
  | SummonerFilesEvt
  | SummonerPackApplyEvt
  | SummonerMcpToggleEvt
  | SummonerMcpAddEvt
  | SummonerSkillToggleEvt
  | SummonerKnowledgeAttachEvt
  | SummonerKnowledgeImportEvt
  | SummonerSettingsSetEvt
  | SummonerThreadSearchEvt
  | SummonerKnowledgeSearchEvt
  | SummonerPeekEvt
  | SummonerCiteThreadEvt

export type SummonerWireMessage = SummonerOutboundCmd | SummonerInboundEvt

// ── Encoders (typed objects; stringify with summonerLine) ───────────────────

export function encodeSummonerOpen(p: SummonerOpenPayload): SummonerOpenCmd {
  return { cmd: "summoner.open", thread_id: p.thread_id }
}

export function encodeSummonerClose(): SummonerCloseCmd {
  return { cmd: "summoner.close" }
}

export function encodeSummonerHydrate(p: SummonerHydratePayload): SummonerHydrateCmd {
  const cmd: SummonerHydrateCmd = {
    cmd: "summoner.hydrate",
    thread_id: p.thread_id,
    lines: p.lines,
    browser: p.browser,
    search_hint: p.search_hint,
  }
  if (p.cruise_label !== undefined) cmd.cruise_label = p.cruise_label
  return cmd
}

export function encodeSummonerToken(p: SummonerTokenPayload): SummonerTokenCmd {
  return { cmd: "summoner.token", text: p.text }
}

export function encodeSummonerDone(): SummonerDoneCmd {
  return { cmd: "summoner.done" }
}

export function encodeSummonerError(p: SummonerErrorPayload): SummonerErrorCmd {
  if (p.error_code !== undefined) {
    return { cmd: "summoner.error", message: p.message, error_code: p.error_code }
  }
  return { cmd: "summoner.error", message: p.message }
}

export function encodeSummonerHotkeyPrompt(): SummonerHotkeyPromptCmd {
  return { cmd: "summoner.hotkey.prompt" }
}

export function encodeSummonerHotkeySet(p: { combo: string }): SummonerHotkeySetCmd {
  return { cmd: "summoner.hotkey.set", combo: p.combo }
}

export function encodeSummonerReady(): SummonerReadyEvt {
  return { type: "summoner.ready" }
}

export function encodeSummonerClosed(): SummonerClosedEvt {
  return { type: "summoner.closed" }
}

export function encodeSummonerSubmit(p: {
  thread_id: string
  text: string
  enqueue?: boolean
}): SummonerSubmitEvt {
  return {
    type: "summoner.submit",
    thread_id: p.thread_id,
    text: p.text,
    ...(p.enqueue ? { enqueue: true } : {}),
  }
}

export function encodeSummonerSearch(p: { query: string }): SummonerSearchEvt {
  return { type: "summoner.search", query: p.query }
}

export function encodeSummonerHits(p: SummonerHitsPayload): SummonerHitsCmd {
  return { cmd: "summoner.hits", hits: p.hits }
}

export function encodeSummonerThreads(p: { threads: SummonerHit[] }): SummonerThreadsCmd {
  return { cmd: "summoner.threads", threads: p.threads }
}

export function encodeSummonerPacks(p: { packs: SummonerPackRow[] }): SummonerPacksCmd {
  return { cmd: "summoner.packs", packs: p.packs }
}

export function encodeSummonerPackApply(p: { pack_id: string }): SummonerPackApplyEvt {
  return { type: "summoner.pack.apply", pack_id: p.pack_id }
}

export function encodeSummonerMcpServers(p: { servers: SummonerMcpServerRow[] }): SummonerMcpServersCmd {
  return { cmd: "summoner.mcp.servers", servers: p.servers }
}

export function encodeSummonerSkills(p: { skills: SummonerSkillRow[] }): SummonerSkillsCmd {
  return { cmd: "summoner.skills", skills: p.skills }
}

export function encodeSummonerKnowledge(p: { docs: SummonerKnowledgeRow[] }): SummonerKnowledgeCmd {
  return { cmd: "summoner.knowledge", docs: p.docs }
}

export function encodeSummonerMcpToggle(p: { name: string; enabled: boolean }): SummonerMcpToggleEvt {
  return { type: "summoner.mcp.toggle", name: p.name, enabled: p.enabled }
}

export function encodeSummonerMcpAdd(p: { name: string; command: string }): SummonerMcpAddEvt {
  return { type: "summoner.mcp.add", name: p.name, command: p.command }
}

export function encodeSummonerSkillToggle(p: { name: string; on: boolean }): SummonerSkillToggleEvt {
  return { type: "summoner.skill.toggle", name: p.name, on: p.on }
}

export function encodeSummonerKnowledgeAttach(p: { id: string }): SummonerKnowledgeAttachEvt {
  return { type: "summoner.knowledge.attach", id: p.id }
}

export function encodeSummonerKnowledgeImport(p: {
  name: string
  mime: string
  content: string
}): SummonerKnowledgeImportEvt {
  return { type: "summoner.knowledge.import", name: p.name, mime: p.mime, content: p.content }
}

export function encodeSummonerSelect(p: { thread_id: string }): SummonerSelectEvt {
  return { type: "summoner.select", thread_id: p.thread_id }
}

export function encodeSummonerAttachChrome(p?: { foreground?: boolean }): SummonerAttachChromeEvt {
  if (p?.foreground === true) return { type: "summoner.attach_chrome", foreground: true }
  return { type: "summoner.attach_chrome" }
}

export function encodeSummonerContinue(): SummonerContinueEvt {
  return { type: "summoner.continue" }
}

export function encodeSummonerHotkeyChosen(p: { combo: string }): SummonerHotkeyChosenEvt {
  return { type: "summoner.hotkey.chosen", combo: p.combo }
}

export function encodeSummonerComposing(p: { on: boolean }): SummonerComposingEvt {
  return { type: "summoner.composing", on: p.on }
}

export function encodeSummonerDictate(p: { text: string }): SummonerDictateCmd {
  return { cmd: "summoner.dictate", text: p.text }
}

export function encodeSummonerMicStart(): SummonerMicStartEvt {
  return { type: "summoner.mic.start" }
}

export function encodeSummonerMicChunk(p: { seq: number; data: string }): SummonerMicChunkEvt {
  return { type: "summoner.mic.chunk", seq: p.seq, data: p.data }
}

export function encodeSummonerMicEnd(): SummonerMicEndEvt {
  return { type: "summoner.mic.end" }
}

export function encodeSummonerMicWav(p: { data: string }): SummonerMicWavEvt {
  return { type: "summoner.mic.wav", data: p.data }
}

export function encodeSummonerNewThread(): SummonerNewThreadEvt {
  return { type: "summoner.new_thread" }
}

export function encodeSummonerThreadRename(p: {
  thread_id: string
  alias: string
}): SummonerThreadRenameEvt {
  return { type: "summoner.thread.rename", thread_id: p.thread_id, alias: p.alias }
}

export function encodeSummonerThreadTrash(p: { thread_id: string }): SummonerThreadTrashEvt {
  return { type: "summoner.thread.trash", thread_id: p.thread_id }
}

export function encodeSummonerFiles(p: SummonerFilesEvt): SummonerFilesEvt {
  return { type: "summoner.files", thread_id: p.thread_id, files: p.files }
}

function isResumeIdleMinutes(n: unknown): n is number {
  return n === -1 || n === 0 || n === 5 || n === 10 || n === 30
}

export function encodeSummonerSettings(p: SummonerSettingsPayload): SummonerSettingsCmd {
  return {
    cmd: "summoner.settings",
    resume_idle_minutes: p.resume_idle_minutes,
    chrome_foreground: p.chrome_foreground,
  }
}

export function encodeSummonerSettingsSet(p: SummonerSettingsPayload): SummonerSettingsSetEvt {
  return {
    type: "summoner.settings.set",
    resume_idle_minutes: p.resume_idle_minutes,
    chrome_foreground: p.chrome_foreground,
  }
}

// #433 P1 search encoders

export function encodeSummonerThreadSearchResults(p: {
  hits: SummonerThreadSearchHit[]
}): SummonerThreadSearchResultsCmd {
  return { cmd: "summoner.thread.search.results", hits: p.hits }
}

export function encodeSummonerKnowledgeSearchResults(p: {
  hits: SummonerKnowledgeSearchHit[]
}): SummonerKnowledgeSearchResultsCmd {
  return { cmd: "summoner.knowledge.search.results", hits: p.hits }
}

export function encodeSummonerPeekResult(p: SummonerPeekResultPayload): SummonerPeekResultCmd {
  return {
    cmd: "summoner.peek.result",
    thread_id: p.thread_id,
    title: p.title,
    markdown: p.markdown,
    truncated: p.truncated,
    redacted_hits: p.redacted_hits,
  }
}

export function encodeSummonerThreadSearch(p: { query: string }): SummonerThreadSearchEvt {
  return { type: "summoner.thread.search", query: p.query }
}

export function encodeSummonerKnowledgeSearch(p: { query: string }): SummonerKnowledgeSearchEvt {
  return { type: "summoner.knowledge.search", query: p.query }
}

export function encodeSummonerPeek(p: { thread_id: string }): SummonerPeekEvt {
  return { type: "summoner.peek", thread_id: p.thread_id }
}

export function encodeSummonerCiteThread(p: { thread_id: string }): SummonerCiteThreadEvt {
  return { type: "summoner.cite_thread", thread_id: p.thread_id }
}

export function encodeSummonerTool(p: { name: string }): SummonerToolCmd {
  return { cmd: "summoner.tool", name: p.name }
}

export function encodeSummonerMcp(p: { names: string[] }): SummonerMcpCmd {
  return { cmd: "summoner.mcp", names: p.names }
}

/** One stdin/stdout JSON line (no trailing newline). */
export function summonerLine(msg: SummonerWireMessage): string {
  return JSON.stringify(msg)
}

// ── Parser ──────────────────────────────────────────────────────────────────

/** Parse one stdout/stdin line. Returns null on invalid JSON (never throws). */
export function parseSummonerLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return null
  }
}

/**
 * True iff the payload is a forbidden summoner confirm dialect
 * (`summoner.confirm.*`, including `{ cmd: "summoner.confirm.allow" }`).
 * HUD confirm traffic on the same pipe is a different surface and returns false.
 */
export function isSummonerConfirmDialect(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  const o = raw as Record<string, unknown>
  const key =
    typeof o.cmd === "string" ? o.cmd : typeof o.type === "string" ? o.type : ""
  return key.startsWith("summoner.confirm")
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const parsed = parseSummonerLine(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed as Record<string, unknown>
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>
  return null
}

function isString(v: unknown): v is string {
  return typeof v === "string"
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
}

function isSummonerHit(v: unknown): v is SummonerHit {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return isString(o.id) && isString(o.title) && isString(o.when)
}

function isSummonerHitArray(v: unknown): v is SummonerHit[] {
  return Array.isArray(v) && v.every(isSummonerHit)
}

function isSummonerPackArray(v: unknown): v is SummonerPackRow[] {
  return (
    Array.isArray(v) &&
    v.every((row) => {
      if (!row || typeof row !== "object") return false
      const o = row as Record<string, unknown>
      return isString(o.id) && isString(o.name) && typeof o.overlay_eligible === "boolean"
    })
  )
}

function isSummonerMcpServerArray(v: unknown): v is SummonerMcpServerRow[] {
  return (
    Array.isArray(v) &&
    v.every((row) => {
      if (!row || typeof row !== "object") return false
      const o = row as Record<string, unknown>
      return isString(o.name) && typeof o.enabled === "boolean" && isString(o.transport)
    })
  )
}

function isSummonerSkillArray(v: unknown): v is SummonerSkillRow[] {
  return (
    Array.isArray(v) &&
    v.every((row) => {
      if (!row || typeof row !== "object") return false
      const o = row as Record<string, unknown>
      return isString(o.name) && isString(o.title) && typeof o.on === "boolean"
    })
  )
}

function isSummonerKnowledgeArray(v: unknown): v is SummonerKnowledgeRow[] {
  return (
    Array.isArray(v) &&
    v.every((row) => {
      if (!row || typeof row !== "object") return false
      const o = row as Record<string, unknown>
      return isString(o.id) && isString(o.title) && typeof o.attached === "boolean"
    })
  )
}

function isBrowser(v: unknown): v is SummonerBrowser {
  return v === "attached" || v === "detached"
}

// #433 P1 validators

function isSummonerThreadSearchHit(v: unknown): v is SummonerThreadSearchHit {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    isString(o.id) &&
    isString(o.title) &&
    isString(o.when) &&
    isString(o.snippet) &&
    typeof o.score === "number" &&
    (o.alias === undefined || isString(o.alias))
  )
}

function isSummonerThreadSearchHitArray(v: unknown): v is SummonerThreadSearchHit[] {
  return Array.isArray(v) && v.every(isSummonerThreadSearchHit)
}

function isSummonerKnowledgeSearchHit(v: unknown): v is SummonerKnowledgeSearchHit {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    isString(o.id) &&
    isString(o.title) &&
    isString(o.snippet) &&
    typeof o.score === "number" &&
    (o.folder === undefined || isString(o.folder))
  )
}

function isSummonerKnowledgeSearchHitArray(v: unknown): v is SummonerKnowledgeSearchHit[] {
  return Array.isArray(v) && v.every(isSummonerKnowledgeSearchHit)
}

/**
 * Decode Companion → Swift (`cmd`). Null on invalid JSON, wrong shape,
 * HUD/tray traffic, or any `summoner.confirm.*` payload.
 */
export function decodeSummonerOutbound(raw: unknown): SummonerOutboundCmd | null {
  const o = asRecord(raw)
  if (!o) return null
  if (isSummonerConfirmDialect(o)) return null
  if (!isString(o.cmd)) return null

  switch (o.cmd) {
    case "summoner.open":
      if (!isString(o.thread_id)) return null
      return encodeSummonerOpen({ thread_id: o.thread_id })
    case "summoner.close":
      return encodeSummonerClose()
    case "summoner.hydrate":
      if (!isString(o.thread_id)) return null
      if (!isStringArray(o.lines)) return null
      if (!isBrowser(o.browser)) return null
      if (o.search_hint !== SUMMONER_SEARCH_HINT) return null
      {
        const cruise_label = sanitizeOverlayCruiseLabel(o.cruise_label)
        return encodeSummonerHydrate({
          thread_id: o.thread_id,
          lines: o.lines,
          browser: o.browser,
          search_hint: o.search_hint,
          ...(cruise_label !== undefined ? { cruise_label } : {}),
        })
      }
    case "summoner.token":
      if (!isString(o.text)) return null
      return encodeSummonerToken({ text: o.text })
    case "summoner.done":
      return encodeSummonerDone()
    case "summoner.error":
      if (!isString(o.message)) return null
      if (o.error_code !== undefined && !isString(o.error_code)) return null
      return encodeSummonerError(
        o.error_code !== undefined
          ? { message: o.message, error_code: o.error_code }
          : { message: o.message },
      )
    case "summoner.hotkey.prompt":
      return encodeSummonerHotkeyPrompt()
    case "summoner.hotkey.set":
      if (!isString(o.combo) || o.combo.length === 0) return null
      return encodeSummonerHotkeySet({ combo: o.combo })
    case "summoner.dictate":
      if (!isString(o.text)) return null
      return encodeSummonerDictate({ text: o.text })
    case "summoner.settings":
      if (!isResumeIdleMinutes(o.resume_idle_minutes)) return null
      if (typeof o.chrome_foreground !== "boolean") return null
      return encodeSummonerSettings({
        resume_idle_minutes: o.resume_idle_minutes,
        chrome_foreground: o.chrome_foreground,
      })
    case "summoner.tool":
      if (!isString(o.name) || !o.name) return null
      return encodeSummonerTool({ name: o.name })
    case "summoner.mcp":
      if (!isStringArray(o.names)) return null
      return encodeSummonerMcp({ names: o.names })
    case "summoner.hits":
      if (!isSummonerHitArray(o.hits)) return null
      return encodeSummonerHits({ hits: o.hits })
    case "summoner.threads":
      if (!isSummonerHitArray(o.threads)) return null
      return encodeSummonerThreads({ threads: o.threads })
    case "summoner.packs":
      if (!isSummonerPackArray(o.packs)) return null
      return encodeSummonerPacks({ packs: o.packs })
    case "summoner.mcp.servers":
      if (!isSummonerMcpServerArray(o.servers)) return null
      return encodeSummonerMcpServers({ servers: o.servers })
    case "summoner.skills":
      if (!isSummonerSkillArray(o.skills)) return null
      return encodeSummonerSkills({ skills: o.skills })
    case "summoner.knowledge":
      if (!isSummonerKnowledgeArray(o.docs)) return null
      return encodeSummonerKnowledge({ docs: o.docs })
    // #433 P1 search results
    case "summoner.thread.search.results":
      if (!isSummonerThreadSearchHitArray(o.hits)) return null
      return encodeSummonerThreadSearchResults({ hits: o.hits })
    case "summoner.knowledge.search.results":
      if (!isSummonerKnowledgeSearchHitArray(o.hits)) return null
      return encodeSummonerKnowledgeSearchResults({ hits: o.hits })
    case "summoner.peek.result":
      if (!isString(o.thread_id) || !isString(o.title) || !isString(o.markdown)) return null
      if (typeof o.truncated !== "boolean" || typeof o.redacted_hits !== "number") return null
      return encodeSummonerPeekResult({
        thread_id: o.thread_id,
        title: o.title,
        markdown: o.markdown,
        truncated: o.truncated,
        redacted_hits: o.redacted_hits,
      })
    default:
      return null
  }
}

/**
 * Decode Swift → Companion (`type`). Null on invalid JSON, wrong shape,
 * HUD/tray traffic, or any `summoner.confirm.*` payload.
 */
export function decodeSummonerInbound(raw: unknown): SummonerInboundEvt | null {
  const o = asRecord(raw)
  if (!o) return null
  if (isSummonerConfirmDialect(o)) return null
  if (!isString(o.type)) return null

  switch (o.type) {
    case "summoner.ready":
      return encodeSummonerReady()
    case "summoner.closed":
      return encodeSummonerClosed()
    case "summoner.submit":
      if (!isString(o.thread_id) || !isString(o.text)) return null
      if (o.enqueue !== undefined && typeof o.enqueue !== "boolean") return null
      return encodeSummonerSubmit({
        thread_id: o.thread_id,
        text: o.text,
        enqueue: o.enqueue === true,
      })
    case "summoner.search":
      if (!isString(o.query)) return null
      return encodeSummonerSearch({ query: o.query })
    case "summoner.select":
      if (!isString(o.thread_id) || !o.thread_id) return null
      return encodeSummonerSelect({ thread_id: o.thread_id })
    case "summoner.attach_chrome":
      if (o.foreground !== undefined && typeof o.foreground !== "boolean") return null
      return encodeSummonerAttachChrome(o.foreground === true ? { foreground: true } : undefined)
    case "summoner.continue":
      return encodeSummonerContinue()
    case "summoner.hotkey.chosen":
      if (!isString(o.combo)) return null
      return encodeSummonerHotkeyChosen({ combo: o.combo })
    case "summoner.composing":
      if (typeof o.on !== "boolean") return null
      return encodeSummonerComposing({ on: o.on })
    case "summoner.mic.start":
      return encodeSummonerMicStart()
    case "summoner.mic.chunk":
      if (typeof o.seq !== "number" || !Number.isInteger(o.seq) || o.seq < 0) return null
      if (!isString(o.data)) return null
      return encodeSummonerMicChunk({ seq: o.seq, data: o.data })
    case "summoner.mic.end":
      return encodeSummonerMicEnd()
    case "summoner.mic.wav":
      if (!isString(o.data)) return null
      return encodeSummonerMicWav({ data: o.data })
    case "summoner.new_thread":
      return encodeSummonerNewThread()
    case "summoner.thread.rename":
      if (!isString(o.thread_id) || !o.thread_id) return null
      if (!isString(o.alias) || !o.alias) return null
      return encodeSummonerThreadRename({ thread_id: o.thread_id, alias: o.alias })
    case "summoner.thread.trash":
      if (!isString(o.thread_id) || !o.thread_id) return null
      return encodeSummonerThreadTrash({ thread_id: o.thread_id })
    case "summoner.files": {
      if (!isString(o.thread_id)) return null
      if (!Array.isArray(o.files) || o.files.length < 1 || o.files.length > 8) return null
      const files: SummonerFilesEvt["files"] = []
      for (const raw of o.files) {
        if (!raw || typeof raw !== "object") return null
        const f = raw as Record<string, unknown>
        if (!isString(f.name) || !f.name || !isString(f.content) || !f.content) return null
        files.push({
          name: f.name,
          type: isString(f.type) ? f.type : "",
          content: f.content,
        })
      }
      return encodeSummonerFiles({ type: "summoner.files", thread_id: o.thread_id, files })
    }
    case "summoner.pack.apply":
      if (!isString(o.pack_id) || !o.pack_id) return null
      return encodeSummonerPackApply({ pack_id: o.pack_id })
    case "summoner.mcp.toggle":
      if (!isString(o.name) || !o.name) return null
      if (typeof o.enabled !== "boolean") return null
      return encodeSummonerMcpToggle({ name: o.name, enabled: o.enabled })
    case "summoner.mcp.add":
      if (!isString(o.name) || !o.name) return null
      if (!isString(o.command) || !o.command) return null
      return encodeSummonerMcpAdd({ name: o.name, command: o.command })
    case "summoner.skill.toggle":
      if (!isString(o.name) || !o.name) return null
      if (typeof o.on !== "boolean") return null
      return encodeSummonerSkillToggle({ name: o.name, on: o.on })
    case "summoner.knowledge.attach":
      if (!isString(o.id) || !o.id) return null
      return encodeSummonerKnowledgeAttach({ id: o.id })
    case "summoner.knowledge.import":
      if (!isString(o.name) || !o.name) return null
      if (!isString(o.mime)) return null
      if (!isString(o.content) || !o.content) return null
      return encodeSummonerKnowledgeImport({ name: o.name, mime: o.mime, content: o.content })
    case "summoner.settings.set":
      if (!isResumeIdleMinutes(o.resume_idle_minutes)) return null
      if (typeof o.chrome_foreground !== "boolean") return null
      return encodeSummonerSettingsSet({
        resume_idle_minutes: o.resume_idle_minutes,
        chrome_foreground: o.chrome_foreground,
      })
    // #433 P1 search events
    case "summoner.thread.search":
      if (!isString(o.query)) return null
      return encodeSummonerThreadSearch({ query: o.query })
    case "summoner.knowledge.search":
      if (!isString(o.query)) return null
      return encodeSummonerKnowledgeSearch({ query: o.query })
    case "summoner.peek":
      if (!isString(o.thread_id) || !o.thread_id) return null
      return encodeSummonerPeek({ thread_id: o.thread_id })
    case "summoner.cite_thread":
      if (!isString(o.thread_id) || !o.thread_id) return null
      return encodeSummonerCiteThread({ thread_id: o.thread_id })
    default:
      return null
  }
}
