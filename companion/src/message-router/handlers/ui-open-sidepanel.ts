// ui.open_sidepanel — tray-origin request to open the Chrome side panel.
// Dual-process: companion broadcasts {type} with no id; extension SW opens
// the panel. Never SUMMONER_ALLOW. Never Chrome panel APIs in this process.
// Origin is the reverse of overlay.shell.open: tray asks, extension receives.

export type UiOpenSidepanelSession = {
  origin?: string
  surface?: string
  broadcast?: (data: Record<string, unknown>) => void
}

function uiOpenError(code: string, error?: string): { type: "error"; error_code: string; error: string } {
  return { type: "error", error_code: code, error: error || code }
}

export async function handleUiOpenSidepanel(
  _rest: Record<string, unknown>,
  session?: UiOpenSidepanelSession,
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
  session.broadcast({ type: "ui.open_sidepanel" })
  // Request accepted, not opened — extension SW may still fail without a gesture.
  return { type: "ui.open_sidepanel.accepted" }
}
