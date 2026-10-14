/** Genuine HMAC/authenticated lifecycle→router→createToolExecutor→tool-forward
 * →actual BrowserBridge metadata producer. Chrome APIs are controlled read-only;
 * no seeded-auth flag, mirrored WS handler, native/business or human approval. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import net from "node:net"
import { fork } from "node:child_process"
import { createHmac } from "node:crypto"
import { WebSocket } from "ws"

const root=path.resolve(__dirname,"../../.."),repo=path.dirname(root)
const {loadOwnedCounterBridge}=require(path.join(root,"tests/fixtures/site-counter-533-browser.cjs"))

test("#533 actual authenticated WS owner/current target/count-only reset and preauth/schema/busy negatives", {timeout:30000}, async () => {
  const data=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-533-ws-"));fs.chmodSync(data,0o700)
  const read=loadOwnedCounterBridge(repo),sockets: WebSocket[]=[],events:any[]=[],log=path.join(data,"owned-server.log")
  const reserve=net.createServer();await new Promise<void>(r=>reserve.listen(0,"127.0.0.1",r));const port=(reserve.address() as net.AddressInfo).port;await new Promise<void>(r=>reserve.close(()=>r()));assert.notEqual(port,23401)
  const fd=fs.openSync(log,"w",0o600)
  const child=fork(path.join(root,"tests/fixtures/site-counter-533-server.cjs"),[],{execArgv:[],env:{PATH:process.env.PATH,CMSPARK_SKIP_LOGIN_ENV:"1",CMSPARK_DATA_DIR:data,CMSPARK_533_COMPILED_ROOT:path.join(root,".test-dist/src"),CMSPARK_533_PORT:String(port)},stdio:["ignore",fd,fd,"ipc"]});fs.closeSync(fd)
  const ipc=(type:string,id?:string)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{child.off("message",listener);reject(Error("OWNED_IPC_TIMEOUT"))},10000);const listener=(m:any)=>{if(m.type===type&&(!id||m.id===id)){clearTimeout(timer);child.off("message",listener);resolve(m)}};child.on("message",listener)})
  const command=async(type:string,extra:any={})=>{const id=`ipc-${events.length}-${Date.now()}`;const wait=ipc(type,id);child.send({type,id,...extra});return wait}
  const connect=(authenticated:boolean)=>new Promise<{ws:WebSocket;next:(id:string)=>Promise<any>;send:(m:any)=>Promise<any>}>(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}`,{origin:"chrome-extension://owned533"});sockets.push(ws);const replies=new Map<string,any>(),waiters=new Map<string,(m:any)=>void>()
    const next=(id:string)=>new Promise<any>((r,j)=>{if(replies.has(id)){r(replies.get(id));replies.delete(id);return}const timer=setTimeout(()=>{waiters.delete(id);j(Error("OWNED_REPLY_TIMEOUT"))},7000);waiters.set(id,m=>{clearTimeout(timer);r(m)})})
    ws.on("message",async raw=>{
      const m=JSON.parse(raw.toString())
      if(m.type==="auth.challenge") {
        if(!authenticated){resolve({ws,next,send:async payload=>{const wait=next(payload.id);ws.send(JSON.stringify(payload));return wait}});return}
        const secret=fs.readFileSync(path.join(data,"ws_secret"),"utf8").trim()
        ws.send(JSON.stringify({type:"auth.handshake",proof:createHmac("sha256",secret).update(m.nonce).digest("hex")}));return
      }
      if(m.type==="auth.ok"){resolve({ws,next,send:async payload=>{const wait=next(payload.id);ws.send(JSON.stringify(payload));return wait}});return}
      if(m.type==="tool.execute"){
        assert.equal(m.tool_name,"list_tabs");assert.equal(m.params.__site_context_require_active,true)
        const result=await read.bridge.execute(m.tool_name,m.params);read.forwardResult(m,result,{send:(payload:any)=>ws.send(JSON.stringify(payload))});return
      }
      const key=m.id || (m.type==="error" ? "owned-generic-error" : undefined)
      if(key){const fn=waiters.get(key);if(fn){waiters.delete(key);fn(m)}else replies.set(key,m)}
    })
  })
  try {
    const ready=await ipc("ready")
    const unauth=await connect(false);const closed=new Promise<void>(r=>unauth.ws.once("close",()=>r()));unauth.ws.send(JSON.stringify({type:"site.counter.status",source:"settings",id:"preauth533",thread_id:ready.thread_id,context_tab_id:7}));await closed
    assert.equal((await command("stats")).count,4);events.push({phase:"actual-preauth-rejected",count:4})
    const peer=await connect(true)
    await peer.send({type:"thread.select",id:"select533",thread_id:ready.thread_id})
    const status=await peer.send({type:"site.counter.status",source:"settings",id:"status533",thread_id:ready.thread_id,context_tab_id:7})
    assert.equal(status.type,"site.counter.state");assert.equal(status.fails,4);assert.equal(status.origin,"https://scope533.test:8443");assert.equal(status.last_code,"UNKNOWN");assert.doesNotMatch(JSON.stringify(status),/private|synthetic|#real-missing/)
    const resetRequest={type:"site.counter.reset",source:"settings",id:"reset533",thread_id:ready.thread_id,context_tab_id:7,target_key:status.target_key,user_gesture:true}
    await command("busy",{active:true});const busyReply=await peer.send(resetRequest);assert.equal(busyReply.code,"SITE_COUNTER_BUSY");assert.equal((await command("stats")).count,4);await command("busy",{active:false});events.push({phase:"actual-controller-busy-refusal",count:4})
    read.state.active=8;assert.equal((await peer.send({...resetRequest,id:"inactive533"})).code,"SITE_COUNTER_UNAVAILABLE");assert.equal((await command("stats")).count,4);read.state.active=7;events.push({phase:"actual-Bridge-inactive-tab-refusal",count:4})
    const deniedReply=peer.next("owned-generic-error");peer.ws.send(JSON.stringify({...resetRequest,id:"schema533",hostname:"foreign533.test"}));const denied=await deniedReply;assert.equal(denied.type,"error");assert.equal((await command("stats")).count,4);events.push({phase:"actual-validator-hostname-rejection",count:4})
    const other=await connect(true);await other.send({type:"thread.select",id:"other-select533",thread_id:ready.other_thread_id});assert.equal((await other.send({...resetRequest,id:"wrong-peer533"})).code,"SITE_COUNTER_STALE");events.push({phase:"actual-different-peer-selected-owner-refusal"})
    const result=await peer.send({...resetRequest,id:"reset-final533"});assert.equal(result.type,"site.counter.state");assert.equal(result.fails,0);assert.equal(result.last_code,"UNKNOWN");assert.equal(result.locator_ban,true);assert.equal(result.health,"unknown")
    const stats=await command("stats");assert.equal(stats.count,0);assert.equal(stats.other_count,1);assert.equal(stats.authenticated,2);assert.equal(read.state.effects,0)
    events.push({phase:"actual-HMAC-router-executor-Bridge-reset",count:0,other_count:1,health:"unknown",locator_preserved:true,readQueries:read.state.queries,readGets:read.state.gets,effectCalls:0})
    if(process.env.CMSPARK_533_WS_RECORDING_OUT)fs.writeFileSync(process.env.CMSPARK_533_WS_RECORDING_OUT,JSON.stringify({classification:"actual HMAC WS/lifecycle/validator/router/executor/Bridge; controlled Chrome read APIs, not native",events,status,reset:result,busy:busyReply},null,2)+"\n",{mode:0o600})
  } finally {
    for(const ws of sockets)ws.close();read.close()
    child.kill("SIGTERM");await new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{if(child.exitCode===null)child.kill("SIGKILL");resolve()},8000);child.once("exit",()=>{clearTimeout(timer);resolve()})})
    if(process.env.CMSPARK_533_WS_ARTIFACT_OUT){fs.mkdirSync(process.env.CMSPARK_533_WS_ARTIFACT_OUT,{recursive:true,mode:0o700});fs.copyFileSync(log,path.join(process.env.CMSPARK_533_WS_ARTIFACT_OUT,"owned-server.log"));fs.chmodSync(path.join(process.env.CMSPARK_533_WS_ARTIFACT_OUT,"owned-server.log"),0o600)}
    fs.rmSync(data,{recursive:true,force:true})
  }
})
