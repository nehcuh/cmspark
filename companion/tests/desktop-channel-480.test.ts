import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { once } from "node:events"
import { createHmac } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { DESKTOP_NATIVE_ORIGIN } from "../src/desktop/capabilities"
import { attachWssListenThenStartMcp } from "../src/ws/lifecycle"
import { surfaceFromOrigin } from "../src/ws/handshake-surface"

async function fixture(readFault=false) {
  const registry = new DesktopIdentityRegistry()
  let purges = 0
  const services = {
    threads: {
      desktopMetadataSnapshot: () => [{ id: "owned-thread", alias: "Owned", updated_at: "2026-10-15", config_override: { forbidden: true } }],
      get: (id: string) => id === "owned-thread" ? { alias: "Owned", digest: null } : undefined,
      getMessages: () => [{ role: "user", content: "api_key=sk-ABCDEFGHIJKL12345678" }],
      purgeExpiredTrash: () => { purges++ },
    },
    skills: { list: () => [{ id: "skill", name: "Skill", description: "owned", source_file: "forbidden-path", resources: ["secret"] }],
      listKnowledge: () => [{ id: "doc", name: "Doc", description: "owned", body: "forbidden-body" }] },
    mcp: { listServers: () => {if(readFault)throw Error("owned inert metadata read fault");return [{ name: "server", connection: { status: "disconnected", pid: 123, last_error: "secret" }, config: { env: { SECRET_NAME: "secret" } } }]} },
  }
  const server = http.createServer((_q,r) => r.end("ok"))
  const legacy = new WebSocketServer({ noServer: true })
  const channel = createDesktopChannel({ registry, services, maxPayload: 10 * 1024 * 1024 })
  attachWssListenThenStartMcp({ httpServer: server, port: 0, createWss: () => legacy, onWss: () => attachDesktopUpgrade(server, legacy, channel.wss, origin => origin === "cmspark-tray://local"), startMcp: () => new Promise(() => {}) })
  legacy.on("connection", ws => ws.send("legacy-only"))
  await once(server,"listening")
  const addr=server.address() as any
  const endpoint=`ws://127.0.0.1:${addr.port}`
  const shutdown=async()=>{for(const w of [...legacy.clients,...channel.wss.clients]) w.terminate();await Promise.all([new Promise<void>(r=>legacy.close(()=>r())),new Promise<void>(r=>channel.wss.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()))}
  return {registry,channel,legacy,endpoint,shutdown,purges:()=>purges}
}
function queue(ws:WebSocket){const pending:((v:any)=>void)[]=[];const items:any[]=[];ws.on("message",b=>{const v=JSON.parse(String(b));const r=pending.shift();if(r)r(v);else items.push(v)});return()=>items.length?Promise.resolve(items.shift()):new Promise<any>(r=>pending.push(r))}
async function connect(f:Awaited<ReturnType<typeof fixture>>){const ws=new WebSocket(f.endpoint+"/desktop",{origin:DESKTOP_NATIVE_ORIGIN});const next=queue(ws);await once(ws,"open");assert.equal((await next()).type,"desktop.challenge.request");return {ws,next}}
async function auth(f:Awaited<ReturnType<typeof fixture>>){const boot=f.registry.issue("owned-host");const c=await connect(f);c.ws.send(JSON.stringify({type:"desktop.hello",capability_id:boot.capabilityId,protocol_version:1}));const ch=await c.next();const input=JSON.stringify(["cmspark.desktop.auth.v1",boot.capabilityId,ch.connection_id,1,ch.nonce]);const proof=createHmac("sha256",Buffer.from(boot.secret,"hex")).update(input).digest("hex");c.ws.send(JSON.stringify({type:"desktop.authenticate",capability_id:boot.capabilityId,protocol_version:1,proof}));assert.equal((await c.next()).type,"desktop.ready");return {...c,boot,proof}}

test("desktop native socket never enrolls in legacy WSS; exact reads project no config, names or raw bodies",{timeout:10000},async()=>{const f=await fixture();try{const c=await auth(f);assert.equal(f.legacy.clients.size,0);assert.equal(f.channel.wss.clients.size,1);for(const method of ["thread.list","mcp.list","skill.list","knowledge.list"]){c.ws.send(JSON.stringify({type:method,id:method}));const r=await c.next();assert.equal(r.id,method);const text=JSON.stringify(r);for(const bad of ["config_override","SECRET_NAME","source_file","resources","forbidden-body","pid","last_error"])assert.equal(text.includes(bad),false,bad)}assert.equal(f.purges(),0);c.ws.send(JSON.stringify({type:"thread.peek",thread_id:"owned-thread"}));assert.equal(JSON.stringify(await c.next()).includes("sk-ABCDEFGHIJKL12345678"),false)}finally{await f.shutdown()}})

test("desktop write and unrecognized fields fail without dispatch; original surface matrix unchanged",{timeout:10000},async()=>{const f=await fixture();try{const c=await auth(f);for(const frame of [{type:"mcp.add"},{type:"system.ping",surface:"tray"},{type:"thread.peek",thread_id:"absent"},{type:"desktop.close"}]){c.ws.send(JSON.stringify(frame));assert.equal((await c.next()).type,"desktop.error")}assert.equal(surfaceFromOrigin("cmspark-tray://local",undefined).ok,false);assert.equal((surfaceFromOrigin("chrome-extension://owned","tray") as any).surface,"panel");assert.equal(surfaceFromOrigin("chrome-extension://owned","summoner").ok,false)}finally{await f.shutdown()}})

test("unknown capability and pairing-shaped auth fail; duplicate JSON fields rejected",{timeout:10000},async()=>{const f=await fixture();try{for(const frame of [{type:"auth.handshake",surface:"tray",proof:"00".repeat(32)},{type:"desktop.hello",capability_id:"00".repeat(16),protocol_version:1},'{"type":"system.ping","type":"desktop.hello"}']){const c=await connect(f);const closed=once(c.ws,"close");c.ws.send(typeof frame==="string"?frame:JSON.stringify(frame));await closed}assert.equal(f.channel.wss.clients.size,0)}finally{await f.shutdown()}})

test("revocation closes actual sockets and rejects future proof; only live launcher can target window",{timeout:10000},async()=>{const f=await fixture();try{const c=await auth(f);assert.equal(f.channel.window("wrong-host","workspace"),false);assert.equal(f.channel.window("owned-host","workspace"),true);assert.deepEqual(await c.next(),{type:"desktop.window",view:"workspace"});const closed=once(c.ws,"close");f.channel.revokeHost("owned-host");await closed;assert.equal(f.registry.challenge(c.boot.capabilityId,"next",1),null)}finally{await f.shutdown()}})

test("host revocation before first auth removes issued authority and preserves a different host",{timeout:10000},async()=>{const f=await fixture();try{const first=f.registry.issue("preauth-old");const other=f.registry.issue("preauth-other");f.channel.revokeHost("preauth-old");assert.equal(f.registry.challenge(first.capabilityId,"future",1) === null,true);assert.ok(f.registry.challenge(other.capabilityId,"other",1));const c=await connect(f);c.ws.send(JSON.stringify({type:"desktop.hello",capability_id:other.capabilityId,protocol_version:1}));assert.equal((await c.next()).type,"desktop.challenge");const closed=once(c.ws,"close");f.channel.revokeHost("preauth-other");await closed;f.channel.revokeHost("preauth-old");assert.equal(f.registry.challenge(other.capabilityId,"replay",1),null)}finally{await f.shutdown()}})

test("actual metadata read failures retain request correlation for the native reply fence",{timeout:10000},async()=>{const f=await fixture(true);try{const c=await auth(f);c.ws.send(JSON.stringify({type:"mcp.list",id:"owned-read-failure"}));assert.deepEqual(await c.next(),{type:"desktop.error",error_code:"DESKTOP_READ_FAILED",id:"owned-read-failure"});assert.equal(f.purges(),0)}finally{await f.shutdown()}})
