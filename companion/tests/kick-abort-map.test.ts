/**
 * #X4: kicked worker chatCreate must join the abort map so Glance/stop_all work.
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-kick-abort-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let installKickAbortController: typeof import("../src/message-router").installKickAbortController
let releaseKickAbortController: typeof import("../src/message-router").releaseKickAbortController
let abortThreadChat: typeof import("../src/message-router").abortThreadChat
let listLlmActiveThreadIds: typeof import("../src/message-router").listLlmActiveThreadIds

let router: typeof import("../src/message-router")
let gate: typeof import("../src/orchestrator/llm-loop-gate")

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  router = await import("../src/message-router")
  gate = await import("../src/orchestrator/llm-loop-gate")
  installKickAbortController = router.installKickAbortController
  releaseKickAbortController = router.releaseKickAbortController
  abortThreadChat = router.abortThreadChat
  listLlmActiveThreadIds = router.listLlmActiveThreadIds
})

test("#X4 installKickAbortController is visible to listLlmActiveThreadIds and abortThreadChat", () => {
  const tid = `kick-abort-${Date.now()}`
  const controller = installKickAbortController(tid)
  assert.ok(controller, "free thread must install fresh")
  assert.equal(listLlmActiveThreadIds().includes(tid), true)
  const r = abortThreadChat(tid)
  assert.equal(r.stopped, true)
  assert.equal(controller.signal.aborted, true)
  assert.equal(listLlmActiveThreadIds().includes(tid), false)
})

test("#X4 releaseKickAbortController CAS-deletes only its own controller", () => {
  const tid = `kick-release-${Date.now()}`
  const controller = installKickAbortController(tid)
  releaseKickAbortController(tid, controller)
  assert.equal(listLlmActiveThreadIds().includes(tid), false)
  const r = abortThreadChat(tid)
  assert.equal(r.stopped, false)
})

test("F1 installKickAbortController refuses a thread owned by a live run", () => {
  const tid = `kick-refuse-${Date.now()}`
  // Simulate the user's chat.create holding the thread.
  router.__testSetLlmActiveForTests(tid, true)
  assert.equal(installKickAbortController(tid), null, "must not reuse another run's controller")
  // The owner's controller survives untouched.
  assert.equal(listLlmActiveThreadIds().includes(tid), true)
  router.__testSetLlmActiveForTests(tid, false)
  // Free thread installs fresh; release with null (refused install) is a no-op.
  const controller = installKickAbortController(tid)
  assert.ok(controller)
  releaseKickAbortController(tid, null)
  assert.equal(listLlmActiveThreadIds().includes(tid), true)
  releaseKickAbortController(tid, controller)
  assert.equal(listLlmActiveThreadIds().includes(tid), false)
})

test("F1 queued kick waits while the user's run owns the worker, then drains", async () => {
  gate._resetMultiAgentLlmLoopsForTests()
  const cap = gate.multiAgentLlmLoopSnapshot().cap
  const started: string[] = []
  // Fill every multi-agent slot with a run that never settles.
  for (let i = 0; i < cap; i++) {
    const r = gate.scheduleWhenLlmSlotAvailable({ agent_role: "worker" }, `filler-${i}`, () => new Promise<void>(() => {}))
    assert.equal(r.started, true)
  }
  const target = `kick-queue-${Date.now()}`
  // The user manually chat.create'd the worker: the abort map (probe) is live.
  router.__testSetLlmActiveForTests(target, true)
  const q = gate.scheduleWhenLlmSlotAvailable({ agent_role: "worker" }, target, () => {
    started.push(target)
    return Promise.resolve()
  })
  assert.equal(q.queued, true)
  // Free a slot: the drain must requeue (not start) the probe-active target.
  gate.releaseMultiAgentLlmLoop("filler-0")
  assert.deepEqual(started, [], "kick must not start beside the user's run")
  assert.equal(gate.pendingDeferredLlmKickCount(), 1)
  // The user's run settles: the next drain starts the kick exactly once.
  router.__testSetLlmActiveForTests(target, false)
  gate.releaseMultiAgentLlmLoop("filler-1")
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(started, [target])
  assert.equal(gate.pendingDeferredLlmKickCount(), 0)
  gate._resetMultiAgentLlmLoopsForTests()
})
