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
      if (location.pathname.startsWith("/notebook/")) {
        location.href = "https://notebooklm.google.com/"
        return { ok: false, error: "Navigating to NotebookLM home; please retry create" }
      }

      // Bug fix: button selection was unstable. Multiple buttons match "create" text
      // (e.g. "add Create new" might be "Create new source" not "Create new notebook").
      // Require "notebook" in text/aria to disambiguate.
      const allBtns = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
      const candidates = allBtns.filter(b => {
        const el = b as HTMLElement
        const t = (el.textContent || "").trim().toLowerCase()
        const al = (el.getAttribute("aria-label") || "").toLowerCase()
        // Must mention "notebook" (or 笔记本) to avoid matching "Create new source"
        const mentionsNotebook = t.includes("notebook") || t.includes("笔记本") ||
                                  al.includes("notebook") || al.includes("笔记本")
        const mentionsCreate = t.includes("create") || t.includes("new") ||
                                t.includes("新建") || t.includes("创建") || t.includes("新") ||
                                al.includes("create") || al.includes("new") ||
                                al.includes("新建") || al.includes("创建")
        return t.length > 0 && t.length < 50 && mentionsNotebook && mentionsCreate
      }) as HTMLElement[]

      let newBtn: HTMLElement | undefined
      // Prefer FAB
      newBtn = candidates.find(b =>
        b.classList.contains("mat-fab") || b.classList.contains("mdc-fab") ||
        b.classList.contains("mat-mdc-fab") || b.classList.contains("mat-mdc-unelevated-button")
      )
      // Then prefer one with mat-icon "add"
      if (!newBtn) {
        newBtn = candidates.find(b => {
          const icon = b.querySelector("mat-icon, .material-icons")
          return icon && (icon.textContent || "").trim().toLowerCase() === "add"
        })
      }
      // Then prefer shortest text
      if (!newBtn) {
        const sorted = [...candidates].sort((a, b) =>
          (a.textContent || "").trim().length - (b.textContent || "").trim().length
        )
        newBtn = sorted[0]
      }

      if (!newBtn) {
        const sample = allBtns.slice(0, 15).map(b => (b.textContent || "").trim().slice(0, 50)).filter(t => t)
        return {
          ok: false,
          error: `New-notebook button not found. Visible buttons: ${JSON.stringify(sample).slice(0, 300)}`,
        }
      }
      // Bug fix: programmatic .click() sometimes doesn't trigger Angular handlers.
      // Dispatch a full pointer + mouse + click sequence for reliability.
      newBtn.focus()
      newBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
      newBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
      newBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
      newBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
      newBtn.click()
      await waitForRaf(3)

      // Bug fix: NotebookLM's "Create new notebook" may NOT open a name dialog —
      // it can directly create an untitled notebook and navigate. Wait for EITHER:
      //   (a) navigation to /notebook/<id> (immediate untitled creation), OR
      //   (b) a dialog appearing (name-input flow)
      // If (a), we rename via the notebook page title UI afterwards.
      const dialogSelector = "mat-dialog-container, .mat-mdc-dialog-container, [role='dialog']"
      let dialog: Element | null = null
      let navigated = false
      const raceDeadline = Date.now() + 8000
      while (Date.now() < raceDeadline) {
        // Check for navigation first
        const navMatch = location.pathname.match(/\/notebook\/([a-f0-9-]+)/i)
        if (navMatch) {
          navigated = true
          break
        }
        // Check for dialog
        dialog = document.querySelector(dialogSelector)
        if (dialog) break
        await new Promise(r => setTimeout(r, 100))
      }

      if (dialog) {
        // Name-input dialog flow
        await waitForRaf(2)
        const nameInput =
          (dialog.querySelector("input[type='text']") as HTMLInputElement) ||
          (dialog.querySelector("input:not([type])") as HTMLInputElement) ||
          (dialog.querySelector("textarea") as HTMLTextAreaElement) ||
          null
        if (nameInput) {
          setAngularValue(nameInput, name)
          await waitForRaf(3)
          // Enter key first
          nameInput.focus()
          nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
          nameInput.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
          nameInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
          const form = nameInput.closest("form")
          if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
          // Wait briefly for navigation via Enter
          {
            const shortDeadline = Date.now() + 2500
            while (Date.now() < shortDeadline) {
              const m = location.pathname.match(/\/notebook\/([a-f0-9-]+)/i)
              if (m) { navigated = true; break }
              await new Promise(r => setTimeout(r, 200))
            }
          }
          // If Enter didn't navigate, try submit button click
          if (!navigated) {
            const allDialogBtns = Array.from(dialog.querySelectorAll("button"))
            const submit = allDialogBtns.find(b => {
              const t = (b.textContent || "").trim().toLowerCase()
              const al = (b.getAttribute("aria-label") || "").toLowerCase()
              const isCancel = t.includes("cancel") || t.includes("close") || t.includes("back") ||
                t.includes("取消") || t.includes("关闭") || t.includes("返回")
              const textMatch = t.includes("create") || t.includes("save") || t.includes("submit") ||
                t.includes("ok") || t.includes("done") || t.includes("confirm") ||
                t.includes("创建") || t.includes("保存") || t.includes("确定") || t.includes("完成") || t.includes("确认")
              const ariaMatch = al.includes("create") || al.includes("save") || al.includes("submit") ||
                al.includes("ok") || al.includes("done") || al.includes("confirm") ||
                al.includes("创建") || al.includes("保存") || al.includes("确定") || al.includes("完成") || al.includes("确认")
              return (textMatch || ariaMatch) && !isCancel
            }) as HTMLElement | undefined
            if (submit) {
              const enabled = await waitForAngularEnabled(submit, 5000)
              if (enabled) {
                submit.focus()
                submit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
                submit.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
                submit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
                submit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
                submit.click()
              }
            }
          }
        }
      }

      // Wait for navigation to /notebook/<id> — extended to 30s
      const deadline = Date.now() + 30000
      let notebookId: string | null = null
      while (Date.now() < deadline) {
        const m = location.pathname.match(/\/notebook\/([a-f0-9-]+)/i)
        if (m) { notebookId = m[1]; break }
        await new Promise(r => setTimeout(r, 200))
      }
      if (!notebookId) {
        const stillOpen = dialog?.isConnected
        const btnDump = Array.from(document.querySelectorAll("button")).slice(0, 10).map(b => (b.textContent || "").trim().slice(0, 40))
        return {
          ok: false,
          error: `Did not navigate to new notebook (30s). Dialog still open: ${!!stillOpen}. Buttons: ${JSON.stringify(btnDump).slice(0, 300)}`,
        }
      }

      // Bug fix: NotebookLM may have created an UNTITLED notebook (no name dialog).
      // Try to rename via the notebook page's title UI. Best-effort — if rename
      // fails, the notebook is still created (just untitled); user can rename manually.
      await waitForRaf(5) // let the notebook page render
      let renameApplied = false
      try {
        // Kimi review round 4: prefer contenteditable title elements first.
        // Button fallback (click → wait for input to appear) is harder to get
        // right; only use it if no contenteditable is found.
        let titleEl: HTMLElement | null =
          (document.querySelector('[contenteditable="true"]') as HTMLElement) ||
          (document.querySelector('h1[contenteditable]') as HTMLElement) ||
          (document.querySelector('.notebook-title[contenteditable]') as HTMLElement) ||
          (document.querySelector('[role="heading"][contenteditable]') as HTMLElement) ||
          null

        // Button fallback: click "Untitled notebook" button and wait for an
        // input/contenteditable to appear, then fill via setAngularValue.
        if (!titleEl) {
          const untitledBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
            const t = (b.textContent || "").trim().toLowerCase()
            return t === "untitled notebook" || t === "untitled" || t === "未命名笔记本" || t === "未命名"
          }) as HTMLElement | undefined
          if (untitledBtn) {
            untitledBtn.focus()
            untitledBtn.click()
            // Wait for an input/contenteditable to appear (Kimi review catch:
            // don't execCommand directly on the button — it doesn't work)
            const inputDeadline = Date.now() + 2000
            while (Date.now() < inputDeadline) {
              const input =
                document.querySelector('input[type="text"]') as HTMLInputElement ||
                document.querySelector('[contenteditable="true"]') as HTMLElement
              if (input) { titleEl = input; break }
              await new Promise(r => setTimeout(r, 100))
            }
          }
        }

        if (titleEl) {
          titleEl.focus()
          if (!(titleEl as any).isContentEditable) titleEl.click()
          await waitForRaf(2)
          // Select all + insert (for contenteditable)
          if ((titleEl as any).isContentEditable) {
            document.execCommand("selectAll", false)
            document.execCommand("insertText", false, name)
          } else if (titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement) {
            // Use the Angular-safe setter for input/textarea
            const proto = titleEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
            if (setter) setter.call(titleEl, name)
            else (titleEl as HTMLInputElement).value = name
          }
          titleEl.dispatchEvent(new Event("input", { bubbles: true }))
          titleEl.dispatchEvent(new Event("change", { bubbles: true }))
          titleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
          ;(titleEl as HTMLElement).blur()
          await waitForRaf(3)
          // Kimi review round 4: best-effort verification — did the title change?
          // (Don't fail the flow if verification misses; the rename attempt ran.)
          const visibleText = ((titleEl as HTMLElement).textContent || (titleEl as HTMLInputElement).value || "").trim()
          renameApplied = visibleText.toLowerCase().includes(name.toLowerCase().slice(0, 10))
        }
      } catch (e: any) {
        // Rename failed — notebook is still created, just untitled. Don't fail the whole flow.
        console.warn("[notebooklm.createNotebook] rename failed:", e?.message)
      }

      return { ok: true, notebookId, ...(renameApplied ? {} : { error: "Notebook created but rename may not have applied — please verify title" }) }

      // Note: navigation wait + rename happens in the unified block above
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}

/** Wait for a tab to finish loading after navigation. Uses chrome.tabs.onUpdated
 *  for the canonical "loading → complete" signal. Falls back to polling. Accepts
 *  "interactive" too (Angular SPA may not reach "complete").
 *
 *  Bug fix: also wait for `url` to match the expected home URL (no /notebook/)
 *  AND give Angular extra time to bootstrap after status=complete. */
async function waitForTabComplete(tabId: number, timeoutMs: number, expectUrl?: string): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      // Give Angular a beat to bootstrap after status=complete
      setTimeout(resolve, 800)
    }
    const urlMatches = (url?: string) => {
      if (!url) return false
      if (expectUrl) return url === expectUrl || url.startsWith(expectUrl)
      // Default: just need to be off /notebook/
      return !url.includes("/notebook/")
    }
    const listener = (id: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id !== tabId) return
      // Require both status=complete AND url matches expected
      if (changeInfo.status === "complete" && urlMatches(tab.url)) finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    // Fallback: poll tab.status + url directly
    const poll = async () => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          const t = await chrome.tabs.get(tabId)
          if ((t.status === "complete" || t.status === "interactive") && urlMatches(t.url)) {
            // Wait a moment to confirm it's stable (not still navigating)
            await new Promise(r => setTimeout(r, 500))
            const t2 = await chrome.tabs.get(tabId)
            if (urlMatches(t2.url)) { finish(); return }
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 300))
      }
      finish()
    }
    poll()
    const timer = setTimeout(finish, timeoutMs)
  })
}

/** Create a notebook. Opens (or reuses) a NotebookLM home tab, drives the create
 *  dialog via createNotebookRunner. Returns the new notebook ID. */
export async function createNotebook(name: string): Promise<{ ok: boolean; notebookId?: string; error?: string }> {
  // Bug fix: chrome.tabs.query with `url: "https://notebooklm.google.com/"` only matches
  // the EXACT root URL, missing /notebook/<id> subpaths. Use a wildcard pattern.
  const allNlmTabs = await chrome.tabs.query({ url: "https://notebooklm.google.com/*" })
  let tabId: number
  let didNavigate = false
  if (allNlmTabs.length > 0 && allNlmTabs[0].id) {
    tabId = allNlmTabs[0].id
    if (allNlmTabs[0].url && allNlmTabs[0].url.includes("/notebook/")) {
      await chrome.tabs.update(tabId, { url: "https://notebooklm.google.com/" })
      didNavigate = true
    }
  } else {
    const tab = await chrome.tabs.create({ url: "https://notebooklm.google.com/", active: false })
    if (!tab.id) return { ok: false, error: "Failed to open NotebookLM tab" }
    tabId = tab.id
    didNavigate = true
  }

  // Bug fix: after navigation, wait for the tab to actually finish loading.
  // Just polling tab.url isn't enough — the OLD frame may still be alive when
  // the URL changes, causing "Frame with ID 0 was removed" on executeScript.
  // Use chrome.tabs.onUpdated for the canonical "loading → complete" signal.
  if (didNavigate) {
    await waitForTabComplete(tabId, 15_000)
  }

  // Wait for readyState=complete AND home-page create button.
  // Bug fix: previously also accepted `hasAddSrcBtn` as "ready" — but that's a
  // NOTEBOOK page signal, not home. Caused the runner to fire on the stale
  // notebook page after navigation, returning "Navigating...".
  const deadline = Date.now() + 20_000
  let lastDebug: any = null
  let homeReady = false
  while (Date.now() < deadline) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const allBtns = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
          // Kimi review round 3 fix: require "notebook" / "笔记本" in text/aria
          // to avoid matching "Create new source" (which would falsely signal ready).
          const createBtn = allBtns.find(b => {
            const t = (b.textContent || "").trim().toLowerCase()
            const al = (b.getAttribute("aria-label") || "").toLowerCase()
            const mentionsNotebook = t.includes("notebook") || t.includes("笔记本") ||
                                      al.includes("notebook") || al.includes("笔记本")
            const mentionsCreate = t.includes("create") || t.includes("new") ||
                                    t.includes("新建") || t.includes("创建") || t.includes("新") ||
                                    al.includes("create") || al.includes("new") ||
                                    al.includes("新建") || al.includes("创建")
            return t.length > 0 && t.length < 50 && mentionsNotebook && mentionsCreate
          })
          return {
            ready: document.readyState,
            pathname: location.pathname,
            url: location.href,
            hasCreateBtn: !!createBtn,
            btnSample: allBtns.slice(0, 15).map(b => (b.textContent || "").trim().slice(0, 50)).filter(t => t.length > 0),
          }
        },
      })
      const info = r?.result as any
      lastDebug = info
      // Bug fix: NotebookLM is an Angular SPA — readyState may stay at "interactive"
      // indefinitely (never reach "complete"). The real readiness signal is
      // hasCreateBtn + correct pathname. Accept "interactive" or "complete".
      if (
        (info?.ready === "complete" || info?.ready === "interactive") &&
        !info.pathname.startsWith("/notebook/") &&
        info.hasCreateBtn
      ) {
        homeReady = true
        break
      }
    } catch {
      // tab not ready for injection
    }
    await new Promise(r => setTimeout(r, 400))
  }

  if (!homeReady) {
    return {
      ok: false,
      error: `NotebookLM 主页未就绪（20s 超时）。最后看到：${JSON.stringify(lastDebug).slice(0, 400)}`,
    }
  }

  // Bug fix: retry the runner up to 5 times with exponential backoff.
  // "Frame with ID 0 was removed" can happen multiple times during Angular SPA
  // navigation — short retry interval isn't enough.
  // Kimi review fix: re-wait for homeReady on each retry (Angular may not have
  // bootstrapped on first attempt; frame-removed isn't the only failure mode).
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      // Re-verify home is ready before retrying
      try {
        await waitForTabComplete(tabId, 10_000, "https://notebooklm.google.com/")
      } catch { /* ignore */ }
      // Re-check create button is present
      let homeReady2 = false
      const reDeadline = Date.now() + 10_000
      while (Date.now() < reDeadline) {
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const allBtns = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
              const createBtn = allBtns.find(b => {
                const t = (b.textContent || "").trim().toLowerCase()
                const al = (b.getAttribute("aria-label") || "").toLowerCase()
                return t.length > 0 && t.length < 40 && (
                  t.includes("create") || t.includes("new notebook") ||
                  t.includes("新建") || t.includes("创建") || t.includes("新笔记本") ||
                  al.includes("create") || al.includes("new notebook") ||
                  al.includes("新建") || al.includes("创建")
                )
              })
              return {
                ready: document.readyState,
                pathname: location.pathname,
                hasCreateBtn: !!createBtn,
              }
            },
          })
          const info = r?.result as any
          if ((info?.ready === "complete" || info?.ready === "interactive") &&
              !info.pathname.startsWith("/notebook/") && info.hasCreateBtn) {
            homeReady2 = true
            break
          }
        } catch {
          // tab not ready
        }
        await new Promise(r => setTimeout(r, 400))
      }
      if (!homeReady2) {
        return { ok: false, error: `Home not ready on retry ${attempt + 1}` }
      }
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
      if (result.error && result.error.includes("Navigating to NotebookLM home")) {
        await waitForTabComplete(tabId, 10_000, "https://notebooklm.google.com/")
        continue
      }
      return result
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (msg.includes("Frame with ID") || msg.includes("was removed") || msg.includes("No tab with id")) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000)
        await new Promise(r => setTimeout(r, backoff))
        continue
      }
      return { ok: false, error: `executeScript failed: ${msg}` }
    }
  }
  return { ok: false, error: "Runner failed after 5 retries (frame kept being removed during navigation)" }
}
