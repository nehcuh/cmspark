import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acpTaskResult, browserTaskResult } from "../src/orchestrator/cooperation-result"
import { cooperationSnapshot, recordCooperationResult, COOPERATION_TASK_CAP } from "../src/orchestrator/cooperation-state"
import { dependencyReadiness } from "../src/orchestrator/cooperation-dependencies"

test("cooperation records survive reload, count distinct failed versions, enforce ownership and remain bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-coop-state-")); process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config"); await initDataDir()
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const tm = new ThreadManager(), parent = tm.create("parent")
    const worker = tm.create("worker")
    tm.update(parent.id, { orchestrator_run_id: "run" })
    tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: "run", last_run_ended_at: "first", last_run_terminal: "error" })
    const report = { success: true, data: { last_assistant: { id: "m", content: "partial result" } } }
    let result = browserTaskResult(tm.get(worker.id)!, report)
    let saved = recordCooperationResult(tm, parent.id, result)
    assert.equal(saved.recovery.budget_remaining, 1)
    assert.equal(recordCooperationResult(tm, parent.id, result).recovery.budget_remaining, 1)
    assert.equal(new ThreadManager().get(parent.id)?.cooperation_tasks?.[result.task_id].result.source.message_id, "m")
    assert.throws(() => recordCooperationResult(tm, worker.id, result), /owner mismatch/)
    tm.update(worker.id, { last_run_ended_at: "second" })
    assert.equal(cooperationSnapshot(tm, parent.id).tasks[0].status, "stale")
    result = browserTaskResult(tm.get(worker.id)!, report)
    saved = recordCooperationResult(tm, parent.id, result)
    assert.equal(saved.recovery.budget_remaining, 0)
    assert.equal(saved.recovery.action, "revise_plan")
    for (let i = 0; i < 70; i++) recordCooperationResult(tm, parent.id, acpTaskResult({ session_id: `session-${i}`, thread_id: parent.id, state: "running", partial: false } as any))
    assert.equal(Object.keys(tm.get(parent.id)?.cooperation_tasks ?? {}).length, COOPERATION_TASK_CAP)
    assert.ok(cooperationSnapshot(tm, parent.id, { liveSessionIds: [] }).tasks.every(t => t.status === "stale"))
    assert.equal(cooperationSnapshot(tm, parent.id, { liveSessionIds: ["session-69"] }).tasks.at(-1)?.status, "running")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("board dependencies reject cycles/missing/abandoned and release only when completed", () => {
  const intents = [{ id: "a", status: "open", depends_on_intent_ids: [] }, { id: "b", status: "open", depends_on_intent_ids: ["a"] }]
  assert.equal(dependencyReadiness("b", intents).ready, false)
  intents[0].status = "done"
  assert.equal(dependencyReadiness("b", intents).ready, true)
  intents[0].status = "abandoned"
  assert.equal(dependencyReadiness("b", intents).reason, "abandoned")
  intents[0].depends_on_intent_ids = ["b"]
  assert.equal(dependencyReadiness("a", intents).reason, "cycle")
  assert.equal(dependencyReadiness("missing", intents).reason, "missing")
  assert.deepEqual(dependencyReadiness("a", [{ id: "a", status: "open", depends_on_intent_ids: ["ghost"] }]).blockers, ["ghost"])
})

test("real board claim blocks unfinished dependencies without changing claims", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-coop-deps-")); process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config"); await initDataDir()
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { ensureBoard, mutateMissionBoard } = await import("../src/board/service")
    const { claimIntent } = await import("../src/board/intent-claim")
    const { IntentSchema, stampProvenance } = await import("../src/board/schema")
    const tm = new ThreadManager(), parent = tm.create("parent"), worker = tm.create("worker")
    tm.update(parent.id, { agent_role: "orchestrator", board_mode: true })
    await ensureBoard(tm, parent.id, { force: true })
    const intent = (id: string, depends: string[]) => IntentSchema.parse({ id, description: id, depends_on_intent_ids: depends, provenance: stampProvenance({ actor_type: "system" }), created_at: "now", updated_at: "now" })
    await mutateMissionBoard(tm, parent.id, board => ({ ok: true, board: { ...board, intents: [intent("a", []), intent("b", ["a"])] } }))
    const blocked = await claimIntent(tm, { hostThreadId: parent.id, workerThreadId: worker.id, intentId: "b" })
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.error_code, "INTENT_DEPENDENCY_BLOCKED")
    assert.equal(tm.get(parent.id)?.mission_board?.intents[1].status, "open")
    await mutateMissionBoard(tm, parent.id, board => ({ ok: true, board: { ...board, intents: board.intents.map(i => i.id === "a" ? { ...i, status: "done" as const } : i) } }))
    assert.equal((await claimIntent(tm, { hostThreadId: parent.id, workerThreadId: worker.id, intentId: "b" })).ok, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("real collection rejects ownership/run/liveness changes during a read without recording completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-coop-race-")); process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config"); await initDataDir()
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { collectWorkerHandback } = await import("../src/board/service")
    const { superviseFleet } = await import("../src/orchestrator/fleet-supervision")
    for (const mode of ["owner", "run", "active"] as const) {
      const tm = new ThreadManager(), parent = tm.create("parent"), other = tm.create("other"), worker = tm.create("worker")
      tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
      tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id, last_run_ended_at: "done", last_run_terminal: null })
      tm.addMessage(worker.id, { role: "assistant", thread_id: worker.id, content: "completed report" })
      let active = false
      const pending = collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id, isThreadLlmActive: () => active })
      if (mode === "owner") tm.update(worker.id, { parent_thread_id: other.id })
      if (mode === "run") tm.update(worker.id, { orchestrator_run_id: other.id })
      if (mode === "active") active = true
      const result = await pending
      assert.equal(result.data?.task_result?.status, "stale", mode)
      assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${worker.id}`], undefined, mode)
    }
    const tm = new ThreadManager(), parent = tm.create("parent"), worker = tm.create("worker"), other = tm.create("other")
    tm.update(parent.id, { agent_role: "orchestrator", orchestrator_run_id: parent.id })
    tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent.id, orchestrator_run_id: parent.id, last_run_ended_at: "done", last_run_terminal: null })
    tm.addMessage(worker.id, { role: "assistant", thread_id: worker.id, content: "report" })
    const reports = await superviseFleet({ tm, parentId: parent.id, isActive: () => false,
      collect: id => {
        const pending = collectWorkerHandback(tm, { workerId: id, callerThreadId: parent.id, isThreadLlmActive: () => false })
        tm.update(id, { parent_thread_id: other.id })
        return pending
      } })
    assert.equal(reports[0].status, "stale")
    assert.equal(tm.get(parent.id)?.fleet_handback_epochs?.[worker.id], undefined)
    assert.equal(tm.get(parent.id)?.cooperation_tasks?.[`browser:${worker.id}`], undefined)
    tm.update(worker.id, { parent_thread_id: parent.id })
    const liveRead = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id, isThreadLlmActive: () => true })
    assert.equal(liveRead.success, false)
    if (!liveRead.success) assert.equal(liveRead.error_code, "WORKER_STILL_RUNNING")
    assert.equal(liveRead.data?.task_result?.status, "running")
    assert.equal(liveRead.data?.task_result?.recovery.action, "wait")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("handback insertion rejects missing dependencies and premature done without mutating the board", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-coop-insert-")); process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config"); await initDataDir()
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { ensureBoard, applyHandbackPayload } = await import("../src/board/service")
    const tm = new ThreadManager(), parent = tm.create("parent")
    tm.update(parent.id, { agent_role: "orchestrator", board_mode: true })
    await ensureBoard(tm, parent.id, { force: true })
    const actor = { actor_type: "worker" as const, worker_id: "w", thread_id: "w" }
    const missing = await applyHandbackPayload(tm, parent.id, { schema_version: 1, facts: [], intents: [{ description: "blocked", depends_on_intent_ids: ["ghost"] }] }, actor)
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error_code, "BOARD_INTENT_INVALID")
    assert.equal(tm.get(parent.id)?.mission_board?.intents.length, 0)
    assert.equal((await applyHandbackPayload(tm, parent.id, { schema_version: 1, facts: [], intents: [{ description: "first" }] }, actor)).ok, true)
    const first = tm.get(parent.id)!.mission_board!.intents[0].id
    const premature = await applyHandbackPayload(tm, parent.id, { schema_version: 1, facts: [], intents: [{ description: "second", status: "done", depends_on_intent_ids: [first] }] }, actor)
    assert.equal(premature.ok, false)
    if (!premature.ok) assert.match(premature.error, /cannot finish before/)
    assert.equal(tm.get(parent.id)?.mission_board?.intents.length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
