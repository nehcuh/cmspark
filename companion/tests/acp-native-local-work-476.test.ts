/** Real manager; protocol/child/Mode C/discovery effects are inert owned seams. */
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AcpManager } from "../src/acp/manager"
import { initDataDir, saveConfig } from "../src/config"
import * as discovery from "../src/acp/discover"
import * as protocol from "../src/acp/protocol-session"
import * as launch from "../src/acp/win-spawn"
import * as opener from "../src/acp/open-local-terminal"

async function fixture(t: any) {
  await initDataDir()
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-acp-476-")))
  saveConfig({ acp: { enabled: true, policy: {require_workspace:true, force_confirm_session_start:true, default_profile:"review_readonly"}, servers: {
    owned: {display_name:"Owned", enabled:true, transport:"stdio", command:process.execPath, protocol:"acp", policy:{profile:"review_readonly"}},
  } }, coding_handoff:{open_local_terminal:true} })
  t.mock.method(discovery, "discoverCodingAgents", () => [])
  let hooks: any, spawned = 0, global = 0, local = 0, opened = 0, ended!: () => void
  let entered!: () => void
  const started = new Promise<void>(r => { entered = r })
  const prompt = new Promise<void>(r => { ended = r })
  const child: any = Object.assign(new EventEmitter(), {pid:12345, exitCode:null, signalCode:null})
  t.mock.method(protocol, "tryStartProtocolSession", async (opts: any) => {
    hooks=opts.hooks; spawned++; hooks.onSpawn(child); entered()
    return {child, prompt:async()=>prompt, kill:()=>{}, cancel:()=>{}}
  })
  t.mock.method(launch, "closeAcpChild", async () => {child.exitCode=0; child.emit("close",0)})
  t.mock.method(launch, "killAcpChild", () => {})
  t.mock.method(opener, "openLocalTerminalForAgent", async () => {opened++; throw new Error("unexpected Mode C")})
  const manager = new AcpManager(), controller = new AbortController()
  let current = true
  const context = {current:()=>current, signal:controller.signal, requestPermission:async()=>{local++;return true}}
  manager.permissionGate=async()=>{global++;return true}
  const opts={threadId:"owned",agentId:"owned",goal:"complete owned task",workspaceRoot:root}
  t.after(async()=>{ended(); child.emit("close",0); await manager.shutdown(); fs.rmSync(root,{recursive:true,force:true})})
  return {manager:manager as any, opts, context, controller, started, finish:()=>ended(), stale:()=>{current=false}, hooks:()=>hooks,
    counts:()=>({spawned,global,local,opened})}
}

test("native offer snapshots background-only before any event and never serializes private context",async t=>{
  const f=await fixture(t), events:any[]=[];f.manager.onNativeEvent(f.context,(e:any)=>events.push(e))
  const r=f.manager.proposeNative(f.opts,f.context);assert.equal(r.ok,true)
  assert.equal(r.session.open_local_terminal_snapshot,false);assert.equal(events[0].open_local_terminal,false)
  assert.equal(JSON.stringify(r.session).includes("requestPermission"),false)
  assert.equal(JSON.stringify(events).includes("signal"),false)
  assert.deepEqual(f.counts(),{spawned:0,global:0,local:0,opened:0})
})
test("native admission rejects stale/aborted/missing capability and refuses oversized task without clipping",async t=>{
  const f=await fixture(t)
  for(const c of [undefined,{}, {...f.context,current:()=>false}, {...f.context,requestPermission:undefined}]) assert.equal(f.manager.proposeNative(f.opts,c).ok,false)
  assert.equal(f.manager.proposeNative({...f.opts,goal:"x".repeat(8001)},f.context).ok,false)
  f.controller.abort();assert.equal(f.manager.proposeNative(f.opts,f.context).ok,false)
  assert.equal(f.counts().spawned,0)
})
test("native permission is per-session only and late approval is denied after owner changes",async t=>{
  const f=await fixture(t);let resolve!:(x:boolean)=>void
  f.context.requestPermission=()=>new Promise<boolean>(r=>{resolve=r})
  const r=f.manager.proposeNative(f.opts,f.context),run=f.manager.start(r.session.session_id);await f.started
  const permission=f.hooks().onPermission({title:"owned"});f.stale();resolve(true)
  assert.equal(await permission,"deny");f.finish();assert.equal((await run).ok,false)
  assert.equal(f.counts().global,0);assert.equal(f.counts().opened,0)
})
test("native successful permission and handback use sole sink exactly once",async t=>{
  const f=await fixture(t), saved:any[]=[];f.manager.setHandbackSink((i:any)=>saved.push(i))
  const r=f.manager.proposeNative(f.opts,f.context),run=f.manager.start(r.session.session_id);await f.started
  assert.equal(await f.hooks().onPermission({title:"owned"}),"allow")
  f.hooks().onAgentText("owned full output");f.finish();assert.equal((await run).ok,true)
  assert.equal(saved.length,1);assert.match(saved[0].handback,/owned full output/)
  assert.deepEqual(f.counts(),{spawned:1,global:0,local:1,opened:0})
})
test("native offered abort retires before startup and late start has no child",async t=>{
  const f=await fixture(t),r=f.manager.proposeNative(f.opts,f.context);f.controller.abort()
  assert.equal((await f.manager.start(r.session.session_id)).ok,false)
  assert.equal(r.session.partial,true);assert.equal(f.counts().spawned,0)
})
test("native follow-up binds parent capability and preserves full user text or refuses whole goal",async t=>{
  const f=await fixture(t),r=f.manager.proposeNative(f.opts,f.context);r.session.state="closed";r.session.handback_text="prior".repeat(1600)
  assert.equal(f.manager.followupNative({parentSessionId:r.session.session_id,goal:"tail".repeat(400)},f.context).ok,false)
  r.session.handback_text="short prior"
  assert.equal(f.manager.followupNative({parentSessionId:r.session.session_id,goal:"new exact"},{...f.context}).ok,false)
  const n=f.manager.followupNative({parentSessionId:r.session.session_id,goal:"new exact"},f.context)
  assert.equal(n.ok,true);assert.match(n.session.goal,/new exact$/);assert.equal(n.session.open_local_terminal_snapshot,false)
  assert.equal(f.manager.followup({parentSessionId:r.session.session_id,goal:"legacy bypass"}).ok,false)
})
test("legacy propose keeps Mode C and global permission gate unchanged",async t=>{
  const f=await fixture(t),r=f.manager.propose(f.opts);assert.equal(r.session.open_local_terminal_snapshot,true)
  // Turn off only the session's Mode C in this protocol-compatibility test.
  r.session.open_local_terminal_snapshot=false
  const run=f.manager.start(r.session.session_id);await f.started
  assert.equal(await f.hooks().onPermission({title:"legacy"}),"allow");f.finish();await run
  assert.equal(f.counts().global,1);assert.equal(f.counts().local,0)
})

test("native dispatch rechecks global slot after two offers",async t=>{
  const f=await fixture(t),a=f.manager.proposeNative(f.opts,f.context)
  const b=f.manager.proposeNative({...f.opts,threadId:"other"},f.context);assert.equal(b.ok,true)
  const run=f.manager.start(a.session.session_id);await f.started
  const blocked=await f.manager.start(b.session.session_id);assert.equal(blocked.ok,false);assert.match(blocked.error,/ACP_SESSION_BUSY/)
  assert.equal(f.counts().spawned,1);f.finish();await run
})
test("native prompt uses only owned live handle and late success cannot cross owner retirement",async t=>{
  const f=await fixture(t),a=f.manager.proposeNative(f.opts,f.context),session=a.session
  assert.equal((await f.manager.promptNative(session.session_id,"exact",f.context)).error,"ACP_NATIVE_FOLLOWUP_REQUIRED")
  session.state="running"
  const turns:string[]=[];let resolve!:()=>void
  const handles=(f.manager as any).protocolHandles
  handles.set(session.session_id,{prompt:(text:string)=>{turns.push(text);return new Promise<void>(r=>{resolve=r})}})
  assert.equal((await f.manager.promptNative(session.session_id,"bad",{...f.context})).ok,false)
  assert.equal((await f.manager.promptNative(session.session_id,"x".repeat(8001),f.context)).ok,false)
  const pending=f.manager.promptNative(session.session_id," exact untrimmed ",f.context)
  assert.deepEqual(turns,[" exact untrimmed "]);f.stale();resolve()
  assert.equal((await pending).ok,false);handles.clear();session.state="closed"
})
test("native startup rechecks retirement triggered by progress observers before protocol dispatch",async t=>{
  const f=await fixture(t),a=f.manager.proposeNative(f.opts,f.context)
  f.manager.onNativeEvent(f.context,(e:any)=>{if(e.state==="running")f.stale()})
  assert.equal((await f.manager.start(a.session.session_id)).ok,false);assert.equal(f.counts().spawned,0);assert.equal(a.session.state,"closed")
  assert.equal(require("node:events").getEventListeners(f.controller.signal,"abort").length,0)
})

test("native abort retains the live slot until child close and commits no late handback",async t=>{
  const f=await fixture(t),saved:any[]=[];f.manager.setHandbackSink((x:any)=>saved.push(x))
  const a=f.manager.proposeNative(f.opts,f.context),run=f.manager.start(a.session.session_id);await f.started
  f.controller.abort();assert.equal(a.session.partial,true)
  assert.equal(f.manager.propose({...f.opts,threadId:"other"}).ok,false)
  f.hooks().onAgentText("late complete output");f.finish();assert.equal((await run).ok,false)
  assert.equal(saved.length,0);assert.equal(f.manager.propose({...f.opts,threadId:"next"}).ok,true)
  assert.equal(require("node:events").getEventListeners(f.controller.signal,"abort").length,0)
})
test("native owner stale after offer retires without dispatch",async t=>{
  const f=await fixture(t),a=f.manager.proposeNative(f.opts,f.context);f.stale()
  assert.equal((await f.manager.start(a.session.session_id)).ok,false);assert.equal(f.counts().spawned,0);assert.equal(a.session.state,"closed")
})

test("native progress and control are absent from legacy manager outlets",async t=>{
 const f=await fixture(t),legacy:any[]=[];f.manager.onEvent((e:any)=>legacy.push(e))
 const a=f.manager.proposeNative(f.opts,f.context)
 assert.equal(legacy.length,0,"legacy broadcast must not receive native goal/root/output")
 assert.equal(f.manager.getSession(a.session.session_id),undefined)
 assert.equal(f.manager.listSessionsForThread(f.opts.threadId).length,0)
 assert.equal(f.manager.hasProjectThreadActivity(f.opts.threadId),true)
 assert.equal(f.manager.cancel(a.session.session_id).ok,false)
 assert.equal(f.manager.getNativeSession(a.session.session_id,{...f.context}),undefined)
 assert.equal(f.manager.getNativeSession(a.session.session_id,f.context),a.session)
 assert.equal(f.manager.cancelNative(a.session.session_id,f.context).ok,true)
})

test("native live global slot also blocks a pre-existing legacy offer",async t=>{
 const f=await fixture(t),legacy=f.manager.propose({...f.opts,threadId:"legacy-before"}),native=f.manager.proposeNative(f.opts,f.context)
 legacy.session.open_local_terminal_snapshot=false
 const n=f.manager.start(native.session.session_id);await f.started
 const l=f.manager.start(legacy.session.session_id);f.finish();await n
 assert.equal((await l).ok,false);assert.equal(f.counts().spawned,1)
})
