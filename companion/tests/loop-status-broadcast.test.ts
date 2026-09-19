/**
 * #509 — pin broadcastLoopStatus lastTerminal wiring.
 *
 * message-router.ts:1426 passes runStats.terminal as the 4th arg so an armed
 * 100-round cap renders「这一段跑完了」instead of a lying「推进中」. Dropping
 * that argument (3-arg call) still type-checks; this test must go red.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-loop-status-bcast-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let queues: typeof import("../src/llm/run-queues")
let loopStatus: typeof import("../src/loop/loop-status")

const MAIN_MODEL = "deepseek-chat"
const VISION_MODEL = "vision-mock-model"
const ROUND_CAP = 100

let originalCreate: any = undefined
let completionsProto: any = undefined
let streamCalls = 0

function abortError(): Error {
  const e = new Error("mock stream aborted")
  e.name = "AbortError"
  return e
}

/** First ROUND_CAP streams are tool rounds (exhaust the cap); later streams are text. */
function makeStream(signal?: AbortSignal): AsyncIterable<any> {
  const callNo = ++streamCalls
  return (async function* () {
    if (signal?.aborted) throw abortError()
    if (callNo <= ROUND_CAP) {
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${callNo}`,
                  type: "function",
                  function: { name: "list_tabs", arguments: "{}" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }
      yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }
      return
    }
    yield { choices: [{ index: 0, delta: { content: "mock reply" }, finish_reason: null }] }
    yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
  })()
}

before(async () => {
  const mr = await import("../src/message-router")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  queues = await import("../src/llm/run-queues")
  loopStatus = await import("../src/loop/loop-status")
  await cfg.initDataDir()

  saveConfig({
    llm: {
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: MAIN_MODEL,
      temperature: 0.5,
      // 100 tool rounds must not trip the overflow recovery before the cap.
      context_window: 1_000_000,
    },
    vision: {
      enabled: false,
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: VISION_MODEL,
    },
  } as any)

  const cjsRequire = createRequire(__filename)
  const openaiMod = cjsRequire("openai")
  const OpenAI = openaiMod?.default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://127.0.0.1:9", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function (params: any, options?: any) {
    if (params?.stream === true) return makeStream(options?.signal)
    return { choices: [{ index: 0, message: { content: "title" }, finish_reason: "stop" }] }
  }
})

after(() => {
  if (completionsProto && originalCreate) {
    completionsProto.create = originalCreate
  }
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  streamCalls = 0
  queues._resetRunQueuesForTests()
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

function makeSession(sent: any[]) {
  return {
    sendToExtension: (data: any) => sent.push(data),
    executeTool: async () => ({ success: true, data: { tabs: [] } }),
  } as any
}

function makeServices(tm: InstanceType<typeof ThreadManager>) {
  return { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any }
}

function setUnticked(tm: InstanceType<typeof ThreadManager>, threadId: string) {
  tm.update(threadId, {
    run_progress: {
      items: [
        { id: "live:0", text: "打开页面", done: true, source: "seed", tool: "navigate" },
        { id: "live:1", text: "点击提交按钮", done: false, source: "seed", tool: "click" },
      ],
    },
  } as any)
}

let seq = 0
function tid(tag: string): string {
  return `loop-bcast-${tag}-${Date.now()}-${seq++}`
}

test("#509 source lock: run-end broadcastLoopStatus passes runStats.terminal", () => {
  const src = readFileSync(join(process.cwd(), "src/message-router.ts"), "utf8")
  assert.match(
    src,
    /broadcastLoopStatus\(\s*session,\s*services\.threadManager,\s*rest\.thread_id,\s*runStats\.terminal\s*\)/,
  )
})

test("#509 deriveLoopStatusView lastTerminal=round_limit renders 这一段跑完了", () => {
  const v = loopStatus.deriveLoopStatusView({
    loopState: {
      status: "active",
      armed_by: "explicit_command",
      armed_at: new Date().toISOString(),
      started_at_ms: Date.now(),
      wall_clock_ms: 30 * 60_000,
      runs_used: 1,
      tokens_used: 0,
      run_tokens: [],
    } as any,
    runProgress: {
      items: [
        { id: "a", text: "打开页面", source: "seed", done: true, tool: "navigate" },
        { id: "b", text: "提交", source: "seed", done: false, tool: "click" },
      ],
    },
    pendingSteers: [],
    impossible: { items: [] } as any,
    pendingConfirms: 0,
    tier: "off",
    lastTerminal: "round_limit",
  })
  assert.ok(v)
  assert.match(v!.label, /这一段跑完了/)
  assert.equal(v!.label.includes("推进中"), false)
})

test(
  "#509 armed round_limit run broadcasts task_loop.status with 这一段跑完了",
  { timeout: 120_000 },
  async () => {
    const tm = new ThreadManager()
    const thread = tm.create("", tid("cap"))
    setUnticked(tm, thread.id)
    const sent: any[] = []
    await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "持续做完直至完成或无法完成" },
      makeServices(tm),
      makeSession(sent),
    )
    const statusFrames = sent.filter((f) => f && f.type === "task_loop.status")
    assert.ok(statusFrames.length > 0, "expected at least one task_loop.status frame")
    const capFrame = statusFrames.find(
      (f) => typeof f.label === "string" && String(f.label).includes("这一段跑完了"),
    )
    assert.ok(
      capFrame,
      `expected a status frame with 这一段跑完了; got ${statusFrames.map((f) => f.label).join(" | ")}`,
    )
    assert.equal(capFrame.thread_id, thread.id)
    // Equivalence of lastTerminal on the wire: the derived label, not a raw field.
    assert.match(String(capFrame.label), /这一段跑完了/)
  },
)
