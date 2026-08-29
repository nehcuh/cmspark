import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { WebSocket } from "ws"
import {
  companionInvokeOutbound,
  companionAcceptDisclosure,
  authorizeOutboundHttp,
  setOutboundToolRunner,
  setOutboundExfilConfirmer,
  resetOutboundCompanionHttpForTests,
  extractBearerToken,
  handleOutboundMcpHttp,
  OUTBOUND_DISCLOSURE_PATH,
} from "../src/outbound-mcp/companion-http"
import { clearAllOutboundDisclosureSessions, hasOutboundDisclosure } from "../src/outbound-mcp/disclosure-session"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
  listOutboundGrants,
  revokeOutboundGrant,
  grantAllowsPageExport,
} from "../src/outbound-mcp/outbound-grants"
import { SecurityConfirmationManager } from "../src/security-confirmation"
import { _resetTabLeasesForTests } from "../src/orchestrator/tab-lease"
import type { IncomingMessage } from "http"

function fakeReq(auth?: string): IncomingMessage {
  return { headers: { authorization: auth } } as IncomingMessage
}

test.beforeEach(() => {
  resetOutboundCompanionHttpForTests()
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
  _resetTabLeasesForTests()
})

test("authorizeOutboundHttp requires matching bearer", () => {
  assert.equal(authorizeOutboundHttp(fakeReq(), "secret"), false)
  assert.equal(authorizeOutboundHttp(fakeReq("Bearer wrong"), "secret"), false)
  assert.equal(authorizeOutboundHttp(fakeReq("Bearer secret"), "secret"), true)
  assert.equal(extractBearerToken(fakeReq("Bearer abc")), "abc")
})

test("companion invoke refuses forbidden tools", async () => {
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__shell_exec",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "PROFILE_FORBIDDEN")
})

test("companion invoke refuses exfil without disclosure even with runner", async () => {
  setOutboundToolRunner(async () => ({ success: true, data: { text: "x" } }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__get_page_text",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})

test("companion invoke EXTENSION_UNAVAILABLE without runner", async () => {
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "EXTENSION_UNAVAILABLE")
})

test("companion invoke dispatches via runner after gate", async () => {
  const calls: { tool: string; id: string; params: any }[] = []
  setOutboundToolRunner(async (id, tool, params) => {
    calls.push({ tool, id, params })
    assert.equal(tool, "list_tabs")
    return { success: true, data: { tabs: [{ id: 1 }] } }
  })
  const r = await companionInvokeOutbound({
    caller_id: "agent",
    tool: "cmspark__list_tabs",
    args: {},
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, { tabs: [{ id: 1 }] })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].id.startsWith("ob_"))
  assert.equal(r.origin?.synthetic_origin, "outbound_mcp:agent")
  // L8 flag for confirm fan-out
  assert.equal(calls[0].params.__outbound_mcp, true)
  assert.equal(calls[0].params.__outbound_caller_id, "agent")
})

test("companionAcceptDisclosure without allow_page_export does not arm exfil", async () => {
  await companionAcceptDisclosure("d1")
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})

test("grant allow_page_export still DISCLOSURE_HITL_REQUIRED without operator session", async () => {
  issueOutboundGrant({ label: "t", caller_id: "d1", allow_page_export: true })
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_HITL_REQUIRED")
  assert.equal(hasOutboundDisclosure("d1"), false)
})

test("companion exfil after grant flag plus operator session reaches runner", async () => {
  issueOutboundGrant({ label: "t", caller_id: "d1", allow_page_export: true })
  await companionAcceptDisclosure("d1")
  setOutboundToolRunner(async (_id, tool) => {
    assert.equal(tool, "screenshot")
    return { success: true, data: { ok: true } }
  })
  // L9: screenshot needs tabId
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, true)
})

test("companion interactive without tabId → TAB_ID_REQUIRED (L9)", async () => {
  setOutboundToolRunner(async () => ({ success: true }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__click",
    args: {},
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "TAB_ID_REQUIRED")
})

test("runner failure surfaces DISPATCH_FAILED", async () => {
  setOutboundToolRunner(async () => ({ success: false, error: "tab gone" }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISPATCH_FAILED")
  assert.match(r.error || "", /tab gone/)
})

test("runner confirm timeout maps to OUTBOUND_CONFIRM_REQUIRED (L8)", async () => {
  setOutboundToolRunner(async () => ({
    success: false,
    error: "Security confirmation timeout for navigate",
  }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__navigate",
    args: { tabId: 2, url: "https://example.com" },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "OUTBOUND_CONFIRM_REQUIRED")
  assert.match(r.error || "", /tray|Side Panel/i)
})

function fakeOpenWs(sent: string[]): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: (s: string) => {
      sent.push(String(s))
    },
  } as unknown as WebSocket
}

function wireLocalExfilConfirmer(sent: string[]): {
  ws: WebSocket
  mgr: SecurityConfirmationManager
} {
  const ws = fakeOpenWs(sent)
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
  return { ws, mgr }
}

async function waitUntil(fn: () => boolean, timeoutMs = 1000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("waitUntil timeout")
}

function lastConfirmId(sent: string[]): string {
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
  throw new Error(`no security.confirmation.request in ${sent.join(" | ")}`)
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
  const issued = issueOutboundGrant({
    label: "hitl",
    caller_id: "exfil-http",
    allow_page_export: true,
  })
  const grantBefore = listOutboundGrants().find((g) => g.id === issued.id)
  assert.ok(grantBefore)
  let runnerHit = false
  setOutboundToolRunner(async () => {
    runnerHit = true
    return { success: true, data: { png: "xx" } }
  })
  const sent: string[] = []
  const { ws, mgr } = wireLocalExfilConfirmer(sent)

  const invokeP = companionInvokeOutbound({
    caller_id: "exfil-http",
    tool: "cmspark__screenshot",
    args: { tabId: 801 },
  })
  await waitUntil(() => sent.some((s) => s.includes("security.confirmation.request")))
  const confirmId = lastConfirmId(sent)
  assert.equal(hasOutboundDisclosure("exfil-http"), false)
  assert.equal(runnerHit, false)

  const disc = await postDisclosureAck(issued.token, "exfil-http")
  assert.equal(disc.json.ok, false)
  assert.equal(disc.json.error_code, "ACK_NOT_OPERATOR")
  assert.notEqual(disc.status, 200)
  assert.equal(hasOutboundDisclosure("exfil-http"), false)
  assert.equal(mgr.isPending(confirmId), true)

  const grantMid = listOutboundGrants().find((g) => g.id === issued.id)
  assert.equal(grantMid?.allow_page_export, true)
  assert.equal(grantMid?.allow_page_export_at, grantBefore!.allow_page_export_at)

  const denied = mgr.respondFrom(confirmId, false, ws)
  assert.equal(denied.outcome, "resolved")
  const r = await invokeP
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "OUTBOUND_CONFIRM_REQUIRED")
  assert.equal(hasOutboundDisclosure("exfil-http"), false)
  assert.equal(runnerHit, false)

  const grantAfter = listOutboundGrants().find((g) => g.id === issued.id)
  assert.equal(grantAfter?.allow_page_export, true)
  assert.equal(grantAfter?.allow_page_export_at, grantBefore!.allow_page_export_at)
})

test("after operator confirm, second exfil in session passes hasOutboundDisclosure", async () => {
  issueOutboundGrant({
    label: "hitl2",
    caller_id: "exfil-sess",
    allow_page_export: true,
  })
  const tools: string[] = []
  setOutboundToolRunner(async (_id, tool) => {
    tools.push(tool)
    return { success: true, data: { ok: true } }
  })
  const sent: string[] = []
  const { ws, mgr } = wireLocalExfilConfirmer(sent)

  const firstP = companionInvokeOutbound({
    caller_id: "exfil-sess",
    tool: "cmspark__screenshot",
    args: { tabId: 802 },
  })
  await waitUntil(() => sent.some((s) => s.includes("security.confirmation.request")))
  const confirmId = lastConfirmId(sent)
  const approved = mgr.respondFrom(confirmId, true, ws)
  assert.equal(approved.outcome, "resolved")
  const first = await firstP
  assert.equal(first.ok, true, `first exfil: ${JSON.stringify(first)}`)
  assert.equal(hasOutboundDisclosure("exfil-sess"), true)
  assert.deepEqual(tools, ["screenshot"])

  const grants = listOutboundGrants().filter((g) => g.caller_id === "exfil-sess")
  assert.equal(grants.length, 1)
  assert.equal(grants[0].allow_page_export, true)

  const requestCount = sent.filter((s) => s.includes("security.confirmation.request")).length
  const second = await companionInvokeOutbound({
    caller_id: "exfil-sess",
    tool: "cmspark__get_page_text",
    args: { tabId: 802 },
  })
  assert.equal(second.ok, true, `second exfil: ${JSON.stringify(second)}`)
  assert.equal(hasOutboundDisclosure("exfil-sess"), true)
  assert.deepEqual(tools, ["screenshot", "get_page_text"])
  assert.equal(
    sent.filter((s) => s.includes("security.confirmation.request")).length,
    requestCount,
    "second exfil must not queue another first-exfil confirm",
  )
})

test("HTTP grant track: unflagged key denied even when sibling key is flagged (W2)", async () => {
  issueOutboundGrant({ label: "flag", caller_id: "dual", allow_page_export: true })
  const plain = issueOutboundGrant({ label: "plain", caller_id: "dual" })
  // Even with the operator HITL session armed for the caller, this key must not exfil.
  await companionAcceptDisclosure("dual")
  let runnerHit = false
  setOutboundToolRunner(async () => {
    runnerHit = true
    return { success: true, data: { ok: true } }
  })
  const r = await companionInvokeOutbound(
    { caller_id: "dual", tool: "cmspark__screenshot", args: { tabId: 1 } },
    { grant_id: plain.id },
  )
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.equal(runnerHit, false)
})

test("HTTP grant track: flagged key passes with operator session (W2)", async () => {
  const flagged = issueOutboundGrant({
    label: "flag",
    caller_id: "dual2",
    allow_page_export: true,
  })
  issueOutboundGrant({ label: "plain", caller_id: "dual2" })
  await companionAcceptDisclosure("dual2")
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const r = await companionInvokeOutbound(
    { caller_id: "dual2", tool: "cmspark__screenshot", args: { tabId: 1 } },
    { grant_id: flagged.id },
  )
  assert.equal(r.ok, true, JSON.stringify(r))
})

test("revoke grant → exfil fails even if disclosure Map still has caller", async () => {
  const issued = issueOutboundGrant({
    label: "rev",
    caller_id: "revoked-exfil",
    allow_page_export: true,
  })
  await companionAcceptDisclosure("revoked-exfil")
  assert.equal(hasOutboundDisclosure("revoked-exfil"), true)
  assert.equal(grantAllowsPageExport("revoked-exfil"), true)
  setOutboundToolRunner(async () => ({ success: true, data: { png: "nope" } }))

  assert.equal(revokeOutboundGrant(issued.id), true)
  assert.equal(grantAllowsPageExport("revoked-exfil"), false)
  assert.equal(hasOutboundDisclosure("revoked-exfil"), true)

  const r = await companionInvokeOutbound({
    caller_id: "revoked-exfil",
    tool: "cmspark__screenshot",
    args: { tabId: 803 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})
