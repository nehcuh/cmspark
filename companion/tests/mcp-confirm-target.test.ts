import test from "node:test"
import assert from "node:assert/strict"
import {
  connectedMcpServerNames,
  resolveMcpConfirmTarget,
} from "../src/mcp/confirm-target"

test("summoner MCP confirm retargets to extension when panel is up", () => {
  const r = resolveMcpConfirmTarget({
    originatingSurface: "summoner",
    originatingOpen: true,
    extensionOpen: true,
  })
  assert.equal("target" in r && r.target, "extension")
  if ("overlayNotice" in r) assert.match(r.overlayNotice ?? "", /侧栏/)
})

test("summoner MCP confirm fails closed without a panel peer", () => {
  const r = resolveMcpConfirmTarget({
    originatingSurface: "summoner",
    originatingOpen: true,
    extensionOpen: false,
  })
  assert.equal("error" in r, true)
  if ("error" in r) assert.match(r.error, /侧栏/)
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
