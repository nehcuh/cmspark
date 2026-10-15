import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import { once } from "node:events"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { WebSocketServer } from "ws"
import type { DesktopNativeBinding, DesktopNativeChild } from "../src/desktop/host-launcher"

test("Windows profile source fragment bounds API return before path use (Mac controlled API contract, not Windows native)",{skip:process.platform!=="darwin",timeout:10000},()=>{
 const {spawnSync}=require("node:child_process") as typeof import("node:child_process")
 const root=path.resolve(__dirname,"../../dist/desktop-native")
 const result=spawnSync(path.join(root,"desktop-temp-path-contract"),[],{encoding:"utf8",timeout:5000,env:{PATH:"/usr/bin:/bin"}})
 console.log(result.stdout)
 assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stdout+result.stderr)
 const rows=result.stdout.trim().split("\n").map(line=>JSON.parse(line))
 assert.deepEqual(rows.map(row=>row.api_return),[0,1,259,260,261])
 for(const row of rows){assert.equal(row.pass,true);assert.equal(row.Windows_native,false);assert.equal(row.allocations,row.api_return>0&&row.api_return<260?1:0)}
})

test("actual C construction failures reap only their owned child; normal waiter reports exit7",{skip:process.platform!=="darwin",timeout:20000},()=>{
 const {spawnSync}=require("node:child_process") as typeof import("node:child_process")
 const root=path.resolve(__dirname,"../../dist/desktop-native"),driver=path.resolve(process.cwd(),"tests/fixtures/desktop-480/construction-controller.cjs")
 for(const mode of ["notify","worker","normal"]){
  const result=spawnSync(process.execPath,[driver,root,mode],{encoding:"utf8",timeout:5000,env:{PATH:"/usr/bin:/bin"}})
  console.log(result.stdout)
  assert.equal(result.error,undefined,result.error?.message)
  assert.equal(result.status,0,result.stdout+result.stderr)
  const line=result.stdout.split("\n").find(value=>value.startsWith("OWNED_DESKTOP_CONSTRUCTION "))
  assert.ok(line,result.stdout)
  const proof=JSON.parse(line.slice("OWNED_DESKTOP_CONSTRUCTION ".length))
  assert.equal(proof.mode,mode);assert.equal(proof.reaped,true);assert.equal(proof.exited_unreaped,false)
 }
})

// Actual native host+WKWebView+crypto/network test, hidden window (not GUI/installed acceptance).
test("real Mac native child authenticates over WS and bundled hidden WK document reads the four metadata pages",{skip:process.platform!=="darwin",timeout:20000},async(t)=>{
 const root=path.resolve(__dirname,"../../dist/desktop-native"),addon=path.join(root,"desktop-launcher.node"),binary=path.join(root,"cmspark-desktop")
 assert.equal(fs.existsSync(addon)&&fs.existsSync(binary),true,"Build actual native desktop artifacts before Mac native gate")
 const binding=require(addon) as DesktopNativeBinding
 const registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-macos-host")
 const wire:string[]=[];let authority=false;const methods=new Set<string>();let finish!:()=>void,exited!:(v:number)=>void
 const done=new Promise<void>(r=>finish=r),exit=new Promise<number>(r=>exited=r)
 function note(name:string){methods.add(name);if(methods.size===4)finish()}
 const services={threads:{desktopMetadataSnapshot:()=>{note("thread");return[{id:"owned",alias:"Owned native test",updated_at:"2026-10-15"}]},get:()=>undefined,getMessages:()=>[]},skills:{list:()=>{note("skill");return[]},listKnowledge:()=>{note("knowledge");return[]}},mcp:{listServers:()=>{note("mcp");return[]}}}
 const channel=createDesktopChannel({registry,services,maxPayload:10*1024*1024,onAuthenticated:()=>{authority=true}}),legacy=new WebSocketServer({noServer:true}),server=http.createServer()
 channel.wss.on("connection",ws=>ws.on("message",b=>{try{wire.push(String(JSON.parse(String(b)).type))}catch{wire.push("INVALID_JSON")}}));
 attachDesktopUpgrade(server,legacy,channel.wss,()=>false);server.listen(0,"127.0.0.1");await once(server,"listening")
 let child:DesktopNativeChild|undefined
 try{const port=(server.address() as any).port;child=binding.launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${port}/desktop`,exited)
   // Authenticated bundled renderer initially refreshes all four read-only metadata families.
   await Promise.race([done,exit.then(code=>{throw Error(`Native owned child exited before metadata completion (${code}); auth=${authority}; types=${wire.join(",")}; reads=${[...methods].join(",")}`)}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("Owned native outer test deadline")),{once:true}))])
   assert.equal(legacy.clients.size,0);assert.equal(channel.wss.clients.size,1);assert.equal(methods.size,4)
   // Ordered list replies contain arrays; native must consume them and remain owner-connected.
   const ws=[...channel.wss.clients][0];const dropped=new Promise<never>((_,reject)=>ws.once("close",code=>{if(code===1001)reject(Error(`Native disconnected before consuming valid metadata replies (${code})`))}))
   ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await Promise.race([exit,dropped]),0)
 }finally{child?.terminate();for(const ws of channel.wss.clients)ws.terminate();await exit;await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()))}
})

// These run the actual compiled Swift bootstrap reader with only inert/nonissued input.
test("actual Mac bootstrap distinguishes legal EOF, read error and exact4096 envelope",{skip:process.platform!=="darwin",timeout:20000},()=>{
 const {spawnSync}=require("node:child_process") as typeof import("node:child_process")
 const binary=path.resolve(__dirname,"../../dist/desktop-native/cmspark-desktop")
 for(const [body,expected] of [["",15],["x".repeat(4096),15],["x".repeat(4097),14]] as const){const r=spawnSync(binary,[],{input:body,stdio:["pipe","ignore","ignore"],timeout:5000,env:{PATH:"/usr/bin:/bin"}});assert.equal(r.status,expected)}
 const fd=fs.openSync("/dev/null","w")
 try{const r=spawnSync(binary,[],{stdio:[fd,"ignore","ignore"],timeout:5000,env:{PATH:"/usr/bin:/bin"}});assert.equal(r.status,13)}finally{fs.closeSync(fd)}
})

test("real C addon confines anonymous bootstrap to intended child and closes it before descendant exec",{skip:process.platform!=="darwin",timeout:20000},async()=>{
 const root=path.resolve(__dirname,"../../dist/desktop-native"),binding=require(path.join(root,"desktop-launcher.node")) as DesktopNativeBinding
 const fixture=path.join(root,"desktop-inheritance-probe")
 assert.equal(fs.existsSync(fixture),true,"Build actual owned C inheritance fixture")
 let result!:(code:number)=>void;const exit=new Promise<number>(r=>result=r)
 const sentinel=(require(path.join(root,"inheritable-sentinel.node")) as {create():number}).create()
 const child=binding.launch(fixture,"11".repeat(16),"22".repeat(32),"ws://127.0.0.1:1/desktop",result)
 try{assert.equal(await exit,0)}finally{child.terminate();fs.closeSync(sentinel)}
})

test("real binding retains bootstrap when only owned subdaemon standard descriptors are closed",{skip:process.platform!=="darwin",timeout:20000},()=>{
 const {spawnSync}=require("node:child_process") as typeof import("node:child_process")
 const root=path.resolve(__dirname,"../../dist/desktop-native"),driver=path.resolve(process.cwd(),"tests/fixtures/desktop-480/closed-stdio-controller.cjs")
 for(const fds of ["0","1","2","0,1,2"]){const r=spawnSync(process.execPath,[driver,path.join(root,"desktop-launcher.node"),path.join(root,"desktop-inheritance-probe"),fds],{stdio:"ignore",timeout:5000,env:{PATH:"/usr/bin:/bin"}});assert.equal(r.status,0,`owned closed descriptors ${fds}`)}
})

test("actual native bootstrap refuses boolean protocol and duplicate/escaped duplicate fields before network",{skip:process.platform!=="darwin",timeout:20000},()=>{
 const {spawnSync}=require("node:child_process") as typeof import("node:child_process")
 const binary=path.resolve(__dirname,"../../dist/desktop-native/cmspark-desktop")
 const base={capability_id:"11".repeat(16),secret:"22".repeat(32),url:"ws://127.0.0.1:1/desktop",protocol_version:1,issued_method_set_version:1}
 const canonical=JSON.stringify(base)
 for(const body of [JSON.stringify({...base,protocol_version:true}),canonical.replace('"protocol_version":1','"protocol_version":1,"protocol_version":1'),canonical.replace('"protocol_version":1','"protocol_version":1,"\\u0070rotocol_version":1')]){const r=spawnSync(binary,[],{input:body,stdio:["pipe","ignore","ignore"],timeout:5000,env:{PATH:"/usr/bin:/bin"}});assert.equal(r.status,15)}
})
