/**
 * HTTP-layer e2e for outbound MCP loopback bridge (Pi N5 / adversary nit).
 *
 * Spins a real 127.0.0.1 server → handleOutboundMcpHttp → mock tool runner.
 * Also exercises createHttpOutboundDispatcher client against that server.
 *
 * MCPO-01: default require_grant=true — authenticated paths use cmg_ grants
 * (ws_secret alone is rejected).
 */

import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { getConfigDir, initDataDir } from "../src/config"
import { SkillEngine } from "../src/skills/skill-engine"
import { _resetTabLeasesForTests, releaseTabLease } from "../src/orchestrator/tab-lease"
import { WebSocket } from "ws"
import {
  handleOutboundMcpHttp,
  setOutboundToolRunner,
  setOutboundRunnerRefresh,
  setOutboundExfilConfirmer,
  resetOutboundCompanionHttpForTests,
  companionAcceptDisclosure,
  OUTBOUND_HEALTH_PATH,
  OUTBOUND_INVOKE_PATH,
  OUTBOUND_PROFILE_PATH,
  OUTBOUND_DISCLOSURE_PATH,
  OUTBOUND_CONTEXT_SESSION_PATH,
  setOutboundContextEngine,
} from "../src/outbound-mcp/companion-http"
import { clearAllOutboundDisclosureSessions, hasOutboundDisclosure } from "../src/outbound-mcp/disclosure-session"
import {
  createHttpOutboundDispatcher,
  companionPostDisclosure,
  companionOutboundHealth,
} from "../src/outbound-mcp/http-client"
import { setOutboundDispatcher, invokeOutboundTool } from "../src/outbound-mcp/bridge"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
  OUTBOUND_L1_INTERACT_PROFILE,
  OUTBOUND_CONTEXT_PROFILE,
  revokeOutboundGrant,
} from "../src/outbound-mcp/outbound-grants"
import { SecurityConfirmationManager } from "../src/security-confirmation"
import { getAuditLogPath } from "../src/packs/audit-log"

/** Legacy secret still accepted only when require_grant=false (not default). */
const SECRET = "e2e-test-ws-secret-not-for-prod"

function grantToken(caller_id: string): string {
  return issueOutboundGrant({ label: `e2e-${caller_id}`, caller_id }).token
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr === "object" && "port" in addr)
  return (addr as { port: number }).port
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function createOutboundTestServer(): http.Server {
  return http.createServer((req, res) => {
    void handleOutboundMcpHttp(req, res, SECRET).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    })
  })
}

function requestJson(
  port: number,
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown },
): Promise<{ status: number; json: any }> {
  const payload =
    opts?.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), "utf8")
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": payload.length,
              }
            : {}),
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
    if (payload) req.write(payload)
    req.end()
  })
}

test.beforeEach(() => {
  _resetTabLeasesForTests()
  resetOutboundCompanionHttpForTests()
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
  setOutboundDispatcher(null)
})

test("e2e: health is unauthenticated and reports runner none|wired", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const none = await requestJson(port, "GET", OUTBOUND_HEALTH_PATH)
    assert.equal(none.status, 200)
    assert.equal(none.json.status, "ok")
    assert.equal(none.json.runner, "none")
    assert.equal(none.json.service, "outbound-mcp")
    assert.equal(none.json.require_grant, true)

    setOutboundToolRunner(async () => ({ success: true, data: {} }))
    const wired = await requestJson(port, "GET", OUTBOUND_HEALTH_PATH)
    assert.equal(wired.json.runner, "wired")
  } finally {
    await close(server)
  }
})

test("e2e: invoke without bearer → 401 GRANT_REQUIRED (require_grant default)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      body: { caller_id: "x", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 401)
    assert.equal(r.json.error_code, "GRANT_REQUIRED")
  } finally {
    await close(server)
  }
})

test("e2e: invoke with wrong bearer → 401", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: "wrong-secret",
      body: { caller_id: "x", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 401)
  } finally {
    await close(server)
  }
})

test("e2e: ws_secret alone rejected when require_grant true", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: SECRET,
      body: { caller_id: "x", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 401)
    assert.equal(r.json.error_code, "GRANT_REQUIRED")
  } finally {
    await close(server)
  }
})

test("e2e: forbidden tool over HTTP never hits runner", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  let hit = false
  setOutboundToolRunner(async () => {
    hit = true
    return { success: true }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "cmspark__shell_exec" },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "PROFILE_FORBIDDEN")
    assert.equal(hit, false)
  } finally {
    await close(server)
  }
})

test("e2e: EXTENSION_UNAVAILABLE when no runner (auth ok)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("agent"),
      body: { caller_id: "agent", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "EXTENSION_UNAVAILABLE")
  } finally {
    await close(server)
  }
})

test("HTTP POST /disclosure with acknowledge does not arm exfil", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const token = grantToken("e2e-agent")
  const calls: string[] = []
  setOutboundToolRunner(async (_id, tool, params) => {
    calls.push(tool)
    if (tool === "list_tabs") return { success: true, data: { tabs: [{ id: 7 }] } }
    if (tool === "get_page_text") {
      assert.equal((params as any).tabId, 7)
      assert.equal((params as any).__outbound_mcp, true)
      return { success: true, data: { text: "hello e2e" } }
    }
    return { success: false, error: "unexpected tool " + tool }
  })
  try {
    // Exfil without allow_page_export
    const denied = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token,
      body: { caller_id: "e2e-agent", tool: "cmspark__get_page_text", args: { tabId: 7 } },
    })
    assert.equal(denied.status, 422)
    assert.equal(denied.json.error_code, "DISCLOSURE_NOT_GRANTED")
    assert.equal(calls.length, 0)

    // Disclosure without acknowledge
    const badAck = await requestJson(port, "POST", OUTBOUND_DISCLOSURE_PATH, {
      token,
      body: { caller_id: "e2e-agent", acknowledge: false },
    })
    assert.equal(badAck.status, 400)
    assert.equal(badAck.json.error_code, "ACK_REQUIRED")

    // Caller ack is not operator consent — must not arm the Map
    const disc = await requestJson(port, "POST", OUTBOUND_DISCLOSURE_PATH, {
      token,
      body: { caller_id: "e2e-agent", acknowledge: true },
    })
    assert.equal(disc.json.ok, false)
    assert.equal(disc.json.error_code, "ACK_NOT_OPERATOR")
    assert.notEqual(disc.status, 200)
    assert.equal(hasOutboundDisclosure("e2e-agent"), false)

    // list_tabs (non-exfil) still works
    const tabs = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token,
      body: { caller_id: "e2e-agent", tool: "cmspark__list_tabs" },
    })
    assert.equal(tabs.status, 200)
    assert.equal(tabs.json.ok, true)
    assert.deepEqual(tabs.json.data, { tabs: [{ id: 7 }] })
    assert.equal(tabs.json.internal_tool, "list_tabs")
    assert.equal(tabs.json.origin?.synthetic_origin, "outbound_mcp:e2e-agent")

    // get_page_text still fail-closed after HTTP ack
    const text = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token,
      body: {
        caller_id: "e2e-agent",
        tool: "cmspark__get_page_text",
        args: { tabId: 7 },
      },
    })
    assert.equal(text.status, 422)
    assert.equal(text.json.ok, false)
    assert.equal(text.json.error_code, "DISCLOSURE_NOT_GRANTED")
    assert.deepEqual(calls, ["list_tabs"])
  } finally {
    await close(server)
  }
})

test("grant allow_page_export still DISCLOSURE_HITL_REQUIRED without operator session", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const token = issueOutboundGrant({
    label: "e2e-hitl",
    caller_id: "hitl-agent",
    allow_page_export: true,
  }).token
  let hit = false
  setOutboundToolRunner(async () => {
    hit = true
    return { success: true, data: { text: "nope" } }
  })
  try {
    const denied = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token,
      body: { caller_id: "hitl-agent", tool: "cmspark__get_page_text", args: { tabId: 7 } },
    })
    assert.equal(denied.status, 422)
    assert.equal(denied.json.error_code, "DISCLOSURE_HITL_REQUIRED")
    assert.equal(hit, false)

    const disc = await requestJson(port, "POST", OUTBOUND_DISCLOSURE_PATH, {
      token,
      body: { caller_id: "hitl-agent", acknowledge: true },
    })
    assert.equal(disc.json.ok, false)
    assert.equal(disc.json.error_code, "ACK_NOT_OPERATOR")
    assert.equal(hasOutboundDisclosure("hitl-agent"), false)

    const still = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token,
      body: { caller_id: "hitl-agent", tool: "cmspark__screenshot", args: { tabId: 7 } },
    })
    assert.equal(still.status, 422)
    assert.equal(still.json.error_code, "DISCLOSURE_HITL_REQUIRED")
    assert.equal(hit, false)
  } finally {
    await close(server)
  }
})

test("e2e: two keys same caller — unflagged token denied, flagged token passes (W2)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const flagged = issueOutboundGrant({
    label: "flag",
    caller_id: "dual-http",
    allow_page_export: true,
  })
  const plain = issueOutboundGrant({ label: "plain", caller_id: "dual-http" })
  setOutboundToolRunner(async () => ({ success: true, data: { png: "x" } }))
  try {
    // Unflagged key: denied per-key even though caller-level has a flagged sibling.
    const denied = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: plain.token,
      body: { caller_id: "dual-http", tool: "cmspark__screenshot", args: { tabId: 7 } },
    })
    assert.equal(denied.status, 422)
    assert.equal(denied.json.error_code, "DISCLOSURE_NOT_GRANTED")

    // Operator HITL session (Confirm Center) arms the caller, flagged key passes.
    await companionAcceptDisclosure("dual-http")
    const ok = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: flagged.token,
      body: { caller_id: "dual-http", tool: "cmspark__screenshot", args: { tabId: 7 } },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.ok, true)

    // Unflagged key still denied with the caller HITL session armed.
    const still = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: plain.token,
      body: { caller_id: "dual-http", tool: "cmspark__screenshot", args: { tabId: 7 } },
    })
    assert.equal(still.status, 422)
    assert.equal(still.json.error_code, "DISCLOSURE_NOT_GRANTED")
  } finally {
    await close(server)
  }
})

test("e2e: refresh hook runs before HTTP invoke", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  let refreshCount = 0
  setOutboundRunnerRefresh(() => {
    refreshCount++
    // wire runner on refresh (simulates ensureOutboundToolRunnerWired)
    setOutboundToolRunner(async () => ({ success: true, data: { via: "refresh" } }))
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("r1"),
      body: { caller_id: "r1", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.deepEqual(r.json.data, { via: "refresh" })
    assert.ok(refreshCount >= 1)
  } finally {
    await close(server)
  }
})

test("e2e: http-client dispatcher + companionPostDisclosure end-to-end", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const token = grantToken("client-agent")
  setOutboundToolRunner(async (_id, tool) => {
    assert.equal(tool, "screenshot")
    return { success: true, data: { png: "base64" } }
  })
  try {
    const health = await companionOutboundHealth({ port, token })
    assert.equal(health.ok, true)
    assert.equal(health.runner, "wired")

    const remote = await companionPostDisclosure(
      { port, token },
      "client-agent",
    )
    assert.equal(remote.ok, false)
    assert.match(
      String(remote.error || ""),
      /ACK_NOT_OPERATOR|not operator consent/i,
    )
    assert.equal(hasOutboundDisclosure("client-agent"), false)

    setOutboundDispatcher(
      createHttpOutboundDispatcher({ port, token, timeout_ms: 10_000 }),
    )
    const r = await invokeOutboundTool({
      caller_id: "client-agent",
      tool: "cmspark__screenshot",
      args: { tabId: 3 },
    })
    assert.equal(r.ok, false)
    assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  } finally {
    await close(server)
  }
})

test("e2e: L9 click without tabId over HTTP → TAB_ID_REQUIRED", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  setOutboundToolRunner(async () => ({ success: true }))
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "cmspark__click", args: {} },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "TAB_ID_REQUIRED")
    assert.ok(r.json.data?.queue_disclosure_zh)
  } finally {
    await close(server)
  }
})

test("e2e: unknown outbound path under prefix → 404 JSON", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "GET", "/outbound-mcp/v1/nope", {
      token: grantToken("x"),
    })
    assert.equal(r.status, 404)
    assert.equal(r.json.error_code, "NOT_FOUND")
  } finally {
    await close(server)
  }
})

test("e2e: /outbound-mcp/v1/grants stays 404", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const r = await requestJson(port, "POST", "/outbound-mcp/v1/grants", {
      token: grantToken("x"),
      body: { caller_id: "x", allow_page_export: true },
    })
    assert.equal(r.status, 404)
    assert.equal(r.json.error_code, "NOT_FOUND")
  } finally {
    await close(server)
  }
})

test("e2e: runner DISPATCH_FAILED surfaces 422 over HTTP (CDP timeout not remapped)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  setOutboundToolRunner(async () => ({ success: false, error: "cdp timeout" }))
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("c"),
      body: {
        caller_id: "c",
        tool: "cmspark__wait_for",
        args: { tabId: 1, selector: "#x" },
      },
    })
    assert.equal(r.status, 422)
    // N1: generic CDP timeout must NOT become OUTBOUND_CONFIRM_REQUIRED
    assert.equal(r.json.error_code, "DISPATCH_FAILED")
    assert.match(r.json.error || "", /cdp timeout/)
  } finally {
    await close(server)
  }
})

test("e2e: security confirmation timeout maps to OUTBOUND_CONFIRM_REQUIRED", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  setOutboundToolRunner(async () => ({
    success: false,
    error: "Security confirmation timeout for navigate",
  }))
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("c"),
      body: {
        caller_id: "c",
        tool: "cmspark__navigate",
        args: { tabId: 1, url: "https://example.com" },
      },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "OUTBOUND_CONFIRM_REQUIRED")
    assert.match(r.json.error || "", /tray|Side Panel/i)
  } finally {
    await close(server)
  }
})

async function waitUntilE2E(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("waitUntil timeout")
}

function lastConfirmIdFrom(sent: string[]): string {
  for (let i = sent.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(sent[i]) as { type?: string; confirmation_id?: string }
      if (m.type === "security.confirmation.request" && m.confirmation_id) {
        return m.confirmation_id
      }
    } catch {
      /* ignore */
    }
  }
  throw new Error("no security.confirmation.request fanned out")
}

// R1: caller's HTTP client times out / disconnects while the operator HITL is
// pending → operator approves → the tool must NOT execute (fail-safe), and the
// skip must leave a distinct audit record (approved-but-not-executed).
test("e2e: caller disconnect during HITL wait → approved tool NOT executed (R1)", async () => {
  const server = createOutboundTestServer()
  const responseClosed = new Promise<void>(resolve => server.once("request", (_req, res) => res.once("close", resolve)))
  const port = await listen(server)
  const token = issueOutboundGrant({
    label: "e2e-r1",
    caller_id: "r1-agent",
    allow_page_export: true,
  }).token
  let runnerHit = false
  setOutboundToolRunner(async () => {
    runnerHit = true
    return { success: true, data: { png: "must-not-happen" } }
  })

  // Real confirmation manager + fake extension WS so the test can approve
  // the first-exfil HITL after the caller has gone away.
  const sent: string[] = []
  const ws = {
    readyState: WebSocket.OPEN,
    send: (s: unknown) => {
      sent.push(String(s))
    },
  } as unknown as WebSocket
  const mgr = new SecurityConfirmationManager()
  setOutboundExfilConfirmer({
    securityConfirmations: mgr,
    getClients: () => [ws],
    wsAuthGet: () => ({
      authenticated: true,
      origin: "chrome-extension://test",
      surface: "tray",
    }),
    getOriginatingWs: () => ws,
  })

  const payload = Buffer.from(
    JSON.stringify({
      caller_id: "r1-agent",
      tool: "cmspark__screenshot",
      args: { tabId: 7 },
    }),
    "utf8",
  )
  let creq!: http.ClientRequest
  const clientDone = new Promise<{ status: number | null }>((resolve) => {
    creq = http.request(
      {
        host: "127.0.0.1",
        port,
        path: OUTBOUND_INVOKE_PATH,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (cres) => {
        cres.resume()
        cres.on("end", () => resolve({ status: cres.statusCode || 0 }))
      },
    )
    // Caller-side destroy surfaces as ECONNRESET — that path is the point.
    creq.on("error", () => resolve({ status: null }))
    creq.write(payload)
    creq.end()
  })

  try {
    // Operator HITL pends (fan-out reached the "extension").
    await waitUntilE2E(() => sent.some((s) => s.includes("security.confirmation.request")))
    const confirmId = lastConfirmIdFrom(sent)
    assert.equal(runnerHit, false)

    // Caller HTTP client times out and hangs up mid-HITL.
    creq.destroy()
    // A local ClientRequest.destroyed bit precedes the server's disconnect
    // event. Assert the actual server boundary before simulating approval.
    await responseClosed

    // Operator approves AFTER the caller disconnected.
    const approved = mgr.respondFrom(confirmId, true, ws)
    assert.equal(approved.outcome, "resolved")

    const client = await clientDone
    assert.equal(client.status, null, "caller never receives a response (socket gone)")
    // Small settle so the post-HITL audit line is flushed before reading.
    await waitUntilE2E(() => {
      try {
        return fs
          .readFileSync(getAuditLogPath(), "utf8")
          .includes("CALLER_DISCONNECTED")
      } catch {
        return false
      }
    })

    assert.equal(runnerHit, false, "toolRunner must not run for a disconnected caller")

    const events = fs
      .readFileSync(getAuditLogPath(), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "outbound_mcp.tool" && e.caller_id === "r1-agent")
    // Operator approval itself is audited (distinct from the skip below).
    assert.ok(
      events.some((e) => e.ok === true && e.confirm_outcome === "approved"),
      `operator approval audited: ${JSON.stringify(events)}`,
    )
    // Approved-but-not-executed has its own explicit record.
    const skipped = events.find((e) => e.error_code === "CALLER_DISCONNECTED")
    assert.ok(skipped, `CALLER_DISCONNECTED audit exists: ${JSON.stringify(events)}`)
    assert.equal(skipped.ok, false)
    assert.equal(skipped.confirm_outcome, "approved")
    assert.equal(skipped.tool, "cmspark__screenshot")
  } finally {
    creq.destroy()
    await close(server)
  }
})

test("e2e #408: HTTP invoke short name list_tabs succeeds", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const seen: string[] = []
  setOutboundToolRunner(async (_id, tool) => {
    seen.push(tool)
    return { success: true, data: { tabs: [{ id: 9 }] } }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "list_tabs" },
    })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.ok, true)
    assert.deepEqual(seen, ["list_tabs"])
  } finally {
    await close(server)
  }
})

test("e2e #408: HTTP invoke canonical cmspark__list_tabs still succeeds", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  setOutboundToolRunner(async (_id, tool) => {
    assert.equal(tool, "list_tabs")
    return { success: true, data: { tabs: [] } }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "cmspark__list_tabs" },
    })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
  } finally {
    await close(server)
  }
})

test("e2e #408: HTTP short-name get_page_text without grant is DISCLOSURE_NOT_GRANTED", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  let hit = false
  setOutboundToolRunner(async () => {
    hit = true
    return { success: true }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "get_page_text" },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "DISCLOSURE_NOT_GRANTED")
    assert.equal(hit, false)
  } finally {
    await close(server)
  }
})

test("e2e #408: HTTP illegal name PROFILE_FORBIDDEN with accurate copy", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  let hit = false
  setOutboundToolRunner(async () => {
    hit = true
    return { success: true }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("x"),
      body: { caller_id: "x", tool: "mcp__cmspark__list_tabs" },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "PROFILE_FORBIDDEN")
    assert.match(String(r.json.error), /not a valid outbound MCP name/)
    assert.doesNotMatch(String(r.json.error), /not on the default outbound L1 profile/)
    assert.equal(hit, false)
  } finally {
    await close(server)
  }
})

test("e2e #410: /profile returns the interact profile + trimmed tool set for an interact grant", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const interactTok = issueOutboundGrant({
      label: "i",
      caller_id: "i1",
      profile: OUTBOUND_L1_INTERACT_PROFILE,
    }).token
    const r = await requestJson(port, "GET", OUTBOUND_PROFILE_PATH, {
      token: interactTok,
    })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.ok, true)
    assert.equal(r.json.profile, OUTBOUND_L1_INTERACT_PROFILE)
    const tools: string[] = r.json.tools
    assert.ok(tools.includes("cmspark__scroll"), "interact includes scroll")
    assert.ok(tools.includes("cmspark__get_page_html"), "interact includes get_page_html")
    assert.ok(tools.includes("cmspark__list_tabs"), "interact keeps the default 8")
    assert.ok(r.json.wire_tools.includes("scroll"))
  } finally {
    await close(server)
  }
})

test("e2e #410: /profile default grant advertises default set only (no scroll)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const tok = grantToken("d1")
    const r = await requestJson(port, "GET", OUTBOUND_PROFILE_PATH, { token: tok })
    assert.equal(r.status, 200)
    assert.equal(r.json.profile, "outbound_l1_default")
    const tools: string[] = r.json.tools
    assert.ok(!tools.includes("cmspark__scroll"), "default key must not see scroll")
    assert.ok(tools.includes("cmspark__list_tabs"))
  } finally {
    await close(server)
  }
})

test("e2e #410: /profile without a valid bearer is 401 (no profile enumeration)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  try {
    const none = await requestJson(port, "GET", OUTBOUND_PROFILE_PATH)
    assert.equal(none.status, 401)
    assert.equal(none.json.ok, false)
    const bad = await requestJson(port, "GET", OUTBOUND_PROFILE_PATH, {
      token: "cmg_notarealkey",
    })
    assert.equal(bad.status, 401)
  } finally {
    await close(server)
  }
})

test("e2e #410: interact grant invokes scroll over HTTP invoke (per-key profile)", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  const seen: string[] = []
  setOutboundToolRunner(async (_id, tool) => {
    seen.push(tool)
    return { success: true, data: { ok: true } }
  })
  try {
    const tok = issueOutboundGrant({
      label: "i",
      caller_id: "i2",
      profile: OUTBOUND_L1_INTERACT_PROFILE,
    }).token
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: tok,
      body: { caller_id: "i2", tool: "scroll", args: { tabId: 424210, amount: 300 } },
    })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.ok, true, JSON.stringify(r.json))
    assert.deepEqual(seen, ["scroll"])
  } finally {
    await close(server)
  }
})

test("e2e #410: default grant invoking interact tool scroll → PROFILE_FORBIDDEN", async () => {
  const server = createOutboundTestServer()
  const port = await listen(server)
  let hit = false
  setOutboundToolRunner(async () => {
    hit = true
    return { success: true, data: {} }
  })
  try {
    const r = await requestJson(port, "POST", OUTBOUND_INVOKE_PATH, {
      token: grantToken("d2"),
      body: { caller_id: "d2", tool: "scroll", args: { tabId: 1 } },
    })
    assert.equal(r.status, 422)
    assert.equal(r.json.error_code, "PROFILE_FORBIDDEN")
    assert.equal(hit, false)
  } finally {
    await close(server)
  }
})

test("#456 HTTP binds exact grant/session, projects selected knowledge, and never borrows sibling permissions", async () => {
  await initDataDir()
  assert.match(getConfigDir(), /cmspark-grants-/)
  const dir = path.join(getConfigDir(), "skills")
  fs.mkdirSync(dir, { recursive: true })
  for (const id of ["selected", "private"]) fs.writeFileSync(path.join(dir, `context-${id}.md`), `---\nname: context-${id}\ntype: site_knowledge\nsite: devops.example.test\ndescription: ${id}\n---\n${id.toUpperCase()}_HTTP_KNOWLEDGE\n`)
  setOutboundContextEngine(new SkillEngine())
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))
  const grant = issueOutboundGrant({ caller_id: "context-client", label: "context", profile: OUTBOUND_CONTEXT_PROFILE,
    allow_context_export: true, context_origins: [fixture.data.provenance.target.origin], context_knowledge_ids: ["context-selected"] })
  const sibling = issueOutboundGrant({ caller_id: "context-client", label: "sibling", profile: OUTBOUND_CONTEXT_PROFILE, allow_page_export: true })
  let pageReads = 0; let metadataReads = 0
  setOutboundToolRunner(async (_id, tool, _args, options) => {
    if (tool === "list_tabs" && options?.siteContextTabId === 7) { metadataReads++; return { success: true, data: { site_target: fixture.data.provenance.target } } }
    if (tool === "get_page_text") { pageReads++; return structuredClone(fixture) }
    return { success: false, error: "synthetic local failure" }
  })
  const server = createOutboundTestServer(); const port = await listen(server)
  const post = (token: string, endpoint: string, body: unknown) => requestJson(port, "POST", endpoint, { token, body })
  const auditOffset = fs.existsSync(getAuditLogPath()) ? fs.readFileSync(getAuditLogPath(), "utf8").length : 0
  try {
    assert.equal((await requestJson(port, "POST", OUTBOUND_CONTEXT_SESSION_PATH, { body: {} })).status, 401)
    assert.equal((await post(grantToken("ordinary"), OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "ordinary" })).status, 403)
    assert.equal((await post(grant.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "forged" })).status, 403)
    const session = await post(grant.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "context-client", session_id: "forged" })
    assert.equal(session.status, 200)
    assert.equal(session.json.session_id, undefined)
    assert.match(session.json.session_handle, /^[0-9a-f-]{36}$/)
    const siblingSession = await post(sibling.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "context-client" })
    const invoke = (token: string, handle: string, tool = "site_context", args: unknown = { tabId: 7 }) => post(token, OUTBOUND_INVOKE_PATH, { caller_id: "context-client", session_handle: handle, tool, args })
    const projected = await invoke(grant.token, session.json.session_handle)
    assert.equal(projected.json.ok, true, JSON.stringify(projected.json))
    assert.match(JSON.stringify(projected.json.data), /SELECTED_HTTP_KNOWLEDGE/)
    assert.doesNotMatch(JSON.stringify(projected.json.data), /PRIVATE_HTTP_KNOWLEDGE|observations|mutation_result/)
    assert.equal(projected.json.data.prompt, undefined)
    assert.equal(metadataReads, 2)
    assert.equal((await invoke(sibling.token, session.json.session_handle)).json.error_code, "SCOPE_DENIED")
    assert.equal((await invoke(grant.token, "nonexistent-handle")).json.session_invalid, true)
    assert.equal((await invoke(sibling.token, siblingSession.json.session_handle)).json.error_code, "GRANT_DENIED")
    assert.equal((await invoke(grant.token, session.json.session_handle, "site_context", { tabId: 7, thread_id: "chat" })).json.ok, false)
    await companionAcceptDisclosure("context-client")
    assert.equal((await invoke(grant.token, session.json.session_handle, "get_page_text")).json.ok, false)
    assert.equal(pageReads, 0)
    await invoke(grant.token, session.json.session_handle, "wait_for")
    assert.equal((await invoke(grant.token, session.json.session_handle)).json.data.experiences[0].failures, 1)
    const second = await post(grant.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "context-client" })
    assert.deepEqual((await invoke(grant.token, second.json.session_handle)).json.data.experiences, [])
    for (let i = 0; i < 14; i++) assert.equal((await post(grant.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "context-client" })).status, 200)
    assert.equal((await post(grant.token, OUTBOUND_CONTEXT_SESSION_PATH, { caller_id: "context-client" })).json.error_code, "CAPACITY")
    const auditText = fs.readFileSync(getAuditLogPath(), "utf8").slice(auditOffset)
    const auditEvents = auditText.trim().split("\n").map(line => JSON.parse(line)).filter(event => event.type === "outbound_mcp.tool")
    assert.ok(auditEvents.some(event => event.tool === "cmspark__context_session" && event.ok && event.grant_id === grant.id))
    assert.ok(auditEvents.some(event => event.tool === "cmspark__context_session" && event.error_code === "GRANT_REQUIRED" && event.caller_id === "http-unknown"))
    assert.ok(auditEvents.some(event => event.tool === "cmspark__context_session" && event.error_code === "CAPACITY" && event.grant_id === grant.id))
    assert.ok(auditEvents.some(event => event.error_code === "SCOPE_DENIED" && event.grant_id === sibling.id && event.session_invalid === undefined))
    assert.ok(auditEvents.some(event => event.error_code === "SCOPE_DENIED" && event.grant_id === grant.id && event.session_invalid === true))
    for (const secret of [grant.token, sibling.token, session.json.session_handle, siblingSession.json.session_handle, "nonexistent-handle"]) assert.equal(auditText.includes(secret), false)
    revokeOutboundGrant(grant.id)
    assert.equal((await invoke(grant.token, session.json.session_handle)).status, 403)
  } finally { await close(server); for (const id of ["selected", "private"]) fs.rmSync(path.join(dir, `context-${id}.md`)) }
})

test("#456 HTTP dispatcher owns a session; capture is isolated and mid-read revocation discards export", async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))
  const evidenceDir = path.join(getConfigDir(), "business-evidence-v1")
  const before = new Set(fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : [])
  const grant = issueOutboundGrant({ caller_id: "capture-client", label: "capture", profile: OUTBOUND_CONTEXT_PROFILE, allow_page_export: true })
  await companionAcceptDisclosure("capture-client")
  let revoke = false; let reads = 0
  setOutboundToolRunner(async (_id, tool, _args, options) => {
    if (tool === "list_tabs" && options?.siteContextTabId === 7) return { success: true, data: { site_target: fixture.data.provenance.target } }
    reads++
    if (revoke) revokeOutboundGrant(grant.id)
    return structuredClone(fixture)
  })
  const server = createOutboundTestServer(); const port = await listen(server)
  try {
    const dispatcher = createHttpOutboundDispatcher({ port, token: grant.token, contextSession: () => true })
    const call = () => dispatcher({ caller_id: "capture-client", mcp_tool: "cmspark__get_page_text", internal_tool: "get_page_text", args: { tabId: 7 }, origin: {} as any })
    const captured = await call()
    assert.equal(captured.success, true, captured.error)
    assert.equal((captured.data as any).evidence_capture.capture_status, "captured")
    const files = fs.readdirSync(evidenceDir).filter(file => !before.has(file))
    assert.equal(files.length, 1)
    const saved = JSON.parse(fs.readFileSync(path.join(evidenceDir, files[0]), "utf8"))
    assert.equal(saved.observations.length, 1)
    assert.equal(saved.observations[0].id, (captured.data as any).observation_id)
    revoke = true
    const denied = await call()
    assert.equal(denied.success, false)
    assert.equal(denied.data, undefined)
    assert.equal(reads, 2, "no automatic retry")
    assert.equal(JSON.parse(fs.readFileSync(path.join(evidenceDir, files[0]), "utf8")).observations.length, 1)
  } finally { await close(server) }
})

test("#456 origin denial preserves the client session; expiry during metadata prevents execution and only next call resumes", async t => {
  await initDataDir()
  setOutboundContextEngine(new SkillEngine())
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))
  const { siteTargetFromBrowser } = await import("../src/site-context/target")
  const grant = issueOutboundGrant({ caller_id: "ttl-client", label: "ttl", profile: OUTBOUND_CONTEXT_PROFILE, allow_context_export: true,
    context_origins: [fixture.data.provenance.target.origin], context_knowledge_ids: [] })
  let clock = Date.now(); t.mock.method(Date, "now", () => clock)
  let otherOrigin = false; let expire = false; let actions = 0; let sessions = 0
  setOutboundToolRunner(async (_id, tool, _args, options) => {
    if (tool === "list_tabs" && options?.siteContextTabId === 7) {
      if (expire) { clock += 31 * 60_000; expire = false }
      return { success: true, data: { site_target: otherOrigin ? siteTargetFromBrowser(7, "https://other.test/page", clock) : fixture.data.provenance.target } }
    }
    actions++; return { success: true, data: {} }
  })
  const server = createOutboundTestServer()
  server.on("request", req => { if (req.url === OUTBOUND_CONTEXT_SESSION_PATH) sessions++ })
  const port = await listen(server)
  try {
    const dispatch = createHttpOutboundDispatcher({ port, token: grant.token, contextSession: () => true })
    const call = (tool = "site_context") => dispatch({ caller_id: "ttl-client", internal_tool: tool, mcp_tool: tool, args: { tabId: 7 }, origin: {} as any })
    assert.equal((await call()).success, true)
    otherOrigin = true
    assert.equal((await call()).error, "SCOPE_DENIED")
    otherOrigin = false
    assert.equal((await call()).success, true)
    assert.equal(sessions, 1, "wrong origin must not discard a valid handle")
    expire = true
    assert.equal((await call("wait_for")).error, "SCOPE_DENIED")
    assert.equal(actions, 0, "session expired during async metadata must stop before actual operation")
    assert.equal(sessions, 1, "no automatic retry")
    // Advancing the clock also expires the independent tab lease. This
    // harness has no lifecycle worker; settle that lease before resuming.
    releaseTabLease(7, "synthetic TTL rehearsal", "outbound_mcp:ttl-client")
    const resumed = await call("wait_for")
    assert.equal(resumed.success, true, JSON.stringify(resumed))
    assert.equal(actions, 1)
    assert.equal(sessions, 2, "only next explicit call obtains a replacement session")
    const auditEvents = fs.readFileSync(getAuditLogPath(), "utf8").trim().split("\n").map(line => JSON.parse(line))
      .filter(event => event.type === "outbound_mcp.tool" && event.grant_id === grant.id && event.error_code === "SCOPE_DENIED")
    assert.ok(auditEvents.some(event => event.tool === "cmspark__site_context" && event.session_invalid === undefined), "origin denial remains distinguishable")
    assert.ok(auditEvents.some(event => event.tool === "cmspark__wait_for" && event.session_invalid === true), "mid-metadata expiry is explicitly audited")
  } finally { await close(server) }
})
