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
import { desktopThreadMetadata } from "../src/desktop/thread-metadata"
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
function authenticated(t: any, manager: ThreadManager) {
  const registry=new DesktopIdentityRegistry(),channel=createDesktopChannel({registry,services:{threads:manager,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024})
  const sent:any[]=[],socket:any=new EventEmitter();socket.readyState=1;socket.send=(b:string)=>sent.push(JSON.parse(b));socket.terminate=socket.close=()=>{socket.readyState=3;socket.emit("close")}
  channel.wss.emit("connection",socket);assert.equal(sent.shift().type,"desktop.challenge.request")
  const boot=registry.issue("owned-metadata-476");socket.emit("message",Buffer.from(JSON.stringify({type:"desktop.hello",capability_id:boot.capabilityId,protocol_version:1})))
  const ch=sent.shift(),input=JSON.stringify(["cmspark.desktop.auth.v1",boot.capabilityId,ch.connection_id,1,ch.nonce])
  socket.emit("message",Buffer.from(JSON.stringify({type:"desktop.authenticate",capability_id:boot.capabilityId,protocol_version:1,proof:createHmac("sha256",Buffer.from(boot.secret,"hex")).update(input).digest("hex")})))
  assert.equal(sent.shift().type,"desktop.ready");t.after(()=>{socket.terminate();channel.wss.emit("close")})
  return {send:(frame:any)=>{socket.emit("message",Buffer.from(typeof frame==="string"?frame:JSON.stringify(frame)));return sent.shift()},sent,socket,registry}
}
function element(id:string):any {return{id,textContent:"",value:"",hidden:false,disabled:false,children:[],events:{},dataset:{},attributes:{},setAttribute(k:string,v:string){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},focus(){this.focused=true},click(){this.events.click?.()},replaceChildren(...v:any[]){this.children=v},append(v:any){this.children.push(v)},addEventListener(k:string,f:any){this.events[k]=f}}}
function renderer(withDocument=true) {
  const ids:any=Object.fromEntries(["title","notice","list","preview","status","view","mcp-new","mcp-editor","mcp-save","mcp-cancel","mcp-feedback","metadata-editor","metadata-alias","metadata-tags","metadata-folder","metadata-save","metadata-cancel","metadata-feedback","metadata-title"].map(id=>[id,element(id)]))
  const nav=["thread.list","mcp.list","skill.list","knowledge.list"].map(page=>{const e=element(page);e.dataset.page=page;return e}),posted:any[]=[],window:any={webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}}
  const buttons=()=>ids.list.children.flatMap((row:any)=>row.children).filter((v:any)=>v.attributes["data-thread-metadata"])
  const document:any={events:{},addEventListener(k:string,f:any){this.events[k]=f},getElementById:(id:string)=>ids[id],querySelectorAll:(selector:string)=>selector==="[data-thread-metadata]"?buttons():nav,querySelector:(selector:string)=>selector==='[data-page="thread.list"]'?nav[0]:buttons().find((v:any)=>selector===`[data-thread-metadata="${v.attributes["data-thread-metadata"]}"]`),createElement:(id:string)=>{const e=element(id);const focus=e.focus;e.focus=()=>{focus.call(e);document.activeElement=e};return e}}
  for(const e of [...Object.values(ids),...nav] as any[]){const focus=e.focus;e.focus=()=>{focus.call(e);document.activeElement=e}}
  for(const b of nav)b.click=()=>b.events.click?.()
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../../src/desktop/assets/app.js"),"utf8"),{window,document},{timeout:1000})
  const receive=(f:any)=>window.cmsparkDesktopReceive(f);if(withDocument)receive({type:"desktop.document",generation:"owned-document"})
  const open=(id="metadata-A")=>{receive({type:"thread.list",threads:[{id,title:id}]});const button=ids.list.children[0].children.find((v:any)=>v.textContent==="对话信息");assert.ok(button,"actual native renderer must expose one grouped metadata editor");button.events.click();return posted.at(-1)}
  return{ids,nav,posted,receive,open,window,document}
}

test("grouped metadata methods are narrow and do not grant generic thread.update",()=>{
  assert.ok((DESKTOP_RENDERER_METHODS as readonly string[]).includes("desktop.thread.metadata.edit"))
  assert.ok((DESKTOP_RENDERER_METHODS as readonly string[]).includes("desktop.thread.metadata.save"))
  assert.equal((DESKTOP_RENDERER_METHODS as readonly string[]).includes("thread.update"),false)
})
test("real native renderer output enters the actual authenticated channel and persists all three values",t=>{
  const {manager}=owned(t),c=authenticated(t,manager),f=renderer(),edit=f.open()
  const wire=({...edit});delete wire.generation;const value=c.send(wire);assert.equal(value.type,"desktop.thread.metadata.edit.result");f.receive(value)
  f.ids["metadata-alias"].value="新名称";f.ids["metadata-tags"].value="Review\n支付";f.ids["metadata-folder"].value="付款";f.ids["metadata-save"].events.click()
  const save={...f.posted.at(-1)};delete save.generation;const result=c.send(save);assert.equal(result.ok,true);assert.equal(result.saved,true);f.receive(result)
  const persisted=new ThreadManager().get("metadata-A")!;assert.equal(persisted.alias,"新名称");assert.deepEqual(persisted.user_tags,["Review","支付"]);assert.equal(persisted.topic_folder,"付款");assert.equal(manager.get("metadata-B")!.alias,"对话B")
})
for(const fault of ["write","rename"] as const)test(`metadata ${fault} failure preserves actual disk and target state`,t=>{
  const {manager}=owned(t),before=JSON.parse(JSON.stringify(manager.get("metadata-A"))),disk=new ThreadManager().get("metadata-A"),primary=Error("owned never exposed")
  if(fault==="rename"){const rename=fs.renameSync;t.mock.method(fs,"renameSync",(...a:any[])=>{if(String(a[1]).endsWith(path.join("threads","index.json")))throw primary;return Reflect.apply(rename,fs,a)})}
  else {const write=fs.writeFileSync;t.mock.method(fs,"writeFileSync",(...a:any[])=>{if(String(a[0]).includes("index.json.tmp-"))throw primary;return Reflect.apply(write,fs,a)})}
  const update=(manager as any).updateDesktopMetadata ?? manager.update
  assert.throws(()=>update.call(manager,"metadata-A",{alias:"must-not-save",user_tags:["x"],topic_folder:"y"}),e=>e===primary)
  assert.deepEqual(manager.get("metadata-A"),before);assert.deepEqual(new ThreadManager().get("metadata-A"),disk)
})

function editFrame(id="e", thread_id="metadata-A"){return{type:"desktop.thread.metadata.edit",id,thread_id}}
function saveFrame(payload_json:string,id="s",thread_id="metadata-A"){return{type:"desktop.thread.metadata.save",id,thread_id,payload_json}}
function wire(frame:any){const value={...frame};delete value.generation;return value}
function openActual(f:ReturnType<typeof renderer>,c:ReturnType<typeof authenticated>,id="metadata-A"){const edit=f.open(id),reply=c.send(wire(edit));f.receive(reply);return{edit,reply}}

test("actual channel refuses generic update, extra keys, duplicates and invalid targets without changing disk",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),before=fs.readFileSync(path.join(process.env.CMSPARK_DATA_DIR!,"threads/index.json"),"utf8")
 const denied=c.send({type:"thread.update",id:"x",thread_id:"metadata-A",alias:"unsafe"});assert.ok(!denied||denied.ok!==true)
 for(const raw of ['{}','{"alias":"x","alias":"y"}','{"alias":"x","\\u0061lias":"y"}','{"__proto__":{}}','{"config_override":{}}','{"alias":null}','{"user_tags":{}}','{"topic_folder":[]}']){
   const reply=c.send(saveFrame(raw));assert.equal(reply.ok,false,raw);assert.equal(reply.saved,false,raw)
 }
 for(const frame of [{...editFrame(),extra:true},saveFrame('{"alias":"x"}',"x","../outside"),editFrame("x","missing")])assert.equal(c.send(frame).ok,false)
 assert.equal(fs.readFileSync(path.join(process.env.CMSPARK_DATA_DIR!,"threads/index.json"),"utf8"),before)
})
test("native metadata refuses existing and proposed redaction without leaking labels or mutating store",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),secret="sk-"+"A".repeat(48)
 const proposed=c.send(saveFrame(JSON.stringify({alias:secret})));assert.equal(proposed.error_code,"DESKTOP_METADATA_REDACTED");assert.equal(JSON.stringify(proposed).includes(secret),false)
 manager.update("metadata-A",{alias:secret});const reply=c.send(editFrame());assert.equal(reply.error_code,"DESKTOP_METADATA_REDACTED");assert.equal(JSON.stringify(reply).includes(secret),false)
 assert.equal(manager.get("metadata-A")!.alias,secret)
})
test("safe metadata DTO excludes thread internals and read never seeds run_progress",t=>{
 const {manager}=owned(t),target=(manager as any).index.threads.find((v:any)=>v.id==="metadata-A");target.runtime_context_budget={handoff:{open_todos:["private todo"]}};target.run_progress=undefined
 const c=authenticated(t,manager),reply=c.send(editFrame());assert.equal(reply.ok,true);assert.deepEqual(Object.keys(reply.metadata).sort(),["alias","topic_folder","user_tags"]);assert.equal(target.run_progress,undefined);assert.equal(JSON.stringify(reply).includes("private todo"),false)
})
test("failed target rollback restores updated_at and seeded progress while preserving disk-merged sibling",t=>{
 const {manager}=owned(t),target=(manager as any).index.threads.find((v:any)=>v.id==="metadata-A");target.runtime_context_budget={handoff:{open_todos:["owned seed"]}};delete target.run_progress
 const oldTime=target.updated_at,peer=new ThreadManager();peer.update("metadata-B",{digest:{extracted_at:"2026-10-17T00:00:00Z",content_fingerprint:"0:empty",tldr:"peer persisted",tags:["peer"],source:"manual"}});const original=fs.renameSync,primary=Error("owned storage failure")
 t.mock.method(fs,"renameSync",(...args:any[])=>{if(String(args[1]).endsWith(path.join("threads","index.json")))throw primary;return Reflect.apply(original,fs,args)})
 assert.throws(()=>manager.updateDesktopMetadata("metadata-A",{alias:"not saved"}),e=>e===primary)
 assert.equal(target.alias,"对话A");assert.equal(target.updated_at,oldTime);assert.equal(Object.hasOwn(target,"run_progress"),false);assert.equal(manager.get("metadata-B")!.digest!.tldr,"peer persisted")
 assert.equal(new ThreadManager().get("metadata-A")!.alias,"对话A");assert.equal(new ThreadManager().get("metadata-B")!.digest!.tldr,"peer persisted")
})
test("lost ACK after a real commit remains unconfirmed and never replays the update",t=>{
 const {manager}=owned(t);let current=true,calls=0;const original=manager.updateDesktopMetadata.bind(manager)
 const services:any={threads:{desktopMetadataSnapshot:()=>manager.desktopMetadataSnapshot(),updateDesktopMetadata:(id:string,patch:any)=>{calls++;const value=original(id,patch);current=false;return value}}}
 const reply=desktopThreadMetadata(saveFrame('{"alias":"committed once"}'),services,()=>current);assert.equal(reply.saved,false);assert.equal(reply.error_code,"DESKTOP_METADATA_STALE");assert.equal(calls,1);assert.equal(new ThreadManager().get("metadata-A")!.alias,"committed once")
 desktopThreadMetadata(saveFrame('{"alias":"must not replay"}'),services,()=>current);assert.equal(calls,1)
})
for(const transition of ["ABA","cancel-reopen","document","offline"] as const)test(`actual UI ignores stale edit/save replies after ${transition}`,t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer(),first=openActual(f,c)
 f.ids["metadata-alias"].value="pending old";f.ids["metadata-save"].events.click();const save=f.posted.at(-1),saveReply=c.send(wire(save));assert.equal(f.ids["metadata-save"].disabled,true);assert.equal(f.ids["metadata-alias"].disabled,true)
 if(transition==="ABA"){openActual(f,c,"metadata-B");openActual(f,c,"metadata-A")}
 if(transition==="cancel-reopen"){f.ids["metadata-cancel"].events.click();openActual(f,c)}
 if(transition==="document"){f.receive({type:"desktop.document",generation:"new-document"});assert.equal(f.ids["metadata-save"].disabled,true);openActual(f,c)}
 if(transition==="offline"){f.receive({type:"desktop.offline"});assert.equal(f.ids["metadata-save"].disabled,true)}
 const before=f.ids["metadata-alias"].value;f.receive(first.reply);f.receive(saveReply);assert.equal(f.ids["metadata-alias"].value,before);assert.notEqual(f.ids["metadata-feedback"].textContent,"已保存对话信息。")
})
test("actual UI keeps draft on failed persistence and rejects malformed or wrong-target ACK",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer();openActual(f,c);f.ids["metadata-alias"].value="retained draft";f.ids["metadata-save"].events.click();const request=f.posted.at(-1)
 const real=c.send(wire(request));f.receive({...real,thread_id:"metadata-B"});assert.equal(f.ids["metadata-save"].disabled,true)
 f.receive({...real,metadata:{...real.metadata,config_override:{}}});assert.notEqual(f.ids["metadata-feedback"].textContent,"已保存对话信息。");assert.equal(f.ids["metadata-alias"].value,"retained draft")
})
test("both native builders bind each acceptance family to its exact actual form",()=>{
 for(const name of ["build-desktop-native.mjs","build-desktop-windows.mjs"]){const source=fs.readFileSync(path.resolve(__dirname,"../../scripts",name),"utf8");assert.match(source,/\["metadata","metadata-form.js"\]/);assert.match(source,/path.join\(root,"tests\/fixtures\/desktop-476",formName\)/);assert.doesNotMatch(source,/mcpForm=fs.readFileSync\(path.join\(root,"tests\/fixtures\/desktop-476\/native-form.js"\)/)}
})

for(const docFirst of [true,false])test(`actual hosted form initial save + renderer + channel persists metadata, document first=${docFirst}`,t=>{
 const {manager}=owned(t);manager.create("原名称","native-metadata-A");const c=authenticated(t,manager),f=renderer(docFirst);f.posted.length=0
 vm.runInNewContext("const documentGeneration='owned-document';"+fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-form.js"),"utf8"),{window:f.window,document:f.document},{timeout:1000})
 if(!docFirst){assert.equal(f.posted.length,0);f.receive({type:"desktop.document",generation:"owned-document"})}
 let complete=false
 for(let i=0;i<30&&f.posted.length;i++){const frame=f.posted.shift();if(frame.type==="system.ping"){assert.equal(frame.id,"D476_META_FIRST_SAVED");complete=true;break}const reply=c.send(wire(frame));if(reply)f.receive(reply)}
 assert.equal(complete,true,"the initial real save must be checkpointed before native-only keyboard/offline stages");const disk=new ThreadManager().get("native-metadata-A")!;assert.equal(disk.alias,"原生 中文对话");assert.deepEqual(disk.user_tags,["Review","付款"]);assert.equal(disk.topic_folder,"项目资料")
})
test("cancel restores focus to the current row after an actual list refresh",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer();openActual(f,c);f.receive(c.send({type:"thread.list",id:"thread.list"}));const current=f.ids.list.children.find((row:any)=>row.children.some((v:any)=>v.attributes["data-thread-metadata"]==="metadata-A")).children.find((button:any)=>button.attributes["data-thread-metadata"]==="metadata-A")
 f.ids["metadata-cancel"].events.click();assert.equal(current.focused,true);assert.equal(f.ids["metadata-editor"].hidden,true)
})
test("reconnect preserves draft but requires a fresh read before a new save",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer();openActual(f,c);f.ids["metadata-alias"].value="offline draft";f.receive({type:"desktop.offline"});f.receive({type:"desktop.document",generation:"new-document"});const count=f.posted.length;f.ids["metadata-save"].events.click();assert.equal(f.posted.length,count);openActual(f,c);assert.equal(f.ids["metadata-alias"].value,"offline draft");f.ids["metadata-save"].events.click();assert.equal(JSON.parse(f.posted.at(-1).payload_json).alias,"offline draft")
})

test("actual route storage failure never displays Saved and retains the submitted draft",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer();openActual(f,c);f.ids["metadata-alias"].value="unsaved draft";f.ids["metadata-save"].events.click();const request=f.posted.at(-1),original=fs.renameSync,primary=Error("private owned storage context")
 t.mock.method(fs,"renameSync",(...args:any[])=>{if(String(args[1]).endsWith(path.join("threads","index.json")))throw primary;return Reflect.apply(original,fs,args)})
 const reply=c.send(wire(request));assert.equal(reply.saved,false);assert.equal(reply.error_code,"DESKTOP_METADATA_SAVE_UNCONFIRMED");assert.equal(JSON.stringify(reply).includes(primary.message),false);f.receive(reply);assert.equal(f.ids["metadata-alias"].value,"unsaved draft");assert.equal(f.ids["metadata-save"].disabled,false);assert.notEqual(f.ids["metadata-feedback"].textContent,"已保存对话信息。");assert.equal(new ThreadManager().get("metadata-A")!.alias,"对话A")
})
test("socket owner revocation prevents future metadata writes",t=>{
 const {manager}=owned(t),c=authenticated(t,manager);c.registry.revokeHost("owned-metadata-476");const reply=c.send(saveFrame('{"alias":"must not save"}'));assert.ok(!reply||reply.ok!==true);assert.equal(new ThreadManager().get("metadata-A")!.alias,"对话A")
})

test("even a repeated document generation retires pending saves and requires a fresh target read",t=>{
 const {manager}=owned(t),c=authenticated(t,manager),f=renderer();openActual(f,c);f.ids["metadata-alias"].value="draft after duplicate document";f.ids["metadata-save"].events.click();const prior=c.send(wire(f.posted.at(-1)));f.receive({type:"desktop.document",generation:"owned-document"});f.receive(prior);const count=f.posted.length;f.ids["metadata-save"].events.click();assert.equal(f.posted.length,count);assert.equal(f.ids["metadata-save"].disabled,true);assert.notEqual(f.ids["metadata-feedback"].textContent,"已保存对话信息。");openActual(f,c);assert.equal(f.ids["metadata-alias"].value,"draft after duplicate document")
})

for(const variant of [{corruptDraft:false,untrusted:""},{corruptDraft:true,untrusted:""},{corruptDraft:false,untrusted:"Escape"},{corruptDraft:false,untrusted:"Enter"}])test(`complete metadata phase machine via actual renderer/channel, CPU keyboard seam only, ${JSON.stringify(variant)}`,t=>{
 const {corruptDraft,untrusted}=variant;let refused=false
 const {manager}=owned(t);manager.create("原名称","native-metadata-A");manager.create("另一对话","native-metadata-B")
 const c=authenticated(t,manager),f=renderer(),receipts:string[]=[];f.posted.length=0
 vm.runInNewContext("const documentGeneration='owned-document';"+fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-form.js"),"utf8"),{window:f.window,document:f.document},{timeout:1000})
 let saves=0,offline:any,edits=0,escape=0,enter=0
 for(let i=0;i<100&&f.posted.length;i++){
  const frame=f.posted.shift()
  if(frame.type==="D476.metadata.offline"){offline=frame;continue}
  if(frame.type==="system.ping"){
   receipts.push(frame.id);if(frame.id.startsWith("D476_FAIL_")){assert.ok(untrusted,"only untrusted key negative may refuse");refused=true;break}
   if(frame.id==="D476_META_ESCAPE_REQUEST"){escape++;f.ids["metadata-editor"].events.keydown({key:"Escape",preventDefault(){}});f.document.events.keyup({key:"Escape",isTrusted:untrusted!=="Escape"})}
   if(frame.id==="D476_META_ENTER_REQUEST"){enter++;f.document.activeElement.click();f.document.events.keyup({key:"Enter",isTrusted:untrusted!=="Enter"})} // CPU stand-in only; hosted native uses OS/window events.
   continue
  }
  if(frame.type==="desktop.thread.metadata.edit")edits++
  const reply=c.send(wire(frame))
  if(frame.type==="desktop.thread.metadata.save"){
   saves++;assert.equal(reply.saved,true)
   if(saves===2){c.socket.terminate();if(corruptDraft)f.ids["metadata-alias"].value="bad draft";f.receive({type:"desktop.offline"});continue}
  }
  if(reply)f.receive(reply)
 }
 if(untrusted){assert.equal(refused,true);assert.equal(saves,1);assert.equal(offline,undefined);assert.equal(new ThreadManager().get("native-metadata-A")!.alias,"原生 中文对话");return}
 assert.equal(saves,2);assert.equal(edits,3);assert.equal(escape,1);assert.equal(enter,1)
 assert.equal(receipts.includes("D476_NATIVE_DONE"),false,"first save is never full native completion")
 assert.deepEqual(receipts.filter(v=>!v.endsWith("REQUEST")),["D476_META_FIRST_SAVED","D476_META_REOPEN_OK","D476_META_ESCAPE_OK","D476_META_ENTER_OK","D476_META_BEFORE_LOST_ACK"])
 assert.equal(offline?.result,corruptDraft?"fail":"ok");assert.equal(offline?.generation,"owned-document")
 assert.equal(f.ids["metadata-save"].disabled,true);assert.notEqual(f.ids["metadata-feedback"].textContent,"已保存对话信息。")
 const disk=new ThreadManager();assert.equal(disk.get("native-metadata-A")!.alias,"未确认 中文草稿");assert.equal(disk.get("native-metadata-B")!.alias,"另一对话")
})
test("metadata-only native fixture inverse restores every production byte and preserves MCP variant",()=>{
 const {desktopMcpFixture,desktopMetadataFixture}=require(path.resolve(__dirname,"../../scripts/desktop-mcp-fixture.mjs"))
 for(const [language,extension]of[["cpp","cpp"],["swift","swift"]]){
  const original=fs.readFileSync(path.resolve(__dirname,"../../src/desktop/native/DesktopHost."+extension),"utf8"),fixture=fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/native-acceptance."+extension),"utf8"),form=fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-form.js"),"utf8"),metadata=fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-acceptance."+extension),"utf8")
  const baseline=desktopMcpFixture(language,original,fixture,form),actual=desktopMetadataFixture(language,original,fixture,form,metadata)
  assert.equal(actual.inverse,original);assert.equal(baseline.inverse,original);assert.notEqual(actual.source,baseline.source)
  assert.ok(actual.source.includes("D476.metadata.offline"));assert.ok(actual.source.includes(language==="cpp"?"PostMessageW(info.hwndFocus,WM_KEYDOWN,code,1|scan)":"NSApp.sendEvent(down);NSApp.sendEvent(up)"))
  assert.equal(actual.source.includes("dispatchEvent(new KeyboardEvent"),false)
  assert.throws(()=>desktopMetadataFixture(language,original+original,fixture,form,metadata),/FIXTURE_ANCHOR/)
  assert.throws(()=>desktopMetadataFixture(language,original.replace(language==="cpp"?"void renderer(std::wstring const& source,std::wstring const& body){":"func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {","OWNED_CHANGED_ANCHOR"),fixture,form,metadata),/FIXTURE_ANCHOR/)
 }
})

test("actual hosted exit assertion rejects ordinary close and requires the offline terminal receipt",async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,"../../tests/desktop-native-thread-metadata-476.test.ts"),"utf8")
 const boundary=source.indexOf("// Same Node file");assert.ok(boundary>0,"the independent new dialog case follows the existing metadata case");const assertions=source.slice(0,boundary).split(/\r?\n/).filter(line=>line.trimStart().startsWith("assert.equal(await Promise.race([exit,"))
 assert.equal(assertions.length,1,"execute the actual hosted assertion, not a mirrored predicate")
 // Erase the sole TypeScript generic; retain the actual awaited predicate and expected receipt.
 const actual=assertions[0].replace(/new Promise<never>/g,"new Promise")
 const check=(code:number)=>vm.runInNewContext(`(async()=>{${actual}})()`,{assert,Promise,Error,exit:Promise.resolve(code),done:new Promise(()=>{}),t:{signal:{addEventListener(){}}}},{timeout:1000}) as Promise<void>
 for(const code of [0,1,64,75,77])await assert.rejects(check(code),"ordinary or failed exits cannot prove the offline UI observation")
 await check(76)
})
test("only metadata terminal observers emit the distinct successful native exit receipt",()=>{
 const cpp=fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-acceptance.cpp"),"utf8")
 const swift=fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/metadata-acceptance.swift"),"utf8")
 assert.match(cpp,/if\(!ok\)ExitProcess\(64\);loss=false;ExitProcess\(76\);/)
 assert.match(swift,/else\{exit\(64\)\}\r?\n\s*loss=false;exit\(76\)/)
 for(const body of [cpp,swift])assert.equal((body.match(/(?:ExitProcess|exit)\(76\)/g)||[]).length,1)
})
