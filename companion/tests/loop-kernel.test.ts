/**
 * L-2 (#388) loop kernel unit tests.
 *
 * Covers the ticket acceptance items that do not need a live LLM:
 *  - unactivated === zero behavior change (no loop_state write, no nextRun,
 *    no task_loop.* audit; only the non-blocking suggestion card frame)
 *  - armed + unticked non-draft items → step+1 with a steer pointing straight
 *    at the stuck items, nextRun.source === "loop"
 *  - budgets (runs / wall-clock / token aggregate) → STOPPED_BUDGET,
 *    checkpoint-resumable via explicit resume arm
 *  - user stop → STOPPED_USER, loop queue dropped, never revives
 *  - HALT_SECURITY on security/non_recoverable terminal — never auto-continue
 *  - pure Q&A (0 tool calls) never continues
 *  - tools-without-plan asks for a propose exactly once
 *  - orchestrator loop yields while a worker is active; workers never loop
 *  - drain gate: loop entries drain only while active + within budget
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-loop-kernel-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let kernel: typeof import("../src/loop/loop-kernel")
let loopState: typeof import("../src/loop/loop-state")
let queues: typeof import("../src/llm/run-queues")

type AuditEvent = { type: string; [k: string]: unknown }

let audits: AuditEvent[]
const auditSink = (e: AuditEvent) => {
  audits.push(e)
}

type SuggestFrame = { type: string; thread_id: string; unticked: Array<{ id: string }> }
let suggestFrames: SuggestFrame[]
const sendToExtension = (f: SuggestFrame) => {
  suggestFrames.push(f)
}

function stats(over: Partial<import("../src/loop/loop-state").RunStats> = {}) {
  return {
    toolCalls: 1,
    closingTurnToolCalls: 0,
    totalTokens: 0,
    terminal: null as import("../src/loop/loop-state").RunTerminal,
    ...over,
  }
}

let tm: InstanceType<typeof ThreadManager>
let seq = 0

function newThread(): string {
  const t = tm.create(`loop-test-${Date.now()}-${seq++}`)
  return t.id
}

function setProgress(
  threadId: string,
  items: Array<{ id: string; text: string; done: boolean; source?: string; tool?: string }> | null,
) {
  tm.update(threadId, {
    run_progress:
      items === null
        ? null
        : {
            items: items.map((it) => ({
              id: it.id,
              text: it.text,
              done: it.done,
              source: (it.source as any) ?? "seed",
              ...(it.tool ? { tool: it.tool } : {}),
            })),
          },
  } as any)
}

function exitCheck(threadId: string, s = stats(), extra: { hasActiveWorker?: () => boolean } = {}) {
  kernel.onLoopRunFinished({
    threadManager: tm,
    threadId,
    stats: s,
    audit: auditSink,
    sendToExtension,
    ...extra,
  })
}

function getLoop(threadId: string) {
  return loopState.sanitizeLoopState((tm.get(threadId) as any)?.loop_state)
}

before(async () => {
  const tmm = await import("../src/threads/thread-manager")
  ThreadManager = tmm.ThreadManager
  kernel = await import("../src/loop/loop-kernel")
  loopState = await import("../src/loop/loop-state")
  queues = await import("../src/llm/run-queues")
  const config = await import("../src/config")
  await config.initDataDir()
})

beforeEach(() => {
  tm = new ThreadManager()
  audits = []
  suggestFrames = []
  queues._resetRunQueuesForTests()
})

// --- intent detection (entrance ②) ---

test("detectLoopIntent: explicit 持续做完 phrases arm; ordinary messages do not", () => {
  assert.equal(kernel.detectLoopIntent("持续做完直至完成或无法完成"), true)
  assert.equal(kernel.detectLoopIntent("把这个表单填完，一直做完为止"), true)
  assert.equal(kernel.detectLoopIntent("直到全部完成前不要停"), true)
  assert.equal(kernel.detectLoopIntent("keep going until it's done"), true)
  assert.equal(kernel.detectLoopIntent("continue until everything is finished"), true)
  assert.equal(kernel.detectLoopIntent("帮我看看这个页面"), false)
  assert.equal(kernel.detectLoopIntent("做完这个就停"), false)
  assert.equal(kernel.detectLoopIntent(""), false)
  assert.equal(kernel.detectLoopIntent(undefined), false)
})

// --- activation ---

test("armLoop writes loop_state + audit start; refuses worker threads", () => {
  const tid = newThread()
  const st = kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  assert.equal(st?.status, "active")
  assert.equal(st?.armed_by, "explicit_command")
  assert.equal(getLoop(tid)?.status, "active")
  assert.equal(audits.length, 1)
  assert.equal(audits[0]!.type, "task_loop.start")
  assert.equal(audits[0]!.armed_by, "explicit_command")

  const wid = newThread()
  tm.update(wid, { agent_role: "worker" } as any)
  assert.equal(kernel.armLoop(tm, wid, "explicit_command", { audit: auditSink }), null)
  assert.equal(getLoop(wid), null)
})

test("unattended arm doubles the wall-clock budget", () => {
  const tid = newThread()
  const attended = kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  assert.equal(attended?.wall_clock_ms, 30 * 60 * 1000)
  const tid2 = newThread()
  const unattended = kernel.armLoop(tm, tid2, "unattended_arm", { unattended: true, audit: auditSink })
  assert.equal(unattended?.wall_clock_ms, 60 * 60 * 1000)
})

// --- unactivated zero behavior change ---

test("unactivated: no loop_state write, no nextRun, no audit — suggestion card only", () => {
  const tid = newThread()
  setProgress(tid, [
    { id: "live:0", text: "打开页面", done: true, tool: "navigate" },
    { id: "live:1", text: "点击提交", done: false, tool: "click" },
  ])
  exitCheck(tid)
  // zero behavior change: nothing queued, nothing persisted, no task_loop audit
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid), null)
  assert.equal(audits.filter((e) => e.type.startsWith("task_loop.")).length, 0)
  // discovery card only (FINAL-SYNTHESIS 分歧 1: 发现性，非行为改变)
  assert.equal(suggestFrames.length, 1)
  assert.equal(suggestFrames[0]!.type, "task_loop.suggest")
  assert.deepEqual(suggestFrames[0]!.unticked.map((u) => u.id), ["live:1"])
})

test("unactivated pure Q&A: no card, nothing at all", () => {
  const tid = newThread()
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ toolCalls: 0 }))
  assert.equal(suggestFrames.length, 0)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid), null)
})

// --- continuation (step+1, steer at stuck items) ---

test("armed + unticked items: step+1 enqueued with source=loop, steer points at stuck item", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [
    { id: "live:0", text: "打开页面", done: true, tool: "navigate" },
    { id: "live:1", text: "点击提交按钮", done: false, tool: "click" },
  ])
  exitCheck(tid)
  const next = queues.takeNextRun(tid)
  assert.ok(next)
  assert.equal(next!.source, "loop")
  assert.ok(next!.text.includes("live:1"), "steer names the stuck item id")
  assert.ok(next!.text.includes("点击提交按钮"), "steer names the stuck item text")
  assert.ok(!next!.text.includes("live:0"), "ticked items are not re-pointed")
  assert.equal(getLoop(tid)?.runs_used, 1)
  const scheduled = audits.find((e) => e.type === "task_loop.run_scheduled")
  assert.ok(scheduled)
  assert.equal(scheduled!.kind, "continue")
  assert.deepEqual(scheduled!.unticked_ids, ["live:1"])
})

test("model_draft rows are not evidence and never drive continuation", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "d0", text: "draft row", done: false, source: "model_draft" }])
  exitCheck(tid)
  // no evidence items → treated as no live plan → propose bootstrap
  const next = queues.takeNextRun(tid)
  assert.ok(next)
  assert.equal(next!.text, kernel.PROPOSE_REQUEST_STEER)
})

test("all items ticked → task_loop.completed, no continuation", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [
    { id: "live:0", text: "打开页面", done: true, tool: "navigate" },
    { id: "live:1", text: "点击提交", done: true, tool: "click" },
  ])
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "completed")
  const done = audits.find((e) => e.type === "task_loop.completed")
  assert.ok(done)
  assert.deepEqual(done!.ticked_ids, ["live:0", "live:1"])
})

test("pure Q&A run never continues an armed loop", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ toolCalls: 0 }))
  assert.equal(queues.peekNextRunCount(tid), 0)
  const stopped = audits.find((e) => e.type === "task_loop.stopped")
  assert.equal(stopped?.reason, "no_tool_calls")
  assert.equal(getLoop(tid)?.status, "active") // stays armed, just not continued
})

// --- budgets ---

test("runs budget exhausted → STOPPED_BUDGET; explicit resume re-arms with fresh window", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  const cur = getLoop(tid)!
  tm.update(tid, { loop_state: { ...cur, runs_used: loopState.LOOP_BUDGET.maxRuns } } as any)
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  const st = getLoop(tid)
  assert.equal(st?.status, "stopped_budget")
  assert.equal(st?.budget_stop, "runs")
  const stopped = audits.find((e) => e.type === "task_loop.stopped")
  assert.equal(stopped?.reason, "budget")
  assert.equal(stopped?.dimension, "runs")

  // checkpoint resume: progress kept (run_progress untouched), fresh budget window
  const resumed = kernel.armLoop(tm, tid, "suggestion_card", { resume: true, audit: auditSink })
  assert.equal(resumed?.status, "active")
  assert.equal(resumed?.runs_used, 0)
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 1, "continuation flows again after resume")
})

test("wall-clock budget exhausted → STOPPED_BUDGET (wall_clock)", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  const cur = getLoop(tid)!
  tm.update(tid, {
    loop_state: { ...cur, started_at_ms: Date.now() - 31 * 60 * 1000 },
  } as any)
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "stopped_budget")
  assert.equal(getLoop(tid)?.budget_stop, "wall_clock")
})

test("token aggregate budget: >10× median single-run cost → STOPPED_BUDGET (tokens)", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  const cur = getLoop(tid)!
  tm.update(tid, {
    loop_state: { ...cur, run_tokens: [100, 100, 100], tokens_used: 1000 },
  } as any)
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ totalTokens: 100 }))
  assert.equal(queues.peekNextRunCount(tid), 0)
  const st = getLoop(tid)
  assert.equal(st?.status, "stopped_budget")
  assert.equal(st?.budget_stop, "tokens")
  assert.equal(audits.find((e) => e.type === "task_loop.stopped")?.dimension, "tokens")
})

// --- user stop / security halt ---

test("user stop → STOPPED_USER: queue dropped, never revives, no suggestion card", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  queues.enqueueNextRun(tid, "queued continuation", undefined, "loop")
  queues.enqueueNextRun(tid, "real user message")
  const marked = kernel.markLoopStoppedByUser(tm, tid, "chat.abort", { audit: auditSink })
  assert.equal(marked, true)
  assert.equal(getLoop(tid)?.status, "stopped_user")
  // loop entries dropped; the user entry survives
  assert.equal(queues.peekNextRunCount(tid, ), 1)
  assert.equal(queues.peekNextRun(tid)?.text, "real user message")
  assert.equal(audits.find((e) => e.type === "task_loop.stopped")?.reason, "user")
  // later run finishes with unticked items: no continuation, no card
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 1)
  assert.equal(suggestFrames.length, 0)
})

test("security_halt terminal → HALT_SECURITY, never auto-continues", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ terminal: "security_halt" }))
  assert.equal(getLoop(tid)?.status, "halt_security")
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(audits.find((e) => e.type === "task_loop.stopped")?.reason, "security")
  // subsequent runs do not revive it and do not suggest re-arm
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(suggestFrames.length, 0)
})

test("circuit_breaker / error terminals: no continuation, loop stays armed", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ terminal: "circuit_breaker" }))
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "active")
  assert.equal(audits.find((e) => e.type === "task_loop.stopped")?.reason, "circuit_breaker")
})

test("aborted terminal: exit check defers to the abort path (no state change)", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats({ terminal: "aborted" }))
  assert.equal(getLoop(tid)?.status, "active") // markLoopStoppedByUser owns the transition
  assert.equal(queues.peekNextRunCount(tid), 0)
})

// --- eligibility: tools without plan → propose bootstrap ---

test("tools without live plan: first continuation requests propose, second gives up", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  exitCheck(tid)
  const first = queues.takeNextRun(tid)
  assert.ok(first)
  assert.equal(first!.source, "loop")
  assert.equal(first!.text, kernel.PROPOSE_REQUEST_STEER)
  assert.equal(getLoop(tid)?.propose_requested, true)
  // model never proposed (still no plan) → stopped_no_checklist
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "stopped_no_checklist")
})

test("sticky-cleared run_progress (null): never pushes a propose", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, null)
  exitCheck(tid)
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "active")
  assert.equal(audits.find((e) => e.type === "task_loop.stopped")?.reason, "no_checklist")
})

// --- worker yield / workers never loop ---

test("orchestrator loop yields while a worker is active", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid, stats(), { hasActiveWorker: () => true })
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "active")
  // once the worker is done the same exit check schedules the continuation
  exitCheck(tid, stats(), { hasActiveWorker: () => false })
  assert.equal(queues.peekNextRunCount(tid), 1)
})

test("worker threads never loop (exit check is a no-op)", () => {
  const wid = newThread()
  tm.update(wid, { agent_role: "worker" } as any)
  setProgress(wid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(wid)
  assert.equal(queues.peekNextRunCount(wid), 0)
  assert.equal(getLoop(wid), null)
  assert.equal(suggestFrames.length, 0)
})

// --- drain gate ---

test("drain gate: loop entries drain only while active + within budget", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  queues.enqueueNextRun(tid, "loop step", undefined, "loop")
  kernel.gateLoopNextRunDrain(tid, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(tid), 1, "active loop entry is released")

  // user-stopped loop: entry dropped, never drained
  kernel.markLoopStoppedByUser(tm, tid, "chat.abort", { audit: auditSink })
  queues.enqueueNextRun(tid, "stale loop step", undefined, "loop")
  kernel.gateLoopNextRunDrain(tid, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(tid), 0)
})

test("drain gate: budget exhausted at drain time lands STOPPED_BUDGET and drops the entry", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  const cur = getLoop(tid)!
  tm.update(tid, {
    loop_state: { ...cur, started_at_ms: Date.now() - 31 * 60 * 1000 },
  } as any)
  queues.enqueueNextRun(tid, "loop step", undefined, "loop")
  kernel.gateLoopNextRunDrain(tid, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.equal(getLoop(tid)?.status, "stopped_budget")
  assert.equal(getLoop(tid)?.budget_stop, "wall_clock")
  const stopped = audits.find((e) => e.type === "task_loop.stopped")
  assert.equal(stopped?.reason, "budget")
  assert.equal(stopped?.at_drain, true)
})

test("drain gate: user entries in front of loop entries are left alone", () => {
  const tid = newThread()
  // stopped loop, but a genuine user message sits at the head
  queues.enqueueNextRun(tid, "user turn")
  queues.enqueueNextRun(tid, "stale loop", undefined, "loop")
  kernel.gateLoopNextRunDrain(tid, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(tid), 2, "head is user — gate stops at it")
})

// --- audit replay ---

test("task_loop.* audit family replays an episode start→run_scheduled→completed", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false }])
  exitCheck(tid)
  queues.takeNextRun(tid)
  setProgress(tid, [{ id: "live:0", text: "x", done: true }])
  exitCheck(tid)
  const types = audits.filter((e) => e.type.startsWith("task_loop.")).map((e) => e.type)
  assert.deepEqual(types, ["task_loop.start", "task_loop.run_scheduled", "task_loop.completed"])
  for (const e of audits) {
    assert.ok(typeof e.at === "string" && e.at.length > 0, "every event carries a timestamp")
    assert.equal(e.thread_id, tid)
  }
})

// --- sanitize ---

test("sanitizeLoopState rejects junk and caps runs_used", () => {
  assert.equal(loopState.sanitizeLoopState(null), null)
  assert.equal(loopState.sanitizeLoopState({ status: "active" }), null)
  assert.equal(
    loopState.sanitizeLoopState({
      status: "active",
      armed_by: "explicit_command",
      armed_at: "x",
      started_at_ms: 1,
      wall_clock_ms: 1000,
      runs_used: 999,
      tokens_used: 0,
      run_tokens: [],
    }),
    null,
    "runs_used beyond the cap is rejected",
  )
})
