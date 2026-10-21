import test from "node:test"
import assert from "node:assert/strict"
import { setImmediate } from "node:timers"
import { createCockpitNativeRelay, COCKPIT_NATIVE_PORT } from "../src/background/cockpit-native-bridge"
import { _resetCockpitWindowStateForTests, openOrFocusCockpit } from "../src/background/cockpit-window"

// Declared Chrome boundary models. No browser, native API or OS window runs here.
function fixture() {
  const previous = (globalThis as any).chrome
  const id = "a".repeat(32), url = `chrome-extension://${id}/tabs/cockpit.html`
  const w = { id: 7, type: "popup", tabs: [{ id: 9, windowId: 7, url }] }
  let contextLive = true, connectionLive = true
  let create: () => Promise<any> = async () => w
  ;(globalThis as any).chrome = {
    runtime: { id, getURL: (p: string) => `chrome-extension://${id}/${p}`, getContexts: async () => contextLive ?
      [{ documentId: "owned-document", tabId: 9, windowId: 7, documentUrl: url }] : [] },
    windows: { getAll: async () => [], get: async () => w, create: () => create(), update: async () => w,
      onRemoved: { addListener() {} } },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  }
  _resetCockpitWindowStateForTests()
  const frames: any[] = [], posted: any[] = [], listeners: ((v: any) => void)[] = [], closed: (() => void)[] = []
  let disconnected = false
  const port = { name: COCKPIT_NATIVE_PORT, sender: { id, url, documentId: "owned-document", tab: { id: 9, windowId: 7 } },
    onMessage: { addListener(fn: (v: any) => void) { listeners.push(fn) } },
    onDisconnect: { addListener(fn: () => void) { closed.push(fn) } }, postMessage(v: any) { posted.push(v) },
    disconnect() { if (!disconnected) { disconnected = true; for (const fn of closed) fn() } } } as unknown as chrome.runtime.Port
  const relay = createCockpitNativeRelay(() => ({ current: () => connectionLive, send: v => { frames.push(v); return connectionLive } }))
  return { relay, port, frames, posted, setCreate(fn: () => Promise<any>) { create = fn }, window: w,
    contextLost() { contextLive = false }, connectionLost() { connectionLive = false },
    emit(v: any) { for (const fn of listeners) fn(v) }, disconnected: () => disconnected,
    restore() { relay.disconnect(); _resetCockpitWindowStateForTests(); (globalThis as any).chrome = previous } }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve))
function nativeReply(f: ReturnType<typeof fixture>) {
  const hello = f.frames[0]
  f.relay.receive({ ...hello, type: "cockpit.bridge.challenge", challenge: "b".repeat(64) })
  assert.equal(f.posted[0].op, "bind")
  // Response shape derives from the actual emitted bind plus the declared new
  // native contract. This is transport DI, not an observed C# native result.
  return { ...f.posted[0], op: "bound", portNonce: "c".repeat(32), hwndDecimal: "77", tagValue: "99", pid: 7, tid: 8 }
}
test("723 native relay preserves actual hello/challenge/document transport and once-only result", async () => {
  const f = fixture()
  try {
    await openOrFocusCockpit(); await f.relay.attach(f.port)
    const reply = nativeReply(f); f.emit(reply); f.emit(reply); await turn(); f.emit(reply); await turn()
    assert.equal(f.frames.filter(v => v.type === "cockpit.bridge.bound").length, 1)
    assert.equal(f.frames[1].documentId, "owned-document")
    assert.equal(f.frames[1].op, undefined)
  } finally { f.restore() }
})
test("723 native relay joins an already-running real open producer before claiming its document", async () => {
  const f = fixture()
  try {
    let finish!: (v: any) => void, entered!: () => void
    const waiting = new Promise<void>(resolve => entered = resolve)
    f.setCreate(() => { entered(); return new Promise(resolve => finish = resolve) })
    const opening = openOrFocusCockpit(); await waiting
    const attaching = f.relay.attach(f.port)
    assert.equal(f.frames.length, 0); assert.equal(f.disconnected(), false)
    finish(f.window); await opening; await attaching
    assert.equal(f.frames[0]?.type, "cockpit.bridge.hello")
  } finally { f.restore() }
})
test("723 native relay rejects stale document, replaced auth endpoint and wrong bound identity", async () => {
  for (const mode of ["document", "auth", "owner", "challenge"] as const) {
    const f = fixture()
    try {
      await openOrFocusCockpit(); await f.relay.attach(f.port); const reply = nativeReply(f)
      if (mode === "document") f.contextLost()
      if (mode === "auth") f.connectionLost()
      if (mode === "owner") reply.ownerNonce = "d".repeat(32)
      if (mode === "challenge") reply.challenge = "e".repeat(64)
      f.emit(reply); await turn()
      assert.equal(f.frames.filter(v => v.type === "cockpit.bridge.bound").length, 0)
    } finally { f.restore() }
  }
})
test("723 native unavailable retires the held port and cannot emit a verified identity", async () => {
  const f = fixture()
  try {
    await openOrFocusCockpit(); await f.relay.attach(f.port)
    f.emit({ v: 1, op: "unavailable", reason: "bridge_unavailable" }); await turn()
    assert.equal(f.disconnected(), true)
    assert.equal(f.frames[1].type, "cockpit.bridge.retire")
    assert.equal(f.frames.filter(v => v.type === "cockpit.bridge.bound").length, 0)
  } finally { f.restore() }
})
