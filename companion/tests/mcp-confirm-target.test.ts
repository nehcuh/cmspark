import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { WebSocket } from "ws"
import {
  connectedMcpServerNames,
  resolveMcpConfirmTarget,
  MCP_OVERLAY_CONFIRM_NOTICE,
  MCP_OVERLAY_CONFIRM_UNAVAILABLE,
} from "../src/mcp/confirm-target"
import { bindMcpDispatchRuntime, confirmChannel } from "../src/mcp/dispatch"
import {
  bindExtensionPeerPicker,
  bindOverlayConfirmPeerForTests,
  resetExtensionPeerWaitersForTests,
} from "../src/ws/extension-peer"

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

afterEach(() => {
  resetExtensionPeerWaitersForTests()
  bindMcpDispatchRuntime(null)
})

test("summoner MCP confirm retargets to extension when panel is up", () => {
  const r = resolveMcpConfirmTarget({
    originatingSurface: "summoner",
    originatingOpen: true,
    extensionOpen: true,
  })
  assert.equal("target" in r && r.target, "extension")
  if ("overlayNotice" in r) {
    assert.match(r.overlayNotice ?? "", /确认台/)
    assert.doesNotMatch(r.overlayNotice ?? "", /侧栏/)
  }
})

test("summoner MCP confirm fails closed without a panel peer", () => {
  const r = resolveMcpConfirmTarget({
    originatingSurface: "summoner",
    originatingOpen: true,
    extensionOpen: false,
  })
  assert.equal("error" in r, true)
  if ("error" in r) {
    assert.match(r.error, /确认台/)
    assert.doesNotMatch(r.error, /侧栏/)
  }
})

test("panel-origin MCP confirm stays on the originating socket", () => {
  const r = resolveMcpConfirmTarget({
    originatingSurface: "tray",
    originatingOpen: true,
    extensionOpen: true,
  })
  assert.equal("target" in r && r.target, "origin")
})

test("connectedMcpServerNames keeps connected names only", () => {
  assert.deepEqual(
    connectedMcpServerNames([
      { name: "filesystem", connection: { status: "connected" } },
      { name: "dead", connection: { status: "error" } },
      { name: "", connection: { status: "connected" } },
      { connection: { status: "connected" } },
    ]),
    ["filesystem"],
  )
})

test("MCP overlay confirm copy is 确认台, not 侧栏", () => {
  assert.equal(
    MCP_OVERLAY_CONFIRM_NOTICE,
    "MCP 工具需要在确认台批准。召唤器不能代替确认台点批准。",
  )
  assert.equal(
    MCP_OVERLAY_CONFIRM_UNAVAILABLE,
    "MCP 工具需要批准。请打开 Chrome 让确认台出现后批准；召唤器不能点允许或拒绝。",
  )
  assert.doesNotMatch(MCP_OVERLAY_CONFIRM_NOTICE, /侧栏/)
  assert.doesNotMatch(MCP_OVERLAY_CONFIRM_UNAVAILABLE, /侧栏/)
})

test("source: dispatch fans out via resolveConfirmBinding, never binds overlay as origin", () => {
  const dispatch = companionSrc("mcp/dispatch.ts")
  assert.match(dispatch, /resolveConfirmBinding/)
  assert.match(dispatch, /fanOutConfirmRequest/)
  assert.match(dispatch, /resolveMcpConfirmTarget/)
  assert.match(dispatch, /await\s+ensureExtensionPeerForOverlayConfirm/)
  assert.match(dispatch, /async function confirmChannel/)
  assert.doesNotMatch(dispatch, /\{\s*originWs:\s*ws\s*\}/)
  assert.doesNotMatch(dispatch, /SUMMONER_ALLOW/)
  assert.doesNotMatch(dispatch, /sidePanel\.open/)
  assert.doesNotMatch(dispatch, /openSidePanel/)
})

test("overlay confirmChannel waits then fail-closes; timeout never approved", async () => {
  let attached = 0
  bindOverlayConfirmPeerForTests({
    attach: () => {
      attached += 1
    },
    waitMs: 25,
  })
  bindExtensionPeerPicker(() => null)
  const overlay = {
    readyState: WebSocket.OPEN,
    send: () => {},
  } as unknown as WebSocket
  bindMcpDispatchRuntime({
    getThreadManager: () => null,
    securityConfirmations: {} as any,
    broadcastToClients: () => {},
    pickExtensionWs: () => null,
    getWsSurface: () => "summoner",
    getClients: () => [],
    wsAuthGet: () => ({ authenticated: true, surface: "summoner", origin: "cmspark-tray://local" }),
  })
  const r = await confirmChannel(overlay)
  assert.equal("error" in r, true, "timeout must fail-closed")
  if ("error" in r) {
    assert.match(r.error, /确认台/)
    assert.doesNotMatch(r.error, /侧栏/)
  }
  assert.equal(attached, 1)
  assert.doesNotMatch(JSON.stringify(r), /"approved"\s*:\s*true/)
  assert.equal(!("approved" in r && (r as { approved?: unknown }).approved === true), true)
})

test("source: summoner MCP/pack notices say 确认台; keep 侧栏占用了输入", () => {
  const web = companionSrc("summoner-web.ts")
  const client = companionSrc("summoner/client.ts")
  assert.match(web, /MCP_OVERLAY_CONFIRM_NOTICE/)
  assert.match(web, /mcp\.confirm\.pending/)
  assert.doesNotMatch(web, /MCP 工具需在 Chrome 侧栏批准/)
  assert.match(client, /这个场景需要确认台批准/)
  assert.match(client, /当前对话有信任快照，请在侧栏装配里换场景/)
  assert.match(client, /侧栏占用了输入/)
  assert.match(client, /MCP_OVERLAY_CONFIRM_NOTICE/)
  assert.doesNotMatch(client, /这个场景要去侧栏确认/)
  assert.doesNotMatch(client, /去侧栏换场景/)
  assert.doesNotMatch(client, /MCP 工具需在 Chrome 侧栏批准/)
})
