import test from "node:test"
import assert from "node:assert/strict"
import {
  PROTOCOL_VERSION,
  PROTOCOL_MIN,
  PROTOCOL_MAX,
  negotiateProtocolVersion,
  authOkProtocolFields,
} from "../src/protocol"

test("legacy omit negotiates to PROTOCOL_MIN", () => {
  const r = negotiateProtocolVersion(undefined)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.negotiated, PROTOCOL_MIN)
})

test("current version accepted", () => {
  const r = negotiateProtocolVersion(PROTOCOL_VERSION)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.negotiated, PROTOCOL_VERSION)
})

test("below min rejected", () => {
  const r = negotiateProtocolVersion(PROTOCOL_MIN - 1)
  assert.equal(r.ok, false)
})

test("above max rejected", () => {
  const r = negotiateProtocolVersion(PROTOCOL_MAX + 1)
  assert.equal(r.ok, false)
})

test("non-integer rejected", () => {
  assert.equal(negotiateProtocolVersion(1.5).ok, false)
  assert.equal(negotiateProtocolVersion("1").ok, false)
})

test("authOkProtocolFields shape", () => {
  const f = authOkProtocolFields()
  assert.equal(f.protocol_version, PROTOCOL_VERSION)
  assert.equal(f.protocol_min, PROTOCOL_MIN)
  assert.equal(f.protocol_max, PROTOCOL_MAX)
})
