import { randomUUID } from "node:crypto"
import { siteTargetFromBridge, type SiteTarget } from "./target"
import { applyTabNavigated } from "../ws/tab-url-cache"

type Executor = (id: string, name: string, params: any, signal?: AbortSignal, options?: { siteContextTabId?: number }) => Promise<{ success: boolean; data?: any }>

/** Local Chat entry only. Resolve the browser-selected id through the existing
 * authenticated read executor, never model params.url or a hostname hint.
 * This is metadata discovery, not an Observation or an MCP grant decision. */
export async function resolveBrowserSiteTarget(
  execute: Executor, scopeId: string, tabId: number, signal?: AbortSignal, budgetMs = 1500,
): Promise<SiteTarget | undefined> {
  if (!Number.isSafeInteger(tabId) || tabId < 0 || signal?.aborted) return undefined
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener("abort", cancel, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<undefined>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(undefined) }, budgetMs)
    })
    const read = execute(`site-context-${randomUUID()}`, "list_tabs", { __thread_id: scopeId }, controller.signal, { siteContextTabId: tabId })
      .then(result => {
        if (controller.signal.aborted || !result.success) return undefined
        const target = siteTargetFromBridge(result.data?.site_target)
        if (!target || target.tab_id !== tabId) return undefined
        applyTabNavigated(tabId, target.url)
        return target
      }).catch(() => undefined)
    return await Promise.race([read, deadline])
  } catch {
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
  }
}
