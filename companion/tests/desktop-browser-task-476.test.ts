import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHmac } from "node:crypto"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel } from "../src/desktop/channel"
import { forwardL1OrUnavailable } from "../src/ws/l1-actuator"

function channel(t: any, extra: any = {}) {
  const registry = new DesktopIdentityRegistry(), sent: any[] = [], ws: any = new EventEmitter()
  ws.readyState = 1; ws.send = (s: string) => sent.push(JSON.parse(s)); ws.close = ws.terminate = () => { ws.readyState = 3; ws.emit("close") }
  const threads: any = { desktopMetadataSnapshot: () => [{ id: "A", alias: "A" }, { id: "B", alias: "B" }], get: (id: string) => ["A", "B"].includes(id) ? { id } : undefined, getMessages: () => [] }
  const c = createDesktopChannel({ registry, services: { threads, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }, maxPayload: 1024 * 1024, ...extra })
  c.wss.emit("connection", ws); assert.equal(sent.shift().type, "desktop.challenge.request")
  const boot = registry.issue("browser-owned-476"), send = (frame: any) => ws.emit("message", Buffer.from(JSON.stringify(frame)))
  send({ type: "desktop.hello", capability_id: boot.capabilityId, protocol_version: 1 }); const ch = sent.shift()
  send({ type: "desktop.authenticate", capability_id: boot.capabilityId, protocol_version: 1, proof: createHmac("sha256", Buffer.from(boot.secret, "hex")).update(JSON.stringify(["cmspark.desktop.auth.v1", boot.capabilityId, ch.connection_id, 1, ch.nonce])).digest("hex") })
  assert.equal(sent.shift().type, "desktop.ready"); t.after(() => { ws.close(); c.wss.emit("close") })
  return { send, sent, ws, registry }
}

test("authenticated native browser status is read-only and does not contact or launch Chrome", async t => {
  let calls = 0
  const c = channel(t, { browserPeers: () => [{ id: "peer", current: () => true, request: async () => { calls++; throw Error("must not run") } }] })
  c.send({ type: "desktop.browser.status", id: "status" })
  await new Promise(resolve => setImmediate(resolve))
  const reply = c.sent.shift(); assert.equal(reply.type, "desktop.browser.status.result"); assert.equal(reply.availability, "single_peer"); assert.equal(calls, 0)
})

test("trusted exact L1 route cannot silently choose the first extension peer", async () => {
  const origin: any = {}, first: any = { name: "wrong" }, chosen: any = { name: "selected" }; let actual: any
  const reply = await forwardL1OrUnavailable({ originatingWs: origin, getAuth: () => ({ authenticated: true, origin: "cmspark-desktop-native://local" }), pickExtensionWs: () => first, exactExtension: () => chosen, toolCallId: "call", toolName: "get_page_text", startedAt: 0, logToolFinish: () => {}, forward: async ({ ws }: any) => { actual = ws; return { success: true } } } as any)
  assert.equal(reply.success, true); assert.equal(actual, chosen)
})

import { createDesktopBrowser } from "../src/desktop/browser"
import { acquireOrRenewTabLease, peekTabLease, releaseTabLease, _resetTabLeasesForTests, forceReleaseTab, noteMutationHold, armCreatedTabHold } from "../src/orchestrator/tab-lease"
import { SecurityConfirmationManager } from "../src/security-confirmation"

function browserHarness(extra: any = {}) {
  let time = 0, owner = true, runCurrent = true, peerCurrent = true
  const calls: string[] = [], tab = { tab_id: 901, window_id: 70, navigation_key: "a".repeat(64), title: "Owned page", hostname: "example.test", active: false, focused: false }
  const peer: any = { id: "owned-peer", socket: new EventEmitter(), current: () => peerCurrent, request: async (op: string) => { calls.push(op); return op === "snapshot" ? { tabs: [{ ...tab }], truncated: false } : { ...tab, ...(op === "reveal" ? { active: true, focused: true } : {}) } } }
  const actor = createDesktopBrowser({ current: () => owner, hasThread: id => ["A", "B"].includes(id), peers: () => [peer], busy: () => false, now: () => time, ...extra })
  async function select(mode = "background") {
    const snapshot: any = await actor.handle({ type: "desktop.browser.tasks", id: "acquisition", thread_id: "A" })
    assert.equal(snapshot.ok, true)
    const choice: any = await actor.handle({ type: "desktop.browser.visibility", id: "select", thread_id: "A", context_id: snapshot.context_id, selection_id: snapshot.choices[0].selection_id, visibility: mode })
    assert.equal(choice.ok, true); return snapshot
  }
  const bind = () => actor.reserve("A")?.bind({ id: "canonical-run-A-1", current: () => runCurrent })
  return { actor, select, bind, tab, calls, peer, advance: (v: number) => { time = v }, retire: () => { owner = false }, end: () => { runCurrent = false }, peerLost: () => { peerCurrent = false } }
}

test("native selection binds once to the actual run before its absolute deadline and survives model latency", async () => {
  _resetTabLeasesForTests(); const h = browserHarness()
  try {
    await h.select(); h.actor.intent("desktop.chat.send", "A"); const run = h.bind(); assert.ok(run)
    h.advance(20000); const route = await run.route("get_page_text", { tabId: 901, __thread_id: "A" })
    assert.ok(route); assert.equal(route.peer, h.peer.socket); assert.equal(await route.finish(), true)
    assert.equal(await run.route("evaluate", { tabId: 901 }), undefined)
    assert.equal(await run.route("get_page_text", { tabId: 902 }), undefined)
    assert.equal(await run.route("get_page_text", { tabId: 901, __thread_id: "B" }), undefined)
    assert.equal(h.actor.reserve("A"), undefined); assert.equal(h.calls.includes("reveal"), false)
    run.close(); assert.equal(peekTabLease(901), null)
  } finally { h.actor.cancel(); _resetTabLeasesForTests() }
})

test("late binding, A/B/A, stale retirement and lost owner cannot reuse a selection", async () => {
  for (const kind of ["deadline", "ABA", "owner", "peer"]) {
    _resetTabLeasesForTests(); const h = browserHarness()
    try {
      await h.select(); const ticket = h.actor.reserve("A"); assert.ok(ticket)
      if (kind === "deadline") h.advance(15000)
      if (kind === "ABA") { h.actor.intent("desktop.thread.open", "B"); h.actor.intent("desktop.thread.open", "A") }
      if (kind === "owner") h.retire()
      if (kind === "peer") h.peerLost()
      assert.equal(ticket.bind({ id: "late", current: () => true }), undefined, kind)
      assert.equal(peekTabLease(901), null)
    } finally { h.actor.cancel(); _resetTabLeasesForTests() }
  }
  const h = browserHarness(); try { await h.select(); const run = h.bind(); assert.ok(run)
    await h.actor.handle({ type: "desktop.browser.retire", context_request_id: "unrelated", scope: "all" }); assert.equal(run.target(), 901)
    await h.actor.handle({ type: "desktop.browser.retire", context_request_id: "acquisition", scope: "all" }); assert.equal(run.target(), undefined)
  } finally { h.actor.cancel(); _resetTabLeasesForTests() }
})

test("preexisting soft, pending confirmation, forced, foreign and expired leases are readonly refusals", async () => {
  for (const state of ["SOFT_RESERVED", "HELD_PENDING_L2", "FORCE_RELEASING", "foreign", "expired", "mutation", "created"]) {
    _resetTabLeasesForTests()
    const lease = acquireOrRenewTabLease({ tabId: 901, holderThreadId: state === "foreign" ? "B" : "A", needsL2: ["SOFT_RESERVED", "HELD_PENDING_L2"].includes(state), confirmId: "existing-real-confirmation" })
    assert.equal(lease.ok, true); if (!lease.ok) throw Error("lease setup")
    if (state === "HELD_PENDING_L2") lease.lease.state = "HELD_PENDING_L2"
    if (state === "FORCE_RELEASING") forceReleaseTab(901, "test", { hasPending: true })
    if (state === "expired") lease.lease.idleDeadline = Date.now() - 1
    if (state === "mutation") noteMutationHold(901, "A")
    if (state === "created") armCreatedTabHold(901, "A", 1000)
    const before = JSON.stringify(lease.lease), h = browserHarness()
    try { await h.select(); assert.equal(h.bind(), undefined, state); assert.equal(peekTabLease(901), lease.lease); assert.equal(JSON.stringify(lease.lease), before, state) }
    finally { h.actor.cancel(); assert.equal(JSON.stringify(lease.lease), before, state); _resetTabLeasesForTests() }
  }
})

test("safe existing HARD lease is reused without renewal and never released by this view", async () => {
  _resetTabLeasesForTests(); const existing = acquireOrRenewTabLease({ tabId: 901, holderThreadId: "A", needsL2: false }); assert.ok(existing.ok)
  if (!existing.ok) return
  const before = JSON.stringify(existing.lease), h = browserHarness()
  try { await h.select(); const run = h.bind(); assert.ok(run); assert.equal(run.target(), 901); assert.equal(JSON.stringify(existing.lease), before); run.close(); assert.equal(peekTabLease(901), existing.lease); assert.equal(JSON.stringify(existing.lease), before) }
  finally { h.actor.cancel(); _resetTabLeasesForTests() }
})

test("new lease retirement never drops replaced, renewed, mutation, created or pending ownership", async () => {
  for (const kind of ["replace", "renew", "mutation", "created", "pending"]) {
    _resetTabLeasesForTests(); let busy = false; const h = browserHarness({ busy: () => busy })
    try { await h.select(); const run = h.bind(); assert.ok(run); const original = peekTabLease(901); assert.ok(original)
      if (kind === "replace") { releaseTabLease(901, "test", "A"); acquireOrRenewTabLease({ tabId: 901, holderThreadId: "A", needsL2: false }) }
      if (kind === "renew") (original as any).renewedAt += 1
      if (kind === "mutation") noteMutationHold(901, "A")
      if (kind === "created") armCreatedTabHold(901, "A", 1000)
      if (kind === "pending") busy = true
      const changed = peekTabLease(901), before = JSON.stringify(changed)
      assert.equal(run.target(), undefined, kind); run.close(); assert.equal(peekTabLease(901), changed, kind); assert.equal(JSON.stringify(changed), before, kind)
    } finally { h.actor.cancel(); _resetTabLeasesForTests() }
  }
})

test("actual confirmation pending is preserved rather than promoted or drained by native selection", async () => {
  _resetTabLeasesForTests(); const manager = new SecurityConfirmationManager(15000), controller = new AbortController(), notices: any[] = []
  const waiting = manager.request(v => notices.push(v), { toolName: "evaluate", workerId: "A", description: "owned test" } as any, { signal: controller.signal }, "fixed-existing-confirmation")
  const h = browserHarness({ busy: (_tab: number, id: string) => manager.hasPendingForWorker(id) })
  try { await h.select(); assert.equal(h.bind(), undefined); assert.equal(manager.hasPendingForWorker("A"), true); assert.equal(manager.getToolName("fixed-existing-confirmation"), "evaluate"); assert.equal(notices.length, 1); assert.equal(peekTabLease(901), null) }
  finally { h.actor.cancel(); controller.abort(); await waiting; _resetTabLeasesForTests() }
})

import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const companionRoot = path.resolve(__dirname, "../.."), repoRoot = path.dirname(companionRoot)
function extensionModule(name: string, chrome: any) {
  const cache = new Map<string, any>(), base = path.join(repoRoot, "chrome-extension/src/background")
  const load = (file: string): any => {
    file = file.endsWith(".ts") ? file : file + ".ts"
    if (!file.startsWith(base + path.sep)) throw Error("OWNED_EXTENSION_SOURCE_OUTSIDE")
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    const source = fs.readFileSync(file, "utf8"), result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } })
    vm.runInNewContext(result.outputText, { module: mod, exports: mod.exports, require: (id: string) => { if (!id.startsWith(".")) throw Error("OWNED_EXTENSION_IMPORT_DENIED"); return load(path.resolve(path.dirname(file), id)) }, chrome, crypto: globalThis.crypto, URL, TextEncoder, TextDecoder, performance, setTimeout, clearTimeout, console }, { filename: file, timeout: 1000 })
    return mod.exports
  }
  return load(path.join(base, name))
}
function chromeMetadata() {
  const t = { id: 901, windowId: 70, url: "https://example.test/owned?private=not-projected", title: "Owned title", active: false }
  const effects = { tabs: 0, windows: 0, query: 0 }
  let update: () => Promise<void> = async () => {}
  const observers: any = {}
  const chrome: any = { tabs: { onUpdated: {addListener: (fn: any) => { observers.updated = fn }}, onRemoved: {addListener: (fn: any) => { observers.removed = fn }}, get: async () => ({ ...t }), query: async () => { effects.query++; return [{ ...t }] }, update: async () => { effects.tabs++; await update(); t.active = true; return { ...t } } }, windows: { get: async () => ({ focused: false }), update: async () => { effects.windows++; return {} } } }
  return { chrome, t, effects, observers, defer: (fn: () => Promise<void>) => { update = fn } }
}
test("actual extension reveal retires after a pending activation and never continues to window focus", async () => {
  for (const reason of ["cancel", "connection", "reset"]) {
    const f = chromeMetadata(), api = extensionModule("desktop-browser-peer", f.chrome).createDesktopBrowserPeerHandler(); let connected = true
    const current = () => connected
    const snapshot = await api.request({ type: "desktop.browser.peer.request", id: "snapshot", op: "snapshot", remaining_ms: 15000 }, current)
    assert.equal(snapshot.ok, true); assert.equal(f.effects.tabs, 0); assert.equal(f.effects.windows, 0)
    let release!: () => void, entered!: () => void
    const atUpdate = new Promise<void>(r => { entered = r }); f.defer(() => { entered(); return new Promise<void>(r => { release = r }) })
    const pending = api.request({ type: "desktop.browser.peer.request", id: "reveal", op: "reveal", remaining_ms: 15000, tab_id: 901, window_id: 70, navigation_key: snapshot.data.tabs[0].navigation_key }, current)
    await atUpdate
    if (reason === "cancel") api.cancel({ type: "desktop.browser.peer.cancel", id: "reveal" })
    if (reason === "connection") connected = false
    if (reason === "reset") api.reset()
    release(); const result = await pending
    assert.equal(result.ok, false, reason); assert.equal(f.effects.tabs, 1, reason); assert.equal(f.effects.windows, 0, reason)
  }
})
test("actual extension metadata and wrong-context paths never activate and valid reveal is explicit", async () => {
  const f = chromeMetadata(), api = extensionModule("desktop-browser-peer", f.chrome).createDesktopBrowserPeerHandler()
  const s = await api.request({ type: "desktop.browser.peer.request", id: "s", op: "snapshot", remaining_ms: 15000 }, () => true)
  assert.equal(s.ok, true); assert(!JSON.stringify(s).includes("private="))
  const fields = { tab_id: 901, window_id: 70, navigation_key: s.data.tabs[0].navigation_key }
  for (const patch of [{ navigation_key: "b".repeat(64) }, { tab_id: 902 }, { window_id: 71 }, { extra: "deny" }]) {
    // The owned API returns the same real tab; exact request identity must reject wrong IDs.
    const result = await api.request({ type: "desktop.browser.peer.request", id: "bad", op: "reveal", remaining_ms: 15000, ...fields, ...patch }, () => true)
    assert.equal(result.ok, false); assert.equal(f.effects.tabs, 0); assert.equal(f.effects.windows, 0)
  }
  assert.equal((await api.request({ type: "desktop.browser.peer.request", id: "inspect", op: "inspect", remaining_ms: 15000, ...fields }, () => true)).ok, true)
  assert.equal(f.effects.tabs, 0); assert.equal(f.effects.windows, 0)
  await api.request({ type: "desktop.browser.peer.request", id: "reveal", op: "reveal", remaining_ms: 15000, ...fields }, () => true)
  assert.equal(f.effects.tabs, 1); assert.equal(f.effects.windows, 1)
})

const uiSource=(name:string)=>fs.readFileSync(path.join(companionRoot,name),"utf8")
function element(id:string):any{return{id,textContent:"",value:"",hidden:false,disabled:false,children:[],events:{},dataset:{},attributes:{},setAttribute(k:string,v:string){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},focus(){this.focused=true},click(){if(!this.disabled)this.events.click?.()},replaceChildren(...v:any[]){this.children=v},append(v:any){this.children.push(v)},addEventListener(k:string,f:any){this.events[k]=f}}}
function browserRenderer(){const html=uiSource("src/desktop/assets/index.html"),ids:any=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element(m[1])])),nav=["thread.list","desktop.browser.status","mcp.list","skill.list","knowledge.list"].map(page=>{const n=element(page);n.dataset.page=page;return n}),posted:any[]=[],window:any={webkit:{messageHandlers:{desktop:{postMessage:(f:any)=>posted.push(JSON.parse(JSON.stringify(f)))}}}},document:any={events:{},addEventListener(k:string,fn:any){this.events[k]=fn},getElementById:(id:string)=>ids[id],querySelectorAll:(s:string)=>s==="nav button"?nav:[],querySelector:(s:string)=>{const page=/data-page="([^"]+)"/.exec(s)?.[1];return page?nav.find(n=>n.dataset.page===page):undefined},createElement:(id:string)=>{const n=element(id);n.focus=()=>{document.activeElement=n};return n}};for(const n of [...Object.values(ids),...nav] as any[])n.focus=()=>{document.activeElement=n};ids.list.querySelectorAll=(selector:string)=>ids.list.children.flatMap((row:any)=>row.children).filter((n:any)=>n.attributes[selector.slice(1,-1)]);Object.defineProperty(ids["dialog-history"],"textContent",{get(){return this.children.map((n:any)=>n.textContent).join("\n")},set(_value){}});vm.runInNewContext(uiSource("src/desktop/assets/app.js"),{window,document},{timeout:1000});const receive=(f:any)=>window.cmsparkDesktopReceive(f);receive({type:"desktop.document",generation:"owned-doc"});const list=(rows=[{id:"A",title:"A"},{id:"B",title:"B"}])=>receive({type:"thread.list",threads:rows});const button=(target:string,attribute="data-thread-archive")=>ids.list.children.flatMap((r:any)=>r.children).find((b:any)=>b.attributes[attribute]===target);return{ids,nav,posted,receive,list,button,document,window,last:(type:string)=>posted.filter(f=>f.type===type).at(-1)}}

test("stock renderer keeps task choice explicit, escapes metadata, preserves draft and returns to the selected chat",()=>{
  const f=browserRenderer();f.list();f.button("A","data-thread-dialog").click();const opened=f.last("desktop.thread.open");f.receive({type:"desktop.thread.open.result",id:opened.id,thread_id:"A",ok:true,history:{messages:[]}});f.ids["dialog-input"].value="owned draft";
  f.nav[1].click();assert.equal(f.ids.title.textContent,"浏览器任务");assert.equal(f.last("desktop.browser.visibility"),undefined);assert.equal(f.last("desktop.browser.tasks"),undefined);
  f.ids["browser-refresh"].click();const p=f.last("desktop.browser.tasks");assert.equal(p.thread_id,"A");
  f.receive({type:"desktop.browser.tasks.result",id:p.id,thread_id:"A",ok:true,context_id:"a".repeat(32),remaining_ms:14000,truncated:false,choices:[{selection_id:"b".repeat(32),title:"<img onerror=owned>",hostname:"example.test",peer_label:"Chrome 扩展 1",association:"explicit_candidate"}],tasks:[]});
  const row=f.ids["browser-choices"].children[0];assert(row.children[0].textContent.includes("<img"));assert.equal(row.children[0].innerHTML,undefined);row.children[1].click();const choice=f.last("desktop.browser.visibility");assert.equal(choice.visibility,"background");row.children[2].events.click();assert.equal(f.posted.filter(p=>p.type==="desktop.browser.visibility").length,1);
  f.receive({type:"desktop.browser.visibility.result",id:choice.id,thread_id:"A",context_id:"a".repeat(32),ok:true,outcome:"background",policy_selected:true});assert(f.ids["browser-feedback"].textContent.includes("已确认"));assert.equal(f.last("desktop.chat.send"),undefined);
  f.ids["browser-back"].click();const back=f.last("desktop.thread.open");assert.equal(back.thread_id,"A");assert.equal(f.ids["dialog-input"].value,"owned draft");f.receive({type:"desktop.thread.open.result",id:back.id,thread_id:"A",ok:true,history:{messages:[]}});f.ids["dialog-send"].click();assert.equal(f.last("desktop.chat.send").message,"owned draft");
});
test("stock renderer rejects late A/B/A, malformed metadata, lost ACK and new-document browser selections",()=>{
  const f=browserRenderer();f.list();f.button("A","data-thread-dialog").click();f.nav[1].click();f.ids["browser-refresh"].click();const old=f.last("desktop.browser.tasks");f.nav[0].click();f.list();f.button("B","data-thread-dialog").click();f.nav[1].click();f.ids["browser-refresh"].click();const current=f.last("desktop.browser.tasks");
  const response=(p:any)=>({type:"desktop.browser.tasks.result",id:p.id,thread_id:p.thread_id,ok:true,context_id:"a".repeat(32),remaining_ms:10000,truncated:false,choices:[{selection_id:"b".repeat(32),title:"Owned",hostname:"example.test",peer_label:"Chrome 扩展 1",association:"explicit_candidate"}]});
  f.receive(response(old));assert.equal(f.ids["browser-choices"].children.length,0);f.receive({...response(current),choices:[{...response(current).choices[0],private:"MUST_NOT_RENDER"}]});assert.equal(f.ids["browser-choices"].children.length,0);assert(!f.ids["browser-feedback"].textContent.includes("MUST_NOT_RENDER"));
  f.ids["browser-refresh"].click();const next=f.last("desktop.browser.tasks");f.receive(response(next));f.ids["browser-choices"].children[0].children[2].click();const chosen=f.last("desktop.browser.visibility");f.receive({type:"desktop.offline"});f.receive({type:"desktop.document",generation:"new-owned-doc"});f.receive({type:"desktop.browser.visibility.result",id:chosen.id,thread_id:"B",context_id:"a".repeat(32),ok:true,outcome:"foreground",policy_selected:true});assert.equal(f.posted.filter(p=>p.type==="desktop.browser.visibility").length,1);assert.equal(f.ids["browser-choices"].children.length,0);assert.equal(f.ids["browser-refresh"].disabled,true);
});

test("real BrowserBridge get_page_text stays on exact background tab through CDP and scripting fallback", async () => {
  for (const fallback of [false, true]) {
    const f = chromeMetadata(), chrome = f.chrome, seen: any[] = [], noop = () => {}
    chrome.tabs.onRemoved = { addListener: noop }; chrome.tabs.create = () => { throw Error("NO_TAB_OPEN") }
    chrome.storage = { local: { get: async () => ({ enterprise_profile_id: "00000000-0000-0000-0000-000000000001" }), set: async () => {} } }
    chrome.debugger = { onDetach: { addListener: noop }, onEvent: { addListener: noop }, getTargets: async () => [{ tabId: 901, attached: false }], attach: async (target: any) => { seen.push(["attach", target.tabId]) }, sendCommand: async (target: any, method: string) => { seen.push([method, target.tabId]); if (method === "Runtime.evaluate") { if (fallback) throw Error("OWNED_CDP_UNAVAILABLE"); return { result: { value: { content: "Owned background content", url: f.t.url } } } }; return {} } }
    chrome.scripting = { executeScript: async (input: any) => { seen.push(["scripting", input.target.tabId]); return [{ result: { content: "Owned background content", url: f.t.url } }] } }
    const bridge = new (extensionModule("browser-bridge", chrome).BrowserBridge)()
    const result = await bridge.execute("get_page_text", { tabId: 901 })
    assert.equal(result.success, true); assert.equal(result.data.text, "Owned background content"); assert.equal(result.data.provenance.target.tab_id, 901)
    assert.equal(result.data.provenance.channel, fallback ? "isolated" : "cdp"); assert(seen.length > 0); assert(seen.every(x => x[1] === 901))
    assert.equal(f.effects.tabs, 0); assert.equal(f.effects.windows, 0); assert.equal(f.t.active, false)
  }
})

import { desktopBrowserPeer, handleDesktopBrowserPeerResult } from "../src/desktop/browser-peer"
test("actual peer transport binds result/cancel to exact socket and pending request identity", async () => {
  const wire: any[] = [], ws: any = new EventEmitter(); ws.readyState = 1; ws.send = (s: string) => wire.push(JSON.parse(s))
  const peer = desktopBrowserPeer(ws, () => true), signal = new AbortController()
  const promise = peer.request("snapshot", {}, signal.signal, 14000); const request = wire[0]
  assert.equal(request.remaining_ms, 14000); handleDesktopBrowserPeerResult({} as any, { type: "desktop.browser.peer.result", id: request.id, ok: true, data: "FOREIGN" })
  signal.abort(); await assert.rejects(promise, /DESKTOP_BROWSER_UNAVAILABLE/)
  assert.deepEqual(wire[1], { type: "desktop.browser.peer.cancel", id: request.id })
  handleDesktopBrowserPeerResult(ws, { type: "desktop.browser.peer.result", id: request.id, ok: true, data: "LATE" })
  const next = peer.request("inspect", {}, new AbortController().signal, 15000); handleDesktopBrowserPeerResult(ws, { type: "desktop.browser.peer.result", id: wire[2].id, ok: true, data: { owned: true } }); assert.deepEqual(await next, { owned: true })
})

import { runMultiAgentToolPregate } from "../src/orchestrator/tool-pregate"
import { forwardToolToExtension, bindToolForwardRuntime, handleToolResult, pendingToolCalls } from "../src/ws/tool-forward"
function actualExecutorFactory() {
  const file=path.join(companionRoot,"src/server.ts"),text=fs.readFileSync(file,"utf8"),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createToolExecutor")!;
  assert.ok(node);const emitted=ts.transpileModule(node.getText(ast).replace(/^export /,""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return (ctx:any)=>vm.runInNewContext(emitted+";createToolExecutor",ctx);
}
function executorContext(native: any, selected: any, dispatch: any) {
  const noop=()=>{},gate=async(x:any)=>({ok:true,finalParams:x.finalParams}),tm={get:()=>({id:"A",execution_policy:"normal"}),isToolAllowed:()=>true}
  const ctx:any={Object,Date,JSON,AbortController,securityConfirmations:new SecurityConfirmationManager(),randomUUID:()=>"owned-browser-session",mcpSessionByWs:new Map(),contextReadParams:(_n:any,p:any)=>({...p}),threadManager:tm,logger:{info:noop,warn:noop,error:noop},summarizeToolParams:()=>({}),logToolFinish:noop,runMultiAgentToolPregate,hasPendingForTab:(id:number,holder:string)=>[...pendingToolCalls.values()].some(p=>p.tabId===id&&p.thread_id===holder),toolDisplayNameZh:noop,runCookieTrustAdmission:()=>({ok:true}),runBrowserDownloadAdmission:(x:any)=>({ok:true,finalParams:x.finalParams}),runL2ToolAdmission:gate,getCachedTabUrl:noop,getDomainFromUrl:noop,computerRateLimiter:null,activeTrayConfirmsByWs:new Map(),getWsClients:()=>[],runUrlNavigateAdmission:gate,runImageFetchAdmission:async()=>null,dispatchToExtension:dispatch,isCompanionTool:()=>false,executeCompanionTool:dispatch,broadcastToClients:noop,require:(name:string)=>require(name),WebSocket:{OPEN:1},isMcpNamespaced:()=>false,isSnapshotRequest:()=>false,pickAuthenticatedClientWs:()=>{throw Error("NO_FIRST_PEER_FALLBACK")},forwardL1OrUnavailable,forwardToolToExtension,getConfigDir:()=>"owned",captureLocalPageResult:(_a:any,_b:any,_c:any,_d:any,r:any)=>r,getWsAuthState:(w:any)=>({authenticated:true,origin:w===selected?"chrome-extension://owned":"cmspark-desktop-native://local"})}
  const executor=actualExecutorFactory()(ctx)(native,{current:()=>true,browser:()=>native.browserRun,unavailable:noop});return{ctx,executor}
}
test("actual server factory → exact L1 forward → original pending-map delivery reads selected background tab",async()=>{
  _resetTabLeasesForTests();const h=browserHarness(),native:any={readyState:1,send:()=>{}},selected:any=Object.assign(new EventEmitter(),{readyState:1});let effects=0
  const f=chromeMetadata(),chrome=f.chrome,noop=()=>{};chrome.tabs.onRemoved={addListener:noop};chrome.storage={local:{get:async()=>({enterprise_profile_id:"00000000-0000-0000-0000-000000000001"})}};chrome.debugger={onDetach:{addListener:noop},onEvent:{addListener:noop},getTargets:async()=>[{tabId:901,attached:false}],attach:async()=>{},sendCommand:async(_t:any,method:string)=>method==="Runtime.evaluate"?{result:{value:{content:"Owned exact-route content",url:f.t.url}}}:{}};
  const bridge=new(extensionModule("browser-bridge",chrome).BrowserBridge)();h.peer.socket=selected;
  selected.send=(raw:string)=>{const frame=JSON.parse(raw);effects++;assert.equal(frame.type,"tool.execute");assert.equal(frame.params.tabId,901);void bridge.execute(frame.tool_name,frame.params).then((result:any)=>handleToolResult({type:"tool.result",tool_call_id:frame.tool_call_id,result},selected))};
  bindToolForwardRuntime({getTabUrlCache:()=>new Map(),refreshTabUrlCache:noop,getThreadManager:()=>undefined} as any)
  try{await h.select();native.browserRun=h.bind();assert.ok(native.browserRun);const {ctx,executor}=executorContext(native,selected,async()=>{throw Error("NO_EARLY_DISPATCH")});
    const result=await executor("exact-read","get_page_text",{tabId:901,__thread_id:"A"},new AbortController().signal);assert.equal(result.success,true);assert.equal(result.data.text,"Owned exact-route content");assert.equal(effects,1);assert.equal(pendingToolCalls.size,0);assert.equal(f.effects.tabs,0);assert.equal(f.effects.windows,0);
    assert.equal((await executor("wrong","get_page_text",{tabId:902},new AbortController().signal)).success,false);assert.equal(effects,1)
    ctx.runImageFetchAdmission=async()=>{throw Error("UNKNOWN_IMAGE_PHASE_MUST_NOT_RUN")};for(const name of["analyze_image","navigate","evaluate","list_tabs","create_tab","unknown"]){const r=await executor("deny",name,{},new AbortController().signal);assert.equal(r.success,false);assert.equal(r.error,"DESKTOP_BROWSER_OPERATION_UNAVAILABLE")};assert.equal(effects,1)
  }finally{h.actor.cancel();_resetTabLeasesForTests()}
})

import os from "node:os"
import { ThreadManager } from "../src/threads/thread-manager"
import { SkillEngine } from "../src/skills/skill-engine"
import { HistoryStore } from "../src/history/store"
import { createNativeDialogRuntime } from "../src/desktop/dialog-runtime"
import { initDataDir, saveConfig } from "../src/config"
import * as providers from "../src/llm/provider"

test("authenticated desktop selection binds at real canonical registration and persists the selected read through actual chat adapter with existing cleared-progress state", async t => {
  _resetTabLeasesForTests(); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"browser-476-owned-")),old=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
  t.after(()=>{if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});_resetTabLeasesForTests()})
  await initDataDir();saveConfig({llm:{base_url:"http://127.0.0.1:1",api_key:"owned-inert-only",model_name:"owned",temperature:0,context_window:8000}}as any)
  const manager=new ThreadManager(),thread=manager.create("Owned browser task");manager.update(thread.id,{tool_whitelist:["get_page_text"],skill_selection_mode:"manual",knowledge_selection_mode:"manual",run_progress:null});const skills=new SkillEngine();skills.bindThreadManager(manager);const history=new HistoryStore();t.after(()=>history.close())
  let clock=0; t.mock.method(performance,"now",()=>clock)
  let providerCalls=0,executorCalls=0,registered=false,browser:any;const executorNames:string[]=[]
  t.mock.method(providers,"createProvider",()=>({complete:async()=>({content:"Owned title"}),async *streamChat(){providerCalls++;if(providerCalls===1){assert.equal(registered,true,"real registration precedes model request");clock=20000;yield{type:"tool_call_delta",index:0,id:"owned-selected-read",name:"get_page_text",arguments:"{}"};yield{type:"done",finish_reason:"tool_calls"};return}yield{type:"token",text:"Owned background answer"};yield{type:"done",finish_reason:"stop"}}}))
  const tab={tab_id:901,window_id:70,navigation_key:"a".repeat(64),title:"Owned",hostname:"example.test",active:false,focused:false},ops:string[]=[],peer:any={id:"current-extension",socket:new EventEmitter(),current:()=>true,request:async(op:string)=>{ops.push(op);return op==="snapshot"?{tabs:[{...tab}],truncated:false}:{...tab}}}
  const c=channel(t,{services:{threads:manager,skills,mcp:{listServers:()=>[]}},browserPeers:()=>[peer],dialogRuntime:(owner:any)=>createNativeDialogRuntime({...owner,threads:manager,skills,history,createExecutor:(privateOwner:any)=>{browser=privateOwner.browser;return async(_id:string,name:string,params:any)=>{executorNames.push(name);if(name!=="get_page_text")return{success:false,error:"DESKTOP_BROWSER_OPERATION_UNAVAILABLE"};executorCalls++;assert.equal(params.tabId,901,"real adapter fills only canonical selected tab");const route=await privateOwner.browser()?.route(name,params);assert.ok(route);assert.equal(route.peer,peer.socket);assert.equal(await route.finish(),true);return{success:true,data:{text:"Owned body"}}}}})})
  const ui=browserRenderer();let delivered=0,posted=ui.posted.length
  const pump=async(check:()=>boolean)=>{for(let i=0;i<100;i++){for(;posted<ui.posted.length;posted++){const{generation,...frame}=ui.posted[posted];assert.equal(generation,"owned-doc");c.send(frame)}await new Promise(r=>setImmediate(r));for(;delivered<c.sent.length;delivered++)ui.receive(c.sent[delivered]);if(check())return}assert.fail("owned renderer/channel checkpoint not reached")}
  ui.list([{id:thread.id,title:"Owned browser task"}]);ui.button(thread.id,"data-thread-dialog").click();await pump(()=>!ui.ids["dialog-send"].disabled);ui.ids["dialog-input"].value="Read only the selected owned page";ui.nav[1].click();await pump(()=>ui.ids["browser-feedback"].textContent.includes("已认证"));ui.ids["browser-refresh"].click();await pump(()=>ui.ids["browser-choices"].children.length===1);ui.ids["browser-choices"].children[0].children[1].click();await pump(()=>ui.ids["browser-feedback"].textContent.includes("已确认选择"));ui.ids["browser-back"].click();await pump(()=>!ui.ids["dialog-send"].disabled)
  // Observe the actual run's synchronous registration through the real runtime getter.
  const resolveSkills=skills.resolveSkillIdsForThread.bind(skills);t.mock.method(skills,"resolveSkillIdsForThread",async(...args:any[])=>{registered=browser?.()?.target()===901;return Reflect.apply(resolveSkills,skills,args)})
  ui.ids["dialog-send"].click();const realSend=ui.last("desktop.chat.send");await pump(()=>c.sent.some((v:any)=>v.kind==="terminal"))
  t.diagnostic(JSON.stringify({providerCalls,executorCalls,registered,executorNames,rows:manager.getMessages(thread.id).map(m=>({role:m.role,tool_calls:m.tool_calls,content:m.role==="tool"?m.content:undefined}))}));assert.equal(c.sent.find((v:any)=>v.kind==="terminal")?.state,"done");assert.equal(executorCalls,1);assert.equal(ops.includes("reveal"),false);assert.equal(peekTabLease(901),null)
  const reloaded=new ThreadManager(),rows=reloaded.getMessages(thread.id);assert(rows.some(m=>m.role==="user"&&m.id===realSend.id));assert(rows.some(m=>m.role==="assistant"&&m.content.includes("Owned background answer")));assert(rows.some(m=>m.tool_calls?.some(call=>call.tool_name==="get_page_text")))
  c.send({type:"desktop.chat.send",id:realSend.id,thread_id:thread.id,message:realSend.message});await new Promise(r=>setImmediate(r));assert.equal(executorCalls,1,"lost ACK/replay never starts a second read")
})

test("peer observed same-URL reload/ABA, removal, reset and loading invalidate old navigation choices",async()=>{
  for(const kind of["reload","ABA","removed","reset","loading","pending"]){const f=chromeMetadata(),api=extensionModule("desktop-browser-peer",f.chrome).createDesktopBrowserPeerHandler();const request=(id:string,op:string,extra:any={})=>api.request({type:"desktop.browser.peer.request",id,op,remaining_ms:15000,...extra},()=>true),s=await request("s","snapshot");assert.equal(s.ok,true);const target={tab_id:901,window_id:70,navigation_key:s.data.tabs[0].navigation_key};
    if(kind==="reload")f.observers.updated(901,{status:"loading"})
    if(kind==="ABA"){f.observers.updated(901,{url:"https://example.test/other"});f.observers.updated(901,{url:f.t.url})}
    if(kind==="removed")f.observers.removed(901)
    if(kind==="reset")api.reset()
    if(kind==="loading")(f.t as any).status="loading"
    if(kind==="pending")(f.t as any).pendingUrl="https://example.test/pending"
    const result=await request("old","reveal",target);assert.equal(result.ok,false,kind);assert.equal(f.effects.tabs,0);assert.equal(f.effects.windows,0)
  }
})
test("navigation nonce eviction is bounded and cannot resurrect the oldest same-URL choice",async()=>{
  const f=chromeMetadata(),api=extensionModule("desktop-browser-peer",f.chrome).createDesktopBrowserPeerHandler();const request=(id:string,op:string,extra:any={})=>api.request({type:"desktop.browser.peer.request",id,op,remaining_ms:15000,...extra},()=>true),old=await request("s","snapshot");
  for(let i=1;i<=64;i++){f.t.id=901+i;await request("s"+i,"snapshot")}
  f.t.id=901;const result=await request("old","reveal",{tab_id:901,window_id:70,navigation_key:old.data.tabs[0].navigation_key});assert.equal(result.ok,false);assert.equal(f.effects.tabs,0);assert.equal(f.effects.windows,0)
})

test("metadata refresh during an active run preserves its identity, and latest document retirement closes it",async()=>{
  _resetTabLeasesForTests();const h=browserHarness();try{await h.select();const run=h.bind();assert.ok(run);const refreshed:any=await h.actor.handle({type:"desktop.browser.tasks",id:"new-view",thread_id:"A"});assert.equal(refreshed.ok,true);assert.equal(refreshed.tasks[0].task_id,"canonical-run-A-1");assert.equal(run.target(),901);assert.equal(h.actor.reserve("A"),undefined);await h.actor.handle({type:"desktop.browser.retire",context_request_id:"new-view",scope:"all"});assert.equal(run.target(),undefined);assert.equal(peekTabLease(901),null)}finally{h.actor.cancel();_resetTabLeasesForTests()}
})
test("native controller browser tuple guards and revoke-before-forward fences are present in full source",()=>{
  for(const language of["swift","cpp"]){const s=uiSource("src/desktop/native/DesktopHost."+language);assert(s.includes("desktop.browser.retire"));assert(s.includes("desktop.browser.tasks"));assert(s.includes("desktop.browser.visibility"));
    if(language==="swift"){const callback=s.slice(s.indexOf('socket.send(.string(text)){ error in DispatchQueue.main.async {'));assert(callback.includes('self.socket === socket,self.generation==g,self.requests[type]?.nativeId==id'));assert(callback.indexOf('if error != nil {self.offline(socket);return}')<callback.indexOf('self.transmit(outgoing,to:socket)'));assert(s.indexOf('let outgoing=out')<s.indexOf('socket.send(.string(text)){ error in DispatchQueue.main.async {'));assert(s.includes('func applicationWillTerminate(_ notification:Notification) { retireBrowser(true)'));assert(s.includes('if allowed { retireBrowser(true)'));assert(s.includes('requests.removeValue(forKey:"desktop.browser.tasks");requests.removeValue(forKey:"desktop.browser.visibility")'))}
    else{assert(s.includes('if((allBrowser||viewBrowser)&&!retire_browser(allBrowser))ExitProcess(46)'));assert(s.indexOf('if((allBrowser||viewBrowser)&&!retire_browser(allBrowser))ExitProcess(46)')<s.indexOf('frame.Remove(L"generation");put(frame,L"id",id);send(frame)'));assert(s.includes('void document(){if(!retire_browser(true))ExitProcess(46)'));assert(s.includes('requests.erase(L"desktop.browser.tasks");requests.erase(L"desktop.browser.visibility")'));assert(s.includes('browser_thread!=target'))}
  }
})
test("exact L1 missing selected peer never falls back; non-native first-extension path remains intact",async()=>{
  let first=0,dispatch=0;const base:any={originatingWs:{},getAuth:()=>({authenticated:true,origin:"cmspark-desktop-native://local"}),pickExtensionWs:()=>{first++;return{}},toolCallId:"owned",toolName:"get_page_text",startedAt:0,logToolFinish:()=>{},forward:async()=>{dispatch++;return{success:true}}};const missing=await forwardL1OrUnavailable({...base,exactExtension:()=>null});assert.equal(missing.success,false);assert.equal(first,0);assert.equal(dispatch,0);assert.equal((await forwardL1OrUnavailable(base)).success,true);assert.equal(first,1);assert.equal(dispatch,1)
})
test("native closed browser matrix retains companion/MCP gates and non-native image orchestration",async()=>{
  const native:any={readyState:1,send:()=>{}},f=executorContext(native,{},async()=>({success:true}));let phase=0,local=0,mcp=0;
  f.ctx.isCompanionTool=(name:string)=>name==="owned-local";f.ctx.executeCompanionTool=async()=>{local++;return{success:true}};assert.equal((await f.executor("local","owned-local",{})).success,true);assert.equal(local,1)
  f.ctx.isMcpNamespaced=(name:string)=>name.startsWith("mcp__");f.ctx.executeMcpTool=async()=>{mcp++;return{success:true}};assert.equal((await f.executor("mcp","mcp__owned__read",{})).success,true);assert.equal(mcp,1)
  f.ctx.runImageFetchAdmission=async()=>{phase++;return{success:true,data:{owned:true}}};assert.equal((await f.executor("image","analyze_image",{})).success,false);assert.equal(phase,0)
  const ordinary=actualExecutorFactory()(f.ctx)(native);const result=await ordinary("ordinary-image","analyze_image",{});assert.equal(result.success,true);assert.equal(phase,1)
})

test("peer cap includes cancelled unresolved Chrome calls and recovers only after they settle",async()=>{
  const f=chromeMetadata(),releases:Array<()=>void>=[];f.chrome.tabs.query=()=>new Promise<any[]>(r=>releases.push(()=>r([{...f.t}])));const api=extensionModule("desktop-browser-peer",f.chrome).createDesktopBrowserPeerHandler(),requests:Promise<any>[]=[];
  for(let i=0;i<64;i++)requests.push(api.request({type:"desktop.browser.peer.request",id:"owned-"+i,op:"snapshot",remaining_ms:15000},()=>true));assert.equal(releases.length,64);api.reset();assert.equal((await api.request({type:"desktop.browser.peer.request",id:"overflow",op:"snapshot",remaining_ms:15000},()=>true)).ok,false);assert.equal(releases.length,64);for(const release of releases)release();const ended=await Promise.all(requests);assert(ended.every(v=>v.ok===false));f.chrome.tabs.query=async()=>[{...f.t}];assert.equal((await api.request({type:"desktop.browser.peer.request",id:"recovered",op:"snapshot",remaining_ms:15000},()=>true)).ok,true)
})

test("observed reload after exact tool dispatch discards the body before canonical capture",async()=>{
  _resetTabLeasesForTests();const h=browserHarness(),f=chromeMetadata(),api=extensionModule("desktop-browser-peer",f.chrome).createDesktopBrowserPeerHandler(),selected:any=Object.assign(new EventEmitter(),{readyState:1}),native:any={readyState:1,send:()=>{}};let metadata=0,effects=0,captures=0;
  h.peer.socket=selected;h.peer.request=async(op:string,params:any,signal:AbortSignal,remaining:number)=>{const result=await api.request({type:"desktop.browser.peer.request",id:"metadata-"+(++metadata),op,remaining_ms:Math.min(15000,Math.ceil(remaining)),...params},()=>!signal.aborted);if(!result.ok)throw Error("UNAVAILABLE");return result.data};
  const noop=()=>{};bindToolForwardRuntime({getTabUrlCache:()=>new Map(),refreshTabUrlCache:noop,getThreadManager:()=>undefined} as any)
  selected.send=(raw:string)=>{const frame=JSON.parse(raw);effects++;f.observers.updated(901,{status:"loading"});handleToolResult({type:"tool.result",tool_call_id:frame.tool_call_id,result:{success:true,data:{text:"MUST_NOT_CAPTURE_STALE_BODY"}}},selected)}
  try{await h.select();native.browserRun=h.bind();assert.ok(native.browserRun);const {ctx,executor}=executorContext(native,selected,async()=>{throw Error("NO_HELPER")});ctx.captureLocalPageResult=()=>{captures++;throw Error("STALE_CAPTURE")};const result=await executor("read-reload","get_page_text",{tabId:901,__thread_id:"A"},new AbortController().signal);assert.equal(result.success,false);assert.equal(result.error,"DESKTOP_BROWSER_CONTEXT_STALE");assert(!JSON.stringify(result).includes("MUST_NOT_CAPTURE"));assert.equal(captures,0);assert.equal(effects,1);assert.equal(native.browserRun.target(),undefined);assert.equal(f.effects.tabs,0);assert.equal(f.effects.windows,0)}finally{h.actor.cancel();_resetTabLeasesForTests()}
})
test("exact peer close immediately retires a free owned run lease while an unrelated close does not",async()=>{
  _resetTabLeasesForTests();const h=browserHarness();try{await h.select();const run=h.bind();assert.ok(run);new EventEmitter().emit("close");assert.equal(run.target(),901);h.peer.socket.emit("close");assert.equal(run.target(),undefined);assert.equal(peekTabLease(901),null)}finally{h.actor.cancel();_resetTabLeasesForTests()}
})

test("actual Swift queued task retirement keeps the last daemon-known parent until guarded transmission",async()=>{
  // Lexical lowering of the frozen dispatch/retire bodies; not Swift/URLSession/native execution.
  const source=uiSource("src/desktop/native/DesktopHost.swift"),assignment='if type=="desktop.browser.tasks" {browserRequest=id;browserThread=f["thread_id"] as? String}'
  const dispatch=source.slice(source.indexOf('        var out=f;if type=="desktop.chat.stop"'),source.indexOf('\n    func deliver('))
  const early=dispatch.slice(0,dispatch.indexOf('        let outgoing=out')).includes(assignment)
  const completion=dispatch.split('socket.send(.string(text)){ error in DispatchQueue.main.async {')[1].split('\n            }}')[0]
  const immediate=dispatch.split('        } else {')[1].split('\n')[0].replace(/}\s*$/,"")
  const lower=(s:string)=>s.replace(/guard self.socket === socket,self.generation==g,self.requests\[type\]\?\.nativeId==id else\{return\}/g,'if(!(self.socket===socket&&self.generation===g&&self.requests[type]?.nativeId===id))return;')
    .replace('if error != nil {self.offline(socket);return}','if(error!==null){self.offline(socket);return}')
    .replace(/if type=="desktop.browser.tasks" \{/g,'if(type==="desktop.browser.tasks"){').replace(/f\["thread_id"\] as\? String/g,'f["thread_id"]').replace(/,to:socket/g,',socket')
  const retire=source.split('    func retireBrowser(_ all:Bool) {')[1].split('\n    }')[0]
    .replace('let parent=browserRequest','const parent=self.browserRequest').replace(/requests.removeValue\(forKey:"([^"]+)"\)/g,'delete self.requests["$1"]')
    .replace('if all {browserRequest=nil;browserThread=nil}','if(all){self.browserRequest=null;self.browserThread=null}')
    .replace('if authenticated,let parent=parent,let socket=socket {','if(authenticated&&parent!==null&&socket!==null){')
    .replace('["type":"desktop.browser.retire","context_request_id":parent,"scope":all ? "all":"view"]','{"type":"desktop.browser.retire","context_request_id":parent,"scope":all?"all":"view"}').replace(',to:socket',',socket')
  for(const schedule of["document","valid","error","generation","socket","request","immediate"]){
    const h=browserHarness();try{await h.select();let sent=0,offline=0;const socket={},self:any={browserRequest:"acquisition",browserThread:"A",socket,generation:"g",requests:{"desktop.browser.tasks":{nativeId:"queued"}}}
      const transmit=(frame:any)=>{sent++;if(frame.type==="desktop.browser.tasks")assert.equal(self.browserRequest,"queued","new parent changes at its actual send");else void h.actor.handle(frame)}
      self.transmit=transmit;self.offline=()=>{offline++;self.browserRequest=null;self.browserThread=null;h.actor.cancel()}
      const context:any={self,socket,g:"g",type:"desktop.browser.tasks",id:"queued",f:{thread_id:"A"},out:{type:"desktop.browser.tasks"},outgoing:{type:"desktop.browser.tasks"},error:schedule==="error"?{}:null,all:true,authenticated:true,transmit}
      if(early){self.browserRequest="queued";self.browserThread="A"}
      if(schedule==="document"){vm.runInNewContext(retire,context,{timeout:1000});delete self.requests["desktop.browser.tasks"]}
      if(schedule==="generation")self.generation="other"
      if(schedule==="socket")self.socket={}
      if(schedule==="request")self.requests["desktop.browser.tasks"]={nativeId:"other"}
      vm.runInNewContext(`(function(){${lower(schedule==="immediate"?immediate:completion)}})()`,context,{timeout:1000})
      if(schedule==="document"){const policy=h.actor.reserve("A");policy?.close();assert.equal(policy,undefined,"retirement must revoke the daemon-known parent when new intent was never sent");assert.equal(sent,1)}
      else if(schedule==="valid"||schedule==="immediate"){assert.equal(sent,1);assert.equal(self.browserRequest,"queued")}
      else if(schedule==="error"){assert.equal(sent,0);assert.equal(offline,1);assert.equal(self.browserRequest,null);assert.equal(h.actor.reserve("A"),undefined)}
      else{assert.equal(sent,0);assert.equal(self.browserRequest,"acquisition")}
    }finally{h.actor.cancel()}
  }
})
