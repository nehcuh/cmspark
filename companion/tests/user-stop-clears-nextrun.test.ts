/**
 * #307: every user-initiated stop path clears the thread's nextRun queue —
 * a stop must never leave a landmine that a later chat.create silently drains.
 *
 *  - worker.pause (Mission Board row pause)
 *  - fleet.stop_all (Mission Board fleet bar stop)
 *  - cockpit stop_thread (confirm-response authoritative stop)
 *
 * Non-user abort paths keep their existing semantics (#306 ruling):
 *  - abortThreadChat() without clearQueue (worker_cancel / supersede shape)
 *  - abortLlmLoopsForPanel (panel close)
 *
 * Same OpenAI-completions prototype patch as message-router-nextrun-drain.test.ts.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-user-stop-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let abortThreadChat: typeof import("../src/message-router").abortThreadChat
let abortLlmLoopsForPanel: typeof import("../src/message-router").abortLlmLoopsForPanel
let __testSetLlmActiveForTests: typeof import("../src/message-router").__testSetLlmActiveForTests
let __testSetLlmOwnerForTests: typeof import("../src/message-router").__testSetLlmOwnerForTests
let handleSecurityConfirmationResponse: typeof import("../src/security/confirm-response").handleSecurityConfirmationResponse
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let peekNextRunCount: typeof import("../src/llm/run-queues").peekNextRunCount
let enqueueNextRun: typeof import("../src/llm/run-queues").enqueueNextRun
let _resetRunQueuesForTests: typeof import("../src/llm/run-queues")._resetRunQueuesForTests

const MAIN_MODEL = "deepseek-chat"

let originalCreate: any = undefined
let completionsProto: any = undefined

let streamCalls = 0
let holdStreams = false
let streamReleases: Array<() => void> = []

function abortError(): Error {
  const e = new Error("mock stream aborted")
  e.name = "AbortError"
  return e
}

function makeStream(signal?: AbortSignal): AsyncIterable<any> {
  return (async function* () {
    streamCalls++
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
    yield { choices: [{ index: 0, delta: { content: "mock reply" }, finish_reason: null }] }
    yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
  })()
}

before(async () => {
  const mr = await import("../src/message-router")
  const cr = await import("../src/security/confirm-response")
  const sc = await import("../src/security-confirmation")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  const queues = await import("../src/llm/run-queues")
  handleMessage = mr.handleMessage
  abortThreadChat = mr.abortThreadChat
  abortLlmLoopsForPanel = mr.abortLlmLoopsForPanel
  __testSetLlmActiveForTests = mr.__testSetLlmActiveForTests
  __testSetLlmOwnerForTests = mr.__testSetLlmOwnerForTests
  handleSecurityConfirmationResponse = cr.handleSecurityConfirmationResponse
  SecurityConfirmationManager = sc.SecurityConfirmationManager
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  peekNextRunCount = queues.peekNextRunCount
  enqueueNextRun = queues.enqueueNextRun
  _resetRunQueuesForTests = queues._resetRunQueuesForTests
  await cfg.initDataDir()

  saveConfig({
    llm: {
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: MAIN_MODEL,
      temperature: 0.5,
      context_window: 4000,
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
  holdStreams = false
  streamReleases = []
  _resetRunQueuesForTests()
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
  return { sendToExtension: (data: any) => sent.push(data), executeTool: async () => ({ success: true, data: {} }) } as any
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

test("#307 worker.pause clears the queued nextRun — pause never defers a revival", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "pause-clears")
  const sent: any[] = []
  const services = makeServices(tm)
  const session = makeSession(sent)

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    services,
    session,
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued before pause", enqueue: true },
    services,
    session,
  )
  assert.equal(enq.type, "chat.enqueued")

  const pauseResp = await handleMessage({ type: "worker.pause", worker_id: thread.id }, services, session)
  assert.equal(pauseResp.type, "worker.updated")
  assert.equal(
    peekNextRunCount(thread.id),
    0,
    "pause must clear the nextRun queue synchronously, before the ACK returns",
  )

  releaseHeldStreams()
  await createPromise
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(
    sent.filter((m) => m.type === "chat.user" && m.content === "queued before pause").length,
    0,
    "cancelled queued message never becomes a run",
  )

  // Resume + a fresh unrelated run must not revive the cancelled turn.
  await handleMessage({ type: "worker.resume", worker_id: thread.id }, services, session)
  const fresh = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "after resume" },
    services,
    session,
  )
  assert.equal(fresh, null, "fresh create after resume must run, not be rejected")
  await waitFor(() => streamCalls === 2, "fresh run finished")
  assert.equal(peekNextRunCount(thread.id), 0, "no landmine left for the next drain")
  assert.equal(
    sent.filter((m) => m.type === "chat.user" && m.content === "queued before pause").length,
    0,
    "stopped queue stays cancelled across pause/resume",
  )
})

test("#307 fleet.stop_all clears every worker's nextRun and discloses the counts", async () => {
  const tm = new ThreadManager()
  const w1 = tm.create("", "fleet-w1")
  const w2 = tm.create("", "fleet-w2")
  tm.update(w1.id, { agent_role: "worker" } as any)
  tm.update(w2.id, { agent_role: "worker" } as any)
  const sent: any[] = []
  const services = makeServices(tm)
  const session = makeSession(sent)

  // Seed the queues the way a leftover-steer conversion would (idle enqueue
  // is rejected; same seeding as the #291 idle-abort test).
  assert.equal(enqueueNextRun(w1.id, "queued on w1"), true)
  assert.equal(enqueueNextRun(w2.id, "queued on w2a"), true)
  assert.equal(enqueueNextRun(w2.id, "queued on w2b"), true)

  const resp = await handleMessage({ type: "fleet.stop_all" }, services, session)
  assert.equal(resp.type, "fleet.stop_all_result")
  assert.equal(resp.results.length, 2)
  assert.equal(peekNextRunCount(w1.id), 0, "stop_all clears w1's queue")
  assert.equal(peekNextRunCount(w2.id), 0, "stop_all clears w2's queue")
  const r1 = resp.results.find((r: any) => r.worker_id === w1.id)
  const r2 = resp.results.find((r: any) => r.worker_id === w2.id)
  assert.equal(r1.cancelled_next_run, 1, "per-worker disclosure: 1 cancelled on w1")
  assert.equal(r2.cancelled_next_run, 2, "per-worker disclosure: 2 cancelled on w2")

  // A fresh run on a resumed worker must not drain the cancelled turns.
  await handleMessage({ type: "worker.resume", worker_id: w1.id }, services, session)
  const fresh = await handleMessage(
    { type: "chat.create", thread_id: w1.id, message: "fresh after stop_all" },
    services,
    session,
  )
  assert.equal(fresh, null)
  await waitFor(() => streamCalls === 1, "fresh run finished")
  assert.equal(peekNextRunCount(w1.id), 0, "no delayed revival from the cancelled queue")
  assert.equal(
    sent.filter((m) => m.type === "chat.user" && m.content === "queued on w1").length,
    0,
    "cancelled worker queue never becomes a run",
  )
})

test("#307 cockpit stop_thread clears the worker's queued nextRun", async () => {
  const tm = new ThreadManager()
  const worker = tm.create("", "cockpit-stop")
  tm.update(worker.id, { agent_role: "worker" } as any)
  assert.equal(enqueueNextRun(worker.id, "queued before cockpit stop"), true)

  const manager = new SecurityConfirmationManager(60_000)
  const confirmFrames: any[] = []
  const ws = { __mockWsLabel: "cockpit" } as any
  const pending = manager.request(
    (m: any) => confirmFrames.push(m),
    { toolName: "navigate", dangerousApis: [], code: "navigate('https://example.com')" },
    { originWs: ws },
  )
  const confirmationId = confirmFrames[0].confirmation_id

  await handleSecurityConfirmationResponse(
    ws,
    {
      confirmation_id: confirmationId,
      approved: true, // stop_thread resolves as deny regardless
      stop_thread: true,
      stop_thread_id: worker.id,
    },
    undefined,
    {
      securityConfirmations: manager,
      getConfig: () => ({}),
      saveConfig: () => {},
      getThreadManager: () => tm,
      rejectPendingForThread: () => 0,
      hasPendingForTab: () => false,
      rejectPendingForTab: () => 0,
    },
  )

  const decision = await pending
  assert.equal(decision.approved, false, "stop_thread resolves the confirmation as deny")
  assert.equal(peekNextRunCount(worker.id), 0, "cockpit stop clears the queue synchronously")

  // A later fresh run on that worker must not revive the cancelled turn.
  await handleMessage({ type: "worker.resume", worker_id: worker.id }, makeServices(tm), makeSession([]))
  const sent: any[] = []
  const fresh = await handleMessage(
    { type: "chat.create", thread_id: worker.id, message: "fresh after cockpit stop" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(fresh, null)
  await waitFor(() => streamCalls === 1, "fresh run finished")
  assert.equal(
    sent.filter((m) => m.type === "chat.user" && m.content === "queued before cockpit stop").length,
    0,
    "cancelled queue never becomes a run",
  )
})

test("#307 non-user aborts keep nextRun: bare abortThreadChat + panel close", async () => {
  const tid = "non-user-bare"
  assert.equal(enqueueNextRun(tid, "queued one"), true)
  assert.equal(enqueueNextRun(tid, "queued two"), true)

  __testSetLlmActiveForTests(tid, true)
  try {
    const res = abortThreadChat(tid)
    assert.equal(res.stopped, true, "controller existed and was aborted")
    assert.equal(res.cancelled, 0, "no clearQueue → nothing cancelled (worker_cancel / supersede shape)")
    assert.equal(peekNextRunCount(tid), 2, "non-user abort keeps the queued turns")
  } finally {
    __testSetLlmActiveForTests(tid, false)
    _resetRunQueuesForTests()
  }

  // Panel close: queued turns survive for the next session (#306 ruling).
  const tid2 = "non-user-panel"
  assert.equal(enqueueNextRun(tid2, "queued across panel close"), true)
  __testSetLlmActiveForTests(tid2, true)
  __testSetLlmOwnerForTests(tid2, "panel-close-x")
  try {
    const n = abortLlmLoopsForPanel("panel-close-x")
    assert.equal(n, 1, "the panel-owned loop was aborted")
    assert.equal(peekNextRunCount(tid2), 1, "panel close keeps the queue — nextRun survives abort (#306)")
  } finally {
    __testSetLlmOwnerForTests(tid2, null)
    __testSetLlmActiveForTests(tid2, false)
    _resetRunQueuesForTests()
  }
})
