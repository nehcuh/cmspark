/**
 * Regression tests for the nextRun drain / file.upload slot-claim fixes:
 *
 *  - P1 TOCTOU: file.upload claims the LLM slot synchronously at entry, so a
 *    chat.create arriving during the parse/vision phase is rejected with
 *    run_active instead of starting a parallel orphan stream.
 *  - P1 cleanup: early returns after the entry claim (size/type/parse/paused/
 *    gate failures) free the slot again.
 *  - P1 drain gates: the post-run nextRun drain pre-checks the lease/conductor
 *    gates BEFORE takeNextRun — a rejected drain returns the gate error and
 *    leaves the message queued (the client already holds chat.enqueued).
 *  - P1 drain parity: file.upload and chat.regenerate drain one queued
 *    nextRun on completion, like chat.create already did.
 *  - #291 abort honesty: chat.abort clears the queued nextRun (no silent
 *    revival after the user pressed stop), ACKs `stopped:false` when no
 *    controller was found, and logs thread_id + had_controller.
 *  - P2 D6: chat.steer passes client_message_id through to the steer queue and
 *    echoes it in the chat.steered ack.
 *  - P2 wire: thread-domain rejection frames all carry thread_id.
 *
 * The OpenAI completions prototype is patched (same seam as
 * client-message-id-passthrough): stream:true calls drive the main chat loop,
 * the vision model call drives analyzeImage, everything else (titles) resolves
 * immediately.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-nextrun-drain-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let listLlmActiveThreadIds: typeof import("../src/message-router").listLlmActiveThreadIds
let __testSetLlmActiveForTests: typeof import("../src/message-router").__testSetLlmActiveForTests
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let peekNextRunCount: typeof import("../src/llm/run-queues").peekNextRunCount
let enqueueNextRun: typeof import("../src/llm/run-queues").enqueueNextRun
let takeSteer: typeof import("../src/llm/run-queues").takeSteer
let _resetRunQueuesForTests: typeof import("../src/llm/run-queues")._resetRunQueuesForTests
let MAX_NEXT_RUN: typeof import("../src/llm/run-queues").MAX_NEXT_RUN
let MAX_STEER: typeof import("../src/llm/run-queues").MAX_STEER
let composerLeases: typeof import("../src/ws/composer-lease").composerLeases
let getComputerTaskAbortRegistry: typeof import("../src/computer/task-abort-registry").getComputerTaskAbortRegistry
let getLogFilePath: typeof import("../src/logger").getLogFilePath

// deepseek-chat trips the non-multimodal name heuristic, so standalone upload
// images take the vision rail (analyzeImage) instead of native vision.
const MAIN_MODEL = "deepseek-chat"
const VISION_MODEL = "vision-mock-model"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let originalCreate: any = undefined
let completionsProto: any = undefined

// --- mock control knobs (reset per test) ---
let streamCalls = 0
let visionCalls = 0
let holdStreams = false
let holdVision = false
let streamReleases: Array<() => void> = []
let visionReleases: Array<() => void> = []

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
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  const queues = await import("../src/llm/run-queues")
  const lease = await import("../src/ws/composer-lease")
  const abortReg = await import("../src/computer/task-abort-registry")
  const log = await import("../src/logger")
  handleMessage = mr.handleMessage
  listLlmActiveThreadIds = mr.listLlmActiveThreadIds
  __testSetLlmActiveForTests = mr.__testSetLlmActiveForTests
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  peekNextRunCount = queues.peekNextRunCount
  enqueueNextRun = queues.enqueueNextRun
  takeSteer = queues.takeSteer
  _resetRunQueuesForTests = queues._resetRunQueuesForTests
  MAX_NEXT_RUN = queues.MAX_NEXT_RUN
  MAX_STEER = queues.MAX_STEER
  composerLeases = lease.composerLeases
  getComputerTaskAbortRegistry = abortReg.getComputerTaskAbortRegistry
  getLogFilePath = log.getLogFilePath
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

  // Patch OpenAI completions.create to avoid real network calls. The same
  // prototype serves the main provider (stream:true), analyzeImage (vision
  // model), and title generation (everything else). Load openai through
  // createRequire so we patch the CJS instance the providers actually use
  // (a bare `await import("openai")` can resolve the ESM build under tsx —
  // dual-package hazard — which is a different module record).
  const cjsRequire = createRequire(__filename)
  const openaiMod = cjsRequire("openai")
  const OpenAI = openaiMod?.default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://127.0.0.1:9", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function (params: any, options?: any) {
    if (params?.stream === true) return makeStream(options?.signal)
    if (params?.model === VISION_MODEL) {
      visionCalls++
      if (holdVision) {
        await new Promise<void>((resolve) => {
          visionReleases.push(resolve)
        })
      }
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
  visionCalls = 0
  holdStreams = false
  holdVision = false
  streamReleases = []
  visionReleases = []
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

function makeSession(sent: any[], surface?: "tray" | "summoner") {
  return {
    sendToExtension: (data: any) => sent.push(data),
    executeTool: async () => ({ success: true, data: {} }),
    ...(surface ? { surface } : {}),
  } as any
}

function makeServices(tm: InstanceType<typeof ThreadManager>) {
  return { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any }
}

function uploadMsg(threadId: string, tag: number) {
  // tag varies the bytes so the vision description cache never short-circuits
  // a hold with a cross-test cache hit.
  const buf = Buffer.concat([PNG, Buffer.from([tag & 0xff])])
  return {
    type: "file.upload",
    thread_id: threadId,
    message: "看下这张图",
    files: [{ name: "a.png", type: "image/png", content: buf.toString("base64") }],
  }
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

function releaseHeldVision(): void {
  holdVision = false
  visionReleases.forEach((r) => r())
  visionReleases = []
}

test("P1 TOCTOU: chat.create during file.upload parse is run_active, no orphan stream", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "toctou-entry")
  const sent: any[] = []

  holdVision = true
  const uploadPromise = handleMessage(
    uploadMsg(thread.id, 1),
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => visionCalls === 1, "vision analysis started (parse phase)")

  // The slot must be claimed while the upload is still in its parse/vision phase.
  assert.ok(
    listLlmActiveThreadIds().includes(thread.id),
    "file.upload must claim the LLM slot at entry, before parse awaits",
  )
  const midCreate = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "concurrent create" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(midCreate.type, "error")
  assert.equal(midCreate.error, "run_active")
  assert.equal(midCreate.thread_id, thread.id)
  const midUpload = await handleMessage(
    { type: "file.upload", thread_id: thread.id, files: [] },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(midUpload.error, "run_active")
  assert.equal(streamCalls, 0, "no parallel LLM stream may start during upload parse")

  releaseHeldVision()
  const resp = await uploadPromise
  assert.equal(resp.type, "file.uploaded")
  assert.equal(streamCalls, 1, "only the upload's own chatCreate ran")
  assert.ok(!listLlmActiveThreadIds().includes(thread.id), "slot freed after upload")
})

test("P1 cleanup: early return after entry claim frees the slot", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "toctou-cleanup")
  const sent: any[] = []

  // Tiny max_file_size forces the size-check uploadError after the entry claim.
  saveConfig({
    file_upload: {
      max_file_size: 8,
      allowed_types: [],
      max_embedded_images: 20,
      enable_vision_analysis: true,
      max_file_tokens: 50000,
    },
  } as any)
  try {
    const resp = await handleMessage(
      {
        type: "file.upload",
        thread_id: thread.id,
        files: [
          {
            name: "big.txt",
            type: "text/plain",
            content: Buffer.from("definitely larger than eight bytes").toString("base64"),
          },
        ],
      },
      makeServices(tm),
      makeSession(sent),
    )
    assert.equal(resp.type, "file.upload_error")
    assert.ok(
      !listLlmActiveThreadIds().includes(thread.id),
      "early return must free the entry claim (thread not stuck run_active)",
    )

    // The thread accepts a fresh chat.create immediately after.
    const follow = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "after failed upload" },
      makeServices(tm),
      makeSession(sent),
    )
    assert.equal(follow, null, "chat.create after failed upload must run, not run_active")
    assert.equal(streamCalls, 1)
  } finally {
    saveConfig({
      file_upload: {
        max_file_size: 10 * 1024 * 1024,
        allowed_types: [],
        max_embedded_images: 20,
        enable_vision_analysis: true,
        max_file_tokens: 50000,
      },
    } as any)
  }
})

test("P1 drain gate: lease-rejected drain keeps the message queued", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "drain-gate")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "second", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")
  assert.equal(enq.depth, 1)

  // Flip the composer lease to overlay: a panel/tray-surface drain is rejected.
  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    releaseHeldStreams()
    const resp = await createPromise
    assert.equal(resp, null, "occupied create RPC still succeeds; drain gate is pushed not returned")
    const pushed = sent.find((m) => m?.data?.error_code === "OVERLAY_STANDBY")
    assert.ok(pushed, "gate error must be pushed on the session")
    assert.equal(pushed.thread_id, thread.id)
    assert.equal(
      peekNextRunCount(thread.id),
      1,
      "rejected drain must leave the message queued (client holds chat.enqueued)",
    )
    assert.equal(streamCalls, 1, "queued run must not start while gate-rejected")
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("P1 drain: overlay-held lease drains when session.surface is summoner", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "overlay-drain-ok")
  const sent: any[] = []
  const session = makeSession(sent, "summoner")

  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    holdStreams = true
    const createPromise = handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "first", __cmspark_surface: "summoner" },
      makeServices(tm),
      session,
    )
    await waitFor(() => streamCalls === 1, "first run streaming")

    const enq = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "second", enqueue: true, __cmspark_surface: "summoner" },
      makeServices(tm),
      session,
    )
    assert.equal(enq.type, "chat.enqueued")

    releaseHeldStreams()
    const resp = await createPromise
    assert.equal(resp, null)
    assert.equal(streamCalls, 2, "overlay nextRun drain must run as summoner, not OVERLAY_STANDBY")
    assert.equal(peekNextRunCount(thread.id), 0, "queue empty because it ran")
    assert.ok(!sent.some((m) => m?.data?.error_code === "OVERLAY_STANDBY"))
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("P1 drain gate: overlay-rejected upload drain still returns file.uploaded", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "upload-drain-gate")
  const sent: any[] = []

  holdVision = true
  const uploadPromise = handleMessage(
    uploadMsg(thread.id, 9),
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => visionCalls === 1, "vision analysis started (parse phase)")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued during upload", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    releaseHeldVision()
    const resp = await uploadPromise
    assert.equal(resp.type, "file.uploaded", "upload ack must not be replaced by OVERLAY_STANDBY")
    assert.ok(sent.some((m) => m?.data?.error_code === "OVERLAY_STANDBY"))
    assert.equal(peekNextRunCount(thread.id), 1, "rejected drain keeps the queued turn")
    assert.equal(streamCalls, 1, "queued run must not start")
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("P1 drain gate: trashed thread keeps nextRun queued (S-B1)", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "drain-trashed")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued then trashed", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  tm.trash(thread.id)
  releaseHeldStreams()
  const resp = await createPromise
  assert.equal(resp, null)
  const pushed = sent.find((m) => m?.data?.error_code === "thread_trashed")
  assert.ok(pushed, "trash gate must be pushed, not silent")
  assert.equal(pushed.thread_id, thread.id)
  assert.equal(peekNextRunCount(thread.id), 1, "trashed drain must not take the queued turn")
  assert.equal(streamCalls, 1)
})

test("P1 drain gate: paused thread keeps nextRun queued (S-B1)", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "drain-paused")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued then paused", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  tm.update(thread.id, { paused: true })
  releaseHeldStreams()
  const resp = await createPromise
  assert.equal(resp, null)
  const pushed = sent.find((m) => m?.data?.error_code === "thread_paused")
  assert.ok(pushed, "pause gate must be pushed, not silent")
  assert.equal(pushed.thread_id, thread.id)
  assert.equal(peekNextRunCount(thread.id), 1, "paused drain must not take the queued turn")
  assert.equal(streamCalls, 1)
})

test("P1 drain gate: overlay-rejected regenerate keeps the queue (S-B2)", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "regen-drain-gate")
  const sent: any[] = []
  tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "original question" })
  const a1 = tm.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "original answer" })

  holdStreams = true
  const regenPromise = handleMessage(
    { type: "chat.regenerate", thread_id: thread.id, message_id: a1.id },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "regenerate run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued during regen", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    releaseHeldStreams()
    const resp = await regenPromise
    assert.equal(resp, null, "regen RPC stays null; overlay gate is pushed")
    assert.ok(sent.some((m) => m?.data?.error_code === "OVERLAY_STANDBY"))
    assert.equal(peekNextRunCount(thread.id), 1)
    assert.equal(streamCalls, 1)
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("P1 drain gate: conductor-rejected overlay drain keeps the queue (S-B2)", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "drain-conductor")
  const sent: any[] = []
  const session = makeSession(sent, "summoner")
  const registry = getComputerTaskAbortRegistry()
  registry.clear()

  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first", __cmspark_surface: "summoner" },
    makeServices(tm),
    session,
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued under CU", enqueue: true, __cmspark_surface: "summoner" },
    makeServices(tm),
    session,
  )
  assert.equal(enq.type, "chat.enqueued")

  registry.set("cu-live", true)
    releaseHeldStreams()
    const resp = await createPromise
    assert.equal(resp, null)
    const pushed = sent.find((m) => m?.data?.error_code === "L2_CONDUCTOR_ELSEWHERE")
    assert.ok(pushed, "conductor gate must be pushed")
    assert.equal(peekNextRunCount(thread.id), 1)
    assert.equal(streamCalls, 1)
  } finally {
    registry.clear()
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("enqueue nextRun preserves clientMessageId into drained chat.create (S-A1)", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "enqueue-cmid")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    {
      type: "chat.create",
      thread_id: thread.id,
      message: "queued with bubble",
      enqueue: true,
      clientMessageId: "cm-enq-1",
    },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  releaseHeldStreams()
  await createPromise
  const users = sent.filter((m) => m.type === "chat.user")
  const drained = users.find((m) => m.content === "queued with bubble")
  assert.ok(drained, "drained turn must echo chat.user")
  assert.equal(drained.client_message_id, "cm-enq-1")
})

test("P1 drain parity: file.upload completion drains one queued nextRun", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "upload-drain")
  const sent: any[] = []

  holdVision = true
  const uploadPromise = handleMessage(
    uploadMsg(thread.id, 2),
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => visionCalls === 1, "vision analysis started (parse phase)")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued during upload", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")
  assert.equal(enq.depth, 1)

  releaseHeldVision()
  const resp = await uploadPromise
  assert.equal(resp.type, "file.uploaded")
  assert.equal(streamCalls, 2, "upload chatCreate + drained queued run both executed")
  assert.equal(peekNextRunCount(thread.id), 0, "queue drained")
  assert.equal(sent.filter((m) => m.type === "chat.user").length, 2)
  assert.equal(sent.filter((m) => m.type === "chat.done").length, 2)
})

test("P1 drain parity: chat.regenerate completion drains one queued nextRun", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "regen-drain")
  const sent: any[] = []
  tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "original question" })
  const a1 = tm.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "original answer" })

  holdStreams = true
  const regenPromise = handleMessage(
    { type: "chat.regenerate", thread_id: thread.id, message_id: a1.id },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "regenerate run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued during regen", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  releaseHeldStreams()
  const resp = await regenPromise
  assert.ok(resp == null, "regenerate returns null after a clean drain")
  assert.equal(streamCalls, 2, "regenerate + drained queued run both executed")
  assert.equal(peekNextRunCount(thread.id), 0, "queue drained")
  assert.equal(sent.filter((m) => m.type === "chat.done").length, 2)
})

test("#291: chat.abort clears the queued nextRun — stop never silently revives", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "abort-clears-queue")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued before abort", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  const abortResp = await handleMessage(
    { type: "chat.abort", thread_id: thread.id },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(abortResp.type, "chat.aborted")
  assert.equal(abortResp.thread_id, thread.id)
  assert.equal(abortResp.stopped, true, "controller existed — ACK must say so")
  assert.equal(abortResp.cancelled, 1, "queued message was cancelled by the stop")
  assert.equal(
    peekNextRunCount(thread.id),
    0,
    "stop clears the nextRun queue synchronously, before the ACK returns",
  )
  await createPromise

  // No deferred pickup, no gate, no path may restart the queued run.
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(streamCalls, 1, "aborted thread must not revive from the queue")
  assert.equal(
    sent.filter((m) => m.type === "chat.user" && m.content === "queued before abort").length,
    0,
    "cancelled queued message never becomes a run",
  )
  assert.equal(
    sent.filter((m) => m.type === "chat.aborted").length,
    0,
    "aborted run stays silent (SEC-D generation mismatch) — only the WS ack is chat.aborted",
  )
})

test("#291: chat.abort clears the queue even when the composer lease is overlay-held", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "abort-clears-gated")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "first run streaming")

  const enq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "queued before abort", enqueue: true },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(enq.type, "chat.enqueued")

  // Overlay holds the composer: a revived drain would be lease-rejected and
  // leave the message queued — a landmine for the next unrelated chat.create.
  // An explicit user stop must clear it outright instead.
  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    const abortResp = await handleMessage(
      { type: "chat.abort", thread_id: thread.id },
      makeServices(tm),
      makeSession(sent),
    )
    assert.equal(abortResp.type, "chat.aborted")
    assert.equal(abortResp.stopped, true)
    assert.equal(abortResp.cancelled, 1)
    await createPromise

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(peekNextRunCount(thread.id), 0, "stop clears the queue; no gate landmine left")
    assert.equal(streamCalls, 1, "no post-abort revival attempt")
    assert.ok(
      !sent.some((m) => m.type === "chat.error" && m.data?.error_code === "OVERLAY_STANDBY"),
      "no deferred drain → no spurious OVERLAY_STANDBY after a stop",
    )
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("#291: chat.abort on a thread with no running controller ACKs stopped:false", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "abort-idle")
  const sent: any[] = []

  const resp = await handleMessage(
    { type: "chat.abort", thread_id: thread.id },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(resp.type, "chat.aborted")
  assert.equal(resp.thread_id, thread.id)
  assert.equal(resp.stopped, false, "no controller — the ACK must not claim a stop")
  assert.equal(resp.cancelled, 0)

  const noId = await handleMessage(
    { type: "chat.abort" },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(noId.type, "chat.aborted")
  assert.equal(noId.stopped, false, "missing thread_id is an honest no-op, never a fake stop")
})

test("#291: chat.abort with queued nextRun but no active run → stopped:false, queue cleared", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "abort-queued-idle")
  const sent: any[] = []

  // Queue directly: an idle chat.create enqueue is rejected (idle_enqueue), so
  // seed the queue the way a leftover-steer conversion would.
  assert.equal(enqueueNextRun(thread.id, "leftover one"), true)
  assert.equal(enqueueNextRun(thread.id, "leftover two"), true)

  const resp = await handleMessage(
    { type: "chat.abort", thread_id: thread.id },
    makeServices(tm),
    makeSession(sent),
  )
  assert.equal(resp.stopped, false, "nothing was running")
  assert.equal(resp.cancelled, 2, "stop still cancels the user's queued messages")
  assert.equal(peekNextRunCount(thread.id), 0)
})

test("#291: every chat.abort is logged with thread_id + had_controller", async () => {
  const tm = new ThreadManager()
  const running = tm.create("", "abort-log-running")
  const idle = tm.create("", "abort-log-idle")
  const sent: any[] = []

  holdStreams = true
  const createPromise = handleMessage(
    { type: "chat.create", thread_id: running.id, message: "first" },
    makeServices(tm),
    makeSession(sent),
  )
  await waitFor(() => streamCalls === 1, "run streaming")

  await handleMessage({ type: "chat.abort", thread_id: running.id }, makeServices(tm), makeSession(sent))
  await handleMessage({ type: "chat.abort", thread_id: idle.id }, makeServices(tm), makeSession(sent))
  await createPromise

  const lines = fs
    .readFileSync(getLogFilePath(), "utf8")
    .split("\n")
    .filter((l) => l.includes("chat.abort"))
    .map((l) => JSON.parse(l))
  const forRunning = lines.find((l) => l.data?.thread_id === running.id)
  const forIdle = lines.find((l) => l.data?.thread_id === idle.id)
  assert.ok(forRunning, "abort of the running thread must be logged")
  assert.equal(forRunning.data.had_controller, true)
  assert.ok(forIdle, "abort of the idle thread must be logged")
  assert.equal(forIdle.data.had_controller, false)
})

test("P2 D6: chat.steer passes client_message_id through and echoes it in the ack", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "steer-cmid")

  __testSetLlmActiveForTests(thread.id, true)
  try {
    const ok = await handleMessage(
      {
        type: "chat.steer",
        thread_id: thread.id,
        message: "focus tests",
        client_message_id: "csm-1",
      },
      makeServices(tm),
    )
    assert.equal(ok.type, "chat.steered")
    assert.equal(ok.thread_id, thread.id)
    assert.equal(ok.client_message_id, "csm-1", "ack must echo client_message_id")
    assert.deepEqual(takeSteer(thread.id), [{ text: "focus tests", clientMessageId: "csm-1" }])

    const noId = await handleMessage(
      { type: "chat.steer", thread_id: thread.id, message: "no id here" },
      makeServices(tm),
    )
    assert.equal(noId.type, "chat.steered")
    assert.ok(!("client_message_id" in noId), "ack omits client_message_id when absent")
    assert.deepEqual(takeSteer(thread.id), [{ text: "no id here" }])

    const badId = await handleMessage(
      {
        type: "chat.steer",
        thread_id: thread.id,
        message: "bad id",
        client_message_id: 123,
      },
      makeServices(tm),
    )
    assert.equal(badId.type, "chat.steered")
    assert.ok(!("client_message_id" in badId), "non-string client_message_id must not be echoed")
    assert.deepEqual(takeSteer(thread.id), [{ text: "bad id" }])
  } finally {
    __testSetLlmActiveForTests(thread.id, false)
  }
})

test("P2 wire: thread-domain rejection frames all carry thread_id", async () => {
  const tm = new ThreadManager()
  const thread = tm.create("", "reject-thread-id")
  const sent: any[] = []
  const services = () => makeServices(tm)

  // no_active_run
  const steerIdle = await handleMessage(
    { type: "chat.steer", thread_id: thread.id, message: "hi" },
    services(),
  )
  assert.equal(steerIdle.error, "no_active_run")
  assert.equal(steerIdle.thread_id, thread.id)

  // idle_enqueue
  const idleEnq = await handleMessage(
    { type: "chat.create", thread_id: thread.id, message: "hi", enqueue: true },
    services(),
    makeSession(sent),
  )
  assert.equal(idleEnq.error, "idle_enqueue")
  assert.equal(idleEnq.thread_id, thread.id)

  __testSetLlmActiveForTests(thread.id, true)
  try {
    // run_active
    const active = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "hi" },
      services(),
      makeSession(sent),
    )
    assert.equal(active.error, "run_active")
    assert.equal(active.thread_id, thread.id)

    // queue_full
    for (let i = 0; i < MAX_NEXT_RUN; i++) {
      const enq = await handleMessage(
        { type: "chat.create", thread_id: thread.id, message: `q${i}`, enqueue: true },
        services(),
        makeSession(sent),
      )
      assert.equal(enq.type, "chat.enqueued")
    }
    const full = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "overflow", enqueue: true },
      services(),
      makeSession(sent),
    )
    assert.equal(full.error, "queue_full")
    assert.equal(full.thread_id, thread.id)

    // empty_enqueue
    const emptyEnq = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "   ", enqueue: true },
      services(),
      makeSession(sent),
    )
    assert.equal(emptyEnq.error, "empty_enqueue")
    assert.equal(emptyEnq.thread_id, thread.id)

    // steer_queue_full
    for (let i = 0; i < MAX_STEER; i++) {
      const s = await handleMessage(
        { type: "chat.steer", thread_id: thread.id, message: `s${i}` },
        services(),
      )
      assert.equal(s.type, "chat.steered")
    }
    const steerFull = await handleMessage(
      { type: "chat.steer", thread_id: thread.id, message: "overflow" },
      services(),
    )
    assert.equal(steerFull.error, "steer_queue_full")
    assert.equal(steerFull.thread_id, thread.id)

    // file.upload run_active also carries thread_id
    const busyUpload = await handleMessage(
      { type: "file.upload", thread_id: thread.id, files: [] },
      services(),
      makeSession(sent),
    )
    assert.equal(busyUpload.error, "run_active")
    assert.equal(busyUpload.thread_id, thread.id)
  } finally {
    __testSetLlmActiveForTests(thread.id, false)
    _resetRunQueuesForTests()
  }

  // OVERLAY_STANDBY lease rejection (chat.error) carries thread_id
  const beforeClaim = composerLeases.get(thread.id)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: beforeClaim.rev })
  try {
    const gated = await handleMessage(
      { type: "chat.create", thread_id: thread.id, message: "hi", __cmspark_surface: "tray" },
      services(),
      makeSession(sent),
    )
    assert.equal(gated.type, "chat.error")
    assert.equal(gated.data?.error_code, "OVERLAY_STANDBY")
    assert.equal(gated.thread_id, thread.id)
  } finally {
    const cur = composerLeases.get(thread.id)
    composerLeases.release({ thread_id: thread.id, rev: cur.rev })
  }
})

test("upload and regen drain never return the drain frame as the RPC (S-B3/N3)", () => {
  const candidates = [
    path.resolve(__dirname, "..", "src", "message-router.ts"),
    path.resolve(__dirname, "..", "..", "src", "message-router.ts"),
  ]
  const srcPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
  const src = fs.readFileSync(srcPath, "utf8")
  assert.doesNotMatch(src, /return drainedAfterUpload/)
  assert.doesNotMatch(src, /return drainedAfterRegen/)
  assert.match(src, /canAcquireMultiAgentLlmLoop/)
  const drain = src.slice(src.indexOf("async function drainNextRun"), src.indexOf("function isDrainGateError"))
  const takeAt = drain.indexOf("const queued = takeNextRun")
  const capAt = drain.indexOf("canAcquireMultiAgentLlmLoop")
  assert.ok(capAt >= 0 && takeAt >= 0 && capAt < takeAt, "MULTI_AGENT_LLM_CAP peek must run before takeNextRun (N-B4)")
})
