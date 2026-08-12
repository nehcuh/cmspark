/**
 * Meeting live STT refine helpers + soft banner honesty.
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  buildMeetingRefineRequest,
  clipPriorContextForRefine,
  createSerialRefineQueue,
  formatMeetingSoftSegmentError,
  isMeetingSoftSegmentBanner,
  MEETING_REFINE_PRIOR_MAX,
  MEETING_SOFT_SEGMENT_LOSS_HINT,
  requestMeetingSegmentRefine,
} from "../src/sidepanel/voice/meeting-live-refine"
import {
  isHardSttSegmentError,
  isSoftSttSegmentError,
} from "../src/sidepanel/voice/local-stt-adapter"

test("soft segment errors exclude conflict/busy/oom/binary_broken (F-merge-2 + nits)", () => {
  assert.equal(isSoftSttSegmentError("infer_failed"), true)
  assert.equal(isSoftSttSegmentError("empty_result"), true)
  assert.equal(isSoftSttSegmentError("infer_timeout"), true)
  // binary_broken is sticky — first-strike hard stop (dual-review Claude nit)
  assert.equal(isSoftSttSegmentError("binary_broken"), false)
  assert.equal(isHardSttSegmentError("binary_broken"), true)
  assert.equal(isSoftSttSegmentError("resource_conflict"), false)
  assert.equal(isSoftSttSegmentError("session_busy"), false)
  assert.equal(isSoftSttSegmentError("oom"), false)
  assert.equal(isHardSttSegmentError("oom"), true)
  assert.equal(isHardSttSegmentError("model_missing"), true)
  assert.equal(isMeetingSoftSegmentBanner("infer_failed"), true)
  assert.equal(isMeetingSoftSegmentBanner("resource_conflict"), false)
  assert.equal(isMeetingSoftSegmentBanner("oom"), false)
  assert.equal(isMeetingSoftSegmentBanner("binary_broken"), false)
})

test("soft banner states irreversible segment loss", () => {
  const s = formatMeetingSoftSegmentError("本机识别失败")
  assert.match(s, /本机识别失败/)
  assert.match(s, /不可恢复/)
  assert.match(s, /删音频/)
  assert.ok(s.includes(MEETING_SOFT_SEGMENT_LOSS_HINT))
})

test("clipPriorContextForRefine keeps tail within max", () => {
  assert.equal(clipPriorContextForRefine(""), "")
  assert.equal(clipPriorContextForRefine("  你好  "), "你好")
  const long = "a".repeat(MEETING_REFINE_PRIOR_MAX + 50)
  const clipped = clipPriorContextForRefine(long)
  assert.equal(clipped.length, MEETING_REFINE_PRIOR_MAX)
  assert.equal(clipped, long.slice(-MEETING_REFINE_PRIOR_MAX))
})

test("buildMeetingRefineRequest includes priorContext when present", () => {
  const body = buildMeetingRefineRequest({
    sessionId: "s1",
    refineGen: 2,
    text: "配森很好用",
    priorTranscript: "我们用 Python 开发",
  })
  assert.equal(body.type, "voice.refine.request")
  assert.equal(body.v, 1)
  assert.equal(body.sessionId, "s1")
  assert.equal(body.refineGen, 2)
  assert.equal(body.text, "配森很好用")
  assert.equal(body.priorContext, "我们用 Python 开发")

  const noPrior = buildMeetingRefineRequest({
    sessionId: "s1",
    refineGen: 0,
    text: "hi",
    priorTranscript: "  ",
  })
  assert.equal("priorContext" in noPrior, false)
})

test("serial refine queue preserves order", async () => {
  const q = createSerialRefineQueue()
  const order: number[] = []
  const p1 = q.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 30))
    order.push(1)
    return 1
  })
  const p2 = q.enqueue(async () => {
    order.push(2)
    return 2
  })
  const [a, b] = await Promise.all([p1, p2])
  assert.deepEqual([a, b], [1, 2])
  assert.deepEqual(order, [1, 2])
  assert.equal(q.pendingCount(), 0)
})

test("serial refine queue drain waits for pending work", async () => {
  const q = createSerialRefineQueue()
  assert.equal(await q.drain(50), true)
  let done = false
  void q.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 40))
    done = true
  })
  assert.ok(q.pendingCount() >= 1)
  const ok = await q.drain(500)
  assert.equal(ok, true)
  assert.equal(done, true)
  assert.equal(q.pendingCount(), 0)
})

test("serial refine queue drain times out", async () => {
  const q = createSerialRefineQueue()
  void q.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 200))
  })
  const ok = await q.drain(20)
  assert.equal(ok, false)
})

test("requestMeetingSegmentRefine applies result or falls back to raw", async () => {
  const sent: any[] = []
  let handler: ((m: any) => void) | null = null

  const p = requestMeetingSegmentRefine({
    sessionId: "sid",
    refineGen: 1,
    text: "配森",
    priorTranscript: "写 Python",
    timeoutMs: 500,
    send: (m) => {
      sent.push(m)
      queueMicrotask(() => {
        handler?.({
          type: "voice.refine.result",
          sessionId: "sid",
          refineGen: 1,
          text: "Python",
          unchanged: false,
        })
      })
    },
    onMessage: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
  })
  const r = await p
  assert.equal(r.text, "Python")
  assert.equal(r.refined, true)
  assert.equal(sent[0]?.priorContext, "写 Python")

  const p2 = requestMeetingSegmentRefine({
    sessionId: "sid2",
    refineGen: 2,
    text: "原文",
    priorTranscript: "",
    timeoutMs: 50,
    send: () => {},
    onMessage: () => () => {},
  })
  const r2 = await p2
  assert.equal(r2.text, "原文")
  assert.equal(r2.refined, false)
})
