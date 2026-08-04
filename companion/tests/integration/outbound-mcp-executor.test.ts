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
} from "../../src/server.js"
import { ThreadManager } from "../../src/threads/thread-manager.js"
import {
  setOutboundToolRunner,
  resetOutboundCompanionHttpForTests,
  companionInvokeOutbound,
  companionAcceptDisclosure,
} from "../../src/outbound-mcp/companion-http.js"
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

  const result = await executeTool("ob_list_1", "list_tabs", {
    __outbound_mcp: true,
    __outbound_caller_id: "agent-a",
    __thread_id: "outbound_mcp:agent-a",
  })

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

test("createToolExecutor: outbound navigate untrusted domain → confirm fan-out resolvable", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  const confirmationPromise = expectClientMessage("security.confirmation.request")

  const resultPromise = executeTool("ob_nav_1", "navigate", {
    tabId: 1,
    url: "https://untrusted-outbound.example/",
    __outbound_mcp: true,
    __outbound_caller_id: "agent-b",
    __thread_id: "outbound_mcp:agent-b",
  })

  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "navigate")
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

test("companionInvokeOutbound → createToolExecutor full stack (list_tabs)", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    return executeTool(toolCallId, internalTool, params)
  })
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
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    return executeTool(toolCallId, internalTool, params)
  })

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
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    assert.equal(params.__outbound_mcp, true)
    assert.equal(params.__thread_id, "outbound_mcp:stack-agent")
    return executeTool(toolCallId, internalTool, params)
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
  setOutboundToolRunner(async (toolCallId, internalTool, params) => {
    return executeTool(toolCallId, internalTool, params)
  })

  const denied = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error_code, "DISCLOSURE_REQUIRED")

  await companionAcceptDisclosure("stack-agent")
  armAutoToolResult({ png: "xx" })

  const ok = await companionInvokeOutbound({
    caller_id: "stack-agent",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(ok.ok, true, `screenshot: ${JSON.stringify(ok)}`)
})
