import test from "node:test"
import assert from "node:assert/strict"
import { isTargetAllowed, assertTargetsAllowed } from "../src/netsec/scope"

test("empty allowlist denies all", () => {
  assert.equal(isTargetAllowed("example.com", []), false)
})

test("exact hostname and ipv4", () => {
  assert.equal(isTargetAllowed("api.corp.example", ["api.corp.example"]), true)
  assert.equal(isTargetAllowed("10.0.0.5", ["10.0.0.5"]), true)
  assert.equal(isTargetAllowed("evil.com", ["api.corp.example"]), false)
})

test("*.suffix multi-level, not apex", () => {
  const rules = ["*.corp.example"]
  assert.equal(isTargetAllowed("a.corp.example", rules), true)
  assert.equal(isTargetAllowed("a.b.corp.example", rules), true)
  assert.equal(isTargetAllowed("corp.example", rules), false)
  assert.equal(isTargetAllowed("evil.com", rules), false)
})

test("IPv4 CIDR", () => {
  const rules = ["10.0.0.0/8"]
  assert.equal(isTargetAllowed("10.1.2.3", rules), true)
  assert.equal(isTargetAllowed("11.0.0.1", rules), false)
})

test("IPv6 denied", () => {
  assert.equal(isTargetAllowed("::1", ["::1"]), false)
})

test("assertTargetsAllowed aggregates denials", () => {
  const r = assertTargetsAllowed(["10.0.0.1", "evil.com"], ["10.0.0.0/8"])
  assert.equal(r.ok, false)
  if (!r.ok) assert.deepEqual(r.denied, ["evil.com"])
})
