import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"

// Actual chatCreate -> dispatch -> live handback -> runtime supervisor. The
// provider is scripted; no browser, worker process, endpoint or credentials.
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fleet-wait-714-"))
const priorData = process.env.CMSPARK_DATA_DIR
process.env.CMSPARK_DATA_DIR = owned
let adapter: typeof import("../src/llm/adapter")
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let dispatch: typeof import("../src/tool/companion-dispatch")
let gates: typeof import("../src/orchestrator/llm-loop-gate")
let Provider: typeof import("../src/llm/providers/openai").OpenAIProvider
let originalStream: InstanceType<typeof Provider>["streamChat"]
let originalComplete: InstanceType<typeof Provider>["complete"]
let providerRound: (p: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>

before(async () => {
  await (await import("../src/config")).initDataDir()
  adapter = await import("../src/llm/adapter")
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  dispatch = await import("../src/tool/companion-dispatch")
  gates = await import("../src/orchestrator/llm-loop-gate")
  Provider = (await import("../src/llm/providers/openai")).OpenAIProvider
  originalStream = Provider.prototype.streamChat
  originalComplete = Provider.prototype.complete
  Provider.prototype.streamChat = function (p) { return providerRound(p) }
  Provider.prototype.complete = async () => ({ content: "owned title" })
})

after(() => {
  Provider.prototype.streamChat = originalStream
  Provider.prototype.complete = originalComplete
  gates._resetMultiAgentLlmLoopsForTests()
  if (priorData === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = priorData
  fs.rmSync(owned, { recursive: true, force: true })
})

function setup(count: number) {
  gates._resetMultiAgentLlmLoopsForTests()
  const tm = new ThreadManager(), parent = tm.create("parent")
  tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
  const workers = Array.from({ length: count }, (_, i) => {
    const w = tm.create(`worker ${i}`)
    tm.update(w.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id })
    assert.equal(gates.tryAcquireMultiAgentLlmLoop(tm.get(w.id), w.id).ok, true)
    return w
  })
  assert.equal(gates.tryAcquireMultiAgentLlmLoop(tm.get(parent.id), parent.id).ok, true)
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: { request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" }) } as any,
    getComputerEstopEnsureOverride: () => null, rejectPendingForThread: () => 0,
    hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  const frames: any[] = [], calls: string[] = [], results: any[] = [], inputs: StreamChatParams[] = []
  const settle = () => {
    for (const w of workers) {
      tm.addMessage(w.id, { thread_id: w.id, role: "assistant", content: `OWNED_REPORT_${w.id}` })
      tm.update(w.id, { last_run_ended_at: "settled", last_run_terminal: null })
      gates.releaseMultiAgentLlmLoop(w.id)
    }
  }
  let waitAction = settle
  let waits = 0
  const stats = { toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0, terminal: null } as any
  const params = {
    threadId: parent.id, message: "continue owned tasks", skillIds: [], skipUserMessage: true,
    config: { base_url: "http://127.0.0.1:9", api_key: "inert", model_name: "inert", temperature: 0, context_window: 32000, context_compaction: "off" as const },
    threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: async () => 0 } as any,
    runStats: stats,
    sendToExtension: (e: any) => {
      frames.push(e)
      if (e.type === "chat.assistant" && e.content === "正在等待并收集子任务结果；完成后继续汇总。") {
        waits++
        assert.equal(gates.multiAgentLlmLoopSnapshot().holders.includes(parent.id), false)
        assert.equal(frames.some(f => f.type === "chat.done"), false)
        queueMicrotask(() => waitAction())
      }
    },
    executeTool: async (id: string, name: string, args: any) => {
      calls.push(name)
      const result = await dispatch.executeCompanionTool(name, args, id, { handshakeSurface: "tray", broadcast: e => frames.push(e) })
      results.push({ name, result })
      return result
    },
  }
  const setScript = (first: Array<{ name: string; args: any }>) => {
    providerRound = async function* (p) {
      inputs.push(p)
      if (inputs.length === 1) {
        for (const [index, tc] of first.entries()) yield { type: "tool_call_delta", index, id: `owned_${index}`, name: tc.name, arguments: JSON.stringify(tc.args) }
        yield { type: "done", finish_reason: "tool_calls" }
      } else {
        assert.equal(gates.multiAgentLlmLoopSnapshot().holders.includes(parent.id), true)
        yield { type: "token", text: "combined owned result" }
        yield { type: "done", finish_reason: "stop" }
      }
    }
  }
  return { tm, parent, workers, params, stats, frames, calls, results, inputs, setScript,
    settle, get waits() { return waits }, setWait: (f: () => void) => { waitAction = f } }
}

for (const count of [1, 3]) test(`early collect batch for ${count} live workers waits and collects without parent breaker`, async () => {
  const s = setup(count)
  s.setScript(Array.from({ length: 3 }, (_, i) => ({ name: "collect_handback", args: { worker_id: s.workers[i % count].id } })))
  try {
    await adapter.chatCreate(s.params)
    assert.equal(s.stats.terminal, null)
    assert.equal(s.waits, 1)
    assert.equal(s.inputs.length, 2)
    const early = s.results.slice(0, 3)
    assert.equal(early.every(r => r.result.error_code === "WORKER_STILL_RUNNING" && !r.result.success), true)
    for (const w of s.workers) {
      assert.ok(JSON.stringify(s.inputs[1].messages).includes(`OWNED_REPORT_${w.id}`))
      assert.equal(s.tm.get(s.parent.id)?.cooperation_tasks?.[`browser:${w.id}`].result.status, "completed")
    }
    assert.equal(s.frames.some(f => f.type === "chat.error"), false)
    assert.equal(s.frames.filter(f => f.type === "chat.done").length, 1)
  } finally { gates.releaseMultiAgentLlmLoop(s.parent.id) }
})

test("wait_workers poll transfers to bounded runtime wait before another provider round", async () => {
  const s = setup(3)
  s.setScript([{ name: "wait_workers", args: {} }])
  try {
    await adapter.chatCreate(s.params)
    assert.equal(s.waits, 1)
    assert.equal(s.inputs.length, 2)
    assert.equal(s.calls.filter(n => n === "wait_workers").length, 1)
    for (const w of s.workers) assert.ok(JSON.stringify(s.inputs[1].messages).includes(`OWNED_REPORT_${w.id}`))
  } finally { gates.releaseMultiAgentLlmLoop(s.parent.id) }
})

test("user abort during tool-requested runtime wait never resumes the provider or marks done", async () => {
  const s = setup(1), controller = new AbortController()
  s.setScript([{ name: "wait_workers", args: {} }])
  s.setWait(() => controller.abort())
  try {
    await assert.rejects(adapter.chatCreate({ ...s.params, signal: controller.signal }), { name: "AbortError" })
    assert.equal(s.waits, 1)
    assert.equal(s.inputs.length, 1)
    assert.equal(s.frames.some(f => f.type === "chat.done"), false)
    assert.equal(s.tm.get(s.workers[0].id)?.last_run_ended_at, undefined)
  } finally {
    gates.releaseMultiAgentLlmLoop(s.workers[0].id)
    gates.releaseMultiAgentLlmLoop(s.parent.id)
  }
})

test("a full parent slot is yielded so a genuinely deferred owned kick can settle", async () => {
  const s = setup(4), w = s.tm.create("queued fifth worker")
  s.tm.update(w.id, { agent_role: "worker", parent_thread_id: s.parent.id, orchestrator_run_id: s.parent.id })
  let kicks = 0
  const scheduled = gates.scheduleWhenLlmSlotAvailable(s.tm.get(w.id), w.id, async () => {
    kicks++
    s.tm.addMessage(w.id, { thread_id: w.id, role: "assistant", content: "OWNED_QUEUED_REPORT" })
    s.tm.update(w.id, { last_run_ended_at: "settled", last_run_terminal: null })
  })
  assert.equal(scheduled.queued, true)
  s.setScript([{ name: "wait_workers", args: {} }])
  try {
    await adapter.chatCreate(s.params)
    assert.equal(kicks, 1)
    assert.equal(s.inputs.length, 2)
    assert.ok(JSON.stringify(s.inputs[1].messages).includes("OWNED_QUEUED_REPORT"))
    assert.equal(gates.pendingDeferredLlmKickCount(), 0)
  } finally { gates.releaseMultiAgentLlmLoop(s.parent.id) }
})

test("pending collection does not erase genuine collection failures or weaken the third-strike guard", async () => {
  const s = setup(2), empty = s.workers[0], pending = s.workers[1]
  s.tm.update(empty.id, { last_run_ended_at: "empty-end", last_run_terminal: null })
  gates.releaseMultiAgentLlmLoop(empty.id)
  s.setScript([empty, pending, empty, pending, empty].map(w => ({ name: "collect_handback", args: { worker_id: w.id, expect_structured: true } })))
  try {
    await adapter.chatCreate(s.params)
    assert.equal(s.stats.terminal, "circuit_breaker")
    assert.equal(s.waits, 0)
    assert.equal(s.inputs.length, 1)
    assert.equal(s.results.filter(r => r.result.error_code === "WORKER_STILL_RUNNING").length, 2)
    assert.equal(s.results.filter(r => r.result.error_code === "HANDBACK_MISSING_STRUCTURE").length, 3)
    assert.equal(s.frames.some(f => f.type === "chat.done"), false)
  } finally {
    gates.releaseMultiAgentLlmLoop(pending.id)
    gates.releaseMultiAgentLlmLoop(s.parent.id)
  }
})

test("a foreign live worker remains denied instead of entering owned fleet coordination", async () => {
  const s = setup(1)
  s.tm.update(s.workers[0].id, { parent_thread_id: "other-parent", orchestrator_run_id: "other-run" })
  s.setScript([{ name: "collect_handback", args: { worker_id: s.workers[0].id } }])
  try {
    await adapter.chatCreate(s.params)
    assert.equal(s.stats.terminal, "security_halt")
    assert.equal(s.waits, 0)
    assert.equal(s.inputs.length, 1)
    assert.equal(s.results[0].result.data.error_code, "WORKER_NOT_OWNED")
  } finally {
    gates.releaseMultiAgentLlmLoop(s.workers[0].id)
    gates.releaseMultiAgentLlmLoop(s.parent.id)
  }
})

test("timeout permits one summary then ends repeated polls with a persisted pending reply", async () => {
  const s = setup(1), originalNow = Date.now
  const { FLEET_WAIT_MS } = await import("../src/orchestrator/fleet-supervision")
  s.setWait(() => { Date.now = () => originalNow() + FLEET_WAIT_MS + 10 })
  providerRound = async function* (p) {
    s.inputs.push(p)
    if (s.inputs.length <= 3) {
      yield { type: "tool_call_delta", index: 0, id: `timeout_${s.inputs.length}`, name: "wait_workers", arguments: "{}" }
      yield { type: "done", finish_reason: "tool_calls" }
    } else {
      yield { type: "token", text: "no further polling" }
      yield { type: "done", finish_reason: "stop" }
    }
  }
  try {
    await adapter.chatCreate(s.params)
    assert.equal(s.inputs.length, 2)
    assert.equal(s.waits, 1)
    assert.equal(s.calls.filter(n => n === "wait_workers").length, 2)
    const done = s.frames.filter(f => f.type === "chat.done")
    assert.equal(done.length, 1)
    const final = s.tm.getMessages(s.parent.id).find(m => m.id === done[0].message_id)
    assert.match(final?.content ?? "", /仍在运行/)
    assert.equal(final?.tool_calls?.length ?? 0, 0)
    assert.equal(s.tm.get(s.workers[0].id)?.last_run_ended_at, undefined)
    assert.equal(s.stats.terminal, null, "waiting is not a fabricated execution error")
  } finally {
    Date.now = originalNow
    gates.releaseMultiAgentLlmLoop(s.workers[0].id)
    gates.releaseMultiAgentLlmLoop(s.parent.id)
  }
})

test("a superseded parent cannot collect or summarize after runtime waiting", async () => {
  const s = setup(1)
  s.setScript([{ name: "wait_workers", args: {} }])
  s.setWait(() => { adapter.claimRunTerminalEpoch(s.parent.id); s.settle() })
  try {
    await assert.rejects(adapter.chatCreate(s.params), { name: "AbortError" })
    assert.equal(s.inputs.length, 1)
    assert.equal(s.calls.filter(n => n === "collect_handback").length, 0)
    assert.equal(s.frames.some(f => f.type === "chat.done"), false)
  } finally { gates.releaseMultiAgentLlmLoop(s.parent.id) }
})

for (const terminal of [null, "circuit_breaker"] as const) test(`recovered earlier ${terminal ?? "partial"} report remains a current review source`, async () => {
  const s = setup(1), w = s.workers[0]
  const planRuntime = await import("../src/orchestrator/cooperation-plan")
  const plan = planRuntime.createCooperationPlan(s.tm, s.parent.id, { tasks: [{ id: "research", goal: "owned research", criteria: [{ id: "coverage", description: "coverage" }] }] })
  planRuntime.bindPlannedWorker(s.tm, s.parent.id, { plan_id: plan.id, plan_task_id: "research", plan_task_attempt: 1, goal: "owned research" }, w.id, () => false)
  const body = s.tm.addMessage(w.id, { thread_id: w.id, role: "assistant", content: "Owned partial research report" })
  s.tm.addMessage(w.id, { thread_id: w.id, role: "assistant", content: "", tool_calls: [{ id: "tail", name: "get_page_text", params: {}, status: "completed" }], finish_reason: "tool_calls" })
  s.tm.addMessage(w.id, { thread_id: w.id, role: "tool", content: "owned completed tool result" })
  s.tm.update(w.id, { last_run_ended_at: "ended", last_run_terminal: terminal, last_run_execution_id: "owned-execution", last_run_settled_execution_id: "owned-execution" })
  gates.releaseMultiAgentLlmLoop(w.id)
  try {
    const read = await s.params.executeTool("collect-owned", "collect_handback", { __thread_id: s.parent.id, worker_id: w.id })
    assert.equal(read.success, true)
    const result = read.data.task_result
    assert.equal(result.source.message_id, body.id)
    assert.equal(result.status, terminal ? "failed" : "partial")
    const input = { plan_id: plan.id, task_id: "research", source_version: result.source.version, criteria: [{ id: "coverage", passed: false, reason: "partial coverage", refs: [`source:${result.source.version}`] }], conflicts: [] }
    const reviewed = planRuntime.reviewCooperationTask(s.tm, s.parent.id, input, () => false)
    assert.equal(reviewed.accepted, false)
    assert.equal(planRuntime.cooperationPlanSnapshot(s.tm, s.parent.id, () => false)?.tasks[0].runtime_status, terminal ? "failed" : "partial")
    s.tm.addMessage(w.id, { thread_id: w.id, role: "assistant", content: "A newer nonempty report" })
    assert.throws(() => planRuntime.reviewCooperationTask(s.tm, s.parent.id, input, () => false), /terminal report|changed|stale/)
  } finally { gates.releaseMultiAgentLlmLoop(s.parent.id) }
})

test("actual router exit yields to an owned cap-queued kick instead of completing the armed parent", async () => {
  const s = setup(0)
  const router = await import("../src/message-router")
  const kernel = await import("../src/loop/loop-kernel")
  const queues = await import("../src/llm/run-queues")
  const cfg = await import("../src/config")
  cfg.saveConfig({ llm: s.params.config } as any)
  queues._resetRunQueuesForTests()
  kernel.armLoop(s.tm, s.parent.id, "explicit_command", { audit: () => {} })
  s.tm.update(s.parent.id, { run_progress: { items: [{ id: "owned", text: "local preparation", done: true, source: "seed", tool: "list_tabs" }] } })
  s.setScript([{ name: "list_tabs", args: {} }])
  let injected = false, queued = false, kicks = 0
  let finishKick: () => void = () => {}
  const busy = Array.from({ length: 4 }, (_, i) => `other-parent-busy-${i}`)
  const child = s.tm.create("owned queued work")
  const session = {
    sendToExtension: (frame: any) => {
      s.params.sendToExtension(frame)
      if (frame.type !== "chat.done" || injected) return
      injected = true
      s.tm.update(child.id, { agent_role: "worker", parent_thread_id: s.parent.id, orchestrator_run_id: s.parent.id })
      for (const id of busy) assert.equal(gates.tryAcquireMultiAgentLlmLoop({ agent_role: "worker" }, id).ok, true)
      const result = gates.scheduleWhenLlmSlotAvailable(s.tm.get(child.id), child.id, () => {
        kicks++
        return new Promise<void>(resolve => { finishKick = resolve })
      })
      queued = result.queued
    },
    executeTool: async (id: string, name: string, args: any) => name === "list_tabs"
      ? { success: true, data: { tabs: [] } }
      : s.params.executeTool(id, name, args),
  } as any
  try {
    await router.handleMessage({ type: "chat.create", thread_id: s.parent.id, message: "continue owned preparation" },
      { threadManager: s.tm, skillEngine: s.params.skillEngine, historyStore: s.params.historyStore }, session)
    assert.equal(queued, true)
    assert.equal(kicks, 1, "parent release drains the actual gate queue")
    assert.equal(router.listLlmActiveThreadIds().includes(child.id), false, "no worker chat or abort-map entry was created")
    assert.equal(s.tm.get(s.parent.id)?.loop_state?.status, "active", "owned worker is still pending; parent is not machine-complete")
    assert.equal(s.tm.get(s.parent.id)?.loop_state?.runs_used, 0)
  } finally {
    finishKick()
    await Promise.resolve()
    for (const id of [...busy, child.id, s.parent.id]) gates.releaseMultiAgentLlmLoop(id)
    gates.cancelDeferredLlmKick(child.id)
    queues._resetRunQueuesForTests()
  }
})

test("one request deadline applies to a newer worker execution without hiding its pending state", async () => {
  const s = setup(1), w = s.workers[0]
  const { superviseFleet } = await import("../src/orchestrator/fleet-supervision")
  const reportedTimeouts = new Set<string>()
  const opts = { tm: s.tm, parentId: s.parent.id, isActive: () => true, reportedTimeouts,
    deadlineMs: 0, collect: async () => { throw Error("must not collect active work") } }
  try {
    const first = await superviseFleet(opts)
    assert.equal(first[0].status, "waiting_timeout")
    assert.deepEqual(await superviseFleet(opts), [])
    s.tm.update(w.id, { last_run_execution_id: "new-owned-execution" })
    const newer = await superviseFleet(opts)
    assert.equal(newer[0].status, "waiting_timeout", "new execution is disclosed without renewing the deadline")
    assert.deepEqual(await superviseFleet(opts), [])
  } finally {
    gates.releaseMultiAgentLlmLoop(w.id)
    gates.releaseMultiAgentLlmLoop(s.parent.id)
  }
})
