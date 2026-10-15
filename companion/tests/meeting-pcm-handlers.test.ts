import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as path from "node:path"
import { DATA_DIR, setVoiceFields } from "../src/config"
import { createMeeting, loadMeeting, deleteMeeting } from "../src/meeting/meeting-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { handleVoiceSttMessage } from "../src/voice/stt-handlers"
import { SttSessionService } from "../src/voice/stt-session-service"
import { validateWsMessage } from "../src/ws/validate"

for (const delayedRunner of [false, true]) test(`actual q1 validators/meeting handler/STT handler/service/store protect owner and persist a short tail${delayedRunner ? " after delayed runner settlement" : ""}`, { timeout: 20000 }, async () => {
  setVoiceFields({ sttEngine: "local", localModelId: "medium" })
  const meeting = createMeeting({ title: "owned synthetic 494" })
  const other = createMeeting({ title: "legacy control" })
  const root = path.join(DATA_DIR, "models", "owned")
  let clears = 0, runs = 0
  const service = new SttSessionService({ dataDir: DATA_DIR, whisperRoot: root,
    probeModel: () => ({ status: "ready" }), resolveModelPath: () => path.join(root, "owned.bin"),
    resolveBinary: () => ({ ok: true, path: "OWNED_NO_PROCESS", arch: "darwin-arm64", pinned: true, sha256: "test" }),
    runWhisper: async () => {
      runs++
      if (delayedRunner) for (let i = 0; i < 1100; i++) await new Promise<void>(resolve => setImmediate(resolve))
      return { text: "owned tail", ms: 1 }
    },
  })
  let waitingCapture = "", settled: (() => void) | undefined
  const terminalFor = (id: string) => new Promise<void>(resolve => { waitingCapture = id; settled = resolve })
  const ctx = { origin: "chrome-extension://owned494", surface: "panel", peerId: "ownedA", send(m: any) {
    if (m.capture_id === waitingCapture && (m.phase === "finished" || m.phase === "failed")) settled?.()
  } }
  const captureId = "00000000-0000-4000-8000-000000000494"
  const begin = { type: "meeting.start", v: 1, id: meeting.id, queue_contract: 1, capture_id: captureId,
    expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true, audio_retained: false, speaker: "张三" }
  const deps = { sttService: service, clearSttSessions() { clears++ } }
  try {
    for (const type of ["__proto__", "constructor", "not_a_method"]) assert.equal(validateWsMessage({ ...begin, type }).valid, false)
    for (const audio_retained of ["false", 0, null, true]) assert.equal(validateWsMessage({ ...begin, audio_retained }).valid, false)
    assert.equal(validateWsMessage(begin).valid, true, "q1 preserves existing default raw speaker")
    for (const speaker of [33, "x".repeat(33)]) assert.equal(validateWsMessage({ ...begin, speaker }).valid, false)
    assert.equal(validateWsMessage({ ...begin, speaker: "x".repeat(32) }).valid, true)
    assert.equal(validateWsMessage({ ...begin, maxMs: 9e99 }).valid, false)
    assert.equal((await handleMeetingMessage({ ...begin, expected_capture_epoch: 7 }, ctx, deps)).code, "stale_capture")
    assert.equal(service.getMeetingCapture() === null, true)
    assert.equal(loadMeeting(meeting.id)!.status, "draft")
    const started = await handleMeetingMessage(begin, ctx, deps)
    assert.equal(started.type, "meeting.started"); assert.equal(clears, 0)
    assert.equal(started.meeting.capture_epoch, 1)
    assert.equal((await handleMeetingMessage(begin, ctx, deps)).meeting.capture_epoch, 1, "same live operation is idempotent")
    assert.equal((await handleMeetingMessage({ ...begin, expected_capture_epoch: 5 }, ctx, deps)).code, "stale_capture")
    const lease = service.getMeetingCapture()
    const beforeCollision = loadMeeting(meeting.id)
    assert.equal((await handleMeetingMessage({ ...begin, speaker: "李四" }, ctx, deps)).code, "segment_id_conflict")
    assert.equal(service.getMeetingCapture(), lease)
    assert.deepEqual(loadMeeting(meeting.id), beforeCollision, "collision cannot mutate epoch/lease/archive")
    assert.equal("speaker" in started.continuous_capture, false)
    assert.equal("speaker" in started.meeting.capture_summary, false)
    assert.equal((await handleMeetingMessage({ type: "meeting.start", v: 1, id: other.id, privacy_ack_v1: true }, ctx, deps)).code, "resource_conflict")
    assert.equal(loadMeeting(other.id)!.status, "draft"); assert.equal(clears, 0)
    const start = { type: "voice.stt.start", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
      modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1, privacy_ack_v2: true }
    assert.equal(validateWsMessage(start).valid, true)
    const receiving = await handleVoiceSttMessage(start, ctx, { service })
    assert.equal(receiving.type, "voice.stt.partial"); assert.equal(receiving.credits.length, 8)
    const credit = receiving.credits[0]
    const chunk = { type: "voice.stt.chunk", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
      credit_id: credit.credit_id, sample_offset: 0, frame_count: 96, data: Buffer.alloc(192, 1).toString("base64") }
    assert.equal(validateWsMessage(chunk).valid, true)
    const denied = await handleVoiceSttMessage(chunk, { ...ctx, peerId: "wrong" }, { service })
    assert.equal(denied.code, "stale_capture"); assert.equal(service.getMeetingCapture()!.queue.receivedEnd, 0)
    const ack = await handleVoiceSttMessage(chunk, ctx, { service })
    assert.equal(ack.type, "meeting.capture.status"); assert.equal(ack.accepted_through, 96)
    assert.deepEqual(await handleVoiceSttMessage(chunk, ctx, { service }), ack, "actual duplicate ACK is identical")
    const oldAbort = await handleVoiceSttMessage({ type: "voice.stt.abort", v: 1, sessionId: "stale" }, ctx, { service })
    assert.equal(oldAbort.code, "peer_mismatch"); assert.ok(service.getMeetingCapture())
    const end = { type: "voice.stt.end", v: 1, sessionId: captureId, queue_contract: 1, capture_epoch: 1,
      final_sample_end: 96, last_credit_id: 1, stop_reason: "user_stop" }
    assert.equal(validateWsMessage(end).valid, true)
    const firstTerminal = terminalFor(captureId)
    await handleVoiceSttMessage(end, ctx, { service })
    await firstTerminal
    assert.equal(service.getMeetingCapture() === null, true)
    assert.equal(runs, 1)
    const saved = loadMeeting(meeting.id)!
    assert.equal(saved.transcript.length, 1); assert.equal(saved.original_transcript!.length, 1)
    assert.equal(saved.transcript[0].segment_id, `${captureId}-1-s0`)
    assert.equal(saved.transcript[0].t1, 96 / 16000)
    assert.equal(saved.original_transcript![0].speaker, "张三")
    assert.equal("speaker" in saved.capture_summary!, false)
    assert.equal(saved.capture_summary!.committed_end, 96)
    assert.equal(saved.capture_summary!.outcome, "complete")
    assert.equal(saved.status, "ready")
    const generated = await handleMeetingMessage({ type: "meeting.generate_minutes", v: 1, id: meeting.id }, ctx, {
      ...deps, getLlmConfig: () => ({ base_url: "https://owned.invalid", api_key: "OWNED_NOT_VALID", model_name: "owned", temperature: 0.2 }),
      generate: async () => ({ ok: true, minutes: { raw_md: "### TL;DR\n原文纪要", generated_at: "2026-10-15T00:00:00.000Z" } }),
    })
    assert.match(generated.minutes.raw_md, /已采集前缀/, "minutes/export must disclose the saved source range")
    assert.equal(generated.minutes.source_transcript.includes("owned tail"), true)
    const minutesDeps = { ...deps, getLlmConfig: () => ({ base_url: "https://owned.invalid", api_key: "OWNED_NOT_VALID", model_name: "owned", temperature: 0.2 }),
      generate: async () => ({ ok: true as const, minutes: { raw_md: "### TL;DR\n原文纪要", generated_at: "2026-10-15T00:00:00.000Z" } }) }
    const blankId = "00000000-0000-4000-8000-000000000495"
    const blankBegin = { ...begin, capture_id: blankId, expected_capture_epoch: 1, speaker: "  " }
    assert.equal((await handleMeetingMessage(blankBegin, ctx, deps)).type, "meeting.started")
    assert.equal((await handleMeetingMessage({ ...blankBegin, speaker: undefined }, ctx, deps)).meeting.capture_epoch, 2)
    const receiveBlank = await handleVoiceSttMessage({ ...start, sessionId: blankId, capture_epoch: 2 }, ctx, { service })
    const blankCredit = receiveBlank.credits[0]
    await handleVoiceSttMessage({ ...chunk, sessionId: blankId, capture_epoch: 2, credit_id: blankCredit.credit_id }, ctx, { service })
    const blankTerminal = terminalFor(blankId)
    await handleVoiceSttMessage({ ...end, sessionId: blankId, capture_epoch: 2 }, ctx, { service })
    await blankTerminal
    assert.equal(loadMeeting(meeting.id)!.original_transcript![1].speaker, undefined, "blank/omitted next capture makes no raw label")
    const maxId = "00000000-0000-4000-8000-000000000496"
    const maxBegin = { ...begin, capture_id: maxId, expected_capture_epoch: 2, speaker: "x".repeat(32) }
    assert.equal((await handleMeetingMessage(maxBegin, ctx, deps)).type, "meeting.started")
    const receiveMax = await handleVoiceSttMessage({ ...start, sessionId: maxId, capture_epoch: 3 }, ctx, { service })
    await handleVoiceSttMessage({ ...chunk, sessionId: maxId, capture_epoch: 3, credit_id: receiveMax.credits[0].credit_id }, ctx, { service })
    const maxTerminal = terminalFor(maxId)
    await handleVoiceSttMessage({ ...end, sessionId: maxId, capture_epoch: 3 }, ctx, { service })
    await maxTerminal
    assert.equal(loadMeeting(meeting.id)!.original_transcript![2].speaker, "x".repeat(32))
    const cancelledId = "00000000-0000-4000-8000-000000000497"
    await handleMeetingMessage({ ...begin, capture_id: cancelledId, expected_capture_epoch: 3, speaker: "" }, ctx, deps)
    await handleVoiceSttMessage({ type: "voice.stt.abort", v: 1, queue_contract: 1, sessionId: cancelledId, capture_epoch: 4 }, ctx, { service })
    assert.equal(loadMeeting(meeting.id)!.capture_summary!.sticky_incomplete, true)
    const incompleteMinutes = await handleMeetingMessage({ type: "meeting.generate_minutes", v: 1, id: meeting.id }, ctx, minutesDeps)
    assert.match(incompleteMinutes.minutes.raw_md, /范围不完整/)
    await handleMeetingMessage({ type: "meeting.append_transcript", v: 1, id: other.id, text: "owned imported history", source: "stt" }, ctx, deps)
    const unknownMinutes = await handleMeetingMessage({ type: "meeting.generate_minutes", v: 1, id: other.id }, ctx, minutesDeps)
    assert.match(unknownMinutes.minutes.raw_md, /采集范围未知/)


    assert.equal((await handleMeetingMessage({ type: "meeting.end", v: 1, id: meeting.id, queue_contract: 1, capture_id: captureId, capture_epoch: 0 }, ctx, deps)).code, "stale_capture")
  } finally { service.forceAbort(); deleteMeeting(meeting.id); deleteMeeting(other.id) }
})
