/**
 * Real SettingsSlideout: DeepSeek hides the model field; OpenAI shows the stored model.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

function textOf(node: any): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (typeof node === "object") return textOf(node.props?.children)
  return ""
}

function harness() {
  const root = path.resolve(process.cwd(), "src/sidepanel")
  const at = (relative: string) => path.resolve(root, relative)
  const modules = new Map<string, any>()
  const messages: any[] = []
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  let store: any
  let state: any
  const effectQueue: Array<() => void> = []
  const flushEffects = () => { while (effectQueue.length) effectQueue.shift()!() }
  const react: any = {
    createContext: (value: any) => { const context: any = { current: value }; context.Provider = { context }; return context },
    useContext: (context: any) => context.current,
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
    useId: () => { const owned = frame!, index = cursor++; if (!(index in owned.cells)) owned.cells[index] = `ext-${index}`; return owned.cells[index] },
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps, cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const runtime = { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
  const chromeValue = { runtime: {
    lastError: undefined,
    getURL: (value: string) => "chrome-extension://owned/" + value,
    sendMessage: (message: any) => { messages.push(message); return Promise.resolve(undefined) },
    onMessage: { addListener() {}, removeListener() {} },
  }, tabs: { create: () => Promise.resolve({}), query() {} } }
  const leafNames = [
    "ui/Modal", "UserEnvSection", "SiteCounterSettingsSection", "NetSecSettingsSection",
    "CapabilityProfileSection", "OutboundMcpSettingsSection", "HotkeyCaptureField",
    "AutopilotConsequenceMatrix", "KnowledgeSubPanel", "McpPanel", "AppsPanel", "PacksPanel",
    "BoardPanel", "MeetingPanel", "ProjectPanel", "personal-workspace/RecentActivitySources",
  ]
  const leafExportName: Record<string, string> = {
    "ui/Modal": "Modal", UserEnvSection: "UserEnvSection", SiteCounterSettingsSection: "SiteCounterSettingsSection",
    NetSecSettingsSection: "NetSecSettingsSection", CapabilityProfileSection: "CapabilityProfileSection",
    OutboundMcpSettingsSection: "OutboundMcpSettingsSection", HotkeyCaptureField: "HotkeyCaptureField",
    AutopilotConsequenceMatrix: "AutopilotConsequenceMatrix", KnowledgeSubPanel: "KnowledgeSubPanel",
    McpPanel: "McpPanel", AppsPanel: "AppsPanel", PacksPanel: "PacksPanel", BoardPanel: "BoardPanel",
    MeetingPanel: "MeetingPanel", ProjectPanel: "ProjectPanel", "personal-workspace/RecentActivitySources": "RecentActivitySources",
  }
  const dispatch = (action: any) => { state = store.agentReducer(state, action) }
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
      if (target === at("store/agentStore") && store) return { ...store, useAgentStore: () => ({ state, dispatch }) }
      if (target === at("components/ContextPanelHost") && path.basename(filename) === "SettingsSlideout.tsx") {
        return { ...load(target + ".tsx"), useContextPanelHostOptional: () => null }
      }
      if (target === at("components/personal-workspace/useActivity")) return { useActivity: () => ({ snapshot: null }) }
      if (target === at("components/ThreadList")) return { createBlankThread: () => assert.fail("unrelated thread creation") }
      const leaf = leafNames.find(name => target === at("components/" + name))
      if (leaf) return { [leafExportName[leaf]]: function UnmountedLeaf() { return null } }
      const actual = [target + ".ts", target + ".tsx", target + "/index.ts", target + "/index.tsx"].find(file => fs.existsSync(file))
      assert.ok(actual, `missing dependency ${id}`)
      return load(actual!)
    }
    vm.runInNewContext(code, {
      exports: output, require: loadDependency, chrome: chromeValue,
      window: { setTimeout: () => 1, clearTimeout() {}, location: { pathname: "/sidepanel.html", search: "" }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
      document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} },
      CustomEvent: class { type: string; detail: any; constructor(type: string, options?: any) { this.type = type; this.detail = options?.detail } },
      URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, crypto: { randomUUID: () => "owned-uuid" },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, console,
    }, { timeout: 5000, filename })
    return output
  }
  store = load(at("store/agentStore.tsx"))
  state = { ...store.initialState, settingsOpen: true }
  const slideout = load(at("components/SettingsSlideout.tsx"))
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  function renderSlideout() {
    const key = "slideout"
    if (!slots.has(key)) slots.set(key, { cells: [], effects: [] })
    frame = slots.get(key); cursor = 0; effectCursor = 0
    const ui = slideout.SettingsSlideout({})
    frame = undefined
    flushEffects()
    return ui
  }
  return { dispatch, messages, renderSlideout, rows, state: () => state }
}

const externalState = {
  sttEngine: "external" as const,
  localModelId: "medium",
  recommendedModelId: "medium",
  models: {},
  binary: { status: "not_found" },
  diskBudgetMB: 4096,
  diskUsedMB: 0,
  external: {
    style: "deepseek" as const,
    baseUrl: "",
    normalizedUrl: "https://api.deepseek.com/v1/tools/asr",
    model: "kept-model",
    keyConfigured: true,
    maxDurationMs: 120000,
    maxBytes: 8388608,
    requestTimeoutMs: 180000,
    limitNote: "deepseek-docs" as const,
  },
}

function externalPanel(rows: (node: any) => any[], ui: any) {
  const panels = rows(ui).filter((node) => {
    const text = textOf(node)
    return text.includes("保存外部转写") && text.includes("接口") && !text.includes("发送快捷键")
  })
  assert.ok(panels.length > 0, "external settings panel is rendered")
  return panels.sort((a, b) => textOf(a).length - textOf(b).length)[0]
}

function modelLabels(rows: (node: any) => any[], panel: any) {
  return rows(panel).filter((node) => node.type === "label" && textOf(node).startsWith("模型"))
}

test("DeepSeek settings hide the model field and do not send one", () => {
  const ui = harness()
  ui.dispatch({ type: "SET_VOICE_MODEL_STATE", modelState: externalState })
  ui.renderSlideout()
  const rendered = ui.renderSlideout()
  const panel = externalPanel(ui.rows, rendered)
  assert.equal(modelLabels(ui.rows, panel).length, 0)
  const save = ui.rows(panel).find((node) => node.type === "button" && textOf(node).includes("保存外部转写"))
  assert.ok(save)
  save.props.onClick()
  const sent = ui.messages.filter((message) => message.type === "voice.external.set")
  assert.equal(sent.length, 1)
  assert.equal("model" in sent[0], false)
  assert.equal(sent[0].style, "deepseek")
})

test("OpenAI settings show the stored model", () => {
  const ui = harness()
  ui.dispatch({
    type: "SET_VOICE_MODEL_STATE",
    modelState: {
      ...externalState,
      external: { ...externalState.external, style: "openai", model: "kept-model", maxDurationMs: null, maxBytes: 25000000, limitNote: "openai-file-cap" },
    },
  })
  ui.renderSlideout()
  const rendered = ui.renderSlideout()
  const panel = externalPanel(ui.rows, rendered)
  const labels = modelLabels(ui.rows, panel)
  assert.equal(labels.length, 1)
  const input = ui.rows(labels[0]).find((node) => node.type === "input")
  assert.equal(input?.props.value, "kept-model")
})

test("a rejected engine change restores the committed selection", () => {
  const ui = harness()
  ui.dispatch({ type: "SET_VOICE_MODEL_STATE", modelState: externalState })
  let rendered = ui.renderSlideout()
  const radios = () => ui.rows(rendered).filter(node => node.type === "input" && node.props.name === "voice-stt-engine")
  radios()[0].props.onChange()
  rendered = ui.renderSlideout()
  assert.equal(radios()[0].props.checked, true)
  ui.dispatch({ type: "SET_VOICE_MODEL_ERROR", error: "引擎切换失败" })
  ui.renderSlideout()
  rendered = ui.renderSlideout()
  assert.equal(radios()[1].props.checked, true)
})

test("a rejected external save retains the typed key for correction", () => {
  const ui = harness()
  ui.dispatch({ type: "SET_VOICE_MODEL_STATE", modelState: externalState })
  let rendered = ui.renderSlideout()
  let panel = externalPanel(ui.rows, rendered)
  const key = ui.rows(panel).find(node => node.type === "input" && node.props.type === "password")
  key.props.onChange({ target: { value: "fixture-secret" } })
  rendered = ui.renderSlideout()
  panel = externalPanel(ui.rows, rendered)
  ui.rows(panel).find(node => node.type === "button" && textOf(node).includes("保存外部转写")).props.onClick()
  ui.dispatch({ type: "SET_VOICE_MODEL_ERROR", error: "配置没有保存" })
  rendered = ui.renderSlideout()
  panel = externalPanel(ui.rows, rendered)
  assert.equal(ui.rows(panel).find(node => node.type === "input" && node.props.type === "password").props.value, "fixture-secret")
})

test("background forwards external dictation settings to Companion", () => {
  const source = fs.readFileSync(path.resolve("src/background/index.ts"), "utf8")
  const start = source.indexOf('case "voice.model.get_state"')
  const end = source.indexOf('case "voice.ptt.page_chord"', start)
  const calls: unknown[] = []
  const message = { type: "voice.external.set", style: "deepseek", source: "settings", apiKey: "fixture-key" }
  const code = ts.transpileModule(`(() => { switch (message.type) { ${source.slice(start, end)} } })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    message,
    wsClient: { send: (frame: unknown) => { calls.push(frame); return true } },
    sendResponse: (response: { ok: boolean }) => { assert.equal(response.ok, true) },
  })
  assert.deepEqual(calls, [message])
})
