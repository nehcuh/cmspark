/** This new UI-only family cannot be relayed by a website/content-script sender. */
export function projectMetadataSenderAllowed(sender: { id?: string; url?: string; frameId?: number } | undefined, extensionId: string): boolean {
  if (!sender || sender.id !== extensionId || sender.frameId !== undefined && sender.frameId !== 0) return false
  try { const url = new URL(sender.url || ""); return url.protocol === "chrome-extension:" && url.host === extensionId && url.pathname === "/sidepanel.html" }
  catch { return false }
}
