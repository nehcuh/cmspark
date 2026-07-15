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
    for (const css of s.css || []) {
      try {
        const el = root.querySelector(css)
        if (el) return el as T
      } catch {
        // invalid selector on this page; skip
      }
    }
    // Phase 5 review: text/aria/role fallbacks scan descendants of `root`.
    // When root=document (default), this could match the outer "Add source" button
    // when looking for the inner submit "Insert"/"Add" button. Caller must pass
    // the dialog container as root when looking for dialog-scoped elements.
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
    const btn = resolveStrategy<HTMLElement>(S.addSourceButton, 3000)
    if (!btn) throw new Error("Add-source button not found — NotebookLM UI may have changed")
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
    const websiteBtn = resolveStrategy<HTMLElement>(S.websiteLinkOption, 1500, dialog)
    if (!websiteBtn) throw new Error("Website/Link option not found in dialog")
    websiteBtn.click()
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    const urlArea = await waitForSelector(S.urlInput.css[0], 3000)
    if (!urlArea) throw new Error("URL textarea did not appear after navigating to Website sub-page")
  }

  /** Phase 5 review fix: use MutationObserver instead of fixed setTimeout polling.
   *  Watches the source-row container for the count to exceed `beforeCount`. */
  async function waitForSuccess(beforeCount: number, sourceRowSelector: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(deadlineTimer)
        resolve(ok)
      }
      const check = () => {
        if (document.querySelectorAll(sourceRowSelector).length > beforeCount) finish(true)
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      check() // initial check in case the source appeared before observer connected
      const deadlineTimer = setTimeout(() => finish(false), timeoutMs)
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

      const submit = resolveStrategy<HTMLElement>(S.submitButton, 2000, dialog)
      if (!submit) return { ok: false, error: "Submit button not found" }
      const enabled = await waitForAngularEnabled(submit, 5000)
      if (!enabled) return { ok: false, error: "Submit button did not become enabled (URL may be invalid)" }
      submit.click()

      const success = await waitForSuccess(before, S.sourceRow.css[0], 15_000)
      return success ? { ok: true } : { ok: false, error: "Source did not appear after submit" }
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
    const btn = resolveStrategy<HTMLElement>(S.addSourceButton, 3000)
    if (!btn) throw new Error("Add-source button not found — NotebookLM UI may have changed")
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
    const textBtn = resolveStrategy<HTMLElement>(S.copiedTextOption, 1500, dialog)
    if (!textBtn) throw new Error("Copied-text option not found in dialog")
    textBtn.click()
    await waitForDomQuiescence(dialog as Node, 100, 1500)
    await waitForRaf(2)
    const textArea = await waitForSelector(S.textInput.css[0], 3000)
    if (!textArea) throw new Error("Text textarea did not appear after navigating to Copied-text sub-page")
  }

  /** Phase 5 review fix: use MutationObserver instead of fixed setTimeout polling. */
  async function waitForSuccess(beforeCount: number, sourceRowSelector: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(deadlineTimer)
        resolve(ok)
      }
      const check = () => {
        if (document.querySelectorAll(sourceRowSelector).length > beforeCount) finish(true)
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      check()
      const deadlineTimer = setTimeout(() => finish(false), timeoutMs)
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

      const submit = resolveStrategy<HTMLElement>(S.submitButton, 2000, dialog)
      if (!submit) return { ok: false, error: "Submit button not found" }
      const enabled = await waitForAngularEnabled(submit, 5000)
      if (!enabled) return { ok: false, error: "Submit button did not become enabled" }
      submit.click()

      const success = await waitForSuccess(before, S.sourceRow.css[0], 15_000)
      return success ? { ok: true } : { ok: false, error: "Source did not appear after submit" }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}
