/**
 * #513 fleet_suggest_propose — advisory-only dispatch + handshake ACL + silence/throttle.
 * The tool must NEVER spawn/arm/mutate; it only surfaces a card (broadcast) and
 * honors the per-thread silence window / throttle.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fleet-suggest-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let fleetSuggest: typeof import("../src/orchestrator/fleet-suggest")

const ARGS = {
  reason: "三个独立站点的价格对比，单干需 6 次往返",
  subtasks: ["查站点 A 价格", "查站点 B 价格", "查站点 C 价格"],
}

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
  fleetSuggest = await import("../src/orchestrator/fleet-suggest")
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function bindTm(tm: InstanceType<typeof ThreadManager>) {
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {
      request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
    } as any,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

function readSrc(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "src", ...parts),
    path.join(process.cwd(), "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("src not found: " + parts.join("/"))
}

test("surface: SUMMONER_ACL denies (handshake-only, params.surface cannot spoof)", async () => {
  const tm = new ThreadManager()
  const th = tm.create("fs-spoof")
  bindTm(tm)
  const broadcasts: unknown[] = []
  for (const surface of ["summoner" as const, undefined]) {
    const r: any = await executeCompanionTool(
      "fleet_suggest_propose",
      { __thread_id: th.id, ...ARGS, surface: "tray" },
      "tc-acl",
      { ...(surface ? { handshakeSurface: surface } : {}), broadcast: (d: unknown) => broadcasts.push(d) },
    )
    assert.equal(r.success, false)
    assert.equal(r.data.error_code, "SUMMONER_ACL")
  }
  assert.equal(broadcasts.length, 0)
})

test("thread: missing/unknown __thread_id → THREAD_REQUIRED", async () => {
  const tm = new ThreadManager()
  bindTm(tm)
  const r1: any = await executeCompanionTool("fleet_suggest_propose", { ...ARGS }, "tc-t1", {
    handshakeSurface: "tray",
    broadcast: () => {},
  })
  assert.equal(r1.data.error_code, "THREAD_REQUIRED")
  const r2: any = await executeCompanionTool(
    "fleet_suggest_propose",
    { __thread_id: "nope", ...ARGS },
    "tc-t2",
    { handshakeSurface: "tray", broadcast: () => {} },
  )
  assert.equal(r2.data.error_code, "THREAD_REQUIRED")
})

test("worker threads cannot propose (WORKER_DENIED)", async () => {
  const tm = new ThreadManager()
  const th = tm.create("fs-worker")
  tm.update(th.id, { agent_role: "worker", parent_thread_id: "orch-1" })
  bindTm(tm)
  const r: any = await executeCompanionTool(
    "fleet_suggest_propose",
    { __thread_id: th.id, ...ARGS },
    "tc-w",
    { handshakeSurface: "tray", broadcast: () => {} },
  )
  assert.equal(r.success, false)
  assert.equal(r.data.error_code, "WORKER_DENIED")
})

test("args: reason required, subtasks 2–5", async () => {
  const tm = new ThreadManager()
  const th = tm.create("fs-args")
  bindTm(tm)
  const run = (params: any) =>
    executeCompanionTool("fleet_suggest_propose", { __thread_id: th.id, ...params }, "tc-args", {
      handshakeSurface: "tray",
      broadcast: () => {},
    })
  for (const bad of [
    { reason: "", subtasks: ARGS.subtasks },
    { reason: "r", subtasks: ["only one"] },
    { reason: "r", subtasks: ["a", "b", "c", "d", "e", "f"] },
  ]) {
    const r: any = await run(bad)
    assert.equal(r.success, false, JSON.stringify(bad))
    assert.equal(r.data.error_code, "INVALID_ARGS")
  }
})

test("happy path: broadcasts ONE fleet.suggest frame and mutates NOTHING", async () => {
  fleetSuggest.clearFleetSuggestState()
  const tm = new ThreadManager()
  const th = tm.create("fs-happy")
  bindTm(tm)
  const broadcasts: unknown[] = []
  const threadsBefore = tm.list().length

  const r: any = await executeCompanionTool(
    "fleet_suggest_propose",
    { __thread_id: th.id, ...ARGS },
    "tc-ok",
    { handshakeSurface: "tray", broadcast: (d: unknown) => broadcasts.push(d) },
  )
  assert.equal(r.success, true)
  assert.equal(r.data.surfaced, true)
  assert.match(String(r.data.note), /Do NOT spawn workers yet/)

  assert.equal(broadcasts.length, 1)
  const frame = broadcasts[0] as any
  assert.equal(frame.type, "fleet.suggest")
  assert.equal(frame.thread_id, th.id)
  assert.equal(frame.reason, ARGS.reason)
  assert.deepEqual(frame.subtasks, ARGS.subtasks)

  // advisory-only: no thread created, no role change, no loop state
  assert.equal(tm.list().length, threadsBefore)
  const after = tm.get(th.id) as any
  assert.notEqual(after.agent_role, "orchestrator")
  assert.equal(after.loop_state ?? null, null)
})

test("throttle: second call within 60s surfaces nothing", async () => {
  fleetSuggest.clearFleetSuggestState()
  const tm = new ThreadManager()
  const th = tm.create("fs-throttle")
  bindTm(tm)
  const broadcasts: unknown[] = []
  const opts = { handshakeSurface: "tray" as const, broadcast: (d: unknown) => broadcasts.push(d) }
  await executeCompanionTool("fleet_suggest_propose", { __thread_id: th.id, ...ARGS }, "tc-1", opts)
  const r2: any = await executeCompanionTool("fleet_suggest_propose", { __thread_id: th.id, ...ARGS }, "tc-2", opts)
  assert.equal(r2.data.surfaced, false)
  assert.equal(r2.data.reason, "throttled")
  assert.equal(broadcasts.length, 1)
})

test("dismiss silence: recordFleetSuggestDismiss suppresses for the TTL window", async () => {
  fleetSuggest.clearFleetSuggestState()
  const tm = new ThreadManager()
  const th = tm.create("fs-silence")
  bindTm(tm)
  const broadcasts: unknown[] = []
  const opts = { handshakeSurface: "tray" as const, broadcast: (d: unknown) => broadcasts.push(d) }
  fleetSuggest.recordFleetSuggestDismiss(th.id)
  const r: any = await executeCompanionTool("fleet_suggest_propose", { __thread_id: th.id, ...ARGS }, "tc-s", opts)
  assert.equal(r.data.surfaced, false)
  assert.equal(r.data.reason, "suppressed")
  assert.equal(broadcasts.length, 0)

  // gate module: suppression never stamps the throttle clock
  const t0 = 1_000_000
  fleetSuggest.clearFleetSuggestState()
  fleetSuggest.recordFleetSuggestDismiss("g1", t0)
  assert.deepEqual(fleetSuggest.fleetSuggestGate("g1", t0 + 1), { ok: false, reason: "suppressed" })
  assert.deepEqual(fleetSuggest.fleetSuggestGate("g1", t0 + fleetSuggest.FLEET_SUGGEST_SILENCE_MS + 1), { ok: true })
  assert.deepEqual(fleetSuggest.fleetSuggestGate("g1", t0 + fleetSuggest.FLEET_SUGGEST_SILENCE_MS + 2), {
    ok: false,
    reason: "throttled",
  })
})

test("wiring: registered in catalog, COMPANION_TOOLS, plan-readonly, strip list, validate+router", () => {
  const catalog = readSrc("bridge", "tool-definitions-catalog.json")
  assert.match(catalog, /"fleet_suggest_propose"/, "catalog entry present")
  assert.match(catalog, /Advisory only \(#513\)/, "advisory tone pinned")

  const tools = readSrc("bridge", "companion-tools.ts")
  assert.match(tools, /"fleet_suggest_propose"/)

  const plan = readSrc("tool", "plan-readonly.ts")
  assert.match(plan, /"fleet_suggest_propose"/, "plan_readonly advisory parity")

  const server = readSrc("server.ts")
  assert.match(server, /toolName === "fleet_suggest_propose"/, "surface strip list entry")

  const validate = readSrc("ws", "validate.ts")
  assert.match(validate, /"fleet\.suggest\.dismiss": \(m\) =>/, "inbound validator registered")
  const router = readSrc("message-router.ts")
  assert.match(router, /case "fleet\.suggest\.dismiss"/, "router case arm present")

  const schemas = readSrc("bridge", "tool-schemas.ts")
  assert.match(schemas, /fleet_suggest_propose: z\.object/, "zod schema registered")
})

test("prompt: FLEET DISPATCH CRITERIA is surface-gated and sits before the security footer", () => {
  const src = readSrc("llm", "adapter.ts")
  assert.match(src, /FLEET DISPATCH CRITERIA/, "criteria segment present")
  assert.match(src, /fleetDispatchHint/, "segment variable")
  // surface gate mirrors runProgressHint (summoner gets no dead instruction)
  const gate = src.match(/const fleetDispatchHint =\s*\n\s*params\.surface === "summoner"\s*\n\s*\? ""/)
  assert.ok(gate, "fleetDispatchHint is summoner-gated like runProgressHint")
  // negative conditions come first (default posture: solo)
  assert.match(src, /Do NOT propose when ANY holds/, "negative criteria present")
  // order inside composeSystemPrompt: runProgressHint → fleetDispatchHint → … → securityFooter
  const compose = src.slice(src.indexOf("const composeSystemPrompt"), src.indexOf("const systemPrompt = composeSystemPrompt"))
  const iRun = compose.indexOf("runProgressHint,")
  const iFleet = compose.indexOf("fleetDispatchHint,")
  const iSec = compose.indexOf("securityFooter,")
  assert.ok(iRun > -1 && iFleet > iRun && iSec > iFleet, "segment ordered before securityFooter")
})

test("loop-kernel pin: a propose-only run never produces task_loop.suggest (no-auto-spam guard)", async () => {
  // #513 review (kimi MAJOR-1): the unarmed suggest card requires untickedEvidence > 0 —
  // a run whose only tool call was fleet_suggest_propose has run_progress=null and must
  // NOT light the 续跑 card. If loop-kernel ever relaxes this, the fleet propose would
  // start spawning loop-suggest cards — pin the dependency.
  const kernel = await import("../src/loop/loop-kernel")
  const tm = new ThreadManager()
  const th = tm.create("fs-kernel-pin")
  const sent: any[] = []
  kernel.onLoopRunFinished({
    threadManager: tm,
    threadId: th.id,
    stats: { terminal: null, toolCalls: 1, totalTokens: 0, rounds: 1 } as any,
    audit: () => {},
    sendToExtension: (d: any) => sent.push(d),
  })
  assert.ok(
    !sent.some((f) => f.type === "task_loop.suggest"),
    "propose-only run (run_progress=null) must not emit task_loop.suggest",
  )
})

test("validate behavioral: fleet.suggest.dismiss accepts thread_id, rejects without", async () => {
  const { validateWsMessage } = await import("../src/ws/validate")
  const ok = validateWsMessage({ type: "fleet.suggest.dismiss", thread_id: "t1" })
  assert.equal(ok.valid, true, JSON.stringify(ok))
  const bad = validateWsMessage({ type: "fleet.suggest.dismiss" })
  assert.equal(bad.valid, false)
  if (!bad.valid) assert.match(String(bad.error), /requires thread_id/)
})

test("#514: broadcastFleetSnapshotIfWorkers pushes fleet.status only when workers exist", async () => {
  const { broadcastFleetSnapshotIfWorkers } = await import("../src/orchestrator/fleet")
  const tm = new ThreadManager()
  // shared test HOME: earlier cases left worker threads in the index — clear
  // them so the no-push baseline is about THIS manager's state.
  for (const t of tm.list() as any[]) {
    if (t.agent_role === "worker") tm.delete(t.id)
  }
  const pushed: unknown[] = []
  const broadcast = (d: unknown) => pushed.push(d)

  broadcastFleetSnapshotIfWorkers(tm, broadcast)
  assert.equal(pushed.length, 0, "no workers → no push")

  const parent = tm.create("fs-push-parent")
  const w = tm.create("fs-push-worker")
  tm.update(w.id, { agent_role: "worker", parent_thread_id: parent.id } as any)
  broadcastFleetSnapshotIfWorkers(tm, broadcast)
  assert.equal(pushed.length, 1)
  const frame = pushed[0] as any
  assert.equal(frame.type, "fleet.status", "panel's existing handler consumes this frame")
  assert.ok(Array.isArray(frame.workers) && frame.workers.length === 1)
})

test("#514: spawn_worker with a dangling intent_id and NO mission board must NOT roll back", async () => {
  const tm = new ThreadManager()
  for (const t of tm.list() as any[]) if (t.agent_role === "worker") tm.delete(t.id)
  const parent = tm.create("fs-spawn-noboard")
  bindTm(tm)
  const { securityPolicy } = await import("../src/security-policy")
  const spawnParams: Record<string, any> = {
    __thread_id: parent.id,
    role_label: "researcher",
    alias: "noboard-worker",
    intent_id: "intent-made-up-1",
    goal: "做一个独立的检索子任务",
  }
  spawnParams.security_token = securityPolicy.issueTokenFor("spawn_worker", spawnParams).token
  const r: any = await executeCompanionTool(
    "spawn_worker",
    spawnParams,
    "tc-spawn-nb",
    { handshakeSurface: "tray", broadcast: () => {}, kickWorkerChat: () => {} },
  )
  // The exact实机 case: model-invented intent_id, board never initialized.
  assert.equal(r.success, true, "worker must survive a BOARD_MISSING intent claim")
  assert.equal(r.data.intent_claim.ok, false)
  assert.equal(r.data.intent_claim.error_code, "BOARD_MISSING")
  assert.equal(r.data.intent_claim.skipped, true, "skip is explicit, not silent")
  const worker = tm.get(r.data.worker_id)
  assert.ok(worker, "worker thread exists")
  assert.equal(worker?.agent_role, "worker")
})

test("#514: plain spawn_worker REQUIRES a goal (no more dead shells)", async () => {
  const tm = new ThreadManager()
  bindTm(tm)
  const parent = tm.create("fs-spawn-nogoal")
  const r: any = await executeCompanionTool(
    "spawn_worker",
    { __thread_id: parent.id, role_label: "r", security_token: "x" },
    "tc-ng",
    { handshakeSurface: "tray", broadcast: () => {}, kickWorkerChat: () => {} },
  )
  assert.equal(r.success, false)
  assert.equal(r.data.error_code, "INVALID_ARGS")
  assert.match(r.error, /requires goal/)
})

test("#514: plain spawn_worker persists a role-aware brief and kicks the worker", async () => {
  const tm = new ThreadManager()
  for (const t of tm.list() as any[]) if (t.agent_role === "worker") tm.delete(t.id)
  bindTm(tm)
  const parent = tm.create("fs-spawn-goal")
  const kicks: Array<{ threadId: string; message: string }> = []
  const { securityPolicy } = await import("../src/security-policy")
  const spawnParams: Record<string, any> = {
    __thread_id: parent.id,
    role_label: "论文检索员",
    alias: "w-goal",
    goal: "检索 latent communication 安全的 3 篇论文并给出要点",
    role_prompt: "只信原文与官方仓库，输出中文要点",
  }
  spawnParams.security_token = securityPolicy.issueTokenFor("spawn_worker", spawnParams).token
  const r: any = await executeCompanionTool("spawn_worker", spawnParams, "tc-goal", {
    handshakeSurface: "tray",
    broadcast: () => {},
    kickWorkerChat: (opts: { threadId: string; message: string }) => { kicks.push(opts) },
  })
  assert.equal(r.success, true)
  assert.equal(r.data.brief_persisted, true)
  assert.equal(r.data.kicked, true)
  // the brief IS the worker's first user message — role-aware, task-specific
  const wmsgs = tm.getMessages(r.data.worker_id) as any[]
  const briefRow = wmsgs.find((m) => m.role === "user")
  assert.ok(briefRow, "brief row persisted")
  const brief = String(briefRow.content)
  assert.match(brief, /worker「论文检索员」/, "role definition in the brief")
  assert.ok(brief.includes("检索 latent communication 安全的 3 篇论文"), "goal verbatim")
  assert.match(brief, /不要与其他 worker 互聊/, "discipline note")
  assert.match(brief, /只信原文与官方仓库/, "role_prompt carried")
  // role note also lands on the worker's system prompt (expert-team parity)
  const worker = tm.get(r.data.worker_id) as any
  assert.match(String(worker.config_override?.system_prompt_append || ""), /任务切片见第一条用户消息/)
  // kick fired with the same brief
  assert.equal(kicks.length, 1)
  assert.equal(kicks[0].threadId, r.data.worker_id)
  assert.ok(kicks[0].message.includes("检索 latent communication"))
})

test("#514 catalog lock: spawn_worker goal is required", () => {
  const src = readSrc("bridge", "tool-definitions-catalog.json")
  assert.match(src, /"name": "spawn_worker"[\s\S]{0,4000}?"required": \[\s*"goal"\s*\]/)
})
