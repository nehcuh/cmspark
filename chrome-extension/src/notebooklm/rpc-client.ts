// NotebookLM batchexecute RPC client (v1.3 — RPC-first architecture).
//
// Replaces the fragile DOM-automation approach. RPC calls give definitive
// success/failure (response contains source ID or error code), no UI selector
// drift, no Angular timing races.
//
// All calls run INSIDE a NotebookLM tab (same-origin → cookies auto-attached).
// CSRF (SNlM0e) extracted from home HTML via regex.
//
// RPC IDs + param structures verified from teng-lin/notebooklm-py source
// (rpc/types.py:74-112, _notebooks.py, _source/add.py, _source/upload_payloads.py).

export const RPC = {
  LIST_NOTEBOOKS: "wXbhsf",
  CREATE_NOTEBOOK: "CCqFvf",
  GET_NOTEBOOK: "rLM1Ne",
  RENAME_NOTEBOOK: "s0tc2d",
  DELETE_NOTEBOOK: "WWINqb",
  ADD_SOURCE: "izAoDd",
  ADD_SOURCE_FILE: "o4cbdc",
  UPDATE_SOURCE: "b7Wfje",
  DELETE_SOURCE: "tGMBJ",
} as const

const BATCHEXECUTE_URL = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"
const HOME_URL = "https://notebooklm.google.com/"

/** Shared template block (Gemini-3.5 wire migration #1546).
 *  Migrated backends reject the old flat [2],[1] tail. */
export function buildTemplateBlock(): any[] {
  return [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
}

// ----------------------- param builders -----------------------

export function buildCreateNotebookParams(title: string): any[] {
  return [title, null, null, buildTemplateBlock()]
}

export function buildRenameNotebookParams(notebookId: string, newTitle: string): any[] {
  return [notebookId, [[null, null, null, [null, newTitle]]]]
}

export function buildGetNotebookParams(notebookId: string): any[] {
  return [notebookId, null, buildTemplateBlock(), null, 0]
}

export function buildListNotebooksParams(): any[] {
  // Old flat tail — list RPC didn't migrate yet per notebooklm-py
  return [null, 1, null, [2]]
}

export function buildAddUrlSourceParams(notebookId: string, url: string): any[] {
  return [
    [[null, null, [url], null, null, null, null, null, null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}

export function buildAddYoutubeSourceParams(notebookId: string, url: string): any[] {
  return [
    [[null, null, null, null, null, null, null, [url], null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}

export function buildAddTextSourceParams(notebookId: string, title: string, content: string): any[] {
  return [
    [[null, [title, content], null, 2, null, null, null, null, null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}

// ----------------------- self-contained runner (injected) -----------------------

/** Detect if a URL is a YouTube video URL. */
export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return (
      host === "youtube.com" || host === "www.youtube.com" ||
      host === "m.youtube.com" || host === "music.youtube.com" ||
      host === "youtu.be"
    )
  } catch {
    return false
  }
}

/** Normalize a YouTube URL — strip playlist/feature params, keep only the video ID.
 *  NotebookLM's backend rejects YouTube URLs with extra query params (status [5] = NOT_FOUND).
 *  notebooklm-py passes raw URLs but real-world testing shows playlist params break it. */
export function normalizeYouTubeUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    let videoId: string | null = null

    if (host === "youtu.be") {
      videoId = u.pathname.slice(1).split("/")[0] || null
    } else {
      // watch?v=VIDEO_ID
      videoId = u.searchParams.get("v")
      // youtu.be/VIDEO_ID, youtube.com/shorts/VIDEO_ID, /embed/VIDEO_ID
      if (!videoId) {
        const parts = u.pathname.split("/").filter(Boolean)
        const prefixes = ["shorts", "embed", "live", "v"]
        if (parts.length >= 2 && prefixes.includes(parts[0].toLowerCase())) {
          videoId = parts[1]
        }
      }
    }

    if (videoId && /^[a-zA-Z0-9_-]+$/.test(videoId)) {
      return `https://www.youtube.com/watch?v=${videoId}`
    }
    // If we can't extract a video ID, return original (might fail but at least try)
    return url
  } catch {
    return url
  }
}

/** Self-contained runner injected into a NotebookLM tab. Performs the full RPC
 *  flow: CSRF extract → batchexecute → response parse. Returns the new source ID
 *  on success.
 *
 *  **CRITICAL**: This function MUST be fully self-contained — no references to
 *  module-level constants. Plasmo's minifier renames module consts to short
 *  names (e.g., `i`), but chrome.scripting.executeScript({func}) serializes the
 *  function via toString() and runs it in the page context where the module
 *  scope is lost. Referencing a module-level const → "i is not defined".
 *
 *  args: [rpcId, paramsJSON, sourcePath] */
export function rpcCallRunner(
  rpcId: string,
  paramsJSON: string,
  sourcePath: string,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  // URLs inlined directly — DO NOT reference module-level HOME_URL / BATCHEXECUTE_URL
  const _HOME_URL = "https://notebooklm.google.com/"
  const _BATCHEXECUTE_URL = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute"

  return (async () => {
    try {
      // Step 1: fetch home HTML to extract CSRF (SNlM0e)
      const homeResp = await fetch(_HOME_URL, { credentials: "include" })
      if (!homeResp.ok) return { ok: false, error: `Home HTTP ${homeResp.status}` }
      const homeHtml = await homeResp.text()
      const csrfMatch = homeHtml.match(/"SNlM0e":"([^"]+)"/)
      if (!csrfMatch) {
        const isLogin = homeHtml.includes("accounts.google.com") || homeHtml.includes("Sign in")
        return {
          ok: false,
          error: isLogin ? "未登录 NotebookLM" : `SNlM0e token 未找到 (HTML ${homeHtml.length} bytes)`,
        }
      }
      const csrf = csrfMatch[1]

      // Step 2: parse params
      let params
      try {
        params = JSON.parse(paramsJSON)
      } catch {
        return { ok: false, error: `Invalid paramsJSON: ${paramsJSON.slice(0, 100)}` }
      }

      // Step 3: build f.req
      const inner = [rpcId, JSON.stringify(params), null, "generic"]
      const fReq = JSON.stringify([[inner]])
      const urlParams = new URLSearchParams({ rpcids: rpcId, "source-path": sourcePath, rt: "c" })
      const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrf)}&`

      // Step 4: call batchexecute
      const resp = await fetch(`${_BATCHEXECUTE_URL}?${urlParams}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      })
      if (!resp.ok) {
        return { ok: false, error: `batchexecute HTTP ${resp.status}` }
      }
      const text = await resp.text()

      // Step 5: parse chunked response — strip )]}' prefix + chunk-length line
      let stripped = text.replace(/^\)\]\}'\s*/, "")
      stripped = stripped.replace(/^(\d+)\s*\n/, "")
      if (!stripped.startsWith("[")) {
        const idx = stripped.indexOf("[")
        if (idx > 0) stripped = stripped.slice(idx)
      }

      // Step 6: parse first balanced [...] block
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
        return { ok: false, error: `无法解析响应 (前 200 字符: ${text.slice(0, 200)})` }
      }
      if (!Array.isArray(outer)) {
        return { ok: false, error: `响应非数组` }
      }

      // Step 7: find wrb.fr envelope for our RPC + check for errors
      let parsedJson: any = null
      let statusCode: any = null
      for (const entry of outer) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr") {
          // entry[2] = result JSON string (null on error/backend rejection)
          if (typeof entry[2] === "string") {
            try { parsedJson = JSON.parse(entry[2]) } catch { /* continue */ }
          }
          // entry[5] = status code array (e.g., [5] = NOT_FOUND)
          if (Array.isArray(entry[5])) {
            statusCode = entry[5]
          }
        }
      }

      // If result is null AND there's a non-zero status code, surface the error.
      // Status codes: 0/null=OK, 3=INVALID_ARGUMENT, 5=NOT_FOUND, 7=PERMISSION_DENIED,
      // 8=RESOURCE_EXHAUSTED, 9=FAILED_PRECONDITION, 13=INTERNAL
      const statusNum = Array.isArray(statusCode) ? statusCode[0] : null
      if (parsedJson === null && statusNum !== null && statusNum !== 0) {
        const statusMeaning: Record<number, string> = {
          2: "UNKNOWN",
          3: "INVALID_ARGUMENT (params shape rejected — try cleaning the URL)",
          5: "NOT_FOUND (URL/video/notebook not found — try without playlist params)",
          7: "PERMISSION_DENIED (not your notebook? re-login?)",
          8: "RESOURCE_EXHAUSTED (quota — wait and retry)",
          9: "FAILED_PRECONDITION (backend migration — check params)",
          13: "INTERNAL (NotebookLM server error — retry later)",
        }
        const meaning = statusMeaning[statusNum] || `UNKNOWN_STATUS_${statusNum}`
        return {
          ok: false,
          error: `NotebookLM backend rejected: status [${statusNum}] = ${meaning}`,
        }
      }

      // If parsedJson is null but no error status, it might be a legitimate
      // null-response RPC (like rename). Return ok with null result.
      if (!parsedJson && !statusCode) {
        return {
          ok: false,
          error: `未找到 wrb.fr 有效包络 (前 300 字符: ${text.slice(0, 300)})`,
        }
      }

      return { ok: true, result: parsedJson }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}

// ----------------------- high-level operations (run in BG) -----------------------

/** Ensure a NotebookLM tab exists, return tabId. */
async function ensureTab(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: "https://notebooklm.google.com/*" })
  if (tabs.length > 0 && tabs[0].id) return tabs[0].id
  const tab = await chrome.tabs.create({ url: HOME_URL, active: false })
  if (!tab.id) throw new Error("Failed to open NotebookLM tab")
  // Wait for readyState != loading
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ ready: document.readyState, host: location.hostname }),
      })
      const info = r?.result as any
      if (info?.ready !== "loading" && info?.host?.endsWith("notebooklm.google.com")) return tab.id
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 400))
  }
  return tab.id
}

/** Run an RPC call inside a NotebookLM tab.
 *  Kimi review v1.3 fix: if response contains "HTTP 403" / auth error, retry once
 *  (CSRF may have rotated). */
async function rpcCall(
  rpcId: string,
  params: any[],
  sourcePath: string,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  let tabId: number
  try {
    tabId = await ensureTab()
  } catch (e: any) {
    return { ok: false, error: `ensureTab failed: ${e?.message || e}` }
  }
  const paramsJSON = JSON.stringify(params)

  const callOnce = async (): Promise<{ ok: boolean; result?: any; error?: string }> => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: rpcCallRunner,
        args: [rpcId, paramsJSON, sourcePath],
      })
      const frame = results?.[0] as any
      if (frame?.error) return { ok: false, error: `Injection error: ${frame.error}` }
      return frame?.result as { ok: boolean; result?: any; error?: string }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (msg.includes("Frame with ID") || msg.includes("was removed")) {
        // Wait for tab to stabilize, then bubble — caller can retry
        await new Promise(r => setTimeout(r, 1500))
      }
      return { ok: false, error: `executeScript failed: ${msg}` }
    }
  }

  const first = await callOnce()
  if (first.ok) return first

  // Kimi review v1.3: retry on auth/CSRF failure (403 / 401 / "未登录")
  const looksLikeAuthFail =
    (first.error || "").includes("HTTP 40") ||
    (first.error || "").includes("未登录") ||
    (first.error || "").includes("SNlM0e")
  if (looksLikeAuthFail) {
    await new Promise(r => setTimeout(r, 1000))
    const retry = await callOnce()
    if (retry.ok) return retry
    return retry
  }

  // Retry on frame-removed (race during SPA navigation)
  if ((first.error || "").includes("Frame with ID") || (first.error || "").includes("was removed")) {
    const retry = await callOnce()
    if (retry.ok) return retry
    return retry
  }

  return first
}

/** Create a notebook. Returns { ok, notebookId?, error? }. */
export async function createNotebookViaRpc(
  title: string,
): Promise<{ ok: boolean; notebookId?: string; error?: string }> {
  const r = await rpcCall(RPC.CREATE_NOTEBOOK, buildCreateNotebookParams(title), "/")
  if (!r.ok) return r
  // Response shape: parsedJson contains the new notebook info; the ID is at [0][0]
  // (NotebookLM CreateProject returns [[[id, title, ...]]] shape)
  const result = r.result
  let notebookId: string | undefined
  try {
    // Common shape: result[0] = [[id, ...]], or result = [id, ...]
    if (Array.isArray(result)) {
      const first = result[0]
      if (Array.isArray(first)) {
        if (Array.isArray(first[0])) {
          // nested: result[0][0][0]
          notebookId = typeof first[0][0] === "string" ? first[0][0] : undefined
        } else {
          notebookId = typeof first[0] === "string" ? first[0] : undefined
        }
      } else if (typeof first === "string") {
        notebookId = first
      }
    }
  } catch { /* fall through */ }
  if (!notebookId) {
    return { ok: false, error: `Notebook created but ID not found in response: ${JSON.stringify(result).slice(0, 300)}` }
  }
  return { ok: true, notebookId }
}

/** Rename a notebook. */
export async function renameNotebookViaRpc(
  notebookId: string,
  newTitle: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await rpcCall(
    RPC.RENAME_NOTEBOOK,
    buildRenameNotebookParams(notebookId, newTitle),
    "/",
  )
  return r
}

/** Add a URL or YouTube source. Auto-detects YouTube. Returns the source ID
 *  from the response (verification that the add actually worked).
 *
 *  Kimi review v1.3 catch: previously returned ok:true even when sourceId was
 *  missing — this is exactly the false-positive pattern that plagued v1.1/v1.2.
 *  ADD_SOURCE success MUST return a source ID; null/missing ID = failure. */
export async function addSourceViaRpc(
  notebookId: string,
  url: string,
): Promise<{ ok: boolean; sourceId?: string; error?: string }> {
  const isYt = isYouTubeUrl(url)
  // Bug fix: normalize YouTube URLs — strip playlist/feature params that cause
  // backend NOT_FOUND (status [5]) rejections. Real-world testing showed
  // &list=... params break NotebookLM's YouTube source import.
  const cleanUrl = isYt ? normalizeYouTubeUrl(url) : url
  const params = isYt
    ? buildAddYoutubeSourceParams(notebookId, cleanUrl)
    : buildAddUrlSourceParams(notebookId, cleanUrl)
  const r = await rpcCall(
    RPC.ADD_SOURCE,
    params,
    `/notebook/${notebookId}`,
  )
  if (!r.ok) return r

  const result = r.result

  // Bug fix: check for backend error status codes.
  // Google batchexecute status codes: 3=INVALID_ARGUMENT, 5=NOT_FOUND, 7=PERMISSION_DENIED,
  // 8=RESOURCE_EXHAUSTED (quota), 9=FAILED_PRECONDITION, 13=INTERNAL
  if (result === null) {
    return {
      ok: false,
      error: `NotebookLM rejected the source (result=null). Possible causes: invalid URL, video not found, quota exceeded, or backend rejected the request shape. Try a simpler URL without extra query params.`,
    }
  }

  // Response shape varies — sourceId may be at result[0][0][0] or result[0][0][0][0]
  // (NotebookLM wraps the ID in an extra array). Deep-search for first UUID.
  let sourceId: string | undefined
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const findSourceId = (node: any, depth = 0): string | undefined => {
    if (depth > 5 || !node) return undefined
    if (typeof node === "string" && UUID_RE.test(node)) return node
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findSourceId(child, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }
  try {
    sourceId = findSourceId(result)
  } catch { /* fall through */ }
  // Kimi review v1.3 fix: NO sourceId = failure. Don't paper over with ok:true.
  if (!sourceId) {
    return {
      ok: false,
      error: `ADD_SOURCE returned no source ID. Response head: ${JSON.stringify(result).slice(0, 300)}`,
    }
  }
  return { ok: true, sourceId }
}

/** Add a text source. Kimi review v1.3: same sourceId-required semantics. */
export async function addTextSourceViaRpc(
  notebookId: string,
  title: string,
  content: string,
): Promise<{ ok: boolean; sourceId?: string; error?: string }> {
  const r = await rpcCall(
    RPC.ADD_SOURCE,
    buildAddTextSourceParams(notebookId, title, content),
    `/notebook/${notebookId}`,
  )
  if (!r.ok) return r
  const result = r.result
  let sourceId: string | undefined
  try {
    if (Array.isArray(result) && Array.isArray(result[0]) && Array.isArray(result[0][0])) {
      sourceId = typeof result[0][0][0] === "string" ? result[0][0][0] : undefined
    }
  } catch { /* fall through */ }
  if (!sourceId) {
    return {
      ok: false,
      error: `ADD_SOURCE (text) returned no source ID. Response head: ${JSON.stringify(result).slice(0, 300)}`,
    }
  }
  return { ok: true, sourceId }
}

/** List sources in a notebook (for verification). Returns array of { id, title, url }. */
export async function listSourcesViaRpc(
  notebookId: string,
): Promise<{ ok: boolean; sources?: Array<{ id: string; title?: string; url?: string }>; error?: string }> {
  const r = await rpcCall(
    RPC.GET_NOTEBOOK,
    buildGetNotebookParams(notebookId),
    `/notebook/${notebookId}`,
  )
  if (!r.ok) return r
  // GET_NOTEBOOK response: sources live in a deeply-nested structure.
  // notebooklm-py parses result[0] or similar. We'll search for source-like entries.
  const sources: Array<{ id: string; title?: string; url?: string }> = []
  try {
    // Walk the response looking for [string_id, ...] entries that look like sources
    const seen = new Set<string>()
    const walk = (node: any) => {
      if (Array.isArray(node)) {
        // Source entries typically have UUID-like first element
        if (node.length >= 2 && typeof node[0] === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node[0])) {
          const id = node[0]
          if (!seen.has(id)) {
            seen.add(id)
            const title = typeof node[1] === "string" ? node[1] : undefined
            const url = typeof node[2] === "string" ? node[2] : undefined
            sources.push({ id, title, url })
          }
        }
        for (const child of node) walk(child)
      }
    }
    walk(r.result)
  } catch { /* ignore */ }
  return { ok: true, sources }
}
