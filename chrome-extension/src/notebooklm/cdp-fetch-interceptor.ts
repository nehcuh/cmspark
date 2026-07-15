// CDP `Fetch` interception PoC (Phase G / v1.2 — EXPERIMENTAL, off by default).
//
// Market-differentiator: existing NotebookLM extensions (jetpack, Web Importer)
// can only inject a `window.fetch` wrapper from a content script, which SPA code
// can re-unwrap. CMspark controls Chrome via `chrome.debugger`, so we can intercept
// at the CDP layer (`Fetch.enable` + `Fetch.requestPaused`) — bulletproof against
// SPA monkey-patching.
//
// This PoC captures the FIRST `batchexecute` AddSource request as the "priming"
// shape, then replays it with substituted URLs. Off by default; not wired into UI.
//
// **Phase 5 review known issues**:
//   - Replay body uses cached CSRF (SNlM0e) which rotates ~30min; replay will 403
//     silently after rotation. Caller MUST catch 403 and re-prime.
//   - Replay substitution is naive (first quoted URL → new URL); multi-URL
//     batchexecute payloads will corrupt. Validate before production use.
//   - Yellow "正在调试" banner shown on the NotebookLM tab during attach.
//
// Status: PoC only — DO NOT wire into UI without addressing the above + writing
// runtime tests against real NotebookLM traffic.

import type { ImportItem } from "./types"

const ADD_SOURCE_PATTERN = /AddSource|CreateSource|notebook.*source/i
const URL_IN_BODY_PATTERN = /"(https?:\/\/[^"]+)"/

/** One captured priming request. */
interface PrimingShape {
  url: string
  method: string
  headers: Record<string, string>
  bodyTemplate: string
  capturedAt: number
}

let cachedShape: PrimingShape | null = null
let attachedTabId: number | null = null

/** Phase 5 review fix: lifecycle cleanup. Registered once at module load.
 *  Clears attachedTabId on detach (user manually closed banner / tab crashed). */
let lifecycleWired = false
function wireLifecycle() {
  if (lifecycleWired) return
  lifecycleWired = true
  try {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId === attachedTabId) {
        attachedTabId = null
        // Don't clear cachedShape — the priming info is still valid until CSRF rotates
      }
    })
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === attachedTabId) {
        attachedTabId = null
        // Tab closed mid-prime — shape may be invalid; clear it
        cachedShape = null
      }
    })
  } catch {
    // SW restart may run this before chrome.debugger is ready; safe to skip
  }
}

/** Attach to a NotebookLM tab and capture the next AddSource request as the priming
 *  shape. Resolves once captured (or rejects on timeout). */
export async function primeInterception(tabId: number, timeoutMs = 60_000): Promise<PrimingShape | null> {
  wireLifecycle()
  // Detach any previous attach
  if (attachedTabId && attachedTabId !== tabId) {
    try {
      await chrome.debugger.detach({ tabId: attachedTabId })
    } catch {
      // ignore
    }
    attachedTabId = null
  }

  await chrome.debugger.attach({ tabId }, "1.3")
  attachedTabId = tabId
  // Enable Fetch domain; only intercept POSTs to batchexecute
  await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
    patterns: [
      { urlPattern: "*://notebooklm.google.com/*/data/batchexecute*", requestStage: "Request" },
    ],
  })

  // Phase 5 review fix: register listener BEFORE Fetch.enable completes would race,
  // but we registered AFTER. To close the race, we accept that the first request
  // after enable() may be paused with no handler — Fetch.requestPaused will queue
  // in the CDP layer for ~30s before timing out. For a priming flow this is fine
  // because the user is initiating the first add manually.

  return new Promise<PrimingShape | null>((resolve) => {
    let settled = false
    const finish = (result: PrimingShape | null) => {
      if (settled) return
      settled = true
      ;(chrome.debugger as any).onMessage.removeListener(listener)
      clearTimeout(timer)
      resolve(result)
    }

    const listener = async (source: chrome.debugger.Debuggee, method: string, params: any) => {
      if (source.tabId !== tabId) return
      if (method !== "Fetch.requestPaused") return
      const req = params?.request
      if (!req || req.method !== "POST") {
        try {
          await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId })
        } catch {
          // ignore
        }
        return
      }
      const bodyStr = typeof req.postData === "string" ? req.postData : ""
      const looksLikeAddSource = ADD_SOURCE_PATTERN.test(req.url) || ADD_SOURCE_PATTERN.test(bodyStr)
      const hasUrlInBody = URL_IN_BODY_PATTERN.test(bodyStr)

      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId })
      } catch {
        // ignore
      }

      if (looksLikeAddSource && hasUrlInBody) {
        const shape: PrimingShape = {
          url: req.url,
          method: req.method,
          headers: (req.headers || {}) as Record<string, string>,
          bodyTemplate: bodyStr,
          capturedAt: Date.now(),
        }
        cachedShape = shape
        finish(shape)
      }
    }

    ;(chrome.debugger as any).onMessage.addListener(listener)
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}

/** Replay the captured priming shape with a new URL substituted into the body.
 *
 *  **Caller MUST handle 403**: CSRF rotates ~30 min; replay after rotation will
 *  fail. The caller should detect 403 and re-call primeInterception. */
export async function replayImport(item: ImportItem): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!cachedShape) return { ok: false, error: "No priming shape captured — call primeInterception first" }
  if (!item.url) return { ok: false, error: "Replay supports URL items only" }

  // Substitute the URL in the body (first quoted URL → new URL)
  const body = cachedShape.bodyTemplate.replace(URL_IN_BODY_PATTERN, `"${item.url}"`)

  try {
    const resp = await fetch(cachedShape.url, {
      method: cachedShape.method,
      headers: cachedShape.headers,
      body,
      credentials: "include",
    })
    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 401) {
        cachedShape = null // CSRF rotated — force re-prime on next call
      }
      return { ok: false, status: resp.status, error: `Replay HTTP ${resp.status}` }
    }
    return { ok: true, status: resp.status }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Detach the debugger if attached. Safe to call multiple times. */
export async function detachIfAttached(): Promise<void> {
  if (attachedTabId == null) return
  try {
    await chrome.debugger.detach({ tabId: attachedTabId })
  } catch {
    // ignore
  }
  attachedTabId = null
}

/** Is the interceptor currently primed? */
export function isPrimed(): boolean {
  return cachedShape !== null
}

/** Forget the priming shape (e.g., when NotebookLM session changes). */
export function clearPriming(): void {
  cachedShape = null
}
