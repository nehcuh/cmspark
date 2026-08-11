/**
 * Cookie trust + URL navigate admission (C10 Phase C).
 * Isolates DATA_DIR before config module load.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-url-cookie-adm-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp
process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import {
  COOKIE_TOOLS,
  URL_GATE_TOOLS,
  runCookieTrustAdmission,
  runUrlNavigateAdmission,
} from "../src/tool/url-cookie-admission"
import { initDataDir, getConfig, saveConfig } from "../src/config"

function noopLog() {
  /* silence finish log */
}

function getDomainFromUrl(urlString: string): string {
  try {
    return new URL(urlString).hostname
  } catch {
    return ""
  }
}

before(async () => {
  await initDataDir()
  // Clean security flags for isolation
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: {
      ...getConfig().security,
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
  })
})

describe("COOKIE_TOOLS / URL_GATE_TOOLS membership", () => {
  it("COOKIE_TOOLS has the four cookie tools", () => {
    assert.deepEqual([...COOKIE_TOOLS].sort(), [
      "delete_cookie",
      "get_cookies",
      "list_all_cookies",
      "set_cookie",
    ])
  })

  it("URL_GATE_TOOLS has navigate / create_tab / set_tab_url", () => {
    assert.deepEqual([...URL_GATE_TOOLS].sort(), [
      "create_tab",
      "navigate",
      "set_tab_url",
    ])
  })

  it("non-cookie tools pass cookie admission immediately", () => {
    const r = runCookieTrustAdmission({
      toolName: "navigate",
      finalParams: {},
      toolCallId: "t1",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r.ok, true)
  })
})

describe("runCookieTrustAdmission", () => {
  it("blocks get_cookies on untrusted domain", () => {
    saveConfig({
      trusted_domains: ["example.com"],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: false,
      },
    })
    const r = runCookieTrustAdmission({
      toolName: "get_cookies",
      finalParams: { domain: "evil.com" },
      toolCallId: "c1",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.result.success, false)
      assert.match(r.result.error, /Security Block/)
      assert.equal(r.result.data?.error_code, "COOKIE_TRUST_DENIED")
    }
  })

  it("allows get_cookies on trusted domain", () => {
    saveConfig({ trusted_domains: ["example.com"] })
    const r = runCookieTrustAdmission({
      toolName: "get_cookies",
      finalParams: { domain: "example.com" },
      toolCallId: "c2",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r.ok, true)
  })

  it("set_cookie resolves domain from url when domain omitted", () => {
    saveConfig({ trusted_domains: ["good.example"] })
    const r = runCookieTrustAdmission({
      toolName: "set_cookie",
      finalParams: { url: "https://good.example/path", name: "a", value: "b" },
      toolCallId: "c3",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r.ok, true)
  })

  it("waives cookie trust under full autonomy cruise (three flags)", () => {
    saveConfig({
      trusted_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
    })
    const r = runCookieTrustAdmission({
      toolName: "get_cookies",
      finalParams: { domain: "evil.com" },
      toolCallId: "c4",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r.ok, true)

    // partial flags still block
    saveConfig({
      trusted_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: false,
      },
    })
    const r2 = runCookieTrustAdmission({
      toolName: "get_cookies",
      finalParams: { domain: "evil.com" },
      toolCallId: "c5",
      startedAt: Date.now(),
      logToolFinish: noopLog,
      getDomainFromUrl,
    })
    assert.equal(r2.ok, false)

    // restore safe defaults for later suites
    saveConfig({
      trusted_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: false,
      },
    })
  })
})

describe("runUrlNavigateAdmission", () => {
  const fakeWs = { readyState: WebSocket.OPEN } as WebSocket

  it("non-URL-gate tools pass immediately", async () => {
    const r = await runUrlNavigateAdmission({
      toolName: "get_cookies",
      finalParams: {},
      toolCallId: "u0",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: { request: async () => ({ approved: false, reason: "denied" }) } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, true)
  })

  it("rejects invalid URL", async () => {
    const r = await runUrlNavigateAdmission({
      toolName: "navigate",
      finalParams: { url: "not a url" },
      toolCallId: "u1",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: { request: async () => ({ approved: true, reason: "approved" }) } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.match(r.result.error, /Invalid URL/)
    }
  })

  it("hard-blocks non-http(s) schemes when allow_all_schemes is false", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: false,
      },
    })
    const r = await runUrlNavigateAdmission({
      toolName: "navigate",
      finalParams: { url: "file:///etc/passwd" },
      toolCallId: "u2",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: { request: async () => ({ approved: true, reason: "approved" }) } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.match(r.result.error, /scheme is not allowed/)
    }
  })

  it("auto-approves host on auto_approved_domains without confirmation", async () => {
    saveConfig({
      auto_approved_domains: ["safe.example"],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        allow_all_schemes: false,
      },
    })
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: "https://safe.example/x" },
      toolCallId: "u3",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => {
          confirmCalled = true
          return { approved: false, reason: "denied" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, true)
    assert.equal(confirmCalled, false)
  })

  it("requests confirmation for untrusted host and fails on deny", async () => {
    saveConfig({
      auto_approved_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        allow_all_schemes: false,
      },
    })
    const r = await runUrlNavigateAdmission({
      toolName: "set_tab_url",
      finalParams: { url: "https://evil.example/", tabId: 1 },
      toolCallId: "u4",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => ({ approved: false, reason: "denied" }),
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.match(r.result.error, /denied by user/)
    }
  })
})
