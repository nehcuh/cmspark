import { withSurface650 } from "./fixtures/native-surface-650"
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
 return withSurface650(t, async (t, surfaceLease) => {
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
 try{surfaceLease.checkpoint();const port=(server.address() as any).port;child=binding.launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${port}/desktop`,exited)
   // Authenticated bundled renderer initially refreshes all four read-only metadata families.
   await Promise.race([done,exit.then(code=>{throw Error(`Native owned child exited before metadata completion (${code}); auth=${authority}; types=${wire.join(",")}; reads=${[...methods].join(",")}`)}),new Promise<never>((_,reject)=>t.signal.addEventListener("abort",()=>reject(Error("Owned native outer test deadline")),{once:true}))])
   assert.equal(legacy.clients.size,0);assert.equal(channel.wss.clients.size,1);assert.equal(methods.size,4)
   // Ordered list replies contain arrays; native must consume them and remain owner-connected.
   const ws=[...channel.wss.clients][0];const dropped=new Promise<never>((_,reject)=>ws.once("close",code=>{if(code===1001)reject(Error(`Native disconnected before consuming valid metadata replies (${code})`))}))
   ws.send(JSON.stringify({type:"desktop.close"}));assert.equal(await Promise.race([exit,dropped]),0)
 }finally{surfaceLease.retain();child?.terminate();for(const ws of channel.wss.clients)ws.terminate();if(child)await exit;await Promise.all([new Promise<void>(r=>channel.wss.close(()=>r())),new Promise<void>(r=>legacy.close(()=>r()))]);await new Promise<void>(r=>server.close(()=>r()));surfaceLease.settled()}

 })
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
 const base={capability_id:"11".repeat(16),secret:"22".repeat(32),url:"ws://127.0.0.1:1/desktop",protocol_version:1,issued_method_set_version:8}
 const canonical=JSON.stringify(base)
 for(const body of [JSON.stringify({...base,protocol_version:true}),canonical.replace('"protocol_version":1','"protocol_version":1,"protocol_version":1'),canonical.replace('"protocol_version":1','"protocol_version":1,"\\u0070rotocol_version":1')]){const r=spawnSync(binary,[],{input:body,stdio:["pipe","ignore","ignore"],timeout:5000,env:{PATH:"/usr/bin:/bin"}});assert.equal(r.status,15)}
})

// Applicable on every OS: strict source/oracle checks only; no native executable is started.
import { acceptanceReceipt, requireWindow, requireInheritance, nativeAcceptance, ownedDirectoryIdentity, requireOwnedDirectory } from "./fixtures/desktop-480/native-acceptance-controller"
test("acceptance strict window oracle rejects every missing native condition", () => {
 const good=acceptanceReceipt("D480A_WINDOW_C_360_420_360_420_1111111")!
 requireWindow(good,"compact")
 for(let i=0;i<7;i++){const bits="1111111".split("");bits[i]="0";assert.throws(()=>requireWindow(acceptanceReceipt("D480A_WINDOW_C_360_420_360_420_"+bits.join(""))!,"compact"))}
 assert.throws(()=>requireWindow(acceptanceReceipt("D480A_WINDOW_C_359_420_360_420_1111111")!,"compact"))
 assert.throws(()=>requireWindow(good,"workspace"));assert.throws(()=>requireWindow(undefined,"compact"))
})
test("acceptance strict receipts reject raw fields, noncanonical numbers and invented stages",()=>{
 for(const value of [undefined,null,{},"D480A_AUTH_3","D480A_FRAME_DENIED\n","D480A_WINDOW_C_0360_420_360_420_1111111","D480A_WINDOW_C_360_420_360_420_11111111","D480A_WINDOW_C_9007199254740992_420_360_420_1111111","D480A_FAIL_PRIVATE_RAW_URL", "D480A_"+"x".repeat(200)])assert.equal(acceptanceReceipt(value),null)
 for(const name of ["AUTH_1","AUTH_2","FRAME_DENIED","DOCUMENT_FRESH","STALE_DENIED","FAIL_FRAME_NOT_OBSERVED"])assert.ok(acceptanceReceipt("D480A_"+name))
})
test("acceptance source variants invert byte-exact and reject missing or duplicate native seams",()=>{
 const sourceRoot=path.resolve(__dirname,"../.."),build=require(path.join(sourceRoot,"scripts/build-desktop-windows.mjs"))
 for(const [language,host,fixture] of [["swift","DesktopHost.swift","native-acceptance.swift"],["cpp","DesktopHost.cpp","native-acceptance.cpp"]]){
  const original=fs.readFileSync(path.join(sourceRoot,"src/desktop/native",host),"utf8"),controller=fs.readFileSync(path.join(sourceRoot,"tests/fixtures/desktop-480",fixture),"utf8")
  const result=build.desktopAcceptanceVariant(language,original,controller);assert.equal(result.inverse,original);assert.notEqual(result.source,original)
  assert.throws(()=>build.desktopAcceptanceVariant(language,"",controller),/ANCHOR/)
  assert.throws(()=>build.desktopAcceptanceVariant(language,original+original,controller),/ANCHOR/)
  if(language==="cpp"){
   const originalLf=original.replace(/\r\n/g,"\n"),fixtureLf=controller.replace(/\r\n/g,"\n")
   for(const hostCrLf of[false,true])for(const fixtureCrLf of[false,true]){
    const hostBytes=hostCrLf?originalLf.replace(/\n/g,"\r\n"):originalLf,fixtureBytes=fixtureCrLf?fixtureLf.replace(/\n/g,"\r\n"):fixtureLf
    const variant:{source:string;inverse:string}=build.desktopAcceptanceVariant(language,hostBytes,fixtureBytes)
    assert.equal(variant.inverse,hostBytes,"Every original LF/CRLF byte must survive the inverse")
   }
   assert.throws(()=>build.desktopAcceptanceVariant(language,original,fixtureLf.replace("// D480_IMPLEMENTATION\n","")),/FIXTURE_INVALID/)
   assert.throws(()=>build.desktopAcceptanceVariant(language,original,fixtureLf+"\n// D480_IMPLEMENTATION\r\nduplicate"),/FIXTURE_INVALID/)
  }
 }
 assert.throws(()=>build.desktopAcceptanceVariant("unknown","",""),/INVALID/)
})
for(const mode of ["visual","hostile","reconnect","relaunch"] as const)test(`actual Mac acceptance ${mode}: real owned window/engine/lifecycle`,{skip:process.platform!=="darwin",timeout:20000},t=>nativeAcceptance(t,mode))

test("acceptance strict inheritance oracle rejects checker failures and partial sentinel proof",()=>{
 const source=fs.readFileSync(path.resolve("tests/fixtures/desktop-480/windows-inheritance.c"),"utf8")
 const inspect=source.slice(source.indexOf("static napi_value fixture_inspect("),source.indexOf("static void fixture_cleanup("))
 const fields=[...inspect.matchAll(/napi_(?:get_boolean|create_uint32)\(env,(\w+),&value\);napi_set_named_property\(env,object,"([a-z_]+)",value\);/g)].map(match=>({variable:match[1],field:match[2]}))
 assert.equal(fields.length,5);assert.equal(new Set(fields.map(x=>x.field)).size,5)
 const bindings:Record<string,unknown>={fixture_sidecar_ok:true,fixture_control:4,fixture_sibling:4,fixture_control_identity:4,fixture_sibling_identity:4}
 const valid=Object.fromEntries(fields.map(({variable,field})=>{assert.ok(Object.hasOwn(bindings,variable));return[field,bindings[variable]]})) as Parameters<typeof requireInheritance>[0]
 for(const raw of [0,1,2,3,4,5,6,7])requireInheritance({...valid,sibling_mask:raw})
 for(const mask of [0,1,2,3,5,6,7,256,257])for(const field of ["control_identity_mask","sibling_identity_mask"]as const)assert.throws(()=>requireInheritance({...valid,[field]:mask}),`invalid ${field} ${mask}`)
 for(const raw of [-1,8,240,243,252,255,256,257,NaN,4.5])assert.throws(()=>requireInheritance({...valid,sibling_mask:raw}),`invalid raw ${raw}`)
 for(const field of ["control_identity_mask","sibling_identity_mask"]as const){const missing:Partial<typeof valid>={...valid};delete missing[field];assert.throws(()=>requireInheritance(missing as typeof valid),`missing ${field}`)}
 assert.throws(()=>requireInheritance({...valid,sidecar_valid:false}));assert.throws(()=>requireInheritance({...valid,control_mask:0}))
})

test("acceptance strict cleanup refuses a replaced owned directory before removing it",()=>{
 const base=fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!,"acceptance-cleanup-")),directory=path.join(base,"owned"),old=path.join(base,"original")
 fs.mkdirSync(directory);const identity=ownedDirectoryIdentity(directory);requireOwnedDirectory(directory,identity)
 try{fs.renameSync(directory,old);fs.mkdirSync(directory);assert.throws(()=>requireOwnedDirectory(directory,identity));fs.rmdirSync(directory);fs.renameSync(old,directory);requireOwnedDirectory(directory,identity)}finally{fs.rmSync(base,{recursive:true,force:true})}
})

import { nativeParentDeath } from "./fixtures/desktop-480/native-acceptance-controller"
test("actual darwin native parent watcher releases owned lock only after issuer death",{skip:process.platform!=="darwin",timeout:20000},t=>nativeParentDeath(t))


test("acceptance source fixed manifest stages no acceptance controller or executable on either OS",()=>{
 const sourceRoot=path.resolve(__dirname,"../.."),{desktopIntegrity,stageDesktop}=require(path.join(sourceRoot,"scripts/desktop-artifacts.mjs")),build=require(path.join(sourceRoot,"scripts/build-desktop-windows.mjs"))
 const root=fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!,"acceptance-stage-"))
 try{for(const platform of ["darwin","win32"]){
  const source=path.join(root,platform),dest=path.join(root,platform+"-package"),names=[platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop","desktop-launcher.node","assets/index.html","assets/app.css","assets/app.js",...(platform==="win32"?["licenses/WebView2.LICENSE.txt"]:[])]
  for(const name of [...names,"acceptance/parent/parent-exit.receipt","acceptance/hostile/cmspark-desktop","acceptance/inheritance/desktop-inheritance.node"]){const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"inert-build-only",{flag:"wx"})}
  const integrity=desktopIntegrity(source,platform);assert.deepEqual(Object.keys(integrity.files),names);fs.writeFileSync(path.join(source,"integrity.json"),JSON.stringify(integrity));stageDesktop(source,dest,platform)
  assert.equal(fs.existsSync(path.join(dest,"bin/desktop-native/acceptance")),false);assert.deepEqual(desktopIntegrity(path.join(dest,"bin/desktop-native"),platform),integrity)
 }
 const plan=build.desktopWindowsCompilePlan({cl:"cl",root:"C:\\owned",output:"C:\\out",headers:"C:\\headers",generated:"C:\\generated",sdk:"C:\\sdk",nodeLib:"C:\\node.lib"})
 assert.equal(plan.flat(2).some((part:string)=>part.includes("D480_")),false)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test("acceptance source parent watchdog cannot produce a success marker and remains test-only",()=>{
 const root=path.resolve(__dirname,"../.."),swift=fs.readFileSync(path.join(root,"tests/fixtures/desktop-480/native-acceptance.swift"),"utf8"),cpp=fs.readFileSync(path.join(root,"tests/fixtures/desktop-480/native-acceptance.cpp"),"utf8")
 const sw=swift.slice(swift.indexOf("private func d480AcceptanceSafetyWatchdog()")),cw=cpp.slice(cpp.indexOf("void D480Acceptance::safetyWatchdog()"))
 assert.match(sw,/#if D480_PARENT/);assert.match(sw,/deadline:\.now\(\)\+20/);assert.match(sw,/Darwin\._exit\(177\)/)
 assert.match(cw,/#ifdef D480_PARENT/);assert.match(cw,/steady_clock::now\(\)\+std::chrono::seconds\(20\)/);assert.match(cw,/ExitProcess\(177\)/)
 for(const body of [sw,cw])assert.doesNotMatch(body,/WriteFile\(|[^A-Za-z]write\(|parentObserved\(|ParentObserved\(/)
 for(const name of ["DesktopHost.swift","DesktopHost.cpp","launcher.c"])assert.doesNotMatch(fs.readFileSync(path.join(root,"src/desktop/native",name),"utf8"),/D480[A-Za-z_]|parent-exit\.receipt/)
})

import { fixedLine } from "./fixtures/desktop-480/native-acceptance-controller"
test("acceptance strict fixed child receipt rejects a real spawn failure",{timeout:20000},async()=>{
 const {spawn}=require("node:child_process") as typeof import("node:child_process"),directory=fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!,"acceptance-spawn-"))
 try{const child=spawn(path.join(directory,"missing-owned-executable"),[],{stdio:["ignore","pipe","pipe"],env:{}}),closed=once(child,"close").catch(()=>undefined)
  await assert.rejects(fixedLine(child,"D480_PARENT_LOCK_WAITING",AbortSignal.timeout(20000)),/OWNED_CHILD_SPAWN_FAILED/);await closed
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})

test("acceptance source receipts require the current authenticated owned response", { timeout: 10000 }, async t => {
  const { WebSocket } = require("ws") as typeof import("ws")
  const { createHmac } = require("node:crypto") as typeof import("node:crypto")
  const { observeAcceptanceResponses } = require("./fixtures/desktop-480/native-acceptance-controller") as typeof import("./fixtures/desktop-480/native-acceptance-controller")
  const { DESKTOP_NATIVE_ORIGIN } = require("../src/desktop/capabilities") as typeof import("../src/desktop/capabilities")
  const registry = new DesktopIdentityRegistry(), owned = registry.issue("owned-response-test"), foreign = registry.issue("foreign-response-test")
  const observations: string[] = [], proofs: string[] = [], sockets = new Set<import("ws").WebSocket>()
  let storeReads = 0, wokeAfterRead = false
  const services: any = { threads: {}, skills: {}, mcp: { listServers: () => { storeReads++; return [] } } }
  let observer!: ReturnType<typeof observeAcceptanceResponses>, ownedAuthentications = 0
  const channel = createDesktopChannel({ registry, services, maxPayload: 10240, onAuthenticated: host => { if (observer.authenticated(host)) ownedAuthentications++ } })
  observer = observeAcceptanceResponses(channel.wss, () => ({ host: "owned-response-test", capabilityId: owned.capabilityId }), registry, r => observations.push(r.kind === "fixed" ? r.name : "window"), value => proofs.push(value), () => { if (storeReads > 0) wokeAfterRead = true })
  const legacy = new WebSocketServer({ noServer: true }), server = http.createServer()
  attachDesktopUpgrade(server, legacy, channel.wss, () => false)
  server.listen(0, "127.0.0.1"); await once(server, "listening", { signal: t.signal })
  const endpoint = `ws://127.0.0.1:${(server.address() as any).port}/desktop`
  async function connect(boot?: { capabilityId: string; secret: string }) {
    const ws = new WebSocket(endpoint, { origin: DESKTOP_NATIVE_ORIGIN }); sockets.add(ws); ws.on("error", () => {})
    const frames: any[] = [], waiters = new Set<() => void>()
    const until = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
      const abort = () => { waiters.delete(wake); reject(t.signal.reason) }
      const wake = () => { if (predicate()) { waiters.delete(wake); t.signal.removeEventListener("abort", abort); resolve() } }
      waiters.add(wake); t.signal.addEventListener("abort", abort, { once: true }); if (t.signal.aborted) abort(); else wake()
    })
    ws.on("message", bytes => {
      const frame = JSON.parse(String(bytes)); frames.push(frame)
      if (boot && frame.type === "desktop.challenge.request") ws.send(JSON.stringify({ type: "desktop.hello", capability_id: boot.capabilityId, protocol_version: 1 }))
      if (boot && frame.type === "desktop.challenge") {
        const input = JSON.stringify(["cmspark.desktop.auth.v1", boot.capabilityId, frame.connection_id, 1, frame.nonce])
        ws.send(JSON.stringify({ type: "desktop.authenticate", capability_id: boot.capabilityId, protocol_version: 1, proof: createHmac("sha256", Buffer.from(boot.secret, "hex")).update(input).digest("hex") }))
      }
      for (const wake of waiters) wake()
    })
    await until(() => frames.some(f => f.type === (boot ? "desktop.ready" : "desktop.challenge.request")))
    return { ws, frames, until }
  }
  const ping = async (client: Awaited<ReturnType<typeof connect>>, id: string, type = "system.pong") => {
    client.ws.send(JSON.stringify({ type: "system.ping", id })); await client.until(() => client.frames.some(f => f.type === type && f.id === id))
  }
  try {
    for (const id of ["D480A_FRAME_DENIED", "D480A_WINDOW_C_640_480_640_480_1111111"]) {
      const c = await connect(), closed = once(c.ws, "close", { signal: t.signal })
      c.ws.send(JSON.stringify({ type: "system.ping", id })); await closed
      assert.equal(c.frames.some(f => f.type === "system.pong"), false)
    }
    assert.deepEqual(observations, []); assert.deepEqual(proofs, []); assert.equal(observer.currentSocket(), undefined)
    const invalid = await connect(), invalidClosed = once(invalid.ws, "close", { signal: t.signal })
    invalid.ws.send(JSON.stringify({ type: "desktop.authenticate", capability_id: owned.capabilityId, protocol_version: 1, proof: "0".repeat(64) })); await invalidClosed
    assert.deepEqual(proofs, []); assert.equal(ownedAuthentications, 0)
    const good = await connect(owned); await ping(good, "D480A_DOCUMENT_FRESH")
    assert.deepEqual(observations, ["DOCUMENT_FRESH"]); assert.equal(ownedAuthentications, 1); assert.equal(proofs.length, 1); assert.equal(String(proofs[0]).length, 64)
    // AUTH pong can precede the store read; the actual non-pong response must wake the waiter.
    good.ws.send(JSON.stringify({ type: "mcp.list", id: "owned-store-read" }))
    await good.until(() => good.frames.some(f => f.type === "mcp.list" && f.id === "owned-store-read"))
    assert.equal(storeReads, 1); assert.equal(wokeAfterRead, true)
    const firstServer = observer.currentSocket(); assert.ok(firstServer)
    const other = await connect(foreign); await ping(other, "D480A_WINDOW_C_640_480_640_480_1111111")
    assert.deepEqual(observations, ["DOCUMENT_FRESH"]); assert.equal(proofs.length, 1); assert.equal(observer.currentSocket(), firstServer)
    // Actual channel sends DENIED, never an admitted pong, for an invalid extra field.
    good.ws.send(JSON.stringify({ type: "system.ping", id: "D480A_FRAME_DENIED", extra: true }))
    await good.until(() => good.frames.some(f => f.type === "desktop.error" && f.id === "D480A_FRAME_DENIED"))
    assert.deepEqual(observations, ["DOCUMENT_FRESH"])
    const oldClosed = once(good.ws, "close", { signal: t.signal }), renewed = await connect(owned)
    await oldClosed; assert.notEqual(observer.currentSocket(), firstServer); assert.equal(ownedAuthentications, 2)
    // Actual retired production listener and the exact send wrapper cannot report late success.
    firstServer.emit("message", Buffer.from(JSON.stringify({ type: "system.ping", id: "D480A_STALE_DENIED" })))
    assert.deepEqual(observations, ["DOCUMENT_FRESH"])
    await ping(renewed, "D480A_AUTH_2"); assert.deepEqual(observations, ["DOCUMENT_FRESH", "AUTH_2"])
    const current = observer.currentSocket(); assert.ok(current); registry.revoke(owned.capabilityId)
    assert.equal(observer.currentSocket(), undefined)
    current.emit("message", Buffer.from(JSON.stringify({ type: "system.ping", id: "D480A_FRAME_DENIED" })))
    assert.deepEqual(observations, ["DOCUMENT_FRESH", "AUTH_2"])
    assert.equal(proofs.length, 2)
  } finally {
    registry.revokeAll(); for (const ws of [...sockets, ...channel.wss.clients, ...legacy.clients]) ws.terminate()
    await Promise.all([new Promise<void>(r => channel.wss.close(() => r())), new Promise<void>(r => legacy.close(() => r())), new Promise<void>(r => server.close(() => r()))])
  }
})

test("acceptance source callbacks capture the owning desktop for instrumented popup and download refusal",()=>{
 const sourceRoot=path.resolve(__dirname,"../.."),build=require(path.join(sourceRoot,"scripts/build-desktop-windows.mjs"))
 const original=fs.readFileSync(path.join(sourceRoot,"src/desktop/native/DesktopHost.cpp"),"utf8"),fixture=fs.readFileSync(path.join(sourceRoot,"tests/fixtures/desktop-480/native-acceptance.cpp"),"utf8")
 const variant:{source:string;inverse:string}=build.desktopAcceptanceVariant("cpp",original,fixture)
 assert.equal(variant.inverse,original)
 for(const [handler,argsType,refusal,receipt] of[
  ["ICoreWebView2NewWindowRequestedEventHandler","ICoreWebView2NewWindowRequestedEventArgs","put_Handled","newWindow"],
  ["ICoreWebView2DownloadStartingEventHandler","ICoreWebView2DownloadStartingEventArgs","put_Cancel","download"],
 ]){
  const before=`Callback<${handler}>([](ICoreWebView2*,${argsType}* args)->HRESULT{args->${refusal}(TRUE);return S_OK;}`
  const after=`Callback<${handler}>([this](ICoreWebView2*,${argsType}* args)->HRESULT{args->${refusal}(TRUE);D480Acceptance::${receipt}(*this);return S_OK;}`
  assert.equal(original.includes(before),true,"Shipped handler stays capture-free and refuses the action")
  assert.equal(variant.source.includes(after),true,"Only the unshipped acceptance callback captures its own Desktop")
  assert.equal(variant.source.includes(before),false,"No uninstrumented callback can satisfy acceptance")
 }
})
