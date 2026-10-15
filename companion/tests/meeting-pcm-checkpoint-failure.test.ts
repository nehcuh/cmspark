import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as path from "node:path"
import { DATA_DIR, setVoiceFields } from "../src/config"
import { createMeeting, loadMeeting, deleteMeeting } from "../src/meeting/meeting-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { handleVoiceSttMessage } from "../src/voice/stt-handlers"
import { SttSessionService } from "../src/voice/stt-session-service"
import { validateWsMessage } from "../src/ws/validate"

// Real atomic store boundary; only the owned meeting's metadata rename fails.
const fs = require("node:fs") as typeof import("node:fs")
for (const mode of ["none", "draining-once", "finished-once", "finished-tail-once", "persistent"] as const) {
  test(`actual q1 metadata checkpoint ${mode} never acknowledges an unsaved complete outcome`, { timeout: 20000 }, async () => {
    setVoiceFields({ sttEngine: "local", localModelId: "medium" })
    const meeting = createMeeting({ title: "owned checkpoint failure control" })
    const notifications: any[] = []
    let settled!: () => void
    const terminalNotification = new Promise<void>(resolve => { settled = resolve })
    const captureId = "00000000-0000-4000-8000-000000000594"
    let runs = 0, failures = 0
    const service = new SttSessionService({
      dataDir: DATA_DIR, whisperRoot: path.join(DATA_DIR, "models", "owned"),
      probeModel: () => ({ status: "ready" }), resolveModelPath: () => path.join(DATA_DIR, "models", "owned", "owned.bin"),
      resolveBinary: () => ({ ok: true, path: "OWNED_NO_NATIVE_PROCESS", arch: "darwin-arm64", pinned: true, sha256: "test" }),
      runWhisper: async () => { runs++; return { text: "owned saved prefix", ms: 1 } },
    })
    const ctx = { origin: "chrome-extension://owned494", surface: "panel", peerId: "owned-checkpoint", send: (m: any) => {
      notifications.push(m)
      if (m.capture_id === captureId && m.capture_epoch === 1 &&
        (m.phase === "finished" || m.phase === "failed") && service.getMeetingCapture() === null) settled()
    } }
    const rename = fs.renameSync
    try {
      const started = await handleMeetingMessage({ type: "meeting.start", v: 1, id: meeting.id, queue_contract: 1,
        capture_id: captureId, expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true, audio_retained: false }, ctx, { sttService: service })
      assert.equal(started.type, "meeting.started")
      const receiving = await handleVoiceSttMessage({ type: "voice.stt.start", v: 1, sessionId: captureId, queue_contract: 1,
        capture_epoch: 1, modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1, privacy_ack_v2: true }, ctx, { service })
      assert.equal(receiving.credits.length, 8)
      const capture = service.getMeetingCapture()!
      const frames = mode === "finished-tail-once" ? 96 : 0
      if (frames) {
        await handleVoiceSttMessage({ type: "voice.stt.chunk", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
          credit_id: receiving.credits[0].credit_id, sample_offset: 0, frame_count: frames, data: Buffer.alloc(frames * 2).toString("base64") }, ctx, { service })
      }
      fs.renameSync = ((from: any, to: any) => {
        if (String(to) === path.join(DATA_DIR, "meetings", meeting.id, "meta.json")) {
          const phase = JSON.parse(fs.readFileSync(from, "utf8")).capture_summary?.phase
          const target = mode === "persistent" || (!failures && (
            mode === "draining-once" && phase === "draining" ||
            (mode === "finished-once" || mode === "finished-tail-once") && phase === "finished"))
          if (target) { failures++; throw Object.assign(new Error("owned checkpoint EIO"), { code: "EIO" }) }
        }
        return rename(from, to)
      }) as typeof fs.renameSync
      const end = { type: "voice.stt.end", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
        final_sample_end: frames, last_credit_id: frames ? 1 : 0, stop_reason: "user_stop" }
      assert.equal(validateWsMessage(end).valid, true)
      await handleVoiceSttMessage(end, ctx, { service })
      await terminalNotification
      assert.equal(service.getMeetingCapture() === null, true, "settled failure releases its own lease")
      const status = capture.status()
      const stored = loadMeeting(meeting.id)!
      if (mode === "none") {
        assert.equal(failures, 0); assert.equal(status.completion.outcome, "complete")
        assert.equal(status.completion.prefix_complete, true); assert.equal(stored.capture_summary!.outcome, "complete")
      } else {
        assert.ok(failures > 0, "actual metadata rename was faulted")
        assert.equal(status.phase, "failed"); assert.equal(status.completion.outcome, "failed")
        assert.equal(status.code, "save_failed"); assert.equal(status.completion.prefix_complete, false)
        assert.equal(notifications.some(m => m.completion?.outcome === "complete"), false, "no complete notification after a failed checkpoint")
        if (mode !== "persistent") {
          assert.equal(stored.capture_summary!.outcome, "failed")
          assert.equal(stored.capture_summary!.reason, "save_failed")
          assert.equal(stored.capture_summary!.sticky_incomplete, true)
        } else assert.notEqual(stored.capture_summary!.outcome, "complete", "unwritable storage cannot claim a durable terminal checkpoint")
      }
      assert.equal(runs, frames ? 1 : 0)
      assert.equal(stored.original_transcript?.length ?? 0, frames ? 1 : 0, "previously saved text survives terminal metadata failure")
      assert.equal(status.committed_end, frames)
    } finally {
      fs.renameSync = rename
      service.forceAbort()
      deleteMeeting(meeting.id)
    }
  })
}

for (const scenario of [
  { label: "idle healthy", running: false, fault: "none" },
  { label: "idle cancel checkpoint once", running: false, fault: "cancel-once" },
  { label: "idle persistent storage failure", running: false, fault: "persistent" },
  { label: "running healthy", running: true, fault: "none" },
  { label: "running cancel checkpoint once", running: true, fault: "cancel-once" },
  { label: "running repeat abort after save failure", running: true, fault: "cancel-once", repeat: true },
  { label: "running terminal checkpoint once", running: true, fault: "terminal-once" },
  { label: "running persistent storage failure", running: true, fault: "persistent" },
] as const) {
  test(`actual q1 abort ${scenario.label} preserves durable save failure and the runner lease`, { timeout: 20000 }, async () => {
    setVoiceFields({ sttEngine: "local", localModelId: "medium" })
    const meeting = createMeeting({ title: "owned cancellation checkpoint control" })
    const notifications: any[] = []
    let finish: (() => void) | undefined, started!: () => void, failures = 0
    const runnerStarted = new Promise<void>(resolve => { started = resolve })
    let settled!: () => void
    const terminalNotification = new Promise<void>(resolve => { settled = resolve })
    const service = new SttSessionService({
      dataDir: DATA_DIR, whisperRoot: path.join(DATA_DIR, "models", "owned"),
      probeModel: () => ({ status: "ready" }), resolveModelPath: () => path.join(DATA_DIR, "models", "owned", "owned.bin"),
      resolveBinary: () => ({ ok: true, path: "OWNED_NO_NATIVE_PROCESS", arch: "darwin-arm64", pinned: true, sha256: "test" }),
      runWhisper: async () => { await new Promise<void>(resolve => { finish = resolve; started() }); return { text: "late cancelled text must not persist", ms: 1 } },
    })
    const ctx = { origin: "chrome-extension://owned494", surface: "panel", peerId: "owned-cancel-checkpoint", send: (m: any) => {
      notifications.push(m)
      if (m.phase === "finished" || m.phase === "failed") settled()
    } }
    const captureId = "00000000-0000-4000-8000-000000000694"
    const rename = fs.renameSync
    try {
      const meetingStart = await handleMeetingMessage({ type: "meeting.start", v: 1, id: meeting.id, queue_contract: 1,
        capture_id: captureId, expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true, audio_retained: false }, ctx, { sttService: service })
      assert.equal(meetingStart.type, "meeting.started")
      await handleVoiceSttMessage({ type: "voice.stt.start", v: 1, sessionId: captureId, queue_contract: 1,
        capture_epoch: 1, modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1, privacy_ack_v2: true }, ctx, { service })
      const capture = service.getMeetingCapture()!
      if (scenario.running) {
        for (let i = 0; i < 200; i++) {
          const credit = capture.queue.credits()[0]
          await handleVoiceSttMessage({ type: "voice.stt.chunk", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
            credit_id: credit.credit_id, sample_offset: credit.sample_offset, frame_count: 640, data: Buffer.alloc(1280).toString("base64") }, ctx, { service })
        }
        await runnerStarted
      }
      fs.renameSync = ((from: any, to: any) => {
        if (String(to) === path.join(DATA_DIR, "meetings", meeting.id, "meta.json")) {
          const phase = JSON.parse(fs.readFileSync(from, "utf8")).capture_summary?.phase
          const target = scenario.fault === "persistent" || (!failures && (
            scenario.fault === "cancel-once" && (phase === "canceling" || phase === "finished") ||
            scenario.fault === "terminal-once" && phase === "finished"))
          if (target) { failures++; throw Object.assign(new Error("owned cancellation checkpoint EIO"), { code: "EIO" }) }
        }
        return rename(from, to)
      }) as typeof fs.renameSync
      const abort = { type: "voice.stt.abort", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1 }
      assert.equal(validateWsMessage(abort).valid, true)
      const response = await handleVoiceSttMessage(abort, ctx, { service })
      if (scenario.running) {
        assert.equal(service.getMeetingCapture() === capture, true, "abort/save failure cannot release an unsettled runner")
        assert.equal(response.phase, scenario.fault === "none" || scenario.fault === "terminal-once" ? "canceling" : "retiring")
        if ("repeat" in scenario) {
          const denied = await handleVoiceSttMessage(abort, { ...ctx, peerId: "foreign" }, { service })
          assert.equal(denied.code, "stale_capture")
          const repeated = await handleVoiceSttMessage(abort, ctx, { service })
          assert.equal(repeated.phase, "retiring"); assert.equal(repeated.code, "save_failed")
          assert.equal(repeated.completion.outcome, "failed", "repeated abort cannot turn a saving failure back into cancellation")
          assert.equal(service.getMeetingCapture() === capture, true)
        }
        finish!()
        await terminalNotification
      }
      const status = capture.status(), stored = loadMeeting(meeting.id)!
      assert.equal(service.getMeetingCapture() === null, true, "only the settled capture retires")
      assert.equal(status.resident_seconds, 0)
      assert.equal(status.completion.prefix_complete, false)
      assert.equal(stored.original_transcript?.length ?? 0, 0, "late cancelled inference never commits text")
      if (scenario.fault === "none") {
        assert.equal(failures, 0); assert.equal(status.phase, "finished")
        assert.equal(status.completion.outcome, "cancelled"); assert.equal(status.code, undefined)
        assert.equal(stored.capture_summary!.outcome, "cancelled")
      } else {
        assert.ok(failures > 0, "the actual metadata rename boundary was faulted")
        assert.equal(status.phase, "failed"); assert.equal(status.code, "save_failed")
        assert.equal(status.completion.outcome, "failed")
        assert.equal(notifications.some(m => m.phase === "finished" && m.completion?.outcome === "cancelled"), false)
        if (!scenario.running || scenario.fault !== "terminal-once") assert.equal(response.code, "save_failed")
        if (scenario.fault !== "persistent") {
          assert.equal(stored.capture_summary!.outcome, "failed")
          assert.equal(stored.capture_summary!.reason, "save_failed")
          assert.equal(stored.capture_summary!.sticky_incomplete, true)
        } else assert.notEqual(stored.capture_summary!.phase, "finished", "unwritable storage cannot claim a durable terminal checkpoint")
      }
    } finally {
      fs.renameSync = rename; finish?.(); service.forceAbort()
      if (scenario.running) await terminalNotification
      deleteMeeting(meeting.id)
    }
  })
}
