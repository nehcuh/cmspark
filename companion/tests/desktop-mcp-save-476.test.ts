/** #476 actual native-channel save path, owned disk + singleton-compatible manager.
 * All approvals are synthetic controller frames, never human/native evidence. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { once } from "node:events"
import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { DESKTOP_NATIVE_ORIGIN } from "../src/desktop/capabilities"
import { SecurityConfirmationManager } from "../src/security-confirmation"

const dataDir = mkdtempSync(path.join(tmpdir(), "cmspark-native-mcp-476-"))
const originalDir = process.env.CMSPARK_DATA_DIR
let config: typeof import("../src/config")
before(async () => { process.env.CMSPARK_DATA_DIR = dataDir; config = await import("../src/config") })
after(() => { if (originalDir === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = originalDir; rmSync(dataDir, { recursive: true, force: true }) })
const entry = () => ({ transport: "stdio" as const, command: "owned_inert_original", args: ["空 格"], cwd: dataDir, enabled: false, trust_level: "manual" as const, env: { OWNED_SECRET: "owned_private_value" } })
function queue(ws: WebSocket) { const items: any[] = [], wait: Array<(v: any) => void> = []; ws.on("message", b => { const f = JSON.parse(String(b)); const r = wait.shift(); if (r) r(f); else items.push(f) }); return () => items.length ? Promise.resolve(items.shift()) : new Promise<any>(r => wait.push(r)) }
async function fixture(empty = false, timeoutMs?: number) {
  if (empty) config.setMcpEnabled(false)
  config.replaceMcpServers(empty ? {} : { owned_existing: entry() })
  const registry = new DesktopIdentityRegistry(), manager = new SecurityConfirmationManager(timeoutMs)
  const services = { threads: { desktopMetadataSnapshot: () => [], get: (id: string) => id === "owned-thread" ? {} : undefined, getMessages: () => [] }, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }
  // Option will be production wiring to the existing manager, not an alternate queue.
  const options: any = { registry, services, maxPayload: 10 * 1024 * 1024, securityConfirmations: manager }
  const channel = createDesktopChannel(options), legacy = new WebSocketServer({ noServer: true }), server = http.createServer()
  attachDesktopUpgrade(server, legacy, channel.wss, () => false)
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/desktop`, { origin: DESKTOP_NATIVE_ORIGIN }); const next = queue(ws); await once(ws, "open"); assert.equal((await next()).type, "desktop.challenge.request")
  const boot = registry.issue("owned-native-host")
  ws.send(JSON.stringify({ type: "desktop.hello", capability_id: boot.capabilityId, protocol_version: 1 })); const ch = await next()
  const proof = createHmac("sha256", Buffer.from(boot.secret, "hex")).update(JSON.stringify(["cmspark.desktop.auth.v1", boot.capabilityId, ch.connection_id, 1, ch.nonce])).digest("hex")
  ws.send(JSON.stringify({ type: "desktop.authenticate", capability_id: boot.capabilityId, protocol_version: 1, proof })); assert.equal((await next()).type, "desktop.ready")
  return { registry, manager, ws, next, serverWs: [...channel.wss.clients][0], async close() { manager.rejectAll("disconnect"); for (const c of channel.wss.clients) c.terminate(); await Promise.all([new Promise<void>(r => channel.wss.close(() => r())), new Promise<void>(r => legacy.close(() => r()))]); await new Promise<void>(r => server.close(() => r())) } }
}

test("#476 actual native edit projects only selected stdio fields, no stored env value", { timeout: 5000 }, async () => {
  const f = await fixture(); try {
    f.ws.send(JSON.stringify({ type: "desktop.mcp.edit", id: "edit", name: "owned_existing", thread_id: null }))
    const result = await f.next(); assert.equal(result.type, "desktop.mcp.edit.result")
    assert.equal(result.config.command, "owned_inert_original"); assert.deepEqual(result.config.args, ["空 格"])
    assert.equal(JSON.stringify(result).includes("owned_private_value"), false)
    assert.equal(JSON.stringify(result).includes("OWNED_SECRET"), false)
  } finally { await f.close() }
})
test("#476 real channel save asks actual manager once and synthetic native approval writes actual disk", { timeout: 5000 }, async () => {
  const f = await fixture(); try {
    f.ws.send(JSON.stringify({ type: "desktop.mcp.save", id: "save", name: "owned_new", action: "add", thread_id: null, payload_json: JSON.stringify({ command: "owned_inert_new", args: ["中文 空格"], cwd: dataDir, enabled: false }) }))
    const request = await f.next(); assert.equal(request.type, "desktop.confirmation.request")
    assert.equal(f.manager.pendingCount(), 1); assert.equal(request.thread_id, null)
    f.ws.send(JSON.stringify({ type: "desktop.confirmation.decision", confirmation_id: request.confirmation_id, thread_id: null, action_digest: request.action_digest, approved: true }))
    let result = await f.next(); if (result.type === "desktop.confirmation.resolved") result = await f.next()
    assert.equal(result.type, "desktop.mcp.save.result"); assert.equal(result.ok, true)
    const value = config.getConfig().mcp!.servers.owned_new; assert.ok(value.transport === "stdio"); assert.deepEqual(value.args, ["中文 空格"])
    assert.equal(value.trust_level, "manual"); assert.equal(f.manager.pendingCount(), 0)
    assert.deepEqual(JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8")).mcp.servers, config.getConfig().mcp!.servers)
  } finally { await f.close() }
})
test("#476 real native denial preserves store and unrelated entries", { timeout: 5000 }, async () => {
  const f = await fixture(); try {
    const original = readFileSync(path.join(dataDir, "config.json"), "utf8")
    f.ws.send(JSON.stringify({ type: "desktop.mcp.save", id: "save", name: "owned_existing", action: "update", thread_id: "owned-thread", payload_json: JSON.stringify({ command: "owned_inert_changed", args: [], cwd: dataDir, enabled: true }) }))
    const request = await f.next(); assert.equal(request.type, "desktop.confirmation.request")
    f.ws.send(JSON.stringify({ type: "desktop.confirmation.decision", confirmation_id: request.confirmation_id, thread_id: request.thread_id, action_digest: request.action_digest, approved: false }))
    let result = await f.next(); if (result.type === "desktop.confirmation.resolved") result = await f.next()
    assert.equal(result.type, "desktop.mcp.save.result"); assert.equal(result.ok, false)
    assert.equal(readFileSync(path.join(dataDir, "config.json"), "utf8"), original)
  } finally { await f.close() }
})

const saveFrame = (name="owned_existing",action="update") => ({type:"desktop.mcp.save",id:"save",name,action,thread_id:null,payload_json:JSON.stringify({command:"owned_inert_new",args:[],cwd:dataDir,enabled:false})})
const decisionFrame = (r:any,approved=true) => ({type:"desktop.confirmation.decision",confirmation_id:r.confirmation_id,thread_id:r.thread_id,action_digest:r.action_digest,approved})
async function outcome(f:Awaited<ReturnType<typeof fixture>>) {let v=await f.next();if(v.type==="desktop.confirmation.resolved")v=await f.next();return v}
test("#476 wrong hash/thread/id and authority extras cannot settle current manager, exact native reply can",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();assert.equal(r.type,"desktop.confirmation.request")
 for(const altered of [{action_digest:"00".repeat(32)},{thread_id:"owned-thread"},{confirmation_id:"foreign"},{authority:"tray"}]){f.ws.send(JSON.stringify({...decisionFrame(r),...altered}));f.ws.send(JSON.stringify({type:"system.ping",id:"barrier"}));assert.equal((await f.next()).type,"system.pong");assert.equal(f.manager.pendingCount(),1)}
 f.ws.send(JSON.stringify(decisionFrame(r)));assert.equal((await outcome(f)).ok,true);assert.equal(f.manager.pendingCount(),0)
 }finally{await f.close()}
})
test("#476 duplicate decoded payload keys, prototype and extra fields rejected without confirmation",{timeout:5000},async()=>{
 const f=await fixture();try{for(const raw of ['{"command":"first","command":"second","args":[],"enabled":false}','{"command":"first","\\u0063ommand":"second","args":[],"enabled":false}','{"command":"x","args":[],"enabled":false,"__proto__":{}}','{"command":"x","args":[1],"enabled":false}','{"command":"x","args":[],"enabled":false,"trust_level":"trusted"}']){f.ws.send(JSON.stringify({...saveFrame(),payload_json:raw}));const v=await f.next();assert.equal(v.ok,false);assert.equal(f.manager.pendingCount(),0)}}finally{await f.close()}
})
test("#476 actual target observable ABA aborts old prompt; no stale target restoration",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();assert.equal(r.type,"desktop.confirmation.request");const before=config.getConfig().mcp!.servers
 config.replaceMcpServers({...before,owned_existing:{...entry(),enabled:true}});config.replaceMcpServers(before)
 const v=await outcome(f);assert.equal(v.ok,false);assert.equal(f.manager.pendingCount(),0);f.ws.send(JSON.stringify(decisionFrame(r)));assert.deepEqual(config.getConfig().mcp!.servers,before)
 }finally{await f.close()}
})
test("#476 unrelated sibling current-map mutation survives an approved update",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();config.replaceMcpServers({...config.getConfig().mcp!.servers,sibling:entry()});assert.equal(f.manager.pendingCount(),1);f.ws.send(JSON.stringify(decisionFrame(r)));assert.equal((await outcome(f)).ok,true);assert.ok(config.getConfig().mcp!.servers.sibling);const own=config.getConfig().mcp!.servers.owned_existing;assert.equal((own as any).env.OWNED_SECRET,"owned_private_value");assert.equal((own as any).trust_level,"manual")
 }finally{await f.close()}
})
test("#476 first add freezes empty/global-enable premise and will not activate a later sibling",{timeout:5000},async()=>{
 const f=await fixture(true);try{f.ws.send(JSON.stringify(saveFrame("owned_new","add")));const r=await f.next();assert.equal(JSON.parse(r.action_json).enable_global,true);config.replaceMcpServers({sibling:entry()});const v=await outcome(f);assert.equal(v.ok,false);assert.equal(config.getConfig().mcp!.enabled,false);assert.equal(config.getConfig().mcp!.servers.owned_new,undefined)
 }finally{await f.close()}
})
test("#476 first add atomically enables the confirmed empty map and keeps global flag exact",{timeout:5000},async()=>{
 const f=await fixture(true);try{f.ws.send(JSON.stringify(saveFrame("owned_new","add")));const r=await f.next();f.ws.send(JSON.stringify(decisionFrame(r)));assert.equal((await outcome(f)).ok,true);const disk=JSON.parse(readFileSync(path.join(dataDir,"config.json"),"utf8"));assert.equal(disk.mcp.enabled,true);assert.equal(Object.keys(disk.mcp.servers).join(),"owned_new")
 }finally{await f.close()}
})
test("#476 approval then same-turn revoke rejects commit and disconnect retires pending",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const request=await f.next();const before=readFileSync(path.join(dataDir,"config.json"),"utf8");const original=f.manager.respondFrom.bind(f.manager);f.manager.respondFrom=(...args:Parameters<typeof original>)=>{const result=original(...args);f.registry.revokeHost("owned-native-host");return result};const closed=once(f.ws,"close");const r=[...(f.manager as any).pending.keys()][0];const frame={type:"desktop.confirmation.decision",confirmation_id:r,thread_id:null,action_digest:require("node:crypto").createHash("sha256").update(JSON.stringify({})).digest("hex"),approved:true};/* use exact request digest retained below */f.ws.send(JSON.stringify({...frame,action_digest:request.action_digest}));await closed;await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(readFileSync(path.join(dataDir,"config.json"),"utf8"),before);assert.equal(f.manager.pendingCount(),0)
 }finally{await f.close()}
})
test("#476 actual singleton expiry denies without write; late reply never revives",{timeout:5000},async()=>{
 const f=await fixture(false,20);try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();const before=readFileSync(path.join(dataDir,"config.json"),"utf8");assert.equal((await outcome(f)).ok,false);f.ws.send(JSON.stringify(decisionFrame(r)));f.ws.send(JSON.stringify({type:"system.ping"}));assert.equal((await f.next()).type,"system.pong");assert.equal(f.manager.pendingCount(),0);assert.equal(readFileSync(path.join(dataDir,"config.json"),"utf8"),before)
 }finally{await f.close()}
})
test("#476 no-op update still requires one confirmation, concurrent save remains bounded",{timeout:5000},async()=>{
 const f=await fixture();try{const value=entry();f.ws.send(JSON.stringify({...saveFrame(),payload_json:JSON.stringify({command:value.command,args:value.args,cwd:value.cwd,enabled:value.enabled})}));const r=await f.next();assert.equal(r.type,"desktop.confirmation.request");const action=JSON.parse(r.action_json);assert.equal(action.server.env.OWNED_SECRET,"owned_private_value");assert.equal(r.action_digest,require("node:crypto").createHash("sha256").update(r.action_json).digest("hex"));f.ws.send(JSON.stringify({...saveFrame(),id:"second"}));const busy=await f.next();assert.equal(busy.error_code,"DESKTOP_MCP_BUSY");assert.equal(f.manager.pendingCount(),1);f.ws.send(JSON.stringify(decisionFrame(r)));assert.equal((await outcome(f)).ok,true)
 }finally{await f.close()}
})
test("#476 invalid context/stdio target and extra wire authority fail before manager",{timeout:5000},async()=>{
 const f=await fixture();try{for(const patch of [{thread_id:undefined},{thread_id:"missing"},{thread_id:""},{surface:"tray"},{action:"remove"},{name:"bad/name"}]){f.ws.send(JSON.stringify({...saveFrame(),...patch}));const v=await f.next();assert.equal(v.ok,false);assert.equal(f.manager.pendingCount(),0)}}finally{await f.close()}
})
test("#476 actual disconnect aborts own pending manager and leaves stored action unchanged",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));await f.next();const before=readFileSync(path.join(dataDir,"config.json"),"utf8");const serverClosed=once(f.serverWs,"close"),clientClosed=once(f.ws,"close");f.ws.close();await Promise.all([serverClosed,clientClosed]);assert.equal(f.manager.pendingCount(),0);assert.equal(readFileSync(path.join(dataDir,"config.json"),"utf8"),before)}finally{await f.close()}
})
test("#476 actual persistence exception never produces saved ACK or mutates cached target",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();const before=readFileSync(path.join(dataDir,"config.json"),"utf8");const file=path.join(dataDir,`config.json.tmp-${process.pid}`);require("node:fs").mkdirSync(file);try{f.ws.send(JSON.stringify(decisionFrame(r)));const v=await outcome(f);assert.equal(v.ok,false);assert.equal(v.saved,undefined);assert.equal(readFileSync(path.join(dataDir,"config.json"),"utf8"),before);assert.equal((config.getConfig().mcp!.servers.owned_existing as any).command,"owned_inert_original")}finally{require("node:fs").rmSync(file,{recursive:true,force:true})}}finally{await f.close()}
})
test("#476 privileged legacy manager respond cannot substitute a private controller receipt",{timeout:5000},async()=>{
 const f=await fixture();try{f.ws.send(JSON.stringify(saveFrame()));const r=await f.next();const before=readFileSync(path.join(dataDir,"config.json"),"utf8");assert.equal(f.manager.respond(r.confirmation_id,true),true);assert.equal((await outcome(f)).ok,false);assert.equal(readFileSync(path.join(dataDir,"config.json"),"utf8"),before)}finally{await f.close()}
})
