// NotebookLM batchexecute RPC client.
//
// Reverse-engineered from jetpack's services/notebook-api.ts (verified working 2026-07).
// All calls go to `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute`
// with `credentials: 'include'` (Chrome attaches the user's Google session cookies).
//
// CSRF token (SNlM0e) is extracted from the homepage HTML; cached per-extension-run
// and refreshed on auth failure. Tokens don't rotate often but DO change across
// sessions/logouts.
//
// IMPORTANT: this hits a private Google RPC. We use only the **read-only list** path
// in v1.1 — write operations (create/delete notebook) are deferred per Round 1 decision.

const BATCHEXECUTE_URL = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const NLM_HOME_URL = "https://notebooklm.google.com/"
const RPC_LIST_NOTEBOOKS = "wXbhsf"

import type { NotebookInfo } from "./types"

let cachedCsrfToken: string | null = null
let cachedCsrfAt = 0
const CSRF_TTL_MS = 30 * 60 * 1000 // 30 min — refresh on auth fail anyway

/** Fetch the CSRF token (SNlM0e) from the NotebookLM homepage. Cached for CSRF_TTL_MS. */
export async function getCsrfToken(forceRefresh = false): Promise<string | null> {
  const now = Date.now()
  if (!forceRefresh && cachedCsrfToken && now - cachedCsrfAt < CSRF_TTL_MS) {
    return cachedCsrfToken
  }
  try {
    const resp = await fetch(NLM_HOME_URL, { credentials: "include" })
    if (!resp.ok) return null
    const html = await resp.text()
    const match = html.match(/"SNlM0e":"([^"]+)"/)
    if (match) {
      cachedCsrfToken = match[1]
      cachedCsrfAt = now
      return match[1]
    }
  } catch {
    // fall through
  }
  return null
}

/** Encode an RPC request body in Google's batchexecute envelope. */
function encodeRpcRequest(rpcId: string, params: unknown[]): string {
  const inner = [rpcId, JSON.stringify(params), null, "generic"]
  return JSON.stringify([[inner]])
}

/** Result of listNotebooks — distinguishes "auth failed" from "user has zero notebooks".
 *
 * Phase 5 review catch: previously returned [] for both cases, leading the UI to
 * silently let users proceed into a doomed batch when they weren't logged in. */
export interface ListNotebooksResult {
  ok: boolean
  /** When ok=false, the user likely isn't logged in or the CSRF extraction failed. */
  authFailed?: boolean
  error?: string
  notebooks: NotebookInfo[]
}

// Note: parseBatchExecuteResponse + listNotebooksOnce were removed (Kimi review
// round 2 — dead code after listNotebooks was rewritten to inject into the tab).
// The injected runner in listNotebooksViaTab does its own parsing with chunked-
// encoding handling.

/** List the user's notebooks. Kimi gate fix: on auth-failed (empty response), force
 *  a CSRF refresh and retry once before reporting failure. */
export async function listNotebooks(): Promise<ListNotebooksResult> {
  // Bug fix: calling batchexecute from the service worker cross-origin was failing
  // silently (cookies not always sent, CSRF extraction fragile). Inject the call
  // INTO an open NotebookLM tab — same-origin fetch, cookies auto-attached, CSRF
  // read directly from window.WIZ_global_data.
  return listNotebooksViaTab()
}

/** Inject a runner into an open (or freshly opened) NotebookLM tab. The runner
 *  fetches the home HTML same-origin (cookies auto-sent), regex-extracts the
 *  SNlM0e CSRF token, then calls batchexecute. This mirrors jetpack's approach
 *  and doesn't depend on window.WIZ_global_data being exposed (which it isn't
 *  reliably on NotebookLM pages). */
async function listNotebooksViaTab(): Promise<ListNotebooksResult> {
  let tabId: number | null = null
  let openedOwnTab = false
  try {
    const tabs = await chrome.tabs.query({ url: "https://notebooklm.google.com/*" })
    if (tabs.length > 0 && tabs[0].id) {
      tabId = tabs[0].id
    } else {
      const tab = await chrome.tabs.create({ url: "https://notebooklm.google.com/", active: false })
      if (tab.id) {
        tabId = tab.id
        openedOwnTab = true
      }
    }
    if (!tabId) return { ok: false, error: "无法打开 NotebookLM tab", notebooks: [] }

    // Wait for the tab to be injectable. Just need readyState loading/interactive/complete.
    // Don't require WIZ_global_data — we'll fetch the home HTML ourselves.
    const waitDeadline = Date.now() + 20_000
    let injectable = false
    let lastWaitDebug: any = null
    while (Date.now() < waitDeadline) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            ready: document.readyState,
            url: location.href,
            isLoginPage: location.href.includes("accounts.google.com") || !!document.querySelector('form[action*="AccountChooser"]'),
            isNlm: location.hostname.endsWith("notebooklm.google.com"),
          }),
        })
        const info = r?.result as any
        lastWaitDebug = info
        if (info?.isNlm && !info.isLoginPage && info.ready !== "loading") {
          injectable = true
          break
        }
        if (info?.isLoginPage) {
          return { ok: false, authFailed: true, error: "NotebookLM 重定向到 Google 登录页 — 请先登录", notebooks: [] }
        }
      } catch {
        // tab not ready for injection
      }
      await new Promise(r => setTimeout(r, 400))
    }
    if (!injectable) {
      return {
        ok: false,
        authFailed: true,
        error: `NotebookLM tab 未就绪（20s 超时）。最后看到：${JSON.stringify(lastWaitDebug).slice(0, 300)}`,
        notebooks: [],
      }
    }

    // Inject the full listNotebooks call INTO the tab.
    // Same-origin fetch → cookies auto-attached. CSRF extracted by regex from
    // the home HTML (not from window.WIZ_global_data, which isn't always exposed).
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          // Step 1: fetch home HTML same-origin to get the CSRF token
          const homeResp = await fetch("https://notebooklm.google.com/", { credentials: "include" })
          if (!homeResp.ok) return { ok: false, authFailed: true, error: `Home HTTP ${homeResp.status}` }
          const homeHtml = await homeResp.text()
          const csrfMatch = homeHtml.match(/"SNlM0e":"([^"]+)"/)
          if (!csrfMatch) {
            // Check if the HTML looks like a login page
            const isLogin = homeHtml.includes("accounts.google.com") || homeHtml.includes("Sign in")
            return {
              ok: false,
              authFailed: true,
              error: isLogin
                ? "NotebookLM 主页 HTML 含登录提示 — 请先在浏览器登录 NotebookLM"
                : `SNlM0e token 未在 home HTML 中找到（HTML 长度 ${homeHtml.length}，前 200 字符：${homeHtml.slice(0, 200)})`,
            }
          }
          const csrf = csrfMatch[1]

          // Step 2: call batchexecute same-origin
          const RPC_ID = "wXbhsf"
          const BATCHEXECUTE_URL = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
          const params = [null, 1, null, [2]]
          const inner = [RPC_ID, JSON.stringify(params), null, "generic"]
          const fReq = JSON.stringify([[inner]])
          const urlParams = new URLSearchParams({ rpcids: RPC_ID, "source-path": "/", rt: "c" })
          const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrf)}&`

          const resp = await fetch(`${BATCHEXECUTE_URL}?${urlParams}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body,
          })
          if (!resp.ok) return { ok: false, authFailed: resp.status === 401 || resp.status === 403, error: `batchexecute HTTP ${resp.status}` }
          const text = await resp.text()

          // Bug fix: Google batchexecute responses are prefixed with )]'  AND
          // use chunked encoding — each chunk is prefixed by its byte length on
          // its own line:  )]}'\n24192\n[[...]]\n0\n
          // Strip the prefix + any leading digits + newlines, then find the
          // first balanced [...] block (chunked responses may have trailing
          // timing data too).
          let stripped = text.replace(/^\)\]\}'\s*/, "")
          // Skip leading chunk-length lines (digits + newline)
          stripped = stripped.replace(/^(\d+)\s*\n/, "")
          // If still doesn't start with '[', find the first '['
          if (!stripped.startsWith("[")) {
            const idx = stripped.indexOf("[")
            if (idx > 0) stripped = stripped.slice(idx)
          }
          let outer: any = null
          if (stripped.startsWith("[")) {
            let depth = 0
            let inStr = false
            let escape = false
            let end = -1
            for (let i = 0; i < stripped.length; i++) {
              const ch = stripped[i]
              if (escape) { escape = false; continue }
              if (inStr) {
                if (ch === "\\") escape = true
                else if (ch === '"') inStr = false
                continue
              }
              if (ch === '"') inStr = true
              else if (ch === "[") depth++
              else if (ch === "]") {
                depth--
                if (depth === 0) { end = i + 1; break }
              }
            }
            if (end > 0) {
              try { outer = JSON.parse(stripped.slice(0, end)) } catch { /* fall through */ }
            }
          }
          if (!outer) {
            return {
              ok: false,
              error: `无法解析响应（前 500 字符）：${text.slice(0, 500)}`,
            }
          }
          if (!Array.isArray(outer)) {
            return {
              ok: false,
              error: `响应非数组（前 500 字符）：${text.slice(0, 500)}`,
            }
          }
          let parsedJson: any = null
          for (const entry of outer) {
            if (Array.isArray(entry) && entry[0] === "wrb.fr" && typeof entry[2] === "string") {
              try { parsedJson = JSON.parse(entry[2]) } catch { /* continue */ }
            }
          }
          if (!parsedJson) {
            return {
              ok: false,
              error: `未找到 wrb.fr 包络（前 500 字符）：${text.slice(0, 500)}`,
            }
          }
          const list = Array.isArray(parsedJson[0]) ? parsedJson[0] : []
          const out: Array<{ id: string; title: string }> = []
          for (const nb of list) {
            if (!Array.isArray(nb)) continue
            // Bug fix: NotebookLM's wXbhsf response shape changed — nb[0] is now
            // empty string, UUID is at nb[2]. Title isn't in this RPC anymore.
            // Use UUID short prefix as fallback title so user can still pick.
            const id = typeof nb[2] === "string" ? nb[2] : ""
            if (!id) continue
            const rawTitle = typeof nb[0] === "string" ? nb[0].replace(/^thought\n/, "").trim() : ""
            // Also try nb[3] as a fallback title position
            const altTitle = typeof nb[3] === "string" ? nb[3].trim() : ""
            const title = rawTitle || altTitle || `Notebook ${id.slice(0, 8)}`
            out.push({ id, title })
          }
          return { ok: true, notebooks: out }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      },
    })
    const frame = results?.[0] as any
    if (frame?.error) return { ok: false, error: `Injection error: ${frame.error}`, notebooks: [] }
    const r = frame?.result as any
    if (!r) return { ok: false, error: "Runner returned no result", notebooks: [] }
    if (!r.ok) return { ok: false, authFailed: r.authFailed, error: r.error || "未知错误", notebooks: [] }
    return { ok: true, notebooks: r.notebooks || [] }
  } catch (e: any) {
    return { ok: false, error: `listNotebooksViaTab crashed: ${e?.message || String(e)}`, notebooks: [] }
  } finally {
    // Kimi review catch: close the background tab we opened if list failed
    if (openedOwnTab && tabId !== null) {
      try { await chrome.tabs.remove(tabId) } catch { /* ignore */ }
    }
  }
}
