/**
 * PR-B Task 7: overlay-origin L2 / URL confirms bind via resolveConfirmBinding
 * and fan out like outbound — overlay never originWs, never Allow/Deny.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-l2-summoner-confirm-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp
process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import {
  fanOutConfirmRequest,
  pickExtensionWsFromAuth,
  resolveConfirmBinding,
  shouldReceiveConfirmRequest,
  CONFIRM_OVERLAY_PENDING_NOTICE,
  type ConfirmPeerAuth,
} from "../src/mcp/confirm-fanout"
import { runUrlNavigateAdmission } from "../src/tool/url-cookie-admission"
import { initDataDir, getConfig, saveConfig } from "../src/config"

function companionSrc(rel: string): string {
  const candidates = [
    path.join(__dirname, "..", "..", "src", rel),
    path.join(process.cwd(), "src", rel),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error(`missing src/${rel}`)
}

function fakeWs(id: string, sent: string[]): WebSocket {
  return {
    id,
    readyState: WebSocket.OPEN,
    send: (s: string) => {
      sent.push(s)
    },
  } as unknown as WebSocket
}

test("source: summoner path does not bind { originWs: ws } blindly", () => {
  const l2 = companionSrc("tool/l2-admission.ts")
  const url = companionSrc("tool/url-cookie-admission.ts")
  assert.match(l2, /resolveConfirmBinding/)
  assert.match(url, /resolveConfirmBinding/)
  assert.doesNotMatch(l2, /\{\s*originWs:\s*ws\s*\}/)
  assert.doesNotMatch(url, /\{\s*originWs:\s*ws\s*\}/)
})

test("source: notifier says 确认台 not Side Panel", () => {
  const l2 = companionSrc("tool/l2-admission.ts")
  assert.match(l2, /请在确认台或托盘里批准/)
  assert.doesNotMatch(l2, /Side Panel 批准/)
  assert.doesNotMatch(l2, /托盘或 Side Panel/)
})

test("source: trayOwnerWs never overlay — activeTrayConfirmsByWs uses helper owner", () => {
  const l2 = companionSrc("tool/l2-admission.ts")
  assert.match(l2, /resolveConfirmBinding/)
  assert.match(l2, /trayOwnerWs/)
  assert.doesNotMatch(l2, /activeTrayConfirmsByWs\.set\(\s*ws\s*,/)
  assert.doesNotMatch(l2, /activeTrayConfirmsByWs\.get\(\s*ws\s*\)/)
  // Swift-only; do not mark systray2 eligible.
  assert.match(l2, /trayEligible\s*=\s*!!tray\s*&&\s*!winL2NonceChallenge\s*&&\s*trayBackendIsSwift/)
})

test("source: both admission files import confirm-fanout helper", () => {
  const l2 = companionSrc("tool/l2-admission.ts")
  const url = companionSrc("tool/url-cookie-admission.ts")
  assert.match(l2, /from\s+["']\.\.\/mcp\/confirm-fanout["']/)
  assert.match(url, /from\s+["']\.\.\/mcp\/confirm-fanout["']/)
  assert.match(l2, /fanOutConfirmRequest/)
  assert.match(url, /fanOutConfirmRequest/)
})

test("source: server ctx passes wsAuthGet.surface through getWsAuthState", () => {
  const server = companionSrc("server.ts")
  assert.match(server, /wsAuthGet:\s*\(w\)\s*=>\s*getWsAuthState\(w\)/)
  assert.doesNotMatch(
    companionSrc("ws/summoner-acl.ts"),
    /security\.confirmation\.response/,
  )
})

test("pickExtensionWsFromAuth returns chrome-extension peer, never overlay", () => {
  const overlaySent: string[] = []
  const extSent: string[] = []
  const overlay = fakeWs("overlay", overlaySent)
  const ext = fakeWs("ext", extSent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [overlay, { authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
  ])
  const picked = pickExtensionWsFromAuth([overlay, ext], (w) => auth.get(w))
  assert.equal(picked, ext)
  assert.notEqual(picked, overlay)
})

test("fanOutConfirmRequest: summoner gets pending only; peers get request", () => {
  const overlaySent: string[] = []
  const extSent: string[] = []
  const traySent: string[] = []
  const overlay = fakeWs("overlay", overlaySent)
  const ext = fakeWs("ext", extSent)
  const tray = fakeWs("tray", traySent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [overlay, { authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
    [tray, { authenticated: true, surface: "tray", origin: "cmspark-tray://local" }],
  ])
  const binding = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: ext,
  })
  assert.equal(binding.originWs, ext)
  assert.notEqual(binding.originWs, overlay)
  assert.equal(binding.overlayNotice, true)
  assert.equal(binding.trayOwnerWs, ext)

  fanOutConfirmRequest({
    data: { type: "security.confirmation.request", tool_name: "evaluate" },
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    overlayNotice: binding.overlayNotice,
    clients: [overlay, ext, tray],
    wsAuthGet: (w) => auth.get(w),
  })

  assert.ok(extSent.some((s) => s.includes("security.confirmation.request")))
  assert.ok(traySent.some((s) => s.includes("security.confirmation.request")))
  assert.ok(overlaySent.every((s) => !s.includes("security.confirmation.request")))
  assert.ok(overlaySent.some((s) => s.includes("mcp.confirm.pending")))
  assert.ok(overlaySent.some((s) => s.includes("确认台")))
  assert.match(CONFIRM_OVERLAY_PENDING_NOTICE, /确认台/)
  assert.equal(shouldReceiveConfirmRequest("summoner"), false)
})

test("fanOutConfirmRequest: outbound skips overlay Allow/Deny and pending", () => {
  const overlaySent: string[] = []
  const extSent: string[] = []
  const overlay = fakeWs("overlay", overlaySent)
  const ext = fakeWs("ext", extSent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [overlay, { authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
  ])
  const binding = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: true,
    extensionWs: ext,
  })
  assert.equal(binding.originWs, undefined)
  assert.equal(binding.overlayNotice, false)
  assert.notEqual(binding.trayOwnerWs, overlay)

  fanOutConfirmRequest({
    data: { type: "security.confirmation.request", tool_name: "navigate" },
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: true,
    overlayNotice: binding.overlayNotice,
    clients: [overlay, ext],
    wsAuthGet: (w) => auth.get(w),
  })
  assert.ok(extSent.some((s) => s.includes("security.confirmation.request")))
  assert.equal(overlaySent.length, 0)
})

test("fanOutConfirmRequest: panel origin stays origin-only (no overlay pending)", () => {
  const panelSent: string[] = []
  const extSent: string[] = []
  const panel = fakeWs("panel", panelSent)
  const ext = fakeWs("ext", extSent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [panel, { authenticated: true, surface: "tray", origin: "chrome-extension://panel" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
  ])
  fanOutConfirmRequest({
    data: { type: "security.confirmation.request", tool_name: "evaluate" },
    originatingWs: panel,
    originatingSurface: "tray",
    isOutboundMcpCall: false,
    overlayNotice: false,
    clients: [panel, ext],
    wsAuthGet: (w) => auth.get(w),
  })
  assert.ok(panelSent.some((s) => s.includes("security.confirmation.request")))
  assert.equal(extSent.length, 0)
  assert.ok(panelSent.every((s) => !s.includes("mcp.confirm.pending")))
})

test("url admission: summoner navigate binds extension, overlay gets pending only", async () => {
  await initDataDir()
  saveConfig({
    auto_approved_domains: [],
    security: {
      ...getConfig().security,
      auto_approve_dangerous: false,
      allow_all_schemes: false,
    },
  })
  const overlaySent: string[] = []
  const extSent: string[] = []
  const overlay = fakeWs("overlay", overlaySent)
  const ext = fakeWs("ext", extSent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [overlay, { authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
  ])
  let originOpt: { originWs?: WebSocket } | undefined = { originWs: overlay }
  const r = await runUrlNavigateAdmission({
    toolName: "navigate",
    finalParams: { url: "https://evil.example/x" },
    toolCallId: "summoner-nav",
    startedAt: Date.now(),
    ws: overlay,
    isOutboundMcpCall: false,
    logToolFinish: () => {},
    securityConfirmations: {
      request: async (send: (data: unknown) => void, _d: unknown, opts?: { originWs?: WebSocket }) => {
        originOpt = opts
        send({ type: "security.confirmation.request", tool_name: "navigate" })
        return { approved: true, reason: "approved" }
      },
    } as any,
    clients: [overlay, ext],
    wsAuthGet: (w) => auth.get(w),
  })
  assert.equal(r.ok, true)
  assert.notEqual(originOpt?.originWs, overlay, "overlay must not be originWs")
  assert.equal(originOpt?.originWs, ext)
  assert.ok(extSent.some((s) => s.includes("security.confirmation.request")))
  assert.ok(overlaySent.every((s) => !s.includes("security.confirmation.request")))
  assert.ok(overlaySent.some((s) => s.includes("mcp.confirm.pending")))
})

test("url admission: summoner file-open does not bind overlay origin", async () => {
  await initDataDir()
  const downloads = path.join(os.homedir(), "Downloads")
  fs.mkdirSync(downloads, { recursive: true })
  const pdf = path.join(downloads, "invoice-summoner.pdf")
  fs.writeFileSync(pdf, "pdf")
  saveConfig({
    auto_approved_domains: [],
    security: {
      ...getConfig().security,
      auto_approve_dangerous: false,
      allow_all_schemes: false,
    },
  })
  const overlaySent: string[] = []
  const extSent: string[] = []
  const overlay = fakeWs("overlay", overlaySent)
  const ext = fakeWs("ext", extSent)
  const auth = new Map<WebSocket, ConfirmPeerAuth>([
    [overlay, { authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }],
    [ext, { authenticated: true, surface: "tray", origin: "chrome-extension://abc" }],
  ])
  let originOpt: { originWs?: WebSocket } | undefined
  const { pathToFileURL } = await import("node:url")
  const r = await runUrlNavigateAdmission({
    toolName: "create_tab",
    finalParams: { url: pathToFileURL(pdf).href },
    toolCallId: "summoner-file",
    startedAt: Date.now(),
    ws: overlay,
    isOutboundMcpCall: false,
    logToolFinish: () => {},
    securityConfirmations: {
      request: async (send: (data: unknown) => void, _d: unknown, opts?: { originWs?: WebSocket }) => {
        originOpt = opts
        send({ type: "security.confirmation.request", tool_name: "create_tab" })
        return { approved: true, reason: "approved" }
      },
    } as any,
    clients: [overlay, ext],
    wsAuthGet: (w) => auth.get(w),
  })
  assert.equal(r.ok, true)
  assert.notEqual(originOpt?.originWs, overlay)
  assert.equal(originOpt?.originWs, ext)
  assert.ok(overlaySent.every((s) => !s.includes("security.confirmation.request")))
  assert.ok(overlaySent.some((s) => s.includes("mcp.confirm.pending")))
})
