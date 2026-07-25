// XC-Integration-1: background must forward full security.confirmation.response
// fields to companion (nonce_response, add_to_thread_whitelist, stop_thread,
// add_to_whitelist). Companion handleSecurityConfirmationResponse already
// expects these (server.ts ~1481-1515).

import test from "node:test"
import assert from "node:assert/strict"
import { buildSecurityConfirmationWsPayload } from "../src/background/security-confirmation-payload"

test("forwards add_to_whitelist array and approved boolean", () => {
  const payload = buildSecurityConfirmationWsPayload({
    confirmation_id: "c1",
    approved: true,
    add_to_whitelist: ["example.com", "*.example.com"],
  })
  assert.equal(payload.type, "security.confirmation.response")
  assert.equal(payload.confirmation_id, "c1")
  assert.equal(payload.approved, true)
  assert.deepEqual(payload.add_to_whitelist, ["example.com", "*.example.com"])
})

test("coerces approved to strict boolean true only", () => {
  assert.equal(buildSecurityConfirmationWsPayload({ approved: "true" }).approved, false)
  assert.equal(buildSecurityConfirmationWsPayload({ approved: 1 }).approved, false)
  assert.equal(buildSecurityConfirmationWsPayload({ approved: false }).approved, false)
  assert.equal(buildSecurityConfirmationWsPayload({ approved: true }).approved, true)
})

test("defaults add_to_whitelist to [] when missing or non-array", () => {
  assert.deepEqual(buildSecurityConfirmationWsPayload({}).add_to_whitelist, [])
  assert.deepEqual(
    buildSecurityConfirmationWsPayload({ add_to_whitelist: "example.com" }).add_to_whitelist,
    [],
  )
})

test("includes nonce_response when string", () => {
  const payload = buildSecurityConfirmationWsPayload({
    confirmation_id: "c2",
    approved: true,
    nonce_response: "ABCD12",
  })
  assert.equal(payload.nonce_response, "ABCD12")
})

test("omits nonce_response when not a string", () => {
  assert.equal(
    "nonce_response" in buildSecurityConfirmationWsPayload({ nonce_response: 123 }),
    false,
  )
  assert.equal(
    "nonce_response" in buildSecurityConfirmationWsPayload({ nonce_response: null }),
    false,
  )
  assert.equal(
    "nonce_response" in buildSecurityConfirmationWsPayload({}),
    false,
  )
})

test("forwards add_to_thread_whitelist boolean true only when true", () => {
  const yes = buildSecurityConfirmationWsPayload({
    approved: true,
    add_to_thread_whitelist: true,
  })
  assert.equal(yes.add_to_thread_whitelist, true)

  for (const bad of [false, "true", 1, null, undefined, "yes"]) {
    const p = buildSecurityConfirmationWsPayload({ add_to_thread_whitelist: bad })
    assert.equal(
      "add_to_thread_whitelist" in p,
      false,
      `must omit add_to_thread_whitelist for ${JSON.stringify(bad)}`,
    )
  }
})

test("forwards stop_thread when true; omits otherwise", () => {
  const yes = buildSecurityConfirmationWsPayload({ approved: true, stop_thread: true })
  assert.equal(yes.stop_thread, true)

  for (const bad of [false, "true", 1, null, undefined]) {
    const p = buildSecurityConfirmationWsPayload({ stop_thread: bad })
    assert.equal("stop_thread" in p, false, `must omit stop_thread for ${JSON.stringify(bad)}`)
  }
})

test("keeps add_to_whitelist alongside nonce and thread flags", () => {
  const payload = buildSecurityConfirmationWsPayload({
    confirmation_id: "c3",
    approved: true,
    add_to_whitelist: ["trusted.example"],
    nonce_response: "ZZ99",
    add_to_thread_whitelist: true,
    stop_thread: true,
  })
  assert.deepEqual(payload, {
    type: "security.confirmation.response",
    confirmation_id: "c3",
    approved: true,
    add_to_whitelist: ["trusted.example"],
    nonce_response: "ZZ99",
    add_to_thread_whitelist: true,
    stop_thread: true,
  })
})
