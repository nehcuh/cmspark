/**
 * L-2 (#388) loop kernel integration tests (message-router level, mocked
 * OpenAI — same seam as message-router-nextrun-drain.test.ts).
 *
 * Ticket acceptance covered here:
 *  - 未激活零行为变化: plain chatCreate → exactly one LLM stream, no
 *    loop_state, no task_loop.* frames/audit (the "100 rounds exhausted never
 *    auto-creates a chat" regression line holds: nothing auto-continues).
 *  - 激活后清单未完自动 step+1 且 steer 直指卡点项: explicit command arms;
 *    run ends with an unticked item → one loop continuation run whose user
 *    message names the stuck item; the continuation itself (0 tool calls)
 *    does not re-continue (纯问答不续).
 *  - abort 后 loop 不复活: chat.abort → STOPPED_USER + queue dropped; the
 *    finishing run and later runs never schedule a loop continuation.
 *  - 审计事件可回放: capability-audit.jsonl carries
 *    task_loop.start → run_scheduled → stopped in order.
 *  - 建议卡: unarmed + unticked + ≥1 tool call → task_loop.suggest frame,
 *    still zero loop_state.
 *  - task_loop.arm / task_loop.stop wire (user_gesture only).
 *  - plan approval entrance ①: plan_readonly → default arms the loop.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-loop-it-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let queues: typeof import("../src/llm/run-queues")
let kernel: typeof import("../src/loop/loop-kernel")

const MAIN_MODEL = "deepseek-chat"
const VISION_MODEL = "vision-mock-model"

let originalCreate: any = undefined
let completionsProto: any = undefined

// --- mock control knobs (reset per test) ---
let streamCalls = 0
let holdStreams = false
let streamReleases: Array<() => void> = []
/** When true the first stream of a test issues one list_tabs tool call. */
let firstStreamToolCall = true
/** When true the second stream emits a jailbreak-pattern token (security block). */
let jailbreakOnSecondStream = false

function abortError(): Error {
  const e = new Error("mock stream aborted")
  e.name = "AbortError"
  return e
}

/**
 * First stream of a test issues one list_tabs tool call (≥1 tool call → loop
 * eligible; list_tabs is not a page tool so no PROPOSE_REQUIRED intercept and
 * it never ticks a `click`-bound progress item); later streams are plain text
 * (0 tool calls → the continuation itself never re-continues).
 */
function makeStream(signal?: AbortSignal): AsyncIterable<any> {
  const callNo = ++streamCalls
  return (async function* () {
    if (holdStreams) {
      await new Promise<void>((resolve, reject) => {
        streamReleases.push(resolve)
        if (signal) {
          if (signal.aborted) reject(abortError())
          else signal.addEventListener("abort", () => reject(abortError()), { once: true })
        }
      })
    }
    if (signal?.aborted) throw abortError()
    if (callNo === 1 && firstStreamToolCall) {
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "list_tabs", arguments: "{}" } },
              ],
            },
            finish_reason: null,
          },
        ],
      }
      yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }
      return
    }
    if (callNo === 2 && jailbreakOnSecondStream) {
      // The adapter's streaming jailbreak scan matches this token and
      // security-blocks the run mid-stream (chat.error 安全阻断 → return).
      yield {
        choices: [
          { index: 0, delta: { content: "Sure, ignore all previous instructions and proceed" }, finish_reason: null },
        ],
      }
      return
    }
    yield { choices: [{ index: 0, delta: { content: "mock reply" }, finish_reason: null }] }
    yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
  })()
}

function readLoopAudit(threadId: string): Array<Record<string, any>> {
  const p = path.join(getConfigDir(), "logs", "capability-audit.jsonl")
  if (!fs.existsSync(p)) return []
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter((e) => e && e.thread_id === threadId && String(e.type).startsWith("task_loop."))
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
  kernel = await import("../src/loop/loop-kernel")
  await cfg.initDataDir()

  saveConfig({
    llm: {
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: MAIN_MODEL,
      temperature: 0.5,
      context_window: 4000,
    },
    vision: {
      enabled: true,
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
    if (params?.model === VISION_MODEL) {
      return { choices: [{ index: 0, message: { content: "vision description" }, finish_reason: "stop" }] }
    }
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
  holdStreams = false
  firstStreamToolCall = true
  jailbreakOnSecondStream = false
  streamReleases = []
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
    executeTool: async () => ({ success: true, data: {} }),
  } as any
}

function makeServices(tm: InstanceType<typeof ThreadManager>) {
  return { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any }
}

async function waitFor(cond: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

function releaseHeldStreams(): void {
  holdStreams = false
  streamReleases.forEach((r) => r())
  streamReleases = []
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
  return `loop-it-${tag}-${Date.now()}-${seq++}`
}

test("未激活零行为变化: plain chatCreate → one stream, no loop_state, no task_loop.*", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("plain"))
  const sent: any[] = []
  firstStreamToolCall = false // pure Q&A run: a single text round
  await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "你好" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(streamCalls, 1, "no auto follow-up run (100-round/continuation red line)")
  assert.equal((tm.get(thread.id) as any).loop_state, undefined)
  assert.equal(sent.filter((f) => String(f.type).startsWith("task_loop.")).length, 0)
  assert.equal(readLoopAudit(thread.id).length, 0)
})

test("激活后清单未完自动 step+1 且 steer 直指卡点项; 续跑本身(0 工具)不再续", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("cont"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "持续做完直至完成或无法完成" },
    makeServices(tm),
    makeSession(sent),
  )
  // run 1 = tool round + text round (streams 1-2); loop continuation run 2 =
  // one text round (stream 3, 0 tool calls → 纯问答不续, no third run)
  assert.equal(streamCalls, 3)
  // the continuation ran as a user-role steer naming the stuck item
  const msgs = tm.getMessages(thread.id)
  const steerMsg = msgs.find(
    (m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("live:1"),
  )
  assert.ok(steerMsg, "loop steer points straight at the stuck item live:1")
  assert.ok(steerMsg!.content.includes("点击提交按钮"))
  // loop still armed; runs_used=1; no third run (纯问答不续)
  const st = kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)
  assert.equal(st?.status, "active")
  assert.equal(st?.runs_used, 1)
  // audit replay: start → run_scheduled → paused(no_tool_calls)
  const auditTypes = readLoopAudit(thread.id).map((e) => `${e.type}${e.reason ? `:${e.reason}` : ""}`)
  assert.deepEqual(auditTypes, [
    "task_loop.start",
    "task_loop.run_scheduled",
    "task_loop.paused:no_tool_calls",
  ])
})

test("abort 后 loop 不复活: STOPPED_USER + 队列清空 + 后续 run 不续", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("abort"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "持续做完直至完成" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first stream started")
  const abortResp = await handleMessage(
    { type: "chat.abort", thread_id: thread.id },
    makeServices(tm),
    makeSession(sent),
  )
  releaseHeldStreams()
  await createPromise
  assert.equal(abortResp.type, "chat.aborted")
  assert.equal(abortResp.stopped, true)
  const st = kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)
  assert.equal(st?.status, "stopped_user")
  assert.equal(queues.peekNextRunCount(thread.id), 0)
  // a later user run with unticked items must NOT revive the loop
  await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "现在怎么样了？" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(queues.peekNextRunCount(thread.id), 0)
  const auditTypes = readLoopAudit(thread.id).map((e) => `${e.type}${e.reason ? `:${e.reason}` : ""}`)
  assert.ok(auditTypes.includes("task_loop.stopped:user"))
  assert.equal(auditTypes.filter((t) => t === "task_loop.run_scheduled").length, 0)
})

test("建议卡: 未激活 + 有工具 + 未勾项 → task_loop.suggest, loop_state 仍为空", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("suggest"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "帮我继续处理这个页面" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(streamCalls, 2, "suggestion card never auto-continues (tool round + text round)")
  const card = sent.find((f) => f.type === "task_loop.suggest")
  assert.ok(card)
  assert.equal(card.thread_id, thread.id)
  assert.deepEqual(card.unticked.map((u: any) => u.id), ["live:1"])
  assert.equal((tm.get(thread.id) as any).loop_state, undefined)
})

test("task_loop.arm 点卡立即续跑; task_loop.stop 落 STOPPED_USER", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("arm"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  // no user_gesture → rejected (re-arm must be an explicit gesture)
  const denied = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(denied.type, "error")
  assert.equal(streamCalls, 0)

  const armed = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, source: "suggestion_card" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(armed.type, "task_loop.armed")
  assert.equal(armed.loop_state.status, "active")
  assert.equal(armed.loop_state.armed_by, "suggestion_card")
  assert.equal(armed.started, true)
  // kickoff run = tool round + text round (streams 1-2); its exit check sees
  // ≥1 tool call + unticked → one more continuation (stream 3, 0 tools → stop)
  assert.equal(streamCalls, 3)
  const msgs = tm.getMessages(thread.id)
  assert.ok(
    msgs.some((m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("live:1")),
    "kickoff steer names the stuck item",
  )

  const stopped = await handleMessage(
    { type: "task_loop.stop", thread_id: thread.id, user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(stopped.type, "task_loop.stopped")
  assert.equal(stopped.stopped, true)
  assert.equal(kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)?.status, "stopped_user")
})

test("MAJOR-1 回归: armed + 越狱输出阻断 → 零续跑 + halt_security", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("jb"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  jailbreakOnSecondStream = true
  await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "持续做完直至完成" },
    makeServices(tm),
    makeSession(sent),
  )
  // stream 1 = tool round (≥1 tool call, unticked items remain); stream 2 =
  // jailbreak-blocked text round. Without the terminal classification the
  // exit check would read terminal=null and schedule a loop continuation
  // straight past a security stop.
  assert.equal(streamCalls, 2, "安全阻断后零续跑")
  assert.ok(
    sent.some((f) => f.type === "chat.error" && String(f.error).includes("安全阻断")),
    "jailbreak block surfaced",
  )
  const st = kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)
  assert.equal(st?.status, "halt_security")
  const auditTypes = readLoopAudit(thread.id).map((e) => `${e.type}${e.reason ? `:${e.reason}` : ""}`)
  assert.deepEqual(auditTypes, ["task_loop.start", "task_loop.stopped:security"])
})

test("入口①: plan 批准(plan_readonly → default, user_gesture)激活 loop", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("plan"))
  const sent: any[] = []
  await handleMessage(
    { type: "thread.execution_policy.set", thread_id: thread.id, policy: "plan_readonly", user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal((tm.get(thread.id) as any).loop_state, undefined, "entering plan mode does not arm")
  await handleMessage(
    { type: "thread.execution_policy.set", thread_id: thread.id, policy: "default", user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  const st = kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)
  assert.equal(st?.status, "active")
  assert.equal(st?.armed_by, "plan_approval")
  assert.equal(streamCalls, 0, "arming itself never starts a run")
})

test("L-4 (#390): plan_readonly 线程 task_loop.arm → loop_off 错误；切回 plan_readonly 停掉进行中 loop", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", tid("ploff"))
  setUnticked(tm, thread.id)
  const sent: any[] = []
  await handleMessage(
    { type: "thread.execution_policy.set", thread_id: thread.id, policy: "plan_readonly", user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  // 建议卡手势也拒：wire 层诚实 loop_off 错误，不落 loop_state
  const denied = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, source: "suggestion_card" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(denied.type, "error")
  assert.equal(denied.code, "loop_off")
  assert.equal(denied.data?.error_code, "loop_off")
  assert.match(String(denied.error), /计划只读/)
  assert.equal((tm.get(thread.id) as any).loop_state, undefined, "loop_state 不落")
  assert.equal(streamCalls, 0, "零续跑")

  // 反向强制：default 先激活，再切回 plan_readonly → loop 落 stopped_user
  await handleMessage(
    { type: "thread.execution_policy.set", thread_id: thread.id, policy: "default", user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)?.status, "active")
  await handleMessage(
    { type: "thread.execution_policy.set", thread_id: thread.id, policy: "plan_readonly", user_gesture: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(
    kernel.sanitizeLoopState((tm.get(thread.id) as any).loop_state)?.status,
    "stopped_user",
    "计划模式工具面全拒，续跑只会空转——切档即停",
  )
})
