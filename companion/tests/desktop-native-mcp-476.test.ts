/** Actual hosted macOS/Windows UI and original manager/config vertical.
 * Native NSButton/BM_CLICK activation is synthetic, not human approval evidence. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import http from "node:http"
import { once } from "node:events"
import { WebSocketServer } from "ws"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { SecurityConfirmationManager } from "../src/security-confirmation"
import type { DesktopNativeBinding, DesktopNativeChild } from "../src/desktop/host-launcher"
const native=path.resolve(__dirname,"../../dist/desktop-native")
test("#476 actual native MCP form + OS-only confirmation approves update/add and denies update",{skip:!["darwin","win32"].includes(process.platform),timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-native-save-476-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
 const config=await import("../src/config");config.replaceMcpServers({owned_native_476:{transport:"stdio",command:"owned_original",args:[],enabled:false,trust_level:"manual",env:{OWNED_INERT:"OWNED_PRIVATE_476"}}})
 const manager=new SecurityConfirmationManager(),registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-native-mcp-476"),receipts=new Set<string>()
 const services={threads:{desktopMetadataSnapshot:()=>[],get:()=>undefined,getMessages:()=>[]},skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>Object.keys(config.getConfig().mcp?.servers||{}).map(name=>({name,connection:{status:"disconnected"}}))}}
 let complete!:()=>void,exited!:(n:number)=>void;const done=new Promise<void>(r=>complete=r),exit=new Promise<number>(r=>exited=r);let child:DesktopNativeChild|undefined,settled=false,auth=false,failed:string|undefined
 const channel=createDesktopChannel({registry,services,maxPayload:10*1024*1024,securityConfirmations:manager,onAuthenticated:()=>{auth=true}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer();attachDesktopUpgrade(server,legacy,channel.wss,()=>false)
 channel.wss.on("connection",ws=>{ws.on("message",raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(f.type!=="system.ping"||typeof f.id!=="string"||!f.id.startsWith("D476_"))return;if(f.id.startsWith("D476_FAIL_")){failed=f.id;complete();return}receipts.add(f.id);if(f.id==="D476_NATIVE_DONE")complete()})})
 server.listen(0,"127.0.0.1");await once(server,"listening")
 try{
  const binding=require(path.join(native,"desktop-launcher.node")) as DesktopNativeBinding,binary=path.join(native,"acceptance/mcp",process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop")
  assert.equal(fs.existsSync(binary),true,"Actual native test host must be built")
  child=binding.launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,n=>{settled=true;exited(n)})
  await Promise.race([done,exit.then(n=>{throw Error(`OWNED_NATIVE_MCP_EXIT_${n}`)}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("OWNED_NATIVE_MCP_DEADLINE")),{once:true}))])
  assert.equal(failed,undefined);assert.equal(auth,true);for(const id of ["D476_NATIVE_WINDOW_1","D476_NATIVE_WINDOW_2","D476_NATIVE_WINDOW_3","D476_SAVE_APPROVED","D476_SAVE_DENIED","D476_NATIVE_DONE"])assert.equal(receipts.has(id),true,id)
  const stored=config.getConfig().mcp!.servers;assert.equal((stored.owned_native_476 as any).command,"owned_update_approved");assert.equal((stored.owned_native_476 as any).env.OWNED_INERT,"OWNED_PRIVATE_476");assert.equal((stored.owned_added_476 as any).command,"owned_added_inert");assert.deepEqual((stored.owned_added_476 as any).args,["中文 空格"]);assert.equal(stored.owned_added_476.enabled,false);assert.equal(manager.pendingCount(),0)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,"config.json"),"utf8")).mcp.servers,stored)
  for(const ws of channel.wss.clients)ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await exit,0)
  process.stdout.write("DESKTOP_476_NATIVE "+JSON.stringify({native:true,syntheticNativeButtonActivation:true,humanApprovalClaimed:false,windows:3,approved:2,denied:1,persisted:true,rendererPrivatePayload:false})+"\n")
 }finally{
  manager.rejectAll("disconnect");child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})
 }
})
