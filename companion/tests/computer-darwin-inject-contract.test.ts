// F9 end-to-end inject failure contract tests.
//
// Plan v3 G3 — T5: verify that structured `{ok:false, error_code}` payloads
// from cmspark-host surface as typed ComputerError. Without this contract,
// SKYLIGHT_SPI_UNAVAILABLE / SKYLIGHT_POST_FAILED would be silently dropped
// (binary exits 0; companion used to ignore stdout for inject paths).
//
// Tests the public assertInjectOk() helper directly — no spawn required.

import test from "node:test"
import assert from "node:assert/strict"

import { assertInjectOk, parseComputerJson, checkOk } from "../src/computer/darwin-adapters"
import { ComputerError } from "../src/computer/types"

test("F9: assertInjectOk passes on {ok:true} payload", () => {
  assert.doesNotThrow(() => assertInjectOk(JSON.stringify({ ok: true, action: "click" })))
})

test("F9: assertInjectOk throws ComputerError with typed code on SKYLIGHT_SPI_UNAVAILABLE", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "SkyLight SPI unavailable on this OS",
    error_code: "SKYLIGHT_SPI_UNAVAILABLE",
  })
  try {
    assertInjectOk(stdout)
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "SKYLIGHT_SPI_UNAVAILABLE")
    assert.ok((err as ComputerError).message.includes("SkyLight SPI unavailable"))
  }
})

test("F9: assertInjectOk throws ComputerError with typed code on SKYLIGHT_POST_FAILED", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "SkyLight SPI post failed",
    error_code: "SKYLIGHT_POST_FAILED",
  })
  try {
    assertInjectOk(stdout, "inject.click")
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "SKYLIGHT_POST_FAILED")
    assert.ok((err as ComputerError).message.includes("inject.click"))
  }
})

test("F9: assertInjectOk throws ComputerError on CGEVENT_CONSTRUCT_FAILED", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "CGEvent mouseDown construction failed",
    error_code: "CGEVENT_CONSTRUCT_FAILED",
  })
  try {
    assertInjectOk(stdout)
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "CGEVENT_CONSTRUCT_FAILED")
  }
})

test("F9: assertInjectOk falls back to INVALID_ACTION when error_code missing", () => {
  const stdout = JSON.stringify({ ok: false, error: "mystery failure" })
  try {
    assertInjectOk(stdout)
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "INVALID_ACTION")
  }
})

test("F9: assertInjectOk throws INVALID_ACTION on malformed JSON", () => {
  try {
    assertInjectOk("not-json-at-all")
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "INVALID_ACTION")
    assert.ok((err as ComputerError).message.includes("invalid JSON"))
  }
})

test("F9: assertInjectOk throws INVALID_ACTION on non-object payload", () => {
  try {
    assertInjectOk(JSON.stringify("[1,2,3]"))
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "INVALID_ACTION")
    assert.ok((err as ComputerError).message.includes("malformed payload"))
  }
})

test("F9: parseComputerJson + checkOk compose to same behavior as assertInjectOk", () => {
  // Verify the helper composition is equivalent — guards against future
  // refactor that breaks the contract.
  const stdout = JSON.stringify({ ok: false, error_code: "SKYLIGHT_POST_FAILED", error: "x" })
  try {
    const parsed = parseComputerJson(stdout, "inject")
    checkOk(parsed, "inject")
    assert.fail("expected throw")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "SKYLIGHT_POST_FAILED")
  }
})
