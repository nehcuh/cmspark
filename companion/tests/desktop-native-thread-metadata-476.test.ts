import { createConfirmationObservation772 } from "./fixtures/native-confirmation-observer-772"
import { createTerminalObserver747, rawMarker747 } from "./helpers/terminal-observer-747"
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

// Test-only actual directory identity: an OS path spelling is not a second root.
function captureWorkspaceSelection705(root:string) {
 const canonical=fs.realpathSync(root),parent=fs.realpathSync(path.dirname(canonical)),a=fs.lstatSync(canonical,{bigint:true}),b=fs.lstatSync(parent,{bigint:true})
 if(!a.isDirectory()||a.isSymbolicLink()||!b.isDirectory()||b.isSymbolicLink()||a.ino<=0n||b.ino<=0n)throw Error('OWNED_WORKSPACE_IDENTITY_INVALID')
 return Object.freeze({root:canonical,parent,dev:a.dev,ino:a.ino,parentDev:b.dev,parentIno:b.ino})
}
function sameWorkspaceSelection705(expected:ReturnType<typeof captureWorkspaceSelection705>,value:unknown):boolean {
 try{
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))return false
  const now=captureWorkspaceSelection705(expected.root)
  if(now.root!==expected.root||now.parent!==expected.parent||now.dev!==expected.dev||now.ino!==expected.ino||now.parentDev!==expected.parentDev||now.parentIno!==expected.parentIno)return false
  const selected=fs.lstatSync(fs.realpathSync(value),{bigint:true})
  return selected.isDirectory()&&!selected.isSymbolicLink()&&selected.dev===expected.dev&&selected.ino===expected.ino
 }catch{return false}
}

// One sequential surface owner, actual retained native OS panel + original controller purpose.
test('#476 actual native workspace picker binds canonical root, reopens lists/reads and cancels the second OS picker',{skip:!['darwin','win32'].includes(process.platform),timeout:45000},async t=>{
 const uiDeadline=Date.now()+45000
 return withSurface650(t,async(t,surfaceLease)=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-workspace-476-'))),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const requestedRoot=path.join(dir,'selected');fs.mkdirSync(requestedRoot);const root=fs.realpathSync(requestedRoot),expectedSelection=captureWorkspaceSelection705(root);fs.writeFileSync(path.join(root,'hello.txt'),'owned workspace text')
  const {SecurityConfirmationManager}=await import('../src/security-confirmation'),{parseNativeWorkspaceDiagnostic705,parseNativeWorkspaceCancel705}=await import('./helpers/desktop-workspace-picker-476')
  const threads=new ThreadManager();threads.create('owned workspace','native-workspace-A');threads.create('untouched sibling','native-workspace-B')
  const manager=new SecurityConfirmationManager(),registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-native-workspace-476')
  const pickerRequests=new Map<string,{request:string;thread:string;revision:string;number:number}>(),completedPickers=new Set<string>()
  const required=['D476_WS_UNBOUND','D476_WS_PICKER_SELECTED','D476_WS_CONFIRMATION','D476_WS_COMMITTED','D476_WS_LISTED','D476_WS_READ','D476_WS_REOPENED','D476_WS_PICKER_CANCELLED','D476_WS_CANCELLED','D476_WS_DONE'],receipts=new Set<string>()
  let selectedOutcome:boolean|null=null,selectedIdentity:boolean|null=null,childExitCode:number|null=null,assertionSite=0,firstFailedAssertion=0
  let cancelClose:0|1|2=0,cancelShow:0|1|2|3=0,cancelSettled:boolean|null=null,cancelCurrent:boolean|null=null
  let failureSite=0,pickOutcome=0,nativeDiagnostic:ReturnType<typeof parseNativeWorkspaceDiagnostic705>=null,diagnosticInvalid=false
  let pickerLifecycle={mode:0 as number,childClosed:false,childExit:null as number|null,childSignal:0 as number,childError:false}
  let uiOwner:import('./helpers/workspace-xctest-owned-705').OwnedWorkspaceUI705|undefined,uiDone:Promise<{ok:boolean}>|undefined,primaryFailed=false
  let current:any,authenticated=false,windowRequested=false,connections=0,failed=false,picks=0,pickerObserved=0,pickerReturned=0,cancelReturned=0,child:DesktopNativeChild|undefined,settled=false,exitResolve!:(n:number)=>void,failResolve!:()=>void
  const exit=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r),fail=(site:number)=>{if(!failureSite)failureSite=site;failed=true;failResolve()}
  const channel=createDesktopChannel({registry,securityConfirmations:manager,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024,workspaceRuntime:{enabled:()=>true,activity:()=> 'idle'},onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,'workspace')}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
  attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
  channel.wss.on('connection',ws=>{current=ws;connections++;
   const native=ws as any,originalSend=native.send.bind(native);native.send=(body:any,...args:any[])=>{
    const result=originalSend(body,...args);let request:any;try{request=JSON.parse(String(body))}catch{return result}
    if(request.type==='desktop.workspace.picker.request'){
     const number=++picks;pickOutcome=1;if(number>2){fail(1);return result}
     pickerRequests.set(request.pick_id,{request:request.request_id,thread:request.thread_id,revision:request.revision,number})
     // Fixture-only instruction operates the actual typed object; it cannot fabricate GetResult/URLs.
     originalSend(JSON.stringify({type:'D476.workspace.picker',selection:root,pick_id:request.pick_id,cancel:number===2,...(uiOwner?{ui_nonce:uiOwner.scene.nonce}:{})}))
    }
    return result
   };
   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(!authenticated)return;
    if(f.type==='desktop.workspace.picker.result'){
     const request=pickerRequests.get(f.pick_id);if(!request||completedPickers.has(f.pick_id)||request.request!==f.request_id||request.thread!==f.thread_id||request.revision!==f.revision){fail(2);return}
     completedPickers.add(f.pick_id)
     if(request.number===1){selectedOutcome=f.outcome==='selected';selectedIdentity=selectedOutcome?sameWorkspaceSelection705(expectedSelection,f.path):null;if(!selectedOutcome||selectedIdentity!==true){pickOutcome=3;fail(5)}else{pickOutcome=2;pickerReturned++}}
     else if(f.outcome!=='cancelled'||Object.hasOwn(f,'path')){pickOutcome=5;fail(6)}else{pickOutcome=4;cancelReturned++}
     return
    }
    if(f.type!=='system.ping')return;
    if(f.id==='D476_WS_PICKER_SELECTED'||f.id==='D476_WS_PICKER_CANCELLED'){pickerObserved++;try{uiOwner?.ready(f.id==='D476_WS_PICKER_SELECTED'?1:2)}catch{fail(7)}}
if(typeof f.id==='string'&&f.id.startsWith('D476_WS_CANCEL_')){try{const d=parseNativeWorkspaceCancel705(f.id);if(process.platform!=='win32'||!d)diagnosticInvalid=true;else if('close'in d)cancelClose=d.close;else{cancelShow=d.show;cancelSettled=d.settled;cancelCurrent=d.current}}catch{diagnosticInvalid=true}return}
if(typeof f.id==='string'&&f.id.startsWith('D476_WS_DIAG_')){try{const d=parseNativeWorkspaceDiagnostic705(f.id);if(d&&d.platform===(process.platform==='win32'?1:2))nativeDiagnostic=d;else diagnosticInvalid=true}catch{diagnosticInvalid=true}return}if(f.id==='D476_WS_FAIL'){fail(7);return}if(required.includes(f.id)){if(receipts.has(f.id)){fail(8);return}receipts.add(f.id);if(f.id==='D476_WS_DONE')channel.revokeHost('owned-native-workspace-476')}})})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
   const native=path.resolve(__dirname,'../../dist/desktop-native');if(process.platform==='darwin'){const {OwnedWorkspaceUI705}=await import('./helpers/workspace-xctest-owned-705');uiOwner=new OwnedWorkspaceUI705(native,dir,uiDeadline,t.signal)};const binary=uiOwner?.appExecutable??path.join(native,'acceptance/workspace',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop')
   assertionSite=1;assert.ok(fs.existsSync(binary),'actual workspace acceptance binary must be built');surfaceLease.checkpoint()
   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,n=>{childExitCode=Number.isInteger(n)&&n>=-2147483648&&n<=4294967295?n:null;settled=true;exitResolve(n)})
   if(uiOwner){uiOwner.start();uiDone=uiOwner.complete().then(()=>({ok:true}),()=>{fail(9);return{ok:false}})}
   assertionSite=2;assert.equal(await Promise.race([exit,failure.then(()=>{throw Error('OWNED_WORKSPACE_NATIVE_PHASE_FAILED')}),new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_WORKSPACE_NATIVE_DEADLINE')),{once:true}))]),0)
   if(uiDone){assertionSite=3;assert.equal((await uiDone).ok,true,'owned acknowledged UI runner must genuinely close quiescent')}
   assertionSite=4;assert.equal(failed,false);assertionSite=5;assert.equal(authenticated,true);assertionSite=6;assert.equal(windowRequested,true);assertionSite=7;assert.equal(connections,1);assertionSite=8;assert.equal(picks,2);assertionSite=9;assert.equal(pickerObserved,2);assertionSite=10;assert.equal(pickerReturned,1);assertionSite=11;assert.equal(cancelReturned,1);assertionSite=12;assert.deepEqual([...receipts].sort(),[...required].sort());assertionSite=13;assert.equal(manager.pendingCount(),0)
   const disk=new ThreadManager();assertionSite=14;assert.equal(sameWorkspaceSelection705(expectedSelection,disk.get('native-workspace-A')!.workspace_root),true);assertionSite=15;assert.equal(disk.get('native-workspace-B')!.workspace_root,undefined)
   process.stdout.write('DESKTOP_WORKSPACE_476 {"native":true,"actualPicker":true,"controllerConfirmed":true,"persisted":true,"reopened":true,"listed":true,"read":true,"pickerCancelled":true,"otherThreadUnchanged":true}\n')
  }catch(error){primaryFailed=true;try{if(error&&typeof error==='object'&&'code'in error&&error.code==='ERR_ASSERTION')firstFailedAssertion=assertionSite}catch{};throw error}finally{
   surfaceLease.retain();let uiLifecycle:Record<string,boolean|number|null>|undefined;try{uiLifecycle=uiOwner?.diagnostic()}catch{};let uiReceiptMask:number|null=null;try{uiReceiptMask=uiOwner?.scene.receiptMask()??null}catch{};try{if(primaryFailed&&uiOwner){const observation=JSON.stringify(uiOwner.xcodeFailureObservation());if(Buffer.byteLength(observation,'utf8')<=1024)t.diagnostic('D705_XCODE_FAILURE '+observation)}}catch{};let uiRefusal:{stage:number;detail:number}|null=null;try{uiRefusal=uiOwner?.scene.uiRefusal()??null}catch{};let uiProgress:{stage:number;detail:number}|null=null;try{if(primaryFailed)uiProgress=uiOwner?.scene.uiProgress()??null}catch{};let uiChooseCensus:{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null;buttonCount:number|null;buttonsMore:boolean|null;buttonIdentityRows:Array<[number,number]>|null}|null=null;try{if(primaryFailed)uiChooseCensus=uiOwner?.scene.uiChooseCensus()??null}catch{};uiOwner?.cancel();try{if(primaryFailed&&uiOwner){const owner=uiOwner;owner.observeXcodeCloseOnce(()=>{try{const observation=JSON.stringify(owner.xcodeFailureObservation());if(Buffer.byteLength(observation,'utf8')<=1024)process.stdout.write('D705_XCODE_FAILURE_AFTER_CANCEL '+observation+'\n')}catch{};owner.observeClosedXcodeResultOnce(value=>{try{const finite=JSON.stringify(value);if(Buffer.byteLength(finite,'utf8')<=1024)process.stdout.write('D705_XCRESULT_DETAILS_CLOSED '+finite+'\n')}catch{}})})}}catch{};try{t.diagnostic('D476_WORKSPACE_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),picks,pickerObserved,pickerReturned,cancelReturned,connections,authenticated,windowRequested,childExited:settled,childExitCode,firstFailedAssertion,diagnosticVersion:2,failureSite,pickOutcome,pickerLifecycle,nativeDiagnostic,diagnosticInvalid,selectedOutcome,selectedIdentity,uiLifecycle,uiReceiptMask,...(uiOwner?{uiRefusal,uiProgress,uiChooseCensus}:{}),cancelClose,cancelShow,cancelSettled,cancelCurrent}))}catch{}
   child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();manager.rejectAll('disconnect');await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));let uiClosed=true;try{await uiOwner?.cleanup()}catch{uiClosed=false;try{t.diagnostic('D476_WORKSPACE_UI_LIFETIME_UNKNOWN')}catch{}};if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;if(uiClosed){fs.rmSync(dir,{recursive:true,force:true});surfaceLease.settled()}else if(!primaryFailed){throw Error('OWNED_WORKSPACE_UI_LIFETIME_UNKNOWN')}
  }
 })
})

test('#705 passive picker outcomes distinguish ambiguous failure without inspecting private data',async()=>{
 const {pickerOutcome705}=await import('./helpers/desktop-workspace-picker-476')
 const expected='/owned-inert/expected';let reads=0
 assert.equal(pickerOutcome705({path:expected},expected),2)
 assert.equal(pickerOutcome705({path:'/owned-inert/other'},expected),3)
 assert.equal(pickerOutcome705({error:'cancelled'},expected),4)
 assert.equal(pickerOutcome705({error:'OWNED_PRIVATE_MARKER'},expected),5)
 const accessor=Object.defineProperty({},'path',{get(){reads++;throw Error('MUST_NOT_READ')}})
 const proxy=new Proxy({}, {ownKeys(){reads++;throw Error('MUST_NOT_TRAP')},getPrototypeOf(){reads++;throw Error('MUST_NOT_TRAP')},get(){reads++;throw Error('MUST_NOT_TRAP')}})
 const revoked=Proxy.revocable({},{});revoked.revoke()
 for(const v of [undefined,null,{},[],{path:42},{path:expected,extra:true},{path:expected,error:'cancelled'},accessor,proxy,revoked.proxy,Object.create({path:expected})])assert.equal(pickerOutcome705(v,expected),6)
 assert.equal(reads,0)
})

test('#705 passive native frame parser is closed, bounded and represents unobserved fields honestly',async()=>{
 const {parseNativeWorkspaceDiagnostic705:parse}=await import('./helpers/desktop-workspace-picker-476')
 assert.deepEqual(parse('D476_WS_DIAG_W_1_0_X_X_0_0'),{platform:1,phaseMask:1,failureSite:0,localPanels:null,ownedPanels:null,flags:0,flagsKnown:0})
 assert.deepEqual(parse('D476_WS_DIAG_M_1023_10_2_1_15_15'),{platform:2,phaseMask:1023,failureSite:10,localPanels:2,ownedPanels:1,flags:15,flagsKnown:15})
 for(const v of [null,{},'','D476_WS_DIAG_W_128_0_0_0_0_0','D476_WS_DIAG_M_1024_0_0_0_0_0','D476_WS_DIAG_W_1_32_0_0_0_0','D476_WS_DIAG_W_1_17_0_0_0_0','D476_WS_DIAG_M_1_11_0_0_0_0','D476_WS_DIAG_W_1_0_3_0_0_0','D476_WS_DIAG_W_1_0_0_0_8_8','D476_WS_DIAG_W_1_0_0_0_1_0','D476_WS_DIAG_X_1_0_0_0_0_0','D476_WS_DIAG_W_01_0_0_0_0_0','D476_WS_DIAG_W_1_0_X_X_0_0\n','D476_WS_DIAG_W_1_0_X_X_0_0_OWNED_PRIVATE_MARKER','D476_WS_DIAG_W_1_0_X_X_0_0'.repeat(20)])assert.equal(parse(v),null)
})

test('#705 passive lifecycle observes cached real picker close and contains logger faults without env inspection',async t=>{
 const {ChildProcess}=await import('node:child_process'),{PassThrough}=await import('node:stream'),{observeWorkspacePicker476}=await import('./helpers/desktop-workspace-picker-476')
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{value:'darwin'});t.after(()=>Object.defineProperty(process,'platform',descriptor));t.mock.method(os,'platform',()=> 'darwin')
 let calls=0,envReads=0,invalid=0;const life:unknown[]=[]
 const inert=function(this:any,options:any){calls++;Object.defineProperty(options,'envPairs',{get(){envReads++;throw Error('MUST_NOT_READ_ENV')}});this.pid=5900+calls;this.stdin=new PassThrough();this.stdout=new PassThrough();this.stderr=new PassThrough();this.stdio=[this.stdin,this.stdout,this.stderr];process.nextTick(()=>{this.stdout.end('/owned-inert-selected/');this.stderr.end();this.emit('close',0,null)});return this}
 const installed=t.mock.method(ChildProcess.prototype as any,'spawn',inert as any)
 const r=await observeWorkspacePicker476(()=>{},()=>invalid++,undefined,v=>life.push(v))
 assert.equal(r.result.path,'/owned-inert-selected');assert.equal(r.observed,1);assert.deepEqual(life,[{mode:2,childClosed:false,childExit:null,childSignal:0,childError:false},{mode:2,childClosed:true,childExit:0,childSignal:0,childError:false}])
 const second=await observeWorkspacePicker476(()=>{},()=>invalid++,undefined,()=>{throw Error('OWNED_LOGGER_FAULT')})
 assert.equal(second.result.path,r.result.path);assert.equal(invalid,0);assert.equal(envReads,0);assert.equal(calls,2);assert.equal((ChildProcess.prototype as any).spawn,installed)
})

test('#705 passive fixture source retains selection-click order and finite native stages for LF and CRLF',()=>{
 const dir=path.resolve(__dirname,'../../tests/fixtures/desktop-476')
 const runnerSource=fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'),'utf8')
 for(const eol of ['\n','\r\n']){
  const cpp=fs.readFileSync(path.join(dir,'workspace-acceptance.cpp'),'utf8').replace(/\r?\n/g,eol)
  const swift=fs.readFileSync(path.join(dir,'workspace-acceptance.swift'),'utf8').replace(/\r?\n/g,eol)
  const panel=cpp.slice(cpp.indexOf('void D476Acceptance::panel('),cpp.indexOf('void D476Acceptance::renderer('))
  assert.ok(panel.indexOf('L"D476_WS_PICKER_SELECTED"')<panel.indexOf('note(h,16,'));assert.ok(panel.indexOf('note(h,16,')<panel.indexOf('SendMessageW(button,BM_CLICK,0,0)'));assert.ok(panel.indexOf('SendMessageW(button,BM_CLICK,0,0)')<panel.indexOf('note(h,32,'))
  assert.match(cpp,/diagnosticSends>=16&&!first/);assert.match(cpp,/catch\(\.\.\.\)\{\}/)
  const start=swift.indexOf(' static func panel(_ h:NativeDesktop){'),end=swift.indexOf(' static func renderer(');assert.ok(start>=0&&end>start);const passive=swift.slice(start,end),runner=runnerSource.replace(/\r?\n/g,eol)
  for(const marker of ['owner === h','h.generation==documentGeneration','h.pickerCurrent(p)','!p.settled','let panel=p.panel','panel.isVisible','panel.sheetParent === h.window','!uiNonce.isEmpty','D476_WS_PICKER_SELECTED','D476_WS_PICKER_CANCELLED'])assert.ok(passive.includes(marker))
  assert.equal(swift.includes('NSApp.windows'),false);assert.ok(swift.includes('diagnosticSends<16 || first'));assert.ok(swift.includes('task.send(.string(text)){_ in}'))
  assert.doesNotMatch(passive,/performClick\s*\(|\.cancel\s*\(|\.ok\s*\(|\.directoryURL\s*=|\.finishPicker\s*\(/)
  for(const marker of ['XCUIApplication(url:scene.appBundle)','app.windows.matching(identifier:scene.nonce)','inputs.element.typeText(scene.selection.path)','["Choose","Open"]','choose.element.click()','cancel.element.click()'])assert.ok(runner.includes(marker))
  assert.ok(runner.indexOf('let ack=try waitFile(.ack)')<runner.indexOf('XCUIApplication(url:scene.appBundle)'));assert.ok(runner.indexOf('try ready(.first,1)')<runner.indexOf('choose.element.click()'));assert.ok(runner.indexOf('try ready(.second,2)')<runner.indexOf('cancel.element.click()'))
  assert.doesNotMatch(runner,/\.launch\s*\(|\.activate\s*\(|\.terminate\s*\(|\.finishPicker\s*\(/)
  assert.equal(/SetFocus|SetActiveWindow|AXUIElement|SystemEvents/.test(cpp+swift),false)
 }
})


/** Test-only closed first-site observations. No native data or authority in this DTO. */
function parseLocalFirstSite705(value:unknown):{origin:'R'|'W'|'M';site:number}|null {
 if(typeof value!=='string'||value.length>32)return null
 const m=/^D476_LOCAL_FIRST_([RWM])_([1-9]|1[0-7])$/.exec(value)
 if(!m||m[0]!==value)return null
 const site=Number(m[2]);if((m[1]==='W'&&site>13)||(m[1]==='M'&&site>8))return null
 return{origin:m[1] as 'R'|'W'|'M',site}
}

/** Passive test-only split of the original W8 predicate. Never a success/authority. */
function parseLocalFocus705(value:unknown):'MOVE_FOCUS_FAILED'|'FOREGROUND_MISMATCH'|null {
 if(value==='D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED')return 'MOVE_FOCUS_FAILED'
 if(value==='D476_LOCAL_FOCUS_FOREGROUND_MISMATCH')return 'FOREGROUND_MISMATCH'
 return null
}

// Shares the existing foreground worker and surface lease, never a new competing file.
/** Test-only closed projection. Counts actual send frames, never terminal bytes or text. */
export function createLocalDataObservation705(){
 let rendererFirstData=false,terminalDataFrames=0,terminalDataBytes=0,terminalDataIncomplete=false
 return{
  renderer(){rendererFirstData=true},
  incomplete(){terminalDataIncomplete=true},
  frame(frame:Record<string,unknown>){
   if(frame.type!=='terminal.data')return
   if(typeof frame.b64!=='string'){terminalDataIncomplete=true;return}
   const bytes=Buffer.from(frame.b64,'base64').length
   if(terminalDataFrames>=65535||bytes>16777216-terminalDataBytes)terminalDataIncomplete=true
   terminalDataFrames=Math.min(65535,terminalDataFrames+1);terminalDataBytes=Math.min(16777216,terminalDataBytes+bytes)
  },
  snapshot(){return{rendererFirstData,terminalDataFrames,terminalDataBytes,terminalDataIncomplete}},
 }
}

/** One captured native activation attempt; no HWND, PID, title or extra OS query. */
export function parseLocalActivation705(value:unknown):{requested:boolean;foreground:'NOT_READ'|'NULL'|'OWNED'|'OTHER'}|null {
 if(typeof value!=='string'||value.length!==23)return null
 const match=/^D476_LOCAL_ACTIVATE_([01])_([X012])$/.exec(value)
 if(!match||match[0]!==value)return null
 return{requested:match[1]==='1',foreground:({X:'NOT_READ','0':'NULL','1':'OWNED','2':'OTHER'} as const)[match[2] as 'X'|'0'|'1'|'2']}
}

/** Passive observations from the existing authenticated local-work socket only. */
export function createLocalProgress705(){
 const confirmations=new Set<string>();let agentRequests=0,agentResults=0,agentAccepted=0,agentConfirmations=0,agentDecisions=0,agentApprovals=0,runtimeStarts=0,protocolAttempts=0,protocolHandles=0
 const inc=(n:number)=>Math.min(65535,n+1)
 return{
  incoming(frame:any){try{if(!frame||typeof frame!=='object')return
   if(frame.type==='desktop.agent.start')agentRequests=inc(agentRequests)
   if(frame.type==='desktop.confirmation.decision'&&frame.purpose==='local-work'&&typeof frame.confirmation_id==='string'&&confirmations.has(frame.confirmation_id)){confirmations.delete(frame.confirmation_id);agentDecisions=inc(agentDecisions);if(frame.approved===true)agentApprovals=inc(agentApprovals)}
  }catch{/* Observation cannot replace the original request. */}},
  outgoing(data:unknown){try{if(typeof data!=='string')return;const frame=JSON.parse(data)
   if(frame?.type==='desktop.confirmation.request'&&frame.purpose==='local-work'&&frame.request_method==='desktop.agent.start'&&typeof frame.confirmation_id==='string'&&frame.confirmation_id.length<=200){agentConfirmations=inc(agentConfirmations);if(confirmations.size<8)confirmations.add(frame.confirmation_id)}
   if(frame?.type==='desktop.agent.start.result'){agentResults=inc(agentResults);if(frame.ok===true)agentAccepted=inc(agentAccepted)}
  }catch{/* Observation cannot replace the original send. */}},
  runtime(){runtimeStarts=inc(runtimeStarts)},attempt(){protocolAttempts=inc(protocolAttempts)},handle(){protocolHandles=inc(protocolHandles)},
  snapshot(){return{agentRequests,agentResults,agentAccepted,agentConfirmations,agentDecisions,agentApprovals,runtimeStarts,protocolAttempts,protocolHandles}},
 }
}

test('#476 native local-work keys→real PTY/ACP→explicit handback→same history',{skip:!['darwin','win32'].includes(process.platform),timeout:45000},async t=>withSurface650(t,async(t,surfaceLease)=>{
 const confirmationObservation772=createConfirmationObservation772('LOCAL',()=>performance.now(),line=>t.diagnostic(line));let confirmationOrdinal772=0
 t.signal.addEventListener('abort',()=>confirmationObservation772.emit('ABORT'),{once:true})
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-local-work-476-'))),previous=process.env.CMSPARK_DATA_DIR,skipLogin=process.env.CMSPARK_SKIP_LOGIN_ENV;process.env.CMSPARK_DATA_DIR=dir;process.env.CMSPARK_SKIP_LOGIN_ENV='1'
 const {initDataDir,saveConfig}=await import('../src/config'),{createNativeLocalWorkRuntime}=await import('../src/desktop/local-work-runtime'),acp=await import('../src/acp/manager'),{commitNativeLocalHandback}=await import('../src/desktop/local-handback'),{formatHandbackChatMessage}=await import('../src/acp/handback-format'),protocol=await import('../src/acp/protocol-session'),{SecurityConfirmationManager}=await import('../src/security-confirmation'),{loadNodePty}=await import('../src/pty/load-native'),pty=await import('../src/pty/session')
 await initDataDir();const permissionFile=path.join(dir,'permission-outcome'),agentScript=path.resolve(__dirname,'../../tests/fixtures/desktop-476/local-agent.cjs')
 saveConfig({modules:{'devsec-workspace':{available:true,enabled:true}},embedded_terminal:{enabled:true},acp:{enabled:true,policy:{require_workspace:true,force_confirm_session_start:true,default_profile:'review_readonly'},servers:{owned:{enabled:true,display_name:'Owned controlled ACP',transport:'stdio',command:process.execPath,args:[agentScript],protocol:'acp',env:{OWNED_LOCAL_PERMISSION_FILE:permissionFile},policy:{profile:'review_readonly'}}}},coding_handoff:{open_local_terminal:true}} as any)
 acp._resetAcpManagerForTests();const manager=acp.getAcpManager(),threads=new ThreadManager();threads.create('Native local A','native-local-A');threads.create('Unchanged sibling','native-local-B');threads.update('native-local-A',{workspace_root:dir});let saved=0,protocolStarts=0,inputUnicode=false,resizeCalls=0,terminalStops=0;const localProgress=createLocalProgress705()
 manager.setHandbackSink(({session,handback})=>{saved++;const content=formatHandbackChatMessage({agentId:session.agent_id,mode:session.mode||'review_readonly',partial:session.partial,handback,diffSummary:session.diff_summary||null,paths:[]});assert.equal(commitNativeLocalHandback(session,content),true)})
 const childClosures:Promise<void>[]=[],realStart=protocol.tryStartProtocolSession;t.mock.method(protocol,'tryStartProtocolSession',async (opts:Parameters<typeof protocol.tryStartProtocolSession>[0])=>{localProgress.attempt();const handle=await realStart(opts);if(handle){localProgress.handle();protocolStarts++;childClosures.push(new Promise<void>(r=>{if(handle.child.exitCode!==null||handle.child.signalCode!==null)r();else handle.child.once('close',()=>r())}))}return handle})
 const runtime=createNativeLocalWorkRuntime({threads,activity:()=> 'idle'}),dataObservation=createLocalDataObservation705(),actualHandles:Array<{kill():void;exited:boolean}>=[],ptyExits:Promise<void>[]=[],ptyClosed:Promise<void>[]=[],ptyClosedStates:Array<{closed:boolean}>=[],nativePty=loadNodePty(),realSpawn=nativePty.spawn.bind(nativePty)
 let ownedSpawn=false
 // Delegate to the actual loader only inside this exact owner's original open call.
 t.mock.method(nativePty,'spawn',(...parameters:Parameters<typeof realSpawn>)=>{assert.equal(ownedSpawn,true);const [file,args,opts]=parameters;assert.equal(file,runtime.shell().file);assert.deepEqual(args,[...runtime.shell().args]);assert.equal(fs.realpathSync(opts.cwd),dir);const handle=realSpawn(file,args,opts),owned={kill:()=>handle.kill(),exited:false};actualHandles.push(owned);ptyExits.push(new Promise<void>(resolve=>handle.onExit(()=>{owned.exited=true;resolve()})));return handle})
 const realAgentStart=runtime.startAgent;runtime.startAgent=input=>{localProgress.runtime();return Reflect.apply(realAgentStart!,runtime,[input])}
 const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realClose=runtime.close;runtime.openTerminal=input=>{confirmationObservation772.server(4);assert.equal(input.owner,current);assert.equal(input.threadId,'native-local-A');assert.equal(fs.realpathSync(input.cwd),dir);let closed!:()=>void;const closeState={closed:false},close=new Promise<void>(resolve=>closed=()=>{closeState.closed=true;resolve()});ownedSpawn=true;try{const result=realOpen({...input,send:frame=>{try{dataObservation.frame(frame)}catch{dataObservation.incomplete() /* Observation cannot replace the original send. */}if(frame.type==='terminal.closed')closed();input.send(frame)}});if(result.ok){ptyClosed.push(close);ptyClosedStates.push(closeState)}return result}finally{ownedSpawn=false}};runtime.input=(id,b64)=>{if(Buffer.from(b64,'base64').toString('utf8').includes('中'))inputUnicode=true;return realInput(id,b64)};runtime.resize=(id,c,r)=>{resizeCalls++;return realResize(id,c,r)};runtime.close=id=>{terminalStops++;return realClose(id)}
 const registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-local-work-476'),confirmations=new SecurityConfirmationManager(),required=['D476_LOCAL_OUTPUT','D476_LOCAL_RESIZED','D476_LOCAL_STOPPED','D476_LOCAL_SAVED','D476_LOCAL_REOPENED','D476_LOCAL_AGENT_SAVED','D476_LOCAL_AGENT_STOPPED','D476_LOCAL_DONE'],receipts=new Set<string>()
 const localFirstSite:{R:number|null;W:number|null;M:number|null}={R:null,W:null,M:null}
 let localFocusResult:'MOVE_FOCUS_FAILED'|'FOREGROUND_MISMATCH'|null=null,localActivation:ReturnType<typeof parseLocalActivation705>=null
 let native:DesktopNativeChild|undefined,current:any,authenticated=false,windowRequested=false,settled=false,failed=false,connections=0,completion:Promise<void>|undefined,primaryFailed=false,exitResolve!:(v:number)=>void,failResolve!:()=>void
 const exited=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r),channel=createDesktopChannel({registry,securityConfirmations:confirmations,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10485760,localRuntime:runtime,onAuthenticated:host=>{authenticated=true;windowRequested=channel.window(host,'workspace')}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer();attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
 const deadline=new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_LOCAL_NATIVE_DEADLINE')),{once:true}));const fail=()=>{failed=true;failResolve()}
 channel.wss.on('connection',ws=>{current=ws;connections++;const originalSend=ws.send;ws.send=function(this:typeof ws,data:any,...args:any[]){try{if(authenticated)localProgress.outgoing(data)}catch{}let observedOrdinal772=0;try{const f=typeof data==='string'?JSON.parse(data):null;if(authenticated&&f?.type==='desktop.confirmation.request'&&f.purpose==='local-work'){observedOrdinal772=++confirmationOrdinal772;confirmationObservation772.server(1,observedOrdinal772)}}catch{}const result772=Reflect.apply(originalSend,this,[data,...args]);if(observedOrdinal772)confirmationObservation772.server(2,observedOrdinal772);return result772} as typeof ws.send;ws.on('message',raw=>{let frame:any;try{frame=JSON.parse(String(raw))}catch{return}try{if(authenticated)localProgress.incoming(frame)}catch{};if(authenticated){confirmationObservation772.native(frame);if(frame.type==='desktop.confirmation.decision'&&frame.purpose==='local-work')confirmationObservation772.server(3,confirmationOrdinal772)};if(!authenticated||frame.type!=='system.ping')return;if(frame.id==='D476_LOCAL_DATA_SEEN'){if(Object.keys(frame).sort().join()==='id,type')dataObservation.renderer();return}try{const activation=parseLocalActivation705(frame.id);if(activation){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localActivation===null)localActivation=activation;return}}catch{}const focus=parseLocalFocus705(frame.id);if(focus){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localFocusResult===null)localFocusResult=focus;return}const first=parseLocalFirstSite705(frame.id);if(first){if(Object.keys(frame).sort().join()==='id,type'&&(first.origin==='R'||first.origin==='W'&&process.platform==='win32'||first.origin==='M'&&process.platform==='darwin')&&localFirstSite[first.origin]===null)localFirstSite[first.origin]=first.site;return}if(frame.id==='D476_LOCAL_FAIL'){fail();return}if(!required.includes(frame.id))return;if(receipts.has(frame.id)){fail();return}receipts.add(frame.id);if(frame.id==='D476_LOCAL_DONE'){
   completion=(async()=>{await Promise.race([Promise.all(childClosures),deadline]);assert.equal(receipts.size,required.length);assert.equal(protocolStarts,2);assert.equal(saved,1);assert.equal(fs.readFileSync(permissionFile,'utf8'),'DENIED');assert.equal(inputUnicode,true);assert.ok(resizeCalls>=2);assert.ok(terminalStops>=1);const disk=new ThreadManager().readDesktopDialog('native-local-A');assert.equal(disk.messages.length,2);assert.ok(disk.messages.some(m=>m.content.includes('D476_LOCAL_中')));assert.ok(disk.messages.some(m=>m.content.includes('D476_AGENT_PERMISSION_DENIED')));assert.equal(new ThreadManager().readDesktopDialog('native-local-B').messages.length,0);assert.equal(manager.hasProjectThreadActivity('native-local-A'),false);ws.send(JSON.stringify({type:'D476.local.complete',result:'COMPLETE'}))})();completion.catch(fail)
  }})})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try{
  assert.equal(pty.isPtyBusy(),false,'LOCAL476_NO_FOREIGN_LIVE_SLOT')
  const output=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(output,'acceptance/local',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual local-work acceptance host must be built');surfaceLease.checkpoint();native=(require(path.join(output,'desktop-launcher.node')) as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,code=>{confirmationObservation772.server(5);settled=true;exitResolve(code)})
  assert.equal(await Promise.race([exited,failure.then(()=>{throw Error('OWNED_LOCAL_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.deepEqual([...receipts].sort(),[...required].sort());assert.equal(confirmations.pendingCount(),0)
  process.stdout.write('DESKTOP_LOCAL_WORK_476 {"native":true,"ownedPty":true,"unicodeInput":true,"unicodeOutput":true,"resized":true,"stopped":true,"selectedReturn":true,"reopened":true,"ownedAcpProcesses":2,"permissionDenied":true,"savedAgentMessages":1,"siblingUnchanged":true}\n')
 }catch(error){primaryFailed=true;throw error}finally{
  confirmationObservation772.emit('FINALLY');surfaceLease.retain();try{t.diagnostic('D476_LOCAL_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),protocolStarts,saved,inputUnicode,resizeCalls,terminalStops,authenticated,windowRequested,connections,childExited:settled,localFirstSite,localFocusResult,localActivation,localData:dataObservation.snapshot(),localProgress:localProgress.snapshot()}))}catch{}
  let cleanupError:unknown,ptyReaped=false;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}
  await clean(async()=>{native?.terminate();if(native&&!settled)await exited});await clean(()=>{for(const ws of channel.wss.clients)ws.terminate();confirmations.rejectAll('disconnect')});await clean(()=>manager.shutdown());manager.setHandbackSink(null)
  await clean(()=>{for(const handle of actualHandles)if(!handle.exited)handle.kill()});await clean(async()=>{await Promise.race([Promise.all([...ptyExits,...ptyClosed]),deadline]);assert.equal(pty.isPtyBusy(),false);ptyReaped=true});await clean(()=>Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]));await clean(()=>new Promise<void>(r=>server.close(()=>r())))
  if(previous===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=previous;if(skipLogin===undefined)delete process.env.CMSPARK_SKIP_LOGIN_ENV;else process.env.CMSPARK_SKIP_LOGIN_ENV=skipLogin;
  // The primary deadline may already be rejected: reconcile only exact observed owned closure facts.
  ptyReaped ||= ptyExits.length===actualHandles.length&&actualHandles.every(handle=>handle.exited)&&ptyClosedStates.length===ptyClosed.length&&ptyClosedStates.every(state=>state.closed)&&!pty.isPtyBusy()
  if((!native||settled)&&!manager.hasProjectThreadActivity('native-local-A')&&ptyReaped&&!pty.isPtyBusy()&&actualHandles.every(handle=>handle.exited)){await clean(()=>fs.rmSync(dir,{recursive:true,force:true}));surfaceLease.settled();}else cleanupError??=Error('OWNED_LOCAL_NATIVE_REAP_UNCONFIRMED')
  if(!primaryFailed&&cleanupError!==undefined)throw cleanupError
 }
}))


test('#705 cancel boundary parser has fixed enums and unknown never implies a return',async()=>{
 const {parseNativeWorkspaceCancel705:parse}=await import('./helpers/desktop-workspace-picker-476')
 assert.deepEqual(parse('D476_WS_CANCEL_CLOSE_OK'),{close:1});assert.deepEqual(parse('D476_WS_CANCEL_CLOSE_FAIL'),{close:2})
 for(const [kind,show]of [['CANCELLED',1],['FAILED',2],['SUCCESS',3]]as const)for(const settled of [0,1])for(const current of [0,1])assert.deepEqual(parse(`D476_WS_CANCEL_SHOW_${kind}_${settled}_${current}`),{show,settled:!!settled,current:!!current})
 let reads=0;const trap=Object.defineProperty({},'toString',{get(){reads++;throw Error('PRIVATE')}})
 for(const value of [null,trap,'','D476_WS_CANCEL_CLOSE_OK\n','D476_WS_CANCEL_CLOSE_OK_PRIVATE','D476_WS_CANCEL_SHOW_UNKNOWN_0_1','D476_WS_CANCEL_SHOW_CANCELLED_2_1','D476_WS_CANCEL_SHOW_CANCELLED_0_1\n','D476_WS_CANCEL_SHOW_CANCELLED_0_1_PRIVATE','D476_WS_CANCEL_SHOW_CANCELLED_0_1'.repeat(3)])assert.equal(parse(value),null)
 assert.equal(reads,0)
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

/** Passive observed-state bitset only: not a last-state or success authority. */
function createTerminalReadiness747(){
 let seenMask=0
 const own=(value:object,key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined}
 return{
  observe(value:unknown){try{
   if(!value||typeof value!=='object'||Object.getOwnPropertyNames(value).sort().join()!=='id,type'||Object.getOwnPropertySymbols(value).length||own(value,'type')!=='system.ping')return
   const id=own(value,'id');if(typeof id!=='string'||id.length!==25)return
   const m=/^D476_TERMINAL_READY_([01])_([X01])_([01])$/.exec(id);if(!m)return
   const index=Number(m[1])*6+['X','0','1'].indexOf(m[2])*2+Number(m[3]);seenMask|=1<<index
  }catch{/* Observation cannot alter the original result or cleanup. */}},
  snapshot(){return{schema:1,seenMask}}
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
  const confirmationObservation772=createConfirmationObservation772('TERMINAL',()=>performance.now(),line=>t.diagnostic(line))
  t.signal.addEventListener('abort',()=>confirmationObservation772.emit('ABORT'),{once:true})
  const previous=process.env.CMSPARK_DATA_DIR,dir=fs.realpathSync(fs.mkdtempSync(path.join(owned,'native-terminal705-')));process.env.CMSPARK_DATA_DIR=dir
  const {initDataDir,saveConfig}=await import('../src/config'),{createNativeTerminalRuntime}=await import('../src/desktop/terminal-runtime'),{SecurityConfirmationManager}=await import('../src/security-confirmation'),{loadNodePty}=await import('../src/pty/load-native'),pty=await import('../src/pty/session'),{WebSocket}=await import('ws'),{createHmac}=await import('node:crypto')
  await initDataDir();saveConfig({modules:{'devsec-workspace':{available:true,enabled:true}},embedded_terminal:{enabled:true}} as any)
  assert.equal(pty.isPtyBusy(),false,'TERMINAL705_NO_FOREIGN_LIVE_SLOT')
  const threads=new ThreadManager();threads.create('Native terminal A','native-terminal-A');threads.create('Unchanged sibling','native-terminal-B');threads.update('native-terminal-A',{workspace_root:dir})
  const registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-native-terminal705'),confirmations=new SecurityConfirmationManager(),runtime=createNativeTerminalRuntime(()=> 'idle')
  const outputDecoder=new TextDecoder(),inputDecoder=new TextDecoder();let outputSuffix='',inputSuffix='';const actualHandles:Array<{kill():void;pid():number;exited:boolean}>=[];let completionFailure:unknown
  const readiness=createTerminalReadiness747();let inputEnterObserved=false,rawOutputMarkerSeen=false
  const firstFailure=createTerminalFirstFailure747()
  const required=['DENIED','CANCELLED','OUTPUT','RESIZED','STOPPED','SAVED','REOPENED','DONE'].map(n=>'D476_TERMINAL_'+n),receipts=new Set<string>(),outputSeq=new Set<number>(),ackSeq=new Set<number>(),dimensions=new Set<string>(),childExits:Promise<void>[]=[]
  let child:DesktopNativeChild|undefined,childExited=false,authenticated=false,windowRequested=false,failed=false,connections=0,primary:any,completion:Promise<void>|undefined,foreign:InstanceType<typeof WebSocket>|undefined,foreignCheck:Promise<void>|undefined,actualSpawns=0,openAttempts=0,confirmationRequests=0,decisions=0,deniedResults=0,outputBytes=0,largestFrame=0,lastOutput=0,inputUnicode=false,outputUnicode=false,stops=0,ownedPid=0,actualProcessExit=false,exitResolve!:(n:number)=>void,failResolve!:()=>void,primaryFailure:unknown
  let terminalPhaseEmitted=false,terminalPhaseEmitting=false
  const emitTerminalPhase=(moment='FINALLY')=>{
   if(terminalPhaseEmitted||terminalPhaseEmitting)return
   terminalPhaseEmitting=true
   try{t.diagnostic('D476_TERMINAL_NATIVE_PHASE '+JSON.stringify({schema:1,moment,firstFailure:firstFailure.snapshot(),readiness:readiness.snapshot(),inputEnterObserved,rawOutputMarkerSeen,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),actualSpawns,openAttempts,confirmationRequests,decisions,deniedResults,outputBytes,largestFrame,outputFrames:outputSeq.size,acks:ackSeq.size,dimensions:dimensions.size,inputUnicode,outputUnicode,stops,actualProcessExit,authenticated,windowRequested,connections,childExited}));terminalPhaseEmitted=true}catch{}finally{terminalPhaseEmitting=false}
  }
  const exited=new Promise<number>(r=>exitResolve=r),failure=new Promise<void>(r=>failResolve=r),deadline=new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>{firstFailure.seal();emitTerminalPhase('ABORT');reject(Error('OWNED_TERMINAL705_NATIVE_DEADLINE'))},{once:true})),fail=()=>{firstFailure.seal();failed=true;failResolve()}
  // This independent no-open parser observes actual original PTY bytes. Loading
  // xterm stays inside the hosted native callback, after runtime admission.
  const {Terminal}=require('@xterm/xterm') as typeof import('@xterm/xterm')
  const outputObserver=createTerminalObserver747((cols,rows)=>new Terminal({cols,rows,scrollback:5000,convertEol:false}),t.signal,error=>{completionFailure??=error;fail()})
  // Delegate every spawn to the actual required @lydell loader. This is observation,
  // not testSetPtySpawn/MockPty/platform spoof or a replacement native handle.
  const nativePty=loadNodePty(),realSpawn=nativePty.spawn.bind(nativePty)
  t.mock.method(nativePty,'spawn',(...parameters:Parameters<typeof realSpawn>)=>{const [file,args,opts]=parameters
   assert.equal(file,runtime.shell().file);assert.deepEqual(args,[...runtime.shell().args]);assert.equal(fs.realpathSync(opts.cwd),dir)
   const handle=realSpawn(file,args,opts);actualSpawns++;const ownedHandle={kill:()=>handle.kill(),pid:()=>handle.pid,exited:false};actualHandles.push(ownedHandle)
   // Windows publishes the real PID at ready_datapipe, before forwarding data.
   // Keep ownership on this exact handle; a synchronous PID of zero is not a spawn failure.
   handle.onData(()=>{try{const pid=handle.pid;assert.ok(Number.isSafeInteger(pid)&&pid>0);if(ownedPid!==0)assert.equal(pid,ownedPid);else ownedPid=pid}catch(error){completionFailure??=error;fail()}})
   childExits.push(new Promise<void>(resolve=>handle.onExit(()=>{ownedHandle.exited=true;actualProcessExit=true;resolve()})));return handle
  })
  const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realAck=runtime.ack,realClose=runtime.close
  runtime.openTerminal=input=>{confirmationObservation772.server(4);openAttempts++;assert.equal(input.owner,primary);assert.equal(confirmations.pendingCount(),0);const observation=outputObserver.reserveOpen(input);const result=realOpen(input);outputObserver.commitOpen(observation,result.ok);if(result.ok){assert.ok(pty.getOwnedPtyContext(input.id,primary));assert.equal(pty.getOwnedPtyContext(input.id,null),null);assert.equal(pty.getOwnedPtyContext(input.id,{}),null);assert.equal(pty.readPtyTail(input.id,primary,'native-terminal-A').success,false,'shell consent is not private model-tail consent')}return result}
  runtime.input=(id,b64)=>{const bytes=Buffer.from(b64,'base64');assert.ok(bytes.length<=16384);inputEnterObserved=inputEnterObserved||bytes.includes(13);inputSuffix=(inputSuffix+inputDecoder.decode(bytes,{stream:true})).slice(-256);assert.equal(inputSuffix.includes('D476_TERMINAL_中'),false,'complete output marker must not come from input echo');if(inputSuffix.includes('中'))inputUnicode=true;return realInput(id,b64)}
  runtime.resize=(id,c,r)=>{const observation=outputObserver.reserveResize(id,c,r);const value=realResize(id,c,r);outputObserver.commitResize(observation,value.ok);if(value.ok)dimensions.add(c+'x'+r);return value}
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
     if(f.type==='desktop.confirmation.request'&&f.purpose==='local-work'){confirmationRequests++;confirmationObservation772.server(1,confirmationRequests);assert.ok(confirmationRequests<=4);assert.equal(JSON.parse(f.action_json).kind,confirmationRequests<=3?'terminal-open':'terminal-return')}
     if(f.type==='desktop.terminal.open.result'){
      if(f.ok===false&&f.error_code==='LOCAL_DENIED'){deniedResults++;assert.equal(actualSpawns,0);assert.equal(openAttempts,0)}
      if(f.ok===true){assert.equal(deniedResults,2);foreignCheck=foreignOwner(f.operation_id);foreignCheck.catch(error=>{completionFailure=error;fail()})}
     }
     if(f.type==='desktop.terminal.data'){const bytes=Buffer.from(f.b64,'base64');assert.ok(bytes.length<=16384);assert.equal(f.seq,lastOutput+1);lastOutput=f.seq;outputSeq.add(f.seq);outputBytes+=bytes.length;largestFrame=Math.max(largestFrame,bytes.length);const rawObservation=rawMarker747(outputSuffix,outputDecoder.decode(bytes,{stream:true}));outputSuffix=rawObservation.suffix;rawOutputMarkerSeen=rawOutputMarkerSeen||rawObservation.found;outputObserver.data(f.operation_id,f.thread_id,ws,bytes)}
    }
    const result772=Reflect.apply(original,ws,[data,...args]);if(ws===primary&&f.type==='desktop.confirmation.request'&&f.purpose==='local-work')confirmationObservation772.server(2,confirmationRequests);return result772
   })as typeof ws.send
   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(ws!==primary||!authenticated)return
    confirmationObservation772.native(f)
     if(f.type==='desktop.confirmation.decision'&&f.purpose==='local-work'){decisions++;confirmationObservation772.server(3,decisions)}
    if(f.type!=='system.ping'||typeof f.id!=='string')return
    readiness.observe(f)
    firstFailure.observe(f)
    if(f.id==='D476_TERMINAL_FAIL'){fail();return}
    if(!required.includes(f.id))return;if(receipts.has(f.id)){fail();return}receipts.add(f.id)
    if(f.id==='D476_TERMINAL_DONE'){
     completion=(async()=>{
      await Promise.race([Promise.all([...childExits,...(foreignCheck?[foreignCheck]:[])]),deadline]);assert.equal(actualProcessExit,true);assert.equal(pty.isPtyBusy(),false);assert.equal(pty.getLivePtyId(),null)
      outputUnicode=await Promise.race([outputObserver.finish(),deadline])
      assert.equal(actualSpawns,1);assert.equal(actualHandles.length,1);assert.ok(Number.isSafeInteger(ownedPid)&&ownedPid>0);assert.equal(actualHandles[0].pid(),ownedPid);assert.equal(openAttempts,1);assert.equal(confirmationRequests,4);assert.equal(decisions,4);assert.equal(deniedResults,2);assert.equal(inputUnicode,true);assert.equal(outputUnicode,true);assert.ok(outputBytes>16384);assert.ok(largestFrame<=16384);assert.ok(outputSeq.size>0);assert.deepEqual([...ackSeq].sort((a,b)=>a-b),[...outputSeq].sort((a,b)=>a-b));assert.ok(dimensions.size>=2);assert.equal(stops,1);assert.equal(receipts.size,required.length)
      const disk=new ThreadManager().readDesktopDialog('native-terminal-A');assert.equal(disk.messages.length,1);assert.ok(disk.messages[0].content.includes('D476_TERMINAL_中'));assert.ok(disk.messages[0].content.includes('partial'));assert.equal(new ThreadManager().readDesktopDialog('native-terminal-B').messages.length,0);assert.equal(confirmations.pendingCount(),0)
      ws.send(JSON.stringify({type:'D476.terminal.complete',result:'COMPLETE'}))
     })();completion.catch(error=>{completionFailure=error;fail()})
    }
   })
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
   const native=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(native,'acceptance/terminal',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual terminal-only acceptance host must be built');surfaceLease.checkpoint()
   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,code=>{confirmationObservation772.server(5);firstFailure.seal();childExited=true;exitResolve(code)})
   assert.equal(await Promise.race([exited,failure.then(()=>{throw completionFailure??Error('OWNED_TERMINAL705_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,2);assert.deepEqual([...receipts].sort(),[...required].sort())
   process.stdout.write('DESKTOP_TERMINAL_705 {"native":true,"realPty":true,"syntheticNativeApproval":true,"humanApproval":false,"deniedAndCancelledZeroLaunch":true,"unicode":true,"over16KiBOutput":true,"seqAck":true,"resized":true,"stoppedActualExit":true,"selectedPartialReturn":true,"diskReopened":true,"foreignAndNullRefused":true}\n')
  }catch(error){primaryFailure=error;throw error}finally{
   confirmationObservation772.emit('FINALLY');firstFailure.seal();surfaceLease.retain();emitTerminalPhase('FINALLY')
   let cleanupError:unknown;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}
   await clean(()=>outputObserver.dispose());await clean(async()=>{child?.terminate();if(child&&!childExited)await exited});await clean(()=>{foreign?.terminate();for(const ws of channel.wss.clients)ws.terminate();confirmations.rejectAll('disconnect')})
   await clean(()=>{for(const handle of actualHandles)if(!handle.exited)handle.kill()});await clean(async()=>{await Promise.race([Promise.all(childExits),deadline]);assert.equal(pty.isPtyBusy(),false)});await clean(()=>Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]));await clean(()=>new Promise<void>(r=>server.close(()=>r())))
   if(previous===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=previous
   if(!child||childExited){if(!pty.isPtyBusy()&&actualHandles.every(handle=>handle.exited)){await clean(()=>fs.rmSync(dir,{recursive:true,force:true}));surfaceLease.settled()}else cleanupError??=Error('OWNED_TERMINAL705_PTY_REAP_UNCONFIRMED')}
   if(primaryFailure===undefined&&cleanupError!==undefined)throw cleanupError
  }
 })
})
