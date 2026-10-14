/** #563 C2: real typed dependency refusals cannot manufacture a DOM pivot.
 * Authority/provider seams are isolated fixtures, never issued tokens or AI runs. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-same-tool-coded-563-"))
process.env.CMSPARK_DATA_DIR = owned
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let api: typeof import("../src/tool/companion-dispatch")
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let schema: typeof import("../src/board/schema")
let policy: typeof import("../src/security-policy").securityPolicy
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let guard: typeof import("../src/llm/same-tool-guard")
let security: typeof import("../src/security")
let chatCreate: typeof import("../src/llm/adapter").chatCreate
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
before(async () => {
  await (await import("../src/config")).initDataDir()
  api = await import("../src/tool/companion-dispatch")
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  schema = await import("../src/board/schema")
  policy = (await import("../src/security-policy")).securityPolicy
  SecurityConfirmationManager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  guard = await import("../src/llm/same-tool-guard")
  security = await import("../src/security")
  chatCreate = (await import("../src/llm/adapter")).chatCreate
  OpenAIProvider = (await import("../src/llm/providers/openai")).OpenAIProvider
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
})
after(() => fs.rmSync(owned, { recursive: true, force: true }))

function setup(blocker: string) {
  const tm = new ThreadManager(), parent = tm.create("OWNED_DEPENDENCY_" + blocker)
  const intent = (id: string, extra = {}) => schema.IntentSchema.parse({ id, description: "OWNED_INERT",
    created_at: "now", updated_at: "now", provenance: schema.stampProvenance({ actor_type: "system" }), ...extra })
  tm.update(parent.id, { mission_board: schema.MissionBoardSchema.parse({ ...schema.createEmptyMissionBoard(),
    intents: [intent(blocker), intent("target", { depends_on_intent_ids: [blocker] })] }) })
  api.bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: new SecurityConfirmationManager(), getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0 })
  return { tm, parent }
}
const marker = "DECLARED_STANDALONE_AUTH_BOUNDARY_ONLY"
async function actualRefusal(tm: InstanceType<typeof ThreadManager>, parentId: string) {
  const count = tm.list().length, board = JSON.stringify(tm.get(parentId)!.mission_board)
  let kicks = 0
  const wire = JSON.parse(JSON.stringify(await api.executeCompanionTool("spawn_worker", {
    __thread_id: parentId, goal: "OWNED_INERT", intent_id: "target", security_token: marker,
  }, undefined, { kickWorkerChat: () => { kicks++; throw new Error("REAL_WORKER_FORBIDDEN") } })))
  assert.equal(wire.success, false)
  assert.equal(wire.data.error_code, "INTENT_DEPENDENCY_BLOCKED")
  assert.equal(wire.data.intent_claim.error_code, wire.data.error_code)
  assert.equal(security.ERROR_CODE_LEVELS.get(wire.data.error_code), "recoverable")
  assert.equal(kicks, 0); assert.equal(tm.list().length, count)
  assert.equal(JSON.stringify(tm.get(parentId)!.mission_board), board)
  return wire
}

for (const blocker of ["source", "element_not_found-source"]) {
  test(`#563 actual dispatcher ${blocker} receipt stops at the same-tool boundary`, async t => {
    t.mock.method(policy, "validateTokenFor", (token: string, tool: string) => {
      assert.equal(token, marker); assert.equal(tool, "spawn_worker"); return true
    })
    t.mock.method(policy, "issueTokenFor", () => { throw new Error("TOKEN_ISSUANCE_FORBIDDEN") })
    const { tm, parent } = setup(blocker), wire = await actualRefusal(tm, parent.id)
    t.diagnostic(JSON.stringify({ blocker, actual_dispatcher_wire: wire }))
    const decision = (failCount: number, alreadyPivoted = false) => guard.decideSameToolFailure({
      failCount, threshold: 3, errorCode: wire.data.error_code, errorText: wire.error, alreadyPivoted,
    })
    assert.equal(decision(2).action, "count")
    assert.equal(decision(3).action, "stop")
    assert.equal(decision(3, true).action, "stop")
  })

  test(`#563 actual adapter consumes three ${blocker} dispatcher receipts without a DOM pivot or fourth retry`, async t => {
    t.mock.method(policy, "validateTokenFor", (token: string, tool: string) => {
      assert.equal(token, marker); assert.equal(tool, "spawn_worker"); return true
    })
    t.mock.method(policy, "issueTokenFor", () => { throw new Error("TOKEN_ISSUANCE_FORBIDDEN") })
    const { tm, parent } = setup(blocker), sent: any[] = [], systemTexts: string[] = []
    let streams = 0, dispatches = 0
    // No provider requests: replay finite canonical tool-call records only.
    t.mock.method(OpenAIProvider.prototype, "streamChat", (params: import("../src/llm/provider").StreamChatParams) => {
      for (const m of params.messages) if (m.role === "system" && typeof m.content === "string") systemTexts.push(m.content)
      const index = streams++
      return (async function* () {
        if (index < 5) {
          yield { type: "tool_call_delta" as const, index: 0, id: "owned-" + index,
            name: index === 0 ? "run_progress_propose" : "spawn_worker",
            arguments: JSON.stringify(index === 0 ? { items: [{ text: "OWNED_INERT" }] } : { goal: "OWNED_INERT", intent_id: "target" }) }
          yield { type: "done" as const, finish_reason: "tool_calls" as const }
        } else {
          yield { type: "token" as const, text: "OWNED_DONE" }
          yield { type: "done" as const, finish_reason: "stop" as const }
        }
      })()
    })
    await chatCreate({ threadId: parent.id, message: "OWNED_INERT", skillIds: [],
      config: { base_url: "http://127.0.0.1:1", api_key: "DECLARED_NONCREDENTIAL_PROVIDER_FIXTURE",
        model_name: "owned-inert", temperature: 0, context_window: 8000 },
      threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any,
      sendToExtension: message => { sent.push(message) },
      executeTool: async (_id, name) => {
        if (name === "spawn_worker") { dispatches++; return actualRefusal(tm, parent.id) }
        assert.equal(name, "run_progress_propose"); return { success: true, data: { ok: true } }
      },
    })
    t.diagnostic(JSON.stringify({ blocker, dispatches, streams,
      trusted_locator_pivot: systemTexts.some(text => text.includes(guard.LOCATOR_PIVOT_INSTRUCTION)) }))
    assert.equal(dispatches, 3, "the original three-failure circuit breaker remains effective")
    assert.equal(streams, 4, "proposal plus three failures, no post-threshold provider turn")
    assert.equal(systemTexts.some(text => text.includes(guard.LOCATOR_PIVOT_INSTRUCTION)), false)
    const errors = sent.filter(m => m.type === "chat.error")
    assert.equal(errors.length, 1); assert.match(errors[0].error, /spawn_worker.*3/)
    assert.equal(tm.list().some(thread => thread.parent_thread_id === parent.id), false)
  })
}

test("#563 registered safety code cannot pivot through locator diagnostic text", () => {
  assert.equal(security.ERROR_CODE_LEVELS.has("DESKTOP_DENIED"), true)
  assert.equal(guard.isLocatorMiss("DESKTOP_DENIED", "element_not_found"), false)
})
test("#563 genuine finite locator codes retain their first-pivot behavior", () => {
  for (const code of ["ELEMENT_NOT_FOUND", "ELEMENT_AMBIGUOUS", "SELECTOR_OR_TEXT_REQUIRED", "INVALID_SELECTOR"]) {
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code,
      errorText: "OWNED_NONLOCATOR_DIAGNOSTIC", alreadyPivoted: false }).action, "pivot")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code,
      alreadyPivoted: true }).action, "stop")
  }
})
test("#563 unknown and absent codes retain legacy locator text fallback", () => {
  const unknown = "OWNED_FUTURE_CODE_NOT_REGISTERED"
  assert.equal(security.ERROR_CODE_LEVELS.has(unknown), false)
  for (const code of [undefined, unknown]) {
    assert.equal(guard.isLocatorMiss(code, "no visible element matching text"), true)
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code,
      errorText: "element_not_found", alreadyPivoted: false }).action, "pivot")
    assert.equal(guard.decideSameToolFailure({ failCount: 2, threshold: 3, errorCode: code,
      errorText: "element_not_found", alreadyPivoted: false }).action, "count")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: code,
      errorText: "element_not_found", alreadyPivoted: true }).action, "stop")
  }
})
