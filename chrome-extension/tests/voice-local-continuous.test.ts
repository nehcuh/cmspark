/**
 * Dictation+ D1c — local continuous serial segments.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createLocalSttAdapter } from "../src/sidepanel/voice/local-stt-adapter"
import {
  maxListenMsForSession,
  VOICE_CONTINUOUS_HARD_CAP_MS,
  VOICE_MAX_LISTEN_MS,
} from "../src/sidepanel/voice/detect"
import { reduceVoiceSession, shouldApplyDraft } from "../src/sidepanel/voice/session-reducer"
import { initialVoiceSession } from "../src/sidepanel/voice/types"
import { mergeFinalTranscript } from "../src/sidepanel/voice/text-merge"

test("maxListenMsForSession continuous local uses hard cap (D1c)", () => {
  assert.equal(
    maxListenMsForSession("continuous", "local"),
    VOICE_CONTINUOUS_HARD_CAP_MS,
  )
  assert.equal(maxListenMsForSession("classic", "local"), VOICE_MAX_LISTEN_MS)
})

test("SEGMENT_CONTINUE resumes listening from processing", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(s.phase, "processing")
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "段一" })
  s = reduceVoiceSession(s, { type: "SEGMENT_CONTINUE" })
  assert.equal(s.phase, "listening")
  assert.deepEqual(s.finals, ["段一"])
})

test("continuous processing: USER_TOGGLE_STOP discards (classic cancel contract)", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "keep?" })
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.committed, true)
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.deepEqual(s.finals, [])
})

test("continuous: finals survive stop-after-segments path (graceful ENGINE_END)", () => {
  // Simulates toggle continuous+processing → stopEngine(stop) only:
  // no USER_TOGGLE_STOP; SEGMENT result then onEnd with merge.
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "前",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "一段" })
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "二段" })
  // graceful stop: no USER_TOGGLE_STOP from processing
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, true)
  assert.deepEqual(s.finals, ["一段", "二段"])
  assert.equal(mergeFinalTranscript(s.baseText, s.finals), "前一段二段")
})

test("local continuous: two short segments → two finals then onEnd", async () => {
  const sent: any[] = []
  let captures = 0
  const inbox: { emit?: (m: any) => void } = {}
  const finals: string[] = []
  let starts = 0
  let ends = 0
  let continues = 0

  const adapter = createLocalSttAdapter(
    {
      onStart: () => {
        starts++
      },
      onResult: ({ finalChunk }) => {
        if (finalChunk) finals.push(finalChunk)
      },
      onError: () => {},
      onEnd: () => {
        ends++
      },
      onCaptureStopped: () => {},
      onSegmentContinue: () => {
        continues++
      },
    },
    {
      send: (msg) => {
        sent.push(msg)
        if (msg.type === "voice.stt.end") {
          queueMicrotask(() => {
            inbox.emit?.({
              type: "voice.stt.result",
              sessionId: msg.sessionId,
              text: `T-${msg.sessionId}`,
            })
          })
        }
      },
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
      modelId: "medium",
      startCapture: async () => {
        captures++
        return {
          stop: async () => new Uint8Array([1, 2, 3, 4]),
          abort: () => {},
        }
      },
    },
  )

  // Short segments for multi-iteration loop under test.
  adapter.start({
    sessionId: "parent",
    modelId: "small",
    mode: "continuous",
    hardCapMs: 200,
    segmentMs: 40,
  })

  await new Promise((r) => setTimeout(r, 350))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 80))

  assert.ok(starts >= 1)
  assert.ok(captures >= 2, `expected ≥2 captures, got ${captures}`)
  assert.ok(finals.length >= 2, `expected ≥2 finals, got ${JSON.stringify(finals)}`)
  assert.ok(continues >= 1, `expected segment continue, got ${continues}`)
  assert.ok(
    sent.filter((m) => m.type === "voice.stt.start").length >= 2,
    "expected multiple voice.stt.start",
  )
  // start should only appear at upload time (paired with chunks), not long before
  const startsMsgs = sent.filter((m) => m.type === "voice.stt.start")
  for (const st of startsMsgs) {
    assert.match(String(st.sessionId), /-s\d+$/)
  }
  assert.equal(ends, 1)

  adapter.destroy()
})

test("local continuous: voice.stt.start is deferred until after record (idle-safe)", async () => {
  const timeline: string[] = []
  const inbox: { emit?: (m: any) => void } = {}
  let resolveCapture: (() => void) | null = null

  const adapter = createLocalSttAdapter(
    {
      onStart: () => timeline.push("onStart"),
      onResult: () => timeline.push("onResult"),
      onError: () => timeline.push("onError"),
      onEnd: () => timeline.push("onEnd"),
      onCaptureStopped: () => timeline.push("captureStopped"),
    },
    {
      send: (msg) => {
        timeline.push(String(msg.type))
        if (msg.type === "voice.stt.end") {
          queueMicrotask(() => {
            inbox.emit?.({
              type: "voice.stt.result",
              sessionId: msg.sessionId,
              text: "ok",
            })
          })
        }
      },
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
      modelId: "medium",
      startCapture: async () => {
        timeline.push("captureBegin")
        return {
          stop: async () => {
            timeline.push("captureStop")
            return new Uint8Array([9])
          },
          abort: () => {},
        }
      },
    },
  )

  adapter.start({
    sessionId: "idle-safe",
    mode: "continuous",
    hardCapMs: 80,
    segmentMs: 30,
  })
  await new Promise((r) => setTimeout(r, 200))
  // Graceful stop so last segment can upload
  adapter.stop()
  await new Promise((r) => setTimeout(r, 80))
  adapter.destroy()

  const iCap = timeline.indexOf("captureBegin")
  const iStart = timeline.indexOf("voice.stt.start")
  const iStop = timeline.indexOf("captureStop")
  assert.ok(iCap >= 0, `timeline=${timeline.join(",")}`)
  assert.ok(iStop >= 0, `timeline=${timeline.join(",")}`)
  assert.ok(iStart >= 0, `timeline=${timeline.join(",")}`)
  assert.ok(
    iStart > iStop,
    `voice.stt.start must be after captureStop (got ${timeline.join(",")})`,
  )
})

test("local continuous: abort mid-session ends once", async () => {
  let ends = 0
  let errors = 0
  const adapter = createLocalSttAdapter(
    {
      onStart: () => {},
      onResult: () => {},
      onError: (c) => {
        if (c === "aborted") errors++
      },
      onEnd: () => {
        ends++
      },
    },
    {
      send: () => {},
      onMessage: () => () => {},
      modelId: "medium",
      startCapture: async () => ({
        stop: async () => new Uint8Array([1]),
        abort: () => {},
      }),
    },
  )

  adapter.start({
    sessionId: "p-abort",
    mode: "continuous",
    hardCapMs: 60_000,
  })
  await new Promise((r) => setTimeout(r, 20))
  adapter.abort()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(errors, 1)
  assert.equal(ends, 1)
  adapter.destroy()
})
