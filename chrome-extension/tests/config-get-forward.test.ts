import test from "node:test"
import assert from "node:assert/strict"
import { forwardConfigGet } from "../src/background/config-get-forward"

test("config.get forwards the request id through the service worker", () => {
  const frames: object[] = []
  const client = { send(frame: object) { frames.push(frame); return true } }
  assert.deepEqual(forwardConfigGet({ id: "shortcut-config-get:123" }, client), { ok: true })
  assert.deepEqual(frames, [{ type: "config.get", id: "shortcut-config-get:123" }])
  assert.deepEqual(forwardConfigGet({}, client), { ok: true })
  assert.deepEqual(frames[1], { type: "config.get" })
  assert.equal(forwardConfigGet({ id: "invalid id" }, client).ok, false)
  assert.equal(frames.length, 2)
  assert.equal(forwardConfigGet({ id: "valid" }, { send: () => false }).ok, false)
})
