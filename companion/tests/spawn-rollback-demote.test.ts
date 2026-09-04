/**
 * #292: spawn_worker failure must not leave the parent demoted. A normal
 * parent keeps its full tool surface (agent_role normal, tool_whitelist
 * null → navigate/click still available) when the spawn fails (invalid
 * pack / unclaimable intent / max workers reached), and an already-
 * orchestrator parent's whitelist is never rewritten by a failed spawn.
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-292-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let securityPolicy: typeof import("../src/security-policy").securityPolicy
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let spawnWorkerThread: typeof import("../src/orchestrator/spawn").spawnWorkerThread
let ORCHESTRATOR_CAPS: typeof import("../src/orchestrator/constants").ORCHESTRATOR_CAPS
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
  securityPolicy = (await import("../src/security-policy")).securityPolicy
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  spawnWorkerThread = (await import("../src/orchestrator/spawn")).spawnWorkerThread
  ORCHESTRATOR_CAPS = (await import("../src/orchestrator/constants")).ORCHESTRATOR_CAPS
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function bindTm(tm: InstanceType<typeof ThreadManager>, skillEngine: any = null) {
  const mgr = new SecurityConfirmationManager(60_000)
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => skillEngine as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: mgr,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

function mintedSpawnParams(parentId: string, extra: Record<string, any>) {
  const params: Record<string, any> = { __thread_id: parentId, role_label: "researcher", ...extra }
  const { token } = securityPolicy.issueTokenFor("spawn_worker", params)
  params.security_token = token
  return params
}

test("#292 pack apply failure restores the parent's pre-spawn surface", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("host-292-pack")
  bindTm(tm, null) // skillEngine null → pack apply fails → SPAWN_PACK_FAILED

  const r = await executeCompanionTool("spawn_worker", mintedSpawnParams(parent.id, { pack_id: "nonexistent-pack-292" }))
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "SPAWN_PACK_FAILED")

  const p = tm.get(parent.id) as any
  assert.equal(p?.agent_role, "normal", "parent demoted back to normal")
  assert.equal(p?.tool_whitelist, null, "whitelist restored to null — navigate/click still available")
  assert.ok(!p?.orchestrator_run_id, "run id cleared")
})

test("#292 intent claim failure restores the parent's pre-spawn surface", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("host-292-intent")
  bindTm(tm, null) // fresh host has no mission_board → claim fails

  const r = await executeCompanionTool("spawn_worker", mintedSpawnParams(parent.id, { intent_id: "intent-nope-292" }))
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "SPAWN_INTENT_FAILED")

  const p = tm.get(parent.id) as any
  assert.equal(p?.agent_role, "normal")
  assert.equal(p?.tool_whitelist, null)
  assert.ok(!p?.orchestrator_run_id)
})

test("#292 max-workers failure never narrows the parent (validation precedes promotion)", () => {
  const store = new Map<string, any>()
  let seq = 0
  const tm = {
    get: (id: string) => store.get(id) || null,
    list: () => [...store.values()],
    create: (alias?: string) => {
      const id = `t${++seq}`
      store.set(id, { id, alias: alias || id, tool_whitelist: null, agent_role: "normal", config_override: {} })
      return store.get(id)
    },
    update: (id: string, patch: any) => {
      const cur = store.get(id)
      if (!cur) return null
      const next = { ...cur, ...patch }
      if (patch.config_override) next.config_override = { ...(cur.config_override || {}), ...patch.config_override }
      store.set(id, next)
      return next
    },
  }
  const parent = tm.create("p-292-max")
  // Normal parent with a prior run id already at the worker cap (models a
  // thread that spawned before and was rolled back to normal).
  tm.update(parent.id, { orchestrator_run_id: "run-292" })
  for (let i = 0; i < ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run; i++) {
    store.set(`w292-${i}`, { id: `w292-${i}`, agent_role: "worker", orchestrator_run_id: "run-292" })
  }

  const r = spawnWorkerThread(tm as any, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /max_workers/)

  const p = tm.get(parent.id) as any
  assert.equal(p.agent_role, "normal", "failed spawn must not promote the parent")
  assert.equal(p.tool_whitelist, null, "failed spawn must not collapse the tool surface")
})

test("#292 already-orchestrator parent: failed spawn does not rewrite its whitelist", () => {
  const store = new Map<string, any>()
  let seq = 0
  const tm = {
    get: (id: string) => store.get(id) || null,
    list: () => [...store.values()],
    create: (alias?: string) => {
      const id = `t${++seq}`
      store.set(id, { id, alias: alias || id, tool_whitelist: null, agent_role: "normal", config_override: {} })
      return store.get(id)
    },
    update: (id: string, patch: any) => {
      const cur = store.get(id)
      if (!cur) return null
      const next = { ...cur, ...patch }
      store.set(id, next)
      return next
    },
  }
  const parent = tm.create("p-292-orch")
  tm.update(parent.id, {
    agent_role: "orchestrator",
    tool_whitelist: ["my_custom_tool"],
    orchestrator_run_id: "run-292-orch",
  })
  for (let i = 0; i < ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run; i++) {
    store.set(`wo292-${i}`, { id: `wo292-${i}`, agent_role: "worker", orchestrator_run_id: "run-292-orch" })
  }

  const r = spawnWorkerThread(tm as any, { parentThreadId: parent.id, userConfirmed: true })
  assert.equal(r.ok, false)

  const p = tm.get(parent.id) as any
  assert.deepEqual(p.tool_whitelist, ["my_custom_tool"], "orchestrator whitelist untouched")
  assert.equal(p.agent_role, "orchestrator")
})

test("#292 already-orchestrator parent: pack-failure rollback keeps its whitelist (dispatch)", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("host-292-orch")
  tm.update(parent.id, {
    agent_role: "orchestrator" as any,
    tool_whitelist: ["my_custom_tool"],
    orchestrator_run_id: "run-292-x",
  } as any)
  bindTm(tm, null)

  const r = await executeCompanionTool("spawn_worker", mintedSpawnParams(parent.id, { pack_id: "nonexistent-pack-292b" }))
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "SPAWN_PACK_FAILED")

  const p = tm.get(parent.id) as any
  assert.equal(p?.agent_role, "orchestrator")
  assert.deepEqual(p?.tool_whitelist, ["my_custom_tool"], "custom orchestrator whitelist untouched by rollback")
  assert.equal(p?.orchestrator_run_id, "run-292-x")
})
