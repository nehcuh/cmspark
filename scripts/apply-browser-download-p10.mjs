#!/usr/bin/env node
/**
 * Surgical apply for P1.0 browser_download companion + extension wiring.
 * Idempotent. Run: node scripts/apply-browser-download-p10.mjs
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function patch(file, transforms) {
  const abs = path.join(root, file)
  let s = fs.readFileSync(abs, "utf8")
  const orig = s
  for (const t of transforms) {
    if (t.unless && s.includes(t.unless)) {
      console.log(`skip (already): ${file} — ${t.name || "ok"}`)
      continue
    }
    if (t.find) {
      if (!s.includes(t.find)) {
        console.error(`FAIL missing anchor in ${file}:\n  ${t.find.slice(0, 100)}`)
        process.exit(1)
      }
      s = s.replace(t.find, t.replace)
      console.log(`ok: ${file} — ${t.name || "replace"}`)
    }
  }
  if (s !== orig) fs.writeFileSync(abs, s)
}

// --- server.ts ---
patch("companion/src/server.ts", [
  {
    name: "import prepareBrowserDownloadParams",
    unless: 'from "./path-sandbox"',
    find: `import {
  OSASCRIPT_MACOS_ONLY_ERROR,
  shouldL2GateOsascript,
} from "./bridge/tool-definitions"`,
    replace: `import {
  OSASCRIPT_MACOS_ONLY_ERROR,
  shouldL2GateOsascript,
} from "./bridge/tool-definitions"
import { prepareBrowserDownloadParams } from "./path-sandbox"`,
  },
  {
    name: "normalize download → browser_download alias (BD-ALIAS)",
    unless: 'toolName === "download"',
    find: `  return async (toolCallId: string, toolName: string, params: any, signal?: AbortSignal): Promise<{ success: boolean; data?: any; error?: string }> => {
    let finalParams = params || {}
    // Phase 1 W8 bugfix: STRIP any LLM-provided security_token before L2 gate.`,
    replace: `  return async (toolCallId: string, toolName: string, params: any, signal?: AbortSignal): Promise<{ success: boolean; data?: any; error?: string }> => {
    let finalParams = params || {}
    // P1.0 D18 / BD-ALIAS: normalize legacy "download" → browser_download so path sandbox,
    // worker deny, TAB_LEASE, and dispatch timeout all apply. Never forward unsandboxed
    // downloadPath via the extension alias path.
    if (toolName === "download") {
      toolName = "browser_download"
    }
    // Phase 1 W8 bugfix: STRIP any LLM-provided security_token before L2 gate.`,
  },
  {
    name: "resolveToolDispatchTimeoutMs",
    unless: "resolveToolDispatchTimeoutMs",
    find: `// Exported for integration tests (audit item 6). Production reads the const directly.
export const TOOL_EXECUTION_TIMEOUT_MS = 15000`,
    replace: `// Exported for integration tests (audit item 6). Production reads the const directly.
export const TOOL_EXECUTION_TIMEOUT_MS = 15000
/** browser_download may wait up to 120s; companion WS timeout must not undercut extension. */
export const BROWSER_DOWNLOAD_MAX_TIMEOUT_MS = 120_000
export function resolveToolDispatchTimeoutMs(toolName: string, params?: any): number {
  if (toolName === "browser_download") {
    const t = typeof params?.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.floor(params.timeoutMs)
      : 60_000
    return Math.min(BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000, Math.max(TOOL_EXECUTION_TIMEOUT_MS, t + 5_000))
  }
  return TOOL_EXECUTION_TIMEOUT_MS
}`,
  },
  {
    name: "browser_download path sandbox gate",
    unless: "browser_download.path_escape",
    find: `    // L2 confirmation gate (evaluate / osascript_eval / host_read). Each of
    // these tools reaches host-side or browser-DOM state that requires explicit
    // user approval. NOTE: host_read is the first tool in this gate that reads
    // host-side USER DATA (Mail inbox) rather than browser-DOM or fixed`,
    replace: `    // P1.0 browser_download: path sandbox + worker path policy BEFORE extension dispatch.
    // auto_approve_dangerous must NOT relax this (roots stay Downloads-only). No L2 for default Downloads.
    if (toolName === "browser_download") {
      let isWorker = false
      if (actingThreadId && threadManager) {
        try {
          const th = threadManager.get(actingThreadId) as any
          isWorker = th?.agent_role === "worker"
        } catch { /* ignore */ }
      }
      const prepared = prepareBrowserDownloadParams({ params: finalParams, isWorker })
      if (!prepared.ok) {
        const result = {
          success: false,
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
        return result
      }
      finalParams = prepared.params
      logger.info("browser_download.start", {
        tool_call_id: toolCallId,
        tabId: finalParams.tabId,
        path_root: prepared.downloadPath,
        has_text: !!finalParams.text,
        has_selector: !!finalParams.selector,
        is_worker: isWorker,
      })
    }

    // L2 confirmation gate (evaluate / osascript_eval / host_read). Each of
    // these tools reaches host-side or browser-DOM state that requires explicit
    // user approval. NOTE: host_read is the first tool in this gate that reads
    // host-side USER DATA (Mail inbox) rather than browser-DOM or fixed`,
  },
  {
    name: "per-tool dispatch timeout",
    unless: "dispatchTimeoutMs",
    find: `      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: \`Tool execution timeout (\${TOOL_EXECUTION_TIMEOUT_MS}ms): \${toolName}\` }
        logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: TOOL_EXECUTION_TIMEOUT_MS })
        finishAndResolve(result)
      }, TOOL_EXECUTION_TIMEOUT_MS)

      pendingToolCalls.set(toolCallId, {
        resolve: finishAndResolve,
        reject,
        timer,
        thread_id: actingThreadId,
        tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
        tool_name: toolName,
      })`,
    replace: `      const dispatchTimeoutMs = resolveToolDispatchTimeoutMs(toolName, finalParams)
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: \`Tool execution timeout (\${dispatchTimeoutMs}ms): \${toolName}\` }
        logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: dispatchTimeoutMs })
        finishAndResolve(result)
      }, dispatchTimeoutMs)

      pendingToolCalls.set(toolCallId, {
        resolve: finishAndResolve,
        reject,
        timer,
        thread_id: actingThreadId,
        tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
        tool_name: toolName,
      })`,
  },
])

// --- browser-bridge.ts ---
{
  const bb = path.join(root, "chrome-extension/src/background/browser-bridge.ts")
  let s = fs.readFileSync(bb, "utf8")
  if (!s.includes("runBrowserDownload")) {
    s = s.replace(
      `import { TabQueue, coerceTabId } from "./tab-queue"\n\n// Re-export for callers / tests that import from browser-bridge.\nexport { selectorJsLiteral } from "./selector-js-literal"\nexport { TabQueue, coerceTabId } from "./tab-queue"`,
      `import { TabQueue, coerceTabId } from "./tab-queue"\nimport { runBrowserDownload } from "./browser-download-handler"\nimport { runWithDownloadBusyBeforeQueue } from "./download-busy-entry"\n\n// Re-export for callers / tests that import from browser-bridge.\nexport { selectorJsLiteral } from "./selector-js-literal"\nexport { TabQueue, coerceTabId } from "./tab-queue"\nexport { buildFindByTextExpression } from "./find-element-by-text"\nexport { runWithDownloadBusyBeforeQueue, isBrowserDownloadToolName } from "./download-busy-entry"`,
    )
    console.log("ok: browser-bridge imports")
  } else if (!s.includes("runWithDownloadBusyBeforeQueue")) {
    s = s.replace(
      `import { runBrowserDownload } from "./browser-download-handler"`,
      `import { runBrowserDownload } from "./browser-download-handler"\nimport { runWithDownloadBusyBeforeQueue } from "./download-busy-entry"`,
    )
    if (!s.includes("isBrowserDownloadToolName")) {
      s = s.replace(
        `export { buildFindByTextExpression } from "./find-element-by-text"`,
        `export { buildFindByTextExpression } from "./find-element-by-text"\nexport { runWithDownloadBusyBeforeQueue, isBrowserDownloadToolName } from "./download-busy-entry"`,
      )
    }
    console.log("ok: browser-bridge download-busy-entry import")
  } else {
    console.log("skip: browser-bridge imports")
  }
  if (!s.includes("downloadBusyTabs")) {
    s = s.replace(
      `export class BrowserBridge {\n  private attachedTabs: Set<number> = new Set()\n  private sanitizer: PageSanitizer\n  /** ADR-015 defense-in-depth: serialize concurrent ops per tabId (see tab-queue.ts). */\n  private tabQueue = new TabQueue()`,
      `export class BrowserBridge {\n  private attachedTabs: Set<number> = new Set()\n  private sanitizer: PageSanitizer\n  /** ADR-015 defense-in-depth: serialize concurrent ops per tabId (see tab-queue.ts). */\n  private tabQueue = new TabQueue()\n  /** D13: same-tab browser_download mutual exclusion (reject, do not queue). */\n  downloadBusyTabs: Set<number> = new Set()`,
    )
    console.log("ok: downloadBusyTabs")
  }
  // Round 3: prefer extracted helper (unit-tested production entry). Skip if already wired.
  if (!s.includes("runWithDownloadBusyBeforeQueue({")) {
    // Upgrade from plain TabQueue execute OR from inline D13 body.
    const plainExecute = `  async execute(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    const tabId = coerceTabId(params?.tabId)
    return this.tabQueue.run(tabId, () => this.executeInner(toolName, params))
  }`
    const helperExecute = `  async execute(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    const tabId = coerceTabId(params?.tabId)
    // D13 / BD-D13: production busy-before-TabQueue lives in runWithDownloadBusyBeforeQueue
    // (unit-tested). Concurrent same-tab browser_download rejects DOWNLOAD_BUSY, not queue.
    return runWithDownloadBusyBeforeQueue({
      toolName,
      params,
      tabId,
      downloadBusyTabs: this.downloadBusyTabs,
      tabQueueRun: (id, fn) => this.tabQueue.run(id, fn),
      executeInner: (name, p) => this.executeInner(name, p),
    })
  }`
    if (s.includes(plainExecute)) {
      s = s.replace(plainExecute, helperExecute)
      console.log("ok: D13 busy-before-queue via runWithDownloadBusyBeforeQueue")
    } else if (s.includes("__downloadBusyPreAcquired") && s.includes("isBrowserDownload")) {
      // Inline D13 present — replace whole execute method body with helper call.
      s = s.replace(
        /  async execute\(toolName: string, params: Record<string, any>\): Promise<ToolResult> \{[\s\S]*?\n    return this\.tabQueue\.run\(tabId, \(\) => this\.executeInner\(toolName, params\)\)\n  \}/,
        helperExecute,
      )
      console.log("ok: D13 upgraded inline → runWithDownloadBusyBeforeQueue")
    } else {
      console.log("warn: could not wire D13 execute (manual check needed)")
    }
  } else {
    console.log("skip: D13 runWithDownloadBusyBeforeQueue already wired")
  }
  if (!s.includes('case "browser_download"')) {
    s = s.replace(
      `        case "download":\n          return await this.download(params)`,
      `        case "browser_download":\n        case "download": // alias → browser_download (D18)\n          return await this.browserDownload(params)`,
    )
    console.log("ok: browser_download case")
  }
  if (!s.includes("private async browserDownload")) {
    s = s.replace(
      `  private async download(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    await this.sendCdp(tabId, "Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: params.downloadPath || "",
    })
    return { success: true }
  }`,
      `  private async browserDownload(params: Record<string, any>): Promise<ToolResult> {
    return runBrowserDownload(this as any, params)
  }

  /** @deprecated D18 — use browser_download */
  private async download(params: Record<string, any>): Promise<ToolResult> {
    return this.browserDownload(params)
  }`,
    )
    console.log("ok: browserDownload method")
  }
  // Make getTabId/sendCdp/scriptingExecute/click accessible (private → package for handler)
  // Handler uses bridge as any; private methods are still callable from same class methods.
  fs.writeFileSync(bb, s)
}

// --- package.json downloads ---
{
  const pj = path.join(root, "chrome-extension/package.json")
  const j = JSON.parse(fs.readFileSync(pj, "utf8"))
  if (!j.manifest.permissions.includes("downloads")) {
    j.manifest.permissions.push("downloads")
    fs.writeFileSync(pj, JSON.stringify(j, null, 2) + "\n")
    console.log("ok: +downloads permission")
  } else {
    console.log("skip: downloads permission")
  }
}

console.log("apply-browser-download-p10 done")
