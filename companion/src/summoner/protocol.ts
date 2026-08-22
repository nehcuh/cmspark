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

/** P0 search empty-state copy. Overlay title-search only — never message body. */
export const SUMMONER_SEARCH_HINT = "P0 不搜正文" as const
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

// ── Swift → Companion events ────────────────────────────────────────────────

export type SummonerReadyEvt = { type: "summoner.ready" }
export type SummonerClosedEvt = { type: "summoner.closed" }
export type SummonerSubmitEvt = { type: "summoner.submit"; thread_id: string; text: string }
export type SummonerSearchEvt = { type: "summoner.search"; query: string }
export type SummonerAttachChromeEvt = { type: "summoner.attach_chrome" }
export type SummonerContinueEvt = { type: "summoner.continue" }
export type SummonerHotkeyChosenEvt = { type: "summoner.hotkey.chosen"; combo: string }
export type SummonerComposingEvt = { type: "summoner.composing"; on: boolean }
export type SummonerMicStartEvt = { type: "summoner.mic.start" }
export type SummonerMicChunkEvt = { type: "summoner.mic.chunk"; seq: number; data: string }
export type SummonerMicEndEvt = { type: "summoner.mic.end" }
export type SummonerMicWavEvt = { type: "summoner.mic.wav"; data: string }

export type SummonerInboundEvt =
  | SummonerReadyEvt
  | SummonerClosedEvt
  | SummonerSubmitEvt
  | SummonerSearchEvt
  | SummonerAttachChromeEvt
  | SummonerContinueEvt
  | SummonerHotkeyChosenEvt
  | SummonerComposingEvt
  | SummonerMicStartEvt
  | SummonerMicChunkEvt
  | SummonerMicEndEvt
  | SummonerMicWavEvt

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

export function encodeSummonerSubmit(p: { thread_id: string; text: string }): SummonerSubmitEvt {
  return { type: "summoner.submit", thread_id: p.thread_id, text: p.text }
}

export function encodeSummonerSearch(p: { query: string }): SummonerSearchEvt {
  return { type: "summoner.search", query: p.query }
}

export function encodeSummonerAttachChrome(): SummonerAttachChromeEvt {
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
      return encodeSummonerSubmit({ thread_id: o.thread_id, text: o.text })
    case "summoner.search":
      if (!isString(o.query)) return null
      return encodeSummonerSearch({ query: o.query })
    case "summoner.attach_chrome":
      return encodeSummonerAttachChrome()
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
    default:
      return null
  }
}
