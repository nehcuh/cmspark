/**
 * D13 production entry for browser_download mutual exclusion.
 *
 * CRITICAL: busy bit is acquired BEFORE TabQueue so concurrent same-tab
 * browser_download/download calls reject with DOWNLOAD_BUSY (not serialize
 * to dual success). BrowserBridge.execute MUST route through this helper;
 * unit tests cover this path without loading the full chrome-backed bridge.
 */

export type DownloadBusyToolResult = {
  success: boolean
  data?: any
  error?: string
}

export function isBrowserDownloadToolName(toolName: string): boolean {
  return toolName === "browser_download" || toolName === "download"
}

/**
 * Production gate used by BrowserBridge.execute.
 *
 * - For browser_download/download + numeric tabId: try-acquire busy; on conflict
 *   return DOWNLOAD_BUSY immediately (do not enter TabQueue / executeInner).
 * - On acquire: set __downloadBusyPreAcquired so runBrowserDownload does not
 *   double-add/delete the busy bit; release in finally after queue settles.
 * - All other tools: plain tabQueue.run → executeInner.
 */
export async function runWithDownloadBusyBeforeQueue(opts: {
  toolName: string
  params: Record<string, any>
  tabId: number | undefined
  downloadBusyTabs: Set<number>
  tabQueueRun: <T>(tabId: number | undefined | null, fn: () => Promise<T>) => Promise<T>
  executeInner: (
    toolName: string,
    params: Record<string, any>,
  ) => Promise<DownloadBusyToolResult>
}): Promise<DownloadBusyToolResult> {
  const { toolName, params, tabId, downloadBusyTabs, tabQueueRun, executeInner } = opts

  if (isBrowserDownloadToolName(toolName) && typeof tabId === "number") {
    if (downloadBusyTabs.has(tabId)) {
      return {
        success: false,
        error: "DOWNLOAD_BUSY: a browser_download is already in progress on this tab",
        data: { error_code: "DOWNLOAD_BUSY", tabId },
      }
    }
    downloadBusyTabs.add(tabId)
    try {
      return await tabQueueRun(tabId, () =>
        executeInner(toolName, { ...params, __downloadBusyPreAcquired: true }),
      )
    } finally {
      downloadBusyTabs.delete(tabId)
    }
  }

  return tabQueueRun(tabId, () => executeInner(toolName, params))
}
