/**
 * P2 deep-diagnosis batch: lockstep catalog, llm.oneshot wire, spawn rollback.
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-p2-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let validateWsMessage: typeof import("../src/ws/validate").validateWsMessage
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool
let securityPolicy: typeof import("../src/security-policy").securityPolicy
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let handleLlmOneshot: typeof import("../src/llm/oneshot-handler").handleLlmOneshot
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
  securityPolicy = (await import("../src/security-policy")).securityPolicy
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  handleLlmOneshot = (await import("../src/llm/oneshot-handler")).handleLlmOneshot
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// --- wire validation ---

test("P2: validateWsMessage accepts llm.oneshot with user_content", () => {
  const r = validateWsMessage({
    type: "llm.oneshot",
    id: "req-1",
    user_content: "hello",
    system_prompt: "sys",
  })
  assert.equal(r.valid, true)
})

test("P2: validateWsMessage rejects llm.oneshot without user_content", () => {
  const r = validateWsMessage({ type: "llm.oneshot", id: "x" })
  assert.equal(r.valid, false)
  assert.match(String((r as any).error || ""), /user_content/)
})

test("P2: handleLlmOneshot rejects empty user_content", async () => {
  const r = await handleLlmOneshot({ id: "n1", user_content: "   " })
  assert.equal(r.type, "llm.oneshot_result")
  assert.equal(r.ok, false)
  assert.match(String(r.error || ""), /user_content/)
})

test("P2: isMaskedApiKey rejects masked placeholders used by oneshot gate", async () => {
  const { isMaskedApiKey } = await import("../src/config")
  assert.equal(isMaskedApiKey("sk-ab****xyz1"), true)
  assert.equal(isMaskedApiKey("***"), true)
  assert.equal(isMaskedApiKey("sk-real-not-masked-key"), false)
})

// --- spawn transactional rollback ---

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

test("P2: spawn_worker pack_id apply failure rolls back worker (SPAWN_PACK_FAILED)", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("host-p2-pack")
  bindTm(tm, null) // skillEngine null → pack apply fails → rollback

  const params: Record<string, any> = {
    __thread_id: parent.id,
    role_label: "researcher",
    pack_id: "nonexistent-pack-xyz",
  }
  const { token } = securityPolicy.issueTokenFor("spawn_worker", params)
  params.security_token = token

  const beforeIds = new Set(tm.list().map((t) => t.id))
  const r = await executeCompanionTool("spawn_worker", params)
  assert.equal(r.success, false)
  assert.match(String(r.error || ""), /rolled back|pack apply failed/i)
  assert.equal(r.data?.error_code, "SPAWN_PACK_FAILED")

  const afterIds = tm.list().map((t) => t.id)
  // no new worker threads left behind
  for (const id of afterIds) {
    if (!beforeIds.has(id)) {
      const th = tm.get(id)
      assert.notEqual(th?.agent_role, "worker", `orphan worker ${id} must be deleted`)
    }
  }
  // only parent should remain among known
  assert.ok(tm.get(parent.id), "parent host thread preserved")
})

test("P2: spawn_worker without pack_id still creates worker when token ok", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("host-p2-ok")
  bindTm(tm, null)

  const params: Record<string, any> = {
    __thread_id: parent.id,
    role_label: "helper",
  }
  const { token } = securityPolicy.issueTokenFor("spawn_worker", params)
  params.security_token = token

  const r = await executeCompanionTool("spawn_worker", params)
  assert.equal(r.success, true, r.error || "spawn ok")
  assert.ok(r.data?.worker_id)
  assert.ok(tm.get(r.data.worker_id), "worker exists")
})

test("P2: COMPANION_TOOLS isCompanionTool surface", async () => {
  const { isCompanionTool, COMPANION_TOOLS } = await import("../src/bridge/companion-tools")
  assert.ok(COMPANION_TOOLS.includes("spawn_worker"))
  assert.equal(isCompanionTool("shell_exec"), true)
  assert.equal(isCompanionTool("list_tabs"), false)
})
