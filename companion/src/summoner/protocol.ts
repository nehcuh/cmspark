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
 */

/** Title-search capability copy. Overlay never searches message body. */
export const SUMMONER_SEARCH_HINT = "只搜标题，不搜正文" as const
export type SummonerSearchHint = typeof SUMMONER_SEARCH_HINT

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
export type SummonerPackRow = { id: string; name: string; overlay_eligible: boolean }
export type SummonerPacksCmd = { cmd: "summoner.packs"; packs: SummonerPackRow[] }

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
export type SummonerPackApplyEvt = { type: "summoner.pack.apply"; pack_id: string }
export type SummonerSettingsSetEvt = { type: "summoner.settings.set" } & SummonerSettingsPayload

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
  | SummonerPackApplyEvt
  | SummonerSettingsSetEvt

export type SummonerWireMessage = SummonerOutboundCmd | SummonerInboundEvt

// ── Encoders (typed objects; stringify with summonerLine) ───────────────────

export function encodeSummonerOpen(p: SummonerOpenPayload): SummonerOpenCmd {
  return { cmd: "summoner.open", thread_id: p.thread_id }
}

export function encodeSummonerClose(): SummonerCloseCmd {
  return { cmd: "summoner.close" }
}

export function encodeSummonerHydrate(p: SummonerHydratePayload): SummonerHydrateCmd {
  return {
    cmd: "summoner.hydrate",
    thread_id: p.thread_id,
    lines: p.lines,
    browser: p.browser,
    search_hint: p.search_hint,
  }
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

function isBrowser(v: unknown): v is SummonerBrowser {
  return v === "attached" || v === "detached"
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
      return encodeSummonerHydrate({
        thread_id: o.thread_id,
        lines: o.lines,
        browser: o.browser,
        search_hint: o.search_hint,
      })
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
    case "summoner.pack.apply":
      if (!isString(o.pack_id) || !o.pack_id) return null
      return encodeSummonerPackApply({ pack_id: o.pack_id })
    case "summoner.settings.set":
      if (!isResumeIdleMinutes(o.resume_idle_minutes)) return null
      if (typeof o.chrome_foreground !== "boolean") return null
      return encodeSummonerSettingsSet({
        resume_idle_minutes: o.resume_idle_minutes,
        chrome_foreground: o.chrome_foreground,
      })
    default:
      return null
  }
}
