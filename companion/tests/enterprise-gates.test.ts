import "./integration/_security-gates-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { WebSocket, WebSocketServer } from "ws"
import { createToolExecutor, handleToolResult, seedThreadManagerForTests, seedExtensionWsAuthForTests, pendingToolCalls, securityConfirmations } from "../src/server"
import { checkEnterprisePermit, mintEnterprisePermit } from "../src/outbound-mcp/enterprise-permit"
import { getEnterprisePeer, getWsClients } from "../src/ws/lifecycle"
import { runL2ToolAdmission } from "../src/tool/l2-admission"
import { runUrlNavigateAdmission } from "../src/tool/url-cookie-admission"

test("nonbranded runtime permits are rejected at both enterprise admission boundaries", async () => {
  const ctx = { enterprisePermit: {}, toolName: "navigate", finalParams: { url: "https://business.test/app" }, ws: {} } as any
  const refusal = { ok: false, result: { success: false, error: "PERMIT_INVALID" } }
  assert.deepEqual(await runL2ToolAdmission(ctx), refusal)
  assert.deepEqual(await runUrlNavigateAdmission(ctx), refusal)
})

test("real executor admits only branded bound browser permits, strips raw guards and emits no local confirmation or sensitive tool.start", async () => {
  seedThreadManagerForTests()
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await new Promise<void>(resolve => wss.once("listening", resolve))
  const accepted = new Promise<WebSocket>(resolve => wss.once("connection", resolve))
  const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`)
  const peer = await accepted
  client.on("error", () => {})
  if (client.readyState !== WebSocket.OPEN) await new Promise<void>(resolve => client.once("open", resolve))
  seedExtensionWsAuthForTests(peer)
  getWsClients().add(peer)
  peer.on("message", raw => { const message = JSON.parse(raw.toString()); if (message.type === "tool.result") handleToolResult(message, peer) })
  const seen: any[] = []
  client.on("message", raw => {
    const message = JSON.parse(raw.toString()); seen.push(message)
    if (message.type === "tool.execute") client.send(JSON.stringify({ type: "tool.result", tool_call_id: message.tool_call_id, result: { success: true, data: { executed: true } } }))
  })
  const execute = createToolExecutor(peer)
  try {
    const params = { url: "https://enterprise.test/app?private=DO_NOT_BROADCAST", __outbound_mcp: true, __thread_id: "outbound_mcp:test" }
    const guard = { version: 1, profile_id: "dedicated", mode: "open" }
    const permit = mintEnterprisePermit("create_tab", params, guard, peer, getEnterprisePeer().epoch, () => {})
    const result = await execute("enterprise-normal", "create_tab", params, undefined, { trustedOutbound: true, enterprisePermit: permit })
    assert.equal(result.success, true)
    assert.equal(seen.filter(m => /confirm/.test(m.type)).length, 0)
    assert.equal(seen.filter(m => m.type === "tool.start").length, 0)
    assert.deepEqual(seen.find(m => m.type === "tool.execute").params.__enterprise_guard, guard)
    assert.throws(() => checkEnterprisePermit(permit, "create_tab", params, peer), /PERMIT_MISMATCH/)
    assert.equal(checkEnterprisePermit(JSON.parse(JSON.stringify(permit)), "create_tab", params, peer), false)
    seen.length = 0
    assert.deepEqual(await execute("nonbranded", "create_tab", params, undefined, { enterprisePermit: {} as any }), { success: false, error: "PERMIT_INVALID" })
    assert.equal(seen.length, 0)
    assert.throws(() => mintEnterprisePermit("shell_exec", {}, guard, peer, "peer", () => {}), /ENTERPRISE_TOOL_FORBIDDEN/)
    seen.length = 0
    await execute("raw-guard", "list_tabs", { __enterprise_guard: guard })
    assert.equal(seen.find(m => m.type === "tool.execute").params.__enterprise_guard, undefined)
    const fresh = mintEnterprisePermit("create_tab", params, guard, peer, "peer", () => {})
    await assert.rejects(execute("tampered", "create_tab", { ...params, url: "https://evil.test" }, undefined, { trustedOutbound: true, enterprisePermit: fresh }), /PERMIT_MISMATCH/)
    const competing = { readyState: WebSocket.OPEN } as WebSocket
    seedExtensionWsAuthForTests(competing)
    getWsClients().add(competing)
    assert.throws(() => getEnterprisePeer(), /ENTERPRISE_PEER_AMBIGUOUS/)
    getWsClients().delete(competing)
  } finally {
    for (const call of pendingToolCalls.values()) clearTimeout(call.timer)
    pendingToolCalls.clear(); securityConfirmations.rejectAll("disconnect")
    getWsClients().delete(peer); client.terminate(); peer.terminate()
    await new Promise<void>(resolve => wss.close(() => resolve()))
  }
})
