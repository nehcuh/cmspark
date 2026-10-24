/** Exact owned UI documents only; an extension content script still has a web URL. */
export function workspaceSenderAllowed(sender: { id?: string; url?: string; frameId?: number } | undefined, extensionId: string): boolean {
  if (!sender || sender.id !== extensionId || sender.frameId !== undefined && sender.frameId !== 0) return false
  try {
    const url = new URL(sender.url || "")
    return url.protocol === "chrome-extension:" && url.hostname === extensionId && !url.username && !url.password && !url.port
      && (url.pathname === "/sidepanel.html" || url.pathname === "/tabs/workspace.html")
  } catch { return false }
}

export function forwardWorkspaceRequest(message: any, sender: { id?: string; url?: string; frameId?: number } | undefined,
  extensionId: string, client: { getState(): string; send(message: object): boolean }): { ok: boolean; error?: string } {
  if (!workspaceSenderAllowed(sender, extensionId)) return { ok: false, error: "仅工作中心和对话面板可使用此能力" }
  if (client.getState() !== "connected") return { ok: false, error: "Companion 未连接；尚未保存" }
  const { require_connected: _connected, ...frame } = message
  try { return { ok: client.send(frame) } }
  catch { return { ok: false, error: "发送结果未确认，请刷新核对" } }
}
