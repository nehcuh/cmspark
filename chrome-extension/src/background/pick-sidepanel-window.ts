/**
 * #244: open the Side Panel on a real Chrome window, never the overlay --app
 * shell. `--app=http://127.0.0.1:port/` windows are still type "normal", so
 * "focused normal window" is exactly the 浮窗 the user just clicked in.
 */

export type SidePanelWindowTab = { url?: string; active?: boolean }

export type SidePanelWindow = {
  id?: number
  focused?: boolean
  type?: string
  tabs?: SidePanelWindowTab[]
}

/** Loopback overlay HTML (`/` or `/summoner`). Keep in lockstep with companion isSummonerLoopbackUrl. */
export function isOverlayShellTabUrl(url: string | undefined | null): boolean {
  if (typeof url !== "string" || !url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== "http:") return false
    const host = u.hostname.toLowerCase()
    if (host !== "127.0.0.1" && host !== "localhost") return false
    const path = u.pathname === "" ? "/" : u.pathname
    if (path !== "/" && path !== "/summoner") return false
    return true
  } catch {
    return false
  }
}

export function isOverlayAppWindow(win: SidePanelWindow): boolean {
  if (win.type && win.type !== "normal") return true
  const tabs = Array.isArray(win.tabs) ? win.tabs : []
  if (tabs.length === 0) return false
  const active = tabs.find((t) => t.active) || tabs[0]
  return isOverlayShellTabUrl(active?.url)
}

/**
 * Prefer the focused non-overlay normal window; else any other non-overlay
 * normal window. Never returns the overlay --app window id.
 */
export function pickSidePanelWindow(windows: SidePanelWindow[]): number | undefined {
  const candidates = (Array.isArray(windows) ? windows : []).filter(
    (w) => typeof w.id === "number" && !isOverlayAppWindow(w),
  )
  const focused = candidates.find((w) => w.focused)
  return focused?.id ?? candidates[0]?.id
}
