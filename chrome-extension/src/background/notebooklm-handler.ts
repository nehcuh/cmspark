// Orchestrator: extract current tab content + format as Markdown for NotebookLM.
//
// v1 architecture decision (Round 2 synthesis): entirely extension-side, no companion
// round-trip. Uses `chrome.scripting.executeScript` (not CDP) to avoid the debugger
// yellow banner and the attach/detach lifecycle. The runner lives in notebooklm/extractor.ts
// and is serialized via .toString() — chrome.scripting handles arg passing.

import {
  EXTRACTOR_SELECTORS,
  MAX_TEXT_LENGTH,
  extractPageContentRunner,
  type ExtractResult,
} from "../notebooklm/extractor"
import { buildMarkdown } from "../notebooklm/markdown-builder"

export interface NotebooklmExportResponse {
  ok: boolean
  content?: string
  filename?: string
  truncated?: boolean
  error?: string
}

export async function handleNotebooklmExport(): Promise<NotebooklmExportResponse> {
  let tabId: number | undefined
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!activeTab?.id) {
      return { ok: false, error: "No active tab found" }
    }
    tabId = activeTab.id

    const url = activeTab.url || ""
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, error: `NotebookLM import needs an http(s) page (current: ${url || "empty"})` }
    }

    // Inject + run. `func` is serialized; args are passed via `args`.
    // The runner is self-contained (no closure over extension state).
    //
    // chrome.scripting sets `results[0].error` (not `result`) when the injected function
    // throws — silently dropping it would mask real failures (strict CSP, detached DOM,
    // malformed args) as "empty page" (Round 2 review catch).
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageContentRunner,
      args: [MAX_TEXT_LENGTH, JSON.stringify(EXTRACTOR_SELECTORS)],
    })

    const frame = results?.[0] as
      | (chrome.scripting.InjectionResult<ExtractResult> & { error?: string })
      | undefined
    if (frame?.error) {
      return { ok: false, error: `Page-side extraction failed: ${frame.error}` }
    }

    const result = frame?.result
    if (!result || typeof result.text !== "string") {
      return { ok: false, error: "Extraction returned no content (the page may be empty or behind a paywall)" }
    }
    if (result.text.trim().length === 0) {
      return { ok: false, error: "Extraction returned empty text (canvas-only / paywall / Shadow DOM root)" }
    }

    const md = buildMarkdown({
      title: result.title || activeTab.title || "Untitled",
      url: result.url || url,
      text: result.text,
      extractedAt: new Date(),
    })

    return {
      ok: true,
      content: md.content,
      filename: md.filename,
      truncated: !!result.truncated,
    }
  } catch (e: any) {
    return { ok: false, error: `NotebookLM export failed${tabId !== undefined ? ` (tab ${tabId})` : ""}: ${e?.message || String(e)}` }
  }
}
