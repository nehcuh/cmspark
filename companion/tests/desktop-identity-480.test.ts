import test from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { DesktopIdentityRegistry, DESKTOP_READ_METHODS } from "../src/desktop/identity"

function fixture() {
  let now = 1000
  const registry = new DesktopIdentityRegistry(() => now)
  const bootstrap = registry.issue("host-1")
  const challenge = registry.challenge(bootstrap.capabilityId, "connection-1", 1)!
  const proof = createHmac("sha256", Buffer.from(bootstrap.secret, "hex")).update(challenge.signingInput).digest("hex")
  return { registry, bootstrap, proof, advance: (ms: number) => { now += ms } }
}

test("native-issued proof yields only the pinned read-only methods, never a renderer-claimed principal", () => {
  const f = fixture()
  const principal = f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof)!
  assert.ok(principal)
  for (const method of DESKTOP_READ_METHODS) assert.equal(f.registry.allows(principal, method), true)
  for (const method of ["mcp.add", "mcp.toggle_server", "config.set", "security.confirmation.response", "terminal.spawn", "chat.create"]) {
    assert.equal(f.registry.allows(principal, method), false, method)
  }
  assert.equal(f.registry.allows({ ...principal }, "thread.list"), false)
  assert.equal(JSON.stringify(principal).includes(f.bootstrap.secret), false)
  assert.ok(Object.isFrozen(principal))
  assert.ok(Object.isFrozen(DESKTOP_READ_METHODS))
})

test("proof is bound to capability, connection and negotiated protocol; failed attempts are consumed", () => {
  for (const mutation of ["secret", "protocol", "format"] as const) {
    const f = fixture()
    assert.equal(f.registry.authenticate(f.bootstrap.capabilityId,
      "connection-1", mutation === "protocol" ? 2 : 1,
      mutation === "secret" ? "00".repeat(32) : mutation === "format" ? "not-a-proof" : f.proof), null)
    assert.equal(f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof), null)
  }
  const f = fixture()
  assert.equal(f.registry.authenticate("unissued", "connection-1", 1, f.proof), null)
  assert.equal(f.registry.challenge("unissued", "connection-1", 1), null)
})

test("a foreign socket cannot consume a live challenge; pending socket close cancels only its own proof", () => {
  const f = fixture()
  assert.equal(f.registry.authenticate(f.bootstrap.capabilityId, "foreign", 1, f.proof), null)
  f.registry.cancelChallenge(f.bootstrap.capabilityId, "foreign")
  assert.ok(f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof))
  const other = fixture()
  other.registry.cancelChallenge(other.bootstrap.capabilityId, "connection-1")
  assert.equal(other.registry.authenticate(other.bootstrap.capabilityId, "connection-1", 1, other.proof), null)
})

test("expired challenge and expired bootstrap fail closed without extending bootstrap lifetime", () => {
  const f = fixture(); f.advance(10_000)
  assert.equal(f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof), null)
  assert.ok(f.registry.challenge(f.bootstrap.capabilityId, "connection-2", 1))
  f.advance(20_000)
  assert.equal(f.registry.challenge(f.bootstrap.capabilityId, "connection-3", 1), null)
})

test("replay, reconnect, disconnect, host exit and daemon restart revoke old authority", () => {
  const f = fixture()
  const old = f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof)!
  assert.equal(f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof), null)
  f.registry.disconnect(old)
  assert.equal(f.registry.allows(old, "thread.list"), false)
  const fresh = f.registry.challenge(f.bootstrap.capabilityId, "connection-2", 1)!
  const proof = createHmac("sha256", Buffer.from(f.bootstrap.secret, "hex")).update(fresh.signingInput).digest("hex")
  const current = f.registry.authenticate(f.bootstrap.capabilityId, "connection-2", 1, proof)!
  assert.ok(current)
  f.registry.disconnect(old) // a delayed old-socket close must not revoke the new one
  assert.equal(f.registry.allows(current, "thread.list"), true)
  f.registry.revokeAll()
  assert.equal(f.registry.allows(current, "thread.list"), false)
  assert.equal(f.registry.challenge(f.bootstrap.capabilityId, "connection-3", 1), null)
})

test("duplicate and excessive host sessions are bounded; unactivated expired grants can be reclaimed", () => {
  let now = 0
  const registry = new DesktopIdentityRegistry(() => now)
  registry.issue("host-0")
  assert.throws(() => registry.issue("host-0"), /already issued/)
  for (let i = 1; i < 64; i++) registry.issue(`host-${i}`)
  assert.throws(() => registry.issue("host-64"), /limit/)
  now = 30_000
  assert.ok(registry.issue("host-64"))
})

test("activated host can reconnect after bootstrap expiry with a fresh proof", () => {
  const f = fixture()
  const old = f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof)!
  f.advance(60_000)
  const challenge = f.registry.challenge(f.bootstrap.capabilityId, "connection-2", 1)!
  const proof = createHmac("sha256", Buffer.from(f.bootstrap.secret, "hex")).update(challenge.signingInput).digest("hex")
  const current = f.registry.authenticate(f.bootstrap.capabilityId, "connection-2", 1, proof)!
  assert.ok(current)
  assert.equal(f.registry.allows(old, "thread.list"), false)
  assert.equal(f.registry.allows(current, "thread.list"), true)
})

test("invalid host/protocol inputs never issue a grant or destroy an unrelated challenge", () => {
  const f = fixture()
  for (const host of ["", "a/b", "host\n", "x".repeat(129)]) assert.throws(() => f.registry.issue(host), /Invalid/)
  for (const version of [0, NaN, 1.5, Infinity, -1]) assert.equal(f.registry.challenge(f.bootstrap.capabilityId, "connection-2", version), null)
  assert.ok(f.registry.authenticate(f.bootstrap.capabilityId, "connection-1", 1, f.proof))
})

test("a second capability secret cannot authenticate the first host", () => {
  const f = fixture()
  const other = f.registry.issue("host-2")
  const challenge = f.registry.challenge(f.bootstrap.capabilityId, "connection-2", 1)!
  const proof = createHmac("sha256", Buffer.from(other.secret, "hex")).update(challenge.signingInput).digest("hex")
  assert.equal(f.registry.authenticate(f.bootstrap.capabilityId, "connection-2", 1, proof), null)
})
