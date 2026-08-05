import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveThreadBusy,
  deriveRunBusy,
  resolveComposerMode,
  resolveParentThreadId,
  resolveStopTargetId,
  filterIdsByRun,
  isIntentOnlyRunBusy,
  composerBusyPlaceholder,
  resolveOpenIntentsForRun,
  resolveFleetScope,
  workersInFleetScope,
  filterIdsByFleetScope,
  resolveOpenIntentsForScope,
  buildScopedRunBusyInput,
  buildFleetStopAllMessage,
} from "../src/sidepanel/utils/thread-busy"

test("deriveThreadBusy: any of streaming/processing/tools/map", () => {
  assert.equal(
    deriveThreadBusy({ streaming: false, isProcessing: false, runningToolCount: 0 }),
    false,
  )
  assert.equal(
    deriveThreadBusy({ streaming: true, isProcessing: false, runningToolCount: 0 }),
    true,
  )
  assert.equal(
    deriveThreadBusy({ streaming: false, isProcessing: true, runningToolCount: 0 }),
    true,
  )
  assert.equal(
    deriveThreadBusy({ streaming: false, isProcessing: false, runningToolCount: 1 }),
    true,
  )
  assert.equal(
    deriveThreadBusy({
      streaming: false,
      isProcessing: false,
      runningToolCount: 0,
      mapBusy: true,
    }),
    true,
  )
})

test("deriveRunBusy: idle residual alone is false", () => {
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 0,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    false,
  )
})

test("deriveRunBusy: locks / holding / llm / workerBusy", () => {
  assert.equal(
    deriveRunBusy({
      lockCount: 1,
      openIntents: 0,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    true,
  )
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 1,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    true,
  )
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 0,
      anyHoldingTabs: true,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    true,
  )
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 0,
      anyHoldingTabs: false,
      llmActiveThreadIds: ["w1"],
      workerBusyIds: [],
    }),
    true,
  )
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 0,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: ["w1"],
    }),
    true,
  )
})

test("resolveComposerMode priority", () => {
  assert.equal(
    resolveComposerMode({ taskActive: true, threadBusy: true, runBusy: true }),
    "l2_task",
  )
  assert.equal(
    resolveComposerMode({ taskActive: false, threadBusy: true, runBusy: false }),
    "thread_busy",
  )
  assert.equal(
    resolveComposerMode({ taskActive: false, threadBusy: false, runBusy: true }),
    "run_busy",
  )
  assert.equal(
    resolveComposerMode({ taskActive: false, threadBusy: false, runBusy: false }),
    "ready",
  )
})

test("resolveStopTargetId F-S1", () => {
  assert.equal(
    resolveStopTargetId({
      workerId: "w1",
      activeThreadId: "a",
      multiAgentContext: true,
    }),
    "w1",
  )
  assert.equal(
    resolveStopTargetId({
      workerId: null,
      activeThreadId: "a",
      multiAgentContext: true,
    }),
    null,
  )
  assert.equal(
    resolveStopTargetId({
      workerId: null,
      activeThreadId: "a",
      multiAgentContext: false,
    }),
    "a",
  )
})

test("resolveParentThreadId order", () => {
  assert.equal(
    resolveParentThreadId({
      activeParentId: "p1",
      fleetParentId: "p2",
      orchestratorIdForRun: "o1",
    }),
    "p1",
  )
  assert.equal(
    resolveParentThreadId({
      activeParentId: null,
      fleetParentId: "p2",
      orchestratorIdForRun: "o1",
    }),
    "p2",
  )
  assert.equal(
    resolveParentThreadId({
      activeParentId: null,
      fleetParentId: null,
      orchestratorIdForRun: "o1",
    }),
    "o1",
  )
})

test("filterIdsByRun", () => {
  const workers = [
    { id: "w1", orchestrator_run_id: "r1" },
    { id: "w2", orchestrator_run_id: "r2" },
  ]
  assert.deepEqual(filterIdsByRun(["w1", "w2"], workers, "r1"), ["w1"])
  assert.deepEqual(filterIdsByRun(["w1", "w2"], workers, null), ["w1", "w2"])
})

test("resolveOpenIntentsForRun: no runId uses process-wide count", () => {
  assert.equal(resolveOpenIntentsForRun(5, { r1: 2 }, null), 5)
  assert.equal(resolveOpenIntentsForRun(undefined, undefined, null), 0)
})

test("resolveOpenIntentsForRun: with runId does not fall back to global", () => {
  assert.equal(resolveOpenIntentsForRun(9, { r1: 2, r2: 7 }, "r1"), 2)
  assert.equal(resolveOpenIntentsForRun(9, { r2: 7 }, "r1"), 0)
  assert.equal(resolveOpenIntentsForRun(9, undefined, "r1"), 0)
})

// --- Fleet scope isolation (v5gkth / foreign residual worker 7eyxoz) ---

const foreignPenTestWorker = {
  id: "7eyxoz",
  agent_role: "worker" as const,
  parent_thread_id: "b20rur",
  orchestrator_run_id: "orun_pen_test",
  status: "paused" as const,
}

test("resolveFleetScope: normal thread without children is none", () => {
  assert.deepEqual(
    resolveFleetScope({ id: "v5gkth", agent_role: "normal" }, [foreignPenTestWorker]),
    { kind: "none" },
  )
  assert.deepEqual(resolveFleetScope({ id: "v5gkth" }, [foreignPenTestWorker]), {
    kind: "none",
  })
})

test("resolveFleetScope: stamped run id wins", () => {
  assert.deepEqual(
    resolveFleetScope(
      { id: "orch", agent_role: "orchestrator", orchestrator_run_id: "r1" },
      [{ id: "w1", orchestrator_run_id: "r1", parent_thread_id: "orch", agent_role: "worker" }],
    ),
    { kind: "run", runId: "r1" },
  )
})

test("resolveFleetScope: host with children scopes by parent", () => {
  assert.deepEqual(
    resolveFleetScope({ id: "b20rur" }, [foreignPenTestWorker]),
    { kind: "parent", parentId: "b20rur" },
  )
})

test("workersInFleetScope: none is empty (no foreign list)", () => {
  assert.deepEqual(
    workersInFleetScope([foreignPenTestWorker], { kind: "none" }),
    [],
  )
})

test("filterIdsByFleetScope: none never returns process-wide busy ids", () => {
  // Bug: filterIdsByRun(null) returned all busy ids including the normal thread itself
  assert.deepEqual(
    filterIdsByFleetScope(["v5gkth", "7eyxoz"], [foreignPenTestWorker], { kind: "none" }),
    [],
  )
})

test("resolveOpenIntentsForScope: none is 0 (not process-wide)", () => {
  assert.equal(resolveOpenIntentsForScope(9, { orun_pen_test: 3 }, { kind: "none" }), 0)
  assert.equal(
    resolveOpenIntentsForScope(9, { r1: 2 }, { kind: "run", runId: "r1" }),
    2,
  )
})

test("buildScopedRunBusyInput: normal thread ignores foreign residual workers", () => {
  const { scope, scopedWorkers, runBusyInput, workerCount } = buildScopedRunBusyInput({
    active: { id: "v5gkth", agent_role: "normal" },
    workers: [foreignPenTestWorker],
    locks: [{ holder_thread_id: "7eyxoz" }],
    openIntentCount: 4,
    openIntentsByRun: { orun_pen_test: 4 },
    llmActiveThreadIds: ["7eyxoz"],
    // own thread busy must NOT become workerBusyIds when out of scope
    busyThreadIds: ["v5gkth", "7eyxoz"],
  })
  assert.equal(scope.kind, "none")
  assert.deepEqual(scopedWorkers, [])
  assert.equal(workerCount, 0)
  assert.equal(deriveRunBusy(runBusyInput), false)
  assert.deepEqual(runBusyInput, {
    lockCount: 0,
    openIntents: 0,
    anyHoldingTabs: false,
    llmActiveThreadIds: [],
    workerBusyIds: [],
  })
})

test("buildScopedRunBusyInput: same-run worker still lights RunBusy", () => {
  const w = {
    id: "w1",
    agent_role: "worker" as const,
    parent_thread_id: "orch",
    orchestrator_run_id: "r1",
    status: "holding_tabs" as const,
  }
  const { runBusyInput, workerCount } = buildScopedRunBusyInput({
    active: { id: "orch", agent_role: "orchestrator", orchestrator_run_id: "r1" },
    workers: [w, foreignPenTestWorker],
    locks: [
      { holder_thread_id: "w1" },
      { holder_thread_id: "7eyxoz" },
    ],
    openIntentsByRun: { r1: 1, orun_pen_test: 9 },
    llmActiveThreadIds: ["w1", "7eyxoz"],
    busyThreadIds: ["w1", "7eyxoz"],
  })
  assert.equal(workerCount, 1)
  assert.equal(runBusyInput.lockCount, 1)
  assert.equal(runBusyInput.openIntents, 1)
  assert.equal(runBusyInput.anyHoldingTabs, true)
  assert.deepEqual(runBusyInput.llmActiveThreadIds, ["w1"])
  assert.deepEqual(runBusyInput.workerBusyIds, ["w1"])
  assert.equal(deriveRunBusy(runBusyInput), true)
})

// --- S45 multi-lane P0: fleet.stop_all payload scoping ---
test("buildFleetStopAllMessage: run scope stamps orchestrator_run_id", () => {
  const msg = buildFleetStopAllMessage({ kind: "run", runId: "orun_abc" })
  assert.equal(msg.type, "fleet.stop_all")
  assert.equal(msg.orchestrator_run_id, "orun_abc")
  assert.match(msg.confirmText, /run/)
})

test("buildFleetStopAllMessage: parent stamps parent_thread_id (not process-wide)", () => {
  const parent = buildFleetStopAllMessage({ kind: "parent", parentId: "host1" })
  assert.equal(parent.type, "fleet.stop_all")
  assert.equal(parent.orchestrator_run_id, undefined)
  assert.equal(parent.parent_thread_id, "host1")
  assert.match(parent.confirmText, /本会话/)
})

test("buildFleetStopAllMessage: none is process-wide residual cleanup", () => {
  const none = buildFleetStopAllMessage({ kind: "none" })
  assert.equal(none.orchestrator_run_id, undefined)
  assert.equal(none.parent_thread_id, undefined)
  assert.match(none.confirmText, /进程内全部/)
})

test("isIntentOnlyRunBusy", () => {
  assert.equal(
    isIntentOnlyRunBusy({
      lockCount: 0,
      openIntents: 2,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    true,
  )
  assert.equal(
    isIntentOnlyRunBusy({
      lockCount: 1,
      openIntents: 2,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    false,
  )
})

test("composerBusyPlaceholder thread_busy", () => {
  assert.equal(
    composerBusyPlaceholder("thread_busy"),
    "本对话处理中 · 停止后再指挥",
  )
  assert.match(composerBusyPlaceholder("run_busy", { lockCount: 2 }) || "", /锁仍活跃/)
})
