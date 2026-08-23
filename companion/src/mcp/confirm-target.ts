/**
 * Overlay chat may call companion MCP tools, but N5/S21 forbid Allow/Deny
 * on the summoner surface. Confirm-required MCP must retarget the Panel WS.
 */

export const MCP_OVERLAY_CONFIRM_NOTICE =
  "MCP 工具需在 Chrome 侧栏批准。召唤器不能代替侧栏点批准。" as const

export const MCP_OVERLAY_CONFIRM_UNAVAILABLE =
  "MCP 工具需要批准。请打开 Chrome 侧栏（CMspark）完成一次批准；侧栏里已配置的 MCP，召唤器对话可以直接调用。" as const

export function resolveMcpConfirmTarget(args: {
  originatingSurface?: string
  originatingOpen: boolean
  extensionOpen: boolean
}):
  | { target: "origin" | "extension"; overlayNotice?: string }
  | { error: string } {
  if (args.originatingSurface !== "summoner") {
    if (!args.originatingOpen) {
      return { error: "MCP tool cannot be confirmed (peer disconnected)" }
    }
    return { target: "origin" }
  }
  if (args.extensionOpen) {
    return { target: "extension", overlayNotice: MCP_OVERLAY_CONFIRM_NOTICE }
  }
  return { error: MCP_OVERLAY_CONFIRM_UNAVAILABLE }
}

export function connectedMcpServerNames(
  servers: Array<{ name?: unknown; connection?: { status?: unknown } }>,
): string[] {
  const names: string[] = []
  for (const s of servers) {
    if (typeof s.name !== "string" || !s.name) continue
    if (s.connection?.status !== "connected") continue
    names.push(s.name)
  }
  return names
}
