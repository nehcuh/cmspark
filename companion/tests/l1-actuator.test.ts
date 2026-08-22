import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { resolveL1ActuatorWs, BROWSER_UNAVAILABLE } from "../src/ws/l1-actuator"

function fakeWs() {
  const e = new EventEmitter() as any
  e.readyState = 1
  e.OPEN = 1
  e.send = () => {}
  return e
}

test("extension-origin loop keeps its own socket as actuator", () => {
  const originatingWs = fakeWs()
  const otherExt = fakeWs()
  let pickCalls = 0
  const result = resolveL1ActuatorWs(originatingWs, {
    getAuth: () => ({ origin: "chrome-extension://abc", authenticated: true }),
    pickExtensionWs: () => {
      pickCalls++
      return otherExt
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.ws, originatingWs)
  assert.equal(pickCalls, 0)
})

test("tray origin with no extension peer is BROWSER_UNAVAILABLE", () => {
  const originatingWs = fakeWs()
  const result = resolveL1ActuatorWs(originatingWs, {
    getAuth: () => ({ origin: "cmspark-tray://local", authenticated: true }),
    pickExtensionWs: () => null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error_code, BROWSER_UNAVAILABLE)
})

test("tray origin uses picked extension socket, not chat origin", () => {
  const originatingWs = fakeWs()
  const ext = fakeWs()
  const result = resolveL1ActuatorWs(originatingWs, {
    getAuth: () => ({ origin: "cmspark-tray://local", authenticated: true }),
    pickExtensionWs: () => ext,
  })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.ws, ext)
  assert.notEqual(result.ok && result.ws, originatingWs)
})

test("missing origin with no extension peer is unavailable", () => {
  const originatingWs = fakeWs()
  const result = resolveL1ActuatorWs(originatingWs, {
    getAuth: () => undefined,
    pickExtensionWs: () => null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error_code, BROWSER_UNAVAILABLE)
})
