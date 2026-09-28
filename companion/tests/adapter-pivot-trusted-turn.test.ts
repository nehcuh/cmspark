/**
 * #544 (P0): same-tool-guard 的 pivot 指令必须投递在 <untrusted-N> 块**之外**。
 *
 * b5a7396a 把 LOCATOR_PIVOT_INSTRUCTION 拼进 toolResult.error / data.pivot_zh，
 * 随后整个 toolResult 被 wrapUntrusted() 包成 <untrusted-N source="tool">。
 * 而系统提示词 rule 11 与 SECURITY FOOTER 都明令禁止模型遵循 untrusted 块里的
 * "call tool X" 指令 —— pivot 文案字面上就是那种指令。结果：该提交声称的
 * 「让模型换策略」依赖模型违反自身安全规则才生效；同时开了坏先例，示范
 * 「untrusted 块里的指令有时可以照做」，侵蚀提示注入防线。
 *
 * 修复：pivot 改由 messages.push({ role: "system", ... }) 作为**可信**轮次发出，
 * 先例是 #430 的 CONTENT_RISK_QUARANTINE_PLACEHOLDER（同样是系统动作、同样不进
 * untrusted 包装）。text-sanitize 已中和 </untrusted-XXX> 逃逸（kimi M2），
 * 页面内容伪造不出这个可信标记。
 *
 * 评审（kimi / SYNTHESIS.md B2）指出 same-tool-guard.test.ts 全是纯函数单测，
 * **没有 adapter 级证据**。本文件补的就是那个证据。
 * Mock seam: OpenAIProvider.prototype.streamChat（同 adapter-content-risk.test.ts）。
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CanonicalStreamEvent, StreamChatParams } from "../src/llm/provider"
import { LOCATOR_PIVOT_INSTRUCTION } from "../src/llm/same-tool-guard"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-pivot-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let OpenAIProvider: typeof import("../src/llm/providers/openai").OpenAIProvider

type CreateHandler = (params: StreamChatParams) => AsyncIterable<CanonicalStreamEvent>
let createHandlers: CreateHandler[] = []
let streamParams: StreamChatParams[] = []
let originalStreamChat: InstanceType<typeof OpenAIProvider>["streamChat"] | undefined

function toolCallStreamHandler(id: string, name: string, args: string): CreateHandler {
  return async function* () {
    yield { type: "tool_call_delta", index: 0, id, name, arguments: args }
    yield { type: "done", finish_reason: "tool_calls" }
  }
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  const openaiProv = await import("../src/llm/providers/openai")

  chatCreate = adapter.chatCreate
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  OpenAIProvider = openaiProv.OpenAIProvider

  await config.initDataDir()

  originalStreamChat = OpenAIProvider.prototype.streamChat
  OpenAIProvider.prototype.streamChat = function (params: StreamChatParams) {
    streamParams.push(params)
    const h = createHandlers.shift()
    if (!h) {
      return (async function* () {
        yield { type: "token" as const, text: "done" }
        yield { type: "done" as const, finish_reason: "stop" as const }
      })()
    }
    return h(params)
  }
})

after(() => {
  if (originalStreamChat) OpenAIProvider.prototype.streamChat = originalStreamChat
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetState() {
  createHandlers = []
  streamParams = []
}

/**
 * A click that keeps missing the text — the exact LOCATOR_MISS shape.
 *
 * The error string MUST carry the "ELEMENT_NOT_FOUND: " code prefix, because
 * that is what chrome-extension/src/background/locator-classify.ts:50
 * (codedToolError) actually emits. classifyError() matches the recoverable
 * bucket by MESSAGE SUBSTRING ("element_not_found"), not by the error_code
 * field, so a bare message without the prefix classifies as non_recoverable
 * and the adapter halts before ever reaching the same-tool-guard — the pivot
 * would never fire and these assertions would pass vacuously.
 */
const MISS_TEXT = 'ELEMENT_NOT_FOUND: no visible element matching text "提交订单"'

// The adapter gates page tools behind run_progress_propose (PROPOSE_REQUIRED,
// adapter.ts:1759). Every handler sequence below therefore opens with a propose
// turn, and this tool mock must answer that turn successfully or the clicks are
// never executed at all — the guard would never see three misses.
function locatorMissTool() {
  return async (_id: string, name: string) => {
    if (name === "run_progress_propose") return { success: true, data: { ok: true } }
    return {
      success: false,
      error: MISS_TEXT,
      error_code: "ELEMENT_NOT_FOUND",
      data: { error_code: "ELEMENT_NOT_FOUND" },
    }
  }
}

/** A tool that fails on everything except the propose gate (control case). */
function networkFailTool() {
  return async (_id: string, name: string) => {
    if (name === "run_progress_propose") return { success: true, data: { ok: true } }
    return {
      success: false,
      error: "network unreachable",
      error_code: "NETWORK_ERROR",
      data: { error_code: "NETWORK_ERROR" },
    }
  }
}

function buildMockParams(
  threadId: string,
  executeTool: (id: string, name: string, params?: unknown) => Promise<unknown>,
) {
  const manager = new ThreadManager()
  const thread = manager.create("test", threadId)
  const sentMessages: any[] = []
  return {
    threadId: thread.id,
    message: "点一下提交订单",
    skillIds: [],
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 8000,
    },
    threadManager: manager,
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as any,
    sendToExtension: (data: any) => {
      sentMessages.push(data)
    },
    executeTool,
    getSentMessages: () => sentMessages,
  } as any
}

/** True when the pivot text appears INSIDE any <untrusted-N> block. */
function insideUntrusted(content: string): boolean {
  const re = /<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m[1].includes(LOCATOR_PIVOT_INSTRUCTION)) return true
    // The old bug also leaked the first sentence alone into toolResult.error.
    if (m[1].includes("不要再点击这句文字")) return true
  }
  return false
}

// click requires tabId (companion/src/bridge/tool-schemas.ts:76-81). Without it
// the schema validator rejects the call BEFORE executeTool runs, so the mocked
// locator miss never reaches the same-tool-guard and the pivot never fires —
// which made these assertions pass vacuously.
// The same-tool-guard counts failures by TOOL NAME (recoverableFailureCounts,
// adapter.ts:2160), not by locator. But the site-op circuit breaker bans a
// repeated IDENTICAL locator at SITE_LOCATOR_FAIL_BAN=2 (site-op-memory.ts:29),
// one short of the pivot threshold MAX_SAME_TOOL_RECOVERABLE_FAILURES=3, and
// SITE_OP_BANNED is explicitly NOT counted (adapter.ts:2159). So clicking the
// SAME text three times never reaches the pivot — the guard fires on a model
// flailing across DIFFERENT locators with the same tool. Vary the text per call
// so each click is a distinct locator and the by-toolName count reaches 3.
const CLICK_TAB = 4242
const clickArgs = (id: string) =>
  JSON.stringify({ tabId: CLICK_TAB, text: "提交订单-" + id })
const clickHandler = (id: string) =>
  toolCallStreamHandler(id, "click", clickArgs(id))
const PROPOSE_ARGS = JSON.stringify({ items: [{ text: "点击提交订单" }] })

/** The propose turn every sequence must open with (see PROPOSE_REQUIRED gate). */
const proposeHandler = (id: string) =>
  toolCallStreamHandler(id, "run_progress_propose", PROPOSE_ARGS)

test("#544 pivot instruction never lands inside an <untrusted-N> block", async () => {
  resetState()
  // Three misses on the same tool => threshold reached, pivot issued once.
  createHandlers = [
    proposeHandler("p1"),
    clickHandler("c1"),
    clickHandler("c2"),
    clickHandler("c3"),
  ]
  const params = buildMockParams("test-pivot-untrusted", locatorMissTool())
  await chatCreate(params)

  assert.ok(streamParams.length >= 2, "the loop must continue past the misses")

  // Anti-vacuity guard: if the miss classified as non_recoverable the adapter
  // would halt before the same-tool-guard, and every assertion below would pass
  // for the wrong reason. Require the pivot to have actually fired.
  const allText = streamParams
    .flatMap((p) => p.messages)
    .map((m) => (typeof (m as { content?: unknown }).content === "string"
      ? String((m as { content?: unknown }).content)
      : ""))
    .join("\n")
  assert.ok(
    allText.includes(LOCATOR_PIVOT_INSTRUCTION),
    "the pivot must fire at all, otherwise these assertions are vacuous",
  )

  const toolMsgs = streamParams
    .flatMap((p) => p.messages)
    .filter((m) => m.role === "tool") as Array<{ content?: string }>
  assert.ok(toolMsgs.length > 0, "tool results were sent to the model")

  for (const t of toolMsgs) {
    assert.equal(
      insideUntrusted(String(t.content ?? "")),
      false,
      "#544 BLOCKING regression: pivot text was wrapped as untrusted tool data — " +
        "rule 11 forbids the model to follow it, so the feature cannot work. content=" +
        String(t.content).slice(0, 300),
    )
  }
})

test("#544 pivot instruction IS delivered on a trusted system turn", async () => {
  resetState()
  createHandlers = [
    proposeHandler("p2"),
    clickHandler("d1"),
    clickHandler("d2"),
    clickHandler("d3"),
  ]
  const params = buildMockParams("test-pivot-trusted", locatorMissTool())
  await chatCreate(params)

  const systemMsgs = streamParams
    .flatMap((p) => p.messages)
    .filter((m) => m.role === "system") as Array<{ content?: string }>
  const delivered = systemMsgs.some(
    (m) => typeof m.content === "string" && m.content.includes(LOCATOR_PIVOT_INSTRUCTION),
  )
  assert.equal(
    delivered,
    true,
    "the pivot must reach the model as a trusted system message, otherwise the " +
      "switch-strategy feature is silently dead (system turns seen: " +
      systemMsgs.length + ")",
  )

  // And it must be marked as a system action, not as page data.
  const turn = systemMsgs.find(
    (m) => typeof m.content === "string" && m.content.includes(LOCATOR_PIVOT_INSTRUCTION),
  )
  assert.ok(
    String(turn?.content ?? "").includes("CMspark 系统提示"),
    "the trusted turn must declare itself a system action so it cannot be confused with page content",
  )
})

test("#544 the real tool error survives verbatim (not polluted by the pivot text)", async () => {
  resetState()
  createHandlers = [
    proposeHandler("p3"),
    clickHandler("e1"),
    clickHandler("e2"),
    clickHandler("e3"),
  ]
  const params = buildMockParams("test-pivot-error-intact", locatorMissTool())
  await chatCreate(params)

  const toolMsgs = streamParams
    .flatMap((p) => p.messages)
    .filter((m) => m.role === "tool") as Array<{ content?: string }>
  const joined = toolMsgs.map((t) => String(t.content ?? "")).join("\n")
  assert.ok(
    joined.includes("no visible element matching text"),
    "the underlying tool failure must still reach the model",
  )
  assert.ok(
    joined.includes("ELEMENT_NOT_FOUND"),
    "the coded error prefix must survive too",
  )
  // suggested_action is a machine enum, not a natural-language instruction, so it
  // may stay in the tool result (it is not a "call tool X" directive).
  assert.ok(joined.includes("switch_strategy"), "the machine enum stays for toolChatErrorPayload")
})

test("#544 a non-locator failure issues no pivot (guard against over-firing)", async () => {
  resetState()
  createHandlers = [
    proposeHandler("p4"),
    clickHandler("f1"),
    clickHandler("f2"),
    clickHandler("f3"),
  ]
  // networkFailTool answers the propose gate successfully but fails every click
  // with a NON-locator error, so the guard must stay silent.
  const params = buildMockParams("test-pivot-no-fire", networkFailTool())
  await chatCreate(params)

  const systemMsgs = streamParams
    .flatMap((p) => p.messages)
    .filter((m) => m.role === "system") as Array<{ content?: string }>
  const leaked = systemMsgs.some(
    (m) => typeof m.content === "string" && m.content.includes(LOCATOR_PIVOT_INSTRUCTION),
  )
  assert.equal(leaked, false, "a non-locator error must not trigger the locator pivot")
})
