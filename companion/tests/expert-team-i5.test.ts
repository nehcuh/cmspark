/**
 * #371 I5: propose_expert_team matcher + spawn_expert_team one-L2 kick/rollback.
 *
 * Acceptance:
 * - no confirm → worker count and parent role unchanged
 * - empty worker (no brief / no chat.create) = fail + rollback
 * - invented ids filtered
 * - ≤5 cap / >4 truncated
 * - max_active_l2_per_run not punched (spawn_expert_team is a single L2_GATE tool)
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-371-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let securityPolicy: typeof import("../src/security-policy").securityPolicy
let SecurityPolicy: typeof import("../src/security-policy").SecurityPolicy
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let packEngine: typeof import("../src/packs/pack-engine")
let expertTeam: typeof import("../src/orchestrator/expert-team")
let spawnWorkerThread: typeof import("../src/orchestrator/spawn").spawnWorkerThread
let L2_GATE_TOOLS: typeof import("../src/tool/l2-admission").L2_GATE_TOOLS
let WORKER_HARD_DENY: typeof import("../src/orchestrator/constants").WORKER_HARD_DENY
let ORCHESTRATOR_TOOL_ALLOWLIST: typeof import("../src/orchestrator/constants").ORCHESTRATOR_TOOL_ALLOWLIST
let initDataDir: typeof import("../src/config").initDataDir
let clearConfigCache: typeof import("../src/config").clearConfigCache
let scheduleWhenLlmSlotAvailable: typeof import("../src/orchestrator/llm-loop-gate").scheduleWhenLlmSlotAvailable
let pendingDeferredLlmKickCount: typeof import("../src/orchestrator/llm-loop-gate").pendingDeferredLlmKickCount
let tryAcquireMultiAgentLlmLoop: typeof import("../src/orchestrator/llm-loop-gate").tryAcquireMultiAgentLlmLoop
let releaseMultiAgentLlmLoop: typeof import("../src/orchestrator/llm-loop-gate").releaseMultiAgentLlmLoop
let _resetMultiAgentLlmLoopsForTests: typeof import("../src/orchestrator/llm-loop-gate")._resetMultiAgentLlmLoopsForTests
let ORCHESTRATOR_CAPS: typeof import("../src/orchestrator/constants").ORCHESTRATOR_CAPS

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  clearConfigCache = configMod.clearConfigCache
  await initDataDir()
  clearConfigCache()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
  const pol = await import("../src/security-policy")
  securityPolicy = pol.securityPolicy
  SecurityPolicy = pol.SecurityPolicy
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  packEngine = await import("../src/packs/pack-engine")
  expertTeam = await import("../src/orchestrator/expert-team")
  spawnWorkerThread = (await import("../src/orchestrator/spawn")).spawnWorkerThread
  L2_GATE_TOOLS = (await import("../src/tool/l2-admission")).L2_GATE_TOOLS
  const constants = await import("../src/orchestrator/constants")
  WORKER_HARD_DENY = constants.WORKER_HARD_DENY
  ORCHESTRATOR_TOOL_ALLOWLIST = constants.ORCHESTRATOR_TOOL_ALLOWLIST
  ORCHESTRATOR_CAPS = constants.ORCHESTRATOR_CAPS
  const gate = await import("../src/orchestrator/llm-loop-gate")
  scheduleWhenLlmSlotAvailable = gate.scheduleWhenLlmSlotAvailable
  pendingDeferredLlmKickCount = gate.pendingDeferredLlmKickCount
  tryAcquireMultiAgentLlmLoop = gate.tryAcquireMultiAgentLlmLoop
  releaseMultiAgentLlmLoop = gate.releaseMultiAgentLlmLoop
  _resetMultiAgentLlmLoopsForTests = gate._resetMultiAgentLlmLoopsForTests
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function bindTm(tm: InstanceType<typeof ThreadManager>, skillEngine: any = null) {
  const mgr = new SecurityConfirmationManager(60_000)
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => skillEngine as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: mgr,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

function saveExpert(name: string, extra: Record<string, any> = {}) {
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name,
      description: extra.description || `${name} 职责`,
      system_prompt_append: extra.prompt || `你是${name}。`,
      skill_ids: [],
      kind: "expert",
      tools: extra.tools || {
        mode: "allowlist",
        allow: ["list_tabs", "get_page_text", "screenshot"],
        deny: ["shell_exec", "evaluate", "spawn_worker"],
      },
      ...("disabled" in extra ? { disabled: extra.disabled } : {}),
    },
    skillEngine,
  )
  assert.equal(saved.ok, true, `saveUserPack ${name}`)
  if (!saved.ok) throw new Error("save failed")
  return { id: saved.id, skillEngine }
}

test("matcher: invented ids filtered; disabled excluded; cap 4", () => {
  const a = saveExpert("事故SRE顾问371", { description: "SLO 事故排障 错误预算" })
  const b = saveExpert("验收QA顾问371", { description: "测试 验收 回归" })
  const disabled = saveExpert("停用幽灵371", { disabled: true, description: "不该入选" })

  const proposed = expertTeam.proposeExpertTeam("线上事故 SLO 排障", [
    a.id,
    "invented-god-mode",
    disabled.id,
    b.id,
    "also-fake",
  ])
  assert.equal(proposed.ok, true)
  const ids = proposed.data.experts.map((e) => e.pack_id)
  assert.ok(ids.includes(a.id), "real expert kept")
  assert.ok(ids.includes(b.id), "second real expert kept")
  assert.ok(!ids.includes(disabled.id), "disabled excluded")
  assert.ok(!ids.includes("invented-god-mode"))
  assert.ok(proposed.data.filtered_invented.includes("invented-god-mode"))
  assert.ok(proposed.data.filtered_invented.includes("also-fake"))
  assert.ok(proposed.data.experts.length <= expertTeam.MAX_EXPERT_TEAM_SIZE)

  const ranked = expertTeam.rankExperts(
    "线上事故 SLO 排障",
    expertTeam.listEligibleExperts().filter((e) => e.id === a.id || e.id === b.id),
    4,
  )
  assert.equal(ranked[0].pack_id, a.id, "SRE-like expert ranks above QA for incident brief")
})

test("filterProposedPackIds drops extras and preserves order", () => {
  const kept = expertTeam.filterProposedPackIds(
    ["expert-sre", "invented", "expert-qa", "expert-sre"],
    new Set(["expert-sre", "expert-qa"]),
  )
  assert.deepEqual(kept, ["expert-sre", "expert-qa"])
})

test("token binds pack id set + slice fingerprints (reorder ok, extra member fails)", () => {
  const p1 = {
    goal: "ship",
    members: [
      { pack_id: "expert-sre", brief: "watch SLO" },
      { pack_id: "expert-qa", brief: "write tests" },
    ],
  }
  const pReorder = {
    goal: "ship",
    members: [
      { pack_id: "expert-qa", brief: "write tests" },
      { pack_id: "expert-sre", brief: "watch SLO" },
    ],
  }
  const pExtra = {
    goal: "ship",
    members: [
      ...p1.members,
      { pack_id: "invented-root", brief: "pwn" },
    ],
  }
  const pSliceSwap = {
    goal: "ship",
    members: [
      { pack_id: "expert-sre", brief: "TAMPERED" },
      { pack_id: "expert-qa", brief: "write tests" },
    ],
  }
  assert.equal(
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", p1),
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", pReorder),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", p1),
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", pExtra),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", p1),
    SecurityPolicy.bindingPayloadFor("spawn_expert_team", pSliceSwap),
  )
  const policy = new SecurityPolicy()
  const { token } = policy.issueTokenFor("spawn_expert_team", p1)
  assert.equal(policy.validateTokenFor(token, "spawn_expert_team", pReorder), true)
  assert.equal(policy.validateTokenFor(token, "spawn_expert_team", pExtra), false)
  assert.equal(policy.validateTokenFor(token, "spawn_expert_team", pSliceSwap), false)
})

test("L2: spawn_expert_team is one gate tool; cruise lockstep with spawn_worker; workers cannot inherit it", () => {
  assert.ok(L2_GATE_TOOLS.includes("spawn_expert_team"))
  assert.ok(L2_GATE_TOOLS.includes("spawn_worker"))
  assert.ok(WORKER_HARD_DENY.has("spawn_expert_team"))
  assert.ok(WORKER_HARD_DENY.has("propose_expert_team"))
  assert.ok(ORCHESTRATOR_TOOL_ALLOWLIST.includes("spawn_expert_team"))
  assert.ok(ORCHESTRATOR_TOOL_ALLOWLIST.includes("propose_expert_team"))
})

test("no security_token: worker count and parent role unchanged", async () => {
  const { id, skillEngine } = saveExpert("无确认专家371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-noconfirm")
  bindTm(tm, skillEngine)
  const before = expertTeam.parentRoleSnapshot(tm, parent.id)

  const r = await executeCompanionTool("spawn_expert_team", {
    __thread_id: parent.id,
    goal: "do the thing",
    members: [{ pack_id: id, brief: "you do the thing" }],
  })
  assert.equal(r.success, false)
  assert.match(String(r.error), /security_token/)

  const after = expertTeam.parentRoleSnapshot(tm, parent.id)
  assert.equal(after.agent_role, before.agent_role)
  assert.equal(after.worker_count, before.worker_count)
  assert.equal(after.board_mode, false)
  assert.equal(tm.list().filter((t: any) => t.parent_thread_id === parent.id).length, 0)
})

test("empty brief (no goal) = EMPTY_WORKER; parent unchanged", async () => {
  const { id, skillEngine } = saveExpert("空切片专家371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-empty")
  bindTm(tm, skillEngine)
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "",
    members: [{ pack_id: id, brief: "   " }],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: () => {
      throw new Error("kick must not run")
    },
  })
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, expertTeam.EMPTY_WORKER_CODE)
  const p = tm.get(parent.id) as any
  assert.ok(p, "parent still exists")
  assert.notEqual(p?.agent_role, "orchestrator")
  assert.equal(p?.board_mode === true, false)
  assert.equal(tm.list().filter((t: any) => t.parent_thread_id === parent.id).length, 0)
})

test("missing kick = empty worker failure + #292 parent restore", async () => {
  const { id, skillEngine } = saveExpert("缺kick专家371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-nokick")
  bindTm(tm, skillEngine)
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "investigate outage",
    members: [{ pack_id: id, brief: "timeline + SLO" }],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params)
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, expertTeam.EMPTY_WORKER_CODE)
  const p = tm.get(parent.id) as any
  assert.equal(p?.agent_role, "normal", "parent restored after failed kick")
  assert.equal(p?.tool_whitelist, null)
  assert.ok(!p?.orchestrator_run_id)
  assert.equal(tm.list().filter((t: any) => t.parent_thread_id === parent.id).length, 0)
})

test("kick throw mid-team rolls back all workers and restores parent", async () => {
  const a = saveExpert("回滚甲371")
  const b = saveExpert("回滚乙371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-rollback")
  bindTm(tm, a.skillEngine)
  const kicked: string[] = []
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "two-person review",
    members: [
      { pack_id: a.id, brief: "role A duties" },
      { pack_id: b.id, brief: "role B duties" },
    ],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: ({ threadId }) => {
      kicked.push(threadId)
      if (kicked.length >= 2) throw new Error("kick boom")
    },
  })
  assert.equal(r.success, false)
  assert.match(String(r.error), /kick/)
  const p = tm.get(parent.id) as any
  assert.equal(p?.agent_role, "normal")
  assert.equal(p?.tool_whitelist, null)
  assert.equal(tm.list().filter((t: any) => t.parent_thread_id === parent.id).length, 0)
})

test("happy path: one L2 token, briefs persisted, kick invoked, board_mode, invented filtered, >4 truncated", async () => {
  const names = ["甲", "乙", "丙", "丁", "戊"]
  const saved = names.map((n) => saveExpert(`组队${n}371`, { description: `${n} 职责` }))
  const tm = new ThreadManager()
  const parent = tm.create("host-371-happy")
  bindTm(tm, saved[0].skillEngine)
  const kicked: Array<{ threadId: string; message: string }> = []
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "ship the release",
    members: [
      { pack_id: "invented-root-371", brief: "should be dropped" },
      ...saved.map((s, i) => ({ pack_id: s.id, brief: `duties for ${names[i]}` })),
    ],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: ({ threadId, message }) => {
      kicked.push({ threadId, message })
    },
  })
  assert.equal(r.success, true, r.error)
  assert.equal(r.data.worker_ids.length, expertTeam.MAX_EXPERT_TEAM_SIZE, "≤4 experts")
  assert.equal(r.data.truncated, true, "5th expert truncated")
  assert.ok(r.data.invented_filtered.includes("invented-root-371"))
  assert.equal(r.data.board_mode, true)
  const p = tm.get(parent.id) as any
  assert.equal(p.agent_role, "orchestrator")
  assert.equal(p.board_mode, true)
  assert.equal(kicked.length, expertTeam.MAX_EXPERT_TEAM_SIZE)
  for (const wid of r.data.worker_ids) {
    const msgs = tm.getMessages(wid)
    const user = msgs.filter((m) => m.role === "user")
    assert.ok(user.length >= 1, "brief persisted as user message")
    assert.ok(String(user[0].content).trim().length > 0)
    assert.ok(kicked.some((k) => k.threadId === wid), "chat.create kick invoked")
    const w = tm.get(wid) as any
    assert.equal(w.agent_role, "worker")
    assert.ok(!w.tool_whitelist?.includes("spawn_worker"))
    assert.ok(!w.tool_whitelist?.includes("spawn_expert_team"))
    assert.ok(!w.tool_whitelist?.includes("evaluate"), "pack allowlist blocks default evaluate")
  }
})

test("≤5 total workers: existing 4 + team of 2 truncates to 1", async () => {
  const extra = saveExpert("第五人371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-cap")
  bindTm(tm, extra.skillEngine)
  const first = spawnWorkerThread(tm, {
    parentThreadId: parent.id,
    userConfirmed: true,
    roleAllow: ["list_tabs", "screenshot"],
  })
  assert.equal(first.ok, true)
  if (!first.ok) return
  for (let i = 0; i < 3; i++) {
    const r = spawnWorkerThread(tm, {
      parentThreadId: parent.id,
      userConfirmed: true,
      roleAllow: ["list_tabs", "screenshot"],
    })
    assert.equal(r.ok, true)
  }
  const beforeCount = tm.list().filter((t: any) => t.parent_thread_id === parent.id).length
  assert.equal(beforeCount, 4)

  const other = saveExpert("第六人371")
  const kicked: string[] = []
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "one more",
    members: [
      { pack_id: extra.id, brief: "slot 5" },
      { pack_id: other.id, brief: "would be 6" },
    ],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: ({ threadId }) => {
      kicked.push(threadId)
    },
  })
  assert.equal(r.success, true, r.error)
  assert.equal(r.data.worker_ids.length, 1)
  assert.equal(r.data.truncated, true)
  assert.equal(tm.list().filter((t: any) => t.parent_thread_id === parent.id).length, 5)
  assert.equal(kicked.length, 1)
})

test("fillMemberBrief: empty goal+brief stays empty; goal synthesizes a slice", () => {
  assert.equal(expertTeam.fillMemberBrief({ goal: "", brief: "  ", name: "SRE", description: "x" }), "")
  const filled = expertTeam.fillMemberBrief({
    goal: "fix the outage",
    brief: "",
    name: "SRE",
    description: "SLO 顾问",
  })
  assert.match(filled, /fix the outage/)
  assert.match(filled, /SRE/)
  assert.match(filled, /禁止越权/)
})

test("#371 MAJOR: 6th kick queues under LLM cap; spawn still persists brief (no rollback)", async () => {
  _resetMultiAgentLlmLoopsForTests()
  const dummy = { agent_role: "worker", parent_thread_id: "p", orchestrator_run_id: "r" }
  const cap = ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops
  for (let i = 0; i < cap; i++) {
    assert.equal(tryAcquireMultiAgentLlmLoop(dummy, `hold-${i}`).ok, true)
  }

  const { id, skillEngine } = saveExpert("并发第六kick371")
  const tm = new ThreadManager()
  const parent = tm.create("host-371-llmcap")
  bindTm(tm, skillEngine)
  const kicked: string[] = []
  const params: Record<string, any> = {
    __thread_id: parent.id,
    goal: "one more under cap",
    members: [{ pack_id: id, brief: "wait your turn" }],
  }
  const { token } = securityPolicy.issueTokenFor("spawn_expert_team", params)
  params.security_token = token
  const r = await executeCompanionTool("spawn_expert_team", params, undefined, {
    kickWorkerChat: ({ threadId }) => {
      const worker = tm.get(threadId)
      scheduleWhenLlmSlotAvailable(worker, threadId, async () => {
        kicked.push(threadId)
      })
    },
  })
  assert.equal(r.success, true, r.error)
  assert.equal(r.data.worker_ids.length, 1)
  const wid = r.data.worker_ids[0]
  const msgs = tm.getMessages(wid)
  assert.ok(msgs.some((m) => m.role === "user" && String(m.content).includes("wait your turn")))
  assert.equal(kicked.length, 0, "6th LLM loop must not start while cap is full")
  assert.equal(pendingDeferredLlmKickCount(), 1)

  releaseMultiAgentLlmLoop("hold-0")
  await new Promise((res) => setTimeout(res, 0))
  assert.deepEqual(kicked, [wid])
  assert.equal(pendingDeferredLlmKickCount(), 0)
  _resetMultiAgentLlmLoopsForTests()
})
