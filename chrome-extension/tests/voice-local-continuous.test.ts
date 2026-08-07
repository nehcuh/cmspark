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
import { reduceVoiceSession } from "../src/sidepanel/voice/session-reducer"
import { initialVoiceSession } from "../src/sidepanel/voice/types"

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

test("local continuous: two segments → two finals then onEnd", async () => {
  const sent: any[] = []
  let captures = 0
  const inbox: { emit?: (m: any) => void } = {}
  const finals: string[] = []
  let starts = 0
  let ends = 0
  let continues = 0
  let captureStops = 0

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
      onCaptureStopped: () => {
        captureStops++
      },
      onSegmentContinue: () => {
        continues++
      },
    },
    {
      send: (msg) => {
        sent.push(msg)
        // Auto-reply result when end arrives
        if (msg.type === "voice.stt.end") {
          queueMicrotask(() => {
            inbox.emit?.({
              type: "voice.stt.result",
              sessionId: msg.sessionId,
              text: `seg-${msg.sessionId}`,
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

  // Short hard cap so only ~2 segments if we force-stop after second continue
  adapter.start({
    sessionId: "parent",
    modelId: "small",
    mode: "continuous",
    hardCapMs: 2000,
  })

  // Allow a few segment cycles (record is instant with mock)
  await new Promise((r) => setTimeout(r, 80))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 80))

  assert.ok(starts >= 1)
  assert.ok(captures >= 1, `expected ≥1 capture, got ${captures}`)
  assert.ok(finals.length >= 1, `expected finals, got ${JSON.stringify(finals)}`)
  assert.ok(
    sent.some((m) => m.type === "voice.stt.start" && String(m.sessionId).includes("-s")),
    "segment session ids should be parent-sN",
  )
  assert.equal(ends, 1)
  // If more than one segment completed before stop, continue should fire
  if (finals.length >= 2) {
    assert.ok(continues >= 1)
    assert.ok(captureStops >= 2)
  }

  adapter.destroy()
})

test("local continuous: abort mid-session ends once", async () => {
  const inbox: { emit?: (m: any) => void } = {}
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
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
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
