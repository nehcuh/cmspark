// #775 settings-only control plane. No process is started by importing this file.
import type { LcuHumanChannel } from "./authorization"
import type { LcuSettingsState } from "./host"
import { validLcuCommand } from "./contract"

export interface LcuSettingsContext {
  ownerCurrent?: () => boolean
  requestConfirmation?: LcuHumanChannel["request"]
  signal?: AbortSignal
}

export interface LcuSettingsHost {
  getLcuState(): Promise<LcuSettingsState>
  probeLcuFromSettings(channel: LcuHumanChannel, signal?: AbortSignal): Promise<LcuSettingsState>
  configureLcuFromSettings(patch: { command: string | null }, channel: LcuHumanChannel): Promise<LcuSettingsState>
  setLcuEnabledFromSettings(enabled: boolean, channel: LcuHumanChannel): Promise<LcuSettingsState>
}

export async function handleLcuSettingsMessage(
  msg: Record<string, unknown>,
  ctx: LcuSettingsContext = {},
  host?: LcuSettingsHost,
) {
  const id = typeof msg.request_id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(msg.request_id)
    ? msg.request_id : undefined
  const failure = (code: string) => ({ type: "error", family: "computer.lcu", ...(id ? { request_id: id } : {}), code, error: code })
  if (!id || msg.source !== "settings") return failure("LCU_SETTINGS_REQUEST_INVALID")
  const keys = ["type", "source", "request_id", ...(msg.type === "computer.lcu.configure" ? ["command"] : msg.type === "computer.lcu.set_enabled" ? ["enabled"] : [])]
  if (Object.keys(msg).some(key => !keys.includes(key))) return failure("LCU_SETTINGS_REQUEST_INVALID")
  const current = () => !ctx.signal?.aborted && ctx.ownerCurrent?.() === true
  if (!current()) return failure("LCU_OWNER_UNAVAILABLE")
  const channel: LcuHumanChannel = {
    current,
    request: (details, signal) => {
      if (!current() || !ctx.requestConfirmation) return Promise.resolve({ confirmationId: "", approved: false, reason: "disconnect" })
      return ctx.requestConfirmation(details, signal)
    },
  }
  try {
    const api = host ?? await import("./host")
    let state: LcuSettingsState
    switch (msg.type) {
      case "computer.lcu.get_state": state = await api.getLcuState(); break
      case "computer.lcu.probe": state = await api.probeLcuFromSettings(channel, ctx.signal); break
      case "computer.lcu.configure":
        if (msg.command !== null && !validLcuCommand(msg.command)) return failure("LCU_COMMAND_INVALID")
        state = await api.configureLcuFromSettings({ command: msg.command }, channel)
        break
      case "computer.lcu.set_enabled":
        if (typeof msg.enabled !== "boolean") return failure("LCU_ENABLED_INVALID")
        state = await api.setLcuEnabledFromSettings(msg.enabled, channel)
        break
      default: return failure("LCU_SETTINGS_REQUEST_INVALID")
    }
    if (!current()) return failure("LCU_OWNER_UNAVAILABLE")
    return { type: "computer.lcu.state", request_id: id, state }
  } catch (error) {
    // Never send raw subprocess/OS errors or status output into a panel response.
    const code = error instanceof Error && /^LCU_[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "LCU_SETTINGS_FAILED"
    return failure(code)
  }
}
