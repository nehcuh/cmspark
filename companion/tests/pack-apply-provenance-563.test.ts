/** #563 B2: two real composition-only apply failures preserve finite typed codes.
 * Test authority is an isolated validator seam, never an issued valid token. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pack-provenance-563-"))
process.env.CMSPARK_DATA_DIR = owned
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let config: typeof import("../src/config")
let pack: typeof import("../src/packs/pack-engine")
let dispatch: typeof import("../src/tool/companion-dispatch")
let security: typeof import("../src/security")
let guard: typeof import("../src/llm/same-tool-guard")
let policy: typeof import("../src/security-policy").securityPolicy
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
before(async () => {
  config = await import("../src/config"); await config.initDataDir()
  pack = await import("../src/packs/pack-engine")
  dispatch = await import("../src/tool/companion-dispatch")
  security = await import("../src/security")
  guard = await import("../src/llm/same-tool-guard")
  policy = (await import("../src/security-policy")).securityPolicy
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
})
after(() => fs.rmSync(owned, { recursive: true, force: true }))
const marker = "DECLARED_STANDALONE_AUTH_BOUNDARY_ONLY"
function fixture(id: string, channel: string, requires: string, disabled = false) {
  const dir = path.join(config.getConfigDir(), "packs/installed", id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "pack.yaml"), `schema_version: 1
id: ${id}
name: Owned
version: 0.1.0
channel: ${channel}
kind: expert
min_capability: L1
requires_modules: [${requires}]
disabled: ${disabled}
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [list_tabs]
  deny: []
system_prompt_append: OWNED
`)
}
function setup() {
  const tm = new ThreadManager(), parent = tm.create("OWNED_PACK_HOST"), se = new SkillEngine()
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => se,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: new SecurityConfirmationManager(), getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0 })
  return { tm, parent, se }
}
function params(tool: string, parentId: string, packId: string, token?: string) {
  return { __thread_id: parentId, goal: "OWNED_INERT", security_token: token,
    ...(tool === "spawn_worker" ? { pack_id: packId } : { members: [{ pack_id: packId, brief: "OWNED_INERT" }] }) }
}
for (const tool of ["spawn_worker", "spawn_expert_team"]) {
  for (const [variant, channel, requires, upstreamCode, code, level] of [
    ["module", "community", "appsec", "module_disabled", "PACK_MODULE_DISABLED", "recoverable"],
    ["enterprise", "enterprise", "", "enterprise_profile_required", "PACK_ENTERPRISE_PROFILE_REQUIRED", "non_recoverable"],
    ["unknown", "community", "owned-unknown-module", "apply_blocked", "SPAWN_PACK_FAILED", "non_recoverable"],
    ["unknown-text", "community", "element_not_found-timeout-module", "apply_blocked", "SPAWN_PACK_FAILED", "recoverable"],
  ]) test(`#563 ${tool} real ${variant} apply refusal has finite provenance and complete rollback`, async t => {
    const id = "owned-b2-" + tool.replaceAll("_", "-") + "-" + variant
    fixture(id, channel, requires)
    t.mock.method(policy, "validateTokenFor", (token: string, name: string) => {
      assert.equal(token, marker); assert.equal(name, tool); return true
    })
    t.mock.method(policy, "issueTokenFor", () => { throw new Error("TOKEN_ISSUANCE_FORBIDDEN") })
    const { tm, parent, se } = setup(), configBefore = JSON.stringify(config.getConfig())
    const original = JSON.stringify(tm.get(parent.id)), count = tm.list().length
    const ar = pack.applyPack(id, parent.id, tm, se, { allowTrust: false })
    assert.equal(ar.ok, false)
    if (ar.ok) throw new Error("expected real refusal")
    assert.equal(ar.code, upstreamCode)
    assert.equal(security.classifyError(ar.error, { error_code: ar.code }), level)
    let kicks = 0
    const wire = JSON.parse(JSON.stringify(await dispatch.executeCompanionTool(tool, params(tool, parent.id, id, marker),
      undefined, { kickWorkerChat: () => { kicks++; throw new Error("WORKER_EXECUTION_FORBIDDEN") } })))
    t.diagnostic(JSON.stringify({ tool, upstream: ar, wire }))
    assert.equal(wire.success, false)
    assert.equal(wire.data.error_code, code)
    assert.equal(security.classifyError(wire.error, { error_code: wire.data.error_code }), level)
    assert.equal(kicks, 0); assert.equal(tm.list().length, count)
    assert.equal(tm.list().some(row => row.parent_thread_id === parent.id), false)
    const after = tm.get(parent.id)!
    const before = JSON.parse(original)
    assert.equal(after.agent_role || "normal", before.agent_role || "normal")
    assert.deepEqual(after.tool_whitelist, before.tool_whitelist)
    assert.equal(after.board_mode ?? false, before.board_mode ?? false)
    assert.equal(after.mission_pack_id, before.mission_pack_id)
    assert.equal(JSON.stringify(config.getConfig()), configBefore)
    assert.ok(wire.error.includes(ar.error), "diagnostic metadata is retained intact")
    if (variant === "module" || variant === "enterprise") {
      assert.equal(security.ERROR_CODE_LEVELS.get(code), level)
      if (tool === "spawn_worker") assert.equal(wire.data.pack_apply.error_code, code)
      assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3,
        errorCode: wire.data.error_code, errorText: wire.error, alreadyPivoted: false }).action, "stop")
      // Explicit consumer diagnostic-contamination control, not a fake upstream receipt.
      assert.equal(guard.isLocatorMiss(code, "element_not_found"), false)
    } else {
      assert.equal(security.ERROR_CODE_LEVELS.has("apply_blocked"), false)
      if (tool === "spawn_worker") assert.equal(wire.data.pack_apply.error_code, undefined)
      assert.equal(guard.isLocatorMiss(wire.data.error_code, wire.error), variant === "unknown-text")
    }
  })
  test(`#563 ${tool} real missing/invalid authority refuses before any pack apply effect`, async () => {
    const id = "owned-b2-auth-" + tool.replaceAll("_", "-"); fixture(id, "community", "")
    const { tm, parent } = setup(), count = tm.list().length
    for (const token of [undefined, marker]) {
      const wire = await dispatch.executeCompanionTool(tool, params(tool, parent.id, id, token))
      assert.equal(wire.success, false); assert.equal(tm.list().length, count)
    }
  })
  test(`#563 ${tool} real allowed composition still creates one inert worker without Trust`, async t => {
    const id = "owned-b2-positive-" + tool.replaceAll("_", "-"); fixture(id, "community", "")
    t.mock.method(policy, "validateTokenFor", (token: string, name: string) => {
      assert.equal(token, marker); assert.equal(name, tool); return true
    })
    t.mock.method(policy, "issueTokenFor", () => { throw new Error("TOKEN_ISSUANCE_FORBIDDEN") })
    const { tm, parent } = setup(), count = tm.list().length, configBefore = JSON.stringify(config.getConfig())
    let kicks = 0
    const wire = await dispatch.executeCompanionTool(tool, params(tool, parent.id, id, marker), undefined,
      { kickWorkerChat: () => { kicks++ } })
    assert.equal(wire.success, true); assert.equal(kicks, 1)
    assert.equal(tm.list().length, count + 1); assert.equal(JSON.stringify(config.getConfig()), configBefore)
  })
}
