import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { DATA_DIR } from "../src/config"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { deleteMeeting, loadMeeting, saveMeeting, transcriptToText } from "../src/meeting/meeting-store"
import { validateWsMessage } from "../src/ws/validate"

test("#492 original STT append idempotency survives reload and editable transcript replacement", async () => {
  const origin = { origin: "chrome-extension://segmentfixture" }
  const created = await handleMeetingMessage({ type: "meeting.create", title: "Segment retry fixture" }, origin)
  const id = created.meeting.id
  const frame = { type: "meeting.append_transcript", v: 1, id, text: "重复说出的话", source: "stt", segment_id: "segment-original-001" }
  try {
    assert.equal(validateWsMessage(frame).valid, true)
    // A before-send failure leaves no record; replay of the intended frame is its first append.
    assert.equal(loadMeeting(id)!.original_transcript?.length, 0)
    const first = await handleMeetingMessage(frame, origin)
    assert.equal(first.type, "meeting.updated")
    assert.equal(first.meeting.original_transcript[0].segment_id, frame.segment_id)
    // The caller can lose this ACK. A fresh disk load and replay still produce one segment.
    const reloaded = loadMeeting(id)
    const replay = await handleMeetingMessage(frame, origin)
    assert.deepEqual(replay.meeting, reloaded)
    await handleMeetingMessage({ type: "meeting.set_transcript", id, text: "人工修改当前稿", source: "user_edit" }, origin)
    const afterEdit = await handleMeetingMessage(frame, origin)
    assert.equal(afterEdit.meeting.transcript[0].text, "人工修改当前稿")
    assert.equal(afterEdit.meeting.original_transcript.length, 1)
    for (const changed of [{ text: "不同文本" }, { source: "user_edit" }, { speaker: "发言人2" }]) {
      const collision = await handleMeetingMessage({ ...frame, ...changed }, origin)
      assert.equal(collision.type, "meeting.error")
      assert.equal(collision.code, "segment_id_conflict")
    }
    const sameWords = await handleMeetingMessage({ ...frame, segment_id: "segment-original-002" }, origin)
    assert.equal(sameWords.meeting.original_transcript.length, 2)
    assert.deepEqual(sameWords.meeting.original_transcript.map((line: any) => line.text), [frame.text, frame.text])
    for (const invalid of ["", "../secret", "x".repeat(129), 4, null]) {
      const request = { ...frame, segment_id: invalid }
      assert.equal(validateWsMessage(request).valid, false)
      assert.equal((await handleMeetingMessage(request, origin)).code, "invalid_segment_id")
    }
    assert.equal(loadMeeting(id)!.original_transcript?.length, 2)
  } finally { deleteMeeting(id) }
})

test("#492 segment replay at raw archive limit succeeds and segment IDs are meeting-scoped", async () => {
  const origin = { origin: "chrome-extension://segmentfixture" }
  const ids: string[] = []
  try {
    for (let n = 0; n < 2; n++) {
      const created = await handleMeetingMessage({ type: "meeting.create", title: "Segment cap fixture" }, origin)
      const id = created.meeting.id
      ids.push(id)
      const frame = { type: "meeting.append_transcript", v: 1, id, text: "末段", source: "stt", segment_id: "shared-segment-id" }
      const first = await handleMeetingMessage(frame, origin)
      assert.equal(first.meeting.original_transcript.length, 1)
      const full = loadMeeting(id)!
      full.original_transcript!.push({ text: "原".repeat(199_997), source: "stt" })
      assert.equal(transcriptToText(full.original_transcript!).length, 200_000)
      saveMeeting(full)
      const replay = await handleMeetingMessage(frame, origin)
      assert.equal(replay.type, "meeting.updated")
      assert.equal(replay.meeting.original_transcript.length, 2)
      const overflow = await handleMeetingMessage({ ...frame, segment_id: "new-segment-id" }, origin)
      assert.equal(overflow.code, "transcript_too_long")
    }
  } finally { for (const id of ids) deleteMeeting(id) }
})

test("#492 STT replay repairs a partially committed original archive without duplicating editable text", async () => {
  const origin = { origin: "chrome-extension://segmentfixture" }
  const created = await handleMeetingMessage({ type: "meeting.create", title: "Partial write fixture" }, origin)
  const id = created.meeting.id
  const frame = { type: "meeting.append_transcript", v: 1, id, text: "末段完整原始文字", source: "stt", segment_id: "partial-write-segment" }
  try {
    const appended = await handleMeetingMessage(frame, origin)
    assert.equal(appended.type, "meeting.updated")
    // Real disk state after transcript.json committed but original-transcript.json
    // retained its previous empty snapshot. Never touch the live data directory.
    const archive = path.join(DATA_DIR, "meetings", id, "original-transcript.json")
    fs.writeFileSync(archive, "[]")
    const partial = loadMeeting(id)!
    assert.equal(partial.transcript.length, 1)
    assert.equal(partial.original_transcript!.length, 0)
    const repaired = await handleMeetingMessage(frame, origin)
    assert.equal(repaired.type, "meeting.updated")
    assert.deepEqual(repaired.meeting.transcript, partial.transcript)
    assert.equal(repaired.meeting.original_transcript.length, 1)
    assert.equal(repaired.meeting.original_transcript[0].segment_id, frame.segment_id)
    assert.deepEqual(JSON.parse(fs.readFileSync(archive, "utf8")), repaired.meeting.original_transcript)
    const repeated = await handleMeetingMessage(frame, origin)
    assert.equal(repeated.meeting.transcript.length, 1)
    assert.equal(repeated.meeting.original_transcript.length, 1)
  } finally { deleteMeeting(id) }
})
