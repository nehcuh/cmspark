/** Merged #705/#476 dispatch uses the real channel and actors; effects remain inert/owned-FS. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { createHmac } from "node:crypto"
import { ThreadManager } from "../src/threads/thread-manager"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel } from "../src/desktop/channel"
import { SecurityConfirmationManager } from "../src/security-confirmation"
import type { LocalWorkRuntime } from "../src/desktop/local-work"

function fixture(t: any, onRetire?:()=>void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desktop-composition-705-")))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  const threads = new ThreadManager(), registry = new DesktopIdentityRegistry(), confirmations = new SecurityConfirmationManager()
  threads.create("Owned", "composition-A"); threads.create("Sibling", "composition-B")
  threads.update("composition-A", { workspace_root: root })
  const effects: string[] = []
  const local: LocalWorkRuntime = {
    modules: () => ({ terminal: true, agent: false }), activity: () => "idle", shell: () => ({ file: "/inert/shell", args: [] }), agents: () => [],
    openTerminal: () => { effects.push("open"); return { ok: true } }, terminalContext: () => true, terminalBusy: () => false,
    input: () => ({ ok: true }), resize: () => ({ ok: true }), ack: () => ({ ok: true }), ping: () => ({ ok: true }),
    close: () => { effects.push("close"); onRetire?.(); return { ok: true } },
  }
  const channel = createDesktopChannel({ registry, securityConfirmations: confirmations, services: { threads, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }, maxPayload: 10485760, localRuntime: local, workspaceRuntime: { enabled: () => true, activity: () => "idle" }, archiveActivity: () => "idle", browserPeers: () => [] })
  const { socket, sent, emit, events, cap } = socketFor(channel, registry, "composition-owned")
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)) }
  const send = async (f: any) => { emit(f); await tick(); const i = sent.findIndex(reply => reply.id === f.id && reply.type === f.type + ".result"); return i < 0 ? undefined : sent.splice(i, 1)[0] }
  t.after(() => { socket.terminate(); channel.wss.emit("close"); confirmations.rejectAll("disconnect"); if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous; fs.rmSync(root, { recursive: true, force: true }) })
  return { threads, registry, confirmations, channel, socket, effects, sent, send, emit, tick, events, cap }
}

// Real channel/registry and real HMAC; transport effects are distinct inert events.
function socketFor(channel: ReturnType<typeof createDesktopChannel>, registry: DesktopIdentityRegistry, host: string, authenticate=true) {
  const socket: any = new EventEmitter(), sent: any[] = [], events: string[] = []
  socket.readyState=1
  socket.send=(text:string)=>{const frame=JSON.parse(text);sent.push(frame);events.push("send:"+frame.type)}
  socket.close=()=>{if(socket.readyState!==1)return;events.push("close");socket.readyState=2;void Promise.resolve().then(()=>{if(socket.readyState===2){socket.readyState=3;socket.emit("close")}})}
  socket.terminate=()=>{if(socket.readyState===3)return;events.push("terminate");socket.readyState=3;socket.emit("close")}
  const emit=(frame:any)=>socket.emit("message",Buffer.from(JSON.stringify(frame)))
  channel.wss.emit("connection",socket);assert.equal(sent.shift().type,"desktop.challenge.request")
  const cap=registry.issue(host)
  emit({type:"desktop.hello",capability_id:cap.capabilityId,protocol_version:1})
  const challenge=sent.shift();assert.equal(challenge.type,"desktop.challenge")
  if(authenticate){emit({type:"desktop.authenticate",capability_id:cap.capabilityId,protocol_version:1,proof:createHmac("sha256",Buffer.from(cap.secret,"hex")).update(JSON.stringify(["cmspark.desktop.auth.v1",cap.capabilityId,challenge.connection_id,1,challenge.nonce])).digest("hex")});assert.equal(sent.shift().type,"desktop.ready")}
  events.length=0
  return {socket,sent,emit,events,cap}
}

test("same authenticated owner retains workspace/local and main archive/browser routes", async t => {
  const f = fixture(t), thread_id = "composition-A"
  const workspace = await f.send({ type: "desktop.workspace.state", id: "workspace", thread_id })
  const local = await f.send({ type: "desktop.local.state", id: "local", thread_id })
  const archive = await f.send({ type: "desktop.archive.state", id: "archive", thread_id })
  const browser = await f.send({ type: "desktop.browser.status", id: "browser" })
  assert.equal(workspace.ok, true); assert.equal(workspace.state.bound, true)
  assert.equal(local.ok, true); assert.equal(local.state.bound, true)
  assert.equal(archive.ok, true); assert.equal(archive.state.activity, "idle")
  assert.equal(browser.ok, true); assert.equal(browser.availability, "unavailable")
  assert.deepEqual(f.effects, [], "reading all four families never starts an effect")
  const saved = await f.send({ type: "desktop.archive.set", id: "archive-save", thread_id, revision: archive.state.revision, archived: true })
  assert.equal(saved.saved, true)
  assert(f.threads.desktopArchiveSnapshot().find(v => v.id === thread_id)?.archived_at)
  assert.equal(f.threads.desktopArchiveSnapshot().find(v => v.id === "composition-B")?.archived_at, undefined)
  const read = await f.send({ type: "desktop.archive.state", id: "restore-state", thread_id })
  assert.equal((await f.send({ type: "desktop.archive.set", id: "restore", thread_id, revision: read.state.revision, archived: false })).saved, true)
  assert.deepEqual(f.effects, [])
})

test("revoking the merged owner retires local confirmation and workspace picker without late authorization", async t => {
  const f = fixture(t), thread_id = "composition-A"
  const local = await f.send({ type: "desktop.local.state", id: "local", thread_id })
  f.emit({ type: "desktop.terminal.open", id: "pending-open", thread_id, revision: local.state.revision, cols: 80, rows: 24 }); await f.tick()
  const confirmation = f.sent.find(v => v.type === "desktop.confirmation.request")
  assert.equal(confirmation.purpose, "local-work"); assert.equal(f.confirmations.pendingCount(), 1)
  const workspace = await f.send({ type: "desktop.workspace.state", id: "workspace", thread_id })
  f.emit({ type: "desktop.workspace.pick", id: "pending-pick", thread_id, revision: workspace.state.revision }); await f.tick()
  const picker = f.sent.find(v => v.type === "desktop.workspace.picker.request")
  assert(picker, "actual workspace actor must own a pending selection")
  f.channel.revokeHost("composition-owned"); await f.tick()
  assert.equal(f.socket.readyState, 3); assert.equal(f.confirmations.pendingCount(), 0)
  assert(f.sent.some(v=>v.type==="desktop.close"));assert.equal(f.events.includes("terminate"),false)
  const before = f.sent.length
  f.emit({ type: "desktop.confirmation.decision", purpose: "local-work", confirmation_id: confirmation.confirmation_id, thread_id, action_digest: confirmation.action_digest, approved: true })
  f.emit({ type: "desktop.workspace.picker.result", request_id: picker.request_id, thread_id, revision: picker.revision, pick_id: picker.pick_id, outcome: "cancelled" }); await f.tick()
  assert.deepEqual(f.effects.filter(v => v === "open"), []); assert.equal(f.sent.length, before)
})

test("host revocation sends its exact final close before graceful transport close", async t=>{
 const f=fixture(t);f.channel.revokeHost("composition-owned")
 assert.deepEqual(f.events,["send:desktop.close","close"]);assert.deepEqual(f.sent,[{type:"desktop.close"}]);assert.equal(f.socket.readyState,2);await f.tick();assert.equal(f.socket.readyState,3)
 assert.equal(f.registry.challenge(f.cap.capabilityId,"replay",1),null);assert.equal(f.channel.window("composition-owned","workspace"),false)
})
test("host revocation preserves a different authenticated owner and its authority",t=>{
 const f=fixture(t),other=socketFor(f.channel,f.registry,"composition-other");t.after(()=>other.socket.terminate())
 f.channel.revokeHost("composition-owned");assert.deepEqual(f.events,["send:desktop.close","close"]);assert.deepEqual(other.events,[]);assert.equal(other.socket.readyState,1)
 assert.equal(f.channel.window("composition-other","workspace"),true);assert.deepEqual(other.sent,[{type:"desktop.window",view:"workspace"}])
})
test("pre-auth revocation remains abrupt without sending an authority-bearing final frame",t=>{
 const f=fixture(t),pending=socketFor(f.channel,f.registry,"composition-pending",false);t.after(()=>pending.socket.terminate())
 f.channel.revokeHost("composition-pending");assert.deepEqual(pending.events,["terminate"]);assert.deepEqual(pending.sent,[]);assert.equal(pending.socket.readyState,3)
 assert.equal(f.registry.challenge(pending.cap.capabilityId,"replay",1),null);assert.equal(f.socket.readyState,1);assert.equal(f.channel.window("composition-owned","workspace"),true)
})
test("direct capability revocation of an authenticated transport remains abrupt",t=>{
 const f=fixture(t);f.registry.revoke(f.cap.capabilityId);assert.deepEqual(f.events,["terminate"]);assert.deepEqual(f.sent,[]);assert.equal(f.socket.readyState,3)
 assert.equal(f.registry.challenge(f.cap.capabilityId,"replay",1),null)
})
test("graceful close failures propagate without weakening subsequent revocations",t=>{
 const f=fixture(t),failure=Error("OWNED_CLOSE_REFUSED"),close=f.socket.close
 f.socket.close=()=>{throw failure};assert.throws(()=>f.channel.revokeHost("composition-owned"),error=>error===failure);f.socket.close=close
 assert.equal(f.registry.challenge(f.cap.capabilityId,"replay",1),null)
 const pending=socketFor(f.channel,f.registry,"composition-next",false);t.after(()=>pending.socket.terminate());f.registry.revoke(pending.cap.capabilityId);assert.deepEqual(pending.events,["terminate"])
})

test("reentrant retirement cannot remove the outer owner's graceful close mark",async t=>{
 let f:ReturnType<typeof fixture>,reentered=false
 f=fixture(t,()=>{if(!reentered){reentered=true;f.channel.revokeHost("composition-owned")}})
 const local=await f.send({type:"desktop.local.state",id:"reentry-state",thread_id:"composition-A"})
 f.emit({type:"desktop.terminal.open",id:"reentry-open",thread_id:"composition-A",revision:local.state.revision,cols:80,rows:24});await f.tick()
 const confirmation=f.sent.find(v=>v.type==="desktop.confirmation.request");assert.ok(confirmation)
 f.emit({type:"desktop.confirmation.decision",purpose:"local-work",confirmation_id:confirmation.confirmation_id,thread_id:"composition-A",action_digest:confirmation.action_digest,approved:true});await f.tick()
 assert.equal(f.effects.filter(v=>v==="open").length,1);f.events.length=0
 f.channel.revokeHost("composition-owned");assert.equal(reentered,true);assert.deepEqual(f.events,["send:desktop.close","close"]);assert.equal(f.socket.readyState,2)
 await f.tick();assert.equal(f.socket.readyState,3);assert.equal(f.events.includes("terminate"),false);assert.deepEqual(f.effects,["open","close"]);assert.equal(f.registry.challenge(f.cap.capabilityId,"replay",1),null)
})
