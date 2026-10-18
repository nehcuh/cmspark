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
