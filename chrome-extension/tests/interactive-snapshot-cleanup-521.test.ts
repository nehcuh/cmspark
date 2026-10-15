import test from "node:test"
import assert from "node:assert/strict"
import * as CacheAPI from "../src/background/interactive-snapshot-cache"
import { InteractiveSnapshotController } from "../src/background/interactive-snapshot-controller"

const owner = { scope_id: "a".repeat(64), thread_id: "owned-resource" }
const binding = { frameId: "frame", loaderId: "loader", documentId: 1, contextId: 2, urlHash: "hash", signature: "owned" }
const key = "cmspark.numberedSnapshot.cleanup.v1"
function storage(initial?: unknown) {
 let value = initial, writes = 0
 return { get: async () => value === undefined ? {} : { [key]: value }, set: async (v: any) => { writes++; value = structuredClone(v[key]) }, value: () => value, writes: () => writes }
}
const session = storage()
;(globalThis as any).chrome = { storage: { session } }
async function refusal(fn: () => unknown, expected: string) { let error: any; try { await fn() } catch (e) { error = e }; assert.equal(error?.code, expected) }
function cache(store: any = storage(), now?: () => number) {
 // Constructor compatibility keeps the old-source counterfactual executable:
 // old cache ignores arg3; current cache receives the actual injectable ledger.
 const Cleanup = (CacheAPI as any).SnapshotCleanup
 return new (CacheAPI.InteractiveSnapshotCache as any)(now, undefined, Cleanup ? new Cleanup(() => store) : undefined)
}
test("#521 actual cache instances share one global eight-slot budget, not eight each", async () => {
 const a = new CacheAPI.InteractiveSnapshotCache(), b = new CacheAPI.InteractiveSnapshotCache(), held: any[] = []
 try {
  for (let i = 0; i < 8; i++) held.push([a, await a.begin(owner, i + 1)])
  let extra: any; try { extra = await b.begin(owner, 99) } catch (e: any) { assert.equal(e.code, "SNAPSHOT_CAPACITY") }
  if (extra) held.push([b, extra])
  assert.equal(extra, undefined)
 } finally { for (const [c, s] of held) await c.finish(s) }
})
test("#521 actual begin waits for claim write ACK; ready retains the same claim", async () => {
 const store = storage(); let release!: () => void, entered!: () => void
 const enteredGate = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
 const write = store.set; store.set = async v => { entered(); await gate; await write(v) }
 const c = cache(store); let settled = false
 const pending = Promise.resolve(c.begin(owner, 7)).then(s => { settled = true; return s })
 // No positive response is fabricated; bounded microtasks expose old ignored storage.
 for (let i = 0; i < 12; i++) await Promise.resolve()
 try { assert.equal(settled, false) } finally { release() }
 const s = await pending; await enteredGate; c.commit(s, binding, [], true)
 assert.equal((store.value() as any[]).length, 1); await c.finish(s)
 assert.deepEqual(store.value(), [])
})
test("#521 malformed persisted claim refuses without overwriting unknown storage", async () => {
 for (const value of [null, {}, Array(9).fill({ slot: 0, tabId: 7, group: "wrong" }), [{ slot: 0, tabId: 7, group: "wrong" }], [{ slot: 0, tabId: 7, group: "cmspark-numbered-controls-v1-slot-0", owner: "forged" }]]) {
  const store = storage(value), c = cache(store)
  await refusal(() => c.begin(owner, 7), "SNAPSHOT_FAILED"); assert.equal(store.writes(), 0)
 }
})
test("#521 inherited actual producer claims remain quarantined after a new worker instance", async () => {
 const store = storage(), first = cache(store), held: any[] = []
 for (let i = 0; i < 8; i++) held.push(await first.begin(owner, i + 1))
 // Simulated worker replacement: retained value came from the real ledger producer.
 const Cleanup = (CacheAPI as any).SnapshotCleanup, restarted = new Cleanup(() => store)
 await restarted.initialize()
 const inherited = restarted.takeQuarantineCleanup()
 assert.equal(inherited.length, 8)
 assert.deepEqual(Object.keys(inherited[0]).sort(), ["group", "slot", "tabId"])
 await restarted.retire(held[0].claim) // A late original reference cannot retire the new worker's quarantined record.
 assert.equal(restarted.takeQuarantineCleanup().length, 0)
 await refusal(() => restarted.acquire("new-owner", 99), "SNAPSHOT_CAPACITY")
 assert.equal((store.value() as any[]).length, 8)
 // Only the still-live original instance is allowed normal settled retirement.
 for (const s of held) await first.finish(s)
})
test("#521 delayed delete ACK holds capacity and a late old finish cannot erase replacement", async () => {
 const store = storage(), c = cache(store), held: any[] = []
 for (let i = 0; i < 8; i++) held.push(await c.begin(owner, i + 1))
 let release!: () => void, entered!: () => void
 const gate = new Promise<void>(r => { release = r }), pendingDelete = new Promise<void>(r => { entered = r })
 const write = store.set; let hold = true
 store.set = async v => { if (hold) { hold = false; entered(); await gate }; await write(v) }
 const retiring = c.finish(held[0]); await pendingDelete
 assert.equal(c.size, 8); assert.equal((store.value() as any[]).length, 8)
 let allocated = false; const ninth = Promise.resolve(c.begin({ ...owner, scope_id: "b".repeat(64) }, 99)).then(s => { allocated = true; return s })
 for (let i = 0; i < 8; i++) await Promise.resolve()
 assert.equal(allocated, false); release(); await retiring
 const replacement = await ninth; assert.equal(c.size, 8)
 await c.finish(held[0]); assert.equal(c.size, 8)
 assert.equal((store.value() as any[]).some(row => row.tabId === 99), true)
 for (const s of held.slice(1)) await c.finish(s); await c.finish(replacement)
})
test("#521 observed owner cancellation during claim write cannot publish or allocate", async () => {
 const store = storage(), c = cache(store)
 let release!: () => void, entered!: () => void
 const gate = new Promise<void>(r => { release = r }), inWrite = new Promise<void>(r => { entered = r })
 const write = store.set; let first = true
 store.set = async v => { if (first) { first = false; entered(); await gate }; await write(v) }
 const pending = c.begin(owner, 7); await inWrite; c.invalidateThread(owner.thread_id); release()
 await refusal(() => pending, "SNAPSHOT_STALE")
 assert.equal(c.size, 0); assert.deepEqual(store.value(), [])
})
test("#521 unknown write commits then throws: no optimistic rollback or second allocation", async () => {
 const store = storage(), c = cache(store), write = store.set
 store.set = async v => { await write(v); throw Error("OWNED_UNCERTAIN_WRITE") }
 await refusal(() => c.begin(owner, 7), "SNAPSHOT_FAILED")
 assert.equal((store.value() as any[]).length, 1)
 const writes = store.writes(); await refusal(() => c.begin(owner, 8), "SNAPSHOT_FAILED")
 assert.equal(store.writes(), writes)
})
test("#521 ready expiry and replacement retire the old claim without extending the clock", async () => {
 let now = 0; const store = storage(), c = cache(store, () => now)
 const old = await c.begin(owner, 7); c.commit(old, binding, [], true)
 now = 100; const fresh = await c.begin(owner, 7); c.commit(fresh, binding, [], true)
 assert.equal(fresh.expires, 30100); assert.equal((store.value() as any[]).length, 1)
 await c.finish(old); assert.equal(c.size, 1)
 now = 30100; const next = await c.begin(owner, 8)
 assert.equal(c.size, 1); assert.equal((store.value() as any[]).length, 1)
 await c.finish(next)
})
test("#521 delayed claim ACK cannot extend an already elapsed 30s TTL", async () => {
 let now = 0; const store = storage(), write = store.set
 store.set = async v => { await write(v); now = 30000 }
 const c = cache(store, () => now)
 await refusal(() => c.begin(owner, 7), "SNAPSHOT_STALE")
 assert.deepEqual(store.value(), []); assert.equal(c.size, 0)
})
test("#521 actual controller only direct-cleans proved own clients; success never frees quarantine", async () => {
 const store = storage(), previous = cache(store), held: any[] = []
 for (let i = 0; i < 8; i++) held.push(await previous.begin(owner, i + 1))
 const Cleanup = (CacheAPI as any).SnapshotCleanup, restarted = new Cleanup(() => store)
 const calls: Array<{ tabId: number; method: string }> = []
 // Declared CDP fault boundary: even targets reject self commands like foreign clients.
 const controller = new InteractiveSnapshotController(async (tabId, method) => {
  calls.push({ tabId, method })
  if (tabId % 2 === 0) throw Error("OWNED_FOREIGN_CLIENT_CONTROL")
  if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "owned-frame" } } }
  if (method === "Runtime.releaseObjectGroup") return {}
  throw Error("OWNED_UNEXPECTED_ALLOCATION")
 }, async () => { throw Error("OWNED_UNEXPECTED_TAB_READ") }, restarted)
 await refusal(() => controller.cache.begin(owner, 99), "SNAPSHOT_CAPACITY")
 assert.equal(calls.filter(c => c.method === "Page.getFrameTree").length, 8)
 assert.equal(calls.filter(c => c.method === "Runtime.releaseObjectGroup").length, 4)
 assert.equal(calls.some(c => c.tabId % 2 === 0 && c.method === "Runtime.releaseObjectGroup"), false)
 assert.equal((store.value() as any[]).length, 8)
 const count = calls.length; await refusal(() => controller.cache.begin(owner, 99), "SNAPSHOT_CAPACITY")
 assert.equal(calls.length, count)
 for (const s of held) await previous.finish(s)
})
test("#521 actual collector emits no CDP command before a claim ACK", async () => {
 const store = storage(), Cleanup = (CacheAPI as any).SnapshotCleanup
 let release!: () => void, entered!: () => void, commands = 0
 const gate = new Promise<void>(r => { release = r }), inWrite = new Promise<void>(r => { entered = r })
 const write = store.set; let first = true
 store.set = async v => { if (first) { first = false; entered(); await gate }; await write(v) }
 const controller = new InteractiveSnapshotController(async () => { commands++; throw Error("OWNED_STOP_AT_FIRST_CDP") }, async () => ({ url: "https://owned.example/" }), new Cleanup(() => store))
 const pending = controller.collect(owner, 7).then(() => undefined, (e: any) => e.code)
 await inWrite; assert.equal(commands, 0); release()
 assert.equal(await pending, "SNAPSHOT_FAILED"); assert.equal(commands, 1)
 assert.deepEqual(store.value(), [])
})
test("#521 actual collector cancellation during write ACK has zero CDP effects", async () => {
 const store = storage(), Cleanup = (CacheAPI as any).SnapshotCleanup
 let release!: () => void, entered!: () => void, commands = 0
 const gate = new Promise<void>(r => { release = r }), inWrite = new Promise<void>(r => { entered = r })
 const write = store.set; let first = true
 store.set = async v => { if (first) { first = false; entered(); await gate }; await write(v) }
 const controller = new InteractiveSnapshotController(async () => { commands++; throw Error("OWNED_UNEXPECTED_CDP") }, async () => ({ url: "https://owned.example/" }), new Cleanup(() => store))
 const pending = controller.collect(owner, 7).then(() => undefined, (e: any) => e.code)
 await inWrite; controller.cache.invalidateThread(owner.thread_id); release()
 assert.equal(await pending, "SNAPSHOT_STALE"); assert.equal(commands, 0)
 assert.deepEqual(store.value(), [])
})
