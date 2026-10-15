import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { snapshotOutput } from "../src/background/interactive-snapshot"
import { BrowserBridge } from "../src/background/browser-bridge"
const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/interactive-snapshot-521-recorded.json"), "utf8"))
test("#521 real recorded producer has no DOM handles, URL, owner or field-value export", () => {
 assert.deepEqual(Object.keys(recorded).sort(), ["data", "success"])
 assert.deepEqual(Object.keys(recorded.data).sort(), ["complete", "expires_in_ms", "rows", "snapshot_id", "table"])
 assert.equal(JSON.stringify(recorded).includes("NO_EXPORT"), false)
 assert.equal(JSON.stringify(recorded).includes("PRIVATE_SENTINEL"), false)
 for (const row of recorded.data.rows) assert.deepEqual(Object.keys(row).sort(), ["ambiguous", "can_click", "can_type", "id", "label", "role", "state"])
})
test("#521 complete UTF8/escaped result bound includes table duplication", () => {
 // Controlled mutation of recorded producer row, not an invented protocol frame.
 const rows = Array.from({ length: 64 }, (_, i) => ({ ...recorded.data.rows[0], id: i + 1, label: '"\\'.repeat(32) }))
 const result = snapshotOutput(recorded.data.snapshot_id, 30000, rows, true)
 assert.equal(new TextEncoder().encode(JSON.stringify(result)).length <= 24576, true)
 assert.equal(result.data.complete, false)
 assert.equal(result.data.rows.length < 64, true)
 assert.equal(JSON.parse(JSON.stringify(result)).data.table, result.data.table)
})
test("#521 real Bridge refuses params-supplied owner and malformed pair before effects", async () => {
 const previous = (globalThis as any).chrome
 let cdp = 0, attach = 0, fallback = 0
 const api = { debugger: { onDetach: { addListener() {} }, onEvent: { addListener() {} }, sendCommand: async () => { cdp++; throw Error("OWNED_UNEXPECTED_CDP") }, attach: async () => { attach++ } }, tabs: { onRemoved: { addListener() {} }, get: async () => ({ url: "https://owned.example/" }) }, scripting: { executeScript: async () => { fallback++ } }, storage: { local: { get: async () => ({}), set: async () => {} } } }
 ;(globalThis as any).chrome = api
 try {
  const bridge = new BrowserBridge()
  const raw = { tabId: 7, snapshot_id: recorded.data.snapshot_id, element_id: 1, value: "OWNED", locator_scope: { scope_id: "a".repeat(64), thread_id: "owned" } }
  assert.equal((await bridge.execute("type", raw)).data.error_code, "SNAPSHOT_SCOPE_REQUIRED")
  const owner = { scope_id: "a".repeat(64), thread_id: "owned" }
  assert.equal((await bridge.execute("type", { ...raw, snapshot_id: "" }, owner)).data.error_code, "SNAPSHOT_STALE")
  assert.equal((await bridge.execute("click", { tabId: 7, snapshot_id: recorded.data.snapshot_id, element_id: 1 }, owner)).data.error_code, "SNAPSHOT_STALE")
  assert.deepEqual({ cdp, attach, fallback }, { cdp: 0, attach: 0, fallback: 0 })
 } finally { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous }
})
test("#521 known thread deletion while real tab queue waits cannot publish a new snapshot", async () => {
 const previous=(globalThis as any).chrome;let tabReads=0,stored:Record<string,unknown>={}
 const api={debugger:{onDetach:{addListener(){}},onEvent:{addListener(){}},getTargets:async()=>[]},tabs:{onRemoved:{addListener(){}},get:async()=>{tabReads++;return{url:"https://owned.example/"}}},storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async()=>structuredClone(stored),set:async(v:Record<string,unknown>)=>{stored=structuredClone(v)}}}}
 ;(globalThis as any).chrome=api
 let release!:()=>void
 const gate=new Promise<void>(r=>{release=r})
 try {
  const bridge=new BrowserBridge(),owner={scope_id:"a".repeat(64),thread_id:"owned-late"}
  // Explicit private queue seam; actual TabQueue and actual Bridge execute path.
  const queue=(bridge as any).tabQueue,held=queue.run(7,()=>gate)
  let queued!:()=>void;const inQueue=new Promise<void>(r=>{queued=r}),run=queue.run.bind(queue)
  queue.run=(id:number,fn:any)=>{queued();return run(id,fn)}
  const result=bridge.execute("get_interactive_snapshot",{tabId:7},owner)
  await inQueue
  bridge.invalidateInteractiveSnapshotThread(owner.thread_id);release();await held
  assert.equal((await result).data.error_code,"SNAPSHOT_STALE")
  assert.equal(tabReads,0)
 } finally {release();if(previous===undefined)delete(globalThis as any).chrome;else(globalThis as any).chrome=previous}
})
