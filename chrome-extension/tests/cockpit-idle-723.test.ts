import test from "node:test"
import assert from "node:assert/strict"
import * as win from "../src/background/cockpit-window"
import { WSClient } from "../src/background/ws-client"
import * as mirror from "../src/background/computer-task-mirror"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as policy from "../src/background/cockpit-focus-policy"
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => { let resolve!: (x?: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve } }
function scene(holdHydration = false) {
  win._resetCockpitWindowStateForTests(); mirror._resetMirrorForTests()
  const rows = new Map<number, any>(), removed: number[] = [], listeners: Function[] = [], storage: Record<string, any> = {}
  const hydration = deferred()
  let next = 10, getGate: ReturnType<typeof deferred> | null = null, removeGate: ReturnType<typeof deferred> | null = null
  ;(globalThis as any).chrome = { runtime: { getURL: (p: string) => "chrome-extension://owned/" + p },
    storage: { session: { async get() { if (holdHydration) await hydration.promise; return { ...storage } }, async set(v: any) { Object.assign(storage, v) }, async remove(k: string) { delete storage[k] } } },
    windows: { onRemoved: { addListener(fn: Function) { listeners.push(fn) } },
      async get(id: number) { if (getGate) { const g = getGate; getGate = null; await g.promise }; if (!rows.has(id)) throw Error("GONE"); return rows.get(id) },
      async getAll() { return [...rows.values()] }, async update(id: number) { if (!rows.has(id)) throw Error("GONE"); return rows.get(id) },
      async create() { const id = next++; const row = { id, type: "popup", tabs: [{ url: "chrome-extension://owned/tabs/cockpit.html" }] }; rows.set(id, row); return row },
      async remove(id: number) { removed.push(id); if (removeGate) await removeGate.promise; rows.delete(id); listeners.forEach(fn => fn(id)) } } }
  return { rows, removed, storage, hydration, get: () => getGate = deferred(), remove: () => removeGate = deferred() }
}
function collapse(idle: () => boolean, receipt: any = { state: "IDLE", isCurrent: () => true }) {
  assert.equal(typeof (win as any).collapseCockpitIfIdle, "function", "missing authoritative idle collapse")
  return (win as any).collapseCockpitIfIdle(idle, async () => receipt)
}
test("#723 actual mirror terminal plus authoritative idle collapses exact popup once", async () => {
  const s = scene(); await win.openOrFocusCockpit()
  mirror.noteSecurityConfirmationRequest({ confirmation_id: "fixed" }); mirror.noteSecurityConfirmationGone("fixed")
  await collapse(() => mirror.getHydrateSnapshot().pendingConfirmations.length === 0)
  assert.deepEqual(s.removed, [10]); assert.equal(win.getCockpitWindowId(), null)
})
test("#723 busy unknown local pending and foreign tabs retain popup", async () => {
  for (const variant of ["BUSY", "UNKNOWN", "local-busy", "foreign", "normal", "extra", "pending"]) {
    const s = scene(); await win.openOrFocusCockpit()
    if (variant === "foreign") s.rows.get(10).tabs[0].url = "chrome-extension://other/tabs/cockpit.html"
    if (variant === "normal") s.rows.get(10).type = "normal"
    if (variant === "extra") s.rows.get(10).tabs.push({ url: "https://example.invalid" })
    if (variant === "pending") s.rows.get(10).tabs[0].pendingUrl = "https://example.invalid"
    await collapse(() => variant !== "local-busy", { state: variant === "BUSY" || variant === "UNKNOWN" ? variant : "IDLE", isCurrent: () => true })
    assert.equal(s.removed.length, 0, variant)
  }
})
test("#723 pending arrives across populated-get await and stale receipt cannot close", async () => {
  const s = scene(); await win.openOrFocusCockpit(); const g = s.get(); let idle = true
  const p = collapse(() => idle); await flush(); idle = false; g.resolve(); await p; assert.equal(s.removed.length, 0)
  await collapse(() => true, { state: "IDLE", isCurrent: () => false }); assert.equal(s.removed.length, 0)
})
test("#723 late current open waits for actual removal and never returns retiring ID", async () => {
  const s = scene(); await win.openOrFocusCockpit(); const g = s.remove(); const p = collapse(() => true); await flush()
  assert.deepEqual(s.removed, [10]); let settled = false
  const reopen = (win.openOrFocusCockpit as any)(() => true).then((id: number) => { settled = true; return id }); await flush(); assert.equal(settled, false)
  g.resolve(); await p; assert.equal(await reopen, 11); assert.equal(win.getCockpitWindowId(), 11)
})
test("#723 obsolete late focus intent does not resurrect; explicit close never aborts task", async () => {
  const s = scene(); await win.openOrFocusCockpit(); const g = s.remove(); const p = collapse(() => true); await flush()
  const reopen = (win.openOrFocusCockpit as any)(() => false); g.resolve(); await p; assert.equal(await reopen, null); assert.equal(s.rows.size, 0)
  await win.openOrFocusCockpit(); await win.closeCockpit(); assert.equal(s.rows.size, 0)
})
class Socket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3
  static all: Socket[] = []; readyState = 0; sent: any[] = []; onopen?: Function; onmessage?: Function; onclose?: Function; onerror?: Function
  constructor(_url: string) { Socket.all.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.() }
  message(data: any) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
function client() {
  Socket.all = []; (globalThis as any).WebSocket = Socket
  ;(globalThis as any).chrome = { alarms: { create() {}, clear() {} }, storage: { local: { get(_k: any, cb: Function) { cb({}) } } } }
  const c = new WSClient({ url: "ws://owned", onMessage() {}, onStateChange() {} }); c.connect(); const s = Socket.all[0]
  return { c: c as any, s, auth() { s.readyState = 1; s.message({ type: "auth.ok", protocol_version: 1 }) } }
}
test("#723 actual WS sends no preauth snapshot and returns one current closed receipt", async () => {
  const f = client(); assert.equal(typeof f.c.requestCockpitIdle, "function", "missing connection-scoped idle observation")
  assert.equal((await f.c.requestCockpitIdle()).state, "UNKNOWN"); assert.equal(f.s.sent.length, 0); f.auth()
  const p = f.c.requestCockpitIdle(); const q = await f.c.requestCockpitIdle(); assert.equal(q.state, "UNKNOWN"); assert.equal(f.s.sent.length, 1)
  f.s.message({ type: "cockpit.idle.result", id: f.s.sent[0].id, state: "IDLE" }); const r = await p; assert.equal(r.state, "IDLE"); assert.equal(r.isCurrent(), true)
  f.s.message({ type: "security.confirmation.request", confirmation_id: "late" }); assert.equal(r.isCurrent(), false)
})
test("#723 invalid matching reply and disconnect late old reply never become IDLE", async () => {
  for (const mode of ["malformed", "disconnect", "challenge", "error", "server-error"]) {
    const f = client(); f.auth(); assert.equal(typeof f.c.requestCockpitIdle, "function"); const p = f.c.requestCockpitIdle(), id = f.s.sent[0].id
    if (mode === "malformed") f.s.message({ type: "cockpit.idle.result", id, state: "IDLE", extra: true })
    if (mode === "disconnect") f.s.close()
    if (mode === "challenge") f.s.message({ type: "auth.failed" })
    if (mode === "error") f.s.onerror?.()
    if (mode === "server-error") f.s.message({ type: "error", id })
    f.s.message({ type: "cockpit.idle.result", id, state: "IDLE" }); const r = await p; assert.equal(r.state, "UNKNOWN"); assert.equal(r.isCurrent(), false)
  }
})

test("#723 old explicit close cannot remove a newer open intent after its awaited get", async () => {
  const s = scene(); await win.openOrFocusCockpit(); const gate = s.get()
  const oldClose = win.closeCockpit(); await flush()
  const newerOpen = win.openOrFocusCockpit(); await flush(); gate.resolve(); await oldClose; await newerOpen
  assert.equal(s.removed.length, 0)
})
test("#723 persisted set/remove ordering cannot erase a replacement ID", async () => {
  const s = scene(), first = deferred(); const writes: any[] = []
  const storage = (globalThis as any).chrome.storage.session
  storage.set = async (v: any) => { writes.push(v); if (writes.length === 1) await first.promise; Object.assign(s.storage, v) }
  await win.openOrFocusCockpit(); await collapse(() => true)
  await win.openOrFocusCockpit(); first.resolve(); await flush()
  assert.equal(s.storage[win.COCKPIT_SESSION_KEY], 11); assert.equal(win.getCockpitWindowId(), 11)
})
test("#723 remove rejection retains the known owner and missing receipt never dispatches remove", async () => {
  const s = scene(); await win.openOrFocusCockpit()
  ;(globalThis as any).chrome.windows.remove = async () => { throw Error("PRIVATE") }
  await collapse(() => true); assert.equal(win.getCockpitWindowId(), 10)
  const wait = deferred(); const p = (win as any).collapseCockpitIfIdle(() => true, () => wait.promise)
  await flush(); assert.equal(s.removed.length, 0)
  wait.resolve({ state: "UNKNOWN", isCurrent: () => false }); await p
})

test("#723 actual background focus block preserves late heavy versus light decisions", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/background/index.ts"), "utf8")
  const start = source.indexOf("  // Mirror for Cockpit hydrate"), end = source.indexOf("  // #432: terminal.*", start)
  assert.ok(start > 0 && end > start)
  const body = ts.transpileModule("function event(msg: any){\n" + source.slice(start, end) + "\n}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const heavy of [false, true]) {
    const s = scene(); await win.openOrFocusCockpit(); const gate = s.remove()
    const context: any = { ...mirror, ...policy, ...win, cockpitArmState: policy.DEFAULT_ARM_STATE,
      wsClient: { getState: () => "connected", requestCockpitIdle: async () => ({ state: "IDLE", isCurrent: () => true }) } }
    vm.runInNewContext(body, context)
    mirror.noteSecurityConfirmationRequest({ confirmation_id: "first" })
    context.event({ type: "security.confirmation.resolved", confirmation_id: "first" }); await flush(); assert.deepEqual(s.removed, [10])
    context.event({ type: "security.confirmation.request", confirmation_id: "late", ...(heavy ? { nonce_challenge: "FIXED" } : {}) }); await flush()
    gate.resolve(); await flush(); assert.equal(win.getCockpitWindowId(), heavy ? 11 : null)
    assert.equal(mirror.getHydrateSnapshot().pendingConfirmations.length, 1)
  }
})


test("#723 actual background keeps current nonce B when coalesced A resolves during hydrate", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/background/index.ts"), "utf8")
  const start = source.indexOf("  // Mirror for Cockpit hydrate"), end = source.indexOf("  // #432: terminal.*", start)
  assert.ok(start > 0 && end > start)
  const body = ts.transpileModule("function event(msg: any){" + source.slice(start, end) + "}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const s = scene(true), calls: Promise<number | null>[] = []
  const context: any = { ...mirror, ...policy, ...win, cockpitArmState: policy.DEFAULT_ARM_STATE,
    wsClient: { getState: () => "connected", requestCockpitIdle: async () => ({ state: "IDLE", isCurrent: () => true }) },
    openOrFocusCockpit: (allowed: () => boolean) => { const p = win.openOrFocusCockpit(allowed); calls.push(p); return p } }
  vm.runInNewContext(body, context)
  context.event({ type: "security.confirmation.request", confirmation_id: "A", nonce_challenge: "FIXED_A" }); await flush()
  context.event({ type: "security.confirmation.resolved", confirmation_id: "A" })
  context.event({ type: "security.confirmation.request", confirmation_id: "B", nonce_challenge: "FIXED_B" }); await flush()
  s.hydration.resolve(); const results = await Promise.all(calls)
  assert.deepEqual(mirror.getHydrateSnapshot().pendingConfirmations.map(p => p.confirmation_id), ["B"])
  assert.equal(s.rows.size, 1, "current B requires one original-policy cockpit")
  assert.deepEqual(results, [null, 10], "obsolete A must not borrow B's successful receipt")
})
test("#723 coalesced live predicates are not last-wins and each caller verifies its own receipt", async () => {
  for (const [aliveA, aliveB] of [[true, true], [false, false], [true, false], [false, true]]) {
    const s = scene(true); let a = true, b = true
    const first = win.openOrFocusCockpit(() => a); await flush()
    const second = win.openOrFocusCockpit(() => b); await flush(); a = aliveA; b = aliveB; s.hydration.resolve()
    const results = await Promise.all([first, second])
    assert.equal(s.rows.size, aliveA || aliveB ? 1 : 0)
    assert.deepEqual(results, [aliveA ? 10 : null, aliveB ? 10 : null])
  }
})


test("#723 retired flight serves only a later current nonce and latest close still wins", async () => {
  for (const variant of ["latest-close", "new-nonce", "two-current", "last-stale", "newer-close"]) {
    const source = fs.readFileSync(path.join(process.cwd(), "src/background/index.ts"), "utf8")
    const start = source.indexOf("  // Mirror for Cockpit hydrate"), end = source.indexOf("  // #432: terminal.*", start)
    assert.ok(start > 0 && end > start)
    const s = scene(true), calls: Promise<number | null>[] = []
    const context: any = { ...mirror, ...policy, ...win, cockpitArmState: policy.DEFAULT_ARM_STATE,
      wsClient: { getState: () => "connected", requestCockpitIdle: async () => ({ state: "IDLE", isCurrent: () => true }) },
      openOrFocusCockpit: (allowed: () => boolean) => { const p = win.openOrFocusCockpit(allowed); calls.push(p); return p } }
    vm.runInNewContext(ts.transpileModule("function event(msg:any){" + source.slice(start, end) + "}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    context.event({ type: "security.confirmation.request", confirmation_id: "A", nonce_challenge: "FIXED_A" }); await flush()
    let close: Promise<void>
    if (variant === "latest-close") {
      context.event({ type: "security.confirmation.request", confirmation_id: "B", nonce_challenge: "FIXED_B" }); await flush(); close = win.closeCockpit()
    } else {
      close = win.closeCockpit(); await flush(); context.event({ type: "security.confirmation.request", confirmation_id: "B", nonce_challenge: "FIXED_B" }); await flush()
    }
    let c: Promise<number | null> | undefined, lastClose: Promise<void> | undefined
    if (variant === "two-current" || variant === "last-stale") c = win.openOrFocusCockpit(() => variant === "two-current")
    if (variant === "newer-close") lastClose = win.closeCockpit()
    s.hydration.resolve(); await close; await lastClose; const results = await Promise.all(calls)
    const live = ["new-nonce", "two-current", "last-stale"].includes(variant)
    assert.equal(s.rows.size, live ? 1 : 0, variant)
    assert.deepEqual(results, live ? [null, 10] : [null, null], variant)
    if (c) assert.equal(await c, variant === "two-current" ? 10 : null, variant)
  }
})

test("#723 a later explicit close invalidates an open waiting for irreversible removal", async () => {
  const s = scene(); await win.openOrFocusCockpit()
  const removal = s.remove(); const closing = win.closeCockpit(); await flush()
  assert.deepEqual(s.removed, [10])
  const reopening = win.openOrFocusCockpit(() => true); await flush()
  const latestClose = win.closeCockpit(); await flush()
  removal.resolve(); await closing; await latestClose
  assert.equal(await reopening, null)
  assert.equal(s.rows.size, 0)
  assert.equal(win.getCockpitWindowId(), null)
})
