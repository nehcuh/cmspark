import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { handleAcpWsMessage } from "../src/acp/handlers"
import { getAcpManager, _resetAcpManagerForTests } from "../src/acp/manager"

describe("acp WS gates", () => {
  beforeEach(() => {
    _resetAcpManagerForTests()
  })

  it("ui_start fails closed when acp disabled", async () => {
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "t1",
        agent_id: "claude",
        goal: "review",
        cloud_disclosure_accepted: true,
      },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /disabled/i)
  })

  it("apply_diff fails without session", async () => {
    const r = await handleAcpWsMessage(
      "acp.apply_diff",
      { session_id: "nope" },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
  })

  it("cancel unknown session errors", async () => {
    const r = await handleAcpWsMessage("acp.session.cancel", { session_id: "x" }, {})
    assert.equal(r.type, "error")
  })

  it("list returns shape when disabled", async () => {
    const r = await handleAcpWsMessage("acp.list", {}, {})
    assert.equal(r.type, "acp.list")
    assert.equal(r.enabled, false)
    assert.ok(Array.isArray(r.agents))
    assert.equal(r.agents.length, 0)
  })

  it("ui_start refuses worker threads", async () => {
    // Worker check is before enabled gate — no saveConfig / home DATA_DIR needed
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "worker-1",
        agent_id: "claude",
        goal: "review",
        cloud_disclosure_accepted: true,
      },
      {
        getAgentRole: () => "worker",
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /worker/i)
  })

  it("ui_start requires cloud_disclosure_accepted", async () => {
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "t1",
        agent_id: "claude",
        goal: "review",
      },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /cloud_disclosure/i)
  })

  it("session.prompt requires session_id and text", async () => {
    const r = await handleAcpWsMessage(
      "acp.session.prompt",
      { session_id: "", text: "" },
      {},
    )
    assert.equal(r.type, "error")
  })
})
