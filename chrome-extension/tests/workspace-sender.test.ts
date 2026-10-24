import test from "node:test"
import assert from "node:assert/strict"
import { workspaceSenderAllowed, forwardWorkspaceRequest } from "../src/background/workspace-sender"
import { projectMetadataSenderAllowed } from "../src/background/project-metadata"

const extensionId = "owned-workspace"
const full = { id: extensionId, url: `chrome-extension://${extensionId}/tabs/workspace.html`, frameId: 0 }

test("personal workspace trusts exact owned top-level UI documents only", () => {
  for (const sender of [full, { ...full, url: `chrome-extension://${extensionId}/sidepanel.html?popout=1` }]) {
    assert.equal(workspaceSenderAllowed(sender, extensionId), true)
    assert.equal(projectMetadataSenderAllowed(sender, extensionId), true)
  }
  for (const sender of [undefined, { ...full, id: "foreign" }, { ...full, url: "https://example.invalid/tabs/workspace.html" },
    { ...full, url: `chrome-extension://foreign/tabs/workspace.html` }, { ...full, frameId: 1 },
    { ...full, url: `chrome-extension://${extensionId}/tabs/workspace.html/other` }, { ...full, url: `chrome-extension://${extensionId}/popup.html` }]) {
    assert.equal(workspaceSenderAllowed(sender, extensionId), false)
  }
})

test("forwarding refuses disconnected/foreign callers and strips local transport hint", () => {
  const frames: object[] = []
  const client = { getState: () => "connected", send: (frame: object) => { frames.push(frame); return true } }
  const request = { type: "activity.state", id: "owned-request", require_connected: true }
  assert.equal(forwardWorkspaceRequest(request, { ...full, url: "https://example.invalid" }, extensionId, client).ok, false)
  assert.equal(forwardWorkspaceRequest(request, full, extensionId, { ...client, getState: () => "disconnected" }).ok, false)
  assert.equal(frames.length, 0)
  assert.equal(forwardWorkspaceRequest(request, full, extensionId, client).ok, true)
  assert.deepEqual(frames, [{ type: "activity.state", id: "owned-request" }])
  assert.equal(forwardWorkspaceRequest(request, full, extensionId, { ...client, send: () => { throw Error("closed") } }).ok, false)
})
