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
