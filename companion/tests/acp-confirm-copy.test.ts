import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  formatAcpStartConfirmCode,
  formatAcpApplyConfirmCode,
} from "../src/acp/confirm-copy"
import { resolveAcpThreadId } from "../src/acp/thread-id"

describe("acp confirm copy (RN5)", () => {
  it("start confirm includes mode, workspace, session, cloud note", () => {
    const code = formatAcpStartConfirmCode({
      agentLabel: "Claude",
      mode: "review_readonly",
      workspaceRoot: "/tmp/ws",
      goal: "review auth",
      sessionId: "acp_1",
    })
    assert.match(code, /模式=审查/)
    assert.match(code, /仓库: \/tmp\/ws/)
    assert.match(code, /session=acp_1/)
    assert.match(code, /云模型/)
    assert.doesNotMatch(code, /只读审查/)
  })

  it("start confirm uses 起草修改 for propose_diff", () => {
    const code = formatAcpStartConfirmCode({
      agentLabel: "Pi",
      mode: "propose_diff",
      workspaceRoot: "/repo",
      goal: "fix",
      sessionId: "s2",
    })
    assert.match(code, /模式=起草修改/)
  })

  it("apply confirm includes allow_delete yes/no", () => {
    const yes = formatAcpApplyConfirmCode({
      sessionId: "s",
      workspaceRoot: "/w",
      files: "a.ts",
      allowDelete: true,
    })
    const no = formatAcpApplyConfirmCode({
      sessionId: "s",
      workspaceRoot: "/w",
      files: "a.ts",
      allowDelete: false,
    })
    assert.match(yes, /allow_delete=yes/)
    assert.match(no, /allow_delete=no/)
    assert.notEqual(yes, no)
  })
})

describe("resolveAcpThreadId (RN2)", () => {
  it("prefers actingThreadId over params", () => {
    assert.equal(
      resolveAcpThreadId({ __thread_id: "from-params" }, "from-acting"),
      "from-acting",
    )
  })

  it("falls back __thread_id then _thread_id", () => {
    assert.equal(resolveAcpThreadId({ __thread_id: "a" }), "a")
    assert.equal(resolveAcpThreadId({ _thread_id: "b" }), "b")
    assert.equal(resolveAcpThreadId({ __thread_id: "a", _thread_id: "b" }), "a")
    assert.equal(resolveAcpThreadId({}), "")
  })
})
