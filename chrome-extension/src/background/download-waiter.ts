/**
 * chrome.downloads completion waiter — primary transport for browser_download (D15).
 * Injectable downloads API for unit tests (mock onCreated/onChanged).
 *
 * Identity rule (BD-WAITER): only track download ids observed via onCreated
 * *after* waiter registration. Never latch pre-existing completes or foreign
 * in_progress/filename deltas without onCreated.
 */

export interface DownloadCompleteInfo {
  id: number
  filename: string
  url?: string
  fileSize?: number
  totalBytes?: number
  state: string
}

export type DownloadsApi = {
  onCreated: {
    addListener(cb: (item: chrome.downloads.DownloadItem) => void): void
    removeListener(cb: (item: chrome.downloads.DownloadItem) => void): void
  }
  onChanged: {
    addListener(cb: (delta: chrome.downloads.DownloadDelta) => void): void
    removeListener(cb: (delta: chrome.downloads.DownloadDelta) => void): void
  }
  search(
    query: chrome.downloads.DownloadQuery,
  ): Promise<chrome.downloads.DownloadItem[]>
}

export class DownloadWaitError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message || code)
    this.name = "DownloadWaitError"
    this.code = code
  }
}

export interface DownloadWaiter {
  wait(): Promise<DownloadCompleteInfo>
  dispose(): void
}

/**
 * Listen for a download that starts after registration, wait until complete.
 * filenameHint: optional substring filter on DownloadItem.filename (applied on
 * onCreated and again when resolving complete via search).
 */
export function createDownloadWaiter(opts: {
  timeoutMs: number
  filenameHint?: string
  tabId?: number
  downloadsApi: DownloadsApi
  /** test clock */
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}): DownloadWaiter {
  const api = opts.downloadsApi
  const now = opts.now || (() => Date.now())
  const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer || ((id) => clearTimeout(id))
  /** Wall time at registration — used to ignore stale search hits if ever consulted. */
  const registeredAtMs = now()

  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveP!: (v: DownloadCompleteInfo) => void
  let rejectP!: (e: Error) => void
  const promise = new Promise<DownloadCompleteInfo>((res, rej) => {
    resolveP = res
    rejectP = rej
  })

  /** Only ids seen via onCreated after registration. */
  const tracked = new Set<number>()

  const matchesHint = (filename: string | undefined) => {
    if (!opts.filenameHint) return true
    if (!filename) return false
    return filename.toLowerCase().includes(opts.filenameHint.toLowerCase())
  }

  const finishOk = (info: DownloadCompleteInfo) => {
    if (settled) return
    settled = true
    if (timer) clearTimer(timer)
    cleanup()
    resolveP(info)
  }

  const finishErr = (err: Error) => {
    if (settled) return
    settled = true
    if (timer) clearTimer(timer)
    cleanup()
    // Prevent unhandled rejection if dispose/timeout races ahead of wait() attachment.
    void promise.catch(() => {})
    rejectP(err)
  }

  const onCreated = (item: chrome.downloads.DownloadItem) => {
    if (settled) return
    // Prefer startTime when Chrome provides it (ISO string); otherwise accept.
    if (typeof item.startTime === "string" && item.startTime) {
      const startMs = Date.parse(item.startTime)
      if (Number.isFinite(startMs) && startMs + 50 < registeredAtMs) {
        // Started before we registered — not our download.
        return
      }
    }
    // Filename / URL hint filter (always when hint set)
    const nameOrUrl = item.filename || item.finalUrl || item.url || ""
    if (!matchesHint(nameOrUrl) && !matchesHint(item.filename)) return
    // P1 CORR-07: Chrome DownloadItem has no tabId. When caller scopes to a tab
    // without a filenameHint, only latch the first post-register download to
    // avoid binding a concurrent peer-tab download.
    if (opts.tabId != null && !opts.filenameHint && tracked.size > 0) return
    tracked.add(item.id)
    if (item.state === "complete" && item.filename) {
      finishOk({
        id: item.id,
        filename: item.filename,
        url: item.url,
        fileSize: item.fileSize,
        totalBytes: item.totalBytes,
        state: item.state,
      })
    }
  }

  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (settled) return
    const id = delta.id
    // BD-WAITER: never track from onChanged alone (would latch foreign / pre-existing).
    if (!tracked.has(id)) return

    if (delta.state?.current === "interrupted") {
      finishErr(
        new DownloadWaitError(
          "DOWNLOAD_CANCELED",
          `DOWNLOAD_CANCELED: download interrupted (id=${id})`,
        ),
      )
      return
    }
    if (delta.state?.current === "complete") {
      void api
        .search({ id })
        .then((items) => {
          const it = items[0]
          if (!it?.filename) {
            finishErr(
              new DownloadWaitError(
                "DOWNLOAD_FAILED",
                "DOWNLOAD_FAILED: complete but filename missing",
              ),
            )
            return
          }
          if (!matchesHint(it.filename)) {
            // Tracked id but hint no longer matches final name — keep waiting.
            return
          }
          finishOk({
            id: it.id,
            filename: it.filename,
            url: it.url,
            fileSize: it.fileSize,
            totalBytes: it.totalBytes,
            state: it.state || "complete",
          })
        })
        .catch((e) => {
          finishErr(
            new DownloadWaitError(
              "DOWNLOAD_FAILED",
              `DOWNLOAD_FAILED: ${e?.message || e}`,
            ),
          )
        })
    }
  }

  const cleanup = () => {
    try {
      api.onCreated.removeListener(onCreated)
    } catch {
      /* */
    }
    try {
      api.onChanged.removeListener(onChanged)
    } catch {
      /* */
    }
  }

  api.onCreated.addListener(onCreated)
  api.onChanged.addListener(onChanged)

  timer = setTimer(() => {
    finishErr(
      new DownloadWaitError(
        "DOWNLOAD_TIMEOUT",
        `DOWNLOAD_TIMEOUT: no completed download within ${opts.timeoutMs}ms`,
      ),
    )
  }, opts.timeoutMs)

  return {
    wait: () => promise,
    dispose: () => {
      if (!settled) {
        settled = true
        if (timer) clearTimer(timer)
        cleanup()
        // Soft-cancel: attach catch first so early-return paths (dispose before await wait)
        // do not surface unhandled rejections.
        void promise.catch(() => {})
        rejectP(new DownloadWaitError("DOWNLOAD_CANCELED", "DOWNLOAD_CANCELED: disposed"))
      } else {
        cleanup()
      }
    },
  }
}
