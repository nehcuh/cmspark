import { prepareDialogL2Fixture } from "./helpers/desktop-dialog-l2-fixture-476"
import { withSurface650 } from "./fixtures/native-surface-650"
/** Hosted real native metadata UI. Never run local native to obtain CPU evidence. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { once } from "node:events"
import { WebSocketServer } from "ws"
import { ThreadManager } from "../src/threads/thread-manager"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { DESKTOP_NATIVE_ORIGIN } from "../src/desktop/capabilities"
import type { DesktopNativeBinding, DesktopNativeChild } from "../src/desktop/host-launcher"

test("#476 actual native grouped thread metadata UI persists all fields in the canonical manager",{skip:!["darwin","win32"].includes(process.platform),timeout:20000},async t=>{
 return withSurface650(t, async (t, surfaceLease) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"native-metadata-476-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const threads=new ThreadManager();threads.create("原名称","native-metadata-A");threads.create("另一对话","native-metadata-B")
  const registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-native-metadata-476")
  let complete!:()=>void,exitResolve!:(n:number)=>void,settled=false,authenticated=false,windowRequested=false,failed=false,child:DesktopNativeChild|undefined
  const done=new Promise<void>(r=>complete=r),exit=new Promise<number>(r=>exitResolve=r)
  const required=["D476_META_FIRST_SAVED","D476_META_REOPEN_OK","D476_META_ESCAPE_OK","D476_META_ENTER_OK","D476_META_BEFORE_LOST_ACK"],receipts=new Set<string>()
  let saveAttempts=0,droppedAck=false,initialSaved=false,connections=0,failureCode=0
  const channel=createDesktopChannel({registry,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,"workspace")}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
  attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  channel.wss.on("connection",ws=>{
    connections++
    const originalSend=ws.send.bind(ws)
    ws.send=((data:any,...args:any[])=>{
      let f:any;try{f=JSON.parse(String(data))}catch{return Reflect.apply(originalSend,ws,[data,...args])}
      if(f.type==="desktop.thread.metadata.save.result"&&f.thread_id==="native-metadata-A"&&f.ok===true&&f.saved===true){
        saveAttempts++
        if(saveAttempts===1){const saved=new ThreadManager().get("native-metadata-A")!;initialSaved=saved.alias==="原生 中文对话"&&JSON.stringify(saved.user_tags)===JSON.stringify(["Review","付款"])&&saved.topic_folder==="项目资料"}
        if(saveAttempts===2){droppedAck=true;ws.terminate();return} // Real commit, intentionally no ACK or synthetic offline frame.
      }
      return Reflect.apply(originalSend,ws,[data,...args])
    })as typeof ws.send
    ws.on("message",raw=>{
      let f:any;try{f=JSON.parse(String(raw))}catch{return}
      if(!authenticated||f.type!=="system.ping")return
      if(typeof f.id==="string"&&f.id.startsWith("D476_FAIL_")){failureCode=(["D476_FAIL_SCRIPT","D476_FAIL_METADATA_PHASE","D476_FAIL_NATIVE_WINDOW","D476_FAIL_DEFAULT_SECRET","D476_FAIL_FULL_VIEW","D476_FAIL_BUTTON","D476_FAIL_META_KEY_STATE","D476_FAIL_META_KEY_FOCUS","D476_FAIL_META_KEY_ANCESTRY","D476_FAIL_META_KEY_POST","D476_FAIL_META_KEY_FOREGROUND","D476_FAIL_META_KEY_FOREGROUND_REQUEST_ZERO"]as string[]).indexOf(f.id)+1;failed=true;complete()}
      if(required.includes(f.id)){if(receipts.has(f.id)){failed=true;complete()}receipts.add(f.id)}
    })
  })
  server.listen(0,"127.0.0.1");await once(server,"listening")
  try{
    const native=path.resolve(__dirname,"../../dist/desktop-native"),binary=path.join(native,"acceptance/metadata",process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop")
    assert.ok(fs.existsSync(binary),"the actual metadata acceptance host must be built")
    surfaceLease.checkpoint();
    child=(require(path.join(native,"desktop-launcher.node")) as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,n=>{settled=true;exitResolve(n)})
    assert.equal(await Promise.race([exit,done.then(()=>{throw Error("OWNED_METADATA_NATIVE_PHASE_FAILED")}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("OWNED_METADATA_NATIVE_DEADLINE")),{once:true}))]),76,"only the bound native offline observer may end the successful scenario")
    assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true)
    assert.equal(initialSaved,true);assert.equal(saveAttempts,2);assert.equal(droppedAck,true);assert.equal(connections,1,"offline child must not silently reconnect/replay")
    assert.deepEqual([...receipts].sort(),[...required].sort(),"all real UI reopen/native key stages must precede socket loss")
    const disk=new ThreadManager(),saved=disk.get("native-metadata-A")!;assert.equal(saved.alias,"未确认 中文草稿");assert.deepEqual(saved.user_tags,["Review","付款"]);assert.equal(saved.topic_folder,"项目资料");assert.equal(disk.get("native-metadata-B")!.alias,"另一对话")
    process.stdout.write('DESKTOP_THREAD_METADATA_476 {"native":true,"persisted":true,"fields":3,"otherThreadUnchanged":true,"uiReopened":true,"nativeKeys":2,"lostAck":true,"offlineDraftUnconfirmed":true}\n')
  }finally{
    surfaceLease.retain()
    // Fixed public receipt only: never renderer text, frame bodies, paths or credentials.
    try{t.diagnostic("D476_METADATA_NATIVE_PHASE "+JSON.stringify({schema:1,failed,failureCode,receiptMask:required.reduce((mask,id,index)=>mask|(receipts.has(id)?1<<index:0),0),saveAttempts,droppedAck,initialSaved,connections,authenticated,windowRequested,childExited:settled}))}catch{} // Observation cannot replace primary failure or skip cleanup.
    child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})
  ;surfaceLease.settled()}

 })
})

// Same Node file as existing foreground metadata keys: do not add a new
// parallel file worker competing for a native foreground owner.
test("#476 actual native New Send stream Stop and reopen use the canonical conversation path",{skip:!["darwin","win32"].includes(process.platform),timeout:20000},async t=>{
 return withSurface650(t, async (t, surfaceLease) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"native-dialog-476-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const {initDataDir,saveConfig}=await import("../src/config"),{SkillEngine}=await import("../src/skills/skill-engine"),{HistoryStore}=await import("../src/history/store"),{createNativeDialogRuntime}=await import("../src/desktop/dialog-runtime"),providers=await import("../src/llm/provider"),{runL2ToolAdmission}=await import("../src/tool/l2-admission"),{SecurityConfirmationManager}=await import("../src/security-confirmation")
  await initDataDir();saveConfig({llm:{base_url:"http://127.0.0.1:1",api_key:"owned-native-fixture-only",model_name:"owned-controlled",temperature:0,context_window:8000}}as any)
  const threads=new ThreadManager();threads.create("native-dialog-other","native-dialog-other");const skills=new SkillEngine();skills.bindThreadManager(threads);const history=new HistoryStore();await history.waitReady()
  let providerCalls=0,denied=0,toolEffects=0,aborted=false,userCommits=0,target:string|undefined,execution:Promise<void>|undefined
  t.mock.method(providers,"createProvider",()=>({complete:async()=>({content:"native dialog title"}),async *streamChat(p:any){providerCalls++;if(providerCalls===1){yield{type:"tool_call_delta",index:0,id:"owned-native-call",name:"evaluate",arguments:JSON.stringify({code:"document.title",tabId:1})};yield{type:"done",finish_reason:"tool_calls"};return}yield{type:"token",text:"native stream"};await new Promise<void>(resolve=>{if(p.signal.aborted){resolve();return}p.signal.addEventListener("abort",()=>resolve(),{once:true})});aborted=p.signal.aborted;throw Object.assign(Error("owned stopped"),{name:"AbortError"})}}))
  const registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-native-dialog-476"),required=["D476_DIALOG_CREATED","D476_DIALOG_USER","D476_DIALOG_STREAMED","D476_DIALOG_L2_DENIED","D476_DIALOG_STOPPED","D476_DIALOG_REOPEN"],receipts=new Set<string>()
  let child:DesktopNativeChild|undefined,settled=false,authenticated=false,windowRequested=false,connections=0,failed=false,dropped=false,exitResolve!:(n:number)=>void,failResolve!:()=>void
  const exit=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r)
  const confirmations=new SecurityConfirmationManager()
  const channel=createDesktopChannel({registry,services:{threads,skills,mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,dialogRuntime:owner=>{const runtime=createNativeDialogRuntime({...owner,threads,skills,history,createExecutor:run=>async(id,name,params,signal)=>{
      assert.equal(name,"evaluate");assert.equal(params.code,"document.title");const gate=await runL2ToolAdmission({nativeConfirmationUnavailable:async()=>{denied++;run.unavailable();const aborted=new AbortController();aborted.abort();const d=await confirmations.request(()=>{throw Error("UNEXPECTED_NATIVE_CONFIRM_FANOUT")},{toolName:"owned unsupported",code:"",dangerousApis:[]},{originWs:owner.ws,signal:aborted.signal});assert.equal(d.approved,false)},signal,toolName:name,finalParams:params,toolCallId:id,startedAt:Date.now(),ws:owner.ws,sessionId:"owned-native-dialog",actingThreadId:target,isOutboundMcpCall:false,logToolFinish:()=>{},securityConfirmations:confirmations,getThreadManager:()=>threads,getCachedTabUrl:()=>undefined,getDomainFromUrl:()=>"",computerRateLimiter:async()=>{throw Error("UNEXPECTED_NATIVE_RATE_LIMIT")},activeTrayConfirmsByWs:new WeakMap(),clients:new Set(),wsAuthGet:()=>({authenticated:run.current(),surface:"desktop"})});if(!gate.ok)return gate.result;toolEffects++;throw Error("UNEXPECTED_NATIVE_FIXTURE_TOOL")
    }});return{start(input){execution=runtime.start(input);return execution}}},onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,"workspace")}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
  attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  channel.wss.on("connection",ws=>{connections++;const original=ws.send.bind(ws);ws.send=((data:any,...args:any[])=>{let f:any;try{f=JSON.parse(String(data))}catch{return Reflect.apply(original,ws,[data,...args])}if(f.type==="desktop.thread.create.result"&&f.ok===true){target=f.thread_id;prepareDialogL2Fixture(threads,target!)}if(f.type==="desktop.chat.event"&&f.kind==="user"){userCommits++;if(userCommits===3){dropped=true;ws.terminate();return}}return Reflect.apply(original,ws,[data,...args])})as typeof ws.send
    ws.on("message",raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(!authenticated||f.type!=="system.ping")return;if(f.id==="D476_FAIL_DIALOG_PHASE"||receipts.has(f.id)){failed=true;failResolve();return}if(required.includes(f.id))receipts.add(f.id)})
  })
  server.listen(0,"127.0.0.1");await once(server,"listening")
  try{
    const native=path.resolve(__dirname,"../../dist/desktop-native"),binary=path.join(native,"acceptance/dialog",process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop")
    assert.ok(fs.existsSync(binary),"actual dialog acceptance binary must be built")
    surfaceLease.checkpoint();
    child=(require(path.join(native,"desktop-launcher.node"))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,n=>{settled=true;exitResolve(n)})
    assert.equal(await Promise.race([exit,failure.then(()=>{throw Error("OWNED_DIALOG_NATIVE_PHASE_FAILED")}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("OWNED_DIALOG_NATIVE_DEADLINE")),{once:true}))]),76,"only real bound native offline terminal receipt is success")
    assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.equal(dropped,true);assert.equal(userCommits,3);assert.equal(providerCalls,2,"lost user ACK must revoke ownership before another provider request");assert.equal(denied,1);assert.equal(toolEffects,0);assert.equal(confirmations.pendingCount(),0);assert.equal(aborted,true)
    assert.deepEqual([...receipts].sort(),[...required].sort());assert.ok(target);const stored=new ThreadManager().readDesktopDialog(target!);assert.equal(stored.messages.filter(m=>m.role==="user"&&m.content==="native dialog owned message").length,1);assert.equal(stored.messages.filter(m=>m.role==="user"&&m.content==="native stream owned message").length,1);assert.equal(stored.messages.filter(m=>m.role==="user"&&m.content==="offline owned draft").length,1);assert.deepEqual(new ThreadManager().getMessages("native-dialog-other"),[])
    process.stdout.write('DESKTOP_DIALOG_476 {"native":true,"created":true,"controlledProvider":true,"streamed":true,"stopped":true,"persisted":true,"reopened":true,"nativeKeys":7,"unsupportedL2Denied":true,"lostUserAck":true,"offline":true}\n')
  }finally{
    surfaceLease.retain()
    try{t.diagnostic("D476_DIALOG_NATIVE_PHASE "+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),connections,authenticated,windowRequested,providerCalls,userCommits,denied,toolEffects,aborted,dropped,childExited:settled}))}catch{}
    child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(execution)await execution.catch(()=>{});history.close();if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})
  ;surfaceLease.settled()}

 })
})

// Same native file/surface lease as the existing foreground scenarios, never a
// new parallel worker. The resource binary is an unshipped source-inverse variant.
test('#476 actual native resource imports, reopens, edits, denies/removes and preserves unknown lost ACK',{skip:!['darwin','win32'].includes(process.platform),timeout:45000},async t=>{
 return withSurface650(t,async(t,surfaceLease)=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-resource-476-'))),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const {SkillEngine}=await import('../src/skills/skill-engine'),{SecurityConfirmationManager}=await import('../src/security-confirmation')
  fs.mkdirSync(path.join(dir,'skills'),{recursive:true});fs.mkdirSync(path.join(dir,'knowledge/global'),{recursive:true})
  const skills=new SkillEngine(),threads=new ThreadManager(),manager=new SecurityConfirmationManager(),registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-native-resource-476')
  const required=['D476_RES_SKILL_IMPORTED','D476_RES_KNOWLEDGE_IMPORTED','D476_RES_REOPENED','D476_RES_UPDATED','D476_RES_DENIED','D476_RES_REMOVED','D476_RES_BEFORE_LOST_ACK','D476_RES_ESCAPE_OK'],receipts=new Set<string>(),windows=new Set<number>()
  let authenticated=false,windowRequested=false,connections=0,failed=false,updates=0,dropped=false,child:DesktopNativeChild|undefined,settled=false,exitResolve!:(n:number)=>void,failResolve!:()=>void
  const exit=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r)
  const channel=createDesktopChannel({registry,securityConfirmations:manager,services:{threads,skills,mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,'workspace')}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
  attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  channel.wss.on('connection',ws=>{
   connections++;const original=ws.send.bind(ws);ws.send=((data:any,...args:any[])=>{let f:any;try{f=JSON.parse(String(data))}catch{return Reflect.apply(original,ws,[data,...args])}
    if(f.type==='desktop.resource.update.result'&&f.ok===true&&f.outcome==='committed'&&++updates===2){dropped=true;ws.terminate();return}
    return Reflect.apply(original,ws,[data,...args])
   })as typeof ws.send
   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(!authenticated||f.type!=='system.ping'||typeof f.id!=='string')return
    if(f.id==='D476_RES_FAIL'){failed=true;failResolve();return}
    if(required.includes(f.id)){if(receipts.has(f.id)){failed=true;failResolve()}receipts.add(f.id)}
    const m=/^D476_RES_WINDOW_([1-6])$/.exec(f.id);if(m){const n=Number(m[1]);if(windows.has(n)){failed=true;failResolve()}windows.add(n)}
   })
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
   const native=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(native,'acceptance/resource',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop')
   assert.ok(fs.existsSync(binary),'the resource controller acceptance binary must actually be built');surfaceLease.checkpoint()
   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,n=>{settled=true;exitResolve(n)})
   assert.equal(await Promise.race([exit,failure.then(()=>{throw Error('OWNED_RESOURCE_NATIVE_PHASE_FAILED')}),new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_RESOURCE_NATIVE_DEADLINE')),{once:true}))]),76,'only the owned native offline terminal observer is success')
   assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.equal(updates,2);assert.equal(dropped,true);assert.equal(manager.pendingCount(),0)
   assert.deepEqual([...receipts].sort(),[...required].sort());assert.deepEqual([...windows].sort(),[1,2,3,4,5,6])
   const disk=new SkillEngine();assert.equal(disk.get('native-resource-skill'),undefined);const doc=disk.getKnowledge('native-resource-note')!;assert.equal(doc.title,'已编辑 原生知识');assert.equal(doc.body,'\n未确认的原生知识正文')
   process.stdout.write('DESKTOP_RESOURCE_476 {"native":true,"kinds":2,"imports":2,"reopened":true,"edits":2,"deniedRemove":true,"removedOnlyTarget":true,"controllerWindows":6,"nativeKeys":1,"lostAck":true,"offlineDraftUnknown":true}\n')
  }finally{
   surfaceLease.retain();try{t.diagnostic('D476_RESOURCE_NATIVE_PHASE '+JSON.stringify({schema:1,failed,authenticated,windowRequested,connections,updates,dropped,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),windows:windows.size,childExited:settled}))}catch{}
   manager.rejectAll('disconnect');child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});surfaceLease.settled()
  }
 })
})

// Archive shares this existing foreground file and lifecycle lease. No new
// worker/job/permission or extended deadline; Linux registration stays skipped.
test("#476 actual native permanent archive history restore and lost ACK use the canonical index",{skip:!["darwin","win32"].includes(process.platform),timeout:20000},async t=>{
 return withSurface650(t,async(t,surfaceLease)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"native-archive-476-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const threads=new ThreadManager();threads.create("归档对话","native-archive-A");threads.create("另一对话","native-archive-B");threads.addMessage("native-archive-A",{thread_id:"native-archive-A",role:"user",content:"owned archive history"})
  const attachment=path.join(dir,"threads/native-archive-A.files/owned.txt"),attachmentBytes=Buffer.from("owned archive attachment");fs.mkdirSync(path.dirname(attachment));fs.writeFileSync(attachment,attachmentBytes)
  const originalMessages=JSON.stringify(threads.getMessages("native-archive-A")),originalSibling=JSON.stringify(threads.get("native-archive-B")),registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-native-archive-476")
  const required=["D476_ARCHIVE_ARCHIVED","D476_ARCHIVE_VIEW","D476_ARCHIVE_HISTORY","D476_ARCHIVE_RESTORED","D476_ARCHIVE_BUSY","D476_ARCHIVE_BEFORE_LOST_ACK"],receipts=new Set<string>()
  let child:DesktopNativeChild|undefined,childExited=false,authenticated=false,windowRequested=false,connections=0,failed=false,blocked=false,droppedAck=false,sets=0,archived=false,restored=false,exitResolve!:(n:number)=>void,failResolve!:()=>void,primary:unknown
  const exit=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r)
  const channel=createDesktopChannel({registry,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,archiveActivity:()=>blocked?"busy":"idle",onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,"workspace")}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
  attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  channel.wss.on("connection",ws=>{connections++;const originalSend=ws.send.bind(ws);ws.send=((data:any,...args:any[])=>{
    let f:any;try{f=JSON.parse(String(data))}catch{return Reflect.apply(originalSend,ws,[data,...args])}
    if(f.type==="desktop.archive.set.result"&&f.thread_id==="native-archive-A"&&f.ok===true&&f.saved===true){sets++;const saved=new ThreadManager().get("native-archive-A")!;if(sets===1)archived=!!saved.archived_at&&f.archived===true;if(sets===2)restored=saved.archived_at===null&&f.archived===false;if(sets===3){droppedAck=true;ws.terminate();return}}
    return Reflect.apply(originalSend,ws,[data,...args])
   })as typeof ws.send
   ws.on("message",raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(!authenticated||f.type!=="system.ping")return;if(f.id==="D476_ARCHIVE_BLOCK"){blocked=true;return}if(f.id==="D476_ARCHIVE_UNBLOCK"){blocked=false;return}if(f.id==="D476_FAIL_ARCHIVE_PHASE"||f.id==="D476_FAIL_SCRIPT"){failed=true;failResolve();return}if(required.includes(f.id)){if(receipts.has(f.id)){failed=true;failResolve()}receipts.add(f.id)}})
  })
  server.listen(0,"127.0.0.1");await once(server,"listening")
  try{
   const native=path.resolve(__dirname,"../../dist/desktop-native"),binary=path.join(native,"acceptance/archive",process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop")
   assert.ok(fs.existsSync(binary),"actual archive acceptance host must be built")
   surfaceLease.checkpoint();child=(require(path.join(native,"desktop-launcher.node"))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,code=>{childExited=true;exitResolve(code)})
   assert.equal(await Promise.race([exit,failure.then(()=>{throw Error("OWNED_ARCHIVE_NATIVE_PHASE_FAILED")}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("OWNED_ARCHIVE_NATIVE_DEADLINE")),{once:true}))]),76,"only bound real native offline observation can report success")
   assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.equal(sets,3);assert.equal(archived,true);assert.equal(restored,true);assert.equal(droppedAck,true);assert.deepEqual([...receipts].sort(),[...required].sort())
   const disk=new ThreadManager();assert.ok(disk.get("native-archive-A")!.archived_at);assert.equal(JSON.stringify(disk.getMessages("native-archive-A")),originalMessages);assert.equal(JSON.stringify(disk.get("native-archive-B")),originalSibling);assert.deepEqual(fs.readFileSync(attachment),attachmentBytes)
   process.stdout.write('DESKTOP_ARCHIVE_476 {"native":true,"archived":true,"restored":true,"historyUnchanged":true,"otherThreadUnchanged":true,"nativeKeys":10,"busyRefused":true,"lostAck":true,"offlineUnconfirmed":true}\n')
  }catch(error){primary=error;throw error}finally{
   surfaceLease.retain()
   try{t.diagnostic("D476_ARCHIVE_NATIVE_PHASE "+JSON.stringify({schema:1,failed,receiptMask:required.reduce((mask,id,i)=>mask|(receipts.has(id)?1<<i:0),0),sets,archived,restored,droppedAck,connections,authenticated,windowRequested,childExited}))}catch{}
   try{child?.terminate();if(child&&!childExited)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});surfaceLease.settled()}
   catch(error){if(primary===undefined)throw error;try{t.diagnostic("D476_ARCHIVE_CLEANUP_FAILED")}catch{}}
  }
 })
})

/** Closed passive 747 projection. Own-data getters are never evaluated; Proxy traps are not promised safe. */
function createTerminalFirstFailure747(){
 let first:{origin:'W'|'R';site:number}|null=null,sealed=false
 const own=(value:unknown,key:string)=>{if(!value||typeof value!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined}
 return{
  observe(value:unknown){try{
   if(sealed||first||!value||typeof value!=='object'||Object.getOwnPropertyNames(value).sort().join()!=='id,type'||Object.getOwnPropertySymbols(value).length)return
   if(own(value,'type')!=='system.ping')return;const id=own(value,'id');if(typeof id!=='string'||id.length>32)return
   const m=/^D476_TERMINAL_FIRST_([WR])_([1-9]|1[0-9]|2[0-8])$/.exec(id);if(!m)return
   const site=Number(m[2]);if(m[1]==='R'&&site>19)return
   first={origin:m[1] as 'W'|'R',site}
  }catch{/* Observation failure cannot replace original primary/cleanup. */}},
  seal(){sealed=true},
  snapshot(){return{schema:1,source:'ffe3514318883fc863bf2347093f328354ee841b',first:first?{...first}:null}}
 }
}

/** New terminal-only leaf: same serialized foreground file, never a new worker. */
function hostedTerminalAdmission705() {
 assert.ok(process.platform==='darwin'||process.platform==='win32','TERMINAL705_SUPPORTED_HOST_REQUIRED')
 assert.equal(process.env.GITHUB_ACTIONS,'true','TERMINAL705_REMOTE_GHA_REQUIRED')
 assert.equal(process.env.RUNNER_OS,process.platform==='win32'?'Windows':'macOS','TERMINAL705_RUNNER_REQUIRED')
 const run=process.env.CMSPARK_TEST_RUN_DIR,data=process.env.CMSPARK_DATA_DIR
 assert.ok(run&&data&&path.isAbsolute(run)&&path.isAbsolute(data),'TERMINAL705_CANONICAL_PRELOAD_REQUIRED')
 const physical=fs.realpathSync(run),owned=fs.realpathSync(data),relation=path.relative(physical,owned)
 assert.ok(relation&&relation!=='..'&&!relation.startsWith('..'+path.sep)&&!path.isAbsolute(relation),'TERMINAL705_OWNED_DATA_REQUIRED')
 for(const file of [run,data]){const st=fs.lstatSync(file);assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'TERMINAL705_OWNED_DIRECTORY_REQUIRED')}
 const keep=new Set(['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','TZ','SHELL','GITHUB_ACTIONS','RUNNER_OS','CMSPARK_TEST_RUN_DIR','CMSPARK_DATA_DIR','RUNNER_TRACKING_ID'])
 const admitted=process.platform==='win32'?new Set([...keep].map(k=>k.toUpperCase())):keep
 // Inspect key names only; never copy/read/hash/log removed credential values.
 for(const key of Object.keys(process.env))if(!admitted.has(process.platform==='win32'?key.toUpperCase():key))delete process.env[key]
 process.env.CMSPARK_SKIP_LOGIN_ENV='1'
 return owned
}

test('#476 terminal-only native confirmation→real user PTY→selected partial excerpt→canonical reopen',{skip:!['darwin','win32'].includes(process.platform),timeout:45000,concurrency:false},async t=>{
 const owned=hostedTerminalAdmission705()
 return withSurface650(t,async(t,surfaceLease)=>{
  const previous=process.env.CMSPARK_DATA_DIR,dir=fs.realpathSync(fs.mkdtempSync(path.join(owned,'native-terminal705-')));process.env.CMSPARK_DATA_DIR=dir
  const {initDataDir,saveConfig}=await import('../src/config'),{createNativeTerminalRuntime}=await import('../src/desktop/terminal-runtime'),{SecurityConfirmationManager}=await import('../src/security-confirmation'),{loadNodePty}=await import('../src/pty/load-native'),pty=await import('../src/pty/session'),{WebSocket}=await import('ws'),{createHmac}=await import('node:crypto')
  await initDataDir();saveConfig({modules:{'devsec-workspace':{available:true,enabled:true}},embedded_terminal:{enabled:true}} as any)
  assert.equal(pty.isPtyBusy(),false,'TERMINAL705_NO_FOREIGN_LIVE_SLOT')
  const threads=new ThreadManager();threads.create('Native terminal A','native-terminal-A');threads.create('Unchanged sibling','native-terminal-B');threads.update('native-terminal-A',{workspace_root:dir})
  const registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-native-terminal705'),confirmations=new SecurityConfirmationManager(),runtime=createNativeTerminalRuntime(()=> 'idle')
  const outputDecoder=new TextDecoder(),inputDecoder=new TextDecoder();let outputSuffix='',inputSuffix='';const actualHandles:Array<{kill():void;exited:boolean}>=[];let completionFailure:unknown
  const firstFailure=createTerminalFirstFailure747()
  const required=['DENIED','CANCELLED','OUTPUT','RESIZED','STOPPED','SAVED','REOPENED','DONE'].map(n=>'D476_TERMINAL_'+n),receipts=new Set<string>(),outputSeq=new Set<number>(),ackSeq=new Set<number>(),dimensions=new Set<string>(),childExits:Promise<void>[]=[]
  let child:DesktopNativeChild|undefined,childExited=false,authenticated=false,windowRequested=false,failed=false,connections=0,primary:any,completion:Promise<void>|undefined,foreign:InstanceType<typeof WebSocket>|undefined,foreignCheck:Promise<void>|undefined,actualSpawns=0,openAttempts=0,confirmationRequests=0,decisions=0,deniedResults=0,outputBytes=0,largestFrame=0,lastOutput=0,inputUnicode=false,outputUnicode=false,stops=0,ownedPid=0,actualProcessExit=false,exitResolve!:(n:number)=>void,failResolve!:()=>void,primaryFailure:unknown
  const exited=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r),deadline=new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>{firstFailure.seal();reject(Error('OWNED_TERMINAL705_NATIVE_DEADLINE'))},{once:true})),fail=()=>{firstFailure.seal();failed=true;failResolve()}
  // Delegate every spawn to the actual required @lydell loader. This is observation,
  // not testSetPtySpawn/MockPty/platform spoof or a replacement native handle.
  const nativePty=loadNodePty(),realSpawn=nativePty.spawn.bind(nativePty)
  t.mock.method(nativePty,'spawn',(...parameters:Parameters<typeof realSpawn>)=>{const [file,args,opts]=parameters
   assert.equal(file,runtime.shell().file);assert.deepEqual(args,[...runtime.shell().args]);assert.equal(fs.realpathSync(opts.cwd),dir)
   const handle=realSpawn(file,args,opts);actualSpawns++;ownedPid=handle.pid;const ownedHandle={kill:()=>handle.kill(),exited:false};actualHandles.push(ownedHandle)
   childExits.push(new Promise<void>(resolve=>handle.onExit(()=>{ownedHandle.exited=true;actualProcessExit=true;resolve()})));assert.ok(Number.isSafeInteger(ownedPid)&&ownedPid>0);return handle
  })
  const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realAck=runtime.ack,realClose=runtime.close
  runtime.openTerminal=input=>{openAttempts++;assert.equal(input.owner,primary);assert.equal(confirmations.pendingCount(),0);const result=realOpen(input);if(result.ok){assert.ok(pty.getOwnedPtyContext(input.id,primary));assert.equal(pty.getOwnedPtyContext(input.id,null),null);assert.equal(pty.getOwnedPtyContext(input.id,{}),null);assert.equal(pty.readPtyTail(input.id,primary,'native-terminal-A').success,false,'shell consent is not private model-tail consent')}return result}
  runtime.input=(id,b64)=>{const bytes=Buffer.from(b64,'base64');assert.ok(bytes.length<=16384);inputSuffix=(inputSuffix+inputDecoder.decode(bytes,{stream:true})).slice(-256);assert.equal(inputSuffix.includes('D476_TERMINAL_中'),false,'complete output marker must not come from input echo');if(inputSuffix.includes('中'))inputUnicode=true;return realInput(id,b64)}
  runtime.resize=(id,c,r)=>{const value=realResize(id,c,r);if(value.ok)dimensions.add(c+'x'+r);return value}
  runtime.ack=(id,seq)=>{const value=realAck(id,seq);if(value.ok)ackSeq.add(seq);return value}
  runtime.close=id=>{stops++;return realClose(id)}
  const channel=createDesktopChannel({registry,securityConfirmations:confirmations,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10485760,terminalRuntime:runtime,onAuthenticated:host=>{if(host==='owned-native-terminal705'){authenticated=true;windowRequested=channel.window(host,'workspace')}}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer();attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  const foreignOwner=async(operation:string)=>{
   const cap=registry.issue('owned-terminal705-foreign'),port=(server.address()as any).port
   foreign=new WebSocket(`ws://127.0.0.1:${port}/desktop`,{origin:DESKTOP_NATIVE_ORIGIN});foreign.on('error',error=>{completionFailure=error;fail()})
   const frames:any[]=[],wake=new Set<()=>void>();foreign.on('message',raw=>{frames.push(JSON.parse(String(raw)));for(const fn of [...wake])fn()})
   const next=async()=>{while(frames.length===0)await Promise.race([new Promise<void>(resolve=>{const f=()=>{wake.delete(f);resolve()};wake.add(f)}),deadline]);return frames.shift()}
   assert.equal((await next()).type,'desktop.challenge.request');foreign.send(JSON.stringify({type:'desktop.hello',capability_id:cap.capabilityId,protocol_version:1}));const challenge=await next();assert.equal(challenge.type,'desktop.challenge')
   foreign.send(JSON.stringify({type:'desktop.authenticate',capability_id:cap.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(cap.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',cap.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')}));assert.equal((await next()).type,'desktop.ready')
   for(const thread of ['native-terminal-A','native-terminal-B']){foreign.send(JSON.stringify({type:'desktop.terminal.close',id:'foreign-'+thread,thread_id:thread,operation_id:operation}));const result=await next();assert.equal(result.ok,false);assert.equal(result.error_code,'LOCAL_NOT_OWNED')}
   foreign.close();await once(foreign,'close')
  }
  channel.wss.on('connection',ws=>{
   connections++;if(!primary)primary=ws;const original=ws.send.bind(ws)
   ws.send=((data:any,...args:any[])=>{let f:any;try{f=JSON.parse(String(data))}catch{return Reflect.apply(original,ws,[data,...args])}
    if(ws===primary){
     if(f.type==='desktop.confirmation.request'&&f.purpose==='local-work'){confirmationRequests++;assert.ok(confirmationRequests<=4);assert.equal(JSON.parse(f.action_json).kind,confirmationRequests<=3?'terminal-open':'terminal-return')}
     if(f.type==='desktop.terminal.open.result'){
      if(f.ok===false&&f.error_code==='LOCAL_DENIED'){deniedResults++;assert.equal(actualSpawns,0);assert.equal(openAttempts,0)}
      if(f.ok===true){assert.equal(deniedResults,2);foreignCheck=foreignOwner(f.operation_id);foreignCheck.catch(error=>{completionFailure=error;fail()})}
     }
     if(f.type==='desktop.terminal.data'){const bytes=Buffer.from(f.b64,'base64');assert.ok(bytes.length<=16384);assert.equal(f.seq,lastOutput+1);lastOutput=f.seq;outputSeq.add(f.seq);outputBytes+=bytes.length;largestFrame=Math.max(largestFrame,bytes.length);outputSuffix=(outputSuffix+outputDecoder.decode(bytes,{stream:true})).slice(-128);if(outputSuffix.includes('D476_TERMINAL_中'))outputUnicode=true}
    }
    return Reflect.apply(original,ws,[data,...args])
   })as typeof ws.send
   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(ws!==primary||!authenticated)return
    if(f.type==='desktop.confirmation.decision'&&f.purpose==='local-work')decisions++
    if(f.type!=='system.ping'||typeof f.id!=='string')return
    firstFailure.observe(f)
    if(f.id==='D476_TERMINAL_FAIL'){fail();return}
    if(!required.includes(f.id))return;if(receipts.has(f.id)){fail();return}receipts.add(f.id)
    if(f.id==='D476_TERMINAL_DONE'){
     completion=(async()=>{
      await Promise.race([Promise.all([...childExits,...(foreignCheck?[foreignCheck]:[])]),deadline]);assert.equal(actualProcessExit,true);assert.equal(pty.isPtyBusy(),false);assert.equal(pty.getLivePtyId(),null)
      assert.equal(actualSpawns,1);assert.equal(openAttempts,1);assert.equal(confirmationRequests,4);assert.equal(decisions,4);assert.equal(deniedResults,2);assert.equal(inputUnicode,true);assert.equal(outputUnicode,true);assert.ok(outputBytes>16384);assert.ok(largestFrame<=16384);assert.ok(outputSeq.size>0);assert.deepEqual([...ackSeq].sort((a,b)=>a-b),[...outputSeq].sort((a,b)=>a-b));assert.ok(dimensions.size>=2);assert.equal(stops,1);assert.equal(receipts.size,required.length)
      const disk=new ThreadManager().readDesktopDialog('native-terminal-A');assert.equal(disk.messages.length,1);assert.ok(disk.messages[0].content.includes('D476_TERMINAL_中'));assert.ok(disk.messages[0].content.includes('partial'));assert.equal(new ThreadManager().readDesktopDialog('native-terminal-B').messages.length,0);assert.equal(confirmations.pendingCount(),0)
      ws.send(JSON.stringify({type:'D476.terminal.complete',result:'COMPLETE'}))
     })();completion.catch(error=>{completionFailure=error;fail()})
    }
   })
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
   const native=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(native,'acceptance/terminal',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual terminal-only acceptance host must be built');surfaceLease.checkpoint()
   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,code=>{firstFailure.seal();childExited=true;exitResolve(code)})
   assert.equal(await Promise.race([exited,failure.then(()=>{throw completionFailure??Error('OWNED_TERMINAL705_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,2);assert.deepEqual([...receipts].sort(),[...required].sort())
   process.stdout.write('DESKTOP_TERMINAL_705 {"native":true,"realPty":true,"syntheticNativeApproval":true,"humanApproval":false,"deniedAndCancelledZeroLaunch":true,"unicode":true,"over16KiBOutput":true,"seqAck":true,"resized":true,"stoppedActualExit":true,"selectedPartialReturn":true,"diskReopened":true,"foreignAndNullRefused":true}\n')
  }catch(error){primaryFailure=error;throw error}finally{
   firstFailure.seal();surfaceLease.retain();try{t.diagnostic('D476_TERMINAL_NATIVE_PHASE '+JSON.stringify({schema:1,firstFailure:firstFailure.snapshot(),failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),actualSpawns,openAttempts,confirmationRequests,decisions,deniedResults,outputBytes,largestFrame,outputFrames:outputSeq.size,acks:ackSeq.size,dimensions:dimensions.size,inputUnicode,outputUnicode,stops,actualProcessExit,authenticated,windowRequested,connections,childExited}))}catch{}
   let cleanupError:unknown;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}
   await clean(async()=>{child?.terminate();if(child&&!childExited)await exited});await clean(()=>{foreign?.terminate();for(const ws of channel.wss.clients)ws.terminate();confirmations.rejectAll('disconnect')})
   await clean(()=>{for(const handle of actualHandles)if(!handle.exited)handle.kill()});await clean(async()=>{await Promise.race([Promise.all(childExits),deadline]);assert.equal(pty.isPtyBusy(),false)});await clean(()=>Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]));await clean(()=>new Promise<void>(r=>server.close(()=>r())))
   if(previous===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=previous
   if(!child||childExited){if(!pty.isPtyBusy()&&actualHandles.every(handle=>handle.exited)){await clean(()=>fs.rmSync(dir,{recursive:true,force:true}));surfaceLease.settled()}else cleanupError??=Error('OWNED_TERMINAL705_PTY_REAP_UNCONFIRMED')}
   if(primaryFailure===undefined&&cleanupError!==undefined)throw cleanupError
  }
 })
})
