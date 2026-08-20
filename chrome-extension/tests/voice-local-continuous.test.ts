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

/**
 * Same companion protocol as classic V1 tests: start-while-busy → resource_conflict;
 * unknown sid chunk/end → session_unknown; abort frees the slot + aborted ACK.
 * Macrotask replies so the retry microtask runs between start-reject and leftover ACKs.
 */
function fakeCompanion(sent: any[], opts?: { holderBusy?: boolean }) {
  const inbox: { emit?: (m: any) => void } = {}
  let holderBusy = opts?.holderBusy ?? false
  const sessions = new Set<string>()
  const reply = (m: any) => {
    setTimeout(() => inbox.emit?.(m), 0)
  }
  const send = (msg: any) => {
    sent.push(msg)
    const sid = String(msg.sessionId ?? "")
    switch (msg.type) {
      case "voice.stt.start":
        if (holderBusy) {
          reply({
            type: "voice.stt.error",
            v: 1,
            sessionId: sid,
            code: "resource_conflict",
            message: "previous STT infer still in progress",
          })
        } else {
          holderBusy = true
          sessions.add(sid)
          reply({ type: "voice.stt.partial", v: 1, sessionId: sid, status: "receiving" })
        }
        break
      case "voice.stt.chunk":
        if (!sessions.has(sid)) {
          reply({
            type: "voice.stt.error",
            v: 1,
            sessionId: sid,
            code: "session_unknown",
            message: "no matching session",
          })
        }
        break
      case "voice.stt.end":
        if (!sessions.has(sid)) {
          reply({
            type: "voice.stt.error",
            v: 1,
            sessionId: sid,
            code: "session_unknown",
            message: "no matching session",
          })
        } else {
          sessions.delete(sid)
          holderBusy = false
          reply({
            type: "voice.stt.result",
            v: 1,
            sessionId: sid,
            text: `ok-${sid}`,
            ms: 5,
            modelId: "medium",
          })
        }
        break
      case "voice.stt.abort":
        if (holderBusy) {
          sessions.clear()
          holderBusy = false
          reply({
            type: "voice.stt.error",
            v: 1,
            sessionId: sid,
            code: "aborted",
            message: "session aborted",
          })
        } else {
          reply({
            type: "voice.stt.error",
            v: 1,
            sessionId: sid,
            code: "session_unknown",
            message: "no active session",
          })
        }
        break
    }
  }
  return {
    send,
    onMessage: (h: (m: any) => void) => {
      inbox.emit = h
      return () => {
        inbox.emit = undefined
      }
    },
  }
}

test("local continuous: resource_conflict retries once with -r1 sessionId", async () => {
  const sent: any[] = []
  const finals: string[] = []
  const errors: string[] = []
  let ends = 0
  const companion = fakeCompanion(sent, { holderBusy: true })

  const adapter = createLocalSttAdapter(
    {
      onStart: () => {},
      onResult: ({ finalChunk }) => {
        if (finalChunk) finals.push(finalChunk)
      },
      onError: (c) => {
        errors.push(c)
      },
      onEnd: () => {
        ends++
      },
    },
    {
      send: companion.send,
      onMessage: companion.onMessage,
      modelId: "medium",
      startCapture: async () => ({
        stop: async () => new Uint8Array([1, 2, 3, 4]),
        abort: () => {},
      }),
    },
  )

  adapter.start({
    sessionId: "retry-parent",
    mode: "continuous",
    hardCapMs: 80,
    segmentMs: 30,
  })

  let waited = 0
  while (!sent.some((m) => m.type === "voice.stt.abort") && waited < 800) {
    await new Promise((r) => setTimeout(r, 10))
    waited += 10
  }
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual(errors, [], `stale-sid ACKs during backoff must not surface: ${errors}`)
  assert.equal(ends, 0, "stale-sid ACKs during backoff must not end the session")

  await new Promise((r) => setTimeout(r, 500))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 120))

  const starts = sent.filter((m) => m.type === "voice.stt.start")
  const aborts = sent.filter((m) => m.type === "voice.stt.abort")
  const startSids = starts.map((m) => String(m.sessionId))
  assert.ok(starts.length >= 2, `expected ≥2 starts (orig+retry), got ${starts.length}`)
  assert.match(startSids[0] || "", /-s1$/, `first start must be segment -s1, got ${startSids[0]}`)
  assert.ok(
    aborts.some((m) => String(m.sessionId).endsWith("-s1")),
    `expected abort of first segment sid, aborts=${JSON.stringify(aborts)}`,
  )
  assert.ok(
    startSids.some((s) => /-s1-r1$/.test(s)),
    `expected -s1-r1 retry start, starts=${startSids.join(",")}`,
  )
  assert.ok(finals.length >= 1, `expected at least one final after retry, got ${JSON.stringify(finals)}`)
  assert.equal(errors.length, 0, `should not surface conflict if retry succeeds: ${errors}`)
  assert.ok(ends >= 1)
  adapter.destroy()
})
