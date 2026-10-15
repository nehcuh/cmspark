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
// Test-build-only fixed IDs; observe accepted existing pong responses, never incoming/global auth.
const nativePhaseNames=["ready_accepted","env_callback","controller_callback","navigation_callback","document_post_attempted","renderer_callback","renderer_admitted","renderer_send_attempted"] as const
type NativeNavigationObservation={isSuccessHrSucceeded:boolean,isSuccess:boolean,sourceHrSucceeded:boolean,sourceMatches:boolean,readySample:boolean,webErrorHrSucceeded:boolean,webErrorStatus:number|null}
function decodeNativeNavigationId(id:string):NativeNavigationObservation|undefined{
 const match=/^DESKTOP_480_NAV_H([01])B([01])S([01])O([01])R([01])E([01])W(u|0[0-9]|1[0-8])$/.exec(id)
 if(!match||match[0]!==id||(match[6]==="0"&&match[7]!=="u"))return
 return{isSuccessHrSucceeded:match[1]==="1",isSuccess:match[2]==="1",sourceHrSucceeded:match[3]==="1",sourceMatches:match[4]==="1",readySample:match[5]==="1",webErrorHrSucceeded:match[6]==="1",webErrorStatus:match[7]==="u"?null:Number(match[7])}
}
function recordNativePhaseResponse(data:unknown,phases:Set<string>,navigation:{value?:NativeNavigationObservation}={}):void{
 if(phases.size>=8||!(typeof data==="string"||Buffer.isBuffer(data)))return
 let frame:any;try{frame=JSON.parse(String(data))}catch{return}
 if(!frame||typeof frame!=="object"||Array.isArray(frame)||Object.keys(frame).length!==2||frame.type!=="system.pong"||typeof frame.id!=="string")return
 const observation=decodeNativeNavigationId(frame.id)
 if(observation){if(!phases.has("navigation_callback")){phases.add("navigation_callback");navigation.value=observation}return}
 for(const phase of nativePhaseNames)if(phase!=="navigation_callback"&&frame.id===`DESKTOP_480_PHASE_${phase}`){phases.add(phase);return}
}
function observeNativePhaseResponses(ws:any,phases:Set<string>,navigation:{value?:NativeNavigationObservation}={}):void{
 const original=ws.send
 ws.send=function(this:unknown,...args:unknown[]){const result=Reflect.apply(original,this,args);try{recordNativePhaseResponse(args[0],phases,navigation)}catch{/* Preserve original send, callback, return and throw behavior. */}return result}
}

test("Windows real SYNCHRONIZE-only process handle API rejects extra rights, other objects and dead handles",{skip:process.platform!=="win32",timeout:20000},()=>{
 const result=spawnSync(path.join(native,"desktop-synchronize-handle-probe.exe"),[],{encoding:"utf8",timeout:10000,windowsHide:true})
 assert.equal(result.status,0,"Actual Windows API fixture must compile and run, not skip")
 const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.native,true);for(const key of ["minimal_accepts","extra_rights_rejected","event_rejected","closed_rejected","invalid_rejected","missing_query_rejected","query_right_absent"])assert.equal(receipt[key],true)
})
test("real Windows binding inherited bootstrap and minimal parent handle authenticate native WebView2 and metadata",{skip:process.platform!=="win32",timeout:20000},async(t)=>{
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
 try{phase="launch";child=binding.launch(path.join(native,"cmspark-desktop.exe"),boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,exited);phase="waiting-metadata"
  await Promise.race([done,exit.then(code=>{throw Error(`Native Windows host exit ${code}; authenticated=${auth}; readFamilies=${methods.size}`)}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>{diagnostic("deadline");reject(Error("Owned Windows native outer deadline"))},{once:true}))]);assert.equal(auth,true);assert.equal(windowRequested,true);assert.equal(legacy.clients.size,0);assert.equal(channel.wss.clients.size,1)
  phase="closing";const ws=[...channel.wss.clients][0];ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await exit,0);phase="complete"
 }finally{diagnostic("cleanup");child?.terminate();for(const ws of channel.wss.clients)ws.terminate();await exit;await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));diagnostic("cleanup-complete");assert.equal(diagnosticFailed,false,"Owned native diagnostic capture failed")}
})
test("actual Windows native parser refuses boolean and decoded duplicate fields before parent/WS use",{skip:process.platform!=="win32",timeout:20000},()=>{
 const base={capability_id:"11".repeat(16),secret:"22".repeat(32),url:"ws://127.0.0.1:1/desktop",protocol_version:1,issued_method_set_version:1,parent_handle:"0"};const canonical=JSON.stringify(base)
 for(const body of [JSON.stringify({...base,protocol_version:true}),canonical.replace('"protocol_version":1','"protocol_version":1,"protocol_version":1'),canonical.replace('"protocol_version":1','"protocol_version":1,"\\u0070rotocol_version":1')]){const result=spawnSync(path.join(native,"cmspark-desktop.exe"),[],{input:body,stdio:["pipe","ignore","ignore"],timeout:5000,windowsHide:true});assert.equal(result.status,15)}
})

test("actual Windows launcher forwards OS environment only, excluding provider-like and WebView2 overrides",{skip:process.platform!=="win32",timeout:20000},()=>{
 const driver=path.resolve(process.cwd(),"tests/fixtures/desktop-480/environment-controller.cjs");const result=spawnSync(process.execPath,[driver,path.join(native,"desktop-launcher.node"),path.join(native,"desktop-synchronize-handle-probe.exe")],{stdio:"ignore",timeout:10000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.SystemRoot+"\\System32",CMSPARK_DESKTOP_INERT_SECRET:"inert-not-a-credential",WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--owned-inert-override"}});assert.equal(result.status,0)
})
