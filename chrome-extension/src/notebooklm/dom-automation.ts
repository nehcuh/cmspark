// DOM automation runner for NotebookLM.
//
// **IMPORTANT**: The runners `importUrlRunner` and `importTextRunner` MUST be fully
// self-contained — `chrome.scripting.executeScript({func})` serializes the function
// via toString() and runs it in the page context, which does NOT have access to
// module imports. All helpers are nested INSIDE each runner. The selector strategy
// is passed as a JSON arg (parsed defensively inside).
//
// Per Round 1 advisor consensus (Kimi + Pi-sub):
//   - Pure DOM automation (no fetch interception in v1.1)
//   - Angular-aware waiter: MutationObserver quiescence + rAF×2 (NOT fixed setTimeout)
//   - Assert on Angular state ([disabled], .mat-mdc-button-disabled, etc.), not just
//     selector existence
//   - Source-ack via row-count diff + DOM quiescence
//
// Round 1 advisors estimate ~30% flake on batches >10 without the Angular waiter.

import type { SelectorRegistry, SelectorStrategy } from "./types"
import { SELECTORS } from "./selectors"

/** Stringify the selector registry for passing as an executeScript arg. */
export function encodeSelectorsForRunner(): string {
  return JSON.stringify(SELECTORS)
}

// ---------------------------------------------------------------------------
// Self-contained runner: import URL.
//
// args: [url, selectorsJSON]
// ---------------------------------------------------------------------------
export function importUrlRunner(url: string, selectorsJSON: string): Promise<{ ok: boolean; error?: string }> {
  // ---------- nested helpers (will be serialized with the function) ----------
  function parseSelectors(): SelectorRegistry | null {
    try {
      const parsed = JSON.parse(selectorsJSON)
      return parsed as SelectorRegistry
    } catch {
      return null
    }
  }

  function resolveStrategy<T extends Element>(
    s: SelectorStrategy | undefined,
    timeoutMs = 3000,
    root: ParentNode = document,
  ): T | null {
    if (!s) return null
    // Kimi review fix: implement real polling — Angular may render elements
    // asynchronously, so a single snapshot miss shouldn't fail. Try CSS first;
    // if miss, poll text/aria/role fallback until timeout.
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      // CSS first
      for (const css of s.css || []) {
        try {
          const el = root.querySelector(css)
          if (el) return el as T
        } catch {
          // invalid selector on this page; skip
        }
      }
      // Text/aria/role fallback — scan descendants of `root`
      const all = (root as Document | Element).querySelectorAll?.("*") || []
      for (const el of Array.from(all)) {
        const html = el as HTMLElement
        if (s.textContent) {
          const txt = (html.textContent || "").trim().slice(0, 200)
          if (s.textContent.some(t => txt.toLowerCase().includes(t.toLowerCase()))) return html as unknown as T
        }
        if (s.ariaLabel) {
          const al = html.getAttribute?.("aria-label") || ""
          if (s.ariaLabel.some(t => al.toLowerCase().includes(t.toLowerCase()))) return html as unknown as T
        }
        if (s.role && html.getAttribute?.("role") === s.role) return html as unknown as T
      }
      // No match this iteration — wait briefly + retry (Angular may render more)
      // Use a synchronous-ish wait via Date.now() loop is bad; break to async caller
      break
    }
    return null
  }

  /** Kimi review fix: async version of resolveStrategy that actually polls across
   *  multiple rAF cycles. Use this when waiting for Angular to render an element. */
  async function resolveStrategyAsync<T extends Element>(
    s: SelectorStrategy | undefined,
    timeoutMs = 3000,
    root: ParentNode = document,
  ): Promise<T | null> {
    if (!s) return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const el = resolveStrategy<T>(s, 0, root)
      if (el) return el
      // Wait one rAF cycle for Angular to render more
      await new Promise(r => requestAnimationFrame(() => r(null)))
      await new Promise(r => setTimeout(r, 50))
    }
    return null
  }

  /** Phase 5 review fix: dismiss any leftover dialog from a previous iteration
   *  before starting. Sends Escape; if a dialog is still present after, give up
   *  (the runner will fail with "Add-source button not found"). */
  function closeAnyOpenDialog(S: SelectorRegistry): void {
    const dialog = resolveStrategy(S.dialogContainer, 100)
    if (!dialog) return
    // Send Escape key — Angular Material closes on Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }))
    ;(dialog as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }))
  }

  function setAngularValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
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

  function waitForDomQuiescence(
    root: Node,
    quietMs = 80,
    timeoutMs = 5000,
  ): Promise<void> {
    return new Promise<void>(resolve => {
      const deadline = Date.now() + timeoutMs
      let lastMutation = Date.now()
      const observer = new MutationObserver(() => {
        lastMutation = Date.now()
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "aria-disabled", "aria-hidden"],
      })
      const poll = () => {
        if (Date.now() - lastMutation >= quietMs || Date.now() >= deadline) {
          observer.disconnect()
          resolve()
          return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    })
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

  function currentSourceCount(selector: string): number {
    try {
      return document.querySelectorAll(selector).length
    } catch {
      return 0
    }
  }

  async function openAddSourceDialog(S: SelectorRegistry): Promise<Element> {
    const existing = resolveStrategy(S.dialogContainer, 200)
    if (existing) return existing

    // Bug fix: try the registry first; if it misses, fall back to a permissive scan
    // for any button whose text/aria mentions "add" (NotebookLM UI keeps changing).
    let btn: HTMLElement | null = resolveStrategy<HTMLElement>(S.addSourceButton, 1500)
    if (!btn) {
      // Permissive fallback: any clickable element with short text mentioning "add"
      const allBtns = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
      btn = allBtns.find(b => {
        const el = b as HTMLElement
        const t = (el.textContent || "").trim().toLowerCase()
        const al = (el.getAttribute("aria-label") || "").toLowerCase()
        const icon = el.querySelector("mat-icon, .material-icons")
        const iconText = icon ? (icon.textContent || "").trim().toLowerCase() : ""
        // Length < 30 to avoid matching "Add a source to your notebook..." paragraphs
        return t.length < 30 && (
          t === "add" || t === "add source" || t === "add sources" ||
          t === "添加" || t === "添加来源" || t === "新增来源" ||
          al === "add" || al === "add source" || al === "add sources" ||
          al === "添加" || al === "添加来源" || al === "新增来源" ||
          iconText === "add"
        )
      }) as HTMLElement | null
    }
    if (!btn) {
      // Diagnostic: dump all visible buttons so the user can tell us the actual UI
      const sample = Array.from(document.querySelectorAll("button"))
        .slice(0, 20)
        .map(b => ({
          text: (b.textContent || "").trim().slice(0, 40),
          aria: b.getAttribute("aria-label") || "",
          classes: (b.className || "").slice(0, 80),
        }))
        .filter(s => s.text || s.aria)
      throw new Error(`Add-source button not found. Visible buttons: ${JSON.stringify(sample).slice(0, 400)}`)
    }
    // Kimi review fix: full pointer + mouse + click sequence — programmatic .click()
    // alone sometimes doesn't trigger Angular's event listeners.
    btn.focus()
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
    btn.click()
    const dialogSelector = S.dialogContainer.css[0]
    const dialog = await waitForSelector(dialogSelector, 5000)
    if (!dialog) throw new Error("Add-source dialog did not open after click")
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    return dialog
  }

  async function navigateToWebsiteSubPage(S: SelectorRegistry, dialog: Element): Promise<void> {
    if (resolveStrategy(S.urlInput, 200, dialog)) return
    // Try registry first, then permissive fallback
    let websiteBtn: HTMLElement | null = resolveStrategy<HTMLElement>(S.websiteLinkOption, 1500, dialog)
    if (!websiteBtn) {
      const allBtns = Array.from(dialog.querySelectorAll("button, [role='button'], a[role='button']"))
      websiteBtn = allBtns.find(b => {
        const el = b as HTMLElement
        const t = (el.textContent || "").trim().toLowerCase()
        const al = (el.getAttribute("aria-label") || "").toLowerCase()
        const icon = el.querySelector("mat-icon, .material-icons, img")
        const iconText = icon ? (icon.textContent || icon.getAttribute("alt") || "").trim().toLowerCase() : ""
        return t.length < 30 && (
          t.includes("website") || t.includes("link") || t.includes("url") ||
          t.includes("网站") || t.includes("链接") || t.includes("网址") ||
          al.includes("website") || al.includes("link") || al.includes("url") ||
          al.includes("网站") || al.includes("链接") || al.includes("网址") ||
          iconText === "link" || iconText === "language" || iconText === "public"
        )
      }) as HTMLElement | null
    }
    if (!websiteBtn) {
      const sample = Array.from(dialog.querySelectorAll("button, [role='button']"))
        .slice(0, 15)
        .map(b => ({ text: (b.textContent || "").trim().slice(0, 40), aria: b.getAttribute("aria-label") || "", classes: (b.className || "").slice(0, 80) }))
      throw new Error(`Website/Link option not found in dialog. Dialog buttons: ${JSON.stringify(sample).slice(0, 400)}`)
    }
    websiteBtn.click()
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    const urlArea = resolveStrategy(S.urlInput, 3000, dialog)
    if (!urlArea) throw new Error("URL input did not appear after clicking Website option")
  }

  /** Phase 5 review fix: use MutationObserver instead of fixed setTimeout polling.
   *  Watches the source-row container for the count to exceed `beforeCount`.
   *
   *  Bug fix: also accept "dialog closed" as a success signal — NotebookLM may
   *  close the dialog before the source-row renders (esp. for YouTube URLs which
   *  take 10-30s to process). Returns diagnostic info on timeout. */
  async function waitForSuccess(
    beforeCount: number,
    sourceRowSelector: string,
    timeoutMs: number,
    dialogSelector?: string,
  ): Promise<{ ok: boolean; diagnostic?: string }> {
    return new Promise<{ ok: boolean; diagnostic?: string }>(resolve => {
      let settled = false
      const startTime = Date.now()
      const finish = (ok: boolean, diagnostic?: string) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(deadlineTimer)
        resolve({ ok, diagnostic })
      }
      const check = () => {
        // Success path 1: source-row count increased
        if (document.querySelectorAll(sourceRowSelector).length > beforeCount) {
          finish(true)
          return
        }
        // Kimi review round 4: error signal detection — if page shows error
        // indicator, the dialog may have closed due to failure, NOT acceptance.
        // Common Angular Material error patterns: .mat-error, [role="alert"],
        // .error-message, snackbar-error, text containing "failed" / "失败"
        const pageHasError =
          !!document.querySelector('.mat-error, [role="alert"], .error-message, .mat-mdc-snack-bar-label, [class*="error"]') ||
          Array.from(document.querySelectorAll('[role="alert"], .mat-mdc-snack-bar-label')).some(el => {
            const t = (el.textContent || "").trim().toLowerCase()
            return t.length > 0 && t.length < 200 && (
              t.includes("failed") || t.includes("error") || t.includes("invalid") ||
              t.includes("失败") || t.includes("错误") || t.includes("无效")
            )
          })
        // Success path 2 (heuristic): dialog closed AND at least 2s elapsed since submit
        // AND no error indicators — NotebookLM closes the dialog after accepting the URL.
        if (!pageHasError && dialogSelector && Date.now() - startTime > 2000) {
          const dialog = document.querySelector(dialogSelector)
          if (!dialog) {
            setTimeout(() => finish(true, "dialog closed; assumed accepted"), 1500)
          }
        }
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      check()
      const deadlineTimer = setTimeout(() => {
        const sourceCount = document.querySelectorAll(sourceRowSelector).length
        const dialogOpen = dialogSelector ? !!document.querySelector(dialogSelector) : false
        finish(false, `timeout after ${timeoutMs}ms; sourceCount=${sourceCount} (before=${beforeCount}); dialogOpen=${dialogOpen}`)
      }, timeoutMs)
    })
  }

  // ------------------------------- main logic --------------------------------
  return (async () => {
    try {
      const S = parseSelectors()
      if (!S) return { ok: false, error: "Failed to parse selectors arg" }
      // Phase 5 review fix: dismiss any leftover dialog from a previous iteration
      closeAnyOpenDialog(S)
      await waitForRaf(1)

      const before = currentSourceCount(S.sourceRow.css[0])
      const dialog = await openAddSourceDialog(S)
      await navigateToWebsiteSubPage(S, dialog)

      // Phase 5 review fix: scope url/submit lookups to dialog subtree so the outer
      // "Add source" button doesn't accidentally match the "Add" submit text fallback.
      const urlEl = resolveStrategy<HTMLTextAreaElement>(S.urlInput, 2000, dialog)
      if (!urlEl) return { ok: false, error: "URL textarea not found" }
      setAngularValue(urlEl, url)
      await waitForRaf(2)

      // Bug fix: submit button search with permissive fallback + Enter key.
      // Same pattern as createNotebookRunner — NotebookLM UI keeps changing.
      let submit: HTMLElement | null = resolveStrategy<HTMLElement>(S.submitButton, 1500, dialog)
      if (!submit) {
        // Permissive fallback: scan dialog buttons for submit-like text/aria
        const allDialogBtns = Array.from(dialog.querySelectorAll("button"))
        submit = allDialogBtns.find(b => {
          const t = (b.textContent || "").trim().toLowerCase()
          const al = (b.getAttribute("aria-label") || "").toLowerCase()
          const isSubmit = b.getAttribute("type") === "submit"
          const isPrimary =
            b.classList.contains("mat-primary") ||
            b.classList.contains("mdc-button--unelevated") ||
            b.classList.contains("mat-mdc-unelevated-button")
          const textMatch =
            t.includes("insert") || t.includes("add") || t.includes("submit") ||
            t.includes("save") || t.includes("ok") || t.includes("done") || t.includes("confirm") ||
            t.includes("插入") || t.includes("添加") || t.includes("提交") ||
            t.includes("保存") || t.includes("确定") || t.includes("完成") || t.includes("确认")
          const ariaMatch =
            al.includes("insert") || al.includes("add") || al.includes("submit") ||
            al.includes("save") || al.includes("ok") || al.includes("done") || al.includes("confirm") ||
            al.includes("插入") || al.includes("添加") || al.includes("提交") ||
            al.includes("保存") || al.includes("确定") || al.includes("完成") || al.includes("确认")
          const isCancel =
            t.includes("cancel") || t.includes("close") || t.includes("back") ||
            t.includes("取消") || t.includes("关闭") || t.includes("返回") ||
            al.includes("cancel") || al.includes("close") || al.includes("back") ||
            al.includes("取消") || al.includes("关闭") || al.includes("返回")
          return (textMatch || ariaMatch || isSubmit || isPrimary) && !isCancel
        }) as HTMLElement | null
      }
      if (submit) {
        const enabled = await waitForAngularEnabled(submit, 5000)
        if (!enabled) return { ok: false, error: "Submit button did not become enabled (URL may be invalid)" }
        // Full pointer sequence for Angular reliability
        submit.focus()
        submit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
        submit.click()
      } else {
        // Enter key fallback on the URL input
        urlEl.focus()
        urlEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        urlEl.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        urlEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        const form = urlEl.closest("form")
        if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      }

      // Bug fix: extend timeout to 30s for slow sources (YouTube transcript fetch);
      // pass dialog selector so we can accept "dialog closed" as a success signal.
      const success = await waitForSuccess(before, S.sourceRow.css[0], 30_000, S.dialogContainer.css[0])
      return success.ok ? { ok: true } : { ok: false, error: `Source did not appear after submit (${success.diagnostic || "30s timeout"})` }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}

// ---------------------------------------------------------------------------
// Self-contained runner: import Text.
//
// args: [text, selectorsJSON]
// ---------------------------------------------------------------------------
export function importTextRunner(text: string, selectorsJSON: string): Promise<{ ok: boolean; error?: string }> {
  // The structure mirrors importUrlRunner. Helpers are duplicated because the function
  // must be self-contained for chrome.scripting.executeScript serialization.

  function parseSelectors(): SelectorRegistry | null {
    try {
      return JSON.parse(selectorsJSON) as SelectorRegistry
    } catch {
      return null
    }
  }

  function resolveStrategy<T extends Element>(
    s: SelectorStrategy | undefined,
    timeoutMs = 3000,
    root: ParentNode = document,
  ): T | null {
    if (!s) return null
    for (const css of s.css || []) {
      try {
        const el = root.querySelector(css)
        if (el) return el as T
      } catch {
        // skip
      }
    }
    // Phase 5 review: text/aria/role fallbacks scan descendants of `root`.
    void timeoutMs
    const all = (root as Document | Element).querySelectorAll?.("*") || []
    for (const el of Array.from(all)) {
      const html = el as HTMLElement
      if (s.textContent) {
        const txt = (html.textContent || "").trim().slice(0, 200)
        if (s.textContent.some(t => txt.toLowerCase().includes(t.toLowerCase()))) return html as unknown as T
      }
      if (s.ariaLabel) {
        const al = html.getAttribute?.("aria-label") || ""
        if (s.ariaLabel.some(t => al.toLowerCase().includes(t.toLowerCase()))) return html as unknown as T
      }
      if (s.role && html.getAttribute?.("role") === s.role) return html as unknown as T
    }
    return null
  }

  /** Phase 5 review fix: dismiss any leftover dialog from a previous iteration. */
  function closeAnyOpenDialog(S: SelectorRegistry): void {
    const dialog = resolveStrategy(S.dialogContainer, 100)
    if (!dialog) return
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }))
    ;(dialog as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }))
  }

  function setAngularValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
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

  function waitForDomQuiescence(root: Node, quietMs = 80, timeoutMs = 5000): Promise<void> {
    return new Promise<void>(resolve => {
      const deadline = Date.now() + timeoutMs
      let lastMutation = Date.now()
      const observer = new MutationObserver(() => {
        lastMutation = Date.now()
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "aria-disabled", "aria-hidden"],
      })
      const poll = () => {
        if (Date.now() - lastMutation >= quietMs || Date.now() >= deadline) {
          observer.disconnect()
          resolve()
          return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    })
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

  function currentSourceCount(selector: string): number {
    try {
      return document.querySelectorAll(selector).length
    } catch {
      return 0
    }
  }

  async function openAddSourceDialog(S: SelectorRegistry): Promise<Element> {
    const existing = resolveStrategy(S.dialogContainer, 200)
    if (existing) return existing

    // Bug fix: try the registry first; if it misses, fall back to a permissive scan
    // for any button whose text/aria mentions "add" (NotebookLM UI keeps changing).
    let btn: HTMLElement | null = resolveStrategy<HTMLElement>(S.addSourceButton, 1500)
    if (!btn) {
      // Permissive fallback: any clickable element with short text mentioning "add"
      const allBtns = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
      btn = allBtns.find(b => {
        const el = b as HTMLElement
        const t = (el.textContent || "").trim().toLowerCase()
        const al = (el.getAttribute("aria-label") || "").toLowerCase()
        const icon = el.querySelector("mat-icon, .material-icons")
        const iconText = icon ? (icon.textContent || "").trim().toLowerCase() : ""
        // Length < 30 to avoid matching "Add a source to your notebook..." paragraphs
        return t.length < 30 && (
          t === "add" || t === "add source" || t === "add sources" ||
          t === "添加" || t === "添加来源" || t === "新增来源" ||
          al === "add" || al === "add source" || al === "add sources" ||
          al === "添加" || al === "添加来源" || al === "新增来源" ||
          iconText === "add"
        )
      }) as HTMLElement | null
    }
    if (!btn) {
      // Diagnostic: dump all visible buttons so the user can tell us the actual UI
      const sample = Array.from(document.querySelectorAll("button"))
        .slice(0, 20)
        .map(b => ({
          text: (b.textContent || "").trim().slice(0, 40),
          aria: b.getAttribute("aria-label") || "",
          classes: (b.className || "").slice(0, 80),
        }))
        .filter(s => s.text || s.aria)
      throw new Error(`Add-source button not found. Visible buttons: ${JSON.stringify(sample).slice(0, 400)}`)
    }
    // Kimi review fix: full pointer + mouse + click sequence — programmatic .click()
    // alone sometimes doesn't trigger Angular's event listeners.
    btn.focus()
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
    btn.click()
    const dialogSelector = S.dialogContainer.css[0]
    const dialog = await waitForSelector(dialogSelector, 5000)
    if (!dialog) throw new Error("Add-source dialog did not open after click")
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    return dialog
  }

  async function navigateToTextSubPage(S: SelectorRegistry, dialog: Element): Promise<void> {
    if (resolveStrategy(S.textInput, 200, dialog)) return
    const backBtn = resolveStrategy<HTMLElement>(S.backButton, 200, dialog)
    if (backBtn) {
      backBtn.click()
      await waitForDomQuiescence(dialog as Node, 100, 1000)
      await waitForRaf(2)
    }
    // Try registry first, then permissive fallback
    let textBtn: HTMLElement | null = resolveStrategy<HTMLElement>(S.copiedTextOption, 1500, dialog)
    if (!textBtn) {
      const allBtns = Array.from(dialog.querySelectorAll("button, [role='button'], a[role='button']"))
      textBtn = allBtns.find(b => {
        const el = b as HTMLElement
        const t = (el.textContent || "").trim().toLowerCase()
        const al = (el.getAttribute("aria-label") || "").toLowerCase()
        const icon = el.querySelector("mat-icon, .material-icons, img")
        const iconText = icon ? (icon.textContent || icon.getAttribute("alt") || "").trim().toLowerCase() : ""
        return t.length < 30 && (
          t.includes("copied text") || t.includes("text") || t === "paste" || t.includes("paste text") ||
          t.includes("复制的文字") || t.includes("文字") || t.includes("粘贴") ||
          al.includes("copied text") || al.includes("text") || al.includes("paste") ||
          al.includes("复制的文字") || al.includes("文字") || al.includes("粘贴") ||
          iconText === "content_paste" || iconText === "text"
        )
      }) as HTMLElement | null
    }
    if (!textBtn) {
      const sample = Array.from(dialog.querySelectorAll("button, [role='button']"))
        .slice(0, 15)
        .map(b => ({ text: (b.textContent || "").trim().slice(0, 40), aria: b.getAttribute("aria-label") || "" }))
      throw new Error(`Copied-text option not found in dialog. Buttons: ${JSON.stringify(sample).slice(0, 400)}`)
    }
    textBtn.click()
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    const textArea = resolveStrategy(S.textInput, 3000, dialog)
    if (!textArea) {
      throw new Error("Text input did not appear after clicking Copied-text option")
    }
  }

  /** Phase 5 review fix: use MutationObserver instead of fixed setTimeout polling.
   *  Bug fix: also accept "dialog closed" as a success signal. */
  async function waitForSuccess(
    beforeCount: number,
    sourceRowSelector: string,
    timeoutMs: number,
    dialogSelector?: string,
  ): Promise<{ ok: boolean; diagnostic?: string }> {
    return new Promise<{ ok: boolean; diagnostic?: string }>(resolve => {
      let settled = false
      const startTime = Date.now()
      const finish = (ok: boolean, diagnostic?: string) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(deadlineTimer)
        resolve({ ok, diagnostic })
      }
      const check = () => {
        if (document.querySelectorAll(sourceRowSelector).length > beforeCount) {
          finish(true)
          return
        }
        if (dialogSelector && Date.now() - startTime > 2000) {
          const dialog = document.querySelector(dialogSelector)
          if (!dialog) {
            setTimeout(() => finish(true, "dialog closed; assumed accepted"), 1500)
          }
        }
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      check()
      const deadlineTimer = setTimeout(() => {
        const sourceCount = document.querySelectorAll(sourceRowSelector).length
        const dialogOpen = dialogSelector ? !!document.querySelector(dialogSelector) : false
        finish(false, `timeout after ${timeoutMs}ms; sourceCount=${sourceCount} (before=${beforeCount}); dialogOpen=${dialogOpen}`)
      }, timeoutMs)
    })
  }

  return (async () => {
    try {
      if (!text || text.trim().length === 0) return { ok: false, error: "Empty text" }
      const S = parseSelectors()
      if (!S) return { ok: false, error: "Failed to parse selectors arg" }
      // Phase 5 review fix: dismiss any leftover dialog from a previous iteration
      closeAnyOpenDialog(S)
      await waitForRaf(1)

      const before = currentSourceCount(S.sourceRow.css[0])
      const dialog = await openAddSourceDialog(S)
      await navigateToTextSubPage(S, dialog)

      const textEl = resolveStrategy<HTMLTextAreaElement>(S.textInput, 2000, dialog)
      if (!textEl) return { ok: false, error: "Text textarea not found" }
      setAngularValue(textEl, text)
      await waitForRaf(2)

      // Kimi review round 3 fix: apply the same submit fallback + Enter + pointer
      // sequence as importUrlRunner. Previously text import used only registry
      // selector + bare .click(), which is fragile against Angular UI drift.
      let submit: HTMLElement | null = resolveStrategy<HTMLElement>(S.submitButton, 1500, dialog)
      if (!submit) {
        const allDialogBtns = Array.from(dialog.querySelectorAll("button"))
        submit = allDialogBtns.find(b => {
          const t = (b.textContent || "").trim().toLowerCase()
          const al = (b.getAttribute("aria-label") || "").toLowerCase()
          const isSubmit = b.getAttribute("type") === "submit"
          const isPrimary =
            b.classList.contains("mat-primary") ||
            b.classList.contains("mdc-button--unelevated") ||
            b.classList.contains("mat-mdc-unelevated-button")
          const textMatch =
            t.includes("insert") || t.includes("add") || t.includes("submit") ||
            t.includes("save") || t.includes("ok") || t.includes("done") || t.includes("confirm") ||
            t.includes("插入") || t.includes("添加") || t.includes("提交") ||
            t.includes("保存") || t.includes("确定") || t.includes("完成") || t.includes("确认")
          const ariaMatch =
            al.includes("insert") || al.includes("add") || al.includes("submit") ||
            al.includes("save") || al.includes("ok") || al.includes("done") || al.includes("confirm") ||
            al.includes("插入") || al.includes("添加") || al.includes("提交") ||
            al.includes("保存") || al.includes("确定") || al.includes("完成") || al.includes("确认")
          const isCancel =
            t.includes("cancel") || t.includes("close") || t.includes("back") ||
            t.includes("取消") || t.includes("关闭") || t.includes("返回") ||
            al.includes("cancel") || al.includes("close") || al.includes("back") ||
            al.includes("取消") || al.includes("关闭") || al.includes("返回")
          return (textMatch || ariaMatch || isSubmit || isPrimary) && !isCancel
        }) as HTMLElement | null
      }
      if (submit) {
        const enabled = await waitForAngularEnabled(submit, 5000)
        if (!enabled) return { ok: false, error: "Submit button did not become enabled" }
        submit.focus()
        submit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
        submit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
        submit.click()
      } else {
        // Enter key fallback on the text input
        textEl.focus()
        textEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        textEl.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        textEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        const form = textEl.closest("form")
        if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      }

      // Bug fix: extend timeout to 30s for slow sources (YouTube transcript fetch);
      // pass dialog selector so we can accept "dialog closed" as a success signal.
      const success = await waitForSuccess(before, S.sourceRow.css[0], 30_000, S.dialogContainer.css[0])
      return success.ok ? { ok: true } : { ok: false, error: `Source did not appear after submit (${success.diagnostic || "30s timeout"})` }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}
