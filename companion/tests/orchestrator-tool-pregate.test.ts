/**
 * ADR-015 multi-agent tool pre-gate (C10 Phase F).
 * Isolates DATA_DIR before config/thread helpers load.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tool-pregate-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp
process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import { describe, it, before, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  runMultiAgentToolPregate,
  type ToolPregateCtx,
} from "../src/orchestrator/tool-pregate"
import {
  acquireOrRenewTabLease,
  _resetTabLeasesForTests,
  anyTabLeaseHeld,
} from "../src/orchestrator/tab-lease"

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})

afterEach(() => {
  _resetTabLeasesForTests()
})

function makeCtx(
  overrides: Partial<ToolPregateCtx> & {
    toolName: string
    finalParams?: Record<string, any>
  },
): ToolPregateCtx {
  return {
    finalParams: {},
    toolCallId: "tc-pregate",
    startedAt: Date.now(),
    isOutboundMcpCall: false,
    logToolFinish: () => {},
    getThreadManager: () => null,
    hasPendingForTab: () => false,
    toolDisplayNameZh: (n) => n,
    ...overrides,
  }
}

describe("runMultiAgentToolPregate", () => {
  it("pass-through when no actingThreadId and no multi-agent leases", async () => {
    const params = { tabId: 42, url: "https://example.com" }
    const out = await runMultiAgentToolPregate(
      makeCtx({ toolName: "navigate", finalParams: { ...params } }),
    )
    assert.equal(out.ok, true)
    if (!out.ok) return
    assert.equal(out.finalParams.tabId, 42)
    assert.equal(out.finalParams.url, "https://example.com")
    // single-agent: no __require_tab_id stamp
    assert.equal(out.finalParams.__require_tab_id, undefined)
  })

  it("paused worker → worker_paused error", async () => {
    const tm = new ThreadManager()
    const t = tm.create("worker-paused-1")
    tm.update(t.id, { agent_role: "worker", paused: true } as any)
    const finished: any[] = []
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { tabId: 1 },
        actingThreadId: t.id,
        getThreadManager: () => tm,
        logToolFinish: (_id, name, _t, result) => {
          finished.push({ name, result })
        },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.success, false)
    assert.match(String(out.result.error), new RegExp(`worker_paused:${t.id}`))
    assert.equal(finished.length, 1)
  })

  it("isToolAllowed false → tool_not_allowed", async () => {
    const tm = new ThreadManager()
    const t = tm.create("worker-whitelist-1")
    tm.update(t.id, {
      agent_role: "worker",
      tool_whitelist: ["list_tabs"], // navigate denied
    } as any)
    const finished: any[] = []
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { tabId: 7 },
        actingThreadId: t.id,
        getThreadManager: () => tm,
        toolDisplayNameZh: () => "打开网页",
        logToolFinish: (_id, name, _t, result) => {
          finished.push({ name, result })
        },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "tool_not_allowed")
    assert.match(String(out.result.error), /tool_not_allowed|不允许/)
    assert.equal(finished.length, 1)
    assert.equal(finished[0].name, "navigate")
  })

  it("multi-agent TAB_LEASE tool without tabId → TAB_ID_REQUIRED", async () => {
    const tm = new ThreadManager()
    const t = tm.create("worker-tab-req")
    tm.update(t.id, {
      agent_role: "worker",
      tool_whitelist: ["navigate", "screenshot", "list_tabs"],
    } as any)
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { url: "https://example.com" }, // no tabId
        actingThreadId: t.id,
        getThreadManager: () => tm,
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "TAB_ID_REQUIRED")
    assert.match(String(out.result.error), /TAB_ID_REQUIRED/)
  })

  it("multi-agent TAB_LEASE with tabId stamps __require_tab_id and acquires lease", async () => {
    const tm = new ThreadManager()
    const t = tm.create("worker-lease-ok")
    tm.update(t.id, {
      agent_role: "worker",
      tool_whitelist: ["navigate", "screenshot", "list_tabs"],
    } as any)
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { tabId: 99, url: "https://example.com" },
        actingThreadId: t.id,
        getThreadManager: () => tm,
      }),
    )
    assert.equal(out.ok, true)
    if (!out.ok) return
    assert.equal(out.finalParams.__require_tab_id, true)
    assert.equal(anyTabLeaseHeld(), true)
  })

  it("host_computer + chrome + anyTabLeaseHeld → HOST_CHROME_TAB_LEASE", async () => {
    // Seed a process-wide lease so anyTabLeaseHeld() is true (no actingThreadId path).
    const lease = acquireOrRenewTabLease({
      tabId: 55,
      holderThreadId: "seed-holder",
      needsL2: false,
    })
    assert.equal(lease.ok, true)
    assert.equal(anyTabLeaseHeld(), true)

    const finished: any[] = []
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "host_computer",
        finalParams: { action: "focus", app: "Google Chrome" },
        logToolFinish: (_id, name, _t, result) => {
          finished.push({ name, result })
        },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "HOST_CHROME_TAB_LEASE")
    assert.match(String(out.result.error), /host_computer blocked on Chrome/)
    assert.equal(finished.length, 1)
  })

  it("host_computer without chrome hint passes when leases held", async () => {
    const lease = acquireOrRenewTabLease({
      tabId: 56,
      holderThreadId: "seed-holder-2",
      needsL2: false,
    })
    assert.equal(lease.ok, true)

    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "host_computer",
        finalParams: { action: "focus", app: "TextEdit" },
      }),
    )
    assert.equal(out.ok, true)
  })

  it("gate exception → ORCHESTRATOR_GATE_ERROR (fail-closed)", async () => {
    const finished: any[] = []
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { tabId: 1 },
        logToolFinish: (_id, name, _t, result) => {
          finished.push({ name, result })
        },
      }),
      { forceThrow: () => { throw new Error("simulated gate boom") } },
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "ORCHESTRATOR_GATE_ERROR")
    assert.match(String(out.result.error), /ORCHESTRATOR_GATE_ERROR: simulated gate boom/)
    assert.equal(finished.length, 1)
  })

  it("isOutboundMcpCall skips pack whitelist / paused checks", async () => {
    const tm = new ThreadManager()
    const t = tm.create("outbound-skip")
    tm.update(t.id, {
      agent_role: "worker",
      paused: true,
      tool_whitelist: ["list_tabs"],
    } as any)
    // Outbound would inject synthetic thread id; even with paused + deny list,
    // isOutboundMcpCall must skip multi-agent pack path.
    const out = await runMultiAgentToolPregate(
      makeCtx({
        toolName: "navigate",
        finalParams: { tabId: 3 },
        actingThreadId: t.id,
        isOutboundMcpCall: true,
        getThreadManager: () => tm,
      }),
    )
    assert.equal(out.ok, true)
  })
})
