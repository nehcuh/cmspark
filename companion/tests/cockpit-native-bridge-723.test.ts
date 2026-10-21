import test from "node:test"
import assert from "node:assert/strict"
import { CockpitNativeBridge, validCockpitBridgeMessage } from "../src/ws/cockpit-native-bridge"

function fixture() {
  let now = 1000
  const auth = { authenticated: true, surface: "panel", origin: `chrome-extension://${"a".repeat(32)}` }
  let current: unknown = auth
  const frames: any[] = []
  const ws = { readyState: 1, send(data: string) { frames.push(JSON.parse(data)) } }
  const bridge = new CockpitNativeBridge(() => now, () => "b".repeat(64))
  const hello = { type: "cockpit.bridge.hello", v: 1, ownerNonce: "c".repeat(32), documentId: "owned-document", windowId: 7 }
  const send = (value: unknown) => bridge.handle(ws, value, auth, () => current)
  const reply = () => {
    const actual = frames.find(f => f.type === "cockpit.bridge.challenge")
    assert.ok(actual)
    return { ...actual, type: "cockpit.bridge.bound", portNonce: "d".repeat(32), hwndDecimal: "77", tagValue: "99", pid: 7, tid: 8 }
  }
  return { frames, ws, bridge, hello, send, reply, auth, replaceAuth() { current = { ...auth } }, advance(ms: number) { now += ms } }
}
test("723 identity protocol consumes its actual challenge once and never emits an action grant", () => {
  const f = fixture(); f.send(f.hello); const result = f.reply(); f.send(result); f.send(result)
  assert.deepEqual(f.frames.map(f => f.type), ["cockpit.bridge.challenge", "cockpit.bridge.state"])
  assert.deepEqual(f.frames[1], { type: "cockpit.bridge.state", v: 1, ownerNonce: f.hello.ownerNonce, state: "verified" })
  assert.ok(!JSON.stringify(f.frames).includes("token"))
})
test("723 identity protocol refuses foreign origin, surface, socket and auth replacement", () => {
  for (const mutation of ["origin", "surface", "auth", "socket"] as const) {
    const f = fixture(); f.send(f.hello); const reply = f.reply()
    if (mutation === "origin") f.auth.origin = "chrome-extension://foreign"
    if (mutation === "surface") f.auth.surface = "summoner"
    if (mutation === "auth") f.replaceAuth()
    if (mutation === "socket") { f.bridge.handle({ ...f.ws }, reply, f.auth, () => f.auth); continue }
    f.send(reply); assert.equal(f.frames.length, 1)
  }
})
test("723 identity protocol binds owner/document/window/challenge and original five second expiry", () => {
  for (const key of ["ownerNonce", "documentId", "windowId", "challenge", "expire"] as const) {
    const f = fixture(); f.send(f.hello); const reply = f.reply()
    if (key === "expire") f.advance(5000)
    else (reply as any)[key] = key === "windowId" ? 8 : key === "documentId" ? "other-document" : "e".repeat(key === "challenge" ? 64 : 32)
    f.send(reply); assert.equal(f.frames.length, 1)
  }
})
test("723 identity close and matching retirement invalidate old replies without retiring a successor", () => {
  const f = fixture(); f.send(f.hello); const old = f.reply()
  f.send({ type: "cockpit.bridge.retire", v: 1, ownerNonce: f.hello.ownerNonce }); f.send(old)
  assert.equal(f.frames.length, 1)
  const successor = { ...f.hello, ownerNonce: "e".repeat(32) }; f.send(successor)
  f.send({ type: "cockpit.bridge.retire", v: 1, ownerNonce: f.hello.ownerNonce })
  f.send({ ...f.frames[1], type: "cockpit.bridge.bound", portNonce: "d".repeat(32), hwndDecimal: "77", tagValue: "99", pid: 7, tid: 8 })
  assert.equal(f.frames[2].state, "verified")
  f.bridge.close(f.ws); f.send(old); assert.equal(f.frames.length, 3)
})
test("723 identity schema refuses extras, accessors, coercion and unknown native fields", () => {
  const f = fixture(); f.send(f.hello); const reply = f.reply()
  assert.ok(validCockpitBridgeMessage(reply))
  for (const change of [{ extra: true }, { v: 2 }, { hwndDecimal: "0" }, { hwndDecimal: "9223372036854775808" }, { hwndDecimal: "18446744073709551616" },
    { windowId: "7" }, { pid: 0 }, { tid: 4294967296 }, { ownerNonce: "Z".repeat(32) }, { documentId: "\n" }]) {
    assert.equal(validCockpitBridgeMessage({ ...reply, ...change }), false)
  }
  const getter = { ...reply }; Object.defineProperty(getter, "pid", { get() { throw Error("ACCESSOR_MUST_NOT_RUN") }, enumerable: true })
  assert.equal(validCockpitBridgeMessage(getter), false)
})
