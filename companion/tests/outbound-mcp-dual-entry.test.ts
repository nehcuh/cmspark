/**
 * ADR-022 L9 dual-entry tab lease unit tests.
 */

import test from "node:test"
import assert from "node:assert/strict"
import {
  gateOutboundTabLease,
  sidePanelWinsReleaseOutboundLease,
  outboundHolderThreadId,
  isOutboundHolder,
  OUTBOUND_MCP_PARAM,
} from "../src/outbound-mcp/dual-entry"
import {
  acquireOrRenewTabLease,
  getTabLease,
  _resetTabLeasesForTests,
  registerTabLeasePendingHooks,
} from "../src/orchestrator/tab-lease"

// tab-lease fail-closed without hooks: hasPending returns true → never FREE on sweep.
// Register no-pending hooks so force release / acquire work in isolation.
test.beforeEach(() => {
  _resetTabLeasesForTests()
  registerTabLeasePendingHooks({
    hasPendingForTab: () => false,
  })
})

test("outboundHolderThreadId prefix", () => {
  assert.equal(outboundHolderThreadId("agent-1"), "outbound_mcp:agent-1")
  assert.equal(isOutboundHolder("outbound_mcp:x"), true)
  assert.equal(isOutboundHolder("thread-abc"), false)
})

test("list_tabs does not require lease", () => {
  const r = gateOutboundTabLease("list_tabs", {}, "c1")
  assert.equal(r.ok, true)
})

test("interactive tool without tabId → TAB_ID_REQUIRED", () => {
  const r = gateOutboundTabLease("click", {}, "c1")
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "TAB_ID_REQUIRED")
    assert.ok(r.queue_disclosure_zh)
  }
})

test("outbound acquires hard lease on tab", () => {
  const r = gateOutboundTabLease("navigate", { tabId: 42 }, "coder")
  assert.equal(r.ok, true)
  const lease = getTabLease(42)
  assert.ok(lease)
  assert.equal(lease!.holderThreadId, "outbound_mcp:coder")
  assert.equal(lease!.state, "HARD_HELD")
})

test("Side Panel / worker hold blocks outbound (side_panel_wins disclosure)", () => {
  const side = acquireOrRenewTabLease({
    tabId: 7,
    holderThreadId: "worker-thread-1",
    needsL2: false,
  })
  assert.equal(side.ok, true)

  const r = gateOutboundTabLease("type", { tabId: 7 }, "mcp-agent")
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.side_panel_wins, true)
    assert.ok(
      r.error_code === "TAB_LOCKED" || r.error_code === "TAB_BUSY_CONFIRMING",
    )
    assert.match(r.queue_disclosure_zh, /Side Panel/)
  }
  // worker still holds
  assert.equal(getTabLease(7)?.holderThreadId, "worker-thread-1")
})

test("sidePanelWinsReleaseOutboundLease frees outbound hold", () => {
  const acq = gateOutboundTabLease("screenshot", { tabId: 99 }, "ob")
  assert.equal(acq.ok, true)
  assert.ok(getTabLease(99))

  const released = sidePanelWinsReleaseOutboundLease(99, "sidepanel-thread")
  assert.equal(released, true)
  assert.equal(getTabLease(99), null)
})

test("sidePanelWins does not release non-outbound holder", () => {
  acquireOrRenewTabLease({
    tabId: 3,
    holderThreadId: "worker-x",
    needsL2: false,
  })
  const released = sidePanelWinsReleaseOutboundLease(3, "other")
  assert.equal(released, false)
  assert.equal(getTabLease(3)?.holderThreadId, "worker-x")
})

test("outbound re-acquire same caller renews", () => {
  assert.equal(gateOutboundTabLease("click", { tabId: 1 }, "same").ok, true)
  assert.equal(gateOutboundTabLease("type", { tabId: 1 }, "same").ok, true)
  assert.equal(getTabLease(1)?.holderThreadId, "outbound_mcp:same")
})

test("OUTBOUND_MCP_PARAM constant stable", () => {
  assert.equal(OUTBOUND_MCP_PARAM, "__outbound_mcp")
})
