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

// ---------------------------------------------------------------------------
// Create notebook — Phase B (v1.2)
//
// The actual RPC ID for create is undocumented (`boVbkv` is mentioned in
// notebooklm-py but unverified). We use DOM automation: click "New notebook"
// → fill name → submit → read new notebook ID from URL.
//
// Returns the new notebook ID on success.
// ---------------------------------------------------------------------------

/** Injected into the NotebookLM home page via chrome.scripting.executeScript.
 *  Drives the "Create new notebook" UI flow. Self-contained.
 *
 *  args: [name, selectorsJSON] — selectorsJSON is the standard registry but
 *  we only use addSourceButton / dialogContainer / submitButton + a few
 *  create-specific lookups via text/aria. */
export function createNotebookRunner(name: string): Promise<{ ok: boolean; notebookId?: string; error?: string }> {
  function resolveByStrategy(
    cssList: string[],
    textList: string[],
    ariaList: string[],
    timeoutMs = 3000,
  ): HTMLElement | null {
    // CSS first
    for (const css of cssList) {
      try {
        const el = document.querySelector(css)
        if (el) return el as HTMLElement
      } catch {
        // skip invalid
      }
    }
    // Text content fallback
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const all = document.querySelectorAll<HTMLElement>("button, a, [role='button']")
      for (const el of Array.from(all)) {
        if (textList) {
          const txt = (el.textContent || "").trim().slice(0, 80)
          if (textList.some(t => txt.toLowerCase().includes(t.toLowerCase()))) return el
        }
        if (ariaList) {
          const al = el.getAttribute("aria-label") || ""
          if (ariaList.some(t => al.toLowerCase().includes(t.toLowerCase()))) return el
        }
      }
      break
    }
    return null
  }

  function waitForRaf(frames = 2): Promise<void> {
    return new Promise(resolve => {
      let remaining = frames
      const tick = () => {
        remaining--
        if (remaining <= 0) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  function setAngularValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  async function waitForAngularEnabled(el: HTMLElement, timeoutMs = 5000): Promise<boolean> {
    const isEnabled = (e: HTMLElement) =>
      !e.hasAttribute("disabled") &&
      e.getAttribute("aria-disabled") !== "true" &&
      !e.classList.contains("mdc-button--disabled") &&
      !e.classList.contains("mat-mdc-button-disabled") &&
      getComputedStyle(e).pointerEvents !== "none"
    if (isEnabled(el)) return true
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await waitForRaf(2)
      if (isEnabled(el)) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return isEnabled(el)
  }

  function waitForSelector(selector: string, timeoutMs = 5000): Promise<Element | null> {
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs
      const tick = () => {
        const el = document.querySelector(selector)
        if (el) return resolve(el)
        if (Date.now() >= deadline) return resolve(null)
        setTimeout(tick, 50)
      }
      tick()
    })
  }

  return (async () => {
    try {
      // Phase 5 review fix: navigate to home if currently on a /notebook/<id> page.
      // Prior logic was inverted (would navigate when already home). If we navigate,
      // return early — caller re-invokes the runner after the tab settles.
      if (location.pathname.startsWith("/notebook/")) {
        location.href = "https://notebooklm.google.com/"
        return { ok: false, error: "Navigating to NotebookLM home; please retry create" }
      }

      // Click "+ New notebook" / "Create new notebook" / "新笔记本" button
      const newBtn = resolveByStrategy(
        [".new-notebook-button", 'button[aria-label*="New notebook"]', 'button[aria-label*="Create"]', 'button[aria-label*="新笔记本"]', 'button[aria-label*="创建"]'],
        ["New notebook", "Create notebook", "Create source", "新笔记本", "新建笔记本", "创建笔记本"],
        ["New notebook", "Create notebook", "新笔记本", "创建笔记本"],
        3000,
      )
      if (!newBtn) return { ok: false, error: "New-notebook button not found on NotebookLM home" }
      newBtn.click()
      await waitForRaf(2)

      // Wait for the create dialog to appear
      const dialogSelector = "mat-dialog-container, .mat-mdc-dialog-container, [role='dialog']"
      const dialog = await waitForSelector(dialogSelector, 5000)
      if (!dialog) return { ok: false, error: "Create-notebook dialog did not appear" }
      await waitForRaf(2)

      // Fill the name input. Try multiple selectors + fallback by placeholder text.
      const nameInput =
        (dialog.querySelector("input[type='text']") as HTMLInputElement) ||
        (dialog.querySelector("textarea") as HTMLTextAreaElement) ||
        null
      if (!nameInput) return { ok: false, error: "Notebook name input not found in dialog" }
      setAngularValue(nameInput, name)
      await waitForRaf(2)

      // Click submit ("Create" / "Save" / "创建")
      const submit = resolveByStrategy(
        ['button[type="submit"]', ".submit-button", "mat-dialog-container button.mat-primary"],
        ["Create", "Save", "Submit", "创建", "保存", "确定"],
        ["Create", "Save", "创建", "保存"],
        2000,
      )
      if (!submit) return { ok: false, error: "Submit button not found in create dialog" }
      const enabled = await waitForAngularEnabled(submit, 5000)
      if (!enabled) return { ok: false, error: "Submit button did not become enabled" }
      submit.click()

      // Wait for navigation to /notebook/<id>
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const m = location.pathname.match(/\/notebook\/([a-f0-9-]+)/i)
        if (m) return { ok: true, notebookId: m[1] }
        await new Promise(r => setTimeout(r, 200))
      }
      return { ok: false, error: "Did not navigate to new notebook after submit" }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}

/** Create a notebook. Opens (or reuses) a NotebookLM home tab, drives the create
 *  dialog via createNotebookRunner. Returns the new notebook ID. */
export async function createNotebook(name: string): Promise<{ ok: boolean; notebookId?: string; error?: string }> {
  // Find or open a NotebookLM HOME tab (not a specific notebook)
  const tabs = await chrome.tabs.query({ url: "https://notebooklm.google.com/" })
  let tabId: number
  if (tabs.length > 0 && tabs[0].id) {
    tabId = tabs[0].id
    // Ensure on home, not on a notebook page
    if (tabs[0].url && tabs[0].url.includes("/notebook/")) {
      await chrome.tabs.update(tabId, { url: "https://notebooklm.google.com/" })
    }
  } else {
    const tab = await chrome.tabs.create({ url: "https://notebooklm.google.com/", active: false })
    if (!tab.id) return { ok: false, error: "Failed to open NotebookLM tab" }
    tabId = tab.id
  }

  // Wait for readyState=complete + Add-source button OR New-notebook button
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.readyState,
      })
      if (r?.result === "complete") break
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 300))
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: createNotebookRunner,
      args: [name],
    })
    const frame = results?.[0] as any
    if (frame?.error) return { ok: false, error: `Injection error: ${frame.error}` }
    const result = frame?.result as { ok: boolean; notebookId?: string; error?: string } | undefined
    if (!result) return { ok: false, error: "Runner returned no result" }
    return result
  } catch (e: any) {
    return { ok: false, error: `executeScript failed: ${e?.message || String(e)}` }
  }
}
