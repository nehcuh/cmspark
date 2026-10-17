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
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"native-metadata-476-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  const threads=new ThreadManager();threads.create("原名称","native-metadata-A");threads.create("另一对话","native-metadata-B")
  const registry=new DesktopIdentityRegistry(),boot=registry.issue("owned-native-metadata-476")
  let complete!:()=>void,exitResolve!:(n:number)=>void,settled=false,authenticated=false,windowRequested=false,failed=false,child:DesktopNativeChild|undefined
  const done=new Promise<void>(r=>complete=r),exit=new Promise<number>(r=>exitResolve=r)
  const required=["D476_META_FIRST_SAVED","D476_META_REOPEN_OK","D476_META_ESCAPE_OK","D476_META_ENTER_OK","D476_META_BEFORE_LOST_ACK"],receipts=new Set<string>()
  let saveAttempts=0,droppedAck=false,initialSaved=false,connections=0
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
      if(typeof f.id==="string"&&f.id.startsWith("D476_FAIL_")){failed=true;complete()}
      if(required.includes(f.id)){if(receipts.has(f.id)){failed=true;complete()}receipts.add(f.id)}
    })
  })
  server.listen(0,"127.0.0.1");await once(server,"listening")
  try{
    const native=path.resolve(__dirname,"../../dist/desktop-native"),binary=path.join(native,"acceptance/metadata",process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop")
    assert.ok(fs.existsSync(binary),"the actual metadata acceptance host must be built")
    child=(require(path.join(native,"desktop-launcher.node")) as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,n=>{settled=true;exitResolve(n)})
    assert.equal(await Promise.race([exit,done.then(()=>{throw Error("OWNED_METADATA_NATIVE_PHASE_FAILED")}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("OWNED_METADATA_NATIVE_DEADLINE")),{once:true}))]),76,"only the bound native offline observer may end the successful scenario")
    assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true)
    assert.equal(initialSaved,true);assert.equal(saveAttempts,2);assert.equal(droppedAck,true);assert.equal(connections,1,"offline child must not silently reconnect/replay")
    assert.deepEqual([...receipts].sort(),[...required].sort(),"all real UI reopen/native key stages must precede socket loss")
    const disk=new ThreadManager(),saved=disk.get("native-metadata-A")!;assert.equal(saved.alias,"未确认 中文草稿");assert.deepEqual(saved.user_tags,["Review","付款"]);assert.equal(saved.topic_folder,"项目资料");assert.equal(disk.get("native-metadata-B")!.alias,"另一对话")
    process.stdout.write('DESKTOP_THREAD_METADATA_476 {"native":true,"persisted":true,"fields":3,"otherThreadUnchanged":true,"uiReopened":true,"nativeKeys":2,"lostAck":true,"offlineDraftUnconfirmed":true}\n')
  }finally{
    child?.terminate();if(child&&!settled)await exit;for(const ws of channel.wss.clients)ws.terminate();await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})
  }
})
