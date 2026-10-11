import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-acp-owner-dispatch-"))
process.env.CMSPARK_DATA_DIR = root
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let saveConfig: typeof import("../src/config").saveConfig
let getAcpManager: typeof import("../src/acp/manager").getAcpManager
let resetAcpManager: typeof import("../src/acp/manager")._resetAcpManagerForTests
let execute: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let tm: import("../src/threads/thread-manager").ThreadManager
let policy: typeof import("../src/security-policy").securityPolicy
before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  saveConfig = config.saveConfig
  saveConfig({ acp: { enabled: true, servers: { fixture: {
    enabled: true, command: process.execPath, args: [], protocol: "cli",
    policy: { profile: "review_readonly" },
  } } } } as any)
  const manager = await import("../src/acp/manager")
  getAcpManager = manager.getAcpManager
  resetAcpManager = manager._resetAcpManagerForTests
  const { ThreadManager } = await import("../src/threads/thread-manager")
  tm = new ThreadManager()
  const dispatch = await import("../src/tool/companion-dispatch")
  execute = dispatch.executeCompanionTool
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => tm,
    getSkillEngine: () => null, getComputerEstopEnsureOverride: () => null } as any)
  policy = (await import("../src/security-policy")).securityPolicy
})
after(() => { resetAcpManager(); fs.rmSync(root, { recursive: true, force: true }) })

test("ACP dispatch refuses a different or missing owner before report disclosure or session side effects", async () => {
  const owner = tm.create("owner"), other = tm.create("other")
  const manager = getAcpManager()
  const offered = manager.propose({ threadId: owner.id, agentId: "fixture", goal: "fixture",
    workspaceRoot: root })
  assert.ok(offered.ok)
  const session = offered.session
  session.handback_text = "OWNER_ONLY_REPORT_SENTINEL"
  const originalStart = manager.start, originalApply = manager.applyPendingDiffs
  let starts = 0, applies = 0
  manager.start = async () => { starts++; return { ok: true, session } }
  manager.applyPendingDiffs = () => { applies++; return { ok: true, applied: 0, skipped: [] } as any }
  try {
    for (const tool of ["acp_get_status", "acp_collect_result", "acp_cancel_session", "acp_start_session", "acp_apply_diff"]) {
      for (const caller of [other.id, undefined, ""]) {
        const params: Record<string, any> = { session_id: session.session_id,
          ...(caller !== undefined ? { __thread_id: caller } : {}) }
        if (["acp_start_session", "acp_apply_diff"].includes(tool)) {
          params.security_token = policy.issueTokenFor(tool, params).token
        }
        const result = await execute(tool, params)
        assert.equal(result.success, false, `${tool} must require the actual session owner`)
        assert.equal(result.error_code, "ACP_OWNER_MISMATCH", `${tool} / ${caller ?? "omitted"}`)
        assert.ok(!JSON.stringify(result).includes("OWNER_ONLY_REPORT_SENTINEL"))
        assert.equal(session.state, "offered")
        assert.equal(session.terminal_kind, undefined)
        assert.equal(tm.get(other.id)?.cooperation_tasks?.[`acp:${session.session_id}`], undefined)
      }
    }
    assert.equal(starts, 0)
    assert.equal(applies, 0)
    for (const tool of ["acp_get_status", "acp_collect_result", "acp_start_session", "acp_apply_diff"]) {
      const params: Record<string, any> = { session_id: session.session_id, __thread_id: owner.id }
      if (["acp_start_session", "acp_apply_diff"].includes(tool)) params.security_token = policy.issueTokenFor(tool, params).token
      const result = await execute(tool, params)
      assert.equal(result.success, true, `${tool}: owner must retain access`)
      if (tool === "acp_collect_result") assert.equal(result.data.handback, "OWNER_ONLY_REPORT_SENTINEL")
    }
    assert.equal(starts, 1)
    assert.equal(applies, 1)
    assert.equal((await execute("acp_cancel_session", { session_id: session.session_id, __thread_id: owner.id })).success, true)
    assert.equal(session.terminal_kind, "cancelled")
  } finally { manager.start = originalStart; manager.applyPendingDiffs = originalApply }
})

test("legacy server-owned _thread_id keeps owner access without accepting model thread_id", async () => {
  const owner = tm.create("legacy-owner"), other = tm.create("legacy-other")
  const offered = getAcpManager().propose({ threadId: owner.id, agentId: "fixture", goal: "legacy",
    workspaceRoot: root })
  assert.ok(offered.ok)
  assert.equal((await execute("acp_get_status", { session_id: offered.session.session_id, _thread_id: owner.id })).success, true)
  const forged = await execute("acp_get_status", { session_id: offered.session.session_id,
    __thread_id: other.id, _thread_id: owner.id, thread_id: owner.id })
  assert.equal(forged.success, false)
  assert.equal(forged.error_code, "ACP_OWNER_MISMATCH")
})

test("actual acp_list_agents platform capability agrees with enabled Windows/macOS and unsupported Linux", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!
  const manager = getAcpManager(), originalList = manager.listAgents
  manager.listAgents = () => [] // Avoid probing real host executables while injecting an OS.
  try {
    for (const enabled of [true, false]) {
      saveConfig({ embedded_terminal: { enabled } })
      for (const osName of ["win32", "darwin", "linux"] as const) {
        Object.defineProperty(process, "platform", { ...platform, value: osName })
        const result = await execute("acp_list_agents", { __thread_id: "capability-probe" })
        assert.equal(result.success, true)
        assert.equal(result.data.embedded_terminal_enabled, enabled && osName !== "linux", `${osName} / enabled=${enabled}`)
      }
    }
  } finally { Object.defineProperty(process, "platform", platform); manager.listAgents = originalList }
})
