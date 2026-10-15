// Unit transport/auth-state seams; genuine HMAC+Chrome evidence is separate native runner.
import test, { before, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { WebSocket } from "ws"
import { initDataDir } from "../src/config"
import { createToolExecutor, seedThreadManagerForTests, seedExtensionWsAuthForTests, handleToolResult, pendingToolCalls } from "../src/server"
import { bindChatEvidenceScope } from "../src/business-evidence/chat-scope"
import * as pregate from "../src/orchestrator/tool-pregate"
const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "../chrome-extension/tests/fixtures/interactive-snapshot-521-recorded.json"), "utf8"))
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
afterEach(() => mock.restoreAll())
function peer(authenticated = true) {
 const frames: any[] = []
 const ws = { readyState: WebSocket.OPEN, send(raw: string) {
  const frame = JSON.parse(raw); frames.push(frame)
  if (frame.type === "tool.execute") queueMicrotask(() => {
   const reply = { tool_call_id: frame.tool_call_id, result: recorded }
   handleToolResult(reply, {} as WebSocket)
   assert.equal(pendingToolCalls.has(frame.tool_call_id), true, "wrong peer cannot settle")
   handleToolResult(reply, ws)
  })
 } } as unknown as WebSocket
 seedExtensionWsAuthForTests(ws, { authenticated, origin: authenticated ? "chrome-extension://owned521" : "" })
 return { ws, frames }
}
test("#521 actual executor derives out-of-params metadata only from real Chat binder", async () => {
 const tm = seedThreadManagerForTests(), a = tm.create("OWNED521_A"), b = tm.create("OWNED521_B"), p = peer(), run = createToolExecutor(p.ws)
 try {
  for (const t of [a,b]) {
   const result = await bindChatEvidenceScope(run, t.id)("owned-"+t.id, "get_interactive_snapshot", { tabId:7, __thread_id:"forged", locator_scope:{scope_id:"a".repeat(64),thread_id:"forged"} })
   assert.equal(result.success, true)
   const frame = p.frames.filter(x => x.type === "tool.execute").at(-1)
   assert.equal(frame.locator_scope.thread_id, t.id)
   assert.match(frame.locator_scope.scope_id, /^[a-f0-9]{64}$/)
   assert.equal(frame.params.locator_scope, undefined)
  }
  const frames = p.frames.filter(x => x.type === "tool.execute")
  assert.notEqual(frames[0].locator_scope.scope_id, frames[1].locator_scope.scope_id)
  assert.equal(pendingToolCalls.size,0)
 } finally { tm.delete(a.id); tm.delete(b.id) }
})
for (const mode of ["raw-model-owner", "unauthenticated-peer", "trusted-outbound"]) {
 test("#521 no new authority at actual host boundary: " + mode, async () => {
  const tm=seedThreadManagerForTests(), t=tm.create("OWNED521_NEG"), p=peer(mode!=="unauthenticated-peer"), run=createToolExecutor(p.ws)
  try {
   const context = mode === "raw-model-owner" ? run : bindChatEvidenceScope(run,t.id)
   const result = await context("owned-negative-"+mode,"get_interactive_snapshot",{tabId:7,__thread_id:t.id,locator_scope:{scope_id:"a".repeat(64),thread_id:t.id}},undefined,mode==="trusted-outbound"?{trustedOutbound:true}:undefined)
   assert.equal(result.success,false)
   assert.equal(p.frames.some(x=>x.type==="tool.execute"),false)
  } finally { tm.delete(t.id) }
 })
}
for (const change of ["delete-owner","abort","plan"]) {
 test("#521 post-real-pregate-await current owner/signal refusal: "+change, async () => {
  const tm=seedThreadManagerForTests(),t=tm.create("OWNED521_LATE"),p=peer(),run=bindChatEvidenceScope(createToolExecutor(p.ws),t.id),controller=new AbortController()
  const original=pregate.runMultiAgentToolPregate
  let entered!:()=>void, release!:()=>void
  const waiting=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
  mock.method(pregate,"runMultiAgentToolPregate",async (args: Parameters<typeof original>[0])=>{const result=await original(args);assert.equal(result.ok,true);entered();await gate;return result})
  try {
   const pending=run("owned-late-"+change,change==="plan"?"click":"get_interactive_snapshot",change==="plan"?{tabId:7,snapshot_id:recorded.data.snapshot_id,element_id:1}:{tabId:7},controller.signal)
   await waiting;if(change==="delete-owner")tm.delete(t.id);else if(change==="plan")tm.update(t.id,{execution_policy:"plan_readonly"});else controller.abort();release()
   const result=await pending;assert.equal(result.success,false);assert.equal(p.frames.some(x=>x.type==="tool.execute"),false)
  } finally {release();tm.delete(t.id)}
 })
}
