/**
 * Dictation+ D1a: continuous browser adapter restart + classic no-restart.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createWebSpeechAdapter } from "../src/sidepanel/voice/web-speech-adapter"
import {
  maxListenMsForSession,
  VOICE_CONTINUOUS_HARD_CAP_MS,
  VOICE_MAX_LISTEN_MS,
} from "../src/sidepanel/voice/detect"

type FakeRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onresult: ((ev: unknown) => void) | null
}

test("maxListenMsForSession classic always 45s", () => {
  assert.equal(maxListenMsForSession("classic", "browser"), VOICE_MAX_LISTEN_MS)
  assert.equal(maxListenMsForSession("classic", "local"), VOICE_MAX_LISTEN_MS)
})

test("maxListenMsForSession continuous uses hard cap (browser + local D1c)", () => {
  assert.equal(
    maxListenMsForSession("continuous", "browser"),
    VOICE_CONTINUOUS_HARD_CAP_MS,
  )
  assert.equal(
    maxListenMsForSession("continuous", "local"),
    VOICE_CONTINUOUS_HARD_CAP_MS,
  )
})

test("classic mode: onend does not restart (single start)", async () => {
  let starts = 0
  const instances: FakeRec[] = []
  const Ctor = function (this: FakeRec) {
    starts++
    const rec: FakeRec = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start() {
        queueMicrotask(() => rec.onstart?.(new Event("start")))
      },
      stop() {
        queueMicrotask(() => rec.onend?.(new Event("end")))
      },
      abort() {
        queueMicrotask(() => rec.onend?.(new Event("end")))
      },
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    }
    instances.push(rec)
    return rec
  } as unknown as new () => object

  const g = globalThis as any
  const prev = g.SpeechRecognition
  g.SpeechRecognition = Ctor

  let ends = 0
  const adapter = createWebSpeechAdapter({
    onStart: () => {},
    onResult: () => {},
    onError: () => {},
    onEnd: () => {
      ends++
    },
  })
  assert.ok(adapter)
  adapter!.start({ lang: "zh-CN", mode: "classic" })
  assert.equal(starts, 1)
  // Simulate engine ending (silence) — classic must not restart
  instances[0].onend?.(new Event("end"))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(starts, 1)
  assert.equal(ends, 1)

  adapter!.destroy()
  g.SpeechRecognition = prev
})

test("continuous mode: onend restarts while wantListening", async () => {
  let starts = 0
  const instances: FakeRec[] = []
  const Ctor = function (this: FakeRec) {
    starts++
    const rec: FakeRec = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start() {
        queueMicrotask(() => rec.onstart?.(new Event("start")))
      },
      stop() {
        queueMicrotask(() => rec.onend?.(new Event("end")))
      },
      abort() {
        queueMicrotask(() => rec.onend?.(new Event("end")))
      },
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    }
    instances.push(rec)
    return rec
  } as unknown as new () => object

  const g = globalThis as any
  const prev = g.SpeechRecognition
  g.SpeechRecognition = Ctor

  let ends = 0
  const adapter = createWebSpeechAdapter({
    onStart: () => {},
    onResult: () => {},
    onError: () => {},
    onEnd: () => {
      ends++
    },
  })
  assert.ok(adapter)
  adapter!.start({ lang: "zh-CN", mode: "continuous" })
  assert.equal(starts, 1)

  // Engine silence end → restart
  instances[0].onend?.(new Event("end"))
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(starts >= 2, `expected restart, starts=${starts}`)
  assert.equal(ends, 0)

  adapter!.stop()
  // Last instance onend after stop
  const last = instances[instances.length - 1]
  last.onend?.(new Event("end"))
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(ends, 1)

  adapter!.destroy()
  g.SpeechRecognition = prev
})

test("continuous: fatal network error stops restart and ends once", async () => {
  let starts = 0
  const instances: FakeRec[] = []
  const Ctor = function (this: FakeRec) {
    starts++
    const rec: FakeRec = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start() {
        queueMicrotask(() => rec.onstart?.(new Event("start")))
      },
      stop() {},
      abort() {},
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    }
    instances.push(rec)
    return rec
  } as unknown as new () => object

  const g = globalThis as any
  const prev = g.SpeechRecognition
  g.SpeechRecognition = Ctor

  let errors = 0
  let ends = 0
  const adapter = createWebSpeechAdapter({
    onStart: () => {},
    onResult: () => {},
    onError: () => {
      errors++
    },
    onEnd: () => {
      ends++
    },
  })
  adapter!.start({ mode: "continuous" })
  await new Promise((r) => setTimeout(r, 10))
  const firstStarts = starts
  instances[0].onerror?.({ error: "network" })
  instances[0].onend?.(new Event("end"))
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(errors, 1)
  assert.equal(ends, 1)
  assert.equal(starts, firstStarts, "must not restart after fatal error")

  adapter!.destroy()
  g.SpeechRecognition = prev
})

test("continuous: stop during onend→restart microtask still delivers onEnd", async () => {
  let starts = 0
  const instances: FakeRec[] = []
  const Ctor = function (this: FakeRec) {
    starts++
    const rec: FakeRec = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start() {
        queueMicrotask(() => rec.onstart?.(new Event("start")))
      },
      stop() {
        /* stop may no-op if rec already nulled in onend */
      },
      abort() {},
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    }
    instances.push(rec)
    return rec
  } as unknown as new () => object

  const g = globalThis as any
  const prev = g.SpeechRecognition
  g.SpeechRecognition = Ctor

  let ends = 0
  const adapter = createWebSpeechAdapter({
    onStart: () => {},
    onResult: () => {},
    onError: () => {},
    onEnd: () => {
      ends++
    },
  })
  adapter!.start({ mode: "continuous" })
  await new Promise((r) => setTimeout(r, 10))
  // Fire onend (schedules restart microtask) then stop before microtask runs
  instances[0].onend?.(new Event("end"))
  adapter!.stop()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(ends, 1, "onEnd must fire once when stop lands in restart gap")
  assert.equal(starts, 1, "must not start a new recognition after stop")

  adapter!.destroy()
  g.SpeechRecognition = prev
})

test("continuous: no-speech error does not call onError while listening", async () => {
  const instances: FakeRec[] = []
  const Ctor = function (this: FakeRec) {
    const rec: FakeRec = {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start() {
        queueMicrotask(() => rec.onstart?.(new Event("start")))
      },
      stop() {},
      abort() {},
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    }
    instances.push(rec)
    return rec
  } as unknown as new () => object

  const g = globalThis as any
  const prev = g.SpeechRecognition
  g.SpeechRecognition = Ctor

  let errors = 0
  const adapter = createWebSpeechAdapter({
    onStart: () => {},
    onResult: () => {},
    onError: () => {
      errors++
    },
    onEnd: () => {},
  })
  adapter!.start({ mode: "continuous" })
  await new Promise((r) => setTimeout(r, 10))
  instances[0].onerror?.({ error: "no-speech" })
  assert.equal(errors, 0)

  adapter!.destroy()
  g.SpeechRecognition = prev
})
