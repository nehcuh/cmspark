/** #521 addressing only: bounded SW memory, never a grant or durable locator. */
export type SnapshotOwner = { scope_id: string; thread_id: string }
import { SnapshotCleanup, SnapshotRefusal, sharedSnapshotCleanup, type SnapshotClaim } from "./interactive-snapshot-cleanup"
export { SnapshotCleanup, SnapshotRefusal } from "./interactive-snapshot-cleanup"
export type { SnapshotCode } from "./interactive-snapshot-cleanup"
export function snapshotOwner(raw: unknown): SnapshotOwner | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  if (Object.keys(v).length !== 2 || typeof v.scope_id !== "string" || !/^[a-f0-9]{64}$/.test(v.scope_id) || typeof v.thread_id !== "string" || !v.thread_id || v.thread_id.length > 128) return undefined
  return { scope_id: v.scope_id, thread_id: v.thread_id }
}
export function hasSnapshotLocator(v: Record<string, unknown>): boolean {
  return Object.hasOwn(v, "snapshot_id") || Object.hasOwn(v, "element_id")
}
export type SnapshotRow = { id: number; role: string; label: string; state: string; can_click: boolean; can_type: boolean; ambiguous: boolean }
export type SnapshotRecord = { row: SnapshotRow; backendId: number; rect: number[] }
export type SnapshotBinding = { frameId: string; loaderId: string; documentId: number; contextId: number; urlHash: string; signature: string }
export type SnapshotSlot = { readonly key: string; readonly owner: SnapshotOwner; readonly tabId: number; readonly id: string; readonly expires: number; state: "capturing" | "ready" | "reserved" | "retiring"; readonly claim: SnapshotClaim; retiring?: Promise<boolean>; invalid: boolean; initializing: boolean; complete: boolean; binding?: SnapshotBinding; records: SnapshotRecord[] }
export class InteractiveSnapshotCache {
  private slots = new Map<string, SnapshotSlot>()
  // Pre-admission cancellation watchers have no ID, descriptor, claim or CDP resource.
  private pending = new Set<{ owner: SnapshotOwner; tabId: number; invalid: boolean }>()
  constructor(private now = () => performance.now(), private uuid = () => crypto.randomUUID(), readonly cleanup = sharedSnapshotCleanup, private onHydrated?: () => Promise<void>) {}
  private key(owner: SnapshotOwner, tabId: number) { return owner.scope_id + ":" + tabId }
  async begin(owner: SnapshotOwner, tabId: number): Promise<SnapshotSlot> {
    const pending = { owner: { ...owner }, tabId, invalid: false }, expires = this.now() + 30000
    this.pending.add(pending)
    owner = pending.owner // Stable internal identity across asynchronous storage boundaries.
    const guard = () => { if (pending.invalid || this.now() >= expires) throw new SnapshotRefusal("SNAPSHOT_STALE") }
    try {
      await this.cleanup.initialize(); guard()
      await this.onHydrated?.(); guard()
      for (const s of this.slots.values()) if (s.state === "ready" && (s.invalid || this.now() >= s.expires)) await this.finish(s)
      guard()
      const key = this.key(owner, tabId), old = this.slots.get(key)
      if (old) {
        if (old.state !== "ready") throw new SnapshotRefusal("SNAPSHOT_CAPACITY")
        if (!await this.finish(old)) throw new SnapshotRefusal("SNAPSHOT_CAPACITY")
        guard()
      }
      const claim = await this.cleanup.acquire(key, tabId)
      try { guard() } catch (e) { await this.cleanup.retire(claim); throw e }
      const s: SnapshotSlot = { key, owner: { ...owner }, tabId, id: this.uuid(), expires, claim, state: "capturing", invalid: false, initializing: true, complete: false, records: [] }
      this.slots.set(key, s)
      return s
    } catch (e) {
      if (pending.invalid || this.now() >= expires) throw new SnapshotRefusal("SNAPSHOT_STALE")
      throw e instanceof SnapshotRefusal ? e : new SnapshotRefusal("SNAPSHOT_FAILED")
    } finally { this.pending.delete(pending) }
  }
  check(s: SnapshotSlot) {
    if (this.slots.get(s.key) !== s || s.invalid || this.now() >= s.expires) throw new SnapshotRefusal("SNAPSHOT_STALE")
    this.cleanup.check(s.claim)
  }
  remaining(s: SnapshotSlot) { return Math.max(0, s.expires - this.now()) }
  holdFailedCleanup(s: SnapshotSlot) { s.invalid = true; s.state = "reserved" }
  destroyedContext(tabId: number) { this.invalidateTab(tabId, true) }
  commit(s: SnapshotSlot, binding: SnapshotBinding, records: SnapshotRecord[], complete: boolean) {
    this.check(s)
    if (s.state !== "capturing" || records.length > 64) throw new SnapshotRefusal("SNAPSHOT_FAILED")
    s.initializing = false
    s.binding = { ...binding }
    s.records = records.map(v => ({ backendId: v.backendId, rect: [...v.rect], row: { ...v.row } }))
    s.complete = complete
    s.state = "ready"
  }
  reserve(owner: SnapshotOwner, tabId: number, id: string): SnapshotSlot {
    const s = this.slots.get(this.key(owner, tabId))
    if (!s || s.owner.thread_id !== owner.thread_id || s.id !== id || s.state !== "ready") throw new SnapshotRefusal("SNAPSHOT_STALE")
    this.check(s)
    s.state = "reserved"
    if (!s.complete) { void this.finish(s); throw new SnapshotRefusal("SNAPSHOT_INCOMPLETE") }
    return s
  }
  finish(s: SnapshotSlot): Promise<boolean> {
    if (this.slots.get(s.key) !== s) return Promise.resolve(true)
    if (s.retiring) return s.retiring
    s.invalid = true; s.state = "retiring"; s.records = []
    return s.retiring = this.cleanup.retire(s.claim).then(retired => {
      if (retired && this.slots.get(s.key) === s) this.slots.delete(s.key)
      else if (!retired) this.holdFailedCleanup(s)
      return retired
    })
  }
  invalidateTab(tabId: number, domainEvent = false) {
    for (const p of this.pending) if (p.tabId === tabId) p.invalid = true
    for (const s of this.slots.values()) if (s.tabId === tabId && !(domainEvent && s.initializing)) this.invalidate(s)
  }
  invalidateThread(threadId: string) {
    for (const p of this.pending) if (p.owner.thread_id === threadId) p.invalid = true
    for (const s of this.slots.values()) if (s.owner.thread_id === threadId) this.invalidate(s)
  }
  clear() { for (const p of this.pending) p.invalid = true; for (const s of this.slots.values()) this.invalidate(s) }
  private invalidate(s: SnapshotSlot) { s.invalid = true; if (s.state === "ready") void this.finish(s) }
  get size() { return this.slots.size }
}
