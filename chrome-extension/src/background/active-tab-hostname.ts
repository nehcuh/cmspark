// Resolve active-tab hostname for site-knowledge auto-load (ADR knowledge + skill-engine getBySite).
// Only used for knowledge/skill *selection* — never for cookie/trust security gates.

import { buildLogEventPayload } from "./log-forward-policy"

/**
 * Budget-drop signal through the existing log channel's local fan-out (same
 * chrome.runtime.sendMessage path as background logToCompanion, minus the WS
 * upload which lives in index.ts). Guarded: chrome is undefined under node:test.
 */
function logHostnameBudgetDrop(budgetMs: number): void {
  try {
    chrome.runtime
      .sendMessage(
        buildLogEventPayload("debug", "extension.hostname_budget_exceeded", {
          budget_ms: budgetMs,
        }),
      )
      .catch(() => {})
  } catch {
    /* no UI listeners / non-extension env */
  }
}

/**
 * Pure extract: http(s) only → hostname. Used by getActiveTabHostname and unit tests.
 * SW has no "current window"; callers should prefer lastFocusedWindow (see getActiveTabHostname).
 */
export function hostnameFromTabUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase().replace(/\.+$/, "")
    return hostname || undefined
  } catch {
    return undefined
  }
}

/**
 * Active focused browser tab hostname for chat.create / regenerate / file.upload.
 * - lastFocusedWindow: service worker has no currentWindow context (Pi/Claude review F2).
 * - No pinned-tab fallback: wrong site knowledge is worse than none (dual-review Q2).
 */
export async function getActiveTabHostname(): Promise<string | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return hostnameFromTabUrl(tabs[0]?.url)
  } catch {
    return undefined
  }
}

export interface ActiveTabContext {
  hostname: string
  context_tab_id: number
}

/** Only the browser-selected id crosses the new context wire; the Companion
 * resolves the actual tab again. No URL credentials/query/fragment here. */
export async function getActiveTabContext(): Promise<ActiveTabContext | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const tab = tabs[0]
    const hostname = hostnameFromTabUrl(tab?.url)
    if (!hostname || typeof tab?.id !== "number" || !Number.isSafeInteger(tab.id) || tab.id < 0) return undefined
    return { hostname, context_tab_id: tab.id }
  } catch {
    return undefined
  }
}

/**
 * Site-knowledge hostname is best-effort. Never stall chat.create / chat.user
 * echo on a hung tabs.query — 40ms is enough for the normal path. A budget
 * drop is logged (debug) instead of silently losing the hostname.
 */
export function withHostnameBudget<T>(
  getter: () => Promise<T | undefined>,
  timeoutMs = 40,
): Promise<T | undefined> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 40
  return new Promise((resolve) => {
    let done = false
    const finish = (value?: T) => {
      if (done) return
      done = true
      resolve(value)
    }
    const timer = setTimeout(() => {
      logHostnameBudgetDrop(ms)
      finish(undefined)
    }, ms)
    getter()
      .then((value) => {
        clearTimeout(timer)
        finish(value)
      })
      .catch(() => {
        clearTimeout(timer)
        finish(undefined)
      })
  })
}
