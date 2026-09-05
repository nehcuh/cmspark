/**
 * L-5 (#391) unattended loop + #326 overlay.
 *
 * Acceptance:
 *  - NEVER confirm 45s timeout → item blocked, others continue, terminal key list
 *  - two loops compete for CU → queue (layered vs llm-loop-gate)
 *  - grant TTL expire → paused, recoverable; loop does not extend TTL
 *  - evidence digest in capability-audit; copy is 计划完成待复核 (no claim)
 *  - deny-storm ≥3 → loop pauses
 *  - 45s fail-closed unchanged; unattended default off
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-loop-unattended-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let kernel: typeof import("../src/loop/loop-kernel")
let loopState: typeof import("../src/loop/loop-state")
let queues: typeof import("../src/llm/run-queues")
let overlay: typeof import("../src/loop/unattended-overlay")
let lease: typeof import("../src/loop/cu-focus-lease")
let grant: typeof import("../src/computer/unattended-grant")
let routeSession: typeof import("../src/loop/route-session")
let classifyError: typeof import("../src/security").classifyError
let DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS: number
let SECURITY_ARM_CONFIRM_PHRASE: string
let llmGate: typeof import("../src/orchestrator/llm-loop-gate")

type AuditEvent = { type: string; [k: string]: unknown }
let audits: AuditEvent[]
const auditSink = (e: AuditEvent) => {
  audits.push(e)
}

let frames: Array<{ type: string; [k: string]: unknown }>
const sendToExtension = (data: unknown) => {
  if (data && typeof data === "object" && "type" in data) {
    frames.push(data as { type: string; [k: string]: unknown })
  }
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
  return tm.create(`unatt-${Date.now()}-${seq++}`).id
}

function setProgress(
  threadId: string,
  items: Array<{ id: string; text: string; done: boolean; source?: string; tool?: string }>,
) {
  tm.update(threadId, {
    run_progress: {
      items: items.map((it) => ({
        id: it.id,
        text: it.text,
        done: it.done,
        source: (it.source as "seed") ?? "seed",
        ...(it.tool ? { tool: it.tool } : {}),
      })),
    },
  } as any)
}

function exitCheck(threadId: string, s = stats(), nowMs?: number) {
  kernel.onLoopRunFinished({
    threadManager: tm,
    threadId,
    stats: s,
    audit: auditSink,
    sendToExtension,
    nowMs,
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
  overlay = await import("../src/loop/unattended-overlay")
  lease = await import("../src/loop/cu-focus-lease")
  grant = await import("../src/computer/unattended-grant")
  routeSession = await import("../src/loop/route-session")
  classifyError = (await import("../src/security")).classifyError
  DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = (await import("../src/security-confirmation"))
    .DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS
  SECURITY_ARM_CONFIRM_PHRASE = (await import("../src/security-arm")).SECURITY_ARM_CONFIRM_PHRASE
  llmGate = await import("../src/orchestrator/llm-loop-gate")
  const config = await import("../src/config")
  await config.initDataDir()
})

beforeEach(() => {
  tm = new ThreadManager()
  audits = []
  frames = []
  queues._resetRunQueuesForTests()
  overlay._resetUnattendedOverlayForTests()
  lease._resetCuFocusLeaseForTests()
  grant.resetUnattendedGrantForTests()
  routeSession._resetRouteSessionsForTests()
  llmGate._resetMultiAgentLlmLoopsForTests()
})

// --- hard constraints ---

test("45s fail-closed is unchanged (no auto-allow)", () => {
  assert.equal(DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS, 45_000)
})

test("unattended grant defaults off", () => {
  assert.equal(grant.isUnattendedArmed(), false)
})

test("UNATTENDED_CONFIRM_DENIED is recoverable (bypass HALT_SECURITY), Security Block string still security without the code", () => {
  assert.equal(
    classifyError("Security Block: evaluate timed out.", {
      toolName: "evaluate",
      error_code: "UNATTENDED_CONFIRM_DENIED",
    }),
    "recoverable",
  )
  assert.equal(
    classifyError("Security Block: evaluate contains high-risk APIs. User confirmation timed out.", {
      toolName: "evaluate",
    }),
    "security",
  )
})

test("loop arm does not extend grant TTL", () => {
  const now = 1_000_000
  const armed = grant.armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE, now })
  assert.equal(armed.ok, true)
  const exp = grant.getUnattendedStatus(now).expiresAt
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, nowMs: now + 60_000, audit: auditSink })
  assert.equal(grant.getUnattendedStatus(now + 60_000).expiresAt, exp)
  assert.equal(getLoop(tid)?.unattended, true)
})

// --- deny → blocked → bypass + key list ---

test("unattended NEVER confirm timeout blocks that item, others continue, terminal emits 钥匙清单", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, audit: auditSink })
  setProgress(tid, [
    { id: "live:0", text: "写凭证", done: false, tool: "evaluate" },
    { id: "live:1", text: "点提交", done: false, tool: "click" },
  ])
  const denied = overlay.onUnattendedConfirmDenied({
    threadId: tid,
    threadManager: tm,
    toolName: "evaluate",
    reason: "timeout",
    sendToExtension,
  })
  assert.equal(denied.handled, true)
  assert.equal(denied.bypassHalt, true)
  assert.equal(denied.pause, false)
  assert.equal(denied.blockedItemId, "live:0")
  assert.equal(denied.present?.stealFocus, false)
  assert.equal(denied.present?.cockpitAction, "stay_background")
  assert.ok(frames.some((f) => f.type === "task_loop.blocked_report" && f.steal_focus === false))

  exitCheck(tid)
  const next = queues.takeNextRun(tid)
  assert.ok(next)
  assert.match(next!.text, /点提交/)
  assert.doesNotMatch(next!.text, /写凭证/)

  setProgress(tid, [
    { id: "live:0", text: "写凭证", done: false, tool: "evaluate" },
    { id: "live:1", text: "点提交", done: true, tool: "click" },
  ])
  exitCheck(tid, stats({ closingTurnToolCalls: 0 }))
  assert.equal(getLoop(tid)?.status, "completed")
  const done = audits.find((e) => e.type === "task_loop.completed")
  assert.ok(done)
  assert.equal(done!.tier, "unattended")
  assert.equal(done!.copy, overlay.UNATTENDED_REVIEW_COPY)
  assert.equal(done!.copy, "计划完成待复核")
  assert.notEqual(String(done!.copy), "任务完成")
  const digest = done!.digest as { ticked_ids: string[]; blocked_ids: string[]; tools: string[] }
  assert.deepEqual(digest.ticked_ids, ["live:1"])
  assert.deepEqual(digest.blocked_ids, ["live:0"])
  assert.ok(digest.tools.includes("click"))
  const keyList = done!.key_list as Array<{ item_id: string }>
  assert.equal(keyList.length, 1)
  assert.equal(keyList[0]!.item_id, "live:0")
})

test("user-return confirm deny does not kill the loop (item blocked, status stays active)", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, audit: auditSink })
  setProgress(tid, [
    { id: "live:0", text: "危险操作", done: false, tool: "evaluate" },
    { id: "live:1", text: "别的项", done: false, tool: "click" },
  ])
  const denied = overlay.onUnattendedConfirmDenied({
    threadId: tid,
    threadManager: tm,
    toolName: "evaluate",
    reason: "denied",
  })
  assert.equal(denied.handled, true)
  assert.equal(denied.pause, false)
  assert.equal(getLoop(tid)?.status, "active")
  exitCheck(tid)
  assert.equal(getLoop(tid)?.status, "active")
  assert.equal(queues.peekNextRunCount(tid), 1)
})

test("deny-storm ≥3 pauses the loop (recoverable, not HALT_SECURITY)", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false, tool: "evaluate" }])
  for (let i = 0; i < 2; i++) {
    const r = overlay.onUnattendedConfirmDenied({
      threadId: tid,
      threadManager: tm,
      toolName: "evaluate",
      reason: "timeout",
    })
    assert.equal(r.pause, false)
  }
  const storm = overlay.onUnattendedConfirmDenied({
    threadId: tid,
    threadManager: tm,
    toolName: "evaluate",
    reason: "timeout",
  })
  assert.equal(storm.pause, true)
  assert.equal(storm.stormCount, overlay.DENY_STORM_THRESHOLD)
  const paused = kernel.markLoopPaused(tm, tid, "deny_storm", { audit: auditSink })
  assert.equal(paused, true)
  assert.equal(getLoop(tid)?.status, "paused")
  assert.equal(getLoop(tid)?.pause_reason, "deny_storm")
  queues.enqueueNextRun(tid, "stale loop", undefined, "loop")
  kernel.gateLoopNextRunDrain(tid, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(tid), 0)
  assert.notEqual(getLoop(tid)?.status, "halt_security")

  const resumed = kernel.armLoop(tm, tid, "explicit_command", {
    resume: true,
    unattended: true,
    audit: auditSink,
  })
  assert.equal(resumed?.status, "active")
  assert.equal(overlay.peekDenyStorm(tid), 0)
})

// --- grant TTL ---

test("grant TTL expiry pauses unattended loop; explicit re-arm recovers; not silent impossible", () => {
  const now = 5_000_000
  grant.armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE, now })
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, nowMs: now, audit: auditSink })
  setProgress(tid, [{ id: "live:0", text: "x", done: false, tool: "click" }])
  const later = now + grant.UNATTENDED_HARD_TTL_MS + 1
  assert.equal(grant.isUnattendedArmed(later), false)
  exitCheck(tid, stats(), later)
  assert.equal(getLoop(tid)?.status, "paused")
  assert.equal(getLoop(tid)?.pause_reason, "grant_ttl")
  const pausedAudit = audits.find((e) => e.type === "task_loop.paused" && e.state_paused === true)
  assert.equal(pausedAudit?.reason, "grant_ttl")
  assert.equal(queues.peekNextRunCount(tid), 0)

  const reGrant = grant.armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE, now: later })
  assert.equal(reGrant.ok, true)
  const resumed = kernel.armLoop(tm, tid, "explicit_command", {
    resume: true,
    unattended: true,
    nowMs: later,
    audit: auditSink,
  })
  assert.equal(resumed?.status, "active")
  assert.equal(resumed?.pause_reason, undefined)
  exitCheck(tid, stats(), later)
  assert.equal(queues.peekNextRunCount(tid), 1)
})

test("pauseUnattendedLoopsOnGrantExpire only pauses unattended episodes", () => {
  const a = newThread()
  const b = newThread()
  kernel.armLoop(tm, a, "unattended_arm", { unattended: true, audit: auditSink })
  kernel.armLoop(tm, b, "explicit_command", { unattended: false, audit: auditSink })
  kernel.pauseUnattendedLoopsOnGrantExpire(tm, { audit: auditSink })
  assert.equal(getLoop(a)?.status, "paused")
  assert.equal(getLoop(a)?.pause_reason, "grant_ttl")
  assert.equal(getLoop(b)?.status, "active")
})

// --- CU focus lease ---

test("two loops competing for CU: second queues, first release notifies waiter", () => {
  const a = newThread()
  const b = newThread()
  kernel.armLoop(tm, a, "explicit_command", { audit: auditSink })
  kernel.armLoop(tm, b, "explicit_command", { audit: auditSink })
  const ga = lease.gateHostComputerFocusLease(tm.get(a) as any, a)
  assert.equal(ga.ok, true)
  if (ga.ok) assert.equal(ga.acquired, true)
  const gb = lease.gateHostComputerFocusLease(tm.get(b) as any, b)
  assert.equal(gb.ok, false)
  if (!gb.ok) {
    assert.equal(gb.error_code, lease.CU_FOCUS_LEASE_QUEUED)
    assert.equal(gb.holder, a)
  }
  assert.deepEqual(lease.cuFocusLeaseSnapshot(), { holder: a, queued: [b] })
  lease.releaseCuFocusLease(a)
  assert.equal(lease.cuFocusLeaseSnapshot().holder, null)
  assert.equal(queues.peekNextRun(b)?.source, "loop")
  assert.match(queues.peekNextRun(b)!.text, /CU focus lease is free/)
  const gb2 = lease.gateHostComputerFocusLease(tm.get(b) as any, b)
  assert.equal(gb2.ok, true)
})

test("CU focus lease is layered vs llm-loop-gate (holding CU does not consume an LLM slot)", () => {
  const a = newThread()
  kernel.armLoop(tm, a, "explicit_command", { audit: auditSink })
  const ga = lease.gateHostComputerFocusLease(tm.get(a) as any, a)
  assert.equal(ga.ok, true)
  const snap = llmGate.multiAgentLlmLoopSnapshot()
  assert.equal(snap.active, 0)
  assert.equal(llmGate.tryAcquireMultiAgentLlmLoop({ agent_role: "worker" }, "w1").ok, true)
  assert.equal(llmGate.multiAgentLlmLoopSnapshot().active, 1)
  assert.equal(lease.cuFocusLeaseSnapshot().holder, a)
  lease.releaseCuFocusLease(a)
})

test("non-loop threads do not take the CU focus lease", () => {
  const tid = newThread()
  const g = lease.gateHostComputerFocusLease(tm.get(tid) as any, tid)
  assert.equal(g.ok, true)
  if (g.ok) assert.equal(g.acquired, false)
  assert.equal(lease.cuFocusLeaseSnapshot().holder, null)
})

test("same loop re-enters the CU focus lease", () => {
  const a = newThread()
  kernel.armLoop(tm, a, "explicit_command", { audit: auditSink })
  assert.equal(lease.tryAcquireCuFocusLease(a).ok, true)
  assert.equal(lease.tryAcquireCuFocusLease(a).ok, true)
  lease.releaseCuFocusLease(a)
  assert.equal(lease.cuFocusLeaseSnapshot().holder, null)
})

test("unattended all-ticked close is 计划完成待复核 with digest and no claim", () => {
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, audit: auditSink })
  setProgress(tid, [
    { id: "live:0", text: "打开", done: true, tool: "navigate" },
    { id: "live:1", text: "点击", done: true, tool: "click" },
  ])
  exitCheck(tid)
  const done = audits.find((e) => e.type === "task_loop.completed")
  assert.equal(done?.tier, "unattended")
  assert.equal(done?.copy, "计划完成待复核")
  const digest = done!.digest as { ticked_ids: string[]; blocked_ids: string[] }
  assert.deepEqual(digest.ticked_ids, ["live:0", "live:1"])
  assert.deepEqual(digest.blocked_ids, [])
  assert.equal(getLoop(tid)?.status, "completed")
})

// --- #402 round-2: MAJOR-1 / MAJOR-2 / MAJOR-3 ---

test("MAJOR-1: TTL-pause drain gate keeps user messages (does not takeNextRun after dropLoop)", () => {
  const now = 8_000_000
  grant.armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE, now })
  const tid = newThread()
  kernel.armLoop(tm, tid, "unattended_arm", { unattended: true, nowMs: now, audit: auditSink })
  queues.enqueueNextRun(tid, "stale loop continuation", undefined, "loop")
  queues.enqueueNextRun(tid, "user came back")
  assert.equal(queues.peekNextRunCount(tid), 2)
  const later = now + grant.UNATTENDED_HARD_TTL_MS + 1
  kernel.gateLoopNextRunDrain(tid, tm, { nowMs: later, audit: auditSink })
  assert.equal(getLoop(tid)?.status, "paused")
  assert.equal(getLoop(tid)?.pause_reason, "grant_ttl")
  assert.equal(queues.peekNextRunCount(tid), 1, "user entry survives TTL pause drain")
  assert.equal(queues.peekNextRun(tid)?.text, "user came back")
  assert.equal(queues.peekNextRun(tid)?.source ?? "user", "user")
})

function adapterClassify(toolResult: {
  error: string
  error_code?: string
  data?: { error_code?: string }
}) {
  // Same extraction as adapter.ts:1859–1865.
  const error_code =
    toolResult.error_code ||
    (typeof toolResult.data?.error_code === "string" ? toolResult.data.error_code : undefined)
  return classifyError(toolResult.error, { toolName: "host_computer", error_code })
}

test("MAJOR-2: l2-admission queued payload is recoverable — no security_halt — drain keeps retry", () => {
  const queued = {
    success: false,
    error:
      "host_computer waiting on CU focus lease (held by other) [CU_FOCUS_LEASE_QUEUED] — " +
      "only one loop/worker drives CU at a time; this request is queued.",
    error_code: lease.CU_FOCUS_LEASE_QUEUED,
    data: { error_code: lease.CU_FOCUS_LEASE_QUEUED, holder_thread_id: "other" },
  }
  // Without the code the string falls to default non_recoverable (why mapping is required).
  assert.equal(classifyError(queued.error, { toolName: "host_computer" }), "non_recoverable")
  const level = adapterClassify(queued)
  assert.equal(level, "recoverable")
  assert.notEqual(level, "security")
  assert.notEqual(level, "non_recoverable")

  const a = newThread()
  const b = newThread()
  kernel.armLoop(tm, a, "explicit_command", { audit: auditSink })
  kernel.armLoop(tm, b, "explicit_command", { audit: auditSink })
  assert.equal(lease.gateHostComputerFocusLease(tm.get(a) as any, a).ok, true)
  const gb = lease.gateHostComputerFocusLease(tm.get(b) as any, b)
  assert.equal(gb.ok, false)
  if (!gb.ok) {
    const l2Shape = {
      success: false as const,
      error: gb.error,
      error_code: gb.error_code,
      data: { error_code: gb.error_code, holder_thread_id: gb.holder },
    }
    assert.equal(adapterClassify(l2Shape), "recoverable")
  }
  // Recoverable ⇒ adapter does not set security_halt; loop B stays active.
  assert.equal(getLoop(b)?.status, "active")
  lease.releaseCuFocusLease(a)
  assert.equal(queues.peekNextRun(b)?.source, "loop")
  kernel.gateLoopNextRunDrain(b, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(b), 1, "retry notification survives drain while loop active")
  assert.match(queues.peekNextRun(b)!.text, /CU focus lease is free/)
})

test("MAJOR-3: worker CU waiter uses user source so drain gate does not starve it", () => {
  const a = newThread()
  kernel.armLoop(tm, a, "explicit_command", { audit: auditSink })
  const w = newThread()
  tm.update(w, { agent_role: "worker" } as any)
  assert.equal(lease.shouldUseCuFocusLease(tm.get(w) as any), true)
  assert.equal(lease.cuFocusWaiterSource(tm.get(w) as any), "user")
  assert.equal(lease.gateHostComputerFocusLease(tm.get(a) as any, a).ok, true)
  const gw = lease.gateHostComputerFocusLease(tm.get(w) as any, w)
  assert.equal(gw.ok, false)
  lease.releaseCuFocusLease(a)
  const notice = queues.peekNextRun(w)
  assert.ok(notice)
  assert.equal(notice!.source ?? "user", "user", "worker retry is not loop-source")
  assert.match(notice!.text, /CU focus lease is free/)
  // Worker has no loop_state: loop-source would be takeNextRun'd. user-source passes.
  kernel.gateLoopNextRunDrain(w, tm, { audit: auditSink })
  assert.equal(queues.peekNextRunCount(w), 1, "worker retry is not starved by drain gate")
})
