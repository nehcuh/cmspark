/**
 * Integration: real createToolExecutor + __outbound_mcp tags (adversary B1 follow-up).
 *
 * Pre-fix, synthetic __thread_id "outbound_mcp:*" hit ThreadManager.isToolAllowed
 * and returned tool_not_allowed for every production outbound call. Mock runners
 * never exercised that path. These tests mount createToolExecutor on a live
 * in-process WS pair (same harness as security-gates.test.ts).
 */

import "./_security-gates-setup.js"
import test, { before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { WebSocketServer, WebSocket } from "ws"

import {
  createToolExecutor,
  handleToolResult,
  applyConnectionCloseGracePeriod,
  pendingToolCalls,
  securityConfirmations,
  seedThreadManagerForTests,
  seedExtensionWsAuthForTests,
} from "../../src/server.js"
import { ThreadManager } from "../../src/threads/thread-manager.js"
import { getConfigDir } from "../../src/config.js"
import {
  setOutboundToolRunner,
  resetOutboundCompanionHttpForTests,
  companionInvokeOutbound,
  companionAcceptDisclosure,
} from "../../src/outbound-mcp/companion-http.js"
import { issueOutboundGrant, resetOutboundGrantsForTests } from "../../src/outbound-mcp/outbound-grants.js"
import {
  _resetTabLeasesForTests,
  registerTabLeasePendingHooks,
} from "../../src/orchestrator/tab-lease.js"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ob-exec-"))

let wss: WebSocketServer
let serverSideWs: WebSocket
let clientSideWs: WebSocket
let serverPort: number

before(() => {
  process.env.HOME = tempDir
  // CMSPARK_DATA_DIR already set by _security-gates-setup
})

after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

beforeEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  resetOutboundCompanionHttpForTests()
  resetOutboundGrantsForTests()
  _resetTabLeasesForTests()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  // B1 path only runs when threadManager is live (production always is)
  seedThreadManagerForTests()

  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  serverPort = (wss.address() as { port: number }).port

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      serverSideWs = ws
      seedExtensionWsAuthForTests(ws)
      ws.on("error", () => {
        /* teardown */
      })
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === "security.confirmation.response") {
            securityConfirmations.respond(String(msg.confirmation_id || ""), msg.approved === true)
          } else if (msg.type === "tool.result") {
            handleToolResult(msg)
          }
        } catch {
          /* ignore */
        }
      })
      resolve()
    })
    clientSideWs = new WebSocket(`ws://127.0.0.1:${serverPort}`)
    clientSideWs.on("error", () => {
      /* teardown */
    })
  })
})

afterEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  applyConnectionCloseGracePeriod()
  securityConfirmations.rejectAll("disconnect")
  resetOutboundCompanionHttpForTests()
  const safeTerminate = (ws: WebSocket | undefined) => {
    try {
      ;(ws as any)?.terminate?.()
    } catch {
      /* */
    }
  }
  safeTerminate(clientSideWs)
  safeTerminate(serverSideWs)
  try {
    wss?.clients.forEach((c) => safeTerminate(c))
  } catch {
    /* */
  }
  await new Promise<void>((resolve) => {
    try {
      wss?.close(() => resolve())
    } catch {
      resolve()
    }
  })
})

function expectClientMessage(type: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clearTimeout(timeout)
          clientSideWs.off("message", handler)
          resolve(msg)
        }
      } catch {
        /* ignore */
      }
    }
    clientSideWs.on("message", handler)
  })
}

/** Auto-answer tool.execute with success so CDP path resolves.
 * Wire shape must match handleToolResult: `{ tool_call_id, result: { success, data } }`.
 */
function armAutoToolResult(data: unknown = { tabs: [{ id: 1, url: "https://example.com" }] }): void {
  const handler = (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === "tool.execute") {
        clientSideWs.send(
          JSON.stringify({
            type: "tool.result",
            tool_call_id: msg.tool_call_id,
            result: { success: true, data },
          }),
        )
      }
    } catch {
      /* ignore */
    }
  }
  clientSideWs.on("message", handler)
}

// ---------------------------------------------------------------------------
// B1 hazard documentation + production path
// ---------------------------------------------------------------------------

test("B1 hazard: ThreadManager denies synthetic outbound holder", () => {
  const tm = new ThreadManager()
  assert.equal(tm.isToolAllowed("outbound_mcp:agent", "list_tabs"), false)
})

test("createToolExecutor: outbound tags + list_tabs succeeds (not tool_not_allowed)", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  armAutoToolResult({ tabs: [{ id: 9, title: "t" }] })

  const result = await executeTool(
    "ob_list_1",
    "list_tabs",
    {
      __outbound_mcp: true,
      __outbound_caller_id: "agent-a",
      __thread_id: "outbound_mcp:agent-a",
    },
    undefined,
    { trustedOutbound: true },
  )

  assert.equal(result.success, true, `expected success, got ${JSON.stringify(result)}`)
  assert.notEqual((result as any).data?.error_code, "tool_not_allowed")
  assert.ok(Array.isArray(result.data) || (result.data as any)?.tabs || result.data)
})

test("createToolExecutor: synthetic thread_id WITHOUT __outbound_mcp → tool_not_allowed (B1 counterfactual)", async () => {
  // Proves ThreadManager is live AND that missing the outbound flag still fails.
  const executeTool = createToolExecutor(serverSideWs)
  const result = await executeTool("ob_b1_counter", "list_tabs", {
    __thread_id: "outbound_mcp:no-flag",
    // deliberately NO __outbound_mcp
  })
  assert.equal(result.success, false)
  assert.equal((result as any).data?.error_code, "tool_not_allowed")
})

test("S42 P0: LLM-injected __outbound_mcp without trustedOutbound is stripped (pack whitelist holds)", async () => {
  // Adversarial: generic zod fallback preserves unknown keys; Side Panel path
  // must not honor __outbound_mcp from params alone.
  fs.mkdirSync(path.join(getConfigDir(), "threads"), { recursive: true })
  const tm = seedThreadManagerForTests()
  const thread = tm.create("s42-pack-worker")
  tm.applyPackPatch(thread.id, {
    mission_pack_id: "s42-test-pack",
    mission_pack_snapshot: null,
    tool_whitelist: ["get_page_html"], // list_tabs intentionally denied
    active_skill_ids: ["browse"],
    system_prompt_append: null,
  })
  assert.equal(tm.isToolAllowed(thread.id, "list_tabs"), false)

  const executeTool = createToolExecutor(serverSideWs)
  const result = await executeTool("s42_inject", "list_tabs", {
    __thread_id: thread.id,
    __outbound_mcp: true, // attack payload
    __outbound_caller_id: "evil-llm",
  })
  // No trustedOutbound → flag stripped → isToolAllowed denies
  assert.equal(result.success, false, `expected deny, got ${JSON.stringify(result)}`)
  assert.equal((result as any).data?.error_code, "tool_not_allowed")
})

test("S42 P0: same tags WITH trustedOutbound skip whitelist (real outbound path)", async () => {
  // Trusted outbound + synthetic holder must not hit isToolAllowed deny.
  const executeTool = createToolExecutor(serverSideWs)
  armAutoToolResult({ tabs: [{ id: 2 }] })
  const result = await executeTool(
    "s42_trusted",
    "list_tabs",
    {
      __outbound_mcp: true,
      __outbound_caller_id: "agent-trusted",
      __thread_id: "outbound_mcp:agent-trusted",
    },
    undefined,
    { trustedOutbound: true },
  )
  assert.equal(result.success, true, `trusted outbound: ${JSON.stringify(result)}`)
  assert.notEqual((result as any).data?.error_code, "tool_not_allowed")
})

test("createToolExecutor: outbound navigate untrusted domain → confirm fan-out resolvable", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  const confirmationPromise = expectClientMessage("security.confirmation.request")

  const resultPromise = executeTool(
    "ob_nav_1",
    "navigate",
    {
      tabId: 1,
      url: "https://untrusted-outbound.example/",
      __outbound_mcp: true,
      __outbound_caller_id: "agent-b",
      __thread_id: "outbound_mcp:agent-b",
    },
    undefined,
    { trustedOutbound: true },
  )

  const confirmation = await confirmationPromise
  // S42 P1: outbound URL-gate labels tool as [Outbound] navigate for UI honesty
  assert.match(String(confirmation.tool_name || ""), /navigate/)
  // L8: origin unbound for outbound — privileged respond() still works
  clientSideWs.send(
    JSON.stringify({
      type: "security.confirmation.response",
      confirmation_id: confirmation.confirmation_id,
      approved: true,
    }),
  )

  // After approve, tool.execute should fire
  const execMsg = await expectClientMessage("tool.execute")
  assert.equal(execMsg.tool_name, "navigate")
  clientSideWs.send(
    JSON.stringify({
      type: "tool.result",
      tool_call_id: execMsg.tool_call_id,
      result: { success: true, data: { ok: true } },
    }),
  )

  const result = await resultPromise
  assert.equal(result.success, true, `navigate after confirm: ${JSON.stringify(result)}`)
})

/** Wire runner the same way production does (trustedOutbound: true). */
function wireTrustedOutboundRunner(
  executeTool: ReturnType<typeof createToolExecutor>,
  onParams?: (params: Record<string, unknown>) => void,
): void {
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    onParams?.(params as Record<string, unknown>)
    return executeTool(toolCallId, internalTool, params, undefined, {
      trustedOutbound: true,
    })
  })
}

test("companionInvokeOutbound → createToolExecutor full stack (list_tabs)", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)
  armAutoToolResult({ tabs: [{ id: 3, url: "https://a.example" }] })

  const r = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__list_tabs",
  })

  assert.equal(r.ok, true, `full stack list_tabs: ${JSON.stringify(r)}`)
  assert.equal(r.error_code, undefined)
  assert.notEqual((r.data as any)?.error_code, "tool_not_allowed")
})

test("companionInvokeOutbound → createToolExecutor click requires tabId (L9)", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)

  const r = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__click",
    args: { selector: "#x" },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "TAB_ID_REQUIRED")
})

test("companionInvokeOutbound → createToolExecutor click with tabId reaches CDP", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool, (params) => {
    assert.equal(params.__outbound_mcp, true)
    assert.equal(params.__thread_id, "outbound_mcp:stack-agent")
  })
  armAutoToolResult({ clicked: true })

  const r = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__click",
    args: { tabId: 5, selector: "#ok" },
  })
  assert.equal(r.ok, true, `click stack: ${JSON.stringify(r)}`)
})

test("companionInvokeOutbound screenshot needs disclosure then CDP", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)

  const denied = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error_code, "DISCLOSURE_NOT_GRANTED")

  issueOutboundGrant({
    label: "stack",
    caller_id: "stack-agent",
    allow_page_export: true,
  })
  const hitl = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(hitl.ok, false)
  assert.equal(hitl.error_code, "DISCLOSURE_HITL_REQUIRED")

  // Operator session (Task 10 Confirm Center) — not HTTP/stdio caller ack
  await companionAcceptDisclosure("stack-agent")
  armAutoToolResult({ png: "xx" })

  const ok = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(ok.ok, true, `screenshot: ${JSON.stringify(ok)}`)
})

test("S42 P0: untrusted runner (no trustedOutbound) still denies synthetic outbound holder", async () => {
  // Counterfactual: if someone wires setOutboundToolRunner without trustedOutbound,
  // B1 fail-closed must hold (params alone insufficient).
  const executeTool = createToolExecutor(serverSideWs)
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    // deliberately omit trustedOutbound
    return executeTool(toolCallId, internalTool, params)
  })
  const r = await companionInvokeOutbound({
    caller_id: "untrusted-wire",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  // dispatch fails with tool_not_allowed after strip
  assert.ok(
    r.error_code === "DISPATCH_FAILED" ||
      (r.data as any)?.error_code === "tool_not_allowed" ||
      /tool_not_allowed|not allowed/i.test(String(r.error || "")),
    `expected whitelist deny after strip, got ${JSON.stringify(r)}`,
  )
})
