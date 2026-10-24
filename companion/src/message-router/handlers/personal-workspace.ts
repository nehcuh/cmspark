import { handleActivityMessage } from "../../activity"
import { handleSettingsAssistantMessage } from "../../settings-assistant"
import { isChromeExtensionWsOrigin } from "../../ws/handshake-surface"

export interface WorkspaceSession {
  surface?: string
  origin?: string
  panelId?: string
  isCurrentSession?: () => boolean
}

/** Existing authenticated panel authority only. Payload flags cannot grant this capability. */
export async function handlePersonalWorkspaceMessage(message: any, session?: WorkspaceSession): Promise<any> {
  const settings = message.type.startsWith("settings.assistant.")
  if (session?.surface !== "panel" || !isChromeExtensionWsOrigin(session.origin) || !session.panelId || session.isCurrentSession?.() !== true) {
    return { type: settings ? "settings.assistant.error" : "activity.result", id: message.id, ok: false, error_code: "WORKSPACE_METHOD_DENIED", error: "请从已连接的工作中心或对话面板操作" }
  }
  return settings
    ? handleSettingsAssistantMessage(message, session.panelId, session.isCurrentSession)
    : handleActivityMessage(message, { current: session.isCurrentSession })
}
