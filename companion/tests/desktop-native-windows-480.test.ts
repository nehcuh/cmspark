import { withSurface650 } from "./fixtures/native-surface-650"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import { once } from "node:events"
import { spawnSync } from "node:child_process"
import { WebSocketServer } from "ws"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import type { DesktopNativeBinding, DesktopNativeChild } from "../src/desktop/host-launcher"
const native=path.resolve(__dirname,"../../dist/desktop-native")
import {nativePhaseNames,observeNativePhaseResponses,type NativeNavigationObservation} from "./fixtures/desktop-480/native-phase-observation"

test("Windows real SYNCHRONIZE-only process handle API rejects extra rights, other objects and dead handles",{skip:process.platform!=="win32",timeout:20000},()=>{
 const result=spawnSync(path.join(native,"desktop-synchronize-handle-probe.exe"),[],{encoding:"utf8",timeout:10000,windowsHide:true})
 assert.equal(result.status,0,"Actual Windows API fixture must compile and run, not skip")
 const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.native,true);for(const key of ["minimal_accepts","extra_rights_rejected","event_rejected","closed_rejected","invalid_rejected","missing_query_rejected","query_right_absent"])assert.equal(receipt[key],true)
})
test("real Windows binding noninherited bootstrap and minimal parent handle authenticate native WebView2 and metadata",{skip:process.platform!=="win32",timeout:20000},async(t)=>{
 return withSurface650(t, async (t, surfaceLease) => {
 assert.equal(fs.existsSync(path.join(native,"cmspark-desktop.exe")),true,"Actual native Windows build is mandatory")
 const binding=require(path.join(native,"desktop-launcher.node")) as DesktopNativeBinding,registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-windows-host")
 let phase="setup",childExitCode:number|undefined,diagnosticFailed=false;const nativePhases=new Set<string>(),nativeNavigation:{value?:NativeNavigationObservation}={}
 let complete!:()=>void,exited!:(code:number)=>void;const methods=new Set<string>(),done=new Promise<void>(r=>complete=r),exit=new Promise<number>(r=>exited=code=>{childExitCode=code;r(code)})
 const note=(name:string)=>{methods.add(name);if(methods.size===4)complete()}
 const services={threads:{desktopMetadataSnapshot:()=>{note("thread");return[{id:"owned",alias:"Native Windows fixture",updated_at:"2026-10-15"}]},get:()=>undefined,getMessages:()=>[]},skills:{list:()=>{note("skill");return[]},listKnowledge:()=>{note("knowledge");return[]}},mcp:{listServers:()=>{note("mcp");return[]}}}
 let auth=false,windowRequested=false;const channel=createDesktopChannel({registry,services,maxPayload:10*1024*1024,onAuthenticated:host=>{auth=true;windowRequested=channel.window(host,"compact")}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer();attachDesktopUpgrade(server,legacy,channel.wss,()=>false);channel.wss.on("connection",ws=>observeNativePhaseResponses(ws,nativePhases,nativeNavigation));server.listen(0,"127.0.0.1");await once(server,"listening")
 // Fixed test-only fields: never expose bootstrap identity, profile or wire bodies.
 function diagnostic(reason:"deadline"|"cleanup"|"cleanup-complete"){
  const receipt={reason,phase:["setup","launch","waiting-metadata","closing","complete"].includes(phase)?phase:"unknown",authenticated:auth===true,nativePhases:nativePhaseNames.filter(name=>nativePhases.has(name)),nativeNavigation:nativeNavigation.value??null,readFamilies:["thread","skill","knowledge","mcp"].filter(name=>methods.has(name)),childExited:childExitCode!==undefined,exitCode:childExitCode===undefined?null:Number.isInteger(childExitCode)&&childExitCode>=0&&childExitCode<=255?childExitCode:"OTHER"}
  try{fs.writeFileSync(1,`DESKTOP_480_NATIVE ${JSON.stringify(receipt)}\n`)}catch{diagnosticFailed=true}
 }
 let child:DesktopNativeChild|undefined
 let rejectAbort!:(reason:Error)=>void
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject})
 const deadline=()=>{diagnostic("deadline");return Error("Owned Windows native outer deadline")}
 const abort=()=>rejectAbort(deadline())
 t.signal.addEventListener("abort",abort,{once:true})
 try{if(t.signal.aborted)throw deadline();surfaceLease.checkpoint();phase="launch";child=binding.launch(path.join(native,"cmspark-desktop.exe"),boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,exited);phase="waiting-metadata"
  await Promise.race([done,exit.then(code=>{throw Error(`Native Windows host exit ${code}; authenticated=${auth}; readFamilies=${methods.size}`)}),aborted]);assert.equal(auth,true);assert.equal(windowRequested,true);assert.equal(legacy.clients.size,0);assert.equal(channel.wss.clients.size,1)
  phase="closing";const ws=[...channel.wss.clients][0];ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await Promise.race([exit,aborted]),0);phase="complete"
 }finally{t.signal.removeEventListener("abort",abort);surfaceLease.retain();diagnostic("cleanup");child?.terminate();for(const ws of channel.wss.clients)ws.terminate();if(child)await exit;await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));diagnostic("cleanup-complete");assert.equal(diagnosticFailed,false,"Owned native diagnostic capture failed");surfaceLease.settled()}

 })
})
test("actual Windows native parser refuses boolean and decoded duplicate fields before parent/WS use",{skip:process.platform!=="win32",timeout:20000},()=>{
 const carrier=require(path.join(native,"desktop-malformed-bootstrap.node"))
 for(const variant of [0,1,2]){const receipt=carrier.malformed(path.join(native,"cmspark-desktop.exe"),variant);assert.equal(receipt.boundExactChild,true);assert.equal(receipt.actualChildSettled,true);assert.equal(receipt.acknowledged,false);assert.equal(receipt.exitCode,15,"Actual native parser must reject this framed body after valid metadata, not fail the missing-args gate")}
})

test("actual Windows native parser rejects invalid URL types and endpoints before ACK",{skip:process.platform!=="win32",timeout:20000},()=>{
 const carrier=require(path.join(native,"desktop-malformed-bootstrap.node"))
 for(const variant of [3,4,5]){const receipt=carrier.malformed(path.join(native,"cmspark-desktop.exe"),variant);assert.equal(receipt.boundExactChild,true);assert.equal(receipt.actualChildSettled,true);assert.equal(receipt.acknowledged,false);assert.equal(receipt.exitCode,15,"Full URL validation must precede the fixed bootstrap ACK")}
})

test("actual Windows launcher forwards OS environment only, excluding provider-like and WebView2 overrides",{skip:process.platform!=="win32",timeout:20000},()=>{
 const driver=path.resolve(process.cwd(),"tests/fixtures/desktop-480/environment-controller.cjs");const result=spawnSync(process.execPath,[driver,path.join(native,"desktop-launcher.node"),path.join(native,"desktop-synchronize-handle-probe.exe")],{stdio:"ignore",timeout:10000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.SystemRoot+"\\System32",CMSPARK_DESKTOP_INERT_SECRET:"inert-not-a-credential",WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--owned-inert-override"}});assert.equal(result.status,0)
})

function requireOwnedPeerRefusal(value:any):void{
 assert.equal(value?.actualChildCaptured,true,"Actual returned child HANDLE capture is required; absence is not settlement")
 assert.equal(value.actualChildSettled,true)
 assert.equal(value.createdCount,1);assert.equal(value.peerQueryCalls,1);assert.equal(value.injectedPeerMismatches,1)
 assert.equal(value.targetParentDuplicates,0);assert.equal(value.bootstrapWriteBytes,0)
}
test("actual Windows C bootstrap helper controlled syscall refusals preserve framing and one deadline",{skip:process.platform!=="win32",timeout:20000},()=>{
 const result=spawnSync(path.join(native,"desktop-bootstrap-controls.exe"),[],{encoding:"utf8",timeout:10000,windowsHide:true})
 assert.equal(result.status,0,"Applicable actual C helper controls must run, not skip")
 const receipt=JSON.parse(result.stdout.trim()),source=fs.readFileSync(path.resolve("tests/fixtures/desktop-480/windows-bootstrap-controls.c"),"utf8")
 const expected=(source.match(/\bCHECK\(/g)||[]).length-1
 assert.ok(expected>0);assert.equal(receipt.scope,"CONTROLLED_ACTUAL_C_HEADER");assert.equal(receipt.checks,expected)
 assert.equal(receipt.failures,0);assert.equal(receipt.firstFailure,0);assert.equal(receipt.realPipeTransport,false);assert.equal(receipt.pendingOperations,0)
})
test("actual Windows injected peer mismatch writes and duplicates zero then reaps its owned child",{skip:process.platform!=="win32",timeout:20000},()=>{
 const addon=require(path.join(native,"desktop-bootstrap-refusal.node"));let callbacks=0
 assert.throws(()=>addon.launch(path.join(native,"desktop-synchronize-handle-probe.exe"),"11".repeat(16),"22".repeat(32),"ws://127.0.0.1:1/desktop",()=>{callbacks++}),{code:"DESKTOP_LAUNCH_FAILED"})
 requireOwnedPeerRefusal(addon.inspectRefusal());assert.equal(callbacks,0)
})

import { nativeAcceptance, requireInheritance, ownedDirectoryIdentity, requireOwnedDirectory } from "./fixtures/desktop-480/native-acceptance-controller"
for(const mode of ["visual","hostile","reconnect","relaunch","inheritance"] as const)test(`actual Windows acceptance ${mode}: real owned window/engine/lifecycle`,{skip:process.platform!=="win32",timeout:20000},t=>nativeAcceptance(t,mode))
test("actual Windows inheritance: sentinel checker positive and exact production sibling protected endpoints absent",{skip:process.platform!=="win32",timeout:20000},async(t)=>{
 const source=path.resolve("dist/desktop-native/acceptance/inheritance"),run=fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(source)),"owned-inheritance-"))
 const runIdentity=ownedDirectoryIdentity(run)
 let child:import("../src/desktop/host-launcher").DesktopNativeChild|undefined
 let finish!:(code:number)=>void;const exit=new Promise<number>(r=>finish=r)
 try{
  for(const name of ["desktop-inheritance.exe"])fs.copyFileSync(path.join(source,name),path.join(run,name),fs.constants.COPYFILE_EXCL)
  const binary=path.join(run,"desktop-inheritance.exe"),addon=require(path.join(source,"desktop-inheritance.node"))
  child=addon.launch(binary,"01".repeat(16),"02".repeat(32),"ws://127.0.0.1:1/desktop",finish)
  const code=await new Promise<number>((resolve,reject)=>{const abort=()=>reject(t.signal.reason);t.signal.addEventListener("abort",abort,{once:true});exit.then(value=>{t.signal.removeEventListener("abort",abort);resolve(value)})})
  assert.equal(code,0,"Actual protected intended child must consume legal bootstrap without sentinel")
  const observed=addon.inspectOwned();assert.equal(observed.sidecar_valid,true);assert.equal(observed.control_mask,4,"Unrestricted sentinel positive proves checker sensitivity")
  // No same-user waiver: a protected rd/parent present in the real sibling is a genuine RED.
  requireInheritance(observed)
  const sidecar=fs.lstatSync(binary+".handles");assert.equal(sidecar.isFile(),true);assert.equal(sidecar.isSymbolicLink(),false);assert.equal(sidecar.nlink,1)
  console.log("DESKTOP_480_INHERITANCE "+JSON.stringify({intendedExit:code,sentinelControl:true,protectedSiblingAbsent:true}))
 }finally{child?.terminate();if(child)await exit;requireOwnedDirectory(run,runIdentity);fs.rmSync(run,{recursive:true,force:true})}
})

import { nativeParentDeath } from "./fixtures/desktop-480/native-acceptance-controller"
test("actual win32 native parent watcher releases owned lock only after issuer death",{skip:process.platform!=="win32",timeout:20000},t=>nativeParentDeath(t))
