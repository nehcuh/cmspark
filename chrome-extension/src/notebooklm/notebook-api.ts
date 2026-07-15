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

/** Strip the `)]}'` XSSI prefix and parse the batchexecute response envelope. */
function parseBatchExecuteResponse(text: string): any[] {
  // Response shape: )]}'  [["wrb.fr","<rpcId>","<json-string>",null,null,null,"generic"],...] [ticks]
  const stripped = text.replace(/^\)\]\}'\s*\n?/, "")
  let outer: any
  try {
    outer = JSON.parse(stripped)
  } catch {
    return []
  }
  if (!Array.isArray(outer)) return []
  // Find the wrb.fr envelope for our RPC
  for (const entry of outer) {
    if (Array.isArray(entry) && entry[0] === "wrb.fr" && typeof entry[2] === "string") {
      try {
        return JSON.parse(entry[2])
      } catch {
        // continue
      }
    }
  }
  return []
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

/** Internal: actually call the batchexecute endpoint. */
async function listNotebooksOnce(): Promise<ListNotebooksResult> {
  const csrf = await getCsrfToken()
  if (!csrf) {
    return { ok: false, authFailed: true, error: "未登录 NotebookLM 或主页未返回 SNlM0e token", notebooks: [] }
  }

  const params = [null, 1, null, [2]]
  const fReq = encodeRpcRequest(RPC_LIST_NOTEBOOKS, params)
  const urlParams = new URLSearchParams({
    rpcids: RPC_LIST_NOTEBOOKS,
    "source-path": "/",
    rt: "c",
  })
  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrf)}&`

  try {
    const resp = await fetch(`${BATCHEXECUTE_URL}?${urlParams}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        cachedCsrfToken = null
        return { ok: false, authFailed: true, error: `HTTP ${resp.status}: 认证失败，请重新登录 NotebookLM`, notebooks: [] }
      }
      return { ok: false, error: `HTTP ${resp.status}`, notebooks: [] }
    }
    const text = await resp.text()
    const parsed = parseBatchExecuteResponse(text)
    if (!parsed || !Array.isArray(parsed)) {
      // Empty envelope — CSRF likely stale. Signal authFailed so caller can retry.
      cachedCsrfToken = null
      return { ok: false, authFailed: true, error: "NotebookLM 返回空响应（CSRF 可能已失效）", notebooks: [] }
    }
    const list = Array.isArray(parsed[0]) ? parsed[0] : []
    const out: NotebookInfo[] = []
    for (const nb of list) {
      if (!Array.isArray(nb)) continue
      const title = typeof nb[0] === "string" ? nb[0].replace(/^thought\n/, "").trim() : undefined
      const id = typeof nb[2] === "string" ? nb[2] : undefined
      if (title && id) {
        out.push({ id, title })
      }
    }
    return { ok: true, notebooks: out }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), notebooks: [] }
  }
}

/** List the user's notebooks. Kimi gate fix: on auth-failed (empty response), force
 *  a CSRF refresh and retry once before reporting failure. */
export async function listNotebooks(): Promise<ListNotebooksResult> {
  const first = await listNotebooksOnce()
  if (first.ok) return first
  // Auth-failed could be a stale CSRF — force refresh and retry once
  if (first.authFailed) {
    await getCsrfToken(true)
    const retry = await listNotebooksOnce()
    if (retry.ok) return retry
    return retry.authFailed ? retry : first
  }
  return first
}
