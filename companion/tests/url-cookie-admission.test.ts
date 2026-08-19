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
import { pathToFileURL } from "node:url"
import {
  COOKIE_TOOLS,
  URL_GATE_TOOLS,
  runCookieTrustAdmission,
  runUrlNavigateAdmission,
} from "../src/tool/url-cookie-admission"
import { FILE_OPEN_CAGE_TOKEN } from "../src/tool/file-url-admission"
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
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "navigate",
      finalParams: { url: "javascript:alert(1)" },
      toolCallId: "u2",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => {
          confirmCalled = true
          return { approved: true, reason: "approved" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    assert.equal(confirmCalled, false)
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

  it("cages file:///etc/passwd with no confirmation (not scheme L1)", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: false,
      },
    })
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "navigate",
      finalParams: { url: "file:///etc/passwd" },
      toolCallId: "u-file-etc",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => {
          confirmCalled = true
          return { approved: true, reason: "approved" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    assert.equal(confirmCalled, false)
    if (!r.ok) {
      assert.ok(r.result.error.includes(FILE_OPEN_CAGE_TOKEN))
      assert.doesNotMatch(r.result.error, /scheme is not allowed/)
    }
  })

  it("requests L2 for file: under HOME and does not skip via auto_approve_dangerous", async () => {
    const downloads = path.join(os.homedir(), "Downloads")
    fs.mkdirSync(downloads, { recursive: true })
    const pdf = path.join(downloads, "invoice.pdf")
    fs.writeFileSync(pdf, "pdf")
    saveConfig({
      auto_approved_domains: ["localhost", "*"],
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: true,
      },
    })
    let captured: any = null
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: pathToFileURL(pdf).href },
      toolCallId: "u-file-home",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async (_send: any, details: any) => {
          captured = details
          return { approved: false, reason: "denied" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    assert.ok(captured, "file: under home must HITL")
    assert.deepEqual(captured.relevantDomains, [])
    assert.match(String(captured.toolName), /打开本地文件/)
    assert.ok(String(captured.code).includes(pdf) || String(captured.code).includes("invoice.pdf"))
    assert.doesNotMatch(String(captured.code), /open_local_file/)
    if (!r.ok) assert.match(r.result.error, /denied by user/)
  })

  it("file://localhost HOME path still confirms when localhost is auto-approved", async () => {
    const downloads = path.join(os.homedir(), "Downloads")
    fs.mkdirSync(downloads, { recursive: true })
    const pdf = path.join(downloads, "invoice-localhost.pdf")
    fs.writeFileSync(pdf, "pdf")
    const posix = pdf.startsWith("/") ? pdf : `/${pdf}`
    saveConfig({
      auto_approved_domains: ["localhost"],
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: false,
      },
    })
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: `file://localhost${posix}` },
      toolCallId: "u-file-localhost",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async (_send: any, details: any) => {
          confirmCalled = true
          assert.deepEqual(details.relevantDomains, [])
          return { approved: true, reason: "approved" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(confirmCalled, true)
    assert.equal(r.ok, true)
  })

  it("allow_all_schemes skips file: L2 (god-mode)", async () => {
    const downloads = path.join(os.homedir(), "Downloads")
    fs.mkdirSync(downloads, { recursive: true })
    const pdf = path.join(downloads, "invoice-god.pdf")
    fs.writeFileSync(pdf, "pdf")
    saveConfig({
      security: {
        ...getConfig().security,
        allow_all_schemes: true,
        auto_approve_dangerous: false,
      },
    })
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: pathToFileURL(pdf).href },
      toolCallId: "u-file-god",
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

  it("cages file:// HOME/.ssh without confirmation", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: true,
      },
    })
    const ssh = path.join(os.homedir(), ".ssh", "id_rsa")
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: pathToFileURL(ssh).href },
      toolCallId: "u-file-ssh",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => {
          confirmCalled = true
          return { approved: true, reason: "approved" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    assert.equal(confirmCalled, false)
    if (!r.ok) assert.ok(r.result.error.includes(FILE_OPEN_CAGE_TOKEN))
  })

  it("UNC file://nas/share is caged without confirmation", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        allow_all_schemes: false,
        auto_approve_dangerous: false,
      },
    })
    let confirmCalled = false
    const r = await runUrlNavigateAdmission({
      toolName: "create_tab",
      finalParams: { url: "file://nas/share/a.pdf" },
      toolCallId: "u-file-unc",
      startedAt: Date.now(),
      ws: fakeWs,
      isOutboundMcpCall: false,
      logToolFinish: noopLog,
      securityConfirmations: {
        request: async () => {
          confirmCalled = true
          return { approved: true, reason: "approved" }
        },
      } as any,
      clients: [],
      wsAuthGet: () => undefined,
    })
    assert.equal(r.ok, false)
    assert.equal(confirmCalled, false)
    if (!r.ok) assert.ok(r.result.error.includes(FILE_OPEN_CAGE_TOKEN))
  })
})

it("outbound navigate fans out and leaves origin unbound", async () => {
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: {
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
  } as any)
  const fanout: string[] = []
  const peer = {
    readyState: WebSocket.OPEN,
    send: (s: string) => {
      fanout.push(s)
    },
  }
  let originOpt: any = "unset"
  const decision = { approved: true, reason: "approved" as const }
  const securityConfirmations = {
    request: async (send: (data: any) => void, _d: any, opts?: any) => {
      originOpt = opts
      // Real manager invokes send() to deliver confirmation.request — drive fan-out path.
      send({ type: "security.confirmation.request", tool_name: "navigate" })
      return decision
    },
  }
  const ws = {
    readyState: WebSocket.OPEN,
    send: () => {},
  }
  const r = await runUrlNavigateAdmission({
    toolName: "navigate",
    finalParams: { url: "https://evil.example/x" },
    toolCallId: "tc_ob",
    startedAt: Date.now(),
    ws: ws as any,
    isOutboundMcpCall: true,
    logToolFinish: () => {},
    securityConfirmations: securityConfirmations as any,
    clients: [peer as any],
    wsAuthGet: () => ({ authenticated: true }),
  })
  assert.equal(r.ok, true)
  assert.deepEqual(originOpt, {}, "outbound must not bind originWs")
  assert.ok(fanout.length >= 1, "fan-out should send to authenticated peer")
})

