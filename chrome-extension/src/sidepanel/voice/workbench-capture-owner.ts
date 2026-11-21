type CaptureKind = "screen" | "microphone"

const ownerName = "cmspark-workbench-capture"
const kinds = new Set<CaptureKind>()
let lease: Promise<(() => void) | null> | undefined

export function focusWorkbenchCaptureOwner(): void {
  const channel = new BroadcastChannel(ownerName)
  channel.postMessage("focus")
  channel.close()
}

async function focusThisTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id === undefined) return
  await chrome.tabs.update(tab.id, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true })
}

function acquireOwner(): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    navigator.locks.request(ownerName, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return }
      const channel = new BroadcastChannel(ownerName)
      channel.onmessage = event => {
        if (event.data === "focus") void focusThisTab().catch(() => {})
      }
      try {
        await new Promise<void>(release => resolve(release))
      } finally {
        channel.close()
      }
    }).catch(reject)
  })
}

/** One workbench document may own both sources. Other documents never queue a stale gesture. */
export async function claimWorkbenchCapture(kind: CaptureKind): Promise<(() => void) | null> {
  if (kinds.has(kind)) return null
  kinds.add(kind)
  lease ??= acquireOwner()
  let unlock: (() => void) | null = null
  let released = false
  function release() {
    if (released) return
    released = true
    kinds.delete(kind)
    if (kinds.size === 0) {
      lease = undefined
      unlock?.()
    }
  }
  try {
    unlock = await lease
    if (unlock) return release
    release()
    return null
  } catch (error) {
    release()
    throw error
  }
}
