/**
 * Per-tab serialize queue — ADR-015 defense-in-depth.
 *
 * Companion tab-lease is authoritative; this only prevents concurrent CDP/scripting
 * races on the same Chrome tabId when messages interleave in the extension SW.
 *
 * Ops without a finite numeric tabId bypass the queue (list_tabs, create_tab, …).
 */

export class TabQueue {
  private chains: Map<number, Promise<unknown>> = new Map()

  /**
   * Run `fn` after any prior work for `tabId` settles.
   * Different tabIds run in parallel. Invalid/missing tabId runs immediately.
   */
  async run<T>(tabId: number | undefined | null, fn: () => Promise<T>): Promise<T> {
    if (typeof tabId !== "number" || !Number.isFinite(tabId)) {
      return fn()
    }
    const prev = this.chains.get(tabId) || Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    // Chain after prev settles; stored entry must be the same object we compare in finally
    // so empty queues can be GC'd (do not store tail.catch() while comparing against tail).
    const tail = prev.then(() => gate).catch(() => {})
    this.chains.set(tabId, tail)
    await prev.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      if (this.chains.get(tabId) === tail) {
        this.chains.delete(tabId)
      }
    }
  }

  /** Number of tabs currently holding a queue chain (test / diagnostics). */
  size(): number {
    return this.chains.size
  }

  clear(): void {
    this.chains.clear()
  }
}

/** Coerce tool params.tabId to a finite number, else undefined. */
export function coerceTabId(tabIdRaw: unknown): number | undefined {
  if (typeof tabIdRaw === "number" && Number.isFinite(tabIdRaw)) {
    return tabIdRaw
  }
  if (tabIdRaw != null && tabIdRaw !== "" && Number.isFinite(Number(tabIdRaw))) {
    return Number(tabIdRaw)
  }
  return undefined
}
