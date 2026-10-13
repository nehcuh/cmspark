import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import type { CooperationPlan } from "../src/orchestrator/cooperation-plan"

const root = mkdtempSync(join(tmpdir(), "cmspark-plan-contract-"))
const previousDataDir = process.env.CMSPARK_DATA_DIR
process.env.CMSPARK_DATA_DIR = root
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let dispatch: typeof import("../src/tool/companion-dispatch")
let policy: typeof import("../src/security-policy").securityPolicy
let runtime: typeof import("../src/orchestrator/cooperation-plan")

before(async () => {
  await (await import("../src/config")).initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  dispatch = await import("../src/tool/companion-dispatch")
  policy = (await import("../src/security-policy")).securityPolicy
  runtime = await import("../src/orchestrator/cooperation-plan")
})
after(() => {
  if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = previousDataDir
  rmSync(root, { recursive: true, force: true })
})

function setup() {
  const tm = new ThreadManager(), parent = tm.create("cooperation contract parent")
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
  return { tm, parent, call, kicks }
}
type Context = ReturnType<typeof setup>
const task = (id: string, depends_on: string[] = [], criteria = ["coverage"]) => ({
  id, goal: `Investigate ${id}`, depends_on, required_tools: ["get_page_text"], input_refs: [`document:${id}`],
  criteria: criteria.map(id => ({ id, description: `Establish ${id}` })),
})
async function plan(c: Context, tasks = [task("a")]) {
  const r = await c.call("cooperation_plan", { tasks })
  assert.equal(r.success, true, r.error)
  return r.data.plan as ReturnType<typeof runtime.cooperationPlanSnapshot> & {}
}
function spawnParams(c: Context, p: CooperationPlan, taskId: string) {
  return { __thread_id: c.parent.id, plan_id: p.id, plan_task_id: taskId,
    plan_task_attempt: c.tm.get(c.parent.id)!.cooperation_plan!.tasks.find(t => t.id === taskId)!.attempts.length + 1,
    goal: p.tasks.find(t => t.id === taskId)!.goal, role_label: "researcher", tool_allow: ["get_page_text"] }
}
async function spawn(c: Context, p: CooperationPlan, taskId: string) {
  const params = spawnParams(c, p, taskId)
  const token = policy.issueTokenFor("spawn_worker", params).token
  return c.call("spawn_worker", { ...params, security_token: token })
}
async function finish(c: Context, workerId: string, terminal: string | null = null, content = "Report with source findings") {
  c.tm.addMessage(workerId, { thread_id: workerId, role: "assistant", content })
  c.tm.update(workerId, { last_run_ended_at: new Date().toISOString(), last_run_terminal: terminal as any })
  const read = await c.call("collect_handback", { worker_id: workerId })
  assert.ok(read.data?.task_result, JSON.stringify(read))
  return read.data.task_result as import("../src/orchestrator/cooperation-result").CooperationResult
}
async function review(c: Context, p: CooperationPlan, taskId: string, result: Awaited<ReturnType<typeof finish>>, passed = true, conflicts: string[] = []) {
  return c.call("cooperation_review", { plan_id: p.id, task_id: taskId, source_version: result.source.version,
    criteria: p.tasks.find(t => t.id === taskId)!.criteria.map(x => ({ id: x.id, passed,
      reason: passed ? "Report addresses the criterion" : "Report lacks the required coverage",
      refs: [`source:${result.source.version}`] })), conflicts })
}

test("real tools persist validated plans; reject cycles, duplicates, worker owners and budget reset", async () => {
  const c = setup()
  for (const tasks of [[task("a", ["missing"])], [task("a", ["b"]), task("b", ["a"])], [task("a"), task("a")]]) {
    assert.equal((await c.call("cooperation_plan", { tasks })).success, false)
    assert.equal(c.tm.get(c.parent.id)?.cooperation_plan, undefined)
  }
  const p = await plan(c, [task("a"), task("b", ["a"])])
  assert.deepEqual(p.ready_task_ids, ["a"])
  assert.equal((await c.call("cooperation_plan", { tasks: [task("new")] })).success, false)
  assert.equal(new ThreadManager().get(c.parent.id)?.cooperation_plan?.id, p.id)
  const worker = c.tm.create("unauthorized worker")
  c.tm.update(worker.id, { agent_role: "worker", parent_thread_id: c.parent.id })
  for (const name of ["cooperation_plan", "cooperation_review", "cooperation_status"]) {
    assert.equal((await dispatch.executeCompanionTool(name, { __thread_id: worker.id, tasks: [task("x")] })).success, false, name)
  }
})

test("normal completion does not release dependency until source-backed, conflict-free acceptance", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("b", ["a"])])
  assert.equal((await spawn(c, p, "b")).success, false)
  assert.equal((await c.call("spawn_worker", spawnParams(c, p, "a"))).success, false, "no confirmation token")
  assert.equal((await spawn(c, p, "a")).success, true)
  const result = await finish(c, c.kicks[0].threadId)
  assert.equal(result.status, "completed")
  assert.equal((await spawn(c, p, "b")).success, false, "runtime completion is not acceptance")
  const fake = await c.call("cooperation_review", { plan_id: p.id, task_id: "a", source_version: result.source.version,
    criteria: [{ id: "coverage", passed: true, reason: "claimed", refs: ["evidence:invented"] }], conflicts: [] })
  assert.equal(fake.success, false)
  assert.equal((await review(c, p, "a", result, true, ["source totals disagree"])).success, true)
  assert.equal((await spawn(c, p, "b")).success, false, "unresolved conflict blocks dependents")
  const accepted = await review(c, p, "a", result)
  assert.equal(accepted.data.plan.semantic_truth_verified, false)
  assert.equal(accepted.data.plan.tasks[0].accepted, true)
  assert.equal((await spawn(c, p, "a")).success, false, "accepted checkpoint reused")
  assert.equal((await spawn(c, p, "b")).success, true)
})

test("replacement preserves accepted siblings, rejects late old reports and exhausts attempt budget", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("sibling")])
  await spawn(c, p, "sibling")
  const siblingResult = await finish(c, c.kicks.at(-1)!.threadId)
  assert.equal((await review(c, p, "sibling", siblingResult)).success, true)
  const workers: string[] = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal((await spawn(c, p, "a")).success, true)
    const wid = c.kicks.at(-1)!.threadId; workers.push(wid)
    const result = await finish(c, wid)
    assert.equal((await review(c, p, "a", result, false)).success, true)
    assert.equal(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].attempts.length, attempt)
  }
  const late = await c.call("collect_handback", { worker_id: workers[0] })
  assert.equal(late.success, false)
  assert.equal(late.error_code, "COOPERATION_STALE_ATTEMPT")
  assert.equal((await spawn(c, p, "a")).success, false)
  const status = await c.call("cooperation_status")
  assert.equal(status.data.plan.tasks[0].attempts_remaining, 0)
  assert.equal(status.data.plan.tasks[1].accepted, true)
  assert.equal(status.data.plan.tasks[1].attempts.length, 1)
})

test("duplicate dispatch cannot bind two attempts or start two workers", async () => {
  const c = setup(), p = await plan(c)
  const results = await Promise.all([spawn(c, p, "a"), spawn(c, p, "a")])
  assert.equal(results.filter(r => r.success).length, 1)
  assert.equal(c.kicks.length, 1)
  assert.equal(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].attempts.length, 1)
  const children = c.tm.list().filter(t => t.parent_thread_id === c.parent.id)
  assert.equal(children.length, 1, "losing dispatch cleans up its speculative worker")
})

test("confirmation for a previous attempt cannot authorize its replacement", async () => {
  const c = setup(), p = await plan(c)
  const originalParams = spawnParams(c, p, "a")
  const staleApproval = policy.issueTokenFor("spawn_worker", originalParams).token
  assert.equal((await spawn(c, p, "a")).success, true)
  await finish(c, c.kicks[0].threadId, "error")
  const replay = await c.call("spawn_worker", { ...originalParams, security_token: staleApproval })
  assert.equal(replay.success, false)
  assert.equal(c.kicks.length, 1)
  assert.equal((await spawn(c, p, "a")).success, true, "fresh approval permits the next attempt")
  assert.equal(c.kicks.length, 2)
})

test("cancelled, security-stopped and paused workers cannot be silently replaced", async () => {
  for (const terminal of ["aborted", "security_halt", "paused"]) {
    const c = setup(), p = await plan(c)
    await spawn(c, p, "a")
    const wid = c.kicks[0].threadId
    if (terminal === "paused") c.tm.update(wid, { paused: true })
    else await finish(c, wid, terminal)
    assert.equal((await spawn(c, p, "a")).success, false, terminal)
    assert.equal(c.kicks.length, 1)
  }
})

test("fresh process reload exposes interrupted work without running it and retains accepted checkpoints", async () => {
  const c = setup(), p = await plan(c, [task("accepted"), task("unfinished")])
  await spawn(c, p, "accepted")
  const result = await finish(c, c.kicks.at(-1)!.threadId)
  await review(c, p, "accepted", result)
  await spawn(c, p, "unfinished")
  const modulePath = require.resolve("../src/orchestrator/cooperation-plan")
  const managerPath = require.resolve("../src/threads/thread-manager")
  const script = `const {ThreadManager}=require(${JSON.stringify(managerPath)}); const {cooperationPlanSnapshot}=require(${JSON.stringify(modulePath)}); const snapshot=cooperationPlanSnapshot(new ThreadManager(),${JSON.stringify(c.parent.id)},()=>false); console.log(JSON.stringify(snapshot))`
  const child = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, CMSPARK_DATA_DIR: root }, encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const snapshot = JSON.parse(child.stdout.trim().split("\n").at(-1)!)
  assert.equal(snapshot.tasks[0].accepted, true)
  assert.equal(snapshot.tasks[1].runtime_status, "interrupted")
  assert.equal(snapshot.automatic_dispatch, false)
  assert.equal(snapshot.tasks[1].attempts.length, 1)
  assert.equal(c.kicks.length, 2)
})

test("acceptance becomes invalid when an already accepted worker produces a newer report", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("b", ["a"])])
  await spawn(c, p, "a")
  const wid = c.kicks[0].threadId, first = await finish(c, wid)
  await review(c, p, "a", first)
  const second = await finish(c, wid, null, "Corrected report contradicts the earlier total")
  assert.notEqual(second.source.version, first.source.version)
  assert.equal((await review(c, p, "a", first)).success, false, "stale source cannot be reviewed")
  assert.equal((await spawn(c, p, "b")).success, false)
})

test("uncollected rerun cannot reuse an earlier accepted dependency", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("b", ["a"])])
  await spawn(c, p, "a")
  const wid = c.kicks[0].threadId, first = await finish(c, wid)
  await review(c, p, "a", first)
  c.tm.addMessage(wid, { thread_id: wid, role: "assistant", content: "new contradictory report" })
  c.tm.update(wid, { last_run_ended_at: "newer-uncollected-run", last_run_terminal: null })
  assert.equal((await spawn(c, p, "b")).success, false, "source no longer matches acceptance")
  assert.equal((await c.call("cooperation_status")).data.plan.tasks[0].accepted, false)
})

test("capability mismatch and changed immutable goal never start a worker", async () => {
  const c = setup(), p = await plan(c)
  for (const change of [{ tool_allow: ["list_tabs"] }, { goal: "a different task" }]) {
    const params = { ...spawnParams(c, p, "a"), ...change }
    const token = policy.issueTokenFor("spawn_worker", params).token
    assert.equal((await c.call("spawn_worker", { ...params, security_token: token })).success, false)
  }
  assert.equal(c.kicks.length, 0)
  assert.equal(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].attempts.length, 0)
})

test("ACP collect, status and cancel reject another real conversation and preserve its session", async () => {
  const c = setup(), other = c.tm.create("other owner")
  const { saveConfig } = await import("../src/config")
  const { getAcpManager } = await import("../src/acp/manager")
  saveConfig({ acp: { enabled: true, servers: { contract: { enabled: true, command: process.execPath, policy: { profile: "review_readonly" } } } } } as any)
  const mgr = getAcpManager(), offered = mgr.propose({ threadId: other.id, agentId: "contract", goal: "review fixture", workspaceRoot: root })
  assert.equal(offered.ok, true)
  if (!offered.ok) return
  const sid = offered.session.session_id, before = offered.session.state
  for (const name of ["acp_collect_result", "acp_get_status", "acp_cancel_session"]) {
    const response = await c.call(name, { session_id: sid })
    assert.equal(response.success, false, name)
    assert.equal(response.error_code, "ACP_OWNER_MISMATCH", name)
    assert.equal(response.data, undefined, "no foreign session metadata")
  }
  assert.equal(mgr.getSession(sid)!.state, before)
  const own = await dispatch.executeCompanionTool("acp_get_status", { __thread_id: other.id, session_id: sid })
  assert.equal(own.success, true)
})

test("three failed terminal reports accept negative review, keep dependents blocked and recover only after confirmation", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("b"), task("c"), task("dependent", ["a", "b", "c"])])
  for (const id of ["a", "b", "c"]) {
    const spawned = await spawn(c, p, id)
    assert.equal(spawned.success, true, spawned.error)
    const result = await finish(c, spawned.data.worker_id, "circuit_breaker")
    assert.equal(result.status, "failed")
    const rejected = await review(c, p, id, result, false)
    assert.equal(rejected.success, true, rejected.error)
    const current = rejected.data.plan.tasks.find((t: any) => t.id === id)
    assert.equal(current.accepted, false)
    assert.equal(current.runtime_status, "failed")
    assert.equal(current.attempts[0].result.status, "failed")
  }
  assert.equal((await spawn(c, p, "dependent")).success, false)
  const params = spawnParams(c, p, "a")
  assert.equal((await c.call("spawn_worker", params)).success, false)
  const recovered = await spawn(c, p, "a")
  assert.equal(recovered.success, true, recovered.error)
  const result = await finish(c, recovered.data.worker_id)
  assert.equal((await review(c, p, "a", result)).data.plan.tasks[0].accepted, true)
  assert.equal(new ThreadManager().get(c.parent.id)!.cooperation_plan!.tasks[0].attempts.length, 2)
  assert.equal((await spawn(c, p, "dependent")).success, false, "unaccepted siblings still block")
})

test("failed reviews retain positive, mixed, stale, unsettled, halted and paused refusals", async () => {
  const c = setup(), p = await plan(c, [task("a", [], ["coverage", "accuracy"])])
  const spawned = await spawn(c, p, "a"), wid = spawned.data.worker_id
  const result = await finish(c, wid, "error")
  assert.equal((await review(c, p, "a", result)).success, false)
  const input = { plan_id: p.id, task_id: "a", source_version: result.source.version,
    criteria: p.tasks[0].criteria.map((criterion, index) => ({ id: criterion.id, passed: index === 0,
      reason: "Recorded criterion judgment", refs: [`source:${result.source.version}`] })), conflicts: [] }
  assert.equal((await c.call("cooperation_review", input)).success, false)
  const negative = { ...input, criteria: input.criteria.map(criterion => ({ ...criterion, passed: false })) }
  assert.throws(() => runtime.reviewCooperationTask(c.tm, c.parent.id, negative, () => true), /terminal report/)
  assert.equal((await c.call("cooperation_review", { ...negative, source_version: "stale" })).success, false)
  assert.equal((await c.call("cooperation_review", { ...negative, criteria: negative.criteria.map(criterion => ({ ...criterion, refs: ["evidence:invented"] })) })).success, false)
  c.tm.update(wid, { last_run_execution_id: "new-execution", last_run_settled_execution_id: "older-execution" })
  assert.equal((await c.call("cooperation_review", negative)).success, false)
  for (const terminal of ["aborted", "security_halt", "paused"]) {
    const another = setup(), anotherPlan = await plan(another)
    const worker = (await spawn(another, anotherPlan, "a")).data.worker_id
    const collected = await finish(another, worker, terminal === "paused" ? "error" : terminal)
    if (terminal === "paused") another.tm.update(worker, { paused: true })
    assert.equal((await review(another, anotherPlan, "a", collected, false)).success, false, terminal)
    assert.equal((await spawn(another, anotherPlan, "a")).success, false, terminal)
  }
})

test("launch failure with a ready producer result cannot enter the failed negative-review path", async () => {
  const c = setup(), p = await plan(c)
  const params = spawnParams(c, p, "a")
  const spawned = await dispatch.executeCompanionTool("spawn_worker", { ...params, security_token: policy.issueTokenFor("spawn_worker", params).token }, undefined,
    { kickWorkerChat: () => { throw new Error("synthetic launch failure") } })
  assert.equal(spawned.success, false)
  assert.equal(spawned.error_code, "SPAWN_KICK_FAILED")
  const worker = c.tm.list().find(worker => worker.parent_thread_id === c.parent.id)!
  const read = await c.call("collect_handback", { worker_id: worker.id })
  assert.equal(read.data.task_result.status, "ready")
  assert.equal((await c.call("cooperation_status")).data.plan.tasks[0].runtime_status, "failed")
  assert.equal((await review(c, p, "a", read.data.task_result, false)).success, false)
})

test("planned recovery clamps all projections, repairs legacy cache metadata and preserves judgments on recollection", async () => {
  const c = setup(), p = await plan(c)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const spawned = await spawn(c, p, "a")
    const result = await finish(c, spawned.data.worker_id, attempt === 3 ? null : "error")
    const judged = await review(c, p, "a", result, attempt === 3)
    assert.equal(judged.success, true, judged.error)
    const remaining = 3 - attempt
    assert.ok(result.recovery.budget_remaining <= remaining)
    for (const recorded of judged.data.plan.tasks[0].attempts) assert.ok(recorded.result.recovery.budget_remaining <= remaining)
    for (const recorded of judged.data.cooperation.tasks) assert.ok(recorded.recovery.budget_remaining <= remaining)
  }
  const parent = c.tm.get(c.parent.id)!, planned = parent.cooperation_plan!, current = planned.tasks[0].attempts.at(-1)!
  const read = await c.call("collect_handback", { worker_id: current.worker_id })
  const { browserTaskResult } = await import("../src/orchestrator/cooperation-result")
  const unbounded = browserTaskResult(c.tm.get(current.worker_id)!, read)
  assert.equal(unbounded.recovery.budget_remaining, 2, "legacy metadata comes from the real result producer")
  const decisions = structuredClone(planned.tasks[0].decisions)
  c.tm.update(c.parent.id, { cooperation_tasks: { ...parent.cooperation_tasks,
    [unbounded.task_id]: { ...parent.cooperation_tasks![unbounded.task_id], result: unbounded } },
    cooperation_plan: { ...planned, tasks: planned.tasks.map(task => ({ ...task, attempts: task.attempts.map(attempt =>
      attempt.worker_id === current.worker_id ? { ...attempt, result: unbounded } : attempt) })) } })
  const projected = await c.call("cooperation_status")
  assert.equal(projected.data.plan.tasks[0].attempts.at(-1).result.recovery.budget_remaining, 0)
  assert.equal(projected.data.cooperation.tasks.at(-1).recovery.budget_remaining, 0)
  const recollected = await c.call("collect_handback", { worker_id: current.worker_id })
  assert.equal(recollected.data.task_result.recovery.budget_remaining, 0)
  const reloaded = new ThreadManager().get(c.parent.id)!
  assert.equal(reloaded.cooperation_tasks![unbounded.task_id].result.recovery.budget_remaining, 0)
  assert.equal(reloaded.cooperation_plan!.tasks[0].attempts.at(-1)!.result!.recovery.budget_remaining, 0)
  assert.deepEqual(reloaded.cooperation_plan!.tasks[0].decisions, decisions)
  assert.equal((await c.call("cooperation_status")).data.plan.tasks[0].accepted, true)
})

test("exhausted planned failure recommends revision without changing resume or unplanned recovery", async () => {
  const c = setup(), p = await plan(c)
  let result!: Awaited<ReturnType<typeof finish>>
  for (let attempt = 1; attempt <= 3; attempt++) {
    const spawned = await spawn(c, p, "a")
    result = await finish(c, spawned.data.worker_id, "error")
    assert.equal((await review(c, p, "a", result, false)).success, true)
  }
  assert.equal(result.recovery.budget_remaining, 0)
  assert.equal(result.recovery.action, "revise_plan")
  assert.equal(result.recovery.automatic, false)
  assert.equal((await spawn(c, p, "a")).success, false)
  const workerId = result.source.thread_id
  const failures = structuredClone(c.tm.get(c.parent.id)!.cooperation_tasks![result.task_id].failure_versions)
  const decisions = structuredClone(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].decisions)
  const repeated = await c.call("collect_handback", { worker_id: workerId })
  assert.equal(repeated.data.task_result.recovery.action, "revise_plan")
  assert.deepEqual(c.tm.get(c.parent.id)!.cooperation_tasks![result.task_id].failure_versions, failures)
  assert.deepEqual(c.tm.get(c.parent.id)!.cooperation_plan!.tasks[0].decisions, decisions)
  c.tm.update(workerId, { paused: true })
  const paused = await c.call("collect_handback", { worker_id: workerId })
  assert.equal(paused.data.task_result.recovery.action, "resume_after_confirmation")
  assert.equal(paused.data.task_result.recovery.requires_confirmation, true)
  assert.equal(paused.data.task_result.recovery.budget_remaining, 0)
  const { acpTaskResult, browserTaskResult } = await import("../src/orchestrator/cooperation-result")
  const acp = acpTaskResult({ session_id: "synthetic-unplanned", thread_id: c.parent.id, state: "closed", terminal_kind: "failed", partial: false } as any)
  assert.equal(runtime.clampPlannedRecovery(c.tm, c.parent.id, acp), acp)
  const unplannedWorker = c.tm.create("unplanned worker")
  c.tm.update(unplannedWorker.id, { parent_thread_id: c.parent.id, orchestrator_run_id: c.tm.get(c.parent.id)!.orchestrator_run_id, last_run_terminal: "error" })
  const unplanned = browserTaskResult(c.tm.get(unplannedWorker.id)!, {})
  assert.equal(runtime.clampPlannedRecovery(c.tm, c.parent.id, unplanned), unplanned)
})

test("live source ownership or run changes reject failed review and invalidate prior acceptance", async () => {
  for (const change of ["owner", "run"] as const) {
    for (const terminal of [null, "error"]) {
      const c = setup(), p = await plan(c, [task("a"), task("dependent", ["a"])])
      const workerId = (await spawn(c, p, "a")).data.worker_id
      const result = await finish(c, workerId, terminal)
      if (terminal === null) assert.equal((await review(c, p, "a", result)).data.plan.tasks[0].accepted, true)
      const foreign = c.tm.create("synthetic foreign owner")
      c.tm.update(workerId, change === "owner" ? { parent_thread_id: foreign.id } : { orchestrator_run_id: foreign.id })
      const refused = await review(c, p, "a", result, false)
      assert.equal(refused.success, false, `${change}/${terminal}`)
      assert.match(refused.error, /worker changed since collection/)
      const status = await c.call("cooperation_status")
      assert.equal(status.data.plan.tasks[0].accepted, false)
      assert.equal(status.data.plan.tasks[1].ready, false)
      assert.equal((await spawn(c, p, "dependent")).success, false)
    }
  }
})

test("removed accepted sources retain bounded checkpoints without promising raw history", async () => {
  const c = setup(), p = await plan(c, [task("a"), task("dependent", ["a"])])
  const workerId = (await spawn(c, p, "a")).data.worker_id
  const result = await finish(c, workerId)
  assert.equal((await review(c, p, "a", result)).data.plan.tasks[0].accepted, true)
  c.tm.delete(workerId)
  const status = await c.call("cooperation_status")
  assert.equal(status.data.plan.tasks[0].accepted, true)
  assert.equal(status.data.plan.tasks[1].ready, true)
  assert.equal(status.data.cooperation.tasks.find((record: any) => record.task_id === result.task_id).raw_report_available, false)
  assert.equal((await spawn(c, p, "dependent")).success, true)
})

test("replacement completes only the missing criterion and reuses an unchanged owned earlier source", async () => {
  const c = setup(), p = await plan(c, [task("a", [], ["coverage", "accuracy"]), task("dependent", ["a"])])
  const firstWorker = (await spawn(c, p, "a")).data.worker_id
  const first = await finish(c, firstWorker, null, "Recorded coverage; accuracy still missing")
  const judged = await c.call("cooperation_review", { plan_id: p.id, task_id: "a", source_version: first.source.version,
    criteria: p.tasks[0].criteria.map(criterion => ({ id: criterion.id, passed: criterion.id === "coverage",
      reason: criterion.id === "coverage" ? "Coverage is established" : "Accuracy needs another source", refs: [`source:${first.source.version}`] })), conflicts: [] })
  assert.equal(judged.success, true, judged.error)
  assert.deepEqual(judged.data.plan.tasks[0].missing.map((criterion: any) => criterion.id), ["accuracy"])
  const replacement = await spawn(c, p, "a")
  assert.equal(replacement.success, true, replacement.error)
  assert.deepEqual(replacement.data.checkpoint.missing.map((criterion: any) => criterion.id), ["accuracy"])
  const brief = c.tm.getMessages(replacement.data.worker_id).find(message => message.role === "user")!.content
  const checkpoint = JSON.parse(brief.split("\n").find(line => line.includes('"remaining_criteria"'))!)
  assert.deepEqual(checkpoint.remaining_criteria.map((criterion: any) => criterion.id), ["accuracy"])
  const second = await finish(c, replacement.data.worker_id, null, "Recorded accuracy source for the remaining criterion")
  const accepted = await c.call("cooperation_review", { plan_id: p.id, task_id: "a", source_version: second.source.version,
    criteria: [{ id: "accuracy", passed: true, reason: "Accuracy is established by the replacement report", refs: [`source:${second.source.version}`] }], conflicts: [] })
  assert.equal(accepted.success, true, accepted.error)
  assert.equal(accepted.data.plan.tasks[0].accepted, true)
  assert.deepEqual(accepted.data.plan.tasks[0].missing, [])
  assert.equal(accepted.data.plan.tasks[1].ready, true)
  assert.equal(accepted.data.plan.tasks[0].decisions.find((decision: any) => decision.id === "coverage").source_version, first.source.version)
  assert.equal((await spawn(c, p, "dependent")).success, true)
})
