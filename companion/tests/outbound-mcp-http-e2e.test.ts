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
  OUTBOUND_DISCLOSURE_PATH,
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
    await waitUntilE2E(() => creq.destroyed)

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
