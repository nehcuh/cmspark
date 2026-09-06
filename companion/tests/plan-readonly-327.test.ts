/**
 * #327 plan_readonly — thread-scoped execution cap.
 *
 * Differential: the deny set is DERIVED from the existing SoT (L2_GATE_TOOLS /
 * ACP family / host surface / tool universe), never hand-copied. Every
 * L2/ACP/host/MCP tool must be denied in plan mode; allowlist entries must all
 * exist in the real tool universe (typo guard).
 *
 * Red tests: pregate hard-rejects click/evaluate/mcp__* on a plan thread with
 * ZERO side effects (gate fires before lease acquire); propose is NOT an
 * exemption; workers never run wider than their master (spawn stamp +
 * gate-side parent fallback); the only write path is the user_gesture-gated
 * thread.execution_policy.set wire message (summoner may only tighten; generic
 * thread.update cannot smuggle the key).
 */
import test, { after, before, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-plan-readonly-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

type PlanReadonlyMod = typeof import("../src/tool/plan-readonly")
let plan: PlanReadonlyMod
let L2_GATE_TOOLS: readonly string[]
let runMultiAgentToolPregate: typeof import("../src/orchestrator/tool-pregate").runMultiAgentToolPregate
let spawnWorkerThread: typeof import("../src/orchestrator/spawn").spawnWorkerThread
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let handleMessage: typeof import("../src/message-router").handleMessage
let assertSummonerAllowed: typeof import("../src/ws/summoner-acl").assertSummonerAllowed
let getAuditLogPath: typeof import("../src/packs/audit-log").getAuditLogPath
let universe: Set<string>

before(async () => {
  plan = await import("../src/tool/plan-readonly")
  ;({ L2_GATE_TOOLS } = await import("../src/tool/l2-admission"))
  ;({ runMultiAgentToolPregate } = await import("../src/orchestrator/tool-pregate"))
  ;({ spawnWorkerThread } = await import("../src/orchestrator/spawn"))
  const tm = await import("../src/threads/thread-manager")
  ThreadManager = tm.ThreadManager
  const se = await import("../src/skills/skill-engine")
  SkillEngine = se.SkillEngine
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  const acl = await import("../src/ws/summoner-acl")
  assertSummonerAllowed = acl.assertSummonerAllowed
  const al = await import("../src/packs/audit-log")
  getAuditLogPath = al.getAuditLogPath
  const { initDataDir } = await import("../src/config")
  await initDataDir()

  // Tool universe = LLM-visible catalog ∪ arg schemas ∪ companion dispatch set.
  const { getAllToolDefinitions } = await import("../src/bridge/tool-definitions")
  const { TOOL_ARG_SCHEMAS } = await import("../src/bridge/tool-schemas")
  const { COMPANION_TOOLS } = await import("../src/bridge/companion-tools")
  universe = new Set<string>()
  for (const d of getAllToolDefinitions()) universe.add(d.function.name)
  for (const k of Object.keys(TOOL_ARG_SCHEMAS)) universe.add(k)
  for (const t of COMPANION_TOOLS) universe.add(t)
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Differential: deny set derived from SoT, not hand-copied
// ---------------------------------------------------------------------------

describe("#327 differential (SoT-derived deny)", () => {
  test("deny ⊇ L2_GATE_TOOLS — plan never argues its way past the L2 table", () => {
    for (const t of L2_GATE_TOOLS) {
      assert.equal(
        plan.isPlanReadonlyAllowed(t),
        false,
        `L2 tool ${t} must be denied in plan_readonly`,
      )
    }
  })

  test("deny ⊇ ACP family (all 7 acp_* companion tools)", async () => {
    const { COMPANION_TOOLS } = await import("../src/bridge/companion-tools")
    const acp = COMPANION_TOOLS.filter((t: string) => t.startsWith("acp_"))
    assert.ok(acp.length >= 7, "expected the full ACP family")
    for (const t of acp) {
      assert.equal(plan.isPlanReadonlyAllowed(t), false, `ACP tool ${t} must be denied`)
    }
  })

  test("deny ⊇ host surface (host_computer / host_app / host_cli)", () => {
    for (const t of ["host_computer", "host_app", "host_cli"]) {
      assert.equal(plan.isPlanReadonlyAllowed(t), false, `${t} must be denied`)
    }
  })

  test("MCP: mcp__* dynamic names and ALL meta tools denied — no exception (cold cache = server RPC)", () => {
    assert.equal(plan.isPlanReadonlyAllowed("mcp__github__create_issue"), false)
    assert.equal(plan.isPlanReadonlyAllowed("mcp__filesystem__read_file"), false)
    assert.equal(plan.isPlanReadonlyAllowed("mcp_read_resource"), false)
    assert.equal(plan.isPlanReadonlyAllowed("mcp_get_prompt"), false)
    // M1 round-2: mcp/client.ts getResources() falls through to
    // refreshResources() (real server RPC) when the cache is empty, so the
    // "local cache only" exception was withdrawn — plan mode must not make
    // the companion initiate an outbound round-trip.
    assert.equal(plan.isPlanReadonlyAllowed("mcp_list_resources"), false)
  })

  test("explicit rulings: analyze_image / ask_user / DOM-event family / durable-state family denied", () => {
    for (const t of [
      "analyze_image",
      "analyze_image_url",
      "ask_user",
      "scroll",
      "scroll_to",
      "hover",
      "press_key",
      "navigate",
      "create_tab",
      "set_tab_url",
      "close_tab",
      "click",
      "dblclick",
      "type",
      "fill_form",
      "select_option",
      "drag_and_drop",
      "evaluate",
      "set_cookie",
      "delete_cookie",
      "browser_download",
      "upload_file",
      "use_skill",
      "ensure_project_dir",
      "record_experience",
      "board_claim_intent",
      "board_heartbeat_intent",
      "worker_cancel",
      "collect_handback",
    ]) {
      assert.equal(plan.isPlanReadonlyAllowed(t), false, `${t} must be denied`)
    }
  })

  test("typo guard: every allowlist entry exists in the real tool universe (no exceptions)", () => {
    for (const t of plan.PLAN_READONLY_ALLOWED_TOOLS) {
      assert.ok(
        universe.has(t),
        `allowlist entry ${t} not in tool universe — typo or removed tool`,
      )
    }
  })

  test("allowlist fixtures (both directions, derived from universe membership)", () => {
    for (const t of [
      "list_tabs",
      "screenshot",
      "get_page_text",
      "get_page_html",
      "get_element_info",
      "wait_for",
      "get_cookies",
      "list_all_cookies",
      "downloads_find",
      "thread_recall",
      "search_threads",
      "search_knowledge",
      "workspace_list_dir",
      "workspace_read_file",
      "board_read",
      "list_workers",
      "get_worker_status",
      "list_tab_locks",
      "wait_workers",
      "run_progress_propose",
    ]) {
      assert.ok(universe.has(t), `fixture ${t} must be a real tool`)
      assert.equal(plan.isPlanReadonlyAllowed(t), true, `${t} must be allowed`)
    }
  })

  test("deny ⊇ extension L2 surface column (SURFACE_BY_TOOL cross-check source of truth)", () => {
    // The extension-side twin test parses plan-readonly.ts and asserts against
    // SURFACE_BY_TOOL directly; here we pin the host/L2 names that must never
    // appear on the allowlist even if the extension table grows.
    const l2ExtensionSurface = [
      "host_computer", "host_app", "host_read", "host_write", "host_cli",
      "shell_exec", "netsec_port_scan", "osascript_eval", "spawn_worker", "spawn_expert_team",
      "ask_user", "board_complete", "skill_install",
    ]
    for (const t of l2ExtensionSurface) {
      assert.equal(plan.isPlanReadonlyAllowed(t), false, `${t} (L2 surface) must be denied`)
    }
  })
})

// ---------------------------------------------------------------------------
// Pregate red tests
// ---------------------------------------------------------------------------

function fakeTM(threads: Record<string, any>) {
  return {
    get: (id: string) => threads[id],
    isToolAllowed: (_id: string, _tool: string) => true,
  } as any
}

function pregateCtx(overrides: Partial<any> = {}) {
  return {
    toolName: "click",
    finalParams: { tabId: 1 } as Record<string, any>,
    toolCallId: "tc_1",
    startedAt: Date.now(),
    actingThreadId: "t_plan",
    isOutboundMcpCall: false,
    logToolFinish: () => {},
    getThreadManager: () => fakeTM({ t_plan: { id: "t_plan", execution_policy: "plan_readonly" } }),
    hasPendingForTab: () => false,
    toolDisplayNameZh: (n: string) => n,
    ...overrides,
  }
}

describe("#327 pregate red tests", () => {
  test("plan thread: click is hard-rejected BEFORE any lease acquire (no side effect)", async () => {
    const acquireCalls: number[] = []
    const result = await runMultiAgentToolPregate(
      pregateCtx({ toolName: "click" }),
      {
        acquireOrRenewTabLease: ((a: any) => {
          acquireCalls.push(a.tabId)
          return { ok: true }
        }) as any,
      },
    )
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.result.error, /PLAN_READONLY/)
      assert.equal(result.result.data.error_code, "PLAN_READONLY_BLOCKED")
      assert.equal(result.result.data.tool_name, "click")
      assert.equal(result.result.data.thread_id, "t_plan")
    }
    assert.deepEqual(acquireCalls, [], "plan denial must fire before lease acquisition")
  })

  test("plan thread: evaluate and mcp__* rejected; reads pass through to normal gates", async () => {
    const tm = fakeTM({ t_plan: { id: "t_plan", execution_policy: "plan_readonly" } })
    for (const tool of ["evaluate", "osascript_eval", "mcp__github__create_issue", "navigate", "analyze_image", "ask_user"]) {
      const r = await runMultiAgentToolPregate(pregateCtx({ toolName: tool, getThreadManager: () => tm }))
      assert.equal(r.ok, false, `${tool} must be denied`)
      if (!r.ok) assert.equal(r.result.data.error_code, "PLAN_READONLY_BLOCKED", tool)
    }
    const read = await runMultiAgentToolPregate(
      pregateCtx({ toolName: "get_page_text", getThreadManager: () => tm }),
    )
    assert.equal(read.ok, true, "read-only observation must pass the plan gate")
  })

  test("default policy: cap inert (click proceeds)", async () => {
    const tm = fakeTM({ t_def: { id: "t_def", execution_policy: "default" } })
    const r = await runMultiAgentToolPregate(pregateCtx({ getThreadManager: () => tm }))
    assert.equal(r.ok, true)
    const none = fakeTM({ t_none: { id: "t_none" } })
    const r2 = await runMultiAgentToolPregate(pregateCtx({ actingThreadId: "t_none", getThreadManager: () => none }))
    assert.equal(r2.ok, true, "missing execution_policy field = default (legacy threads)")
  })

  test("propose is NOT an exemption: thread with seeded run_progress still denies click", async () => {
    const tm = fakeTM({
      t_plan: {
        id: "t_plan",
        execution_policy: "plan_readonly",
        run_progress: { items: [{ id: "p1", text: "调研", done: false }] },
      },
    })
    const r = await runMultiAgentToolPregate(pregateCtx({ getThreadManager: () => tm }))
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.result.data.error_code, "PLAN_READONLY_BLOCKED")
    // and run_progress_propose itself stays allowed (orthogonal display card)
    const prop = await runMultiAgentToolPregate(
      pregateCtx({ toolName: "run_progress_propose", getThreadManager: () => tm }),
    )
    assert.equal(prop.ok, true)
  })

  test("paused check wins over plan gate (existing semantics unchanged)", async () => {
    const tm = fakeTM({ t_plan: { id: "t_plan", paused: true, execution_policy: "plan_readonly" } })
    const r = await runMultiAgentToolPregate(pregateCtx({ getThreadManager: () => tm }))
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.result.error, /worker_paused/)
  })

  test("worker without own stamp falls back to parent orchestrator's CURRENT policy (mid-run arming)", async () => {
    const tm = fakeTM({
      w1: { id: "w1", agent_role: "worker", parent_thread_id: "orch1" },
      orch1: { id: "orch1", execution_policy: "plan_readonly" },
    })
    const r = await runMultiAgentToolPregate(
      pregateCtx({ actingThreadId: "w1", getThreadManager: () => tm }),
    )
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.result.data.error_code, "PLAN_READONLY_BLOCKED")

    // parent default → worker not plan-blocked (proceeds; click on a worker is
    // multi-agent so it takes the normal TAB lease path — still not our gate)
    const tm2 = fakeTM({
      w2: { id: "w2", agent_role: "worker", parent_thread_id: "orch2" },
      orch2: { id: "orch2", execution_policy: "default" },
    })
    const r2 = await runMultiAgentToolPregate(
      pregateCtx({ actingThreadId: "w2", getThreadManager: () => tm2 }),
    )
    assert.equal(r2.ok, true, "worker under default parent must not hit the plan gate")
  })

  test("worker stamped plan stays plan even when parent exits plan (只收紧方向)", async () => {
    const tm = fakeTM({
      w3: { id: "w3", agent_role: "worker", parent_thread_id: "orch3", execution_policy: "plan_readonly" },
      orch3: { id: "orch3", execution_policy: "default" },
    })
    const r = await runMultiAgentToolPregate(
      pregateCtx({ actingThreadId: "w3", getThreadManager: () => tm }),
    )
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.result.data.error_code, "PLAN_READONLY_BLOCKED")
  })

  test("outbound MCP synthetic thread skips the thread gate (has its own L8/L9 gates)", async () => {
    const tm = fakeTM({ t_plan: { id: "t_plan", execution_policy: "plan_readonly" } })
    const r = await runMultiAgentToolPregate(
      pregateCtx({ toolName: "click", isOutboundMcpCall: true, getThreadManager: () => tm }),
    )
    assert.equal(r.ok, true, "outbound surface is gated by gateOutboundCall, not the thread cap")
  })

  test("gate exception fails closed (ORCHESTRATOR_GATE_ERROR)", async () => {
    const r = await runMultiAgentToolPregate(pregateCtx(), { forceThrow: () => { throw new Error("boom") } })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.result.data.error_code, "ORCHESTRATOR_GATE_ERROR")
  })
})

// ---------------------------------------------------------------------------
// resolveEffectiveExecutionPolicy unit
// ---------------------------------------------------------------------------

describe("#327 resolveEffectiveExecutionPolicy", () => {
  test("direct policy wins; worker falls back to parent; unknown thread = default", () => {
    const get = plan.resolveEffectiveExecutionPolicy
    const threads: Record<string, any> = {
      a: { execution_policy: "plan_readonly" },
      w: { agent_role: "worker", parent_thread_id: "a" },
      plain: {},
    }
    assert.equal(get("a", (id) => threads[id]), "plan_readonly")
    assert.equal(get("w", (id) => threads[id]), "plan_readonly")
    assert.equal(get("plain", (id) => threads[id]), "default")
    assert.equal(get("missing", (id) => threads[id]), "default")
    assert.equal(get(undefined, (id) => threads[id]), "default")
  })
})

// ---------------------------------------------------------------------------
// Wire message: thread.execution_policy.set
// ---------------------------------------------------------------------------

function routerServices() {
  const tmInstance = new ThreadManager()
  return {
    tmInstance,
    services: {
      threadManager: tmInstance,
      skillEngine: new SkillEngine(),
      historyStore: { record: () => 0 } as any,
    } as any,
    session: { sendToExtension: () => {}, executeTool: async () => ({ success: true, data: {} }) } as any,
  }
}

function readAuditLines(): any[] {
  const p = getAuditLogPath()
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
}

describe("#327 thread.execution_policy.set wire message", () => {
  test("user_gesture required — no gesture, no write", async () => {
    const { services, session } = routerServices()
    const t = services.threadManager.create("t")
    const r = await handleMessage(
      { type: "thread.execution_policy.set", thread_id: t.id, policy: "plan_readonly" },
      services, session,
    )
    assert.equal(r.type, "error")
    assert.match(r.error, /user_gesture/)
    assert.equal(services.threadManager.get(t.id)?.execution_policy, undefined)
    assert.equal(
      readAuditLines().some((l) => l.type === "execution_policy.set"),
      false,
      "no policy write without gesture",
    )
  })

  test("happy path: gesture + valid policy → updated + audited", async () => {
    const { services, session } = routerServices()
    const t = services.threadManager.create("t")
    const r = await handleMessage(
      { type: "thread.execution_policy.set", thread_id: t.id, policy: "plan_readonly", user_gesture: true },
      services, session,
    )
    assert.equal(r.type, "thread.execution_policy.updated")
    assert.equal(r.thread.execution_policy, "plan_readonly")
    assert.equal(services.threadManager.get(t.id)?.execution_policy, "plan_readonly")
    const entry = readAuditLines().find((l) => l.type === "execution_policy.set")
    assert.ok(entry, "audit entry must land in capability-audit.jsonl")
    assert.equal(entry.policy, "plan_readonly")
    assert.equal(entry.from, "default")
    assert.equal(entry.thread_id, t.id)

    // exit is also a user gesture
    const back = await handleMessage(
      { type: "thread.execution_policy.set", thread_id: t.id, policy: "default", user_gesture: true },
      services, session,
    )
    assert.equal(back.type, "thread.execution_policy.updated")
    assert.equal(services.threadManager.get(t.id)?.execution_policy, "default")
  })

  test("invalid policy rejected, nothing written", async () => {
    const { services, session } = routerServices()
    const t = services.threadManager.create("t")
    const r = await handleMessage(
      { type: "thread.execution_policy.set", thread_id: t.id, policy: "yolo", user_gesture: true },
      services, session,
    )
    assert.equal(r.type, "error")
    assert.equal(services.threadManager.get(t.id)?.execution_policy, undefined)
  })

  test("worker thread refuses: set it on the orchestrator", async () => {
    const { services, session } = routerServices()
    const parent = services.threadManager.create("orch")
    const spawned = spawnWorkerThread(services.threadManager, { parentThreadId: parent.id, userConfirmed: true })
    assert.equal(spawned.ok, true)
    if (!spawned.ok) return
    const r = await handleMessage(
      { type: "thread.execution_policy.set", thread_id: spawned.worker.id, policy: "plan_readonly", user_gesture: true },
      services, session,
    )
    assert.equal(r.type, "error")
    assert.match(r.error, /inherit/)
    // worker was spawned under a default parent → unstamped (B1), set refused
    assert.equal(services.threadManager.get(spawned.worker.id)?.execution_policy, undefined)
  })

  test("generic thread.update cannot smuggle execution_policy (allowlist drops the key)", async () => {
    const { services, session } = routerServices()
    const t = services.threadManager.create("t")
    const r = await handleMessage(
      {
        type: "thread.update",
        thread_id: t.id,
        updates: { execution_policy: "plan_readonly", alias: "smuggled" },
      },
      services, session,
    )
    assert.equal(r.type, "thread.updated")
    assert.equal(r.thread.execution_policy, undefined, "thread.update must not carry execution_policy")
    assert.equal(r.thread.alias, "smuggled", "other keys still work")
  })

  test("summoner may downgrade to plan_readonly; upgrade/arm is denied", async () => {
    const central = assertSummonerAllowed("summoner", "thread.execution_policy.set")
    assert.equal(central.ok, true)

    const { applySummonerPayloadPolicy } = await import("../src/ws/summoner-acl")
    const tighten = applySummonerPayloadPolicy("summoner", {
      type: "thread.execution_policy.set",
      thread_id: "t1",
      policy: "plan_readonly",
    })
    assert.equal(tighten.ok, true)
    const loosen = applySummonerPayloadPolicy("summoner", {
      type: "thread.execution_policy.set",
      thread_id: "t1",
      policy: "default",
    })
    assert.equal(loosen.ok, false)

    const { services, session } = routerServices()
    const t = services.threadManager.create("t")
    const down = await handleMessage(
      {
        type: "thread.execution_policy.set",
        thread_id: t.id,
        policy: "plan_readonly",
        user_gesture: true,
        __cmspark_surface: "summoner",
      },
      services, session,
    )
    assert.equal(down.type, "thread.execution_policy.updated")
    assert.equal(services.threadManager.get(t.id)?.execution_policy, "plan_readonly")

    const up = await handleMessage(
      {
        type: "thread.execution_policy.set",
        thread_id: t.id,
        policy: "default",
        user_gesture: true,
        __cmspark_surface: "summoner",
      },
      services, session,
    )
    assert.equal(up.type, "error")
    assert.equal(up.error_code, "SUMMONER_ACL")
    assert.equal(services.threadManager.get(t.id)?.execution_policy, "plan_readonly")
  })
})

describe("#327 worker spawn inheritance", () => {
  test("spawn stamps ONLY when parent is plan_readonly; default parent leaves worker UNSTAMPED (live-follow)", async () => {
    const tmA = new ThreadManager()
    const planParent = tmA.create("orch")
    tmA.update(planParent.id, { execution_policy: "plan_readonly" } as any)
    const spawned = spawnWorkerThread(tmA, { parentThreadId: planParent.id, userConfirmed: true })
    assert.equal(spawned.ok, true)
    if (spawned.ok) {
      assert.equal(tmA.get(spawned.worker.id)?.execution_policy, "plan_readonly", "worker inherits plan at spawn")
    }

    // B1: a "default" parent must NOT stamp "default" — a stamped default would
    // short-circuit the gate-side parent fallback and let mid-run arming miss
    // this worker. Unstamped = follows the parent's CURRENT policy.
    const tmB = new ThreadManager()
    const defParent = tmB.create("orch")
    const spawnedB = spawnWorkerThread(tmB, { parentThreadId: defParent.id, userConfirmed: true })
    assert.equal(spawnedB.ok, true)
    if (spawnedB.ok) {
      assert.equal(
        tmB.get(spawnedB.worker.id)?.execution_policy,
        undefined,
        "default parent must leave the worker unstamped (no 'default' stamp)",
      )
    }
  })

  test("B1 red: mid-run arming — worker spawned under default parent is capped once the parent arms plan", async () => {
    const tm = new ThreadManager()
    const parent = tm.create("orch")
    const spawned = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
    assert.equal(spawned.ok, true)
    if (!spawned.ok) return
    const workerId = spawned.worker.id

    // before arming: worker not plan-capped
    assert.equal(
      plan.resolveEffectiveExecutionPolicy(workerId, (id) => tm.get(id) as any),
      "default",
    )

    // user arms plan on the orchestrator MID-RUN
    tm.update(parent.id, { execution_policy: "plan_readonly" } as any)

    // the already-spawned worker is now capped (gate-side parent fallback is
    // LIVE code for unstamped workers) — and the pregate actually denies click
    assert.equal(
      plan.resolveEffectiveExecutionPolicy(workerId, (id) => tm.get(id) as any),
      "plan_readonly",
    )
    const r = await runMultiAgentToolPregate(
      pregateCtx({
        actingThreadId: workerId,
        getThreadManager: () => tm,
      }),
    )
    assert.equal(r.ok, false, "mid-run arming must cap already-spawned workers")
    if (!r.ok) {
      assert.equal(r.result.data.error_code, "PLAN_READONLY_BLOCKED")
      assert.equal(r.result.data.thread_id, workerId)
    }

    // master exits plan → unstamped worker follows back to default (cap lifts)
    tm.update(parent.id, { execution_policy: "default" } as any)
    assert.equal(
      plan.resolveEffectiveExecutionPolicy(workerId, (id) => tm.get(id) as any),
      "default",
      "exit plan on the master lifts the cap for unstamped workers",
    )
  })

  test("B1 red: stamped-plan worker STAYS capped when the master exits plan (只收紧方向)", async () => {
    const tm = new ThreadManager()
    const parent = tm.create("orch")
    tm.update(parent.id, { execution_policy: "plan_readonly" } as any)
    const spawned = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
    assert.equal(spawned.ok, true)
    if (!spawned.ok) return
    const workerId = spawned.worker.id
    assert.equal(tm.get(workerId)?.execution_policy, "plan_readonly")

    tm.update(parent.id, { execution_policy: "default" } as any)
    assert.equal(
      plan.resolveEffectiveExecutionPolicy(workerId, (id) => tm.get(id) as any),
      "plan_readonly",
      "a worker stamped at spawn stays plan even after the master exits",
    )
  })
})
