/**
 * Dictation+ D2 — hold-state fan-out to tray (control plane only; no audio).
 * SoT: 2026-08-07-dictation-plus-design.md §5.2 / §9
 */

import { logger } from "../logger"

export type HoldStateMsg = {
  type: "voice.dictation.hold_state"
  v: 1
  active: boolean
  chord?: string
}

let lastHoldActive = false

/** Process-global last hold flag (tests / tray poll). */
export function isDictationHoldActive(): boolean {
  return lastHoldActive
}

export type HoldStateHandlerDeps = {
  /** Notify tray / HUD: "CMspark · 草稿" listening indicator. */
  onHoldChange?: (active: boolean, chord?: string) => void
  isExtensionOrigin?: (origin: string | undefined) => boolean
}

/**
 * Handle voice.dictation.hold_state from chrome-extension origin.
 * Does not open mic; extension owns gUM / STT.
 */
export function handleDictationHoldState(
  msg: any,
  ctx: { origin?: string } = {},
  deps: HoldStateHandlerDeps = {},
): { type: string; v: number; ok?: boolean; code?: string; message?: string; active?: boolean } {
  const originOk =
    deps.isExtensionOrigin?.(ctx.origin) ??
    (typeof ctx.origin === "string" && /^chrome-extension:\/\/[A-Za-z0-9_-]+$/.test(ctx.origin))
  if (!originOk) {
    logger.warn("voice.dictation.hold_state.refused", { reason: "origin" })
    return { type: "voice.dictation.error", v: 1, code: "origin_denied", message: "chrome-extension origin required" }
  }
  if (msg?.v !== 1) {
    return { type: "voice.dictation.error", v: 1, code: "bad_version", message: "v:1 required" }
  }
  const active = msg.active === true
  const chord = typeof msg.chord === "string" ? msg.chord.slice(0, 64) : undefined
  lastHoldActive = active
  try {
    deps.onHoldChange?.(active, chord)
  } catch (e) {
    logger.warn("voice.dictation.hold_state.tray_failed", {
      err: e instanceof Error ? e.message : String(e),
    })
  }
  logger.info("voice.dictation.hold_state", { active, chord: chord || undefined })
  return { type: "voice.dictation.hold_state_ack", v: 1, ok: true, active }
}

/** Test helper */
export function resetDictationHoldStateForTests(): void {
  lastHoldActive = false
}
