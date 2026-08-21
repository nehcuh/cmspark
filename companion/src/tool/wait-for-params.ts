/**
 * Normalize wait_for args before they hit the extension.
 *
 * Thread 1snvlv: models often call wait_for({tabId}) after create_tab.
 * Catalog only requires tabId; old extension throws if neither selector nor
 * network_idle is set. Inject network_idle:true so a rebuilt companion still
 * works against an unreloaded unpacked extension.
 */

export function normalizeWaitForParams(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "wait_for") return params
  const selector = typeof params.selector === "string" ? params.selector.trim() : ""
  const next: Record<string, unknown> = { ...params }
  if (!selector && "selector" in next) delete next.selector
  if (selector) return next
  if (next.network_idle === true || next.network_idle === false) return next
  return { ...next, network_idle: true }
}
