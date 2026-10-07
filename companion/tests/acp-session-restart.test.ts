import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("old ACP IDs after restart produce a recoverable response with current thread IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-acp-restart-"))
  process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir, saveConfig } = await import("../src/config")
    await initDataDir()
    saveConfig({ acp: { enabled: true, servers: { test: {
      enabled: true, command: "/bin/echo", args: [], protocol: "cli",
      policy: { profile: "review_readonly" },
    } } } as any })
    const { getAcpManager, _resetAcpManagerForTests } = await import("../src/acp/manager")
    const { bindCompanionDispatchRuntime, executeCompanionTool } = await import("../src/tool/companion-dispatch")
    const { classifyError } = await import("../src/security")
    bindCompanionDispatchRuntime({ getThreadManager: () => ({}), getSkillEngine: () => null,
      getComputerEstopEnsureOverride: () => null } as any)
    const offer = getAcpManager().propose({ threadId: "thread", agentId: "test", goal: "review", workspaceRoot: root })
    assert.ok(offer.ok)
    const oldId = offer.session.session_id
    assert.ok(getAcpManager().getSession(oldId))
    _resetAcpManagerForTests() // A new daemon has a fresh in-memory manager.
    assert.equal(getAcpManager().getSession(oldId), undefined)
    for (const name of ["acp_get_status", "acp_collect_result", "acp_cancel_session"]) {
      const result = await executeCompanionTool(name, { session_id: oldId, __thread_id: "thread" })
      assert.equal(result.success, false)
      assert.equal(result.error_code, "ACP_SESSION_NOT_FOUND")
      assert.equal(classifyError(result.error, { toolName: name, error_code: result.error_code }), "recoverable")
      assert.match(result.error, /后台重启/)
      assert.equal(result.data.suggested_action, "propose_new_acp_session")
      assert.deepEqual(result.data.current_sessions, [])
    }
    const missing = await executeCompanionTool("acp_get_status", { agent_id: "test", __thread_id: "thread" })
    assert.equal(missing.error_code, "ACP_SESSION_ID_REQUIRED")
    assert.equal(classifyError(missing.error, { error_code: missing.error_code }), "recoverable")
    const fresh = getAcpManager().propose({ threadId: "thread", agentId: "test", goal: "review again", workspaceRoot: root })
    const other = getAcpManager().propose({ threadId: "other", agentId: "test", goal: "unrelated", workspaceRoot: root })
    assert.ok(fresh.ok && other.ok)
    const error = await executeCompanionTool("acp_get_status", { session_id: oldId, __thread_id: "thread" })
    assert.deepEqual(error.data.current_sessions.map((s: any) => s.session_id), [fresh.session.session_id])
    const current = await executeCompanionTool("acp_get_status", { session_id: fresh.session.session_id, __thread_id: "thread" })
    assert.equal(current.success, true)
    assert.equal(current.data.state, "offered", "recovery must never auto-start or revive an old session")
    const listing = await executeCompanionTool("acp_list_agents", { __thread_id: "thread" })
    assert.deepEqual(listing.data.current_sessions.map((s: any) => s.session_id), [fresh.session.session_id])

    // Exercise the real adapter: a stale lookup must reach another model turn,
    // rather than the old non_recoverable branch which emits chat.error and stops.
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const { chatCreate } = await import("../src/llm/adapter")
    const { OpenAIProvider } = await import("../src/llm/providers/openai")
    const original = OpenAIProvider.prototype.streamChat
    let requests = 0
    const sent: any[] = []
    OpenAIProvider.prototype.streamChat = function () {
      requests++
      return (async function* () {
        if (requests === 1) {
          yield { type: "tool_call_delta" as const, index: 0, id: "stale", name: "acp_get_status", arguments: JSON.stringify({ session_id: oldId }) }
          yield { type: "done" as const, finish_reason: "tool_calls" as const }
        } else {
          yield { type: "token" as const, text: "需要重新创建接力" }
          yield { type: "done" as const, finish_reason: "stop" as const }
        }
      })()
    }
    try {
      const tm = new ThreadManager(), th = tm.create("restart recovery", "restart-recovery")
      const skills = new SkillEngine()
      skills.bindThreadManager(tm)
      await chatCreate({ threadId: th.id, message: "重新打开编程接力", skillIds: [], knowledgeIds: [],
        config: { base_url: "http://localhost:9999", api_key: "test", model_name: "test", temperature: 0, context_window: 128000 },
        threadManager: tm, skillEngine: skills, historyStore: { record: () => 0 } as any,
        sendToExtension: (msg: unknown) => sent.push(msg),
        executeTool: (_id: string, name: string, params: any) => executeCompanionTool(name, { ...params, __thread_id: th.id }),
      } as any)
      assert.equal(requests, 2, "old ID must not halt the model loop")
      assert.deepEqual(sent.filter(m => m.type === "chat.error"), [])
    } finally { OpenAIProvider.prototype.streamChat = original }
    _resetAcpManagerForTests()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
