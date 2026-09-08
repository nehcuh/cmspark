import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { SUMMONER_DICTATION_JS, summonerVoiceRequestTimeout } from "../src/summoner/voice-input"

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

function fixture(engine = "local", response?: (path: string, data: any) => unknown) {
  const requests: { path: string; data: any }[] = []
  const elements: any[] = []
  const timers = new Map<number, { fn: () => void; delay: number }>()
  let timerId = 0
  let owner = "thread-a", stopped = 0, processor: any, recognition: any
  const parent = { appendChild: (el: any) => elements.push(el) }
  const mic = { parentNode: { parentNode: parent }, setAttribute() {} }
  const input = { value: "原草稿", dispatchEvent() {} }
  const stream = { getTracks: () => [{ stop: () => { stopped++ } }] }
  const node = () => ({ connect() {}, disconnect() {} })
  class AudioContext {
    state = "running"; sampleRate = 16000
    createMediaStreamSource() { return node() }
    createScriptProcessor() { processor = { ...node(), onaudioprocess: null }; return processor }
    createGain() { return { ...node(), gain: { value: 0 } } }
    close() { return Promise.resolve() }
  }
  class SpeechRecognition {
    onstart?: () => void; onresult?: (e: any) => void; onend?: () => void
    constructor() { recognition = this }
    start() { queueMicrotask(() => this.onstart?.()) }
    stop() { queueMicrotask(() => this.onend?.()) }
    abort() {}
  }
  const context = vm.createContext({
    window: { AudioContext, SpeechRecognition }, navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { createElement: () => ({ style: {}, setAttribute() {} }) },
    Event: class {}, btoa: (v: string) => Buffer.from(v, "binary").toString("base64"),
    setTimeout: (fn: () => void, delay: number) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: (id: number) => timers.delete(id), setInterval: () => ++timerId, clearInterval() {}, Promise, Uint8Array, DataView,
  })
  vm.runInContext(SUMMONER_DICTATION_JS, context)
  const controller = context.createSummonerDictation({
    mic, input, threadId: () => owner, blocked: () => false, privacy() {},
    api: async (path: string, opts: any) => {
      const data = opts?.body ? JSON.parse(opts.body) : undefined; requests.push({ path, data })
      if (path === "/api/voice-settings") return { sttEngine: engine, localModelId: "medium", lang: "zh-CN" }
      if (response) { const value = response(path, data); if (value !== undefined) return value }
      if (path === "/api/stt/end") return { type: "voice.stt.result", sessionId: data.sessionId, text: "识别结果" }
      return { type: "ok" }
    },
  })
  return {
    controller, requests, input, elements, get stopped() { return stopped }, get recognition() { return recognition },
    owner: (v: string) => { owner = v },
    fireTimer: (delay: number) => {
      const item = [...timers.entries()].find(([, value]) => value.delay === delay)
      if (!item) return false
      timers.delete(item[0]); item[1].fn(); return true
    },
    audio: () => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(16000) } }),
    start: async () => { controller.toggle(); await settle(); controller.ack(); await settle() },
  }
}

test("#482 browser engine uses browser recognition, previews immediately and never posts local STT", async () => {
  const f = fixture("browser"); await f.start()
  try {
    assert.match(f.elements[0].textContent, /正在听写/)
    f.recognition.onresult({ resultIndex: 0, results: [{ 0: { transcript: "即时预览" }, isFinal: false }] })
    assert.match(f.elements[0].textContent, /即时预览/)
    assert.equal(f.input.value, "原草稿")
    f.recognition.onresult({ resultIndex: 0, results: [{ 0: { transcript: "最终结果" }, isFinal: true }] })
    f.controller.toggle(); await settle()
    assert.equal(f.input.value, "原草稿 最终结果")
    assert.equal(f.requests.filter((r) => r.path.startsWith("/api/stt/")).length, 0)
  } finally { f.controller.cancel() }
})

test("#482 local HTTP final commits without SSE; chunks finish in sequence before end", async () => {
  const first = deferred<any>()
  const f = fixture("local", (path, data) => path === "/api/stt/chunk" && data.seq === 0 ? first.promise : undefined)
  await f.start()
  try {
    f.audio(); f.audio(); f.controller.toggle(); await settle()
    assert.equal(f.requests.filter((r) => r.path === "/api/stt/chunk").length, 1)
    assert.equal(f.requests.some((r) => r.path === "/api/stt/end"), false)
    assert.match(f.elements[0].textContent, /正在识别/)
    first.resolve({ type: "ok" }); await settle()
    assert.deepEqual(f.requests.filter((r) => r.path.startsWith("/api/stt/")).map((r) => r.path), ["/api/stt/start", "/api/stt/chunk", "/api/stt/chunk", "/api/stt/end"])
    assert.equal(f.requests.find((r) => r.path === "/api/stt/end")?.data.totalSeq, 2)
    assert.equal(f.input.value, "原草稿 识别结果")
    const sid = f.requests.find((r) => r.path === "/api/stt/start")?.data.sessionId
    assert.equal(f.controller.onEvent({ type: "voice.stt.result", sessionId: sid, text: "重复" }), false)
    assert.equal(f.input.value, "原草稿 识别结果")
    assert.ok(f.stopped > 0)
  } finally { f.controller.cancel() }
})

test("#482 a delayed result cannot enter another thread or a cancelled dictation", async () => {
  for (const cancel of [false, true]) {
    const end = deferred<any>()
    const f = fixture("local", (path) => path === "/api/stt/end" ? end.promise : undefined)
    await f.start(); f.audio(); f.controller.toggle(); await settle()
    if (cancel) f.controller.cancel(); else f.owner("thread-b")
    end.resolve({ type: "voice.stt.result", text: "旧会话结果" }); await settle()
    assert.equal(f.input.value, "原草稿"); f.controller.cancel()
  }
})

test("#482 cancel while start is pending releases mic and aborts after start acknowledgement", async () => {
  const start = deferred<any>()
  const f = fixture("local", (path) => path === "/api/stt/start" ? start.promise : undefined)
  await f.start(); f.controller.cancel(); start.resolve({ type: "ok" }); await settle()
  assert.ok(f.stopped > 0)
  assert.deepEqual(f.requests.filter((r) => r.path.startsWith("/api/stt/")).map((r) => r.path), ["/api/stt/start", "/api/stt/abort"])
  assert.equal(f.controller.active(), false)
})

test("#482 upload failures stop capture and never call end or commit partial text", async () => {
  const f = fixture("local", (path) => path === "/api/stt/chunk" ? { type: "error", error: "连接已断开" } : undefined)
  await f.start(); f.audio(); await settle()
  assert.equal(f.controller.active(), false); assert.ok(f.stopped > 0)
  assert.match(f.elements[0].textContent, /连接已断开/)
  assert.equal(f.requests.some((r) => r.path === "/api/stt/end"), false)
  assert.equal(f.input.value, "原草稿")
})

test("#482 voice final / partial transport deadlines cover the inference budgets", () => {
  assert.ok(summonerVoiceRequestTimeout("voice.stt.end")! > 300_000)
  assert.ok(summonerVoiceRequestTimeout("voice.stt.partial_request")! > 25_000)
  assert.equal(summonerVoiceRequestTimeout("thread.list"), undefined)
})

test("#482 pending partial cannot delay end or commit a duplicate SSE / HTTP final", async () => {
  const partial = deferred<any>(), end = deferred<any>()
  const f = fixture("local", (path) => path === "/api/stt/partial" ? partial.promise : path === "/api/stt/end" ? end.promise : undefined)
  await f.start(); f.audio(); await settle()
  assert.equal(f.fireTimer(1400), true); await settle()
  assert.equal(f.requests.filter((r) => r.path === "/api/stt/partial").length, 1)
  f.controller.toggle(); await settle()
  // The partial is unresolved: reaching end proves it is outside the upload queue.
  assert.equal(f.requests.filter((r) => r.path === "/api/stt/end").length, 1)
  const sid = f.requests.find((r) => r.path === "/api/stt/start")!.data.sessionId
  assert.equal(f.controller.onEvent({ type: "voice.stt.result", sessionId: sid, text: "重复最终结果" }), true)
  assert.equal(f.input.value, "原草稿")
  // Even a malformed engine returning a final to the partial endpoint cannot commit.
  partial.resolve({ type: "voice.stt.result", sessionId: sid, text: "重复最终结果" }); await settle()
  assert.equal(f.input.value, "原草稿")
  end.resolve({ type: "voice.stt.result", sessionId: sid, text: "唯一最终结果" }); await settle()
  assert.equal(f.input.value, "原草稿 唯一最终结果")
  assert.equal(f.controller.active(), false)
  assert.equal(f.fireTimer(1400), false)
  f.controller.onEvent({ type: "voice.stt.result", sessionId: sid, text: "重复最终结果" })
  assert.equal(f.input.value, "原草稿 唯一最终结果")
})

test("#482 stopping cancels a scheduled partial before it can issue another decode", async () => {
  const f = fixture(); await f.start(); f.audio(); f.controller.toggle(); await settle()
  assert.equal(f.fireTimer(1400), false)
  assert.equal(f.requests.some((r) => r.path === "/api/stt/partial"), false)
  assert.equal(f.input.value, "原草稿 识别结果")
})
