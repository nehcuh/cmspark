// Batch import orchestrator.
//
// Runs in the background service worker. Responsibilities:
//   1. Maintain batch state, persisted to chrome.storage.local AFTER EVERY ITEM
//      (MV3 SW can die mid-batch — must be resumable).
//   2. Find or open the NotebookLM tab; inject DOM-automation runners per item.
//   3. Throttle: random delay 500-1500ms between items + hard cap of 50 per batch.
//   4. Retry failed items up to 2× with exponential backoff.
//   5. Notify the side panel of progress after every item.
//
// Phase 5 review fixes baked in:
//   - `startBatch` waits for `resumeIfPending` to finish; refuses if persisted state exists.
//   - `ensureNotebookLmTab` navigates the matched tab to the target notebook URL
//     (silent notebook mismatch was a Critical — Phase 5 review).
//   - Tab-lost detection: on "No tab with id", re-acquire once; abort batch on second failure.
//   - `cancelled` is part of BatchState so it survives SW restart (Phase 5 review).
//
// Anti-pattern: do NOT cache batch state in closure across awaits — SW may die and
// the closure is lost. Always read/write via chrome.storage.local.

import { encodeSelectorsForRunner, importTextRunner, importUrlRunner } from "../notebooklm/dom-automation"
import type { BatchState, ImportItem, ImportItemResult } from "../notebooklm/types"

const STORAGE_KEY = "notebooklm_batch_state_v1"
const MAX_BATCH = 50
const MAX_RETRIES = 2
const MIN_DELAY_MS = 500
const MAX_DELAY_MS = 1500

let activeBatch: BatchState | null = null

/** SW boot sync — startBatch must await this to avoid race with resumeIfPending. */
let bootReadyPromise: Promise<void>
let bootReadyResolve!: () => void
bootReadyPromise = new Promise(r => {
  bootReadyResolve = r
})

/** Generate a batch ID. */
function newBatchId(): string {
  return `nb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Persist current batch state to chrome.storage.local. */
async function persist(state: BatchState): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state })
  } catch {
    // storage may be unavailable; in-memory state still authoritative within this SW life
  }
}

/** Read any persisted batch state (for resume after SW restart). */
export async function loadPersistedBatch(): Promise<BatchState | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const state = result?.[STORAGE_KEY] as BatchState | undefined
    return state && state.status === "running" && !state.cancelRequested ? state : null
  } catch {
    return null
  }
}

/** Clear persisted batch state (after completion / cancel). */
async function clearPersistedBatch(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Find an open NotebookLM tab, or open one. Returns tabId.
 *
 * Phase 5 review fix: if `notebookId` is set and the matched tab's URL doesn't
 * already point at that notebook, NAVIGATE the tab to the target URL instead of
 * silently reusing it (which caused imports to land in the wrong notebook). */
async function ensureNotebookLmTab(notebookId?: string): Promise<number> {
  const target = notebookId
    ? `https://notebooklm.google.com/notebook/${notebookId}`
    : "https://notebooklm.google.com/"

  const tabs = await chrome.tabs.query({ url: "https://notebooklm.google.com/*" })

  // Pick a tab — prefer exact notebook match if notebookId is set
  let chosenTab: chrome.tabs.Tab | undefined
  if (notebookId) {
    chosenTab = tabs.find(t => t.url?.includes(`/notebook/${notebookId}`))
  }
  if (!chosenTab && tabs.length > 0) {
    chosenTab = tabs[0]
  }

  if (chosenTab?.id) {
    // If notebookId is set and the chosen tab isn't on the right notebook, navigate.
    if (notebookId && chosenTab.url && !chosenTab.url.includes(`/notebook/${notebookId}`)) {
      await chrome.tabs.update(chosenTab.id, { url: target })
      await waitForTabReady(chosenTab.id, 15_000)
    }
    return chosenTab.id
  }

  // No existing tab — open one
  const tab = await chrome.tabs.create({ url: target, active: false })
  if (!tab.id) throw new Error("Failed to open NotebookLM tab")
  await waitForTabReady(tab.id, 15_000)
  return tab.id
}

/** Poll a tab until readyState=complete AND the add-source button is present.
 *
 * Phase 5 review fix: readyState=complete fires BEFORE Angular boot on SPAs,
 * causing the first item to fail selector match. Also wait for a known Angular
 * element (the add-source button) to appear. */
async function waitForTabReady(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Both readyState AND a NotebookLM-specific element must be present
          const addBtn = document.querySelector(".add-source-button") || document.querySelector('button[aria-label*="Add source"]') || document.querySelector('button[aria-label*="添加来源"]')
          return {
            ready: document.readyState,
            hasAddBtn: !!addBtn,
          }
        },
      })
      const r = result?.result as { ready: string; hasAddBtn: boolean } | undefined
      if (r?.ready === "complete" && r?.hasAddBtn) return
    } catch {
      // Tab may not be ready for injection yet
    }
    await new Promise(r => setTimeout(r, 300))
  }
}

/** Phase 5 review (Kimi gate): classify errors so the retry loop can skip
 *  deterministic ones (selector not found, malformed item) that won't be fixed
 *  by retrying. Only transient failures (tab lost, Angular desync, network blip)
 *  should retry. */
function isRetryableError(error: string | undefined): boolean {
  if (!error) return false
  // Tab-lost — re-acquire then retry
  if (error.startsWith("__TAB_LOST__")) return true
  // Transient runtime/injection errors
  if (error.includes("executeScript failed")) return true
  if (error.includes("Injection error")) return true
  if (error.includes("dialog did not open")) return true
  if (error.includes("did not become enabled")) return true
  if (error.includes("Source did not appear after submit")) return true
  // Selector / deterministic — NOT retryable (UI broke or item is bad)
  if (error.includes("not found")) return false
  if (error.includes("Item has")) return false
  if (error.includes("Empty text")) return false
  // Default — be optimistic, retry
  return true
}

/** Run a single import via injected runner. Returns ok + optional error. */
async function runOne(tabId: number, item: ImportItem): Promise<{ ok: boolean; error?: string }> {
  const isUrl = !!item.url
  const isText = !!item.text
  if (!isUrl && !isText) return { ok: false, error: "Item has neither url nor text" }
  if (isUrl && isText) return { ok: false, error: "Item has both url and text" }

  // Cache selectors once per SW life
  const selectorsJSON = encodeSelectorsForRunner()

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: isUrl ? importUrlRunner : importTextRunner,
      args: isUrl ? [item.url!, selectorsJSON] : [item.text!, selectorsJSON],
    })
    const frame = results?.[0] as any
    if (frame?.error) return { ok: false, error: `Injection error: ${frame.error}` }
    const result = frame?.result as { ok: boolean; error?: string } | undefined
    if (!result) return { ok: false, error: "Runner returned no result" }
    return result
  } catch (e: any) {
    const msg = e?.message || String(e)
    // Phase 5 review: detect tab-lost signals explicitly so the loop can re-acquire
    if (msg.includes("No tab with id") || msg.includes("Cannot access contents") || msg.includes("Tab was closed")) {
      return { ok: false, error: `__TAB_LOST__: ${msg}` }
    }
    return { ok: false, error: `executeScript failed: ${msg}` }
  }
}

/** Random delay between imports — anti-throttle. */
function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS))
  return new Promise(r => setTimeout(r, ms))
}

/** Broadcast progress to any listening side panel. */
async function broadcastProgress(state: BatchState): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "notebooklm.batch_progress",
      state,
    })
  } catch {
    // No listener — fine
  }
}

/** Read the cancel flag from the current batch (checks both in-memory + persisted). */
async function isCancelled(): Promise<boolean> {
  if (activeBatch && activeBatch.cancelRequested) return true
  const persisted = await loadPersistedBatch()
  return !persisted // loadPersistedBatch returns null if cancelled OR done
}

/** Start a new batch. Returns the initial state. */
export async function startBatch(
  items: ImportItem[],
  notebookId?: string,
): Promise<BatchState> {
  // Phase 5 review fix: wait for boot resume to finish first
  await bootReadyPromise
  // Phase 5 review fix: refuse if a persisted batch is in-flight
  const persisted = await loadPersistedBatch()
  if (persisted) {
    throw new Error(`Another batch is already running (id=${persisted.id}, resumed from SW restart). Wait or cancel first.`)
  }
  // Phase 5 review fix: refuse if in-memory batch is in-flight (separate from persisted check)
  if (activeBatch && activeBatch.status === "running") {
    throw new Error(`Another batch is already running (id=${activeBatch.id}). Wait or cancel first.`)
  }

  // Cap batch size
  if (items.length > MAX_BATCH) {
    items = items.slice(0, MAX_BATCH)
  }

  const state: BatchState = {
    id: newBatchId(),
    startedAt: new Date().toISOString(),
    items,
    results: new Array(items.length).fill(undefined),
    nextIndex: 0,
    status: "running",
    notebookId,
    cancelRequested: false,
  }
  activeBatch = state
  await persist(state)
  await broadcastProgress(state)

  // Fire and forget — the loop runs in the background
  runBatchLoop(state.notebookId).catch(async e => {
    if (activeBatch) {
      activeBatch.status = "error"
      activeBatch.finishedAt = new Date().toISOString()
      await persist(activeBatch)
      await broadcastProgress(activeBatch)
    }
    console.error("[notebooklm] batch loop crashed:", e)
  })

  return state
}

/** Cancel the running batch. */
export async function cancelBatch(): Promise<void> {
  if (activeBatch) {
    activeBatch.cancelRequested = true
    activeBatch.status = "cancelled"
    activeBatch.finishedAt = new Date().toISOString()
    await persist(activeBatch)
    await broadcastProgress(activeBatch)
    activeBatch = null
    await clearPersistedBatch()
  } else {
    // Phase 5 review: also clear any persisted state (e.g. user cancelled during SW restart)
    await clearPersistedBatch()
  }
}

/** Get current batch state (for UI polling). */
export function getActiveBatch(): BatchState | null {
  return activeBatch
}

/** The main batch loop. Reads/writes `activeBatch` and persists after every item. */
async function runBatchLoop(notebookId?: string): Promise<void> {
  if (!activeBatch) return
  let tabId: number | null = null
  let tabLostRetries = 0
  try {
    tabId = await ensureNotebookLmTab(notebookId)
  } catch (e: any) {
    if (activeBatch) {
      activeBatch.status = "error"
      activeBatch.finishedAt = new Date().toISOString()
      for (let i = activeBatch.nextIndex; i < activeBatch.items.length; i++) {
        activeBatch.results[i] = {
          item: activeBatch.items[i],
          ok: false,
          error: `Tab setup failed: ${e?.message || e}`,
          durationMs: 0,
        }
      }
      await persist(activeBatch)
      await broadcastProgress(activeBatch)
    }
    return
  }

  while (activeBatch && activeBatch.nextIndex < activeBatch.items.length) {
    // Phase 5 review: check cancel flag inside the loop (was only checked at loop top)
    if (activeBatch.cancelRequested) break

    const idx = activeBatch.nextIndex
    const item = activeBatch.items[idx]
    const startedAt = Date.now()

    // Retry loop — only retry transient errors (Phase 5 Kimi gate fix)
    let lastError: string | undefined
    let ok = false
    let tabLost = false
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Check cancel between retry attempts too
      if (activeBatch.cancelRequested) break
      if (!tabId) break

      const r = await runOne(tabId, item)
      if (r.ok) {
        ok = true
        break
      }
      lastError = r.error
      // Phase 5 review: detect tab-lost → re-acquire once, retry the same item
      if (lastError?.startsWith("__TAB_LOST__")) {
        tabLost = true
        try {
          tabId = await ensureNotebookLmTab(notebookId)
          tabLostRetries++
          if (tabLostRetries <= 2) continue // retry same item with new tab
          break
        } catch (e: any) {
          lastError = `Tab re-acquire failed: ${e?.message || e}`
          break
        }
      }
      // Kimi gate fix: don't retry deterministic errors
      if (!isRetryableError(lastError)) break
      // Exponential backoff before retry
      if (attempt < MAX_RETRIES) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 8000)
        await new Promise(r => setTimeout(r, backoff))
      }
    }

    // If we hit the tab-lost retry cap, abort the whole batch
    if (tabLost && tabLostRetries > 2) {
      if (activeBatch) {
        activeBatch.status = "error"
        activeBatch.finishedAt = new Date().toISOString()
        // Mark remaining items as failed
        for (let i = idx; i < activeBatch.items.length; i++) {
          activeBatch.results[i] = {
            item: activeBatch.items[i],
            ok: false,
            error: "NotebookLM tab closed repeatedly; batch aborted",
            durationMs: 0,
          }
        }
        activeBatch.nextIndex = activeBatch.items.length
        await persist(activeBatch)
        await broadcastProgress(activeBatch)
        activeBatch = null
        await clearPersistedBatch()
      }
      return
    }

    const result: ImportItemResult = {
      item,
      ok,
      durationMs: Date.now() - startedAt,
      ...(ok ? {} : { error: lastError || "Unknown error" }),
    }
    activeBatch.results[idx] = result
    activeBatch.nextIndex = idx + 1
    await persist(activeBatch)
    await broadcastProgress(activeBatch)

    // Throttle between items (skip on last)
    if (activeBatch.nextIndex < activeBatch.items.length && !activeBatch.cancelRequested) {
      await randomDelay()
    }
  }

  if (activeBatch && !activeBatch.cancelRequested) {
    activeBatch.status = "done"
    activeBatch.finishedAt = new Date().toISOString()
    await persist(activeBatch)
    await broadcastProgress(activeBatch)
    activeBatch = null
    await clearPersistedBatch()
  } else if (activeBatch && activeBatch.cancelRequested) {
    activeBatch.status = "cancelled"
    activeBatch.finishedAt = new Date().toISOString()
    await broadcastProgress(activeBatch)
    activeBatch = null
    await clearPersistedBatch()
  }
}

/** On SW startup, check for a persisted batch and resume it. */
export async function resumeIfPending(): Promise<void> {
  try {
    const persisted = await loadPersistedBatch()
    if (!persisted) return
    if (persisted.status !== "running") return
    if (persisted.cancelRequested) {
      await clearPersistedBatch()
      return
    }
    // Adopt as active and re-enter the loop
    activeBatch = persisted
    console.log(`[notebooklm] resuming batch ${persisted.id} from index ${persisted.nextIndex}`)
    runBatchLoop(persisted.notebookId).catch(async e => {
      if (activeBatch) {
        activeBatch.status = "error"
        activeBatch.finishedAt = new Date().toISOString()
        await persist(activeBatch)
        await broadcastProgress(activeBatch)
      }
      console.error("[notebooklm] resumed batch crashed:", e)
    })
  } finally {
    bootReadyResolve()
  }
}
