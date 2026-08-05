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
