/**
 * browser_download implementation (P1.0) — extracted for clarity.
 * Primary transport: chrome.downloads (download-waiter).
 * Optional CDP setDownloadBehavior path hint only.
 */

import {
  buildFindByTextExpression,
  classifyTextMatchCount,
  type TextMatchResult,
} from "./find-element-by-text"
import {
  createDownloadWaiter,
  type DownloadCompleteInfo,
} from "./download-waiter"

export interface BrowserDownloadBridge {
  getTabId(params: Record<string, any>): number
  sendCdp(tabId: number, method: string, params?: any): Promise<any>
  scriptingExecute(tabId: number, code: string): Promise<any>
  click(params: Record<string, any>, clickCount?: number): Promise<{ success: boolean; error?: string }>
  downloadBusyTabs: Set<number>
}

export type ToolResult = { success: boolean; data?: any; error?: string }

/**
 * When bridge.execute pre-acquired DOWNLOAD_BUSY (D13 before TabQueue), pass
 * `__downloadBusyPreAcquired: true` so the handler does not double-add/delete.
 */
export async function runBrowserDownload(
  bridge: BrowserDownloadBridge,
  params: Record<string, any>,
): Promise<ToolResult> {
  const tabId = bridge.getTabId(params)
  const selector =
    typeof params.selector === "string" && params.selector.trim()
      ? params.selector.trim()
      : undefined
  const text =
    typeof params.text === "string" && params.text.trim() ? params.text.trim() : undefined
  if (!selector && !text) {
    return {
      success: false,
      error: "ELEMENT_NOT_FOUND: browser_download requires selector and/or text",
      data: { error_code: "SELECTOR_OR_TEXT_REQUIRED" },
    }
  }

  const downloadPath = typeof params.downloadPath === "string" ? params.downloadPath : ""
  if (downloadPath && (/^\\\\/.test(downloadPath) || /^\/\/[^/]/.test(downloadPath))) {
    return {
      success: false,
      error: `PATH_ESCAPE: download path not allowed (UNC): ${downloadPath}`,
      data: { error_code: "PATH_ESCAPE" },
    }
  }

  const busyPreAcquired = params.__downloadBusyPreAcquired === true
  if (!busyPreAcquired) {
    if (bridge.downloadBusyTabs.has(tabId)) {
      return {
        success: false,
        error: "DOWNLOAD_BUSY: a browser_download is already in progress on this tab",
        data: { error_code: "DOWNLOAD_BUSY", tabId },
      }
    }
    bridge.downloadBusyTabs.add(tabId)
  }

  let timeoutMs = 60_000
  if (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)) {
    timeoutMs = Math.min(120_000, Math.max(1_000, Math.floor(params.timeoutMs)))
  }
  const exact = params.exact === true
  const filenameHint =
    typeof params.filenameHint === "string" && params.filenameHint.trim()
      ? params.filenameHint.trim()
      : undefined

  let behaviorSet = false
  let waiter: ReturnType<typeof createDownloadWaiter> | null = null

  try {
    // Resolve text/selector first (before chrome.downloads) so ELEMENT_* can be unit-tested
    // without a real downloads permission surface.
    let clickSelector = selector
    let textCoords: { x: number; y: number } | null = null
    if (text) {
      const expr = buildFindByTextExpression(text, exact)
      let match: TextMatchResult | null = null
      try {
        const r = await bridge.sendCdp(tabId, "Runtime.evaluate", {
          expression: expr,
          returnByValue: true,
        })
        match = r?.result?.value ?? null
      } catch {
        match = (await bridge.scriptingExecute(tabId, expr)) as TextMatchResult | null
      }
      const count = match?.count ?? 0
      const classification = classifyTextMatchCount(count)
      if (classification === "ELEMENT_NOT_FOUND") {
        return {
          success: false,
          error: `ELEMENT_NOT_FOUND: no visible element matching text "${text}"`,
          data: { error_code: "ELEMENT_NOT_FOUND", text, exact },
        }
      }
      if (classification === "ELEMENT_AMBIGUOUS") {
        return {
          success: false,
          error: `ELEMENT_AMBIGUOUS: ${count} elements match text "${text}"`,
          data: {
            error_code: "ELEMENT_AMBIGUOUS",
            count,
            matches: match?.matches?.slice(0, 5),
          },
        }
      }
      const m0 = match?.matches?.[0]
      if (m0 && typeof m0.x === "number" && typeof m0.y === "number") {
        textCoords = { x: m0.x, y: m0.y }
        clickSelector = undefined
      } else {
        clickSelector = undefined
      }
    }

    // Register waiter BEFORE click so onCreated cannot race past us.
    const downloadsApi =
      (params.__downloadsApi as typeof chrome.downloads | undefined) || chrome.downloads
    waiter = createDownloadWaiter({
      timeoutMs,
      filenameHint,
      tabId,
      downloadsApi,
      now: typeof params.__now === "function" ? params.__now : undefined,
      setTimer: typeof params.__setTimer === "function" ? params.__setTimer : undefined,
      clearTimer: typeof params.__clearTimer === "function" ? params.__clearTimer : undefined,
    })

    if (downloadPath) {
      try {
        await bridge.sendCdp(tabId, "Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath,
          eventsEnabled: true,
        })
        behaviorSet = true
      } catch (e: any) {
        console.warn(
          "[browser_download] setDownloadBehavior failed (continuing with chrome.downloads):",
          e?.message || e,
        )
      }
    }

    if (text && textCoords) {
      try {
        await bridge.sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: textCoords.x,
          y: textCoords.y,
        })
        // Skip settle delay when tests inject downloads API (avoids racing mock timeout).
        if (!params.__downloadsApi) {
          await new Promise((r) => setTimeout(r, 40))
        }
        await bridge.sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: textCoords.x,
          y: textCoords.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        })
        await bridge.sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: textCoords.x,
          y: textCoords.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        })
      } catch {
        await bridge.scriptingExecute(
          tabId,
          `(()=>{const el=document.querySelector('[data-cmspark-dl-hit="1"]');if(el){el.click();return true}return false})()`,
        )
      }
    } else if (text && !textCoords) {
      await bridge.scriptingExecute(
        tabId,
        `(()=>{const el=document.querySelector('[data-cmspark-dl-hit="1"]');if(el){el.click();return true}return false})()`,
      )
    }

    if (clickSelector) {
      const clickRes = await bridge.click({ tabId, selector: clickSelector })
      if (!clickRes.success) {
        return {
          success: false,
          error: clickRes.error?.includes("not found")
            ? `ELEMENT_NOT_FOUND: ${clickRes.error}`
            : clickRes.error || "click failed",
          data: { error_code: "ELEMENT_NOT_FOUND", selector: clickSelector },
        }
      }
    }

    const info: DownloadCompleteInfo = await waiter.wait()
    const base = info.filename.split(/[/\\]/).pop() || info.filename
    return {
      success: true,
      data: {
        path: info.filename,
        filename: base,
        bytes: info.fileSize ?? info.totalBytes ?? 0,
        state: "completed",
        url: info.url || "",
        transport: "downloads",
      },
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    const code =
      e?.code ||
      (msg.includes("DOWNLOAD_TIMEOUT")
        ? "DOWNLOAD_TIMEOUT"
        : msg.includes("DOWNLOAD_CANCELED")
          ? "DOWNLOAD_CANCELED"
          : "DOWNLOAD_FAILED")
    return {
      success: false,
      error: msg.startsWith(code) ? msg : `${code}: ${msg}`,
      data: { error_code: code },
    }
  } finally {
    if (waiter) {
      try {
        waiter.dispose()
      } catch {
        /* */
      }
    }
    if (behaviorSet) {
      try {
        await bridge.sendCdp(tabId, "Browser.setDownloadBehavior", {
          behavior: "default",
        })
      } catch {
        /* best-effort D14 */
      }
    }
    if (!busyPreAcquired) {
      bridge.downloadBusyTabs.delete(tabId)
    }
  }
}
