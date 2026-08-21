import test from "node:test"
import assert from "node:assert/strict"
import { normalizeWaitForParams } from "../src/tool/wait-for-params.js"

test("normalizeWaitForParams: tabId-only (1snvlv) injects network_idle", () => {
  const out = normalizeWaitForParams("wait_for", { tabId: 1492094196 })
  assert.equal(out.network_idle, true)
  assert.equal(out.tabId, 1492094196)
})

test("normalizeWaitForParams: timeout-only injects network_idle", () => {
  const out = normalizeWaitForParams("wait_for", { tabId: 1, timeout: 5000 })
  assert.equal(out.network_idle, true)
  assert.equal(out.timeout, 5000)
})

test("normalizeWaitForParams: selector unchanged", () => {
  const src: Record<string, unknown> = { tabId: 1, selector: "#app" }
  const out = normalizeWaitForParams("wait_for", src)
  assert.equal(out.selector, "#app")
  assert.equal(out.network_idle, undefined)
})

test("normalizeWaitForParams: whitespace-only selector stripped then idle", () => {
  const out = normalizeWaitForParams("wait_for", { tabId: 1, selector: "  " })
  assert.equal(out.selector, undefined)
  assert.equal(out.network_idle, true)
})

test("normalizeWaitForParams: explicit false is not overwritten", () => {
  const out = normalizeWaitForParams("wait_for", { tabId: 1, network_idle: false })
  assert.equal(out.network_idle, false)
})

test("normalizeWaitForParams: other tools untouched", () => {
  const src = { tabId: 1 }
  assert.equal(normalizeWaitForParams("click", src), src)
})
