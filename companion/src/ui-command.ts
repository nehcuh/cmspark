// Commands Companion may ask the browser UI to perform.

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
