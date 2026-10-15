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
test("Windows real SYNCHRONIZE-only process handle API rejects extra rights, other objects and dead handles",{skip:process.platform!=="win32",timeout:20000},()=>{
 const result=spawnSync(path.join(native,"desktop-synchronize-handle-probe.exe"),[],{encoding:"utf8",timeout:10000,windowsHide:true})
 assert.equal(result.status,0,"Actual Windows API fixture must compile and run, not skip")
 const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.native,true);for(const key of ["minimal_accepts","extra_rights_rejected","event_rejected","closed_rejected","invalid_rejected","missing_query_rejected","query_right_absent"])assert.equal(receipt[key],true)
})
test("real Windows binding inherited bootstrap and minimal parent handle authenticate native WebView2 and metadata",{skip:process.platform!=="win32",timeout:20000},async(t)=>{
 assert.equal(fs.existsSync(path.join(native,"cmspark-desktop.exe")),true,"Actual native Windows build is mandatory")
 const binding=require(path.join(native,"desktop-launcher.node")) as DesktopNativeBinding,registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-windows-host")
 let complete!:()=>void,exited!:(code:number)=>void;const methods=new Set<string>(),done=new Promise<void>(r=>complete=r),exit=new Promise<number>(r=>exited=r)
 const note=(name:string)=>{methods.add(name);if(methods.size===4)complete()}
 const services={threads:{desktopMetadataSnapshot:()=>{note("thread");return[{id:"owned",alias:"Native Windows fixture",updated_at:"2026-10-15"}]},get:()=>undefined,getMessages:()=>[]},skills:{list:()=>{note("skill");return[]},listKnowledge:()=>{note("knowledge");return[]}},mcp:{listServers:()=>{note("mcp");return[]}}}
 let auth=false;const channel=createDesktopChannel({registry,services,maxPayload:10*1024*1024,onAuthenticated:()=>{auth=true}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer();attachDesktopUpgrade(server,legacy,channel.wss,()=>false);server.listen(0,"127.0.0.1");await once(server,"listening")
 let child:DesktopNativeChild|undefined
 try{child=binding.launch(path.join(native,"cmspark-desktop.exe"),boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,exited)
  await Promise.race([done,exit.then(code=>{throw Error(`Native Windows host exit ${code}; authenticated=${auth}; readFamilies=${methods.size}`)}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("Owned Windows native outer deadline")),{once:true}))]);assert.equal(auth,true);assert.equal(legacy.clients.size,0);assert.equal(channel.wss.clients.size,1)
  const ws=[...channel.wss.clients][0];ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await exit,0)
 }finally{child?.terminate();for(const ws of channel.wss.clients)ws.terminate();await exit;await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()))}
})
test("actual Windows native parser refuses boolean and decoded duplicate fields before parent/WS use",{skip:process.platform!=="win32",timeout:20000},()=>{
 const base={capability_id:"11".repeat(16),secret:"22".repeat(32),url:"ws://127.0.0.1:1/desktop",protocol_version:1,issued_method_set_version:1,parent_handle:"0"};const canonical=JSON.stringify(base)
 for(const body of [JSON.stringify({...base,protocol_version:true}),canonical.replace('"protocol_version":1','"protocol_version":1,"protocol_version":1'),canonical.replace('"protocol_version":1','"protocol_version":1,"\\u0070rotocol_version":1')]){const result=spawnSync(path.join(native,"cmspark-desktop.exe"),[],{input:body,stdio:["pipe","ignore","ignore"],timeout:5000,windowsHide:true});assert.equal(result.status,15)}
})

test("actual Windows launcher forwards OS environment only, excluding provider-like and WebView2 overrides",{skip:process.platform!=="win32",timeout:20000},()=>{
 const driver=path.resolve(process.cwd(),"tests/fixtures/desktop-480/environment-controller.cjs");const result=spawnSync(process.execPath,[driver,path.join(native,"desktop-launcher.node"),path.join(native,"desktop-synchronize-handle-probe.exe")],{stdio:"ignore",timeout:10000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.SystemRoot+"\\System32",CMSPARK_DESKTOP_INERT_SECRET:"inert-not-a-credential",WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--owned-inert-override"}});assert.equal(result.status,0)
})
