import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveWaitForMode,
  DEFAULT_WAIT_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
} from "../src/background/wait-for-mode"

test("wait_for tabId-only (thread 1snvlv) defaults to network_idle", () => {
  const m = resolveWaitForMode({ tabId: 1492094196 })
  assert.equal(m.kind, "network_idle")
  if (m.kind === "network_idle") {
    assert.equal(m.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS)
    assert.equal(m.settleMs, DEFAULT_SETTLE_MS)
  }
})

test("wait_for timeout-only uses timeout as load wait", () => {
  const m = resolveWaitForMode({ tabId: 1, timeout: 5000 })
  assert.equal(m.kind, "network_idle")
  if (m.kind === "network_idle") {
    assert.equal(m.timeoutMs, 5000)
    assert.equal(m.settleMs, DEFAULT_SETTLE_MS)
  }
})

test("wait_for default load+settle stays under companion 15s WS", () => {
  const m = resolveWaitForMode({ tabId: 1 })
  assert.equal(m.kind, "network_idle")
  if (m.kind === "network_idle") {
    assert.ok(m.timeoutMs + m.settleMs < 15_000)
  }
})

test("wait_for caps huge settle_ms", () => {
  const m = resolveWaitForMode({ tabId: 1, network_idle: true, settle_ms: 60_000 })
  assert.equal(m.kind, "network_idle")
  if (m.kind === "network_idle") {
    assert.equal(m.settleMs, 5_000)
  }
})

test("wait_for selector still wins over network_idle", () => {
  const m = resolveWaitForMode({
    tabId: 1,
    selector: " textarea",
    network_idle: true,
    state: "hidden",
  })
  assert.equal(m.kind, "selector")
  if (m.kind === "selector") {
    assert.equal(m.selector, "textarea")
    assert.equal(m.expectVisible, false)
  }
})

test("wait_for network_idle true without selector is network_idle", () => {
  const m = resolveWaitForMode({ tabId: 1, network_idle: true, settle_ms: 3000 })
  assert.equal(m.kind, "network_idle")
  if (m.kind === "network_idle") {
    assert.equal(m.settleMs, 3000)
  }
})

test("wait_for network_idle false without selector is invalid", () => {
  const m = resolveWaitForMode({ tabId: 1, network_idle: false })
  assert.equal(m.kind, "invalid")
  if (m.kind === "invalid") {
    assert.equal(m.error, "selector or network_idle is required")
  }
})
