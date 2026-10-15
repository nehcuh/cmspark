import test from "node:test"
import assert from "node:assert/strict"
import { InteractiveSnapshotCache, SnapshotRefusal, snapshotOwner, SnapshotCleanup, type SnapshotSlot } from "../src/background/interactive-snapshot-cache"
const owner = { scope_id: "a".repeat(64), thread_id: "owned-thread" }
const binding = { frameId: "frame", loaderId: "loader", documentId: 1, contextId: 2, urlHash: "hash", signature: "owned" }
function isolated(now?: () => number) {
 let value: any
 const cleanup = new SnapshotCleanup(() => ({ get: async () => value === undefined ? {} : { "cmspark.numberedSnapshot.cleanup.v1": value }, set: async v => { value = v["cmspark.numberedSnapshot.cleanup.v1"] } }))
 return new InteractiveSnapshotCache(now, undefined, cleanup)
}
async function refused(fn: () => unknown, expected: string) { let error: any; try { await fn() } catch (e) { error = e }; assert.equal(error?.code, expected) }
function code(fn: () => void, expected: string) { let caught: unknown; try { fn() } catch (e) { caught = e }; assert.equal(caught instanceof SnapshotRefusal && caught.code, expected) }
test("#521 pure cache TTL absolute, one-use, scope and tab", async () => {
 let now = 0; const c = isolated(() => now), s = await c.begin(owner, 7); c.commit(s, binding, [], true)
 code(() => c.reserve({ ...owner, scope_id: "b".repeat(64) }, 7, s.id), "SNAPSHOT_STALE")
 code(() => c.reserve(owner, 8, s.id), "SNAPSHOT_STALE")
 now = 29999; const held = c.reserve(owner, 7, s.id); code(() => c.reserve(owner, 7, s.id), "SNAPSHOT_STALE"); await c.finish(held)
 const late = await c.begin(owner, 7); c.commit(late, binding, [], true); now += 30000
 code(() => c.reserve(owner, 7, late.id), "SNAPSHOT_STALE")
})
test("#521 slots include capturing/reserved; no eviction; precise late finish", async () => {
 const c = isolated(); const slots: SnapshotSlot[] = []; for (let i = 0; i < 8; i++) slots.push(await c.begin(owner, i + 1))
 await refused(() => c.begin(owner, 9), "SNAPSHOT_CAPACITY"); c.clear(); assert.equal(c.size, 8)
 code(() => c.commit(slots[0], binding, [], true), "SNAPSHOT_STALE")
 await Promise.all(slots.map(s => c.finish(s))); assert.equal(c.size, 0)
 const old = await c.begin(owner, 7); c.commit(old, binding, [], true); const fresh = await c.begin(owner, 7); await c.finish(old); c.commit(fresh, binding, [], true)
 assert.equal(c.reserve(owner, 7, fresh.id), fresh); await c.finish(fresh)
})
test("#521 partial and owner-lifecycle cannot be revived", async () => {
 const c = isolated(), s = await c.begin(owner, 7); c.commit(s, binding, [], false)
 code(() => c.reserve(owner, 7, s.id), "SNAPSHOT_INCOMPLETE"); await c.finish(s); assert.equal(c.size, 0)
 const next = await c.begin(owner, 7); c.commit(next, binding, [], true); c.invalidateThread("other"); assert.equal(c.size, 1)
 c.invalidateThread(owner.thread_id); await c.finish(next); assert.equal(c.size, 0); code(() => c.reserve(owner, 7, next.id), "SNAPSHOT_STALE")
})
test("#521 internal owner strict shape", () => {
 assert.deepEqual(snapshotOwner(owner), owner)
 for (const raw of [null, {}, { ...owner, scope_id: "x" }, { ...owner, extra: true }, { ...owner, thread_id: "" }]) assert.equal(snapshotOwner(raw), undefined)
})
test("#521 failed remote cleanup remains held after context invalidation", async () => {
 const c = isolated(), s = await c.begin(owner,7); c.commit(s,binding,[],true); c.reserve(owner,7,s.id); c.holdFailedCleanup(s); c.clear()
 assert.equal(c.size,1); await refused(()=>c.begin(owner,7),"SNAPSHOT_CAPACITY")
 c.destroyedContext(7); assert.equal(c.size,1)
 await refused(()=>c.begin(owner,7),"SNAPSHOT_CAPACITY")
})
