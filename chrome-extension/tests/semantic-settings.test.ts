import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as jsxRuntime from "react/jsx-runtime"
import { requestSemanticSettings } from "../src/sidepanel/utils/semantic-settings"

/** Executes the actual component with controlled hooks; no browser or model call. */
function harness() {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/sidepanel/components/SettingsIntentBar.tsx"), "utf8")
  const cells: any[] = [], calls: any[] = [], intents: any[] = [], recognizers: any[] = [], effects: any[] = []
  let cursor = 0, effectCursor = 0
  const react = {
    useState(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = initial; return [cells[slot], (value: any) => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value }] },
    useRef(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot] },
    useCallback(fn: any) { return fn },
    useEffect(effect: () => any, deps: any[]) { const slot = effectCursor++, old = effects[slot]; if (!old || deps.some((v, i) => v !== old.deps[i])) { old?.cleanup?.(); effects[slot] = { deps, cleanup: effect() } } },
  }
  class Recognition { onresult: any; onend: any; onerror: any; start() { recognizers.push(this) }; stop() { this.onend?.() }; abort() {} }
  const change = (id: string, settingId: string) => ({ id, settingId, label: settingId, before: true, after: false, reason: "减少干扰", scope: "companion", section: "integrations", prerequisites: [] })
  const proposal = { id: "controlled", expiresAt: Date.now() + 300000, intent: "减少干扰", candidates: [
    { id: "first", title: "减少建议", reason: "按需打开", tradeoffs: "自行打开", changes: [change("one", "coding.autoSuggest")] },
    { id: "second", title: "减少额外历史", reason: "减少保留", tradeoffs: "不再归档", changes: [change("one", "history.fullToolHistory"), change("two", "history.backgroundDigest")] },
  ] }
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, AbortController,
    require(id: string) {
      if (id === "react") return react
      if (id === "react/jsx-runtime") return jsxRuntime
      if (id === "../utils/settings-intent") return { parseSettingsIntent: () => ({ type: "unknown" }) }
      if (id === "../utils/semantic-settings") return { semanticValue: String, requestSemanticSettings: async (type: string, fields: any) => { calls.push({ type, fields }); return type.endsWith("propose") ? { proposal } : { items: [] } } }
      if (id === "../voice/detect") return { getSpeechRecognitionCtor: () => Recognition, VOICE_DEFAULT_LANG: "zh-CN" }
      if (id === "../ui/tokens") return { tokens: {} }
      throw Error(id)
    },
  }, { timeout: 1000 })
  const render = (active = true) => { cursor = 0; effectCursor = 0; return exports.SettingsIntentBar({ active, onIntent: (intent: any) => { intents.push(intent); return "已打开" } }) }
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  return { calls, intents, recognizers, render, rows, find: (ui: any, predicate: (node: any) => boolean) => { const found = rows(ui).filter(predicate); assert.equal(found.length, 1); return found[0] } }
}
test("actual voice result/end only fill draft, never generate/apply/invoke mutating intent", () => {
  const f = harness()
  f.find(f.render(), n => n.type === "button" && n.props.children === "语音").props.onClick()
  assert.equal(f.recognizers.length, 1)
  f.recognizers[0].onresult({ results: [[{ transcript: "开启连续听写" }]] }); f.recognizers[0].onend()
  assert.equal(f.find(f.render(), n => n.type === "input" && n.props.type === "text").props.value, "开启连续听写")
  assert.equal(f.calls.length, 0); assert.equal(f.intents.length, 0)
})
test("actual candidate and item selection have no effects; explicit confirm only submits selected ids", async () => {
  const f = harness()
  f.find(f.render(), n => n.type === "input" && n.props.type === "text").props.onChange({ target: { value: "少打扰我" } })
  await f.find(f.render(), n => n.type === "button" && n.props.children === "生成候选").props.onClick()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].type, "settings.assistant.propose")
  const radios = f.rows(f.render()).filter(n => n.type === "input" && n.props.type === "radio")
  assert.equal(radios.length, 2); radios[1].props.onChange()
  const boxes = f.rows(f.render()).filter(n => n.type === "input" && n.props.type === "checkbox")
  boxes[1].props.onChange({ target: { checked: false } }); assert.equal(f.calls.length, 1)
  await f.find(f.render(), n => n.type === "button" && String(n.props.children).startsWith("确认提交")).props.onClick()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].type, "settings.assistant.apply")
  assert.equal(f.calls[1].fields.userConfirmed, true); assert.equal(f.calls[1].fields.candidateId, "second")
  assert.equal(JSON.stringify(f.calls[1].fields.changeIds), '["one"]'); assert.equal(f.intents.length, 0)
})
test("actual recognizer late callbacks after inactive are ignored", () => {
  const f = harness()
  f.find(f.render(), n => n.type === "button" && n.props.children === "语音").props.onClick()
  f.render(false); f.recognizers[0].onresult({ results: [[{ transcript: "late" }]] }); f.recognizers[0].onend()
  assert.equal(f.find(f.render(false), n => n.type === "input" && n.props.type === "text").props.value, "")
  assert.equal(f.calls.length, 0)
})
test("transport ACK and wrong correlation never resolve save; matching backend receipt does", async () => {
  const previous = (globalThis as any).chrome, listeners = new Set<(message: any) => void>()
  let sent: any
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener(fn: any) { listeners.add(fn) }, removeListener(fn: any) { listeners.delete(fn) } }, sendMessage: async (m: any) => { sent = m; return { ok: true } } } }
  try {
    let resolved = false
    const pending = requestSemanticSettings("settings.assistant.apply", { proposalId: "owned", candidateId: "first", changeIds: ["one"], userConfirmed: true }, new AbortController().signal).then(result => { resolved = true; return result })
    await Promise.resolve(); assert.equal(resolved, false)
    for (const fn of listeners) fn({ id: "foreign", type: "settings.assistant.receipt", proposalId: "owned", items: [] })
    for (const fn of listeners) fn({ id: sent.id, type: "settings.assistant.receipt", proposalId: "foreign", items: [] })
    await Promise.resolve(); assert.equal(resolved, false)
    for (const fn of listeners) fn({ id: sent.id, type: "settings.assistant.receipt", proposalId: "owned", items: [] })
    assert.equal((await pending).type, "settings.assistant.receipt"); assert.equal(listeners.size, 0)
  } finally { (globalThis as any).chrome = previous }
})

/**
 * Full production components run with deterministic React hooks and inert browser
 * ports. Only unrelated leaf UI bodies and activity transport are replaced. The
 * real store defaults/reducer, parser, component callbacks and host lifecycle run.
 */
function settingsNavigationHarness(full = true, sourceOverrides: Record<string, string> = {}) {
  const root = path.resolve(process.cwd(), "src/sidepanel"), at = (relative: string) => path.resolve(root, relative)
  const modules = new Map<string, any>()
  const listeners = new Map<string, Set<(event: any) => void>>()
  const toasts: string[] = [], actions: any[] = [], messages: any[] = [], tabRequests: any[] = [], intentResults: Promise<string>[] = []
  const stateWrites = new Set<(owner: unknown, value: any) => void>()
  const deferred = () => { let resolve!: (value?: any) => void, reject!: (reason?: any) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined, cursor = 0, effectCursor = 0
  let store: any, state: any, host: any, hostAvailable = true
  const effectQueue: Array<() => void> = []
  let passiveEffectsDeferred = false
  const flushEffects = () => { while (effectQueue.length) effectQueue.shift()!() }
  const react: any = {
    createContext: (value: any) => { const context: any = { current: value }; context.Provider = { context }; return context },
    useContext: (context: any) => context.current,
    useState: (initial: any) => { const owned = frame!, at = cursor++; if (!(at in owned.cells)) owned.cells[at] = typeof initial === "function" ? initial() : initial; return [owned.cells[at], (value: any) => { owned.cells[at] = typeof value === "function" ? value(owned.cells[at]) : value; for (const wrote of stateWrites) wrote(owned, owned.cells[at]) }] },
    useRef: (initial: any) => { const owned = frame!, at = cursor++; if (!(at in owned.cells)) owned.cells[at] = { current: initial }; return owned.cells[at] },
    useCallback: (fn: any, deps: any[]) => react.useMemo(() => fn, deps),
    useMemo: (fn: any, deps: any[]) => {
      const owned = frame!, at = cursor++, old = owned.cells[at]
      if (!old || deps.length !== old.deps.length || deps.some((value, index) => value !== old.deps[index])) owned.cells[at] = { deps, value: fn() }
      return owned.cells[at].value
    },
    useId: () => { const owned = frame!, at = cursor++; if (!(at in owned.cells)) owned.cells[at] = `navigation-${at}`; return owned.cells[at] },
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, at = effectCursor++, old = owned.effects[at]
      if (!old || deps.length !== old.deps.length || deps.some((value, index) => value !== old.deps[index])) {
        const next = { deps, cleanup: undefined as any }
        owned.effects[at] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const runtime = { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
  class CustomEventValue { type: string; detail: any; constructor(type: string, options?: any) { this.type = type; this.detail = options?.detail } }
  const windowValue = {
    location: { pathname: full ? "/tabs/workspace.html" : "/sidepanel.html", search: "" },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (name: string, fn: any) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn) },
    removeEventListener: (name: string, fn: any) => { listeners.get(name)?.delete(fn) },
    dispatchEvent: (event: any) => { if (event.type === "cmspark:toast") toasts.push(event.detail); for (const fn of [...(listeners.get(event.type) || [])]) fn(event); return true },
    setTimeout: () => 1, clearTimeout() {}, confirm: () => false,
  }
  const chromeValue = { runtime: {
    getURL: (value: string) => "chrome-extension://owned/" + value,
    sendMessage: (...args: any[]) => { messages.push(args[0]); return Promise.resolve(undefined) },
    onMessage: { addListener() {}, removeListener() {} },
  }, tabs: { create: (options: any) => { const pending = deferred(); tabRequests.push({ options, ...pending }); return pending.promise }, query() { assert.fail("unrelated tab query") } } }
  const leafExports: Record<string, string[]> = {
    "ui/Modal": ["Modal"], UserEnvSection: ["UserEnvSection"], SiteCounterSettingsSection: ["SiteCounterSettingsSection"],
    NetSecSettingsSection: ["NetSecSettingsSection"], CapabilityProfileSection: ["CapabilityProfileSection"], OutboundMcpSettingsSection: ["OutboundMcpSettingsSection"],
    CodingHandoffSettingsSection: ["CodingHandoffSettingsSection"], HotkeyCaptureField: ["HotkeyCaptureField"], AutopilotConsequenceMatrix: ["AutopilotConsequenceMatrix"],
    KnowledgeSubPanel: ["KnowledgeSubPanel"], McpPanel: ["McpPanel"], AppsPanel: ["AppsPanel"], PacksPanel: ["PacksPanel"], BoardPanel: ["BoardPanel"], MeetingPanel: ["MeetingPanel"],
    ProjectPanel: ["ProjectPanel"], "personal-workspace/RecentActivitySources": ["RecentActivitySources"],
  }
  const dispatch = (action: any) => { actions.push(action); state = store.agentReducer(state, action) }
  function load(filename: string): any {
    filename = path.resolve(filename)
    if (modules.has(filename)) return modules.get(filename)
    const source = sourceOverrides[filename] ?? fs.readFileSync(filename, "utf8"), output: any = {}
    modules.set(filename, output)
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const loadDependency = (id: string) => {
      if (id === "react") return react
      if (id === "react/jsx-runtime") return runtime
      assert.ok(id.startsWith("."), `unexpected nonlocal component dependency ${id}`)
      const target = path.resolve(path.dirname(filename), id)
      if (target === at("store/agentStore") && store) return { ...store, useAgentStore: () => ({ state, dispatch }) }
      if (target === at("components/ContextPanelHost") && path.basename(filename) === "SettingsSlideout.tsx" && !hostAvailable) return { ...load(target + ".tsx"), useContextPanelHostOptional: () => null }
      if (target === at("components/personal-workspace/useActivity")) return { useActivity: () => ({ snapshot: null }) }
      if (target === at("components/ThreadList")) return { createBlankThread: () => assert.fail("unrelated thread creation") }
      const leaf = Object.entries(leafExports).find(([name]) => target === at("components/" + name))
      if (leaf) return Object.fromEntries(leaf[1].map(name => [name, function InertUnrelatedLeaf() { assert.fail("unrelated leaf was mounted") }]))
      const actual = [target + ".ts", target + ".tsx", target + "/index.ts", target + "/index.tsx"].find(file => fs.existsSync(file))
      assert.ok(actual, `missing actual component dependency ${id}`)
      return load(actual!)
    }
    vm.runInNewContext(code, { exports: output, require: loadDependency, window: windowValue, chrome: chromeValue,
      document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} },
      CustomEvent: CustomEventValue, URLSearchParams, AbortController, TextEncoder, TextDecoder,
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, console,
    }, { timeout: 1000, filename })
    return output
  }
  store = load(at("store/agentStore.tsx"))
  state = { ...store.initialState, settingsOpen: true }
  const hostModule = load(at("components/ContextPanelHost.tsx"))
  const slideout = load(at("components/SettingsSlideout.tsx"))
  const intentBar = load(at("components/SettingsIntentBar.tsx"))
  const workspace = load(at("components/WorkspaceFrame.tsx"))
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  function render(key: string, fn: any, props: any = {}) {
    if (!slots.has(key)) slots.set(key, { cells: [], effects: [] })
    frame = slots.get(key); cursor = 0; effectCursor = 0
    const ui = fn(props)
    if (ui?.type?.context) { ui.type.context.current = ui.props.value; host = ui.props.value }
    frame = undefined
    if (!passiveEffectsDeferred) flushEffects()
    return ui
  }
  const renderHost = () => render("host", hostModule.ContextPanelHostProvider, { capabilityLevel: "computer", children: null })
  const renderWorkspace = () => render("workspace", workspace.WorkspaceFrame, { children: null })
  const renderSlideout = () => render("slideout", slideout.SettingsSlideout)
  const find = (ui: any, predicate: (node: any) => boolean) => { const found = rows(ui).filter(predicate); assert.equal(found.length, 1); return found[0] }
  function assistant() {
    let ui = renderSlideout()
    find(ui, n => n.type === "details" && n.props.className === "cm-settings-assistant").props.onToggle({ currentTarget: { open: true } })
    ui = renderSlideout()
    return find(ui, n => n.type === intentBar.SettingsIntentBar).props
  }
  renderHost(); renderWorkspace()
  return {
    actions, messages, toasts, tabRequests, intentResults, deferred, rows, find, renderHost, renderWorkspace, renderSlideout, assistant,
    host: () => host, state: () => state,
    setState(patch: any) { state = { ...state, ...patch }; renderHost(); renderWorkspace() },
    setSettingsOpen(open: boolean) { dispatch({ type: "SET_SETTINGS_OPEN", open }); renderHost(); renderWorkspace() },
    deferEffects() { passiveEffectsDeferred = true },
    flushEffects() { passiveEffectsDeferred = false; flushEffects() },
    pendingEffects: () => effectQueue.length,
    selectThread(threadId: string) { dispatch({ type: "SET_ACTIVE_THREAD", threadId }); renderHost(); renderWorkspace() },
    batchedThreadABA() {
      const threadId = state.activeThreadId, revision = state.activeThreadSelectionRevision
      assert.equal(typeof threadId, "string")
      dispatch({ type: "SET_ACTIVE_THREAD", threadId: threadId === "owner-a" ? "owner-b" : "owner-a" })
      dispatch({ type: "SET_ACTIVE_THREAD", threadId })
      assert.equal(state.activeThreadId, threadId); assert.equal(state.activeThreadSelectionRevision, revision + 2)
      // One render after both real reducer selections, as in React's batched ABA.
      renderHost(); renderWorkspace()
    },
    noHost() { hostAvailable = false; modules.delete(at("components/SettingsSlideout.tsx")); Object.assign(slideout, load(at("components/SettingsSlideout.tsx"))) },
    renderBar: (props = assistant()) => render("intent", intentBar.SettingsIntentBar, { ...props, onIntent: (...args: any[]) => {
      const result = props.onIntent(...args); intentResults.push(Promise.resolve(result)); return result
    } }),
    destination(destination: "activity" | "todos") { assistant().onOpenDestination(destination) },
    nextBarMessage() {
      const owner = slots.get("intent"); assert.ok(owner)
      return new Promise<void>(resolve => {
        const wrote = (changed: unknown, value: any) => {
          if (changed === owner && typeof value === "string" && value.length > 0) { stateWrites.delete(wrote); resolve() }
        }
        stateWrites.add(wrote)
      })
    },
    close() { flushEffects(); for (const entry of slots.values()) for (const effect of entry.effects) effect?.cleanup?.(); listeners.clear(); stateWrites.clear() },
  }
}
const navigationTurn = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const navigationText = (node: any): string => Array.isArray(node) ? node.map(navigationText).join("") : node && typeof node === "object" ? navigationText(node.props?.children) : String(node ?? "")

test("#756 actual settings destination callback retains settings on security task and tab failure and closes only accepted current navigation", async () => {
  for (const blocker of [{ pendingSecurityConfirmations: [{ id: "owned-confirmation" }] }, { computerTask: { status: "running" } }, { computerTask: { status: "paused" } }]) {
    const f = settingsNavigationHarness(true)
    try { f.setState(blocker); f.destination("activity"); assert.equal(f.state().settingsOpen, true); assert.equal(f.tabRequests.length, 0); assert.match(f.toasts.at(-1)!, /先处理待确认/); assert.equal(f.actions.some(a => a.type === "SET_SETTINGS_OPEN" && !a.open), false) } finally { f.close() }
  }
  for (const fullPage of [true, false]) for (const change of ["task", "security", "settingsABA"] as const) {
    const f = settingsNavigationHarness(fullPage)
    try {
      f.deferEffects()
      if (change === "task") f.setState({ computerTask: { status: "running" } })
      if (change === "security") f.setState({ pendingSecurityConfirmations: [{ id: "owned-rendered-confirmation" }] })
      if (change === "settingsABA") { f.setSettingsOpen(false); f.setSettingsOpen(true) }
      assert.ok(f.pendingEffects() > 0, "production render completed before the prior event listener's passive cleanup")
      const actions = f.actions.length
      // Actual Slideout callback emits the real CustomEvent to the still-installed old listener.
      f.destination("activity")
      assert.equal(f.state().settingsOpen, true); assert.equal(f.tabRequests.length, 0)
      assert.equal(f.actions.slice(actions).some(a => a.type === "SET_SETTINGS_OPEN" && !a.open), false)
      assert.match(f.toasts.at(-1)!, change === "settingsABA" ? /页面已变化/ : /先处理待确认/)
      assert.ok(f.pendingEffects() > 0, "the old listener was rejected before passive cleanup ran")
      f.flushEffects()
      f.setState({ pendingSecurityConfirmations: [], computerTask: null })
      f.destination("todos")
      if (fullPage) assert.equal(f.state().settingsOpen, false)
      else {
        assert.equal(f.state().settingsOpen, true); assert.equal(f.tabRequests.length, 1)
        f.tabRequests[0].resolve({ id: 1 }); await navigationTurn(); assert.equal(f.state().settingsOpen, false)
      }
    } finally { f.close() }
  }
  const full = settingsNavigationHarness(true)
  try { full.destination("todos"); assert.equal(full.state().settingsOpen, false); const ui = full.renderWorkspace(); assert.equal(full.find(ui, n => n.props?.className === "cm-personal-mount" && n.props.hidden === false).props.children.props.destination, "todos") } finally { full.close() }
  for (const outcome of ["success", "failure", "left", "blocked", "thread", "threadABA", "beforePassiveTask", "beforePassiveSecurity", "beforePassiveSettingsABA", "ordinaryRender"] as const) {
    const f = settingsNavigationHarness(false)
    try {
      if (outcome === "threadABA") f.selectThread("owner-a")
      f.destination("activity"); assert.equal(f.state().settingsOpen, true); assert.equal(f.tabRequests.length, 1)
      assert.equal(f.tabRequests[0].options.url, "chrome-extension://owned/tabs/workspace.html?view=activity")
      f.destination("todos"); assert.equal(f.tabRequests.length, 1, "busy must not create a second tab")
      if (outcome === "left") { f.setState({ settingsOpen: false }); f.setState({ settingsOpen: true }) }
      if (outcome === "blocked") f.setState({ computerTask: { status: "running" } })
      if (outcome === "thread") f.selectThread("changed-owner")
      if (outcome === "threadABA") f.batchedThreadABA()
      if (outcome === "beforePassiveTask" || outcome === "beforePassiveSecurity" || outcome === "beforePassiveSettingsABA") {
        f.deferEffects()
        if (outcome === "beforePassiveTask") f.setState({ computerTask: { status: "running" } })
        if (outcome === "beforePassiveSecurity") f.setState({ pendingSecurityConfirmations: [{ id: "owned-new-confirmation" }] })
        if (outcome === "beforePassiveSettingsABA") { f.setSettingsOpen(false); f.setSettingsOpen(true) }
        assert.ok(f.pendingEffects() > 0, "the changed production component rendered but passive cleanup has not run")
      }
      if (outcome === "ordinaryRender") f.setState({ processingStatus: "unrelated render" })
      if (outcome === "failure") f.tabRequests[0].reject(new Error("owned tab refusal")); else f.tabRequests[0].resolve({ id: 1 })
      await navigationTurn()
      assert.equal(f.state().settingsOpen, outcome !== "success" && outcome !== "ordinaryRender")
      if (outcome === "beforePassiveTask" || outcome === "beforePassiveSecurity" || outcome === "beforePassiveSettingsABA") {
        assert.ok(f.pendingEffects() > 0, "late tab settled before any deferred passive effects")
        f.flushEffects()
      }
      if (outcome === "failure") assert.match(f.toasts.at(-1)!, /无法打开工作中心/)
    } finally { f.close() }
  }
})

test("#756 actual settings rule navigation awaits guarded host and refuses superseded or unavailable destinations", async () => {
  for (const target of ["meeting", "packs"] as const) for (const allowed of [false, true]) {
    const f = settingsNavigationHarness()
    try {
      const pending = f.deferred(); f.host().registerBeforeClose(() => pending.promise)
      const props = f.assistant(); let ui = f.renderBar(props)
      f.find(ui, n => n.type === "input" && n.props.type === "text").props.onChange({ target: { value: target === "meeting" ? "打开会议" : "打开场景" } })
      ui = f.renderBar(props); f.find(ui, n => n.type === "button" && navigationText(n).startsWith("规则导航")).props.onClick()
      assert.equal(f.state().settingsOpen, true); assert.equal(f.host().activePanel, null)
      // Await the real component state receipt, not only its nested host promise.
      const messageUpdated = f.nextBarMessage()
      pending.resolve(allowed); await f.intentResults.at(-1); await messageUpdated; f.renderHost(); ui = f.renderBar(props)
      assert.equal(f.host().activePanel, allowed ? target : null); assert.equal(f.state().settingsOpen, !allowed)
      if (!allowed) assert.match(navigationText(ui), /面板尚未打开/)
    } finally { f.close() }
  }
  const immediate = settingsNavigationHarness()
  try {
    assert.equal(await immediate.assistant().onIntent({ type: "open_meeting" }, () => true), "已打开会议工作台")
    immediate.renderHost(); assert.equal(immediate.host().activePanel, "meeting"); assert.equal(immediate.state().settingsOpen, false)
  } finally { immediate.close() }
  const refused = settingsNavigationHarness()
  try {
    refused.host().registerBeforeClose(() => Promise.reject(new Error("owned finish failure")))
    assert.match(await refused.assistant().onIntent({ type: "open_packs" }, () => true), /尚未打开/)
    assert.equal(refused.state().settingsOpen, true)
  } finally { refused.close() }
  const f = settingsNavigationHarness()
  try {
    const pending = f.deferred(); f.host().registerBeforeClose(() => pending.promise)
    const props = f.assistant(), original = props.onIntent({ type: "open_meeting" }, () => true)
    const newer = f.host().openPanelForce("packs"); pending.resolve(true)
    assert.match(await original, /尚未打开/); assert.equal(await newer, true); f.renderHost()
    assert.equal(f.host().activePanel, "packs"); assert.equal(f.state().settingsOpen, true)
  } finally { f.close() }
  for (const change of ["thread", "batchedABA"] as const) {
    const changed = settingsNavigationHarness()
    try {
      changed.selectThread("owner-a")
      const pending = changed.deferred(); changed.host().registerBeforeClose(() => pending.promise)
      const result = changed.assistant().onIntent({ type: "open_meeting" }, () => true)
      if (change === "batchedABA") changed.batchedThreadABA(); else changed.selectThread("changed-owner")
      pending.resolve(true)
      assert.match(await result, /尚未打开/); assert.equal(changed.state().settingsOpen, true)
    } finally { changed.close() }
  }
  const missing = settingsNavigationHarness()
  try { missing.noHost(); assert.match(await missing.assistant().onIntent({ type: "open_meeting" }, () => true), /此处无法打开/); assert.equal(missing.state().settingsOpen, true) } finally { missing.close() }
})

test("#756 actual settings navigation generation cancels late host result before it can close reopened settings", async () => {
  const f = settingsNavigationHarness()
  try {
    const pending = f.deferred(); f.host().registerBeforeClose(() => pending.promise)
    const props = f.assistant(); let ui = f.renderBar(props)
    f.find(ui, n => n.type === "input" && n.props.type === "text").props.onChange({ target: { value: "打开会议" } })
    ui = f.renderBar(props); f.find(ui, n => n.type === "button" && navigationText(n).startsWith("规则导航")).props.onClick()
    f.renderBar({ ...props, active: false }); f.renderBar({ ...props, active: true })
    const actions = f.actions.length; pending.resolve(true); await f.intentResults.at(-1); ui = f.renderBar({ ...props, active: true })
    assert.equal(f.state().settingsOpen, true); assert.equal(f.actions.slice(actions).some(a => a.type === "SET_SETTINGS_OPEN" && !a.open), false)
    assert.doesNotMatch(navigationText(ui), /已打开会议工作台/)
  } finally { f.close() }
})
