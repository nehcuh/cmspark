/**
 * Path B M1 Task 6 — local adapter WS protocol sequence with injectable capture.
 * Tests send order: start → chunk(s) → end; abort; result/error handling.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createLocalSttAdapter } from "../src/sidepanel/voice/local-stt-adapter"
import { encodeMonoFloatToWav16k } from "../src/sidepanel/voice/pcm-encode"
import { LOCAL_STT_SAMPLE_RATE } from "../src/sidepanel/voice/local-stt-detect"
import type { CaptureHandle } from "../src/sidepanel/voice/audio-capture"

/** Silent 100ms WAV. */
function silentWav(): Uint8Array {
  const samples = new Float32Array(Math.floor(LOCAL_STT_SAMPLE_RATE * 0.1))
  return encodeMonoFloatToWav16k(samples, LOCAL_STT_SAMPLE_RATE)
}

/** Fake capture: start resolves immediately; stop returns fixed WAV. */
function fakeCaptureFactory(wav: Uint8Array, opts?: { delayMs?: number }) {
  return async (): Promise<CaptureHandle> => {
    let aborted = false
    return {
      stop: async () => {
        if (aborted) {
          throw Object.assign(new Error("aborted"), { code: "aborted" })
        }
        if (opts?.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs))
        }
        return wav
      },
      abort: () => {
        aborted = true
      },
    }
  }
}

test("happy path: start → stop → voice.stt.start/chunk/end → result", async () => {
  const wav = silentWav()
  const sent: any[] = []
  const inbox: { emit?: (m: any) => void } = {}
  const events: string[] = []
  const finals: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: ({ finalChunk }) => {
        events.push("result")
        finals.push(finalChunk)
      },
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
      onCaptureStopped: () => events.push("capture_stopped"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
      modelId: "medium",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-happy", modelId: "medium", lang: "zh-CN" })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("start"), `expected start, got ${events.join(",")}`)
  // C1: recording must not open the Companion session (idle-safe).
  assert.equal(
    sent.filter((m) => m.type === "voice.stt.start").length,
    0,
    "classic must not voice.stt.start while still recording",
  )

  adapter.stop()
  await new Promise((r) => setTimeout(r, 20))

  const startMsg = sent.find((m) => m.type === "voice.stt.start")
  assert.ok(startMsg, "voice.stt.start after stop")
  assert.equal(startMsg.sessionId, "s-happy")
  assert.equal(startMsg.modelId, "medium")
  assert.equal(startMsg.format, "wav")
  assert.equal(startMsg.sampleRate, 16000)
  assert.equal(startMsg.channels, 1)
  assert.equal(startMsg.v, 1)
  assert.equal(startMsg.privacy_ack_v2, true)

  assert.ok(events.includes("capture_stopped"))
  const chunks = sent.filter((m) => m.type === "voice.stt.chunk")
  const endMsg = sent.find((m) => m.type === "voice.stt.end")
  assert.ok(chunks.length >= 1, "expected at least one chunk")
  assert.ok(endMsg)
  assert.equal(endMsg.totalSeq, chunks.length)
  assert.equal(typeof chunks[0].data, "string")
  assert.ok(chunks[0].data.length > 0)

  inbox.emit?.({
    type: "voice.stt.result",
    v: 1,
    sessionId: "s-happy",
    text: "你好世界",
    ms: 42,
    modelId: "medium",
  })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.includes("result"))
  assert.deepEqual(finals, ["你好世界"])
  assert.ok(events.includes("end"))

  adapter.destroy()
})

test("classic: voice.stt.start is deferred until after captureStop (idle-safe)", async () => {
  const timeline: string[] = []
  const inbox: { emit?: (m: any) => void } = {}

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
            await new Promise((r) => setTimeout(r, 40))
            return new Uint8Array([9])
          },
          abort: () => {},
        }
      },
    },
  )

  adapter.start({ sessionId: "classic-idle-safe", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(timeline.includes("onStart"), `timeline=${timeline.join(",")}`)
  assert.ok(!timeline.includes("voice.stt.start"), `start leaked during record: ${timeline.join(",")}`)
  adapter.stop()
  await new Promise((r) => setTimeout(r, 80))
  adapter.destroy()

  const iOnStart = timeline.indexOf("onStart")
  const iStop = timeline.indexOf("captureStop")
  const iStart = timeline.indexOf("voice.stt.start")
  const iChunk = timeline.indexOf("voice.stt.chunk")
  const iEnd = timeline.indexOf("voice.stt.end")
  assert.ok(iOnStart >= 0 && iStop >= 0 && iStart >= 0, `timeline=${timeline.join(",")}`)
  assert.ok(iOnStart < iStop, "onStart (listening chrome) must precede captureStop")
  assert.ok(
    iStart > iStop,
    `voice.stt.start must be after captureStop (got ${timeline.join(",")})`,
  )
  assert.ok(iChunk > iStart && iEnd > iChunk, `upload order ${timeline.join(",")}`)
})

/**
 * Faithful fake of the real companion voice.stt protocol (M4 — the previous
 * fake asserted a companion that does not exist):
 * - start while a session holds the max-1 slot → resource_conflict error
 *   (stt-session-service.ts start: bound infer still in progress)
 * - every chunk/end for a rejected/unknown session → session_unknown error
 *   (requirePeer, stt-handlers.ts) — the old fake never sent these
 * - abort → peer-level abort frees the peer's bound slot (V2) and always
 *   replies an error ACK ("aborted" on success, session_unknown otherwise)
 * Replies are macrotasks (setTimeout 0): real WS delivers each message in its
 * own task, so the adapter's microtask continuation (conflict retry block)
 * runs between the start rejection and the per-chunk rejects.
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
        // No per-chunk ack on success (fire-and-forget); requirePeer rejects
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
          // V2: same peer aborts whatever session holds the slot, stale sid or not
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
  const onMessage = (h: (m: any) => void) => {
    inbox.emit = h
    return () => {
      inbox.emit = undefined
    }
  }
  return { send, onMessage }
}

test("classic: resource_conflict retries once with -r1 sessionId", async () => {
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
      startCapture: fakeCaptureFactory(silentWav()),
    },
  )

  adapter.start({ sessionId: "classic-retry", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter.stop()

  // Sample mid-backoff: stale-sid session_unknown rejects + the abort's own
  // error ACK arrive inside the 250ms window and must not kill the adapter.
  let waited = 0
  while (!sent.some((m) => m.type === "voice.stt.abort") && waited < 500) {
    await new Promise((r) => setTimeout(r, 10))
    waited += 10
  }
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(errors, [], `stale-sid ACKs during backoff must not surface: ${errors}`)
  assert.equal(ends, 0, "stale-sid ACKs during backoff must not end the session")

  await new Promise((r) => setTimeout(r, 400))

  const starts = sent.filter((m) => m.type === "voice.stt.start")
  assert.deepEqual(
    starts.map((m) => m.sessionId),
    ["classic-retry", "classic-retry-r1"],
  )
  assert.deepEqual(finals, ["ok-classic-retry-r1"])
  assert.deepEqual(errors, [], `retry success must not surface conflict: ${errors}`)
  assert.equal(ends, 1)

  // After conflict recovery the adapter is not locked: a fresh dictation works.
  adapter.start({ sessionId: "classic-after", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(finals, ["ok-classic-retry-r1", "ok-classic-after"])
  assert.deepEqual(errors, [])
  adapter.destroy()
})

test("classic: abort during conflict backoff does not start -r1", async () => {
  const sent: any[] = []
  const errors: string[] = []
  const companion = fakeCompanion(sent, { holderBusy: true })

  const adapter = createLocalSttAdapter(
    {
      onStart: () => {},
      onResult: () => {},
      onError: (c) => {
        errors.push(c)
      },
      onEnd: () => {},
    },
    {
      send: companion.send,
      onMessage: companion.onMessage,
      modelId: "medium",
      startCapture: fakeCaptureFactory(silentWav()),
    },
  )

  adapter.start({ sessionId: "classic-abort-retry", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 30))
  adapter.abort()
  await new Promise((r) => setTimeout(r, 400))

  const starts = sent.filter((m) => m.type === "voice.stt.start")
  assert.equal(
    starts.filter((m) => String(m.sessionId).endsWith("-r1")).length,
    0,
    `cancelled classic must not retry: ${starts.map((s) => s.sessionId).join(",")}`,
  )
  assert.deepEqual(errors, ["aborted"])

  // Abort during backoff must not lock the adapter either.
  const finals: string[] = []
  const adapter2 = createLocalSttAdapter(
    {
      onStart: () => {},
      onResult: ({ finalChunk }) => {
        if (finalChunk) finals.push(finalChunk)
      },
      onError: (c) => {
        errors.push(c)
      },
      onEnd: () => {},
    },
    {
      send: companion.send,
      onMessage: companion.onMessage,
      modelId: "medium",
      startCapture: fakeCaptureFactory(silentWav()),
    },
  )
  adapter2.start({ sessionId: "classic-after-abort", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter2.stop()
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(finals, ["ok-classic-after-abort"])
  adapter.destroy()
  adapter2.destroy()
})

test("abort during recording: voice.stt.abort + silent error path", async () => {
  const wav = silentWav()
  const sent: any[] = []
  const events: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => events.push("result"),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: () => () => {},
      modelId: "small",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-ab", modelId: "small" })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("start"))

  adapter.abort()
  await new Promise((r) => setTimeout(r, 10))

  const abortMsg = sent.find((m) => m.type === "voice.stt.abort")
  assert.ok(abortMsg)
  assert.equal(abortMsg.sessionId, "s-ab")
  assert.ok(events.includes("error:aborted"))
  assert.ok(events.includes("end"))
  assert.ok(!events.includes("result"))

  adapter.destroy()
})

test("error from companion while waiting: maps code", async () => {
  const wav = silentWav()
  const sent: any[] = []
  const inbox: { emit?: (m: any) => void } = {}
  const events: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => events.push("result"),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
      onCaptureStopped: () => events.push("capture_stopped"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
      modelId: "medium",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-err", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("capture_stopped"))

  inbox.emit?.({
    type: "voice.stt.error",
    v: 1,
    sessionId: "s-err",
    code: "model_missing",
    message: "no model",
  })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.includes("error:model_missing"))
  assert.ok(events.includes("end"))
  assert.ok(!events.includes("result"))

  adapter.destroy()
})
