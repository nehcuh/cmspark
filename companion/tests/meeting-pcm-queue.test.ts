import { test } from "node:test"
import * as assert from "node:assert/strict"
import { MEETING_PCM as C } from "../src/voice/meeting-pcm-contract"
import { MeetingPcmQueue, MeetingPcmProtocolError } from "../src/voice/meeting-pcm-queue"

test("one capacity includes reservations, out-of-order ACK slots stay bounded", () => {
  const q = new MeetingPcmQueue()
  const credits = q.reserve()
  assert.equal(credits.length, 8)
  assert.equal(q.residentFrames, 8 * 640)
  for (const c of credits.slice(1).reverse()) q.append(c.credit_id, c.sample_offset, c.max_frames, Buffer.alloc(c.max_frames * 2, 7))
  assert.equal(q.receivedEnd, 0)
  assert.equal(q.reserve().length, 0, "missing first block must not create unbounded reorder entries")
  q.append(credits[0].credit_id, 0, 640, Buffer.alloc(1280, 3))
  assert.equal(q.receivedEnd, 5120)
  assert.equal(q.reserve().length, 8)
})

test("byte-exact full cap + tail and slow immutable worker; duplicate does not enqueue", () => {
  const q = new MeetingPcmQueue()
  const reference = Buffer.alloc(C.capacityFrames * 2)
  for (let i = 0; i < C.capacityFrames; i++) reference.writeInt16LE(i % 32767, i * 2)
  let last: any
  while (!q.atCapacity || q.credits().length) {
    const credit = q.credits()[0] ?? q.reserve()[0]
    if (!credit) break
    const pcm = reference.subarray(credit.sample_offset * 2, (credit.sample_offset + credit.max_frames) * 2)
    q.append(credit.credit_id, credit.sample_offset, credit.max_frames, pcm)
    last = { credit, pcm }
    q.reserve()
  }
  assert.equal(q.receivedEnd, C.capacityFrames)
  assert.equal(q.residentFrames, C.capacityFrames)
  assert.equal(q.reserve().length, 0)
  assert.equal(q.append(last.credit.credit_id, last.credit.sample_offset, last.credit.max_frames, last.pcm).duplicate, true)
  assert.throws(() => q.append(last.credit.credit_id, last.credit.sample_offset, last.credit.max_frames, Buffer.alloc(1280, 255)), MeetingPcmProtocolError)
  q.seal(C.capacityFrames)
  const out: Buffer[] = []
  for (let s = q.take(); s; s = q.take()) {
    assert.equal(q.take(), null, "one infer/persist owner at a time")
    out.push(Buffer.from(s.pcm))
    assert.equal(q.residentFrames, C.capacityFrames - s.start, "infer alone does not free capacity")
    q.commit(s)
    assert.ok(s.pcm.every(n => n === 0))
  }
  assert.deepEqual(Buffer.concat(out), reference)
  assert.equal(out.length, 8)
  assert.equal(q.complete, true)
  assert.equal(q.residentFrames, 0)
})

test("tail flush admits pending blocks only to announced end; unknown/future credits refuse", () => {
  const q = new MeetingPcmQueue(); const [a, b] = q.reserve()
  q.append(a.credit_id, 0, 640, Buffer.alloc(1280, 1))
  q.seal(650)
  assert.equal(q.take(), null)
  q.append(b.credit_id, 640, 10, Buffer.alloc(20, 2))
  const segment = q.take()!
  assert.equal(segment.end, 650)
  assert.equal(segment.pcm.length, 1300)
  assert.throws(() => q.append(9999, 650, 1, Buffer.alloc(2)), MeetingPcmProtocolError)
  q.commit(segment)
  assert.equal(q.complete, true)
  q.dispose()
  assert.throws(() => q.append(a.credit_id, 0, 1, Buffer.alloc(2)), MeetingPcmProtocolError)
})
