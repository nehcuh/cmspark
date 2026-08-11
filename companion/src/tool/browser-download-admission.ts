// browser_download path sandbox + worker path policy for createToolExecutor.
// Extracted from server.ts (C10 Phase E1 mechanical split) — zero behavior change.
//
// FREEZE: browser_download prepareBrowserDownloadParams + logging live HERE.
// Do NOT re-inflate createToolExecutor with this block.
// Cookie/URL → tool/url-cookie-admission.ts; L2 → tool/l2-admission.ts;
// image → tool/image-fetch-admission.ts; MCP → mcp/dispatch.ts.

import { logger } from "../logger"
import { prepareBrowserDownloadParams } from "../path-sandbox"

export type BrowserDownloadAdmissionResult =
  | { ok: true; finalParams: Record<string, any>; downloadPath?: string; isWorker: boolean }
  | { ok: false; result: { success: false; error: string; data?: any } }

export type BrowserDownloadAdmissionCtx = {
  toolName: string
  finalParams: Record<string, any>
  toolCallId: string
  startedAt: number
  actingThreadId?: string
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
  getThreadManager: () => { get: (id: string) => any } | null | undefined
}

/**
 * No-op pass-through if toolName !== "browser_download".
 * Else prepareBrowserDownloadParams + logging; on fail returns early result
 * (already logToolFinish'd — match prior server.ts behavior).
 */
export function runBrowserDownloadAdmission(
  ctx: BrowserDownloadAdmissionCtx,
): BrowserDownloadAdmissionResult {
  const {
    toolName,
    finalParams,
    toolCallId,
    startedAt,
    actingThreadId,
    logToolFinish,
    getThreadManager,
  } = ctx

  // P1.0 browser_download: path sandbox + worker path policy BEFORE extension dispatch.
  // auto_approve_dangerous must NOT relax this (roots stay Downloads-only). No L2 for default Downloads.
  if (toolName !== "browser_download") {
    return { ok: true, finalParams, isWorker: false }
  }

  let isWorker = false
  const threadManager = getThreadManager()
  if (actingThreadId && threadManager) {
    try {
      const th = threadManager.get(actingThreadId) as any
      isWorker = th?.agent_role === "worker"
    } catch {
      /* ignore */
    }
  }
  const prepared = prepareBrowserDownloadParams({ params: finalParams, isWorker })
  if (!prepared.ok) {
    const result = {
      success: false as const,
      error: prepared.error,
      data: prepared.data || { error_code: prepared.error_code },
    }
    logger.warn(
      prepared.error_code === "PATH_ESCAPE"
        ? "browser_download.path_escape"
        : prepared.error_code === "WORKER_PATH_DENIED"
          ? "browser_download.worker_path_denied"
          : "browser_download.rejected",
      { tool_call_id: toolCallId, error_code: prepared.error_code, is_worker: isWorker },
    )
    logToolFinish(toolCallId, toolName, startedAt, result)
    return { ok: false, result }
  }
  const nextParams = prepared.params
  logger.info("browser_download.start", {
    tool_call_id: toolCallId,
    tabId: nextParams.tabId,
    path_root: prepared.downloadPath,
    has_text: !!nextParams.text,
    has_selector: !!nextParams.selector,
    is_worker: isWorker,
  })
  return {
    ok: true,
    finalParams: nextParams,
    downloadPath: prepared.downloadPath,
    isWorker,
  }
}
