// ui.command — summoner/tray asks; companion pushes the whitelist frame to the
// extension (spec §3b). Overlay never renders Allow/Deny; this is not an L2 class.

import { isUiCommandAction, type UiCommandAction } from "../../ui-command"

export type UiCommandSession = {
  broadcast?: (data: Record<string, unknown>) => void
}

export function handleUiCommand(
  rest: Record<string, unknown>,
  session?: UiCommandSession,
): Record<string, unknown> {
  if (!isUiCommandAction(rest.action)) {
    return {
      type: "error",
      error_code: "UI_COMMAND_UNKNOWN",
      error: "ui.command action is not on the hardcoded whitelist",
    }
  }
  const action: UiCommandAction = rest.action
  if (typeof session?.broadcast !== "function") {
    return {
      type: "error",
      error_code: "UI_COMMAND_UNAVAILABLE",
      error: "no panel broadcast channel",
    }
  }
  session.broadcast({ type: "ui.command", action })
  return { type: "ui.command.ok", action }
}
