// Batch import orchestrator.
//
// Runs in the background service worker. Responsibilities:
//   1. Maintain batch state, persisted to chrome.storage.local AFTER EVERY ITEM
//      (MV3 SW can die mid-batch — must be resumable).
//   2. Find or open the target NotebookLM tab and import each source via RPC.
//   3. Throttle: random delay 500-1500ms between items + hard cap of 50 per batch.
//   4. Retry failed items up to 2× with exponential backoff.
//   5. Notify the side panel of progress after every item.
//
// Each loop owns its batch object. Storage holds the last checkpoint for a new service worker.

import { addSourceViaRpc, addTextSourceViaRpc } from "../notebooklm/rpc-client"
import type { BatchState, ImportItem, ImportItemResult } from "../notebooklm/types"

const STORAGE_KEY = "notebooklm_batch_state_v1"
const MAX_BATCH = 50
const MAX_RETRIES = 2
const MIN_DELAY_MS = 500
const MAX_DELAY_MS = 1500

let activeBatch: BatchState | null = null

/** SW boot sync — startBatch must await this to avoid race with resumeIfPending. */
let bootReadyResolve!: () => void
const bootReadyPromise = new Promise<void>(r => {
  bootReadyResolve = r
})

/** Generate a batch ID. */
function newBatchId(): string {
  return `nb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

/** Poll a tab until readyState AND we're on a /notebook/ page.
 *
 * Kimi review catch: NotebookLM is an Angular SPA — readyState may stay at
 * "interactive" indefinitely. Accept "interactive" or "complete". The real
 * readiness signal is isNotebookPage (URL on /notebook/<id>). */
async function waitForTabReady(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          ready: document.readyState,
          pathname: location.pathname,
          isNotebookPage: location.pathname.startsWith("/notebook/"),
        }),
      })
      const r = result?.result as { ready: string; isNotebookPage: boolean } | undefined
      if ((r?.ready === "complete" || r?.ready === "interactive") && r?.isNotebookPage) return
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

async function runOne(
  item: ImportItem,
  notebookId: string | undefined,
  canSubmit: () => boolean,
): Promise<{ ok: boolean; error?: string }> {
  const isUrl = !!item.url
  const isText = !!item.text
  if (!isUrl && !isText) return { ok: false, error: "Item has neither url nor text" }
  if (isUrl && isText) return { ok: false, error: "Item has both url and text" }

  if (!notebookId) {
    return { ok: false, error: "RPC path requires a target notebookId (no 'use currently-open notebook' supported yet)" }
  }

  try {
    if (isUrl) {
      const r = await addSourceViaRpc(notebookId, item.url!, canSubmit)
      // Kimi review: RPC response is definitive — sourceId present = success.
      // No more false positives from dialog-closure heuristics.
      return r.ok
        ? { ok: true }
        : { ok: false, error: r.error || "RPC add source failed" }
    } else {
      const title = (item.text!.slice(0, 50).replace(/\n/g, " ").trim()) || "Imported text"
      const r = await addTextSourceViaRpc(notebookId, title, item.text!, canSubmit)
      return r.ok
        ? { ok: true }
        : { ok: false, error: r.error || "RPC add text failed" }
    }
  } catch (e: any) {
    return { ok: false, error: `RPC crashed: ${e?.message || String(e)}` }
  }
}

/** Random delay between imports — anti-throttle. */
function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS))
  return new Promise(r => setTimeout(r, ms))
}

/** Store a checkpoint before notifying the panel. An intervening cancel or start supersedes it. */
async function reportProgress(batch: BatchState): Promise<void> {
  if (activeBatch !== batch) return
  const status = batch.status
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: batch })
  } catch {
    // The panel still receives progress if storage is unavailable.
  }
  if (activeBatch !== batch || batch.status !== status) return
  try {
    await chrome.runtime.sendMessage({ type: "notebooklm.batch_progress", state: batch })
  } catch {
    // The side panel may be closed.
  }
}

async function releaseBatch(batch: BatchState): Promise<void> {
  if (activeBatch !== batch) return
  activeBatch = null
  await clearPersistedBatch()
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
  await reportProgress(state)
  launchBatch(state)
  return state
}

/** Cancel the running batch. */
export async function cancelBatch(): Promise<void> {
  await bootReadyPromise
  const batch = activeBatch
  if (!batch) {
    await clearPersistedBatch()
    return
  }
  batch.cancelRequested = true
  batch.status = "cancelled"
  batch.finishedAt = new Date().toISOString()
  await reportProgress(batch)
  await releaseBatch(batch)
}

/** Get current batch state (for UI polling). */
export function getActiveBatch(): BatchState | null {
  return activeBatch
}

function launchBatch(batch: BatchState): void {
  runBatchLoop(batch).catch(async error => {
    if (activeBatch !== batch || batch.cancelRequested) return
    batch.status = "error"
    batch.finishedAt = new Date().toISOString()
    await reportProgress(batch)
    console.error("[notebooklm] batch loop crashed:", error)
  })
}

async function runBatchLoop(batch: BatchState): Promise<void> {
  const isRunning = () => activeBatch === batch && !batch.cancelRequested
  if (!isRunning()) return
  let tabId: number | null = null
  let tabLostRetries = 0
  try {
    tabId = await ensureNotebookLmTab(batch.notebookId)
  } catch (e: any) {
    if (isRunning()) {
      batch.status = "error"
      batch.finishedAt = new Date().toISOString()
      for (let i = batch.nextIndex; i < batch.items.length; i++) {
        batch.results[i] = {
          item: batch.items[i],
          ok: false,
          error: `Tab setup failed: ${e?.message || e}`,
          durationMs: 0,
        }
      }
      await reportProgress(batch)
    }
    return
  }

  while (isRunning() && batch.nextIndex < batch.items.length) {
    const idx = batch.nextIndex
    const item = batch.items[idx]
    const startedAt = Date.now()

    // Retry loop — only retry transient errors (Phase 5 Kimi gate fix)
    let lastError: string | undefined
    let ok = false
    let tabLost = false
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Check cancel between retry attempts too
      if (!isRunning()) return
      if (!tabId) break

      const r = await runOne(item, batch.notebookId, isRunning)
      if (!isRunning()) return
      if (r.ok) {
        ok = true
        break
      }
      lastError = r.error
      // Phase 5 review: detect tab-lost → re-acquire once, retry the same item
      if (lastError?.startsWith("__TAB_LOST__")) {
        tabLost = true
        try {
          tabId = await ensureNotebookLmTab(batch.notebookId)
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

    if (!isRunning()) return

    // If we hit the tab-lost retry cap, abort the whole batch
    if (tabLost && tabLostRetries > 2) {
      batch.status = "error"
      batch.finishedAt = new Date().toISOString()
      // Mark remaining items as failed
      for (let i = idx; i < batch.items.length; i++) {
        batch.results[i] = {
          item: batch.items[i],
          ok: false,
          error: "NotebookLM tab closed repeatedly; batch aborted",
          durationMs: 0,
        }
      }
      batch.nextIndex = batch.items.length
      await reportProgress(batch)
      await releaseBatch(batch)
      return
    }

    const result: ImportItemResult = {
      item,
      ok,
      durationMs: Date.now() - startedAt,
      ...(ok ? {} : { error: lastError || "Unknown error" }),
    }
    batch.results[idx] = result
    batch.nextIndex = idx + 1
    await reportProgress(batch)

    // Throttle between items (skip on last)
    if (batch.nextIndex < batch.items.length && !batch.cancelRequested) {
      await randomDelay()
    }
  }

  if (!isRunning()) return
  batch.status = "done"
  batch.finishedAt = new Date().toISOString()
  await reportProgress(batch)
  await releaseBatch(batch)
}

/** On SW startup, check for a persisted batch and resume it. */
export async function resumeIfPending(): Promise<void> {
  try {
    const persisted = await loadPersistedBatch()
    if (!persisted) return
    activeBatch = persisted
    console.log(`[notebooklm] resuming batch ${persisted.id} from index ${persisted.nextIndex}`)
    launchBatch(persisted)
  } finally {
    bootReadyResolve()
  }
}
