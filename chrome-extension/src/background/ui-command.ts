import { isUiCommandAction, type UiCommandAction } from "../shared/ui-command"
export { UI_COMMAND_ACTIONS, isUiCommandAction, type UiCommandAction } from "../shared/ui-command"

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
