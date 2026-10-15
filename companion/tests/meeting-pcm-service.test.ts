import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SttSessionService, type SttStartRequest } from "../src/voice/stt-session-service"
import { MEETING_PCM as C } from "../src/voice/meeting-pcm-contract"

const identity = { meeting_id: "mtg_owned494", capture_id: "00000000-0000-4000-8000-000000000494", capture_epoch: 1 }
const request: SttStartRequest = { sessionId: identity.capture_id, modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1 }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
// Declared producer fault, never a polling budget: entered must arrive even after
// more turns than the removed 1000-iteration scheduler guess.
async function deferRunner(turns: number) { for (let i = 0; i < turns; i++) await new Promise<void>(r => setImmediate(r)) }


for (const deferredTurns of [0, 1100]) test("real single-slot service continues receiving during deferred runner and holds lease between jobs" + (deferredTurns ? " after declared 1100-turn runner entry" : ""), { timeout: 20000 }, async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-494-service-"))
  const modelRoot = path.join(owned, "models"); fs.mkdirSync(modelRoot)
  let active = 0, maxActive = 0
  const runs: Array<{ finish: () => void; bytes: Buffer }> = [], saved: number[] = [], statuses: any[] = []
  const entered = [deferred(), deferred(), deferred()], terminal = deferred(); let cleaning = false
  const service = new SttSessionService({ dataDir: owned, whisperRoot: modelRoot,
    probeModel: () => ({ status: "ready" }), resolveModelPath: () => path.join(modelRoot, "owned.bin"),
    resolveBinary: () => ({ ok: true, path: path.join(owned, "owned-no-process"), arch: "darwin-arm64", sha256: "test", pinned: true }),
    runWhisper: async opts => {
      active++; maxActive = Math.max(maxActive, active)
      const bytes = fs.readFileSync(opts.audioPath)
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF")
      assert.ok(bytes.length <= 256044)
      if (runs.length === 0) await deferRunner(deferredTurns)
      if (!cleaning) await new Promise<void>(resolve => { runs.push({ finish: resolve, bytes }); entered[runs.length - 1].resolve() })
      active--; return { text: "owned synthetic ASR", ms: 5 }
    },
  })
  const capture = service.reserveMeetingCapture(identity, "peerA", {
    persist: segment => { saved.push(segment.end) }, checkpoint: status => statuses.push(status), send: status => {
      statuses.push(status)
      if (status.capture_id === identity.capture_id && status.capture_epoch === identity.capture_epoch &&
        (status.phase === "finished" || status.phase === "failed") && service.getMeetingCapture() === null) terminal.resolve()
    },
  })!
  try {
    assert.ok(capture)
    assert.equal(service.prepareMeetingCapture(request, "peerA", identity.capture_id, 1).ok, true)
    const append = (frames: number = C.blockFrames) => {
      const credit = capture.queue.credits()[0]!
      assert.ok(credit)
      return capture.append(credit.credit_id, credit.sample_offset, frames, Buffer.alloc(frames * 2, 7))
    }
    for (let i = 0; i < 200; i++) append()
    await entered[0].promise
    assert.equal(capture.queue.receivedEnd, C.segmentFrames)
    for (let i = 0; i < 200; i++) append()
    assert.equal(capture.queue.receivedEnd, 2 * C.segmentFrames, "new samples queue while the real service awaits inference")
    assert.equal(runs.length, 1)
    assert.equal(saved.length, 0)
    assert.equal(service.start({ ...request, sessionId: "legacy-other" }, "peerB").ok, false)
    assert.equal(service.abort("stale-legacy-sid", "peerA").ok, false)
    assert.equal(capture.owns("peerB", identity.capture_id, 1), false)
    assert.equal(capture.owns("peerA", identity.capture_id, 0), false)
    runs[0].finish()
    await entered[1].promise
    assert.deepEqual(saved, [C.segmentFrames])
    append(3)
    capture.seal(2 * C.segmentFrames + 3, "user_stop")
    runs[1].finish()
    await entered[2].promise
    runs[2].finish()
    await terminal.promise
    assert.equal(maxActive, 1)
    assert.deepEqual(saved, [C.segmentFrames, 2 * C.segmentFrames, 2 * C.segmentFrames + 3])
    const final = capture.status()
    assert.equal(final.phase, "finished"); assert.equal(final.completion.prefix_complete, true)
    assert.equal(final.completion.outcome, "complete"); assert.equal(final.resident_seconds, 0)
    assert.equal(active, 0)
  } finally {
    cleaning = true; service.forceAbort(); for (const run of runs) run.finish()
    if (service.getMeetingCapture() === capture) await terminal.promise
    assert.equal(active, 0)
    fs.rmSync(owned, { recursive: true, force: true })
    assert.equal(fs.existsSync(owned), false)
  }
})

for (const deferredTurns of [0, 1100]) test("cancel does not release the global reservation until the actual delayed runner settles" + (deferredTurns ? " after declared 1100-turn runner entry" : ""), { timeout: 20000 }, async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-494-retire-")); const root = path.join(owned, "models")
  fs.mkdirSync(root); let finish: (() => void) | undefined; let persisted = 0, cleaning = false
  const runnerEntered = deferred(), terminal = deferred()
  const service = new SttSessionService({ dataDir: owned, whisperRoot: root,
    probeModel: () => ({ status: "ready" }), resolveModelPath: () => path.join(root, "owned.bin"),
    resolveBinary: () => ({ ok: true, path: "OWNED_NOT_EXECUTED", arch: "darwin-arm64", sha256: "test", pinned: true }),
    runWhisper: async () => { await deferRunner(deferredTurns); if (!cleaning) await new Promise<void>(r => { finish = r; runnerEntered.resolve() }); return { text: "late", ms: 1 } },
  })
  const capture = service.reserveMeetingCapture(identity, "peerA", { persist: () => { persisted++ }, checkpoint() {}, send(status) {
    if (status.capture_id === identity.capture_id && status.capture_epoch === identity.capture_epoch &&
      (status.phase === "finished" || status.phase === "failed") && service.getMeetingCapture() === null) terminal.resolve()
  } })!
  try {
    service.prepareMeetingCapture(request, "peerA", identity.capture_id, 1)
    for (let i = 0; i < 200; i++) { const c = capture.queue.credits()[0]; capture.append(c.credit_id, c.sample_offset, 640, Buffer.alloc(1280)) }
    await runnerEntered.promise
    capture.cancel()
    assert.equal(service.getMeetingCapture(), capture)
    assert.equal(service.start({ ...request, sessionId: "other" }, "peerA").ok, false)
    assert.equal(capture.status().resident_seconds, 0)
    finish!()
    await terminal.promise
    assert.equal(persisted, 0)
    assert.equal(capture.status().completion.outcome, "cancelled")
  } finally { cleaning = true; finish?.(); service.forceAbort(); if (service.getMeetingCapture() === capture) await terminal.promise; fs.rmSync(owned, { recursive: true, force: true }) }
})

test("actual capture hard deadline stops admission but preserves already reserved tail for the 2s seal barrier", { timeout: 20000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { MeetingPcmCapture } = await import("../src/voice/meeting-pcm-capture")
  const statuses: any[] = [], terminal = deferred()
  const capture = new MeetingPcmCapture(identity, "peerA", {
    run: async () => ({ ok: true, text: "owned", ms: 1, modelId: "medium" }),
    persist() {}, checkpoint() {}, send: status => statuses.push(status), retired() { terminal.resolve() }, abortRun() {},
  })
  try {
    capture.activate(request)
    for (let i = 0; i < 1199; i++) {
      t.mock.timers.tick(9000)
      const credit = capture.queue.credits()[0]
      capture.append(credit.credit_id, credit.sample_offset, 640, Buffer.alloc(1280))
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    }
    const tail = capture.queue.credits()[0]
    t.mock.timers.tick(9000)
    assert.equal(capture.status().input_open, false)
    assert.equal(capture.status().stop_reason, "hard_limit")
    assert.equal(capture.queue.finalEnd, null, "server cannot truncate samples already covered by an outstanding credit")
    capture.append(tail.credit_id, tail.sample_offset, 3, Buffer.alloc(6))
    capture.seal(tail.sample_offset + 3, "hard_limit")
    await terminal.promise
    assert.equal(capture.status().phase, "finished")
    assert.equal(capture.status().completion.outcome, "limited")
    assert.equal(capture.status().committed_end, tail.sample_offset + 3)
  } finally { capture.cancel(); t.mock.timers.reset() }
})

for (const deadline of ["startup", "idle", "flush"] as const) {
  test(`actual capture ${deadline} deadline fails closed at the reviewed boundary`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { MeetingPcmCapture } = await import("../src/voice/meeting-pcm-capture")
    let retired = 0, runs = 0
    const capture = new MeetingPcmCapture(identity, "peerA", { run: async () => { runs++; return { ok: true, text: "owned", ms: 1, modelId: "medium" } },
      persist() {}, checkpoint() {}, send() {}, retired() { retired++ }, abortRun() {} })
    try {
      if (deadline !== "startup") capture.activate(request)
      if (deadline === "flush") capture.seal(640, "user_stop")
      const ms = deadline === "startup" ? C.startupMs : deadline === "idle" ? C.idleMs : C.flushMs
      t.mock.timers.tick(ms - 1); assert.equal(retired, 0)
      t.mock.timers.tick(1)
      assert.equal(capture.status().phase, "failed")
      assert.equal(capture.status().code, deadline === "startup" ? "startup_timeout" : deadline === "idle" ? "network_unknown" : "capture_flush_timeout")
      assert.equal(retired, 1); assert.equal(runs, 0); assert.equal(capture.queue.residentFrames, 0)
    } finally { capture.cancel(); t.mock.timers.reset() }
  })
}

test("actual job timeout and cleanup feedback do not release an unsettled runner or persist its late result", { timeout: 20000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { MeetingPcmCapture } = await import("../src/voice/meeting-pcm-capture")
  let resolve!: (result: any) => void, retired = 0, persisted = 0, aborts = 0
  const terminal = deferred()
  const capture = new MeetingPcmCapture(identity, "peerA", { run: () => new Promise(r => { resolve = r }),
    persist() { persisted++ }, checkpoint() {}, send() {}, retired() { retired++; terminal.resolve() }, abortRun() { aborts++ } })
  try {
    capture.activate(request)
    for (let i = 0; i < 200; i++) { const c = capture.queue.credits()[0]; capture.append(c.credit_id, c.sample_offset, 640, Buffer.alloc(1280)) }
    capture.seal(C.segmentFrames, "user_stop")
    t.mock.timers.tick(C.jobMs - 1); assert.equal(retired, 0); assert.equal(aborts, 0)
    t.mock.timers.tick(1); assert.equal(capture.status().phase, "retiring"); assert.equal(capture.status().code, "infer_timeout")
    assert.equal(retired, 0); assert.equal(persisted, 0); assert.equal(aborts, 1)
    t.mock.timers.tick(C.cleanupMs); assert.equal(capture.status().code, "cleanup_pending"); assert.equal(retired, 0)
    resolve({ ok: true, text: "late forbidden append", ms: 1, modelId: "medium" })
    await terminal.promise
    assert.equal(retired, 1); assert.equal(persisted, 0); assert.equal(capture.status().phase, "failed")
    assert.equal(capture.status().inflight_segment, null); assert.equal(capture.queue.residentFrames, 0)
  } finally { capture.cancel(); t.mock.timers.reset() }
})

test("actual complete-job deadline includes synchronous checkpoint/notification after durable prefix commit", { timeout: 20000 }, async () => {
  const { MeetingPcmCapture } = await import("../src/voice/meeting-pcm-capture")
  let now = 0, retired = 0
  const terminal = deferred()
  const capture = new MeetingPcmCapture(identity, "peerA", { now: () => now,
    run: async () => ({ ok: true, text: "owned committed prefix", ms: 1, modelId: "medium" }),
    persist() {}, checkpoint() {}, send(status) { if (status.committed_end) now = C.jobMs + 1 }, retired() { retired++; terminal.resolve() }, abortRun() {} })
  try {
    capture.activate(request)
    for (let i = 0; i < 200; i++) { const c = capture.queue.credits()[0]; capture.append(c.credit_id, c.sample_offset, 640, Buffer.alloc(1280)) }
    capture.seal(C.segmentFrames, "user_stop")
    await terminal.promise
    assert.equal(capture.status().phase, "failed")
    assert.equal(capture.status().code, "infer_timeout")
    assert.equal(capture.status().committed_end, C.segmentFrames, "a timeout cannot roll back an already durable prefix")
    assert.equal(retired, 1)
  } finally { capture.cancel() }
})
