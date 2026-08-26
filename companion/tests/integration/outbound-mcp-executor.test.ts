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
  getWsAuthState,
} from "../../src/server.js"
import { ThreadManager } from "../../src/threads/thread-manager.js"
import { getConfigDir } from "../../src/config.js"
import {
  setOutboundToolRunner,
  setOutboundExfilConfirmer,
  resetOutboundCompanionHttpForTests,
  companionInvokeOutbound,
  companionAcceptDisclosure,
  handleOutboundMcpHttp,
  OUTBOUND_DISCLOSURE_PATH,
} from "../../src/outbound-mcp/companion-http.js"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
  listOutboundGrants,
  grantAllowsPageExport,
  revokeOutboundGrant,
} from "../../src/outbound-mcp/outbound-grants.js"
import { hasOutboundDisclosure } from "../../src/outbound-mcp/disclosure-session.js"
import { assertSummonerAllowed } from "../../src/ws/summoner-acl.js"
import http from "node:http"
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

function wireExfilConfirmer(authExtra?: Map<WebSocket, { authenticated?: boolean; origin?: string; surface?: string }>): void {
  setOutboundExfilConfirmer({
    securityConfirmations,
    getClients: () => wss.clients,
    wsAuthGet: (w: WebSocket) => authExtra?.get(w) ?? getWsAuthState(w),
    getOriginatingWs: () => serverSideWs,
  })
}

async function connectPeer(): Promise<{ server: WebSocket; client: WebSocket }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("peer connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      ws.on("error", () => {
        /* teardown */
      })
      resolve({ server: ws, client })
    })
    const client = new WebSocket(`ws://127.0.0.1:${serverPort}`)
    client.on("error", () => {
      /* teardown */
    })
  })
}

async function postDisclosureAck(token: string, caller_id: string): Promise<{
  status: number
  json: any
}> {
  const server = http.createServer((req, res) => {
    void handleOutboundMcpHttp(req, res, "unused-ws-secret").catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr === "object" && "port" in addr)
  const port = (addr as { port: number }).port
  const body = Buffer.from(JSON.stringify({ caller_id, acknowledge: true }), "utf8")
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: OUTBOUND_DISCLOSURE_PATH,
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (c) => chunks.push(c))
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8")
            let json: any = null
            try {
              json = raw ? JSON.parse(raw) : null
            } catch {
              json = { _raw: raw }
            }
            resolve({ status: res.statusCode || 0, json })
          })
        },
      )
      req.on("error", reject)
      req.write(body)
      req.end()
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test("first screenshot with allow_page_export queues confirm and does not accept via HTTP ack", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)
  wireExfilConfirmer()
  const issued = issueOutboundGrant({
    label: "stack-hitl",
    caller_id: "stack-hitl",
    allow_page_export: true,
  })
  const grantBefore = listOutboundGrants().find((g) => g.id === issued.id)
  assert.ok(grantBefore)

  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const invokeP = companionInvokeOutbound({
    caller_id: "stack-hitl",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  const confirmation = await confirmationPromise
  assert.match(String(confirmation.tool_name || ""), /screenshot|Outbound/i)
  assert.equal(hasOutboundDisclosure("stack-hitl"), false)
  assert.equal(securityConfirmations.isPending(String(confirmation.confirmation_id)), true)

  const disc = await postDisclosureAck(issued.token, "stack-hitl")
  assert.equal(disc.json.ok, false)
  assert.equal(disc.json.error_code, "ACK_NOT_OPERATOR")
  assert.equal(hasOutboundDisclosure("stack-hitl"), false)
  assert.equal(securityConfirmations.isPending(String(confirmation.confirmation_id)), true)

  const grantMid = listOutboundGrants().find((g) => g.id === issued.id)
  assert.equal(grantMid?.allow_page_export, true)
  assert.equal(grantMid?.allow_page_export_at, grantBefore!.allow_page_export_at)

  clientSideWs.send(
    JSON.stringify({
      type: "security.confirmation.response",
      confirmation_id: confirmation.confirmation_id,
      approved: false,
    }),
  )
  const r = await invokeP
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "OUTBOUND_CONFIRM_REQUIRED")
  assert.equal(hasOutboundDisclosure("stack-hitl"), false)
  assert.equal(grantAllowsPageExport("stack-hitl"), true)
})

test("after operator confirm, second exfil in session passes hasOutboundDisclosure", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)
  wireExfilConfirmer()
  issueOutboundGrant({
    label: "stack-sess",
    caller_id: "stack-sess",
    allow_page_export: true,
  })
  armAutoToolResult({ png: "xx" })

  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const firstP = companionInvokeOutbound({
    caller_id: "stack-sess",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  const confirmation = await confirmationPromise
  clientSideWs.send(
    JSON.stringify({
      type: "security.confirmation.response",
      confirmation_id: confirmation.confirmation_id,
      approved: true,
    }),
  )
  const first = await firstP
  assert.equal(first.ok, true, `first exfil: ${JSON.stringify(first)}`)
  assert.equal(hasOutboundDisclosure("stack-sess"), true)

  let secondConfirm = false
  const sneak = (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === "security.confirmation.request") secondConfirm = true
    } catch {
      /* ignore */
    }
  }
  clientSideWs.on("message", sneak)
  const second = await companionInvokeOutbound({
    caller_id: "stack-sess",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  clientSideWs.off("message", sneak)
  assert.equal(second.ok, true, `second exfil: ${JSON.stringify(second)}`)
  assert.equal(hasOutboundDisclosure("stack-sess"), true)
  assert.equal(secondConfirm, false, "session disclosure must skip second HITL")
})

test("overlay socket cannot resolve exfil confirm", async () => {
  // Pin ACL at lifecycle: summoner never reaches respondFrom.
  const lifeSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "ws", "lifecycle.ts"),
    "utf8",
  )
  const aclIdx = lifeSrc.indexOf("assertSummonerAllowed")
  const respIdx = lifeSrc.indexOf('msg.type === "security.confirmation.response"')
  assert.ok(aclIdx >= 0 && respIdx >= 0 && aclIdx < respIdx, "lifecycle must ACL-gate before confirm.response")
  assert.equal(assertSummonerAllowed("summoner", "security.confirmation.response").ok, false)

  const httpSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "outbound-mcp", "companion-http.ts"),
    "utf8",
  )
  assert.match(httpSrc, /fanOutConfirmRequest/)
  assert.match(httpSrc, /resolveConfirmBinding/)
  assert.match(httpSrc, /isOutboundMcpCall:\s*true/)
  assert.doesNotMatch(httpSrc, /allow_page_export\s*=\s*true/)

  const overlay = await connectPeer()
  const overlayAuth = new Map<WebSocket, { authenticated?: boolean; origin?: string; surface?: string }>([
    [serverSideWs, { authenticated: true, origin: "chrome-extension://test", surface: "tray" }],
    [overlay.server, { authenticated: true, origin: "cmspark-tray://local", surface: "summoner" }],
  ])
  overlay.server.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === "security.confirmation.response") {
        const gate = assertSummonerAllowed("summoner", msg.type)
        if (!gate.ok) {
          overlay.server.send(JSON.stringify({ type: "error", error: gate.error, error_code: gate.error_code }))
          return
        }
        // Must not be reached in production — summoner is not on SUMMONER_ALLOW.
        securityConfirmations.respondFrom(String(msg.confirmation_id || ""), msg.approved === true, overlay.server)
      }
    } catch {
      /* ignore */
    }
  })

  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)
  wireExfilConfirmer(overlayAuth)
  issueOutboundGrant({
    label: "overlay-exfil",
    caller_id: "overlay-exfil",
    allow_page_export: true,
  })

  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const invokeP = companionInvokeOutbound({
    caller_id: "overlay-exfil",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  const confirmation = await confirmationPromise
  const confirmId = String(confirmation.confirmation_id)
  assert.equal(securityConfirmations.isPending(confirmId), true)

  const overlayErr = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout waiting for overlay ACL error")), 3000)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === "error" || msg.error_code === "SUMMONER_ACL") {
          clearTimeout(timeout)
          overlay.client.off("message", handler)
          resolve(msg)
        }
      } catch {
        /* ignore */
      }
    }
    overlay.client.on("message", handler)
  })
  overlay.client.send(
    JSON.stringify({
      type: "security.confirmation.response",
      confirmation_id: confirmId,
      approved: true,
    }),
  )
  const err = await overlayErr
  assert.equal(err.error_code, "SUMMONER_ACL")
  assert.equal(securityConfirmations.isPending(confirmId), true)
  assert.equal(hasOutboundDisclosure("overlay-exfil"), false)

  // Unbound origin: a non-extension tray socket can still respondFrom.
  // Binding originWs to the extension just to fail overlay would break this.
  const trayPeer = { id: "tray-unbound" } as unknown as WebSocket
  const fromTray = securityConfirmations.respondFrom(confirmId, true, trayPeer)
  assert.equal(fromTray.outcome, "resolved")
  armAutoToolResult({ png: "xx" })
  const r = await invokeP
  assert.equal(r.ok, true, `tray/unbound resolve: ${JSON.stringify(r)}`)
  assert.equal(hasOutboundDisclosure("overlay-exfil"), true)

  try {
    overlay.client.terminate()
    overlay.server.terminate()
  } catch {
    /* */
  }
})

test("revoke grant after HITL session still denies exfil", async () => {
  const executeTool = createToolExecutor(serverSideWs)
  wireTrustedOutboundRunner(executeTool)
  const issued = issueOutboundGrant({
    label: "rev-exec",
    caller_id: "rev-exec",
    allow_page_export: true,
  })
  await companionAcceptDisclosure("rev-exec")
  assert.equal(hasOutboundDisclosure("rev-exec"), true)
  assert.equal(revokeOutboundGrant(issued.id), true)
  assert.equal(grantAllowsPageExport("rev-exec"), false)
  assert.equal(hasOutboundDisclosure("rev-exec"), true)
  const r = await companionInvokeOutbound({
    caller_id: "rev-exec",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})
