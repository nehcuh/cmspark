import test from "node:test"
import assert from "node:assert/strict"
import { confirmMeetingClose, createMeetingPersistence, saveMeetingMaterials } from "../src/sidepanel/voice/meeting-close"
import { meetingResponses as captured } from "./fixtures/meeting-responses"

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  const cause = await promise.then(() => null, error => error)
  assert.ok(cause instanceof Error && pattern.test(cause.message))
}

const owner = captured.created.response.meeting.id
function harness(timeoutMs = 2000) {
  const listeners = new Set<(message: any) => void>(), sent: any[] = []
  const persistence = createMeetingPersistence({ timeoutMs,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    send: (message, callback) => { sent.push(message); callback({ ok: true }) },
  })
  const emit = (response: any) => { for (const listener of [...listeners]) listener(response) }
  const receipt = (key: keyof typeof captured, request = sent.at(-1), overrides: any = {}) =>
    emit({ ...structuredClone(captured[key].response), id: request.id, ...overrides })
  return { persistence, sent, receipt, emit, listeners }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test("a rejected current transcript never advances to reference saving or generation", async () => {
  const h = harness()
  let generated = false
  const saving = saveMeetingMaterials({ id: owner, text: 'new text', referenceNotes: 'notes', referenceName: 'notes.md', persistence: h.persistence })
    .then(() => { generated = true })
  assert.equal(h.sent[0].type, 'meeting.set_transcript')
  h.receipt('denied')
  await rejects(saving, /保存/)
  assert.equal(generated, false)
  assert.equal(h.sent.length, 1)
})

test("generation waits for reference ACK and rejects an old real receipt lacking the new reference", async () => {
  const h = harness()
  let generated = false
  const saving = saveMeetingMaterials({ id: owner, text: '你好', referenceNotes: 'notes', referenceName: 'notes.md', persistence: h.persistence })
    .then(() => { generated = true })
  h.receipt('replaced')
  await tick()
  assert.equal(h.sent.at(-1).type, 'meeting.set_reference')
  assert.equal(generated, false)
  h.receipt('replaced') // Recorded production receipt; it lacks reference_notes.
  await rejects(saving, /参考笔记保存回执不一致/)
  assert.equal(generated, false)
})

test("generation can create its owner through a correlated production meeting.created receipt", async () => {
  const h = harness()
  const pending = h.persistence.create({ title: 'meeting' })
  h.receipt('created', h.sent[0], { id: 'unrelated' })
  assert.equal(h.listeners.size, 1)
  h.receipt('created')
  const created = await pending
  assert.equal(created.id, owner)
  assert.equal(h.listeners.size, 0)
})

test("unique write receipt, correlated get and end required; forwarding ACK cannot close", async () => {
  const h = harness()
  const write = h.persistence.write(owner, "meeting.append_transcript", { text: "好", source: "stt" })
  const request = h.sent[0]
  assert.equal(request.meeting_id, owner)
  assert.ok(request.id !== owner)
  const closing = confirmMeetingClose({ id: owner, persistence: h.persistence })
  h.receipt("suffix", request, { id: "stale-request" })
  await tick(); assert.equal(h.sent.length, 1)
  h.receipt("suffix", request); assert.equal(await write, true)
  await tick(); assert.equal(h.sent.at(-1).type, "meeting.get")
  h.receipt("read")
  await tick(); assert.equal(h.sent.at(-1).type, "meeting.end")
  h.receipt("ended"); await closing
  assert.equal(h.listeners.size, 0)
})

for (const text of ["好", "你好"]) test(`old suffix/equal text (${text}) cannot prove a non-STT write; explicit replacement recovers`, async () => {
  const h = harness(5)
  const write = h.persistence.write(owner, "meeting.append_transcript", { text, source: "user_edit" })
  h.emit(captured.appended.response)
  h.emit(captured.oldRead.response)
  assert.equal(await write, false)
  assert.equal(h.persistence.hasUnconfirmedWrites(owner), true)
  await rejects(confirmMeetingClose({ id: owner, persistence: h.persistence }), /保存转写/)
  assert.equal(h.sent.length, 1)
  const failedSave = h.persistence.write(owner, "meeting.set_transcript", { text: "你好\n好\n好", silence_cut: false })
  h.receipt("denied"); assert.equal(await failedSave, false)
  await rejects(h.persistence.waitForWrites(owner), /保存转写/)
  const save = h.persistence.write(owner, "meeting.set_transcript", { text: "你好\n好\n好", silence_cut: false })
  h.receipt("replaced"); assert.equal(await save, true)
  await h.persistence.waitForWrites(owner)
  assert.equal(h.persistence.hasUnconfirmedWrites(owner), false)
})

test("failed original ASR must replay with the same segment id before a replacement can mask it", async () => {
  const h = harness()
  const raw = h.persistence.write(owner, "meeting.append_transcript", { text: "好", source: "stt" })
  const original = h.sent[0]
  h.receipt("denied")
  assert.equal(await raw, false)
  const save = h.persistence.write(owner, "meeting.set_transcript", { text: "好", source: "user_edit", silence_cut: false })
  await tick()
  const retry = h.sent.at(-1)
  assert.equal(retry.type, "meeting.append_transcript")
  assert.equal(retry.segment_id, original.segment_id)
  assert.ok(retry.id !== original.id)
  h.receipt("denied")
  assert.equal(await save, false)
  assert.equal(h.sent.some(message => message.type === "meeting.set_transcript"), false)
  assert.equal(h.persistence.hasUnconfirmedWrites(owner), true)
})

test("replacement cannot clear another owner's failure; wrong-owner write receipt rejects", async () => {
  const h = harness()
  const failed = h.persistence.write("mtg_other-owner", "meeting.append_transcript", { text: "好" })
  h.receipt("suffix"); assert.equal(await failed, false)
  const saved = h.persistence.write(owner, "meeting.set_transcript", { text: "你好\n好\n好", silence_cut: false })
  h.receipt("replaced"); assert.equal(await saved, true)
  await rejects(h.persistence.waitForWrites("mtg_other-owner"), /不匹配/)
})

test("read and end waits bounded and listeners removed", async () => {
  const read = harness(5)
  await rejects(confirmMeetingClose({ id: owner, persistence: read.persistence }), /超时/)
  assert.equal(read.listeners.size, 0)
  const end = harness(5)
  const closing = confirmMeetingClose({ id: owner, persistence: end.persistence })
  await tick(); end.receipt("read")
  await rejects(closing, /超时/)
  assert.equal(end.listeners.size, 0)
  assert.deepEqual(end.sent.map(request => request.type), ["meeting.get", "meeting.end"])
})

test("authorization error retains failure; unknown response metadata tolerated; imports skip end", async () => {
  const h = harness()
  const write = h.persistence.write(owner, "meeting.append_transcript", { text: "好" })
  h.receipt("denied"); assert.equal(await write, false)
  await rejects(h.persistence.waitForWrites(owner), /chrome-extension origin required/)
  const save = h.persistence.write(owner, "meeting.set_transcript", { text: "你好\n好\n好", silence_cut: false })
  h.receipt("replaced", undefined, { future_metadata: { harmless: true } }); assert.equal(await save, true)
  const closing = confirmMeetingClose({ id: owner, persistence: h.persistence, endRecording: false })
  await tick(); h.receipt("read"); await closing
  assert.equal(h.sent.some(request => request.type === "meeting.end"), false)
})
