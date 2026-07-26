// Cockpit window manager — L2 Computer Use surface (UI Mode P1).
// Spec: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §3 / §6 P1
//
// Owns chrome.windows lifecycle. Side panel and other pages only send
// cockpit.open / focus / close / status messages.

/** Plasmo builds `src/tabs/cockpit.tsx` → `tabs/cockpit.html`. */
export const COCKPIT_PATH = "tabs/cockpit.html"

export const COCKPIT_DEFAULT_WIDTH = 720
export const COCKPIT_DEFAULT_HEIGHT = 560

let cockpitWindowId: number | null = null
let onRemovedHooked = false

export function getCockpitWindowId(): number | null {
  return cockpitWindowId
}

export function cockpitUrl(): string {
  return chrome.runtime.getURL(COCKPIT_PATH)
}

function ensureOnRemoved(): void {
  if (onRemovedHooked) return
  onRemovedHooked = true
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === cockpitWindowId) {
      cockpitWindowId = null
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

/**
 * Open cockpit if needed, otherwise focus + drawAttention.
 * Returns the window id, or null on failure.
 */
export async function openOrFocusCockpit(): Promise<number | null> {
  ensureOnRemoved()

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
      }
    } else {
      cockpitWindowId = null
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
    return cockpitWindowId
  } catch {
    cockpitWindowId = null
    return null
  }
}

export async function focusCockpit(): Promise<boolean> {
  if (cockpitWindowId == null) return false
  try {
    await chrome.windows.update(cockpitWindowId, {
      focused: true,
      drawAttention: true,
    })
    return true
  } catch {
    cockpitWindowId = null
    return false
  }
}

/** Close cockpit window if open. Does not abort the computer task. */
export async function closeCockpit(): Promise<void> {
  if (cockpitWindowId == null) return
  const id = cockpitWindowId
  cockpitWindowId = null
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
}
