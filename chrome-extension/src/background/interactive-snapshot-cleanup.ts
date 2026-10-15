/** Browser-session resource accounting only; never restores a locator or authority. */
export type SnapshotCode = "SNAPSHOT_SCOPE_REQUIRED" | "SNAPSHOT_STALE" | "SNAPSHOT_INCOMPLETE" | "SNAPSHOT_CAPACITY" | "SNAPSHOT_UNSUPPORTED_DOCUMENT" | "SNAPSHOT_UNSUPPORTED_CONTROL" | "ELEMENT_OCCLUDED" | "SNAPSHOT_FAILED" | "ELEMENT_AMBIGUOUS"
export class SnapshotRefusal extends Error {
  constructor(readonly code: SnapshotCode) { super(code + ": Numbered control request was refused.") }
}
export const SNAPSHOT_CLEANUP_KEY = "cmspark.numberedSnapshot.cleanup.v1"
type StoredClaim = { slot: number; tabId: number; group: string }
export type SnapshotClaim = Readonly<StoredClaim> & { readonly key?: string; readonly quarantine: boolean; cleanupAttempted: boolean }
type SessionStorage = { get: (key: string) => Promise<any>; set: (value: Record<string, unknown>) => Promise<void> }
const groupName = (slot: number) => `cmspark-numbered-controls-v1-slot-${slot}`

export class SnapshotCleanup {
  private claims = new Map<number, SnapshotClaim>()
  private tail: Promise<unknown> = Promise.resolve()
  private initialized?: Promise<void>
  private poisoned = false
  constructor(private storage: () => SessionStorage = () => chrome.storage.session) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
  private fail(): never { this.poisoned = true; throw new SnapshotRefusal("SNAPSHOT_FAILED") }
  private healthy() { if (this.poisoned) throw new SnapshotRefusal("SNAPSHOT_FAILED") }
  initialize(): Promise<void> {
    return this.initialized ??= this.serial(async () => {
      try {
        const response = await this.storage().get(SNAPSHOT_CLEANUP_KEY)
        if (!response || typeof response !== "object" || Array.isArray(response)) this.fail()
        if (!Object.hasOwn(response, SNAPSHOT_CLEANUP_KEY)) return
        const value = response[SNAPSHOT_CLEANUP_KEY]
        if (!Array.isArray(value) || value.length > 8) this.fail()
        const next = new Map<number, SnapshotClaim>()
        for (const row of value) {
          if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 3 || !["slot", "tabId", "group"].every(k => Object.hasOwn(row, k)) || !Number.isInteger(row.slot) || row.slot < 0 || row.slot > 7 || next.has(row.slot) || !Number.isSafeInteger(row.tabId) || row.tabId <= 0 || row.group !== groupName(row.slot)) this.fail()
          next.set(row.slot, { slot: row.slot, tabId: row.tabId, group: row.group, quarantine: true, cleanupAttempted: false })
        }
        this.claims = next
      } catch { this.fail() }
    })
  }
  private stored(exclude?: SnapshotClaim): StoredClaim[] {
    return [...this.claims.values()].filter(c => c !== exclude).sort((a, b) => a.slot - b.slot).map(({ slot, tabId, group }) => ({ slot, tabId, group }))
  }
  async acquire(key: string, tabId: number): Promise<SnapshotClaim> {
    await this.initialize()
    return this.serial(async () => {
      this.healthy()
      if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new SnapshotRefusal("SNAPSHOT_STALE")
      if ([...this.claims.values()].some(c => c.key === key)) throw new SnapshotRefusal("SNAPSHOT_CAPACITY")
      const slot = Array.from({ length: 8 }, (_, i) => i).find(i => !this.claims.has(i))
      if (slot === undefined) throw new SnapshotRefusal("SNAPSHOT_CAPACITY")
      const claim: SnapshotClaim = { slot, tabId, group: groupName(slot), key, quarantine: false, cleanupAttempted: false }
      this.claims.set(slot, claim)
      try { await this.storage().set({ [SNAPSHOT_CLEANUP_KEY]: this.stored() }) }
      catch { this.fail() } // Uncertain write: keep occupied; never roll back by assumption.
      return claim
    })
  }
  check(claim: SnapshotClaim) {
    this.healthy()
    if (claim.quarantine || this.claims.get(claim.slot) !== claim) throw new SnapshotRefusal("SNAPSHOT_STALE")
  }
  async retire(claim: SnapshotClaim): Promise<boolean> {
    return this.serial(async () => {
      if (claim.quarantine || this.poisoned) return false
      if (this.claims.get(claim.slot) !== claim) return true
      try { await this.storage().set({ [SNAPSHOT_CLEANUP_KEY]: this.stored(claim) }) }
      catch { this.poisoned = true; return false }
      if (this.claims.get(claim.slot) === claim) this.claims.delete(claim.slot)
      return true
    })
  }
  takeQuarantineCleanup(): ReadonlyArray<Readonly<StoredClaim>> {
    this.healthy()
    const result: StoredClaim[] = []
    for (const c of this.claims.values()) if (c.quarantine && !c.cleanupAttempted) {
      c.cleanupAttempted = true
      result.push({ slot: c.slot, tabId: c.tabId, group: c.group })
    }
    return result // Cleanup never retires inherited claims, even after a release ACK.
  }
}

/** One allocator for every controller/Bridge instance in this service worker. Lazy API access. */
export const sharedSnapshotCleanup = new SnapshotCleanup()
