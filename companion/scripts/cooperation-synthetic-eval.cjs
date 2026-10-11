#!/usr/bin/env node
// Compile with `npx tsc -p tsconfig.test.json`, then run this script.
// Synthetic worker reports and confirmation fixtures; no model calls or browser work.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cooperation-eval-"))
process.env.CMSPARK_DATA_DIR = root
const compiled = path.join(__dirname, "../.test-dist/src")
const { initDataDir } = require(path.join(compiled, "config.js"))
const { ThreadManager } = require(path.join(compiled, "threads/thread-manager.js"))
const dispatch = require(path.join(compiled, "tool/companion-dispatch.js"))
const { securityPolicy } = require(path.join(compiled, "security-policy.js"))

async function scenario(width) {
  const tm = new ThreadManager(), parent = tm.create(`synthetic width ${width}`)
  let kicks = 0, collections = 0, serializedStatusBytes = 0, waves = 0
  const started = performance.now()
  dispatch.bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {}, getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  const call = (name, params = {}) => dispatch.executeCompanionTool(name, { ...params, __thread_id: parent.id }, undefined,
    { kickWorkerChat: () => { kicks++ } })
  const criteria = [{ id: "coverage", description: "Includes the assigned fixture value and source" }]
  const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `source_${i}`, goal: `Read synthetic source ${i}`,
    required_tools: ["get_page_text"], criteria }))
  tasks.push({ id: "combine", goal: "Combine eight accepted fixture values", depends_on: tasks.map(t => t.id),
    required_tools: ["get_page_text"], criteria })
  let response = await call("cooperation_plan", { tasks })
  assert.equal(response.success, true, response.error)
  const planId = response.data.plan.id
  let injectedFailures = 0, restoredAcceptance = false
  const launchesByTask = new Map()
  for (;;) {
    response = await call("cooperation_status")
    assert.equal(response.success, true, response.error)
    serializedStatusBytes += Buffer.byteLength(JSON.stringify(response))
    const snapshot = response.data.plan
    if (snapshot.tasks.every(t => t.accepted)) break
    const ready = snapshot.ready_task_ids.slice(0, width)
    assert.ok(ready.length, `stalled at width=${width}`)
    waves++
    assert.ok(waves <= 20, "bounded execution")
    const launched = []
    for (const taskId of ready) {
      const item = snapshot.tasks.find(t => t.id === taskId)
      const params = { __thread_id: parent.id, plan_id: planId, plan_task_id: taskId,
        plan_task_attempt: item.next_attempt,
        goal: item.goal, role_label: "synthetic_reader", tool_allow: ["get_page_text"] }
      const token = securityPolicy.issueTokenFor("spawn_worker", params).token
      const spawned = await call("spawn_worker", { ...params, security_token: token })
      assert.equal(spawned.success, true, spawned.error)
      launchesByTask.set(taskId, (launchesByTask.get(taskId) || 0) + 1)
      launched.push({ taskId, workerId: spawned.data.worker_id })
    }
    for (const { taskId, workerId } of launched) {
      const fail = taskId === "source_0" && injectedFailures === 0
      if (fail) injectedFailures++
      tm.addMessage(workerId, { thread_id: workerId, role: "assistant",
        content: fail ? "Injected recoverable fixture read failure" : `Fixture report for ${taskId}: source=fixture://${taskId}; value=1` })
      tm.update(workerId, { last_run_ended_at: `wave-${waves}-${workerId}`, last_run_terminal: fail ? "error" : null })
      const read = await call("collect_handback", { worker_id: workerId }); collections++
      assert.ok(read.data?.task_result, JSON.stringify(read))
      if (!fail) {
        const sourceVersion = read.data.task_result.source.version
        const reviewed = await call("cooperation_review", { plan_id: planId, task_id: taskId, source_version: sourceVersion,
          criteria: [{ id: "coverage", passed: true, reason: "Fixture runner checks the assigned report", refs: [`source:${sourceVersion}`] }], conflicts: [] })
        assert.equal(reviewed.success, true, reviewed.error)
      }
    }
    // Real disk reload verifies checkpoints; this is not a fresh-process crash recovery test.
    const reloaded = new ThreadManager().get(parent.id).cooperation_plan
    restoredAcceptance ||= reloaded.tasks.some(t => t.decisions.some(d => d.passed))
  }
  const acceptedCount = response.data.plan.tasks.filter(t => t.accepted).length
  const duplicateLaunches = [...launchesByTask.entries()].reduce((n, [id, count]) => n + Math.max(0, count - (id === "source_0" ? 2 : 1)), 0)
  assert.equal(acceptedCount, 9)
  assert.equal(kicks, 10)
  assert.equal(duplicateLaunches, 0)
  return { worker_width: width, logical_tasks: 9, accepted_tasks: acceptedCount,
    acceptance_coverage: acceptedCount / 9, injected_failures: injectedFailures, recovery_attempts: 1,
    duplicate_launches: duplicateLaunches, worker_launches: kicks, collections, scheduling_waves: waves,
    simulated_elapsed_units: waves, checkpoint_reload_preserved_acceptance: restoredAcceptance,
    serialized_status_bytes: serializedStatusBytes, harness_wall_ms: Math.round(performance.now() - started) }
}

;(async () => {
  try {
    await initDataDir()
    const scenarios = []
    for (const width of [1, 2, 4]) scenarios.push(await scenario(width))
    console.log(JSON.stringify({ kind: "synthetic_deterministic_cooperation_eval", schema_version: 1,
      limitations: ["Reports and confirmations are fixtures, not real LLM outputs or human approvals.",
        "Coverage measures fixture acceptance only; it is not factual accuracy or real task quality.",
        "Scheduling waves assume one equal-duration unit per wave; wall time measures the harness only.",
        "Serialized status bytes are observable payload volume, not model tokens or cost.",
        "Disk reload is exercised; fresh-process crash recovery is covered separately by cooperation-plan.test."],
      model_calls: 0, scenarios }, null, 2))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
