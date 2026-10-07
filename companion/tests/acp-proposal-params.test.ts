import test from "node:test"
import assert from "node:assert/strict"
import { validateAcpProposalParams } from "../src/acp/proposal-params"
import { runL2ToolAdmission } from "../src/tool/l2-admission"
import { classifyError } from "../src/security"

test("missing ACP agent/task and copied archive stubs fail before confirmation", async () => {
  for (const params of [{}, { redacted: true, len: 3114 }, { agent_id: "", goal: "review" },
    { agent_id: "kimi", goal: " " }, { agent_id: {}, goal: "review" }]) {
    let confirmations = 0, finishes = 0
    const r = await runL2ToolAdmission({ toolName: "acp_propose_session", finalParams: params,
      toolCallId: "invalid", startedAt: Date.now(), getThreadManager: () => ({ get: () => null }),
      securityConfirmations: { request() { confirmations++; throw new Error("must not confirm malformed calls") } },
      logToolFinish() { finishes++ },
    } as any)
    assert.ok(!r.ok)
    assert.equal(r.result.error_code, "ACP_PROPOSAL_PARAMS_REQUIRED")
    assert.equal(classifyError(r.result.error, { error_code: r.result.error_code }), "recoverable")
    assert.equal(confirmations, 0)
    assert.equal(finishes, 1)
    assert.ok(r.result.data.missing_fields.length)
  }
  assert.equal(validateAcpProposalParams({ agent_id: "kimi", goal: "review the latest changes" }), null)
  assert.equal(validateAcpProposalParams({ agent: "kimi", prompt: "review" }), null, "keep supported aliases")
})
