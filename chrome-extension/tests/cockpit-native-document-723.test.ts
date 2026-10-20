import test from "node:test"
import assert from "node:assert/strict"
import { attachCockpitNativeBridge } from "../src/cockpit/native-bridge"

// Inert transport DI, no browser/native implementation. Positive native bound
// receipts must come from the actual C# producer in the remote vertical gate.
function channel() {
  const messages = new Set<(value: unknown) => void>()
  const disconnects = new Set<() => void>()
  const sent: unknown[] = []
  let closed = 0
  const port = {
    postMessage: (value: unknown) => { sent.push(value) },
    disconnect: () => { closed++; for (const fn of [...disconnects]) fn() },
    onMessage: { addListener: (fn: (v: unknown) => void) => messages.add(fn), removeListener: (fn: (v: unknown) => void) => messages.delete(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
  } as unknown as chrome.runtime.Port
  return { port, sent, emit: (value: unknown) => { for (const fn of [...messages]) fn(value) }, closed: () => closed }
}
const request = () => ({ v: 1, op: "bind", ownerNonce: "a".repeat(32), challenge: "b".repeat(64), documentId: "current-document", windowId: 7 })
const refusal = () => ({ v: 1, op: "unavailable", reason: "bridge_unavailable" })
function setup() {
  const runtime = channel(), native = channel(), hosts: string[] = []
  const stop = attachCockpitNativeBridge(runtime.port, {
    connectNative: host => { hosts.push(host); return native.port }, consumeLastError: () => {},
  })
  return { runtime, native, hosts, stop }
}

test("real document callback forwards the exact bind request only to the fixed host", () => {
  const s = setup(), bind = request()
  s.runtime.emit(bind)
  assert.deepEqual(s.hosts, ["com.cmspark.cockpit"])
  assert.deepEqual(s.native.sent, [bind])
  assert.deepEqual(s.runtime.sent, []) // no native result invented by the client
  s.stop()
})

test("runtime receipt claims cannot enter the native onMessage closure", () => {
  const s = setup()
  s.runtime.emit({ ...request(), op: "bound", native: true })
  assert.equal(s.hosts.length, 0)
  assert.deepEqual(s.runtime.sent, [refusal()])
  s.stop()
})

test("coerced IDs, extra HWND and unapproved sample fail without native effects", () => {
  for (const bad of [
    { ...request(), ownerNonce: ["a".repeat(32)] },
    { ...request(), windowId: "7" },
    { ...request(), hwndDecimal: "12" },
    { ...request(), op: "sample" },
    { ...request(), documentId: "x".repeat(129) },
  ]) {
    const s = setup()
    s.runtime.emit(bad)
    assert.equal(s.hosts.length, 0)
    assert.deepEqual(s.runtime.sent, [refusal()])
    s.stop()
  }
})

test("a second bind cannot create a second native host", () => {
  const s = setup()
  s.runtime.emit(request()); s.runtime.emit({ ...request(), ownerNonce: "c".repeat(32) })
  assert.equal(s.hosts.length, 1)
  assert.equal(s.native.sent.length, 1)
  assert.deepEqual(s.runtime.sent, [refusal()])
  s.stop()
})

test("fixed native refusal propagates only the fixed reason and closes unknown transport", () => {
  const s = setup()
  s.runtime.emit(request()); s.native.emit(refusal())
  assert.deepEqual(s.runtime.sent, [refusal()])
  assert.equal(s.native.closed(), 1)
  s.stop()
})

test("retired document cannot forward a late refusal or start a new host", () => {
  const s = setup()
  s.runtime.emit(request()); s.stop()
  s.native.emit(refusal()); s.runtime.emit(request())
  assert.deepEqual(s.runtime.sent, [])
  assert.equal(s.hosts.length, 1)
  assert.equal(s.native.closed(), 1)
})

test("transport errors do not become receipts or expose exception details", () => {
  const runtime = channel()
  const stop = attachCockpitNativeBridge(runtime.port, {
    connectNative: () => { throw new Error("private path and raw error must not cross") }, consumeLastError: () => {},
  })
  runtime.emit(request())
  assert.deepEqual(runtime.sent, [refusal()])
  stop()
})
