import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import { createHmac } from "node:crypto"
import { ThreadManager } from "../src/threads/thread-manager"
import { createDesktopChannel } from "../src/desktop/channel"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import type { NativeDialogStart } from "../src/desktop/dialog"
import { DESKTOP_RENDERER_METHODS } from "../src/desktop/capabilities"

function owned(t: any) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metadata-476-")),previous=process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR=dir
  t.after(()=>{if(previous===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true})})
  const manager=new ThreadManager();manager.create("对话A","metadata-A");manager.create("对话B","metadata-B")
  return {dir,manager}
}
// The real channel parser/HMAC/registry/routes with an inert socket: no network,
// native host or hand-written backend response producer is executed.
function authenticated(t: any, manager: ThreadManager, runtime:any) {
  const registry=new DesktopIdentityRegistry(),channel=createDesktopChannel({registry,services:{threads:manager,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,dialogRuntime:()=>runtime})
  const sent:any[]=[],socket:any=new EventEmitter();socket.readyState=1;socket.send=(b:string)=>sent.push(JSON.parse(b));socket.terminate=socket.close=()=>{socket.readyState=3;socket.emit("close")}
  channel.wss.emit("connection",socket);assert.equal(sent.shift().type,"desktop.challenge.request")
  const boot=registry.issue("owned-metadata-476");socket.emit("message",Buffer.from(JSON.stringify({type:"desktop.hello",capability_id:boot.capabilityId,protocol_version:1})))
  const ch=sent.shift(),input=JSON.stringify(["cmspark.desktop.auth.v1",boot.capabilityId,ch.connection_id,1,ch.nonce])
  socket.emit("message",Buffer.from(JSON.stringify({type:"desktop.authenticate",capability_id:boot.capabilityId,protocol_version:1,proof:createHmac("sha256",Buffer.from(boot.secret,"hex")).update(input).digest("hex")})))
  assert.equal(sent.shift().type,"desktop.ready");t.after(()=>{socket.terminate();channel.wss.emit("close")})
  return {send:(frame:any)=>{socket.emit("message",Buffer.from(typeof frame==="string"?frame:JSON.stringify(frame)))},sent,socket,registry}
}

const tick=()=>new Promise<void>(r=>setImmediate(r))
function element(id:string):any {return{id,textContent:"",value:"",hidden:false,disabled:false,children:[],events:{},dataset:{},attributes:{},setAttribute(k:string,v:string){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},focus(){this.focused=true},click(){this.events.click?.()},replaceChildren(...v:any[]){this.children=v},append(v:any){this.children.push(v)},addEventListener(k:string,f:any){this.events[k]=f}}}
function renderer(withDocument=true) {
  const ids:any=Object.fromEntries(["title","notice","list","preview","status","view","mcp-new","mcp-editor","mcp-save","mcp-cancel","mcp-feedback","metadata-editor","metadata-alias","metadata-tags","metadata-folder","metadata-save","metadata-cancel","metadata-feedback","metadata-title","dialog-new","dialog-input","dialog-send","dialog-stop","dialog-editor","dialog-feedback","dialog-history"].map(id=>[id,element(id)]))
  const nav=["thread.list","mcp.list","skill.list","knowledge.list"].map(page=>{const e=element(page);e.dataset.page=page;return e}),posted:any[]=[],window:any={webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}}
  const buttons=()=>ids.list.children.flatMap((row:any)=>row.children).filter((v:any)=>v.attributes["data-thread-metadata"])
  const document:any={events:{},addEventListener(k:string,f:any){this.events[k]=f},getElementById:(id:string)=>ids[id],querySelectorAll:(selector:string)=>selector==="[data-thread-metadata]"?buttons():nav,querySelector:(selector:string)=>selector==='[data-page="thread.list"]'?nav[0]:buttons().find((v:any)=>selector===`[data-thread-metadata="${v.attributes["data-thread-metadata"]}"]`),createElement:(id:string)=>{const e=element(id);const focus=e.focus;e.focus=()=>{focus.call(e);document.activeElement=e};return e}}
  for(const e of [...Object.values(ids),...nav] as any[]){const focus=e.focus;e.focus=()=>{focus.call(e);document.activeElement=e}}
  for(const b of nav)b.click=()=>b.events.click?.()
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../../src/desktop/assets/app.js"),"utf8"),{window,document},{timeout:1000})
  const receive=(f:any)=>window.cmsparkDesktopReceive(f);if(withDocument)receive({type:"desktop.document",generation:"owned-document"})
  const open=(id="metadata-A")=>{receive({type:"thread.list",threads:[{id,title:id}]});const button=ids.list.children[0].children.find((v:any)=>v.attributes["data-thread-dialog"]);assert.ok(button,"actual native renderer must expose the canonical dialog selector");button.events.click();return posted.at(-1)}
  return{ids,nav,posted,receive,open,window,document}
}

function setup(t:any,stopOnce=false){const {dir,manager}=owned(t),f=renderer(),inputs:NativeDialogStart[]=[],ends:Array<()=>void>=[];let stops=0;const runtime={start:async(i:NativeDialogStart)=>{inputs.push(i);let stopRequested=false;i.started({current:()=>true,stop:()=>{stops++;if(stopOnce&&stopRequested)return false;stopRequested=true;return true}});await new Promise<void>(r=>ends.push(r))}},c=authenticated(t,manager,runtime);const flush=()=>{while(c.sent.length)f.receive(c.sent.shift())};const wire=()=>{const p={...f.posted.at(-1)};delete p.generation;c.send(p);flush();return p};const select=(id:string)=>{f.receive({type:"thread.list",threads:manager.desktopMetadataSnapshot().map(x=>({id:x.id,title:x.alias}))});const b=f.ids.list.children.flatMap((li:any)=>li.children).find((b:any)=>b.attributes["data-thread-dialog"]===id);assert.ok(b);b.click();return wire()};return{dir,manager,f,c,inputs,ends,wire,flush,select,get stops(){return stops}}}
test("actual DOM selects two canonical threads, rebinds only fresh owned stream, and Stop still targets original run",async t=>{const a=setup(t);a.select("metadata-A");a.f.ids["dialog-input"].value="<img onerror=owned>";a.f.ids["dialog-send"].click();const sent=a.wire();await tick();const input=a.inputs[0],user=a.manager.addMessage("metadata-A",{thread_id:"metadata-A",role:"user",content:sent.message,id:sent.id});input.event({type:"chat.user",thread_id:"metadata-A",message_id:user.id,client_message_id:sent.id,content:user.content});input.event({type:"chat.token",thread_id:"metadata-A",content:"first"});a.flush();assert.equal(a.f.ids["dialog-input"].value,"");assert.equal(a.f.ids["dialog-history"].children[0].textContent,"你\n<img onerror=owned>");assert.equal(a.f.ids["dialog-history"].children[0].innerHTML,undefined);a.select("metadata-B");a.f.ids["dialog-input"].value="B draft";input.event({type:"chat.token",thread_id:"metadata-A",content:"MUST_NOT_WRITE_B"});a.flush();assert.equal(a.f.ids["dialog-history"].children.length,0);a.select("metadata-A");input.event({type:"chat.token",thread_id:"metadata-A",content:"owned rebound"});a.flush();assert.equal(a.f.ids["dialog-history"].children.at(-1).textContent,"CMspark\nowned rebound");a.select("metadata-B");a.f.ids["dialog-stop"].click();const stop=a.wire();assert.equal(stop.thread_id,"metadata-A");assert.equal(stop.run_id,sent.id);assert.equal(a.stops,1);a.ends[0]();await tick();a.flush();assert.equal(a.f.ids["dialog-input"].value,"B draft");assert.equal(a.f.ids["dialog-stop"].hidden,true)})
test("actual DOM keeps unconfirmed draft after socket loss and never automatically resends on new document",async t=>{const a=setup(t);a.select("metadata-A");a.f.ids["dialog-input"].value="retained owned draft";a.f.ids["dialog-send"].click();const sent=a.wire();await tick();a.manager.addMessage("metadata-A",{thread_id:"metadata-A",role:"user",content:sent.message,id:sent.id}); // real commit, deliberately no user receipt delivered
const before=a.f.posted.filter((f:any)=>f.type==="desktop.chat.send").length;a.c.socket.terminate();a.f.receive({type:"desktop.offline"});assert.equal(a.f.ids["dialog-input"].value,"retained owned draft");assert.ok(a.f.ids["dialog-feedback"].textContent.includes("未确认"));a.ends[0]();await tick();a.f.receive({type:"desktop.document",generation:"new-owned-document"});assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.send").length,before);assert.equal(new ThreadManager().getMessages("metadata-A").length,1)})
test("actual open reply IDs reject A-B-A late history without losing current draft",t=>{const a=setup(t);a.f.open("metadata-A");const first={...a.f.posted.at(-1)};delete first.generation;a.c.send(first);const old=a.c.sent.shift();a.select("metadata-B");a.select("metadata-A");a.f.ids["dialog-input"].value="latest draft";a.manager.addMessage("metadata-A",{thread_id:"metadata-A",role:"assistant",content:"new persisted"});a.select("metadata-A");assert.equal(a.f.ids["dialog-history"].children.length,1);a.f.receive(old);assert.equal(a.f.ids["dialog-history"].children.length,1);assert.equal(a.f.ids["dialog-input"].value,"latest draft")})
for(const untrusted of[false,true])for(const disabledRelease of[false,true])test(`complete new native form via actual DOM/channel, CPU key seam only, untrusted=${untrusted}, disabledRelease=${disabledRelease}`,async t=>{
 const a=setup(t);a.manager.create("native-dialog-other","native-dialog-other");let keys=0,refused=false,offline:any;const receipts:string[]=[]
 // Implement only the DOM APIs actually used by the delivered form. No native
 // controller or trusted physical input is represented by this CPU seam.
 const descendants=(node:any):any[]=>[...node.children,...node.children.flatMap(descendants)]
 a.f.ids.list.querySelectorAll=(selector:string)=>descendants(a.f.ids.list).filter((b:any)=>selector==="[data-thread-dialog]"&&b.attributes["data-thread-dialog"])
 Object.defineProperty(a.f.ids["dialog-history"],"textContent",{get(){return this.children.map((c:any)=>c.textContent).join("")},set(_value){}})
 a.f.posted.length=0
 vm.runInNewContext("const documentGeneration='owned-document';"+fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/dialog-form.js"),"utf8"),{window:a.f.window,document:a.f.document},{timeout:1000})
 try{for(let i=0;i<100&&a.f.posted.length;i++){
   const frame=a.f.posted.shift()
   if(frame.type==="D476.dialog.offline"){offline=frame;continue}
   if(frame.type==="system.ping"){
     receipts.push(frame.id);if(frame.id==="D476_FAIL_DIALOG_PHASE"){refused=true;break}
     if(["D476_DIALOG_NEW_KEY","D476_DIALOG_SEND_KEY","D476_DIALOG_FOLLOWUP_KEY","D476_DIALOG_STOP_KEY","D476_DIALOG_OTHER_KEY","D476_DIALOG_REOPEN_KEY","D476_DIALOG_LOST_ACK_KEY"].includes(frame.id)){keys++;const target=a.f.document.activeElement,event={key:"Enter",target,isTrusted:!untrusted};a.f.document.events.keydown?.(event);target.click();if(!disabledRelease||!target.disabled)a.f.document.events.keyup?.(event)}
     continue
   }
   const plain={...frame};delete plain.generation;a.c.send(plain);await tick();a.flush()
   if(frame.type==="desktop.chat.send"){const input=a.inputs.at(-1)!,row=a.manager.addMessage(input.threadId,{thread_id:input.threadId,role:"user",content:input.message,id:input.messageId});if(a.inputs.length===3){a.c.socket.terminate();a.f.receive({type:"desktop.offline"});continue}input.event({type:"chat.user",thread_id:input.threadId,message_id:row.id,client_message_id:input.messageId,content:row.content});if(a.inputs.length===1){input.event({type:"desktop.chat.confirmation_unavailable",thread_id:input.threadId});input.event({type:"chat.done",thread_id:input.threadId});a.ends[0]();await tick();a.flush()}else{input.event({type:"chat.token",thread_id:input.threadId,content:"native stream"});a.flush()}}
   if(frame.type==="desktop.chat.stop"){a.ends[1]();await tick();a.flush()}
 }
 if(untrusted){assert.equal(refused,true);assert.equal(offline,undefined)}else{assert.equal(refused,false);assert.equal(keys,7);assert.equal(offline?.result,"ok");for(const id of["CREATED","USER","STREAMED","L2_DENIED","STOPPED","REOPEN"])assert.ok(receipts.includes("D476_DIALOG_"+id),id);assert.equal(a.stops,2,"Stop and real socket close each cancel only their own captured run");const stored=new ThreadManager().getMessages(a.inputs[0].threadId);assert.equal(stored.filter(row=>row.role==="user").length,3);assert.equal(stored.filter(row=>row.content==="offline owned draft").length,1)}}finally{for(const end of a.ends)end();await tick()}
})

for(const view of ["current","mcp","select-B","A-B-A"] as const)test(`actual delayed New completion preserves its view intent: ${view}`,async t=>{
 const a=setup(t);a.select("metadata-A");a.f.ids["dialog-input"].value="A retained draft";const before=a.manager.desktopMetadataSnapshot().length;a.f.ids["dialog-new"].click();const request={...a.f.posted.at(-1)};delete request.generation;a.c.send(request);const reply=a.c.sent.shift();assert.equal(reply.type,"desktop.thread.create.result");assert.equal(reply.created,true);assert.equal(new ThreadManager().get(reply.thread_id)?.id,reply.thread_id,"the held result comes from a real persisted create");assert.equal(a.f.ids["dialog-new"].disabled,true);a.f.ids["dialog-new"].click();assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.thread.create").length,1,"pending creation is not replayed when the view changes");
 if(view==="mcp")a.f.nav.find((n:any)=>n.dataset.page==="mcp.list").click();if(view==="select-B")a.select("metadata-B");if(view==="A-B-A"){a.select("metadata-B");a.select("metadata-A")}
 const draft=view==="mcp"?undefined:"selected draft "+view;if(draft)a.f.ids["dialog-input"].value=draft;const opens=a.f.posted.filter((f:any)=>f.type==="desktop.thread.open").length;a.f.receive(reply);
 if(view==="current"){assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.thread.open").length,opens+1);assert.equal(a.f.posted.at(-1).thread_id,reply.thread_id);a.wire();a.select("metadata-A");assert.equal(a.f.ids["dialog-input"].value,draft)}else{assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.thread.open").length,opens,"a stale create reply cannot select a newly-created thread");if(view==="mcp"){assert.equal(a.f.ids.title.textContent,"MCP");assert.equal(a.f.ids["dialog-editor"].hidden,true)}else assert.equal(a.f.ids["dialog-input"].value,draft);assert.ok(a.f.ids["dialog-feedback"].textContent.includes("已创建"),"confirmed persistence is not relabelled failure or UNKNOWN")}
 assert.equal(a.f.ids["dialog-new"].disabled,false);assert.equal(a.manager.desktopMetadataSnapshot().length,before+1);assert.equal(a.inputs.length,0);const count=a.f.posted.length;a.f.receive(reply);assert.equal(a.f.posted.length,count,"duplicate ACK cannot reopen or recreate");
})

// A controlled captured-run handle has the existing canonical Stop contract:
// first call accepts, later calls return false. Real DOM/channel/HMAC/service
// parsing and result production are still executed; no native/provider is run.
test("actual renderer/channel sends one Stop before and after the first real ACK",async t=>{
 const a=setup(t,true);a.select("metadata-A");a.f.ids["dialog-input"].value="owned stop once";a.f.ids["dialog-send"].click();a.wire();await tick();const start=a.f.posted.length
 try{
  a.f.ids["dialog-stop"].click();a.f.ids["dialog-stop"].events.click();const requests=a.f.posted.slice(start).filter((f:any)=>f.type==="desktop.chat.stop"),replies:any[]=[]
  for(const frame of requests){const plain={...frame};delete plain.generation;a.c.send(plain);while(a.c.sent.length){const reply=a.c.sent.shift();replies.push(reply);a.f.receive(reply)}}
  t.diagnostic(JSON.stringify({stopRequests:requests.length,capturedStopCalls:a.stops,stopResultValues:replies.filter(f=>f.type==="desktop.chat.stop.result").map(f=>f.stopped),feedbackChanged:a.f.ids["dialog-feedback"].textContent.includes("运行已变化")}))
  assert.equal(requests.length,1,"the actual handler must suppress a synchronous duplicate, even when a caller bypasses disabled DOM behavior");assert.equal(a.stops,1);assert.equal(a.f.ids["dialog-stop"].disabled,true);assert.ok(a.f.ids["dialog-feedback"].textContent.includes("等待实际运行结束"));const posted=a.f.posted.length;a.f.ids["dialog-stop"].events.click();assert.equal(a.f.posted.length,posted,"accepted Stop remains pending until actual terminal, not just ACK");assert.equal(a.f.ids["dialog-stop"].hidden,false)
 }finally{for(const end of a.ends)end();await tick();a.flush()}
 assert.equal(a.f.ids["dialog-stop"].hidden,true)
})
test("pending Stop remains captured across A-B-A and MCP navigation with a lost ACK",async t=>{
 const a=setup(t,true);a.select("metadata-A");a.f.ids["dialog-input"].value="owned held stop ACK";a.f.ids["dialog-send"].click();const send=a.wire();await tick()
 try{
  a.f.ids["dialog-stop"].click();const stop={...a.f.posted.at(-1)};delete stop.generation;a.c.send(stop);const held=a.c.sent.shift();assert.equal(held.type,"desktop.chat.stop.result");assert.equal(held.stopped,true)
  const assertPending=()=>{assert.equal(a.f.ids["dialog-stop"].disabled,true);const before=a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length;a.f.ids["dialog-stop"].events.click();assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length,before);assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length,1)}
  a.select("metadata-B");a.f.ids["dialog-input"].value="B draft while A stopping";assertPending();a.select("metadata-A");assertPending();a.f.nav.find((n:any)=>n.dataset.page==="mcp.list").click();assertPending();a.f.receive(held);assertPending();assert.equal(stop.thread_id,"metadata-A");assert.equal(stop.run_id,send.id);assert.equal(a.stops,1)
 }finally{for(const end of a.ends)end();await tick();a.flush()}
 assert.equal(a.f.ids["dialog-stop"].hidden,true)
})
test("actual terminal retires pending Stop and a successor run can Stop once",async t=>{
 const a=setup(t,true);a.select("metadata-A");a.f.ids["dialog-input"].value="first owned";a.f.ids["dialog-send"].click();const first=a.wire();await tick();a.f.ids["dialog-stop"].click();a.wire();a.ends[0]();await tick();a.flush();a.wire();assert.equal(a.f.ids["dialog-stop"].hidden,true)
 a.f.ids["dialog-input"].value="successor owned";a.f.ids["dialog-send"].click();const next=a.wire();await tick()
 try{assert.notEqual(next.id,first.id);assert.equal(a.f.ids["dialog-stop"].disabled,false);const count=a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length;a.f.ids["dialog-stop"].click();a.f.ids["dialog-stop"].events.click();const stop=a.wire();assert.equal(stop.run_id,next.id);assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length,count+1);assert.equal(a.f.ids["dialog-stop"].disabled,true)}finally{for(const end of a.ends)end();await tick();a.flush()}
})
for(const reset of ["desktop.offline","desktop.document"] as const)test(`actual DOM ${reset} clears the pending Stop without replay`,async t=>{
 const a=setup(t,true);a.select("metadata-A");a.f.ids["dialog-input"].value="owned document lifecycle";a.f.ids["dialog-send"].click();a.wire();await tick();a.f.ids["dialog-stop"].click();a.wire();const before=a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length
 try{if(reset==="desktop.offline")a.c.socket.terminate();a.f.receive(reset==="desktop.offline"?{type:reset}:{type:reset,generation:"replacement-owned-document"});assert.equal(a.f.ids["dialog-stop"].hidden,true);a.f.ids["dialog-stop"].events.click();assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length,before);a.f.receive({type:"desktop.document",generation:"next-owned-document"});assert.equal(a.f.posted.filter((f:any)=>f.type==="desktop.chat.stop").length,before);assert.equal(a.f.ids["dialog-stop"].hidden,true)}finally{for(const end of a.ends)end();await tick();a.flush()}
})


test("dialog native key witness binds each request to its expected focused button",()=>{
 for(const [focus,trusted,late] of [["normal",true,false],["noop",true,false],["wrong",true,false],["normal",false,false],["normal",true,true]] as const){
  const f=renderer();f.posted.length=0;const body={id:"inert-body",getAttribute:()=>null};f.document.activeElement=body;
  const expected=f.ids["dialog-new"];if(focus==="noop")expected.focus=()=>{};if(focus==="wrong")expected.focus=()=>{f.document.activeElement=f.ids["mcp-new"]};
  vm.runInNewContext("const documentGeneration='owned-document';"+fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/dialog-form.js"),"utf8"),{window:f.window,document:f.document},{timeout:1000});
  const failures=()=>f.posted.filter((x:any)=>x.id==="D476_FAIL_DIALOG_PHASE").length,keys=()=>f.posted.filter((x:any)=>x.id==="D476_DIALOG_NEW_KEY").length;
  if(focus!=="normal"){assert.equal(keys(),0,"failed focus cannot request a native key");assert.equal(failures(),1)}
  else{assert.equal(keys(),1);assert.equal(failures(),0);assert.equal(f.document.activeElement,expected);if(late)f.document.activeElement=body;f.document.events.keydown({key:"Enter",isTrusted:trusted,target:f.document.activeElement});assert.equal(failures(),trusted&&!late?0:1,"another active control is not the expected key recipient");if(trusted&&!late){f.document.events.keydown({key:"Enter",isTrusted:true,target:expected});assert.equal(failures(),1,"the same key request is not consumed twice")}}
  assert.equal(f.posted.filter((x:any)=>x.type==="desktop.thread.create").length,0);assert.equal(f.posted.filter((x:any)=>x.type==="desktop.chat.send").length,0);
 }
})
