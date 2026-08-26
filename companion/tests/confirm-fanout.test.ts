/**
 * Confirm binding / fan-out: overlay never becomes originWs and never
 * receives Allow/Deny (overlayNotice → mcp.confirm.pending only).
 */
import test from "node:test"
import assert from "node:assert/strict"
import type { WebSocket } from "ws"
import {
  resolveConfirmBinding,
  shouldReceiveConfirmRequest,
  isSummonerSurface,
} from "../src/mcp/confirm-fanout"

function fakeWs(): WebSocket {
  return {} as WebSocket
}

test("summoner origin binds extension when present, else unbound", () => {
  const overlay = fakeWs()
  const extension = fakeWs()

  const withExt = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: extension,
  })
  assert.equal(withExt.originWs, extension)
  assert.equal(withExt.overlayNotice, true)
  assert.equal(withExt.trayOwnerWs, extension)

  const unbound = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: null,
  })
  assert.equal(unbound.originWs, undefined)
  assert.equal(unbound.overlayNotice, true)
  assert.equal(unbound.trayOwnerWs, null)
})

test("summoner origin never returns overlay as originWs", () => {
  const overlay = fakeWs()
  const extension = fakeWs()

  const withExt = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: extension,
  })
  assert.notEqual(withExt.originWs, overlay)

  const withoutExt = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: null,
  })
  assert.notEqual(withoutExt.originWs, overlay)
  assert.equal(withoutExt.originWs, undefined)
})

test("panel origin stays origin-bound", () => {
  const panel = fakeWs()
  const extension = fakeWs()
  const r = resolveConfirmBinding({
    originatingWs: panel,
    originatingSurface: "tray",
    isOutboundMcpCall: false,
    extensionWs: extension,
  })
  assert.equal(r.originWs, panel)
  assert.equal(r.overlayNotice, false)
  // Panel is not summoner; tray owner may be the panel itself.
  assert.ok(r.trayOwnerWs === panel || r.trayOwnerWs === extension)
})

test("outbound stays unbound", () => {
  const overlay = fakeWs()
  const extension = fakeWs()
  const panel = fakeWs()

  const fromOverlay = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: true,
    extensionWs: extension,
  })
  assert.equal(fromOverlay.originWs, undefined)
  assert.equal(fromOverlay.overlayNotice, false)
  assert.notEqual(fromOverlay.trayOwnerWs, overlay)
  assert.equal(fromOverlay.trayOwnerWs, extension)

  const fromPanel = resolveConfirmBinding({
    originatingWs: panel,
    originatingSurface: "tray",
    isOutboundMcpCall: true,
    extensionWs: extension,
  })
  assert.equal(fromPanel.originWs, undefined)
  assert.equal(fromPanel.overlayNotice, false)
  assert.equal(fromPanel.trayOwnerWs, extension)

  const noExt = resolveConfirmBinding({
    originatingWs: panel,
    originatingSurface: "tray",
    isOutboundMcpCall: true,
    extensionWs: null,
  })
  assert.equal(noExt.originWs, undefined)
  assert.equal(noExt.trayOwnerWs, null)
})

test("trayOwnerWs is extension or null, never summoner", () => {
  const overlay = fakeWs()
  const extension = fakeWs()
  const panel = fakeWs()

  const summonerBound = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: extension,
  })
  assert.equal(summonerBound.trayOwnerWs, extension)
  assert.notEqual(summonerBound.trayOwnerWs, overlay)

  const summonerUnbound = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: false,
    extensionWs: null,
  })
  assert.equal(summonerUnbound.trayOwnerWs, null)

  const outbound = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: true,
    extensionWs: extension,
  })
  assert.equal(outbound.trayOwnerWs, extension)
  assert.notEqual(outbound.trayOwnerWs, overlay)

  const outboundNoExt = resolveConfirmBinding({
    originatingWs: overlay,
    originatingSurface: "summoner",
    isOutboundMcpCall: true,
    extensionWs: null,
  })
  assert.equal(outboundNoExt.trayOwnerWs, null)

  const panelBound = resolveConfirmBinding({
    originatingWs: panel,
    originatingSurface: "tray",
    isOutboundMcpCall: false,
    extensionWs: extension,
  })
  assert.notEqual(panelBound.trayOwnerWs, overlay)
  assert.ok(panelBound.trayOwnerWs === panel || panelBound.trayOwnerWs === extension)
})

test("shouldReceiveConfirmRequest excludes summoner (Allow/Deny never to overlay)", () => {
  assert.equal(shouldReceiveConfirmRequest("summoner"), false)
  assert.equal(shouldReceiveConfirmRequest("tray"), true)
  assert.equal(shouldReceiveConfirmRequest(undefined), true)
  assert.equal(isSummonerSurface("summoner"), true)
  assert.equal(isSummonerSurface("tray"), false)
  assert.equal(isSummonerSurface(undefined), false)
})
