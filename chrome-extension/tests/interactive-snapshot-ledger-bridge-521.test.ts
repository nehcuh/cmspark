import test from "node:test"
import assert from "node:assert/strict"
import { BrowserBridge } from "../src/background/browser-bridge"

test("#521 unavailable session ledger fails new mode closed but real legacy list_tabs stays usable", async () => {
 let reads = 0, queries = 0, cdp = 0, attaches = 0
 const event = { addListener() {} }
 const previous = (globalThis as any).chrome
 ;(globalThis as any).chrome = {
  debugger: { onDetach: event, onEvent: event, sendCommand: async () => { cdp++; throw Error("OWNED_UNEXPECTED_CDP") }, attach: async () => { attaches++ } },
  tabs: { onRemoved: event, query: async () => { queries++; return [] } },
  storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => { reads++; throw Error("OWNED_STORAGE_UNAVAILABLE") }, set: async () => { throw Error("OWNED_UNEXPECTED_WRITE") } } },
 }
 try {
  const bridge = new BrowserBridge(), owner = { scope_id: "a".repeat(64), thread_id: "owned-ledger-fault" }
  const rejected = await bridge.execute("get_interactive_snapshot", { tabId: 7 }, owner)
  assert.equal(rejected.success, false); assert.equal(rejected.data.error_code, "SNAPSHOT_FAILED")
  const forwarded = await bridge.execute("list_tabs", {})
  assert.equal(forwarded.success, true); assert.deepEqual(forwarded.data, [])
  const again = await bridge.execute("get_interactive_snapshot", { tabId: 7 }, owner)
  assert.equal(again.data.error_code, "SNAPSHOT_FAILED")
  assert.deepEqual({ reads, queries, cdp, attaches }, { reads: 1, queries: 1, cdp: 0, attaches: 0 })
 } finally { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous }
})
