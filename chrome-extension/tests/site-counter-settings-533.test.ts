import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { forwardSiteCounterSettings, noteSiteCounterUiSelection } from "../src/background/site-counter-settings"
const requests = JSON.parse(fs.readFileSync(path.join(process.cwd(),"tests/fixtures/site-counter-533-ui-requests.json"),"utf8"))
const status=requests.find((r:any)=>r.type==="site.counter.status"),reset=requests.find((r:any)=>r.type==="site.counter.reset")
const ownedTest=(name:string,run:()=>Promise<void>)=>test(name,async()=>{const previous=(globalThis as any).chrome;(globalThis as any).chrome={runtime:{id:"owned533"}};try{await run()}finally{(globalThis as any).chrome=previous}})
const sender={id:"owned533",url:"chrome-extension://owned533/sidepanel.html",frameId:0}
function client(){const sent:any[]=[];return{sent,getState:()=>"connected",send:(m:object)=>{sent.push(m);return true}}}

ownedTest("#533 actual App-produced UI request forwards only browser-selected tab, never hostname",async()=>{
  const c=client();noteSiteCounterUiSelection(status.thread_id)
  const reply=await forwardSiteCounterSettings(status,sender,c,async()=>({hostname:"UNTRUSTED_HINT_NOT_FORWARD",context_tab_id:7}))
  assert.equal(reply.ok,true);assert.equal(reply.context_tab_id,7);assert.equal(c.sent.length,1)
  assert.equal(c.sent[0].source,"settings");assert.equal(c.sent[0].context_tab_id,7);assert.ok(!("hostname" in c.sent[0]));assert.ok(!("origin" in c.sent[0]))
  assert.equal((await forwardSiteCounterSettings(reset,sender,c,async()=>({hostname:"hint",context_tab_id:7}))).ok,true)
  assert.equal(c.sent[1].user_gesture,true);assert.equal(c.sent[1].target_key,reset.target_key)
})
ownedTest("#533 SW rejects content/foreign/popup/iframe/model and caller-selected origin before reads",async()=>{
 for(const s of [undefined,{...sender,id:"foreign"},{...sender,url:"chrome-extension://foreign/sidepanel.html"},{...sender,tab:{id:9} as any},{...sender,frameId:2},{...sender,url:"chrome-extension://owned533/popup.html"}]){
  const c=client();noteSiteCounterUiSelection(status.thread_id);let reads=0
  assert.equal((await forwardSiteCounterSettings(status,s,c,async()=>{reads++;return undefined})).ok,false);assert.equal(reads,0);assert.equal(c.sent.length,0)
 }
 for(const mutation of [{source:"model"},{hostname:"foreign.test"},{context_tab_id:8},{origin:"https://foreign.test"}]){
  const c=client();assert.equal((await forwardSiteCounterSettings({...status,...mutation},sender,c)).ok,false);assert.equal(c.sent.length,0)
 }
})
ownedTest("#533 SW rechecks selected owner and connected state after actual context await",async()=>{
 for(const change of ["other-thread","same-thread-reselect","disconnect","unavailable","throw"]){
  const c=client();noteSiteCounterUiSelection(status.thread_id)
  const result=await forwardSiteCounterSettings(status,sender,c,async()=>{
   if(change==="other-thread")noteSiteCounterUiSelection("another533")
   if(change==="same-thread-reselect")noteSiteCounterUiSelection(status.thread_id)
   if(change==="disconnect")c.getState=()=>"disconnected"
   if(change==="unavailable")return undefined
   if(change==="throw")throw Error("PRIVATE_TEST_ERROR")
   return{hostname:"hint",context_tab_id:7}
  })
  assert.equal(result.ok,false);assert.equal(c.sent.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST_ERROR/)
 }
})
ownedTest("#533 reset requires explicit gesture and real target change key",async()=>{
 for(const m of [{...reset,user_gesture:false},{...reset,target_key:"unknown"},{...reset,thread_id:"another533"}]){
  const c=client();noteSiteCounterUiSelection(reset.thread_id);assert.equal((await forwardSiteCounterSettings(m,sender,c)).ok,false);assert.equal(c.sent.length,0)
 }
})
