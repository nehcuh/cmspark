// #433 P2 — companion → ext `ui.command` whitelist (spec §3b).
// Duplicate lockstep: companion/src/ui-command.ts (same five action strings).

export const UI_COMMAND_ACTIONS = [
  "focus_panel",
  "open_confirm_center",
  "open_browser",
  "thread.new_in_panel",
  "open_terminal_tab",
] as const

export type UiCommandAction = (typeof UI_COMMAND_ACTIONS)[number]

export function isUiCommandAction(raw: unknown): raw is UiCommandAction {
  return typeof raw === "string" && (UI_COMMAND_ACTIONS as readonly string[]).includes(raw)
}

export type UiCommandImpl = Record<UiCommandAction, () => Promise<void>>

export async function runUiCommand(
  action: unknown,
  impl: UiCommandImpl,
): Promise<{ ok: true; action: UiCommandAction } | { ok: false; error: string }> {
  if (!isUiCommandAction(action)) {
    return { ok: false, error: "unknown ui.command action" }
  }
  await impl[action]()
  return { ok: true, action }
}
