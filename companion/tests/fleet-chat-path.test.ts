import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CanonicalStreamEvent } from "../src/llm/provider"

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fleet-chat-path-"))
process.env.HOME = temp; process.env.CMSPARK_DATA_DIR = temp
let adapter: typeof import("../src/llm/adapter")
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let dispatch: typeof import("../src/tool/companion-dispatch")
let gates: typeof import("../src/orchestrator/llm-loop-gate")
let Provider: typeof import("../src/llm/providers/openai").OpenAIProvider
let originalStream: any, originalComplete: any
let assessCalls = 0
let assessed: any[] = []
let assessFails = false
let streamed: any[] = []
let onStream: (round: number) => void = () => {}
let onComplete: () => void = () => {}

before(async () => {
  await (await import("../src/config")).initDataDir()
  adapter = await import("../src/llm/adapter")
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  dispatch = await import("../src/tool/companion-dispatch")
  gates = await import("../src/orchestrator/llm-loop-gate")
  Provider = (await import("../src/llm/providers/openai")).OpenAIProvider
  originalStream = Provider.prototype.streamChat; originalComplete = Provider.prototype.complete
  Provider.prototype.complete = async function(p) {
    if (String(p.messages[0].content).includes("You only assess")) {
      assessCalls++; assessed.push(p); onComplete()
      if (assessFails) throw new Error("offline")
      return { content: JSON.stringify({ suggest: true, reason: "独立来源", subtasks: [
        { goal: "查公告", input: "public_browser", tools: ["create_tab", "get_page_text"] },
        { goal: "查行业", input: "public_browser", tools: ["create_tab", "get_page_text"] },
      ] }), usage: { total_tokens: 42 } }
    }
    return { content: "标题" }
  }
  Provider.prototype.streamChat = async function* (p): AsyncIterable<CanonicalStreamEvent> {
    streamed.push(JSON.parse(JSON.stringify(p)))
    onStream(streamed.length)
    yield { type: "token", text: streamed.length === 1 ? "先准备主线程部分" : "已汇总；中断任务需缩减范围后请求重试" }
    yield { type: "done", finish_reason: "stop" }
  }
})
after(() => {
  Provider.prototype.streamChat = originalStream; Provider.prototype.complete = originalComplete
  gates._resetMultiAgentLlmLoopsForTests()
  fs.rmSync(temp, { recursive: true, force: true })
})

function setup() {
  assessCalls = 0; assessed = []; assessFails = false; streamed = []; onStream = () => {}; onComplete = () => {}
  gates._resetMultiAgentLlmLoopsForTests()
  const tm = new ThreadManager(), parent = tm.create("parent")
  const sent: any[] = [], calls: string[] = []
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: { request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" }) } as any,
    getComputerEstopEnsureOverride: () => null, rejectPendingForThread: () => 0,
    hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  const stats = { toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0, terminal: null } as any
  const params = { threadId: parent.id, message: "深度研究公司", skillIds: [],
    config: { base_url: "http://localhost:9999", api_key: "test", model_name: "test", temperature: 0, context_window: 32000, context_compaction: "off" as const },
    threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: async () => 0 } as any,
    runStats: stats, sendToExtension: (e: any) => sent.push(e),
    executeTool: async (id: string, name: string, args: any) => {
      calls.push(name)
      return dispatch.executeCompanionTool(name, args, id, { handshakeSurface: "tray", broadcast: e => sent.push(e) })
    } }
  return { tm, parent, sent, calls, params, stats }
}

test("actual preflight surfaces existing advisory card BEFORE streaming and does not spawn", async () => {
  const { params, sent, calls, stats, tm, parent } = setup()
  onStream = () => { assert.ok(sent.some(e => e.type === "fleet.suggest")); assert.equal(calls.includes("spawn_worker"), false) }
  await adapter.chatCreate({ ...params, surface: "tray" })
  assert.equal(assessCalls, 1)
  assert.deepEqual(calls, ["fleet_suggest_propose"])
  assert.equal(stats.totalTokens, 42)
  assert.notEqual(tm.get(parent.id)?.agent_role, "orchestrator")
  assert.match(JSON.stringify(streamed[0].messages), /preflight suggestion was already shown/)
})

test("preflight failure continues original request; cancellation does not start main model", async () => {
  const first = setup(); assessFails = true
  await adapter.chatCreate({ ...first.params, surface: "tray" })
  assert.equal(streamed.length, 1)
  assert.equal(first.calls.length, 0)
  const second = setup(), controller = new AbortController()
  onComplete = () => controller.abort()
  await assert.rejects(adapter.chatCreate({ ...second.params, surface: "tray", signal: controller.signal }))
  assert.equal(streamed.length, 0)
  assert.equal(second.calls.length, 0)
})

test("promoted orchestrator under cruise assesses the actual default browser worker surface", async () => {
  const { tm, parent, params, sent } = setup()
  const { ORCHESTRATOR_TOOL_ALLOWLIST } = await import("../src/orchestrator/constants")
  const { computeWorkerWhitelist, workerParentCapabilityWhitelist } = await import("../src/orchestrator/spawn")
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id,
    tool_whitelist: [...ORCHESTRATOR_TOOL_ALLOWLIST] })
  const allowed = tm.isToolAllowed.bind(tm)
  tm.isToolAllowed = (id, tool) => allowed(id, tool, { cruiseOpen: true })
  await adapter.chatCreate({ ...params, surface: "tray" })
  assert.equal(assessCalls, 1)
  const expected = computeWorkerWhitelist({ parentWhitelist: workerParentCapabilityWhitelist(tm.get(parent.id)), roleAllow: null })
  assert.ok(expected.includes("get_page_text"))
  assert.ok(expected.includes("create_tab"))
  assert.ok(!expected.includes("shell_exec"))
  assert.ok(String(assessed[0].messages[0].content).includes(JSON.stringify(expected)))
  assert.ok(sent.some(e => e.type === "fleet.suggest"))
})

test("worker, summoner, auto continuation and filtered tools do not invoke assessment", async () => {
  for (const mode of ["worker", "summoner", "continuation", "filtered"] as const) {
    const { params, tm, parent } = setup()
    if (mode === "worker") tm.update(parent.id, { agent_role: "worker", parent_thread_id: "elsewhere" })
    if (mode === "filtered") tm.update(parent.id, { tool_whitelist: ["get_page_text"] })
    await adapter.chatCreate({ ...params, surface: mode === "summoner" ? "summoner" : "tray", skipUserMessage: mode === "continuation" })
    assert.equal(assessCalls, 0, mode)
  }
})

test("parent's early finish is intercepted; actual failed-worker handback reaches next model before chat.done", async () => {
  const { tm, parent, params, sent, calls } = setup()
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const worker = tm.create("research worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id,
    last_run_ended_at: "end", last_run_terminal: "circuit_breaker" })
  tm.addMessage(worker.id, { thread_id: worker.id, role: "assistant", content: "部分结果：来源 A 已确认，来源 B 未取得" })
  onStream = round => { if (round === 2) assert.equal(sent.filter(e => e.type === "chat.done").length, 0) }
  await adapter.chatCreate(params)
  assert.equal(streamed.length, 2)
  assert.deepEqual(calls, ["collect_handback"])
  assert.match(JSON.stringify(streamed[1].messages), /circuit_breaker/)
  assert.match(JSON.stringify(streamed[1].messages), /来源 A 已确认/)
  assert.match(JSON.stringify(streamed[1].messages), /untrusted-/)
  assert.equal(sent.filter(e => e.type === "chat.done").length, 1)
})

test("waiting releases parent slot, then reacquires it before result summary", async () => {
  const { tm, parent, params, sent } = setup()
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const worker = tm.create("live worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id })
  gates.tryAcquireMultiAgentLlmLoop(tm.get(parent.id), parent.id)
  gates.tryAcquireMultiAgentLlmLoop(tm.get(worker.id), worker.id)
  const timer = setTimeout(() => {
    assert.equal(gates.multiAgentLlmLoopSnapshot().holders.includes(parent.id), false)
    assert.equal(sent.filter(e => e.type === "chat.done").length, 0)
    tm.addMessage(worker.id, { thread_id: worker.id, role: "assistant", content: "worker 最终结果" })
    tm.update(worker.id, { last_run_ended_at: "done", last_run_terminal: null })
    gates.releaseMultiAgentLlmLoop(worker.id)
  }, 50)
  onStream = round => { if (round === 2) assert.equal(gates.multiAgentLlmLoopSnapshot().holders.includes(parent.id), true) }
  await adapter.chatCreate(params)
  clearTimeout(timer)
  gates.releaseMultiAgentLlmLoop(parent.id)
  assert.equal(streamed.length, 2)
})

for (const terminal of [null, "circuit_breaker"] as const) test(`resume cap exhaustion remains terminal after ${terminal ?? "normal completion"}`, async () => {
  const { tm, parent, params, sent, stats } = setup()
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const worker = tm.create("cap worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id })
  gates.tryAcquireMultiAgentLlmLoop(tm.get(parent.id), parent.id)
  gates.tryAcquireMultiAgentLlmLoop(tm.get(worker.id), worker.id)
  const acquire = gates.tryAcquireMultiAgentLlmLoop, taskClock = Date.now
  const timer = setTimeout(() => {
    tm.addMessage(worker.id, { thread_id: worker.id, role: "assistant", content: "finished" })
    tm.update(worker.id, { last_run_ended_at: "end", last_run_terminal: terminal })
    gates.releaseMultiAgentLlmLoop(worker.id)
    ;(gates as any).tryAcquireMultiAgentLlmLoop = () => {
      Date.now = () => taskClock() + 120_000
      return { ok: false, error: "cap full", active: 5, cap: 5 }
    }
  }, 50)
  try {
    await adapter.chatCreate(params)
    assert.equal(streamed.length, 1)
    assert.equal(stats.terminal, "error")
    assert.ok(sent.some(e => e.type === "chat.error" && e.error_code === "FLEET_RESUME_CAP"))
    assert.equal(sent.some(e => e.type === "chat.done"), false)
    assert.equal(sent.some(e => e.type === "chat.assistant" && e.content?.includes("子任务未全部完成")), terminal !== null)
    assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${worker.id}`].result.status, terminal ? "failed" : "completed")
  } finally {
    clearTimeout(timer); Date.now = taskClock
    ;(gates as any).tryAcquireMultiAgentLlmLoop = acquire
  }
})

test("real supervision projects a long report once, retains original and records actual collection", async () => {
  const { tm, parent, params } = setup()
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const worker = tm.create("long report worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id,
    last_run_ended_at: "done", last_run_terminal: null })
  const raw = "REPORT_BEGIN_577 " + "可追溯数据。".repeat(10000) + " REPORT_END_577"
  const source = tm.addMessage(worker.id, { thread_id: worker.id, role: "assistant", content: raw })
  const history: any[] = []
  await adapter.chatCreate({ ...params, historyStore: { record: async (row: any) => { history.push(row); return 1 } } as any })
  assert.equal(streamed.length, 2)
  const messages = streamed[1].messages
  const context = JSON.stringify(messages)
  assert.equal(context.split("REPORT_BEGIN_577").length - 1, 1)
  assert.equal(context.includes("REPORT_END_577"), false)
  assert.ok(context.includes(source.id))
  assert.ok(context.includes("raw_report_omitted"))
  const toolRows = messages.filter((m: any) => m.role === "tool" && m.name === "collect_handback")
  assert.equal(toolRows.length, 1)
  assert.ok(toolRows[0].content.length < 6000)
  assert.equal(tm.getMessages(worker.id).find(m => m.id === source.id)?.content, raw)
  assert.ok(history.some(h => h.tool_name === "collect_handback" && h.success === 1))
  assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${worker.id}`].result.source.message_id, source.id)
  const detail = await dispatch.executeCompanionTool("collect_handback", { __thread_id: parent.id, worker_id: worker.id, report_offset: raw.length - 20, report_limit: 20 })
  assert.equal(detail.data.report_excerpt.text, raw.slice(-20))
  assert.equal(detail.data.report_excerpt.has_more, false)
  const { projectCooperationToolResult } = await import("../src/orchestrator/cooperation-result")
  assert.ok(JSON.stringify(projectCooperationToolResult("collect_handback", detail)).includes("REPORT_END_577"))
})

test("actual ACP collection/status share the persisted contract without starting a process", async () => {
  const { tm, parent } = setup()
  const { saveConfig } = await import("../src/config")
  const { getAcpManager } = await import("../src/acp/manager")
  saveConfig({ acp: { enabled: true, servers: { test: { enabled: true, command: "/bin/echo", policy: { profile: "review_readonly" } } } } } as any)
  const offer = getAcpManager().propose({ threadId: parent.id, agentId: "test", goal: "review", workspaceRoot: temp })
  assert.ok(offer.ok)
  const session = offer.session
  session.state = "closed"; session.handback_text = "partial findings"; session.terminal_kind = "failed"
  for (const name of ["acp_collect_result", "acp_get_status"]) {
    const result = await dispatch.executeCompanionTool(name, { __thread_id: parent.id, session_id: session.session_id })
    assert.equal(result.success, true)
    assert.equal(result.data.task_result.status, "failed")
    assert.equal(result.data.task_result.recovery.budget_remaining, 1)
  }
  assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`acp:${session.session_id}`].result.executor, "acp")
  assert.equal(session.pid, undefined)
  const detail = await dispatch.executeCompanionTool("acp_collect_result", { __thread_id: parent.id, session_id: session.session_id, report_offset: 8, report_limit: 8 })
  assert.equal(detail.data.report_excerpt.text, session.handback_text.slice(8, 16))
  const invalid = await dispatch.executeCompanionTool("acp_collect_result", { __thread_id: parent.id, session_id: session.session_id, report_offset: -1 })
  assert.equal(invalid.success, false)
  assert.equal(invalid.error_code, "INVALID_PARAMS")
  assert.equal(invalid.data.task_result.status, "failed")
})

test("board_read refreshes ACP state from the actual session without recollection", async () => {
  const { tm, parent } = setup()
  const { saveConfig } = await import("../src/config")
  const { getAcpManager } = await import("../src/acp/manager")
  const { ensureBoard } = await import("../src/board/service")
  const { acpTaskResult } = await import("../src/orchestrator/cooperation-result")
  const { recordCooperationResult } = await import("../src/orchestrator/cooperation-state")
  tm.update(parent.id, { agent_role: "orchestrator", board_mode: true })
  await ensureBoard(tm, parent.id, { force: true })
  saveConfig({ acp: { enabled: true, servers: { test: { enabled: true, command: "/bin/echo", policy: { profile: "review_readonly" } } } } } as any)
  const offer = getAcpManager().propose({ threadId: parent.id, agentId: "test", goal: "review", workspaceRoot: temp })
  assert.ok(offer.ok)
  const session = offer.session
  session.state = "running"
  recordCooperationResult(tm, parent.id, acpTaskResult(session))
  session.state = "closed"; session.terminal_kind = "closed"; session.handback_text = "new final report"
  const read = await dispatch.executeCompanionTool("board_read", { __thread_id: parent.id })
  const task = read.data.cooperation.tasks.find((t: any) => t.source.session_id === session.session_id)
  assert.equal(task.status, "completed")
  assert.equal(task.recovery.action, "none")
  assert.equal(task.summary, "new final report")
  assert.equal(task.source.version, acpTaskResult(session).source.version)
  assert.equal(tm.get(parent.id)?.cooperation_tasks?.[task.task_id].result.status, "running", "snapshot refresh is read-only")
})

test("ACP cancellation keeps its terminal kind when a late CLI exit callback arrives", async () => {
  const { parent } = setup()
  const { saveConfig } = await import("../src/config")
  const { getAcpManager } = await import("../src/acp/manager")
  saveConfig({ acp: { enabled: true, servers: { test: { enabled: true, command: "/bin/echo", protocol: "cli", policy: { profile: "review_readonly" } } } } } as any)
  const manager = getAcpManager()
  const offer = manager.propose({ threadId: parent.id, agentId: "test", goal: "review", workspaceRoot: temp })
  assert.ok(offer.ok)
  assert.equal(manager.cancel(offer.session.session_id).ok, true)
  ;(manager as any).finishSession(offer.session, "late body", 4000, null)
  assert.equal(offer.session.terminal_kind, "cancelled")
  const read = await dispatch.executeCompanionTool("acp_get_status", { __thread_id: parent.id, session_id: offer.session.session_id })
  assert.equal(read.data.task_result.status, "cancelled")
  assert.equal(offer.session.pid, undefined)
})

test("#837 three-worker replay: two handbacks are shown at timeout, late round-limit is assessed and only a released worker closes", async t => {
  const { tm, parent, params, sent, calls } = setup()
  const { cooperationSnapshot } = await import("../src/orchestrator/cooperation-state")
  const { reconcileFleetFollowup, reapReleasedWorkers, requestWorkerRelease } = await import("../src/orchestrator/fleet-continuity")
  const { collectWorkerHandback, resolveToolCallFromThreadMessages } = await import("../src/board")
  const mockComplete = Provider.prototype.complete
  t.after(() => { Provider.prototype.complete = mockComplete; gates._resetMultiAgentLlmLoopsForTests() })
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const workers = ["来源一", "来源二", "晚到"].map(alias => {
    const worker = tm.create(alias)
    tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id,
      last_run_execution_id: worker.id })
    return worker
  })
  for (const [i, worker] of workers.slice(0, 2).entries()) {
    tm.addMessage(worker.id, { thread_id: worker.id, role: "assistant", content: `已核对的证据 ${i + 1}` })
    tm.update(worker.id, { last_run_ended_at: new Date().toISOString(), last_run_terminal: null, last_run_settled_execution_id: worker.id })
  }
  const late = workers[2]
  assert.ok(gates.tryAcquireMultiAgentLlmLoop(tm.get(late.id), late.id).ok)
  const active = await dispatch.buildIsThreadLlmActive()
  const initial = cooperationSnapshot(tm, parent.id, { isActive: active })
  assert.equal(initial.workers.length, 3)
  assert.equal(initial.workers.find(row => row.worker_id === late.id)?.status, "running")
  assert.throws(() => requestWorkerRelease(tm, parent.id, late.id, active), /须已结束/)

  // Move just the deadline clock after the two real handbacks. No ten-minute sleep.
  const clock = Date.now
  let reads = 0
  try {
    await adapter.chatCreate({ ...params, executeTool: async (...args) => {
      const result = await params.executeTool(args[0], args[1], args[2])
      if (args[1] === "collect_handback" && ++reads === 2) Date.now = () => clock() + 10 * 60_000 + 1
      return result
    } })
  } finally { Date.now = clock }
  const partial = tm.getMessages(parent.id).at(-1)?.content ?? ""
  assert.match(partial, /本轮等待已达到时限/)
  assert.match(partial, /已核对的证据 1/)
  assert.match(partial, /已核对的证据 2/)
  assert.ok(partial.includes(late.id))
  assert.deepEqual(tm.get(parent.id)?.fleet_followup?.pending, [late.id])
  assert.deepEqual(calls, ["collect_handback", "collect_handback"])

  let judgments = 0
  Provider.prototype.complete = async input => {
    judgments++
    assert.match(JSON.stringify(input.messages), /round_limit/)
    assert.match(JSON.stringify(input.messages), /已核对的证据 1/)
    assert.equal("tools" in input, false)
    return { content: JSON.stringify({ decision: "adjust", summary: "保留前两份证据。缺少第三个来源，补派前请确认。", release_worker_ids: [workers[0].id, late.id] }) }
  }
  const collect = async (parentId: string, workerId: string, current: () => boolean) => collectWorkerHandback(tm, {
    workerId, callerThreadId: parentId, isThreadLlmActive: active, sourceStillCurrent: current,
    resolveToolCall: resolveToolCallFromThreadMessages(tm, workerId, parentId),
  })
  const opts = { active, send: (frame: unknown) => sent.push(frame), collect }
  await reconcileFleetFollowup(tm, opts)
  assert.equal(judgments, 0)
  tm.update(late.id, { last_run_terminal: "round_limit", last_run_ended_at: new Date().toISOString(), last_run_settled_execution_id: late.id })
  gates.releaseMultiAgentLlmLoop(late.id)
  await reconcileFleetFollowup(tm, opts)
  await reconcileFleetFollowup(tm, opts)
  assert.equal(judgments, 1)
  assert.equal(tm.get(parent.id)?.fleet_followup, null)
  assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${late.id}`]?.result.missing[0], "round_limit")
  assert.match(tm.getMessages(parent.id).at(-1)?.content ?? "", /主对话判断（调整）/)
  assert.equal(tm.get(late.id)?.worker_release, undefined, "no delivered content, no release")
  assert.equal(tm.get(workers[1].id)?.worker_release, undefined, "absence of a release decision is not consent")
  const observed = Date.parse(tm.get(parent.id)!.cooperation_tasks![`browser:${workers[0].id}`].observed_at)
  assert.equal(tm.get(workers[0].id)?.worker_release?.due_at, observed + 180_000)
  assert.equal(reapReleasedWorkers(tm, active, observed + 179_999), false)
  assert.equal(reapReleasedWorkers(tm, active, observed + 180_000), true)
  assert.equal(cooperationSnapshot(tm, parent.id).workers.find(row => row.worker_id === workers[0].id)?.status, "closed")
  assert.match(tm.getMessages(workers[0].id).at(-1)?.content ?? "", /已核对的证据 1/)
  assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${workers[0].id}`]?.result.status, "completed")
})

test("#837 cancelled assessment cannot publish and a restored follow-up can reconcile terminal state", async () => {
  const { tm, parent, params } = setup()
  const { armFleetFollowup, cancelFleetFollowup, reconcileFleetFollowup } = await import("../src/orchestrator/fleet-continuity")
  const worker = tm.create("terminal worker")
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id, last_run_execution_id: parent.id })
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id,
    last_run_execution_id: worker.id, last_run_settled_execution_id: worker.id,
    last_run_terminal: "round_limit", last_run_ended_at: new Date().toISOString() })
  const sent: unknown[] = []
  const opts = { active: () => false, collect: async () => {}, send: (frame: unknown) => sent.push(frame) }
  armFleetFollowup(tm, parent.id, parent.id, [worker.id], params.config)
  await reconcileFleetFollowup(tm, { ...opts, assess: async (_config, _objective, _states, signal) => {
    cancelFleetFollowup(tm, parent.id)
    assert.equal(signal.aborted, true)
    return { decision: "finish", summary: "stale answer", release_worker_ids: [] }
  } })
  assert.equal(sent.length, 0)
  assert.equal(tm.getMessages(parent.id).length, 0)
  armFleetFollowup(tm, parent.id, parent.id, [worker.id], params.config)
  const restored = new ThreadManager()
  await reconcileFleetFollowup(restored, { ...opts, assess: async () => assert.fail("provider credentials are not restored") })
  assert.match(restored.getMessages(parent.id).at(-1)?.content ?? "", /主对话判断（调整）/)
  assert.equal(restored.get(parent.id)?.fleet_followup, null)
})
