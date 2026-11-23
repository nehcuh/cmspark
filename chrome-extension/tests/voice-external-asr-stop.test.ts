/**
 * Actual external listen timer: one candidate that reaches both caps shows both reasons.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { externalStopNotice } from "../src/sidepanel/voice/external-asr-ui"

test("a candidate chunk that crosses duration and size names both limits and the kept prefix", () => {
  const notice = externalStopNotice({
    committedWavBytes: 44,
    candidatePcmBytes: 100000,
    maxDurationMs: 1000,
    maxBytes: 32100,
  })
  assert.match(notice, /已到录音时长上限/)
  assert.match(notice, /已到文件大小上限/)
  assert.match(notice, /正在转写已录的这一段/)
})

function harness() {
  const root = path.resolve(process.cwd(), "src/sidepanel")
  const at = (relative: string) => path.resolve(root, relative)
  const modules = new Map<string, any>()
  const timers: Array<{ fn: () => void; ms: number }> = []
  const browserLanguages: string[] = []
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  const effectQueue: Array<() => void> = []
  const flushEffects = () => { while (effectQueue.length) effectQueue.shift()!() }
  const react: any = {
    useState: (initial: any) => {
      const owned = frame!, index = cursor++
      if (!(index in owned.cells)) owned.cells[index] = typeof initial === "function" ? initial() : initial
      return [owned.cells[index], (value: any) => { owned.cells[index] = typeof value === "function" ? value(owned.cells[index]) : value }]
    },
    useRef: (initial: any) => {
      const owned = frame!, index = cursor++
      if (!(index in owned.cells)) owned.cells[index] = { current: initial }
      return owned.cells[index]
    },
    useCallback: (fn: any, deps: any[]) => react.useMemo(() => fn, deps),
    useMemo: (fn: any, deps: any[]) => {
      const owned = frame!, index = cursor++, old = owned.cells[index]
      if (!old || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) owned.cells[index] = { deps, value: fn() }
      return owned.cells[index].value
    },
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || !deps || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps: deps ?? [], cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const runtime = { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
  function load(filename: string): any {
    filename = path.resolve(filename)
    if (modules.has(filename)) return modules.get(filename)
    const output: any = {}
    modules.set(filename, output)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const loadDependency = (id: string) => {
      if (id === "react") return react
      if (id === "react/jsx-runtime") return runtime
      assert.ok(id.startsWith("."), `unexpected nonlocal dependency ${id}`)
      const target = path.resolve(path.dirname(filename), id)
      const actual = [target + ".ts", target + ".tsx", target + "/index.ts", target + "/index.tsx"].find(file => fs.existsSync(file))
      assert.ok(actual, `missing dependency ${id}`)
      return load(actual!)
    }
    vm.runInNewContext(code, {
      exports: output, require: loadDependency,
      SpeechRecognition: class {
        lang = ""
        start() { browserLanguages.push(this.lang) }
        abort() {}
      },
      chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {}, removeListener() {} } } },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
        },
        userAgent: "test",
      },
      MediaRecorder: Object.assign(function MediaRecorder(this: { state: string; onstop?: () => void }) {
        this.state = "inactive"
      }, {
        prototype: {
          start(this: { state: string }) { this.state = "recording" },
          stop(this: { state: string; onstop?: () => void }) {
            this.state = "inactive"
            this.onstop?.()
          },
        },
        isTypeSupported: () => false,
      }),
      window: {},
      document: { querySelector: () => null },
      URL, URLSearchParams, AbortController, TextEncoder, TextDecoder,
      setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length },
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
      console,
    }, { timeout: 5000, filename })
    return output
  }
  const hook = load(at("hooks/useVoiceInput.ts"))
  function render(props: any) {
    const key = "voice"
    if (!slots.has(key)) slots.set(key, { cells: [], effects: [] })
    frame = slots.get(key); cursor = 0; effectCursor = 0
    let api: any
    function Host() { api = hook.useVoiceInput(props); return null }
    Host()
    frame = undefined
    flushEffects()
    return api
  }
  return { render, timers, browserLanguages }
}

test("chat hook starts browser recognition in the selected locale and defaults older profiles to Mandarin", () => {
  for (const language of [undefined, "en-US"]) {
    const ui = harness()
    const api = ui.render({ getBaseText: () => "", onDraft() {}, allowStart: true, enabled: true, privacyAck: true, language })
    api.toggle()
    assert.deepEqual(ui.browserLanguages, [language ?? "zh-CN"])
  }
})

test("the listen timer shows both limit sentences when the stop reaches both caps", async () => {
  const ui = harness()
  const props = {
    getBaseText: () => "",
    onDraft: () => {},
    allowStart: true,
    enabled: true,
    companionConnected: true,
    sttEngine: "external",
    externalMaxDurationMs: 1000,
    externalMaxBytes: 32044,
    privacyAckV2: true,
    onNeedPrivacyAck: () => {},
  }
  let api = ui.render(props)
  api.toggle()
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  const timer = ui.timers.find((item) => item.ms === 1000)
  assert.ok(timer, "external stop timer is armed at the duration cap")
  timer!.fn()
  api = ui.render(props)
  assert.match(api.banner ?? "", /已到录音时长上限/)
  assert.match(api.banner ?? "", /已到文件大小上限/)
  assert.match(api.banner ?? "", /正在转写已录的这一段/)
})
