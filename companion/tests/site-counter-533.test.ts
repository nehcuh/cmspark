import fs from "node:fs"
import path from "node:path"
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { initDataDir } from "../src/config"
import { handleMessage, __testSetLlmActiveForTests } from "../src/message-router"
import { ThreadManager } from "../src/threads/thread-manager"
import { SkillEngine } from "../src/skills/skill-engine"
import { siteTargetFromBrowser } from "../src/site-context/target"
import { recordSiteOpFailure, getOriginFailCount, getReadOnlyOriginFailCount, resetSiteOpMemoryForTests, peekSiteOpBan } from "../src/tool/site-op-memory"
import { validateWsMessage } from "../src/ws/validate"
import { pendingToolCalls } from "../src/ws/tool-forward"
import { securityConfirmations, seedThreadManagerForTests } from "../src/server"

const recorded: Record<string,any> = { provenance: "actual router status/reset/errors; controlled metadata executor uses real siteTargetFromBrowser" }
before(async () => { await initDataDir() })
after(() => { if (process.env.CMSPARK_533_RECORDING_OUT) fs.writeFileSync(process.env.CMSPARK_533_RECORDING_OUT, JSON.stringify(recorded,null,2)+"\n", { mode:0o600 }) })
function fixture(globalManager = false) {
  resetSiteOpMemoryForTests()
  const manager = globalManager ? seedThreadManagerForTests() : new ThreadManager(), thread = manager.create("owned site counter"), other = manager.create("other site counter")
  const services = { threadManager: manager, skillEngine: new SkillEngine(), historyStore: {} as any }
  let url: string | undefined = "https://scope533.test:8443/path?private=synthetic#route", current = true, reads = 0
  const session: any = { origin: "chrome-extension://owned533", surface: "panel", panelId: "owned533-panel", originWs: {},
    isCurrentSession: () => current, sendToExtension() {}, executeTool: async (_id: string, name: string, _params: any, _signal: any, options: any) => {
      reads++; assert.equal(name, "list_tabs"); assert.equal(options.siteContextTabId, 7); assert.equal(options.siteContextRequireActive, true)
      const site_target = siteTargetFromBrowser(7, url, Date.now())
      return site_target ? { success: true, data: { site_target } } : { success: false }
    } }
  const post = (m: any) => handleMessage(m, services, session)
  const status = () => post({ type: "site.counter.status", source: "settings", id: "status-533", thread_id: thread.id, context_tab_id: 7 })
  const reset = (key: string) => post({ type: "site.counter.reset", source: "settings", id: "reset-533", thread_id: thread.id, context_tab_id: 7, target_key: key, user_gesture: true })
  const fail = (tid = thread.id, origin = "https://scope533.test:8443", code?: string) => recordSiteOpFailure(tid, "click", { tabId: 7, selector: "#known-missing" }, code, origin)
  return { manager, thread, other, services, session, post, status, reset, fail, get reads() { return reads }, set url(v: string | undefined) { url = v }, set current(v: boolean) { current = v } }
}

test("#533 actual router current-origin status and explicit reset preserve UNKNOWN, locator and other scopes", async () => {
  const f = fixture(); await f.post({ type: "thread.select", thread_id: f.thread.id })
  for (let i=0;i<4;i++) f.fail()
  f.fail(f.other.id); f.fail(f.thread.id, "http://scope533.test:8443"); f.fail(f.thread.id, "https://scope533.test")
  const s = await f.status()
  assert.equal(s.type, "site.counter.state"); assert.equal(s.origin, "https://scope533.test:8443"); assert.equal(s.fails, 4); assert.equal(s.last_code, "UNKNOWN"); assert.equal(s.threshold, 4)
  assert.doesNotMatch(JSON.stringify(s), /private|synthetic|#known-missing|route/)
  const r = await f.reset(s.target_key)
  assert.equal(r.type, "site.counter.state"); assert.equal(r.reset, true); assert.equal(r.fails, 0); assert.equal(r.last_code, "UNKNOWN"); assert.equal(r.health, "unknown")
  assert.equal(getOriginFailCount(f.other.id, s.origin), 1); assert.equal(getOriginFailCount(f.thread.id, "http://scope533.test:8443"), 1); assert.equal(getOriginFailCount(f.thread.id, "https://scope533.test"), 1)
  assert.equal(peekSiteOpBan(f.thread.id, "click", { tabId: 7, selector: "#known-missing" }, s.origin).banned, true)
  for (let i=0;i<4;i++) recordSiteOpFailure(f.thread.id,"click",{tabId:7,selector:`#fresh-${i}`},undefined,s.origin)
  assert.equal(getOriginFailCount(f.thread.id, s.origin), 4)
  recorded.status=s; recorded.reset=r
})

test("#533 schema refuses caller hostname authority, unknown fields and nonfinite/stale scope", () => {
  const m = { type: "site.counter.status", source: "settings", id: "schema533", thread_id: "owned", context_tab_id: 7 }
  assert.equal(validateWsMessage(m).valid, true)
  for (const change of [{ hostname: "foreign.test" }, { origin: "https://foreign.test" }, { context_tab_id: Infinity }, { source: "model" }, { thread_id: "" }]) assert.equal(validateWsMessage({ ...m, ...change }).valid, false)
  assert.equal(validateWsMessage({ ...m, type: "site.counter.reset", target_key: "a".repeat(64), user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ ...m, type: "site.counter.reset", target_key: "a".repeat(64), user_gesture: false }).valid, false)
})

test("#533 busy active/pending reset refusal prevents a late failure refilling a reset budget", async () => {
  const f = fixture(); await f.post({ type: "thread.select", thread_id: f.thread.id }); for(let i=0;i<3;i++)f.fail()
  const s = await f.status(); __testSetLlmActiveForTests(f.thread.id, true)
  try { const r = await f.reset(s.target_key); recorded.busy=r; assert.equal(r.code, "SITE_COUNTER_BUSY"); assert.equal(getOriginFailCount(f.thread.id,s.origin),3) }
  finally { __testSetLlmActiveForTests(f.thread.id, false) }
  const timer = setTimeout(() => {}, 5000)
  pendingToolCalls.set("owned-533-pending", { thread_id: f.thread.id, timer, resolve() {}, reject() {} })
  try { assert.equal((await f.reset(s.target_key)).code, "SITE_COUNTER_BUSY"); f.fail(); assert.equal(getOriginFailCount(f.thread.id,s.origin),4) }
  finally { clearTimeout(timer); pendingToolCalls.delete("owned-533-pending") }
})

test("#533 pending human confirmation refuses reset without resolving or changing authority", async () => {
  const f = fixture(); await f.post({ type: "thread.select", thread_id: f.thread.id }); f.fail(); const s = await f.status()
  let frame: any
  const decision = securityConfirmations.request(m => { frame=m }, { toolName:"evaluate",description:"owned confirmation fixture",workerId:f.thread.id } as any, { originWs:f.session.originWs })
  try {
    assert.equal((await f.reset(s.target_key)).code,"SITE_COUNTER_BUSY")
    assert.equal(securityConfirmations.hasPendingForWorker(f.thread.id),true)
  } finally { securityConfirmations.respondFrom(frame.confirmation_id,false,f.session.originWs) }
  assert.equal((await decision).approved,false)
})

test("#533 post-await owner/current-target/disconnect checks refuse unchanged memory", async () => {
  for (const change of ["owner","target","disconnect","unavailable","busy"]) {
    const f = fixture(); await f.post({type:"thread.select",thread_id:f.thread.id}); f.fail(); const s=await f.status(); const original=f.session.executeTool
    f.session.executeTool=async (...args: any[]) => {
      const result=await original(...args)
      if(change==="owner") await f.post({type:"thread.select",thread_id:f.other.id})
      if(change==="target") f.url="https://scope533.test:8443/changed"
      if(change==="disconnect") f.current=false
      if(change==="unavailable") f.url=undefined
      if(change==="busy") __testSetLlmActiveForTests(f.thread.id,true)
      return result
    }
    try { const result=await f.reset(s.target_key); assert.equal(result.type,"site.counter.error"); assert.equal(getOriginFailCount(f.thread.id,s.origin),1) }
    finally { __testSetLlmActiveForTests(f.thread.id,false) }
  }
})

test("#533 non-panel and unselected/wrong-thread callers cannot read or reset a scope", async () => {
  const f=fixture(); f.fail(); assert.equal((await f.status()).code,"SITE_COUNTER_STALE")
  await f.post({type:"thread.select",thread_id:f.thread.id}); const s=await f.status()
  const reads=f.reads; f.session.surface="tray"
  assert.equal((await f.reset(s.target_key)).code,"SITE_COUNTER_CALLER_DENIED"); assert.equal(f.reads,reads)
  f.session.surface="panel"; await f.post({type:"thread.select",thread_id:f.other.id})
  assert.equal((await f.reset(s.target_key)).code,"SITE_COUNTER_STALE")
})

test("#533 real adapter late failure follows a refused busy reset without retiring the prior budget", {timeout:10000}, async () => {
  const f=fixture(true); await f.post({type:"thread.select",thread_id:f.thread.id})
  for(let i=0;i<3;i++)recordSiteOpFailure(f.thread.id,"click",{tabId:7,selector:`#prior-${i}`},undefined,"https://scope533.test:8443")
  const status=await f.status()
  const {chatCreate}=await import("../src/llm/adapter"),{installKickAbortController,releaseKickAbortController}=await import("../src/message-router")
  const {executeCompanionTool}=await import("../src/tool/companion-dispatch"),{default:OpenAI}=await import("openai")
  const bridge=require(path.resolve(__dirname,"../../tests/fixtures/site-counter-533-browser.cjs")).loadOwnedCounterBridge(path.resolve(__dirname,"../../.."))
  const failure=await bridge.bridge.failInteractive(7,new Error("owned late channel failure"),"WAIT_PROBE_FAILED")
  assert.equal(failure.data.error_code,"WAIT_PROBE_FAILED")
  const client=new OpenAI({baseURL:"http://127.0.0.1:9",apiKey:"owned-test-no-network"}),proto=Object.getPrototypeOf(client.chat.completions),previous=proto.create
  const script=[{name:"run_progress_propose",args:{items:[{text:"Wait for the owned fixture"}]}},{name:"wait_for",args:{tabId:7,selector:"#late533"}}]
  proto.create=async()=>{const step=script.shift();return(async function*(){yield{choices:[{delta:step?{tool_calls:[{index:0,id:`owned-${step.name}`,type:"function",function:{name:step.name,arguments:JSON.stringify(step.args)}}]}:{content:"owned done"}}]};yield{choices:[{delta:{}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}})()}
  let begin!:()=>void,finish!:()=>void
  const started=new Promise<void>(r=>{begin=r}),gate=new Promise<void>(r=>{finish=r})
  const controller=installKickAbortController(f.thread.id);assert.ok(controller)
  let task: Promise<any> | undefined
  try {
    task=chatCreate({threadId:f.thread.id,message:"owned counter late failure",skillIds:[],hostname:"scope533.test",siteContextTabId:7,
      contextSelection:{kind:"thread",skillMode:"auto",knowledgeMode:"auto",cachedMatchedSkillIds:[]},resolveSiteTarget:async()=>siteTargetFromBrowser(7,"https://scope533.test:8443/path",Date.now()),
      config:{base_url:"http://127.0.0.1:9",api_key:"owned-test-no-network",model_name:"test",temperature:0,context_window:4000},threadManager:f.manager,skillEngine:f.services.skillEngine,historyStore:{record:()=>0},sendToExtension(){},signal:controller.signal,
      executeTool:async(id:string,name:string,params:any)=>{if(name==="run_progress_propose")return executeCompanionTool(name,{...params,__thread_id:f.thread.id},id,{handshakeSurface:"tray"});assert.equal(name,"wait_for");begin();await gate;return failure},
    } as any)
    await Promise.race([started,task.then(()=>{throw Error("OWNED_ADAPTER_DID_NOT_DISPATCH")})])
    assert.equal((await f.reset(status.target_key)).code,"SITE_COUNTER_BUSY")
    assert.equal(getOriginFailCount(f.thread.id,status.origin),3)
    assert.equal(getReadOnlyOriginFailCount(f.thread.id,status.origin),0)
    finish();await task
    assert.equal(getOriginFailCount(f.thread.id,status.origin),3,"busy reset refusal preserves the prior interaction budget")
    assert.equal(getReadOnlyOriginFailCount(f.thread.id,status.origin),1,"the real late wait_for failure increments only its read-only budget")
  }finally{finish();if(task)await task.catch(()=>{});releaseKickAbortController(f.thread.id,controller);proto.create=previous;bridge.close()}
})

test("#533 count reset preserves a real attach freeze and sanitizes only the outward unknown code",async()=>{
 const f=fixture();await f.post({type:"thread.select",thread_id:f.thread.id})
 f.fail(f.thread.id,"https://scope533.test:8443","PRIVATE_UNREGISTERED_533")
 f.fail(f.thread.id,"https://scope533.test:8443","CDP_ATTACH_FAILED")
 const s=await f.status();assert.equal(s.last_code,"UNKNOWN");assert.equal(s.attach_frozen,true);assert.doesNotMatch(JSON.stringify(s),/PRIVATE_UNREGISTERED_533/)
 const r=await f.reset(s.target_key);assert.equal(r.fails,0);assert.equal(r.attach_frozen,true);assert.equal(r.health,"unknown")
 const ban=peekSiteOpBan(f.thread.id,"click",{tabId:7,selector:"#fresh"},s.origin);assert.ok(ban.banned);assert.equal(ban.error_code,"TAB_ATTACH_FROZEN")
})

test("#533 same-peer unbound confirmation blocks reset; unrelated peer confirmation stays pending and does not",async()=>{
 const f=fixture();await f.post({type:"thread.select",thread_id:f.thread.id});f.fail();const s=await f.status()
 for(const own of [true,false]){
  let frame:any;const origin=own?f.session.originWs:{}
  const decision=securityConfirmations.request(m=>{frame=m},{toolName:"evaluate",description:"owned unbound fixture"} as any,{originWs:origin})
  try{
   const result=await f.reset(s.target_key)
   if(own)assert.equal(result.code,"SITE_COUNTER_BUSY")
   else assert.equal(result.reset,true)
   assert.equal(securityConfirmations.isPending(frame.confirmation_id),true)
  }finally{securityConfirmations.respondFrom(frame.confirmation_id,false,origin)}
  assert.equal((await decision).approved,false)
 }
})

test("#533 a newer owned status receipt during await revokes a reset from the older view",async()=>{
 const f=fixture();await f.post({type:"thread.select",thread_id:f.thread.id});f.fail();const s=await f.status()
 const original=f.session.executeTool;let changed=false
 f.session.executeTool=async(...args:any[])=>{const result=await original(...args);if(!changed){changed=true;await f.status()}return result}
 const result=await f.reset(s.target_key)
 assert.equal(result.code,"SITE_COUNTER_STALE");assert.equal(getOriginFailCount(f.thread.id,s.origin),1)
})
