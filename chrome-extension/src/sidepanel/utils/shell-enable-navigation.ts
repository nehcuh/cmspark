import type { Message } from "../types"
import { humanizeSidepanelGateError } from "./gate-error-copy"

/** Navigation only. These two raw gate errors get buttons; every other error stays text. */
export type ShellEnableNavigation = { packs: true; settingsSection: "integrations" }

const REWRITTEN_ENTERPRISE_GATE = "本机能力未开启或当前安装通道不足"

export function shellEnableNavigationFor(raw: string): ShellEnableNavigation | null {
  const text = raw || ""
  const shellDisabled = /module_disabled:shell\b/.test(text)
  const profileRequired = /enterprise_profile_required\b/.test(text)
  const rewritten = text.includes(REWRITTEN_ENTERPRISE_GATE)
  if (!shellDisabled && !profileRequired && !rewritten) return null
  return { packs: true, settingsSection: "integrations" }
}

export function gateErrorChatMessage(raw: string, threadId: string, id: string): Message {
  const navigation = shellEnableNavigationFor(raw)
  return {
    id,
    thread_id: threadId,
    role: "assistant",
    content: humanizeSidepanelGateError(raw),
    created_at: new Date().toISOString(),
    ...(navigation ? { shellEnableNavigation: navigation } : {}),
  }
}

/** Opens an existing screen. Does not send a module, profile, config, or pack message. */
export function runShellEnableNavigation(
  target: "packs" | "integrations",
  deps: {
    openPacks: () => void
    dispatch: (action: { type: "OPEN_SETTINGS_SECTION"; section: "integrations" }) => void
  },
) {
  if (target === "packs") deps.openPacks()
  else deps.dispatch({ type: "OPEN_SETTINGS_SECTION", section: "integrations" })
}
