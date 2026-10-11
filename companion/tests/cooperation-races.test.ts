import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CooperationPlan } from "../src/orchestrator/cooperation-plan"

const dataDir = mkdtempSync(join(tmpdir(), "cmspark-cooperation-races-"))
const previousDataDir = process.env.CMSPARK_DATA_DIR
process.env.CMSPARK_DATA_DIR = dataDir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let dispatch: typeof import("../src/tool/companion-dispatch")
let policy: typeof import("../src/security-policy").securityPolicy

before(async () => {
  await (await import("../src/config")).initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  dispatch = await import("../src/tool/companion-dispatch")
  policy = (await import("../src/security-policy")).securityPolicy
})
after(() => {
  if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = previousDataDir
  rmSync(dataDir, { recursive: true, force: true })
})

function fixture() {
  let tm = new ThreadManager()
  const parent = tm.create("independent cooperation race regression")
  const kicks: Array<{ threadId: string; message: string }> = []
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {} as any, getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  const call = (name: string, params: Record<string, unknown> = {}) =>
    dispatch.executeCompanionTool(name, { ...params, __thread_id: parent.id }, undefined, {
      kickWorkerChat: row => { kicks.push(row) },
    })
  return { get tm() { return tm }, parent, kicks, call, reload: () => { tm = new ThreadManager() } }
}
type Fixture = ReturnType<typeof fixture>
async function createPlan(c: Fixture) {
  const result = await c.call("cooperation_plan", { tasks: [
    { id: "source", goal: "Read source", required_tools: ["get_page_text"], criteria: [{ id: "coverage", description: "Covers the source" }] },
    { id: "dependent", goal: "Use accepted source", depends_on: ["source"], criteria: [{ id: "coverage", description: "Uses accepted source" }] },
  ] })
  assert.equal(result.success, true, result.error)
  return result.data.plan as CooperationPlan
}
function approved(c: Fixture, p: CooperationPlan, taskId = "source", extra: Record<string, unknown> = {}) {
  const task = c.tm.get(c.parent.id)!.cooperation_plan!.tasks.find(t => t.id === taskId)!
  const params = { __thread_id: c.parent.id, plan_id: p.id, plan_task_id: taskId,
    plan_task_attempt: task.attempts.length + 1, goal: task.goal, tool_allow: ["get_page_text"], ...extra }
  return { ...params, security_token: policy.issueTokenFor("spawn_worker", params).token }
}
function finish(c: Fixture, workerId: string, content = "Recorded source report") {
  c.tm.addMessage(workerId, { thread_id: workerId, role: "assistant", content })
  c.tm.update(workerId, { last_run_ended_at: "2026-10-11T03:00:00Z", last_run_terminal: null })
}
async function accept(c: Fixture, p: CooperationPlan, sourceVersion: string) {
  const response = await c.call("cooperation_review", { plan_id: p.id, task_id: "source", source_version: sourceVersion,
    criteria: [{ id: "coverage", passed: true, reason: "Reviewed the recorded source", refs: [`source:${sourceVersion}`] }], conflicts: [] })
  assert.equal(response.success, true, response.error)
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test("recollection repairs a persisted result cache after checkpoint write interruption", async () => {
  const c = fixture(), p = await createPlan(c)
  const spawned = await c.call("spawn_worker", approved(c, p))
  assert.equal(spawned.success, true, spawned.error)
  const workerId = spawned.data.worker_id
  finish(c, workerId)
  const originalUpdate = c.tm.update.bind(c.tm)
  let injected = false
  c.tm.update = (threadId, updates) => {
    if (!injected && updates.cooperation_plan?.tasks.some(t => t.attempts.some(a => a.result))) {
      injected = true
      throw new Error("injected interruption before plan checkpoint commit")
    }
    return originalUpdate(threadId, updates)
  }
  await assert.rejects(c.call("collect_handback", { worker_id: workerId }), /injected interruption/)
  assert.equal(injected, true)
  c.reload()
  const cached = c.tm.get(c.parent.id)!.cooperation_tasks![`browser:${workerId}`].result
  assert.equal(cached.status, "completed", "the first production write reached disk")
  assert.equal(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].attempts[0].result, undefined)
  const recollected = await c.call("collect_handback", { worker_id: workerId })
  assert.equal(recollected.success, true, recollected.error)
  assert.equal(recollected.data.task_result.source.version, cached.source.version)
  assert.equal(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].attempts[0].result?.source.version, cached.source.version)
  await accept(c, p, cached.source.version)
  const status = await c.call("cooperation_status")
  assert.equal(status.data.plan.tasks[1].ready, true)
})

test("first spawn losing after an intent lock cannot undo the successful sibling promotion", async () => {
  const c = fixture(), p = await createPlan(c)
  const { ensureBoard, mutateMissionBoard } = await import("../src/board/service")
  const { IntentSchema, stampProvenance } = await import("../src/board/schema")
  await ensureBoard(c.tm, c.parent.id, { force: true })
  const intent = IntentSchema.parse({ id: "source_intent", description: "Read source", provenance: stampProvenance({ actor_type: "system" }),
    created_at: "2026-10-11T03:00:00Z", updated_at: "2026-10-11T03:00:00Z" })
  await mutateMissionBoard(c.tm, c.parent.id, board => ({ ok: true, board: { ...board, intents: [intent] } }))
  const entered = deferred(), release = deferred(), claimQueued = deferred()
  const hold = c.tm.withThreadLock(c.parent.id, async () => { entered.resolve(); await release.promise })
  await entered.promise
  const originalLock = c.tm.withThreadLock.bind(c.tm)
  c.tm.withThreadLock = (threadId, fn) => {
    if (threadId === c.parent.id) claimQueued.resolve()
    return originalLock(threadId, fn)
  }
  const first = c.call("spawn_worker", approved(c, p, "source", { intent_id: intent.id }))
  let second: Awaited<ReturnType<typeof c.call>>
  try {
    await claimQueued.promise
    second = await c.call("spawn_worker", approved(c, p))
    assert.equal(second.success, true, second.error)
    assert.equal(c.kicks.length, 1)
  } finally {
    release.resolve()
    await hold
  }
  const rejected = await first
  assert.equal(rejected.success, false)
  assert.equal(rejected.error_code, "COOPERATION_REJECTED")
  const parent = c.tm.get(c.parent.id)!
  assert.equal(parent.agent_role, "orchestrator")
  assert.equal(parent.orchestrator_run_id, second!.data.orchestrator_run_id)
  assert.equal(parent.cooperation_plan!.run_id, parent.orchestrator_run_id)
  assert.equal(parent.cooperation_plan!.tasks[0].attempts.length, 1)
  assert.deepEqual(c.tm.list().filter(t => t.parent_thread_id === parent.id).map(t => t.id), [second!.data.worker_id])
  const remainingIntent = parent.mission_board!.intents.find(item => item.id === intent.id)!
  assert.equal(remainingIntent.claimed_by_worker_id, null, "losing speculative spawn must release its own Board claim")
  finish(c, second!.data.worker_id)
  const read = await c.call("collect_handback", { worker_id: second!.data.worker_id })
  assert.equal(read.success, true, read.error)
  await accept(c, p, read.data.task_result.source.version)
})

test("a new uncollected message at the same terminal timestamp blocks both reuse and replacement", async () => {
  const c = fixture(), p = await createPlan(c)
  const spawned = await c.call("spawn_worker", approved(c, p))
  assert.equal(spawned.success, true, spawned.error)
  finish(c, spawned.data.worker_id)
  const read = await c.call("collect_handback", { worker_id: spawned.data.worker_id })
  await accept(c, p, read.data.task_result.source.version)
  // Keep the terminal stamp identical: message identity alone must invalidate the report.
  c.tm.addMessage(spawned.data.worker_id, { thread_id: spawned.data.worker_id, role: "assistant", content: "Correction invalidates the earlier report" })
  const status = await c.call("cooperation_status")
  assert.equal(status.data.plan.tasks[0].accepted, false)
  assert.equal(status.data.plan.tasks[0].runtime_status, "needs_collection")
  assert.equal(status.data.plan.tasks[0].next_action, "collect_handback")
  assert.equal(status.data.plan.tasks[1].ready, false)
  assert.equal((await c.call("spawn_worker", approved(c, p))).success, false)
  assert.equal((await c.call("spawn_worker", approved(c, p, "dependent"))).success, false)
  assert.equal(c.kicks.length, 1)
})

test("changing the expected attempt cannot adapt an old approval to a replacement", async () => {
  const c = fixture(), p = await createPlan(c)
  const oldApproval = approved(c, p)
  assert.equal((await c.call("spawn_worker", approved(c, p))).success, true)
  c.tm.update(c.kicks[0].threadId, { last_run_ended_at: "2026-10-11T04:00:00Z", last_run_terminal: "error" })
  await c.call("collect_handback", { worker_id: c.kicks[0].threadId })
  const tampered = await c.call("spawn_worker", { ...oldApproval, plan_task_attempt: 2 })
  assert.equal(tampered.success, false)
  assert.match(tampered.error!, /token/i)
  assert.equal(c.kicks.length, 1)
  assert.equal((await c.call("spawn_worker", approved(c, p))).success, true)
})

test("unsettled rerun invalidates unified status and is disclosed once after an earlier supervised result", async () => {
  const c = fixture(), p = await createPlan(c)
  const spawned = await c.call("spawn_worker", approved(c, p))
  assert.equal(spawned.success, true, spawned.error)
  const workerId = spawned.data.worker_id
  finish(c, workerId)
  c.tm.update(workerId, { last_run_execution_id: "settled_execution", last_run_settled_execution_id: "settled_execution" })
  const { superviseFleet } = await import("../src/orchestrator/fleet-supervision")
  const supervise = () => superviseFleet({ tm: c.tm, parentId: c.parent.id, isActive: () => false,
    collect: id => c.call("collect_handback", { worker_id: id }), timeoutMs: 0 })
  assert.equal((await supervise())[0].status, "completed")
  // Existing terminal fields stay unchanged when a process dies during the next run.
  c.tm.update(workerId, { last_run_execution_id: "unsettled_execution" })
  c.reload()
  const status = await c.call("cooperation_status")
  assert.equal(status.data.plan.tasks[0].runtime_status, "interrupted")
  assert.equal(status.data.cooperation.tasks.find((task: { task_id: string }) => task.task_id === `browser:${workerId}`).status, "stale")
  const disclosed = await supervise()
  assert.equal(disclosed.length, 1, "new execution must not match the old delivered epoch")
  assert.equal(disclosed[0].status, "interrupted")
  assert.deepEqual(await supervise(), [], "unchanged interrupted execution must not trigger a supervision loop")
})
