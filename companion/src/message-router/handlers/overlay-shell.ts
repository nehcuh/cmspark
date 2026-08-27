// overlay.shell.open — extension-origin pop-out of the C-thin HTML shell.
// Dual-process: companion broadcasts {type, thread_id} with no id; tray
// companionClient.onAppMessage calls openSummonerWebShell.
// Never SUMMONER_ALLOW. Never Chrome side-panel APIs. Never getTrayInstance()
// (that is UnifiedTray, not the HTML opener).

export type OverlayShellSession = {
  origin?: string
  surface?: string
  broadcast?: (data: Record<string, unknown>) => void
}

function overlayError(code: string, error?: string): { type: "error"; error_code: string; error: string } {
  return { type: "error", error_code: code, error: error || code }
}

export async function handleOverlayShellOpen(
  rest: Record<string, unknown>,
  session?: OverlayShellSession,
): Promise<Record<string, unknown>> {
  if (session?.surface === "summoner") {
    return overlayError("SUMMONER_ACL", "SUMMONER_ACL: overlay.shell.open not allowed on summoner surface")
  }
  const origin = session?.origin
  if (typeof origin !== "string" || !origin.startsWith("chrome-extension://")) {
    return overlayError("OVERLAY_SHELL_ORIGIN")
  }
  const threadId = typeof rest.thread_id === "string" ? rest.thread_id : ""
  if (!threadId) {
    return overlayError("OVERLAY_SHELL_UNAVAILABLE", "overlay.shell.open requires thread_id")
  }
  if (typeof session?.broadcast !== "function") {
    return overlayError("OVERLAY_SHELL_UNAVAILABLE")
  }
  session.broadcast({ type: "overlay.shell.open", thread_id: threadId })
  return { type: "overlay.shell.opened", thread_id: threadId }
}
