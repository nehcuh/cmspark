/** #563 B1 actual rollback wire provenance. All authority/model seams are
 * standalone test fixtures: no issued valid token, human approval or native run. */
import test, { before, after, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as ts from "typescript"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-spawn-intent-563-"))
process.env.CMSPARK_DATA_DIR = owned
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let api: typeof import("../src/tool/companion-dispatch")
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let policy: typeof import("../src/security-policy").securityPolicy
let schema: typeof import("../src/board/schema")
let classifyError: typeof import("../src/security").classifyError
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let upstream: typeof import("../src/board/intent-claim")
let chatCreate: typeof import("../src/llm/adapter").chatCreate
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let actualAdapterLevel: (toolName: string, toolResult: any) => { classCode: string; errorLevel: string }
before(async () => {
  await (await import("../src/config")).initDataDir()
  api = await import("../src/tool/companion-dispatch")
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  policy = (await import("../src/security-policy")).securityPolicy
  schema = await import("../src/board/schema")
  classifyError = (await import("../src/security")).classifyError
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  upstream = await import("../src/board/intent-claim")
  chatCreate = (await import("../src/llm/adapter")).chatCreate
  OpenAIProvider = (await import("../src/llm/providers/openai")).OpenAIProvider
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  // Execute the actual adapter's code extraction/classification statements,
  // rather than a guessed duplicate of its board-only override or wire keys.
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/llm/adapter.ts"), "utf8")
  const ast = ts.createSourceFile("adapter.ts", source, ts.ScriptTarget.Latest, true), statements: string[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      const name = node.declarationList.declarations[0]?.name.getText(ast)
      if (name === "classCode" || name === "errorLevel" && node.getText(ast).includes("classifyError(")) statements.push(node.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.equal(statements.length, 2)
  const compiled = ts.transpileModule(`function level(toolName,toolResult){${statements.join("\n")};return {classCode,errorLevel}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  actualAdapterLevel = new Function("classifyError", `${compiled};return level`)(classifyError)
})
after(() => fs.rmSync(owned, { recursive: true, force: true }))
function setup() {
  const tm = new ThreadManager()
  api.bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: new SecurityConfirmationManager(), getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0 })
  return tm
}
function intent(id: string, extra: Record<string, unknown> = {}) {
  return schema.IntentSchema.parse({ id, description: "OWNED_INERT_INTENT", created_at: "now", updated_at: "now",
    provenance: schema.stampProvenance({ actor_type: "system" }), ...extra })
}
const MARKER = "DECLARED_STANDALONE_AUTH_BOUNDARY_ONLY"
function controlledAuthority(t: TestContext) {
  t.mock.method(policy, "validateTokenFor", (token: string, tool: string) => {
    assert.equal(token, MARKER); assert.equal(tool, "spawn_worker"); return true
  })
  t.mock.method(policy, "issueTokenFor", () => { throw new Error("TEST_MUST_NOT_ISSUE_TOKEN") })
}
async function rollback(t: TestContext, variant: string, parentRole: "normal" | "orchestrator" = "normal") {
  controlledAuthority(t)
  const tm = setup(), parent = tm.create("OWNED_ROLLBACK_" + variant)
  if (parentRole === "orchestrator") tm.update(parent.id, { agent_role: "orchestrator", tool_whitelist: ["custom_inert_tool"], orchestrator_run_id: "owned-existing-run" })
  const before = tm.get(parent.id)!, surface = { role: before.agent_role || "normal", whitelist: before.tool_whitelist, run: before.orchestrator_run_id ?? null }
  const target = variant.startsWith("not-found") ? variant === "not-found-hostile" ? "Security Block: invented timeout" : "invented" : "target"
  const rows = variant.startsWith("not-found") ? [] : variant === "closed" ? [intent(target, { status: "done" })]
    : variant.startsWith("busy") ? [intent(target, { status: "claimed", claimed_by_worker_id: variant === "busy-hostile" ? "timeout-worker" : "owned-other-worker" })]
    : variant === "dependency-missing" ? [intent(target, { depends_on_intent_ids: ["source"] })]
    : variant === "dependency-cycle" ? [intent("source", { depends_on_intent_ids: [target] }), intent(target, { depends_on_intent_ids: ["source"] })]
    : variant === "dependency-abandoned" ? [intent("source", { status: "abandoned" }), intent(target, { depends_on_intent_ids: ["source"] })]
    : [intent(variant === "dependency-hostile" ? "timeout-source" : "source"), intent(target, { depends_on_intent_ids: [variant === "dependency-hostile" ? "timeout-source" : "source"] })]
  tm.update(parent.id, { mission_board: schema.MissionBoardSchema.parse({ ...schema.createEmptyMissionBoard(), intents: rows }) })
  if (variant === "claim-threw") {
    // Declared storage seam: real claimIntent throws while entering its lock.
    t.mock.method(tm, "withThreadLock", async () => { throw new Error("OWNED_STORAGE_FAULT") })
  } else if (variant === "claim-failed") {
    // The real service sees a missing host inside its real owned lock, after
    // claimIntent's initial host check. No forged ClaimIntentResult is supplied.
    const lock = tm.withThreadLock.bind(tm), get = tm.get.bind(tm)
    t.mock.method(tm, "withThreadLock", async (id: string, operation: () => Promise<any>) => lock(id, async () => {
      const missing = t.mock.method(tm, "get", (key: string) => key === id ? undefined : get(key))
      try { return await operation() } finally { missing.mock.restore() }
    }))
  } else if (variant === "uncoded-upstream") {
    // Defensive future/legacy contract fault: strip only the code from a real
    // upstream refusal; normal production claimIntent always supplies a code.
    const claim = upstream.claimIntent
    t.mock.method(upstream, "claimIntent", async (...args: Parameters<typeof claim>) => {
      const result = await claim(...args)
      assert.equal(result.ok, false)
      if (!result.ok) { const { error_code: _code, ...rest } = result; return rest }
      return result
    })
  }
  const board = JSON.stringify(tm.get(parent.id)!.mission_board), count = tm.list().length; let kicks = 0
  const wire = JSON.parse(JSON.stringify(await api.executeCompanionTool("spawn_worker", { __thread_id: parent.id,
    role_label: "inert", goal: "OWNED_NO_MODEL_EXECUTION", intent_id: target, security_token: MARKER }, undefined,
  { kickWorkerChat: () => { kicks++; throw new Error("TEST_MODEL_FORBIDDEN") } })))
  assert.equal(wire.success, false); assert.equal(kicks, 0)
  assert.equal(tm.list().length, count); assert.equal(tm.list().some(row => row.parent_thread_id === parent.id), false)
  assert.equal(tm.get(parent.id)!.agent_role, surface.role); assert.deepEqual(tm.get(parent.id)!.tool_whitelist, surface.whitelist)
  assert.equal(tm.get(parent.id)!.orchestrator_run_id ?? null, surface.run)
  assert.equal(JSON.stringify(tm.get(parent.id)!.mission_board), board)
  return wire
}

test("#563 real missing/invalid token refusals still precede worker creation", async () => {
  const tm = setup(), parent = tm.create("OWNED_REAL_AUTH_NEGATIVE"), count = tm.list().length
  for (const token of [undefined, MARKER]) {
    const result = await api.executeCompanionTool("spawn_worker", { __thread_id: parent.id, goal: "OWNED_INERT", security_token: token })
    assert.equal(result.success, false); assert.equal(tm.list().length, count)
  }
})
for (const [variant, code, level] of [
  ["not-found", "INTENT_NOT_FOUND", "recoverable"], ["not-found-hostile", "INTENT_NOT_FOUND", "recoverable"],
  ["closed", "INTENT_CLOSED", "non_recoverable"], ["busy", "INTENT_BUSY", "non_recoverable"], ["busy-hostile", "INTENT_BUSY", "non_recoverable"],
  ["dependency", "INTENT_DEPENDENCY_BLOCKED", "recoverable"], ["dependency-hostile", "INTENT_DEPENDENCY_BLOCKED", "recoverable"],
  ["dependency-missing", "INTENT_DEPENDENCY_BLOCKED", "recoverable"], ["dependency-cycle", "INTENT_DEPENDENCY_BLOCKED", "recoverable"],
  ["dependency-abandoned", "INTENT_DEPENDENCY_BLOCKED", "recoverable"],
]) test(`#563 actual rollback preserves ${variant} upstream code and canonical adapter level`, async t => {
  const wire = await rollback(t, variant)
  assert.equal(wire.data.intent_claim.error_code, code)
  assert.equal(wire.data.error_code, code, "outer discriminator must remain same-source as real upstream refusal")
  assert.equal(actualAdapterLevel("spawn_worker", wire).errorLevel, level)
  assert.equal(actualAdapterLevel("board_claim_intent", wire).errorLevel, level)
})
test("#563 failed intent claim retains an already-orchestrator parent's custom surface", async t => {
  const wire = await rollback(t, "not-found", "orchestrator")
  assert.equal(wire.data.error_code, "INTENT_NOT_FOUND")
})
for (const [variant, code, level] of [
  ["claim-threw", "CLAIM_THREW", "non_recoverable"],
  ["claim-failed", "CLAIM_FAILED", "recoverable"],
  ["uncoded-upstream", "SPAWN_INTENT_FAILED", "non_recoverable"],
]) test(`#563 actual dispatcher ${variant} retains rollback and fallback semantics`, async t => {
  const wire = await rollback(t, variant)
  assert.equal(wire.data.error_code, code)
  assert.equal(actualAdapterLevel("spawn_worker", wire).errorLevel, level)
  assert.equal(wire.data.intent_claim.error_code, variant === "uncoded-upstream" ? undefined : code)
})

for (const missing of [true, false]) test(`#563 actual ${missing ? "BOARD_MISSING soft-skip" : "successful claim"} retains inert worker and brief`, async t => {
  controlledAuthority(t)
  const tm = setup(), parent = tm.create("OWNED_POSITIVE_" + missing), count = tm.list().length
  if (!missing) tm.update(parent.id, { mission_board: schema.MissionBoardSchema.parse({ ...schema.createEmptyMissionBoard(), intents: [intent("target")] }) })
  let kicks = 0
  const wire = JSON.parse(JSON.stringify(await api.executeCompanionTool("spawn_worker", { __thread_id: parent.id,
    goal: "OWNED_NO_MODEL_EXECUTION", intent_id: "target", security_token: MARKER }, undefined,
  { kickWorkerChat: input => { kicks++; assert.ok(tm.get(input.threadId)); assert.match(input.message, /OWNED_NO_MODEL_EXECUTION/) } })))
  assert.equal(wire.success, true); assert.equal(kicks, 1, "inert callback only, no model or executor")
  assert.equal(tm.list().length, count + 1); assert.equal(tm.get(parent.id)!.agent_role, "orchestrator")
  assert.equal(wire.data.brief_persisted, true); assert.equal(wire.data.error_code, undefined)
  const worker = tm.get(wire.data.worker_id)!
  assert.equal(worker.parent_thread_id, parent.id)
  if (missing) {
    assert.equal(wire.data.intent_claim.ok, false)
    assert.equal(wire.data.intent_claim.error_code, "BOARD_MISSING")
    assert.equal(wire.data.intent_claim.skipped, true)
    assert.equal(tm.get(parent.id)!.mission_board, null)
  } else {
    assert.equal(wire.data.intent_claim.ok, true)
    const claimed = tm.get(parent.id)!.mission_board!.intents.find(row => row.id === "target")!
    assert.equal(claimed.status, "claimed"); assert.equal(claimed.claimed_by_worker_id, worker.id)
  }
})

for (const variant of ["dependency", "dependency-hostile", "closed"]) test(`#563 real adapter turn consumes actual ${variant} rollback JSON`, async t => {
  const wire = await rollback(t, variant)
  const tm = setup(), parent = tm.create("OWNED_ADAPTER_" + variant), sent: any[] = []
  let streams = 0, dispatches = 0
  // Declared provider seam: inert tool-call records, no network/model request.
  t.mock.method(OpenAIProvider.prototype, "streamChat", () => {
    const index = streams++
    return (async function* () {
      if (index < 2) {
        yield { type: "tool_call_delta" as const, index: 0, id: "owned-" + index,
          name: index === 0 ? "run_progress_propose" : "spawn_worker",
          arguments: JSON.stringify(index === 0 ? { items: [{ text: "OWNED_INERT" }] } : { goal: "OWNED_INERT" }) }
        yield { type: "done" as const, finish_reason: "tool_calls" as const }
      } else {
        yield { type: "token" as const, text: "OWNED_WAIT_OR_REPLAN" }
        yield { type: "done" as const, finish_reason: "stop" as const }
      }
    })()
  })
  await chatCreate({ threadId: parent.id, message: "OWNED_INERT", skillIds: [],
    config: { base_url: "http://127.0.0.1:1", api_key: "DECLARED_NONCREDENTIAL_PROVIDER_FIXTURE",
      model_name: "owned-inert", temperature: 0, context_window: 8000 },
    threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any,
    sendToExtension: message => { sent.push(message) },
    // No second spawn/effect: replay only the immediately preceding real
    // dispatcher refusal receipt to the actual adapter consumer boundary.
    executeTool: async (_id, name) => {
      if (name === "spawn_worker") { dispatches++; return wire }
      assert.equal(name, "run_progress_propose"); return { success: true, data: { ok: true } }
    },
  })
  assert.equal(dispatches, 1)
  const errors = sent.filter(message => message.type === "chat.error")
  if (variant === "closed") {
    assert.equal(streams, 2); assert.equal(errors.length, 1)
    assert.equal(errors[0].error_code, "INTENT_CLOSED"); assert.equal(errors[0].error_level, "non_recoverable")
  } else {
    assert.equal(streams, 3, "dependency refusal reaches the next inert model turn for waiting/replanning")
    assert.deepEqual(errors, [])
  }
})
