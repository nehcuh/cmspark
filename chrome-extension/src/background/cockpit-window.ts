// Cockpit window manager — L2 Computer Use surface (UI Mode P1 + R1 persist).
// Spec: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §3 / §6 P1
//
// Owns chrome.windows lifecycle. Side panel and other pages only send
// cockpit.open / focus / close / status messages.
//
// R1 (2026-07-27): persist windowId in chrome.storage.session + reclaim via
// windows.getAll matching cockpit URL after SW death.

/** Plasmo builds `src/tabs/cockpit.tsx` → `tabs/cockpit.html`. */
export const COCKPIT_PATH = "tabs/cockpit.html"

export const COCKPIT_DEFAULT_WIDTH = 720
export const COCKPIT_DEFAULT_HEIGHT = 560

/** Session storage key for surviving MV3 service-worker restarts. */
export const COCKPIT_SESSION_KEY = "cmspark.cockpitWindowId"

let cockpitWindowId: number | null = null
let onRemovedHooked = false
/** In-flight open — concurrent openOrFocusCockpit callers chain on this promise. */
let openInFlight: Promise<number | null> | null = null
let hydrateInFlight: Promise<void> | null = null

export function getCockpitWindowId(): number | null {
  return cockpitWindowId
}

export function cockpitUrl(): string {
  return chrome.runtime.getURL(COCKPIT_PATH)
}

/** Pure: whether a tab URL is our cockpit page (handles query/hash). */
export function isCockpitTabUrl(tabUrl: string | undefined, expectedBase: string): boolean {
  if (!tabUrl) return false
  try {
    const a = new URL(tabUrl)
    const b = new URL(expectedBase)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    return tabUrl.split("?")[0].split("#")[0] === expectedBase.split("?")[0].split("#")[0]
  }
}

async function persistWindowId(id: number | null): Promise<void> {
  try {
    if (id == null) {
      await chrome.storage.session.remove(COCKPIT_SESSION_KEY)
    } else {
      await chrome.storage.session.set({ [COCKPIT_SESSION_KEY]: id })
    }
  } catch {
    // session storage may be unavailable in unit tests without chrome mock
  }
}

async function readPersistedWindowId(): Promise<number | null> {
  try {
    const got = await chrome.storage.session.get(COCKPIT_SESSION_KEY)
    const v = got?.[COCKPIT_SESSION_KEY]
    return typeof v === "number" && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function ensureOnRemoved(): void {
  if (onRemovedHooked) return
  onRemovedHooked = true
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === cockpitWindowId) {
      cockpitWindowId = null
      void persistWindowId(null)
    }
  })
}

/** Probe whether our tracked window still exists. */
async function windowExists(id: number): Promise<boolean> {
  try {
    await chrome.windows.get(id)
    return true
  } catch {
    return false
  }
}

/** Find an existing cockpit window by scanning tabs (SW reclaim). */
export async function reclaimCockpitWindowId(): Promise<number | null> {
  const expected = cockpitUrl()
  try {
    const wins = await chrome.windows.getAll({ populate: true })
    for (const w of wins) {
      if (w.id == null) continue
      const tabs = w.tabs || []
      for (const t of tabs) {
        if (isCockpitTabUrl(t.url, expected)) {
          return w.id
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/** Hydrate in-memory id from session storage or live windows. */
async function hydrateCockpitWindowId(): Promise<void> {
  if (cockpitWindowId != null) {
    if (await windowExists(cockpitWindowId)) return
    cockpitWindowId = null
    await persistWindowId(null)
  }
  const stored = await readPersistedWindowId()
  if (stored != null && (await windowExists(stored))) {
    cockpitWindowId = stored
    return
  }
  if (stored != null) {
    await persistWindowId(null)
  }
  const reclaimed = await reclaimCockpitWindowId()
  if (reclaimed != null) {
    cockpitWindowId = reclaimed
    await persistWindowId(reclaimed)
  }
}

function ensureHydrated(): Promise<void> {
  if (!hydrateInFlight) {
    hydrateInFlight = hydrateCockpitWindowId().finally(() => {
      hydrateInFlight = null
    })
  }
  return hydrateInFlight
}

async function openOrFocusCockpitImpl(): Promise<number | null> {
  ensureOnRemoved()
  await ensureHydrated()

  if (cockpitWindowId != null) {
    const ok = await windowExists(cockpitWindowId)
    if (ok) {
      try {
        await chrome.windows.update(cockpitWindowId, {
          focused: true,
          drawAttention: true,
        })
        return cockpitWindowId
      } catch {
        cockpitWindowId = null
        await persistWindowId(null)
      }
    } else {
      cockpitWindowId = null
      await persistWindowId(null)
    }
  }

  // Last chance: reclaim without stored id
  const reclaimed = await reclaimCockpitWindowId()
  if (reclaimed != null) {
    cockpitWindowId = reclaimed
    await persistWindowId(reclaimed)
    try {
      await chrome.windows.update(reclaimed, { focused: true, drawAttention: true })
      return reclaimed
    } catch {
      cockpitWindowId = null
      await persistWindowId(null)
    }
  }

  try {
    const win = await chrome.windows.create({
      url: cockpitUrl(),
      type: "popup",
      width: COCKPIT_DEFAULT_WIDTH,
      height: COCKPIT_DEFAULT_HEIGHT,
      focused: true,
    })
    cockpitWindowId = win.id ?? null
    await persistWindowId(cockpitWindowId)
    return cockpitWindowId
  } catch {
    cockpitWindowId = null
    await persistWindowId(null)
    return null
  }
}

/**
 * Open cockpit if needed, otherwise focus + drawAttention.
 * Concurrent callers share one in-flight promise (no duplicate windows).
 */
export async function openOrFocusCockpit(): Promise<number | null> {
  if (openInFlight) return openInFlight
  openInFlight = openOrFocusCockpitImpl().finally(() => {
    openInFlight = null
  })
  return openInFlight
}

export async function focusCockpit(): Promise<boolean> {
  await ensureHydrated()
  if (cockpitWindowId == null) return false
  try {
    await chrome.windows.update(cockpitWindowId, {
      focused: true,
      drawAttention: true,
    })
    return true
  } catch {
    cockpitWindowId = null
    await persistWindowId(null)
    return false
  }
}

/** Close cockpit window if open. Does not abort the computer task. */
export async function closeCockpit(): Promise<void> {
  await ensureHydrated()
  if (cockpitWindowId == null) return
  const id = cockpitWindowId
  cockpitWindowId = null
  await persistWindowId(null)
  try {
    await chrome.windows.remove(id)
  } catch {
    // already gone
  }
}

export function cockpitStatus(): { open: boolean; windowId: number | null } {
  return { open: cockpitWindowId != null, windowId: cockpitWindowId }
}

/** Test helper — reset module state between unit tests. */
export function _resetCockpitWindowStateForTests(): void {
  cockpitWindowId = null
  openInFlight = null
  hydrateInFlight = null
}
