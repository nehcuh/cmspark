/**
 * #425 (gbkq2q) — SITE_OP peek 拒执不吃同工具熔断预算。
 *
 * E2E through chatCreate with a stubbed LLM stream（harness 同
 * site-op-auto-persist.test.ts）。三条钉死：
 *  a) SITE_OP_BANNED ×4（peek 拒执，工具未执行）不触发熔断——run 存活到收尾
 *  b) 真实失败 ×2 + peek 拒执 ×3 交错 → 只计真实失败；第 3 次真实失败才熔断
 *  c) origin 已升级 + wait_for 真实失败 ×3 熔断 → chat.error 附解锁指引
 *     （#425 放宽：不再只认 osascript_eval/host_computer）
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-peekbreaker-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let resetSiteOpMemoryForTests: typeof import("../src/tool/site-op-memory").resetSiteOpMemoryForTests
let applyTabNavigated: typeof import("../src/ws/tab-url-cache").applyTabNavigated
let clearTabUrlCacheForTests: typeof import("../src/ws/tab-url-cache").clearTabUrlCacheForTests

const logEvents: Array<{ level: string; event: string; data: Record<string, unknown> }> = []

let completionsProto: any = undefined
let originalCreate: any = undefined
/** Per-round scripted assistant responses; index = LLM round within current test. */
let roundScript: Array<{ tool?: { name: string; args: Record<string, unknown> }; content?: string }> = []

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  const siteOp = await import("../src/tool/site-op-memory")
  const tabUrlCache = await import("../src/ws/tab-url-cache")

  chatCreate = adapter.chatCreate
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  resetSiteOpMemoryForTests = siteOp.resetSiteOpMemoryForTests
  applyTabNavigated = tabUrlCache.applyTabNavigated
  clearTabUrlCacheForTests = tabUrlCache.clearTabUrlCacheForTests

  await config.initDataDir()

  const loggerMod = await import("../src/logger")
  for (const lvl of ["info", "warn", "error"] as const) {
    const orig = loggerMod.logger[lvl].bind(loggerMod.logger)
    ;(loggerMod.logger as any)[lvl] = (event: string, data?: Record<string, unknown>, source?: string) => {
      logEvents.push({ level: lvl, event, data: data || {} })
      orig(event, data, source)
    }
  }

  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://localhost:9999", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function (params: any, _options?: any) {
    const round = roundScript.shift() ?? { content: "done" }
    const tool = round.tool
    if (tool) {
      const gen = (async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: `call_${Math.random().toString(36).slice(2, 10)}`,
                type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.args) },
              }],
            },
          }],
        }
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }
      })()
      return params.stream ? gen : (await gen.next()).value
    }
    const gen = (async function* () {
      yield { choices: [{ delta: { content: round.content ?? "done" } }] }
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }
    })()
    return params.stream ? gen : (await gen.next()).value
  }
})

after(() => {
  if (completionsProto && originalCreate) completionsProto.create = originalCreate
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function buildParams(opts: {
  threadId: string
  hostname: string
  manager: InstanceType<typeof ThreadManager>
  skillEngine: InstanceType<typeof SkillEngine>
  executeTool: (id: string, name: string, params: any) => Promise<any>
  sent: any[]
}) {
  return {
    threadId: opts.threadId,
    message: "bookmark this",
    skillIds: [],
    hostname: opts.hostname,
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 4000,
    },
    threadManager: opts.manager,
    skillEngine: opts.skillEngine,
    historyStore: { record: () => 0 } as any,
    sendToExtension: (data: any) => {
      opts.sent.push(data)
    },
    executeTool: opts.executeTool,
  } as any
}

/** 种一条持久化经验 → 该 (origin, locator) 在 peek 即被机器拒（SITE_OP_BANNED）。 */
function seedPersistedBan(se: InstanceType<typeof SkillEngine>, host: string, origin: string) {
  se.createExperienceSkill(host, "site_knowledge", origin, ["site-op-memory", "auto"], {
    id: "auto-seed-ban",
    category: "problem",
    content: `[auto] DO NOT retry click text:收藏 on ${origin}: last ELEMENT_NOT_FOUND`,
    recorded_at: new Date().toISOString(),
    confirmed_at: null,
    stale: false,
    stale_reason: "",
    replaced_by: "",
  })
}

const proposeOk = { success: true, data: { items: [{ text: "bookmark this page" }] } }
const proposeRound = { tool: { name: "run_progress_propose", args: { items: [{ text: "bookmark this page" }] } } }
const elementFail = { success: false, error: "ELEMENT_NOT_FOUND: no node matched", data: { error_code: "ELEMENT_NOT_FOUND" } }
const timeoutFail = { success: false, error: "TIMEOUT: wait_for condition not met within 5000ms", data: { error_code: "TIMEOUT" } }

test("(a) SITE_OP_BANNED ×4（peek 拒执，零执行）不触发熔断，run 存活到收尾", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  applyTabNavigated(201, "https://p.com/home")
  logEvents.length = 0
  roundScript = [
    { tool: { name: "click", args: { tabId: 201, text: "收藏" } } },
    { tool: { name: "click", args: { tabId: 201, text: "收藏" } } },
    { tool: { name: "click", args: { tabId: 201, text: "收藏" } } },
    { tool: { name: "click", args: { tabId: 201, text: "收藏" } } },
    { content: "given up" },
  ]

  const manager = new ThreadManager()
  const se = new SkillEngine()
  seedPersistedBan(se, "p-com", "https://p.com")
  const thread = manager.create("peek refuse only", "test-peek-01")
  const sent: any[] = []
  let dispatched = 0
  await chatCreate(buildParams({
    threadId: thread.id,
    hostname: "p.com",
    manager,
    skillEngine: se,
    sent,
    executeTool: async () => {
      dispatched += 1
      return { ...elementFail }
    },
  }))

  assert.equal(dispatched, 0, "peek refusal happens before dispatch — executeTool must not run")
  assert.equal(
    logEvents.filter(e => e.event === "llm.recoverable_loop_detected").length,
    0,
    "peek refusals must not consume the breaker budget",
  )
  assert.equal(sent.filter(m => m?.type === "chat.error").length, 0, "no chat.error — run survives")
  const messages = manager.getMessages(thread.id)
  assert.match(String(messages.find(m => m.role === "tool")?.content), /SITE_OP_BANNED/, "envelope still feeds back to the model")
  assert.ok(
    messages.some(m => m.role === "assistant" && String(m.content).includes("given up")),
    "LLM reaches a final answer instead of being cut by the breaker",
  )
})

test("(b) 真实失败 ×2 + peek 拒执 ×3 交错：只计真实失败，第 3 次真实失败才熔断", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  applyTabNavigated(202, "https://q.com/home")
  logEvents.length = 0
  roundScript = [
    proposeRound,
    { tool: { name: "wait_for", args: { tabId: 202, selector: "#w1" } } }, // 真实超时 → wait_for 计 1
    { tool: { name: "click", args: { tabId: 202, text: "收藏" } } },  // peek 拒执（不计）
    { tool: { name: "wait_for", args: { tabId: 202, selector: "#w2" } } }, // 真实超时 → 计 2
    { tool: { name: "click", args: { tabId: 202, text: "收藏" } } },  // peek 拒执（不计）
    { tool: { name: "click", args: { tabId: 202, text: "收藏" } } },  // peek 拒执（不计）
    { tool: { name: "wait_for", args: { tabId: 202, selector: "#w3" } } }, // 真实超时 → 计 3 → 熔断
    { content: "never reached" },
  ]

  const manager = new ThreadManager()
  const se = new SkillEngine()
  seedPersistedBan(se, "q-com", "https://q.com")
  const thread = manager.create("interleaved", "test-peek-02")
  const sent: any[] = []
  let waitDispatched = 0
  await chatCreate(buildParams({
    threadId: thread.id,
    hostname: "q.com",
    manager,
    skillEngine: se,
    sent,
    executeTool: async (_id, name) => {
      if (name === "run_progress_propose") return proposeOk
      if (name === "wait_for") {
        waitDispatched += 1
        return { ...timeoutFail }
      }
      return { ...elementFail }
    },
  }))

  // 若 peek 拒执也计数，第 4 轮（w2 之前）就会熔断：wait_for 只会被执行 2 次。
  assert.equal(waitDispatched, 3, "all three real wait_for failures actually executed")
  const breakerLogs = logEvents.filter(e => e.event === "llm.recoverable_loop_detected")
  assert.equal(breakerLogs.length, 1, "breaker fires exactly once — on the 3rd REAL failure")
  assert.equal(breakerLogs[0].data.tool_name, "wait_for")
  const chatErrors = sent.filter(m => m?.type === "chat.error")
  assert.equal(chatErrors.length, 1)
  assert.match(String(chatErrors[0].error), /工具 wait_for 连续 3 次执行失败/)
})

test("(c) origin 已升级 + wait_for 真实×3 熔断 → chat.error 带解锁指引（任意工具）", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  applyTabNavigated(203, "https://r.com/home")
  logEvents.length = 0
  // 4 次真实失败（不同 locator）→ origin fails=4 达 SITE_ORIGIN_FAIL_ESCALATE；
  // 第 4 次即 wait_for#3：recordSiteOpFailure 先把 origin 推到升级线，随后熔断
  // 检查看到 isOriginEscalated=true → 附解锁指引。
  roundScript = [
    proposeRound,
    { tool: { name: "click", args: { tabId: 203, text: "r1" } } },    // 真实失败 → origin 1
    { tool: { name: "wait_for", args: { tabId: 203, selector: "#w1" } } }, // origin 2, wait_for 计 1
    { tool: { name: "wait_for", args: { tabId: 203, selector: "#w2" } } }, // origin 3, 计 2
    { tool: { name: "wait_for", args: { tabId: 203, selector: "#w3" } } }, // origin 4（升级）, 计 3 → 熔断
    { content: "never reached" },
  ]

  const manager = new ThreadManager()
  const se = new SkillEngine()
  const thread = manager.create("escalated breaker", "test-peek-03")
  const sent: any[] = []
  await chatCreate(buildParams({
    threadId: thread.id,
    hostname: "r.com",
    manager,
    skillEngine: se,
    sent,
    executeTool: async (_id, name) => {
      if (name === "run_progress_propose") return proposeOk
      return name === "wait_for" ? { ...timeoutFail } : { ...elementFail }
    },
  }))

  const chatErrors = sent.filter(m => m?.type === "chat.error")
  assert.equal(chatErrors.length, 1)
  assert.match(String(chatErrors[0].error), /工具 wait_for 连续 3 次执行失败/, "wait_for (a CDP tool) hits the breaker")
  // #425 放宽前：解锁指引只挂在 osascript_eval/host_computer 上 → 这里是裸死胡同。
  // 测试 HOME 无 coordinateEnabled → unarmed 分支文案。
  assert.match(String(chatErrors[0].error), /解锁：在 设置 → 坐标计算机使用 打开 coordinateEnabled/)
})
