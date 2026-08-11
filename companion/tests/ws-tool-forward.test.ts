/**
 * Unit tests for ws/tool-forward.ts (C10-G extract).
 * Covers timeout resolution, dispatch not-connected, origin mismatch, rejectPending counts.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  TOOL_EXECUTION_TIMEOUT_MS,
  BROWSER_DOWNLOAD_MAX_TIMEOUT_MS,
  resolveToolDispatchTimeoutMs,
  pendingToolCalls,
  handleToolResult,
  rejectPendingForThread,
  hasPendingForTab,
  rejectPendingForTab,
  dispatchToExtension,
  bindToolForwardRuntime,
} from "../src/ws/tool-forward"

function mockWs(opts: { open?: boolean; id?: string } = {}): any {
  const open = opts.open !== false
  return {
    id: opts.id || "mock",
    readyState: open ? 1 : 3, // OPEN=1, CLOSED=3
    send: () => {},
  }
}

function clearPending(): void {
  for (const [id, p] of [...pendingToolCalls.entries()]) {
    clearTimeout(p.timer)
    pendingToolCalls.delete(id)
  }
}

test("resolveToolDispatchTimeoutMs: browser_download default >= 65s", () => {
  const ms = resolveToolDispatchTimeoutMs("browser_download", {})
  assert.ok(ms >= 65_000)
  assert.ok(ms > TOOL_EXECUTION_TIMEOUT_MS)
})

test("resolveToolDispatchTimeoutMs: browser_download timeoutMs=120000 capped", () => {
  const ms = resolveToolDispatchTimeoutMs("browser_download", { timeoutMs: 120_000 })
  assert.ok(ms <= BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000)
  assert.equal(ms, Math.min(BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000, 120_000 + 5_000))
})

test("resolveToolDispatchTimeoutMs: other tools stay at TOOL_EXECUTION_TIMEOUT_MS", () => {
  assert.equal(resolveToolDispatchTimeoutMs("click", {}), TOOL_EXECUTION_TIMEOUT_MS)
  assert.equal(resolveToolDispatchTimeoutMs("navigate", { timeoutMs: 120_000 }), TOOL_EXECUTION_TIMEOUT_MS)
})

test("dispatchToExtension not connected → error", async () => {
  clearPending()
  const ws = mockWs({ open: false })
  const result = await dispatchToExtension("t-nc", "list_tabs", {}, ws)
  assert.equal(result.success, false)
  assert.match(result.error || "", /not connected/i)
  assert.equal(pendingToolCalls.has("t-nc"), false)
})

test("handleToolResult origin mismatch ignores wrong peer", () => {
  clearPending()
  const owner = mockWs({ id: "owner" })
  const other = mockWs({ id: "other" })
  let resolved: any = null
  pendingToolCalls.set("t-origin", {
    resolve: (v) => {
      resolved = v
    },
    reject: () => {},
    timer: setTimeout(() => {}, 60_000),
    originWs: owner,
    tool_name: "navigate",
  })
  handleToolResult({ tool_call_id: "t-origin", result: { success: true, data: 1 } }, other)
  assert.equal(resolved, null)
  assert.ok(pendingToolCalls.has("t-origin"))
  handleToolResult({ tool_call_id: "t-origin", result: { success: true, data: 1 } }, owner)
  assert.deepEqual(resolved, { success: true, data: 1 })
  assert.equal(pendingToolCalls.has("t-origin"), false)
})

test("rejectPendingForThread counts matching thread", () => {
  clearPending()
  let a: any = null
  let b: any = null
  let c: any = null
  pendingToolCalls.set("p1", {
    resolve: (v) => {
      a = v
    },
    reject: () => {},
    timer: setTimeout(() => {}, 60_000),
    thread_id: "w1",
    tabId: 1,
    tool_name: "click",
  })
  pendingToolCalls.set("p2", {
    resolve: (v) => {
      b = v
    },
    reject: () => {},
    timer: setTimeout(() => {}, 60_000),
    thread_id: "w1",
    tabId: 2,
    tool_name: "click",
  })
  pendingToolCalls.set("p3", {
    resolve: (v) => {
      c = v
    },
    reject: () => {},
    timer: setTimeout(() => {}, 60_000),
    thread_id: "w2",
    tabId: 3,
    tool_name: "click",
  })
  const n = rejectPendingForThread("w1", "worker_cancel:w1")
  assert.equal(n, 2)
  assert.equal(a?.success, false)
  assert.equal(b?.success, false)
  assert.equal(c, null)
  assert.ok(pendingToolCalls.has("p3"))
  assert.equal(hasPendingForTab(3, "w2"), true)
  assert.equal(hasPendingForTab(1, "w1"), false)
  const n2 = rejectPendingForTab(3, "w2", "lease_expire")
  assert.equal(n2, 1)
  assert.equal((c as any)?.error, "lease_expire")
  clearPending()
})

test("bindToolForwardRuntime is callable (smoke)", () => {
  bindToolForwardRuntime({
    getTabUrlCache: () => new Map(),
    refreshTabUrlCache: () => {},
    getThreadManager: () => null,
  })
})
