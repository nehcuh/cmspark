// ui.open_sidepanel — tray-origin request to open the Chrome side panel.
// True result round-trip: companion broadcasts {type, id}; the extension SW
// replies ui.open_sidepanel.result {id, ok, error?}; the handler awaits that
// frame (short timeout counts as failure). Never SUMMONER_ALLOW. Never Chrome
// panel APIs in this process.
// Origin is the reverse of overlay.shell.open: tray asks, extension receives.
// R4: the result frame is origin-bound — only an extension peer (panel
// surface / chrome-extension:// origin) may resolve a waiter; every settle
// path clears the timer so the first settle wins (no TIMEOUT-after-FAILED).

import crypto from "node:crypto"

import { logger } from "../../logger"
import { isChromeExtensionWsOrigin } from "../../ws/handshake-surface"
import { miniCaptures, miniDestination } from "../../mini/capture-handoff"
import { isMiniCapture } from "../../mini/actions"

export type UiOpenSidepanelSession = {
  origin?: string
  surface?: string
  broadcast?: (data: Record<string, unknown>) => void
  panelId?: string
  miniPanel?: () => { id: string; send: (frame: Record<string, unknown>) => void } | undefined
}

/** Must stay below the tray-side sendAppRequest timeout (8s in menu-bar-agent). */
const RESULT_TIMEOUT_MS = 6_000

type SettleResult = { ok: boolean; error?: string; timedOut?: boolean }

type PendingResult = {
  panelId?: string
  destination?: string
  /** First call wins: clears the timer, unregisters, resolves exactly once. */
  settle: (r: SettleResult) => void
}

/** Correlation id → waiter, resolved by handleUiOpenSidepanelResult. */
const pendingResults = new Map<string, PendingResult>()

function uiOpenError(code: string, error?: string): { type: "error"; error_code: string; error: string } {
  return { type: "error", error_code: code, error: error || code }
}

/**
 * Extension SW → companion result frame. Fire-and-forget; resolves the waiter.
 * R4: origin-bound — only an extension peer (surface=panel or a
 * chrome-extension:// WS origin) may settle a waiter; anything else is
 * dropped (logged) so a tray/summoner/unknown peer cannot forge results.
 */
export function handleUiOpenSidepanelResult(
  rest: Record<string, unknown>,
  session?: UiOpenSidepanelSession,
): Record<string, unknown> {
  const fromExtension =
    session?.surface === "panel" || isChromeExtensionWsOrigin(session?.origin)
  if (!fromExtension) {
    logger.warn("ui_open_sidepanel.result_dropped", {
      surface: session?.surface ?? "unknown",
    })
    return { type: "ok" }
  }
  const id = typeof rest.id === "string" ? rest.id : ""
  const pending = id ? pendingResults.get(id) : undefined
  if (pending && (!pending.panelId || pending.panelId === session?.panelId)) {
    const supported = (!pending.destination || pending.destination === rest.destination) &&
      (pending.destination !== "mini_meeting" || rest.ok !== true || rest.meeting_opened === true)
    pending.settle({
      ok: rest.ok === true && supported,
      error: !supported ? "请更新 Chrome 扩展以使用 Mini 快速操作" : typeof rest.error === "string" ? rest.error : undefined,
    })
  }
  return { type: "ok" }
}

export async function handleUiOpenSidepanel(
  rest: Record<string, unknown>,
  session?: UiOpenSidepanelSession,
  timeoutMs: number = RESULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  if (session?.surface === "summoner") {
    return uiOpenError("SUMMONER_ACL", "SUMMONER_ACL: ui.open_sidepanel not allowed on summoner surface")
  }
  const origin = session?.origin
  if (origin !== "cmspark-tray://local") {
    return uiOpenError("UI_OPEN_SIDEPANEL_ORIGIN")
  }
  if (typeof session?.broadcast !== "function") {
    return uiOpenError("UI_OPEN_SIDEPANEL_UNAVAILABLE")
  }
  const mini = miniDestination(rest.destination)
  let peer: ReturnType<NonNullable<UiOpenSidepanelSession["miniPanel"]>>
  try { if (mini) peer = session.miniPanel?.() }
  catch (error) { return uiOpenError("MINI_PANEL_AMBIGUOUS", (error as Error).message) }
  if (mini && !peer) return uiOpenError("MINI_PANEL_UNAVAILABLE", "尚未连接 Chrome 扩展")
  let ticket: string | undefined
  if (mini && isMiniCapture(mini)) {
    try { ticket = miniCaptures.stage(mini, rest.image_base64, peer!.id) }
    catch (error) { return uiOpenError("MINI_CAPTURE_INVALID", (error as Error).message) }
  }
  const id = `uosp-${crypto.randomBytes(8).toString("hex")}`
  const result = await new Promise<SettleResult>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout
    // Single settle funnel (R4): every path — result frame and timeout — goes
    // through here, clears the timer, and unregisters; the first settle wins,
    // so an ok:false result can never be re-reported as TIMEOUT by a late tick.
    const settle = (r: SettleResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingResults.delete(id)
      resolve(r)
    }
    timer = setTimeout(() => settle({ ok: false, timedOut: true }), timeoutMs)
    // Production: overlay wait must not pin process.exit. Tests: keep the
    // timer ref'd — Node 22 `node --test` cancels pending cases once the
    // event loop is only unref'd handles (CI: 13 cancelled, 0 fail).
    if (!process.env.NODE_TEST_CONTEXT) timer.unref?.()
    pendingResults.set(id, { settle, ...(peer ? { panelId: peer.id, destination: String(rest.destination) } : {}) })
    const frame = { type: "ui.open_sidepanel", id, ...(rest.destination === "screenshot_todo" || mini ? { destination: rest.destination } : {}), ...(ticket ? { ticket } : {}) }
    try { if (peer) peer.send(frame); else session.broadcast!(frame) }
    catch { settle({ ok: false, error: "Chrome 扩展已断开连接" }) }
  })
  if (!result.ok) {
    if (ticket) miniCaptures.discard(ticket)
    if (result.timedOut) {
      return uiOpenError("UI_OPEN_SIDEPANEL_TIMEOUT", "extension did not report a side panel result in time")
    }
    return uiOpenError("UI_OPEN_SIDEPANEL_FAILED", result.error || "extension failed to open the side panel")
  }
  return { type: "ui.open_sidepanel.opened", ...(mini ? { destination: rest.destination } : {}) }
}
