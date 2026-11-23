/**
 * #806 immediate security and coding-handoff writes.
 * Runs the real SettingsSlideout callbacks and the real CodingHandoffSettingsSection.
 * Unrelated settings leaves stay unmounted. No new wire type is introduced.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { codingHandoffCopy } from "../src/sidepanel/coding-handoff/copy"

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
  const actions: any[] = []
  const messages: any[] = []
  const messageCallbacks: Array<((response?: any) => void) | undefined> = []
  let lastError: { message: string } | undefined
  let uuidCount = 0
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
    useId: () => { const owned = frame!, index = cursor++; if (!(index in owned.cells)) owned.cells[index] = `receipt-${index}`; return owned.cells[index] },
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
    get lastError() { return lastError },
    getURL: (value: string) => "chrome-extension://owned/" + value,
    sendMessage: (message: any, callback?: (response?: any) => void) => {
      messages.push(message)
      messageCallbacks.push(typeof callback === "function" ? callback : undefined)
      return Promise.resolve(undefined)
    },
    onMessage: { addListener() {}, removeListener() {} },
  }, tabs: { create: () => Promise.resolve({}), query() { assert.fail("unrelated tab query") } } }
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
  const dispatch = (action: any) => { actions.push(action); state = store.agentReducer(state, action) }
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
      exports: output, require: loadDependency, chrome: chromeValue, window: { setTimeout: () => 1, clearTimeout() {}, location: { pathname: "/sidepanel.html", search: "" }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
      document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} },
      CustomEvent: class { type: string; detail: any; constructor(type: string, options?: any) { this.type = type; this.detail = options?.detail } },
      URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, crypto: { randomUUID: () => { uuidCount += 1; return uuidCount === 1 ? "owned-uuid" : `owned-uuid-${uuidCount}` } },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, console,
    }, { timeout: 5000, filename })
    return output
  }
  store = load(at("store/agentStore.tsx"))
  state = { ...store.initialState, settingsOpen: true }
  const slideout = load(at("components/SettingsSlideout.tsx"))
  const handoff = load(at("components/CodingHandoffSettingsSection.tsx"))
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  function render(key: string, fn: any, props: any = {}) {
    if (!slots.has(key)) slots.set(key, { cells: [], effects: [] })
    frame = slots.get(key); cursor = 0; effectCursor = 0
    const ui = fn(props)
    frame = undefined
    flushEffects()
    return ui
  }
  const renderSlideout = () => render("slideout", slideout.SettingsSlideout)
  const find = (ui: any, predicate: (node: any) => boolean, label: string) => {
    const found = rows(ui).filter(predicate)
    assert.equal(found.length, 1, label)
    return found[0]
  }
  function openAdvanced(ui: any) {
    // A real effect already expands this section when a flag is on. Toggle only when it is closed.
    const current = textOf(ui).includes("自动批准所有危险操作") ? ui : renderSlideout()
    if (textOf(current).includes("自动批准所有危险操作")) return current
    find(current, node => node.type === "button" && textOf(node).includes("高级 · 独立闸门"), "advanced gates").props.onClick()
    return renderSlideout()
  }
  function checkbox(ui: any, label: string) {
    const labelNode = find(ui, node => node.type === "label" && textOf(node).includes(label), label)
    return find(labelNode, node => node.type === "input" && node.props.type === "checkbox", `${label} checkbox`)
  }
  function handoffUi(ui = renderSlideout()) {
    const element = find(ui, node => node.type === handoff.CodingHandoffSettingsSection, "coding handoff section")
    return render("handoff", element.type, element.props)
  }
  return {
    dispatch, messages, messageCallbacks, actions,
    state: () => state,
    renderSlideout, openAdvanced, checkbox, handoffUi, textOf, rows, find,
    setLastError(error?: { message: string }) { lastError = error },
    configSetIndex() {
      for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index]?.type === "config.set") return index
      return -1
    },
    replyLast(response?: any) {
      const index = this.configSetIndex()
      assert.ok(index >= 0, "config.set was sent")
      const callback = messageCallbacks[index]
      assert.equal(typeof callback, "function", "config.set registered a receipt callback")
      callback!(response)
    },
    configSets() { return messages.filter(message => message?.type === "config.set") },
    reduceIsolated(base: any, action: any) { return store.agentReducer(base, action) },
    errorSocket() {
      const effects: Array<() => void> = []
      const refs: any[] = []
      let cursor = 0
      let listener: ((message: any) => void) | undefined
      const react = {
        useRef(value: any) { const owned = refs[cursor] || { current: value }; refs[cursor] = owned; cursor += 1; return owned },
        useEffect(effect: () => void) { effects.push(effect) },
      }
      const chrome = { runtime: { lastError: null, onMessage: { addListener(fn: any) { listener = fn }, removeListener() {} }, sendMessage() {}, connect: () => ({ disconnect() {} }) }, storage: { local: { get() {}, remove() {} } } }
      const output: any = {}
      const code = ts.transpileModule(fs.readFileSync(at("hooks/useWebSocket.ts"), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText
      vm.runInNewContext(code, {
        exports: output, console,
        require: (id: string) => {
          if (id === "react") return react
          if (id === "../store/agentStore") return { useAgentStore: () => ({ state, dispatch }), overlayStandbyFromError: () => null }
          if (id === "../utils/settings-draft") return load(at("utils/settings-draft.ts"))
          if (id === "../coding-handoff/workspace-hints") return load(at("coding-handoff/workspace-hints.ts"))
          const Stub = function Stub() {}
          const fn: any = new Proxy(Stub, { get: () => fn, apply: () => undefined })
          return new Proxy({}, { get: () => fn })
        },
        chrome, document: { addEventListener() {}, removeEventListener() {} },
        window: { dispatchEvent: () => true }, setInterval: () => 1, clearInterval() {},
      }, { timeout: 5000, filename: "useWebSocket.ts" })
      cursor = 0
      output.useWebSocket()
      for (const effect of effects) effect()
      assert.equal(typeof listener, "function", "settings error listener")
      return { send: (message: any) => listener!(message) }
    },
    designedAudit(message: string) {
      const armed = { status: "accepted" as "accepted" | "confirmed" }
      function Probe() {
        const revision = state.configRevision
        const flag = state.config.auto_approve_dangerous
        const once = react.useRef(false)
        react.useEffect(() => {
          if (once.current || armed.status !== "accepted") return
          if (revision !== "epoch:2" || flag !== false) return
          once.current = true
          armed.status = "confirmed"
          dispatch({
            type: "ADD_SECURITY_AUDIT",
            entry: {
              id: "designed", ts: "t", level: "info", tool_name: "auto_approve_dangerous", action: "changed",
              risk_level: "low", risk_score: 0, source: "ui_phrase_confirmed", message,
            },
          })
        }, [revision, flag])
        return null
      }
      return { status: () => armed.status, render: () => render("designed-audit", Probe) }
    },
    flushProbe() {
      let writes = 0
      function Probe(props: { token: number }) {
        react.useEffect(() => { if (props.token > 0) writes += 1 }, [props.token])
        return null
      }
      render("timing-probe", Probe, { token: 0 })
      const before = writes
      render("timing-probe", Probe, { token: 1 })
      const after = writes
      render("timing-probe", Probe, { token: 1 })
      return { before, after, repeat: writes }
    },
    receiptGaps(revision = "epoch:1") {
      const gaps: string[] = []
      const index = this.configSetIndex()
      if (index < 0) gaps.push("config.set missing")
      else {
        const sent = messages[index]
        if (typeof sent.id !== "string" || !/^settings-save:[A-Za-z0-9_-]+$/.test(sent.id)) gaps.push(`id=${String(sent.id)}`)
        if (sent.config_revision !== revision) gaps.push(`config_revision=${String(sent.config_revision)}`)
        if (typeof messageCallbacks[index] !== "function") gaps.push("config.set has no receipt callback")
      }
      return gaps
    },
  }
}

function confirmPhrase(ui: ReturnType<typeof harness>, buttonText: string) {
  let view = ui.renderSlideout()
  const hosts = ui.rows(view).filter((node: any) => textOf(node).includes(buttonText) && ui.rows(node).some((child: any) => child.type === "input" && child.props?.placeholder))
  const host = hosts.sort((left: any, right: any) => textOf(left).length - textOf(right).length)[0]
  assert.ok(host, buttonText)
  const input = ui.rows(host).find((node: any) => node.type === "input" && node.props.placeholder)
  input.props.onChange({ target: { value: input.props.placeholder } })
  view = ui.renderSlideout()
  ui.find(view, node => node.type === "button" && textOf(node) === buttonText, buttonText).props.onClick()
}

function ready(ui: ReturnType<typeof harness>, patch: Record<string, unknown>, revision = "epoch:1") {
  ui.dispatch({ type: "SET_CONNECTION", state: "connected" })
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, ...patch }, revision })
  ui.dispatch({ type: "SET_CONFIG_HYDRATED", hydrated: true })
  return ui.renderSlideout()
}

test("output limit control keeps an explicit draft value when a bad number edit reads as empty", () => {
  const ui = harness()
  const field = (view: any) => ui.find(view,
    node => node.type === "input" && node.props.id === "chat-output-limit", "chat output limit")
  const input = field(ready(ui, { max_tokens: 64000 }))
  assert.equal(input.props.value, 64000)
  const invalid = { value: "", valueAsNumber: NaN, validity: { badInput: true } }
  input.props.onChange({ target: invalid, currentTarget: invalid })
  assert.equal(field(ui.renderSlideout()).props.value, 64000)

  const cleared = { value: "", valueAsNumber: NaN, validity: { badInput: false } }
  input.props.onChange({ target: cleared, currentTarget: cleared })
  assert.equal(ui.state().settingsDraft?.value.max_tokens, 0)
  assert.equal(field(ui.renderSlideout()).props.value, "")
})

test("wrong arming phrase does not send protocol unlock or write a local audit", () => {
  const ui = harness()
  let view = ui.openAdvanced(ready(ui, { allow_all_schemes: false }))
  ui.checkbox(view, "协议解锁（会放行").props.onChange({ target: { checked: true } })
  view = ui.renderSlideout()
  const phraseInput = ui.rows(view).filter((node: any) => node.type === "input" && typeof node.props.placeholder === "string")
    .find((node: any) => ui.rows(view).some((button: any) => button.type === "button" && textOf(button) === "确认开启" && textOf(node).length === 0))
  assert.ok(phraseInput, "phrase field")
  const phrase = phraseInput.props.placeholder
  phraseInput.props.onChange({ target: { value: phrase + "不对" } })
  view = ui.renderSlideout()
  ui.find(view, node => node.type === "button" && textOf(node) === "确认开启", "confirm arm").props.onClick()
  assert.equal(ui.configSets().some(message => message.config?.allow_all_schemes === true), false)
  assert.equal(ui.state().securityAuditLog.length, 0)
  assert.equal(ui.checkbox(ui.renderSlideout(), "协议解锁（会放行").props.checked, false)
})

test("ordinary save stays open when transport accepts the message and no snapshot arrives", () => {
  const ui = harness()
  ready(ui, { model_name: "old" })
  ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
  const save = ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save")
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  ui.replyLast({ ok: true })
  assert.equal(ui.state().settingsOpen, true)
  assert.equal(ui.state().settingsSave.status, "pending")
  assert.equal(ui.state().config.model_name, "old")
  assert.equal(ui.configSets().at(-1).id, "settings-save:owned-uuid")
  assert.equal(ui.configSets().at(-1).config_revision, "epoch:1")
})

test("an older snapshot does not restore a flag replaced by a newer snapshot", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true })
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, auto_approve_dangerous: false }, revision: "epoch:3" })
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, auto_approve_dangerous: true }, revision: "epoch:2" })
  const view = ui.openAdvanced(ui.renderSlideout())
  assert.equal(ui.checkbox(view, "自动批准所有危险操作").props.checked, false)
  assert.equal(ui.state().configRevision, "epoch:3")
})

function configSetCallback(ui: ReturnType<typeof harness>) {
  const index = ui.configSetIndex()
  return index >= 0 ? ui.messageCallbacks[index] : undefined
}

/** Invoke the real config.set callback. A missing callback is a recorded failure, not a skip. */
function deliverConfigSet(ui: ReturnType<typeof harness>, response: any, outcome: "accepted" | "unknown", auditBaseline = 0) {
  const gaps = ui.receiptGaps()
  const callback = configSetCallback(ui)
  if (typeof callback !== "function") gaps.push("did not invoke config.set callback")
  else callback(response)
  if (!ui.state().settingsOpen) gaps.push("settings closed")
  if (ui.state().settingsSave.status === "saved" || ui.state().settingsSave.status === "unknown") gaps.push(`settingsSave.status=${ui.state().settingsSave.status}`)
  if (ui.state().immediateSave?.status !== outcome) gaps.push(`immediateSave=${String(ui.state().immediateSave?.status)}`)
  if (ui.state().securityAuditLog.length !== auditBaseline) gaps.push(`audit=${ui.state().securityAuditLog.length}`)
  return gaps
}

function rejectedReceipt(ui: ReturnType<typeof harness>, mode: "ok-false" | "last-error") {
  if (mode === "last-error") ui.setLastError({ message: "Could not establish connection. Receiving end does not exist." })
  return deliverConfigSet(ui, mode === "ok-false"
    ? { ok: false, error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接" }
    : undefined, "unknown")
}

function acceptedReceipt(ui: ReturnType<typeof harness>, auditBaseline = 0) {
  return deliverConfigSet(ui, { ok: true }, "accepted", auditBaseline)
}

/** Count audit only after the slide-out renders and flushes effects. Reducer dispatch alone must not be treated as confirmation. */
function confirmAudited(ui: ReturnType<typeof harness>, patch: Record<string, unknown>, message: RegExp) {
  const gaps: string[] = []
  if (ui.state().securityAuditLog.length !== 0) gaps.push(`audit before confirm=${ui.state().securityAuditLog.length}`)
  const id = ui.configSets().at(-1)?.id
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, ...patch }, revision: "epoch:2", id })
  if (ui.state().securityAuditLog.length !== 0) gaps.push(`audit before effect flush=${ui.state().securityAuditLog.length}`)
  ui.renderSlideout()
  const log = ui.state().securityAuditLog
  if (log.length !== 1) gaps.push(`audit after render=${log.length}`)
  else if (!message.test(String(log[0]?.message ?? ""))) gaps.push(`audit message=${String(log[0]?.message)}`)
  if (!ui.state().settingsOpen) gaps.push("settings closed after confirm")
  if (ui.state().settingsSave.status === "saved" || ui.state().settingsSave.status === "unknown") gaps.push(`settingsSave.status=${ui.state().settingsSave.status}`)
  if (ui.state().immediateSave?.status !== "confirmed") gaps.push(`immediateSave=${String(ui.state().immediateSave?.status)}`)
  ui.renderSlideout()
  if (ui.state().securityAuditLog.length !== 1) gaps.push(`audit after repeat=${ui.state().securityAuditLog.length}`)
  return gaps
}

test("transport refusal does not show dangerous auto-approve as off or record success", () => {
  const ui = harness()
  const before = ui.state().securityAuditLog.length
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = rejectedReceipt(ui, "ok-false")
  const again = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(again, "自动批准所有危险操作").props.checked !== true) gaps.push("checkbox left the snapshot")
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("state.config left the snapshot")
  if (ui.state().securityAuditLog.length !== before) gaps.push("audit changed")
  if (!textOf(ui.renderSlideout()).includes("Companion 未连接")) gaps.push("error hidden")
  assert.deepEqual(gaps, [])
})

test("channel lastError does not commit dangerous auto-approve and marks the save unknown", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = rejectedReceipt(ui, "last-error")
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("state.config left the snapshot")
  if (ui.state().securityAuditLog.length !== 0) gaps.push("audit changed")
  if (!textOf(ui.renderSlideout()).includes("Could not establish connection")) gaps.push("error hidden")
  assert.deepEqual(gaps, [])
})

test("transport ok without a snapshot does not commit dangerous auto-approve", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  const again = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(again, "自动批准所有危险操作").props.checked !== true) gaps.push("checkbox left the snapshot")
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("state.config left the snapshot")
  assert.deepEqual(gaps, [])
})

test("accepted transport does not turn enterprise tools off before a snapshot", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_enterprise_tools: true }))
  ui.checkbox(view, "全局自动批准企业高危工具").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  const again = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(again, "全局自动批准企业高危工具").props.checked !== true) gaps.push("checkbox left the snapshot")
  if (ui.state().config.auto_approve_enterprise_tools !== true) gaps.push("state.config left the snapshot")
  assert.deepEqual(gaps, [])
})

test("protocol unlock audit is written only after a newer confirming snapshot", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { allow_all_schemes: true }))
  ui.checkbox(view, "协议解锁（会放行").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  const again = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(again, "协议解锁（会放行").props.checked !== true) gaps.push("checkbox left the snapshot")
  if (ui.state().config.allow_all_schemes !== true) gaps.push("state.config left the snapshot")
  gaps.push(...confirmAudited(ui, { allow_all_schemes: false }, /已关闭协议解锁/))
  const confirmed = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(confirmed, "协议解锁（会放行").props.checked !== false) gaps.push("confirmed checkbox stayed on")
  assert.deepEqual(gaps, [])
})

test("transport ok does not turn coding suggestions off before a snapshot", () => {
  const ui = harness()
  ready(ui, { coding_handoff: { auto_suggest: true, open_local_terminal: false, local_terminal_app: "auto" } })
  const section = ui.handoffUi()
  ui.checkbox(section, codingHandoffCopy.settingsAutoSuggest).props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  if (ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsAutoSuggest).props.checked !== true) gaps.push("checkbox left the snapshot")
  if (ui.state().config.coding_handoff.auto_suggest !== true) gaps.push("state.config left the snapshot")
  assert.deepEqual(gaps, [])
})

test("a refused embedded-terminal toggle does not show the terminal as enabled", () => {
  const ui = harness()
  ready(ui, { embedded_terminal: { enabled: false } })
  const section = ui.handoffUi()
  ui.checkbox(section, codingHandoffCopy.settingsEmbeddedTerminal).props.onChange({ target: { checked: true } })
  const gaps = rejectedReceipt(ui, "last-error")
  if (ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsEmbeddedTerminal).props.checked !== false) gaps.push("checkbox left the snapshot")
  if (ui.state().config.embedded_terminal?.enabled !== false) gaps.push("state.config left the snapshot")
  assert.deepEqual(gaps, [])
})

test("accepted transport does not arm dangerous auto-approve or enterprise tools before a snapshot", () => {
  const failures: string[] = []
  for (const label of ["自动批准所有危险操作", "全局自动批准企业高危工具"]) {
    const local = harness()
    const view = local.openAdvanced(ready(local, { auto_approve_dangerous: false, auto_approve_enterprise_tools: false }))
    local.checkbox(view, label).props.onChange({ target: { checked: true } })
    confirmPhrase(local, "确认开启")
    const gaps = acceptedReceipt(local)
    const again = local.openAdvanced(local.renderSlideout())
    if (local.checkbox(again, label).props.checked !== false) gaps.push(`${label} checkbox left the snapshot`)
    if (local.state().config.auto_approve_dangerous !== false || local.state().config.auto_approve_enterprise_tools !== false) gaps.push(`${label} state.config left the snapshot`)
    if (local.state().securityAuditLog.length !== 0) gaps.push(`${label} audit before snapshot`)
    if (gaps.length) failures.push(`${label}: ${gaps.join("; ")}`)
  }
  assert.deepEqual(failures, [])
})

test("accepted transport does not arm protocol unlock or write its audit before a snapshot", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { allow_all_schemes: false }))
  ui.checkbox(view, "协议解锁（会放行").props.onChange({ target: { checked: true } })
  confirmPhrase(ui, "确认开启")
  const gaps = acceptedReceipt(ui)
  const again = ui.openAdvanced(ui.renderSlideout())
  if (ui.checkbox(again, "协议解锁（会放行").props.checked !== false) gaps.push("checkbox left the snapshot")
  if (ui.state().config.allow_all_schemes !== false) gaps.push("state.config left the snapshot")
  gaps.push(...confirmAudited(ui, { allow_all_schemes: true }, /已启用协议解锁/))
  assert.deepEqual(gaps, [])
})

test("accepted transport does not open the local terminal or change its app before a snapshot", () => {
  const ui = harness()
  ready(ui, { coding_handoff: { auto_suggest: true, open_local_terminal: false, local_terminal_app: "auto" } })
  let section = ui.handoffUi()
  ui.checkbox(section, codingHandoffCopy.settingsOpenLocalTerminal).props.onChange({ target: { checked: true } })
  const gaps = acceptedReceipt(ui)
  if (ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsOpenLocalTerminal).props.checked !== false) gaps.push("checkbox left the snapshot")
  if (ui.state().config.coding_handoff.open_local_terminal !== false) gaps.push("open_local_terminal left the snapshot")
  assert.deepEqual(gaps, [])
})

test("accepted transport does not change the local terminal app before a snapshot", () => {
  const ui = harness()
  ready(ui, { coding_handoff: { auto_suggest: true, open_local_terminal: true, local_terminal_app: "auto" } })
  const section = ui.handoffUi()
  const select = ui.rows(section).filter((node: any) => node.type === "select" && node.props["aria-label"] !== "编程接力并发上限")
    .find((node: any) => ui.rows(node).some((option: any) => option.props?.value === "Terminal"))
  assert.ok(select, "local terminal app select")
  select.props.onChange({ target: { value: "Terminal" } })
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.coding_handoff.local_terminal_app !== "auto") gaps.push("local_terminal_app left the snapshot")
  if (ui.rows(ui.handoffUi()).some((node: any) => node.type === "select" && node.props.value === "Terminal")) gaps.push("terminal app select left the snapshot")
  assert.deepEqual(gaps, [])
})

test("accepted transport does not enable ACP before a snapshot", () => {
  const ui = harness()
  ready(ui, { acp: { enabled: false, max_concurrent_sessions: 1 } })
  ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsAcpEnabled).props.onChange({ target: { checked: true } })
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.acp.enabled !== false) gaps.push("state.config.acp.enabled left the snapshot")
  if (ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsAcpEnabled).props.checked !== false) gaps.push("checkbox left the snapshot")
  assert.deepEqual(gaps, [])
})

test("arming cruise writes no audit and keeps flags until a newer snapshot", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false })
  ui.find(ui.renderSlideout(), node => node.type === "button" && textOf(node) === "武装…", "arm cruise").props.onClick()
  confirmPhrase(ui, "确认武装")
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.auto_approve_dangerous !== false) gaps.push("dangerous flag left the snapshot")
  gaps.push(...confirmAudited(ui, { auto_approve_dangerous: true }, /武装运行自主度/))
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...ui.state().config, auto_approve_dangerous: false },
    revision: "epoch:1",
    id: ui.configSets().at(-1)?.id,
  })
  ui.renderSlideout()
  if (ui.state().configRevision !== "epoch:2") gaps.push("older snapshot overwrote the newer revision")
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("older snapshot restored the flag")
  if (ui.state().securityAuditLog.length !== 1) gaps.push(`audit after late snapshot=${ui.state().securityAuditLog.length}`)
  if (!ui.state().settingsOpen) gaps.push("settings closed by late snapshot")
  if (ui.state().settingsSave.status === "saved" || ui.state().settingsSave.status === "unknown") gaps.push(`late settingsSave.status=${ui.state().settingsSave.status}`)
  assert.deepEqual(gaps, [])
})

test("disarming cruise after the channel accepts still waits for a snapshot before audit", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true, auto_approve_enterprise_tools: false, allow_all_schemes: false })
  ui.find(ui.renderSlideout(), node => node.type === "button" && textOf(node) === "解除武装", "disarm cruise").props.onClick()
  let disarmIndex = -1
  for (let index = ui.messages.length - 1; index >= 0; index -= 1) if (ui.messages[index]?.type === "security.unattended.disarm") { disarmIndex = index; break }
  assert.equal(typeof ui.messageCallbacks[disarmIndex], "function", "disarm registered a channel callback")
  ui.messageCallbacks[disarmIndex]!()
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("dangerous flag left the snapshot")
  gaps.push(...confirmAudited(ui, {
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
  }, /解除运行自主度/))
  assert.deepEqual(gaps, [])
})

test("a late concurrency callback does not replace a newer snapshot", () => {
  const ui = harness()
  ready(ui, { acp: { enabled: false, max_concurrent_sessions: 1 } })
  const section = ui.handoffUi()
  const select = ui.find(section, node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency")
  assert.equal(String(select.props.value), "1")
  select.props.onChange({ target: { value: "2" } })
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, acp: { enabled: false, max_concurrent_sessions: 3 } }, revision: "epoch:2" })
  ui.replyLast({ type: "config.updated", config: { acp: { max_concurrent_sessions: 2 } } })
  const again = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency after late reply")
  assert.equal(String(again.props.value), "3")
  assert.equal(ui.state().config.acp.max_concurrent_sessions, 3)
})

test("concurrency config.set carries the existing save id and revision", () => {
  const ui = harness()
  ready(ui, { acp: { enabled: false, max_concurrent_sessions: 1 } })
  const select = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency")
  select.props.onChange({ target: { value: "2" } })
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.acp.max_concurrent_sessions !== 1) gaps.push("limit left the snapshot")
  assert.deepEqual(gaps, [])
})

test("receipt checker flags config and audit writes performed inside callback ok", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true })
  ui.messages.push({ type: "config.set", id: "settings-save:probe", config_revision: "epoch:1", config: { auto_approve_dangerous: false } })
  ui.messageCallbacks.push(() => {
    ui.dispatch({ type: "SET_CONFIG", config: { auto_approve_dangerous: false } })
    ui.dispatch({ type: "ADD_SECURITY_AUDIT", entry: {
      id: "probe", ts: "t", level: "info", tool_name: "probe", action: "changed",
      risk_level: "low", risk_score: 0, source: "ui_phrase_confirmed", message: "probe",
    } })
  })
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("state.config left the snapshot")
  assert.ok(gaps.includes("state.config left the snapshot"))
  assert.ok(gaps.some(gap => gap.startsWith("audit=")))
  assert.equal(gaps.includes("did not invoke config.set callback"), false)
})

test("a matched main-save snapshot with no draft is unknown", () => {
  const ui = harness()
  const base = {
    ...ui.state(),
    connectionState: "connected",
    configHydratedFromCompanion: true,
    configRevision: "epoch:1",
    settingsOpen: true,
    settingsDraft: null,
    settingsSave: {
      status: "pending",
      pending: { id: "settings-save:probe", revision: "epoch:1", patch: { auto_approve_dangerous: false }, generations: { auto_approve_dangerous: 1 } },
    },
  }
  const next = ui.reduceIsolated(base, {
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...base.config, auto_approve_dangerous: false },
    revision: "epoch:2",
    id: "settings-save:probe",
  })
  assert.equal(next.settingsSave.status, "unknown")
  assert.equal(next.settingsOpen, true)
})

test("a clean draft leaves Save disabled and settings open", () => {
  const ui = harness()
  ready(ui, { model_name: "old" })
  assert.equal(Object.keys(ui.state().settingsDraft.dirty).length, 0)
  const save = ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save")
  assert.equal(save.props.disabled, true)
  save.props.onClick()
  assert.equal(ui.state().settingsSave.status, "idle")
  assert.equal(ui.state().settingsOpen, true)
})

test("designed immediate confirmation records one audit after effect flush", () => {
  for (const draft of ["clean", "dirty", "none"] as const) {
    const ui = harness()
    ready(ui, { auto_approve_dangerous: true, model_name: "old" })
    if (draft === "dirty") ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
    if (draft === "none") ui.dispatch({ type: "END_SETTINGS_DRAFT" })
    const probe = ui.designedAudit("已关闭协议解锁（恢复协议保护）")
    const gaps: string[] = []
    if (ui.state().securityAuditLog.length !== 0) gaps.push("audit before confirm")
    ui.dispatch({
      type: "SET_CONFIG_SNAPSHOT",
      config: { ...ui.state().config, auto_approve_dangerous: false, model_name: "old" },
      revision: "epoch:2",
      id: "settings-save:designed",
    })
    if (ui.state().securityAuditLog.length !== 0) gaps.push("audit before effect flush")
    if (ui.state().settingsSave.status === "unknown" || ui.state().settingsSave.status === "saved") gaps.push(`settingsSave=${ui.state().settingsSave.status}`)
    probe.render()
    if (ui.state().securityAuditLog.length !== 1) gaps.push(`audit=${ui.state().securityAuditLog.length}`)
    else if (!/已关闭协议解锁/.test(String(ui.state().securityAuditLog[0]?.message ?? ""))) gaps.push("message")
    if (probe.status() !== "confirmed") gaps.push(probe.status())
    probe.render()
    if (ui.state().securityAuditLog.length !== 1) gaps.push("repeat")
    ui.renderSlideout()
    if (!ui.state().settingsOpen) gaps.push("closed")
    if (draft === "dirty" && ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost")
    if (draft === "none" && ui.state().settingsSave.status === "unknown") gaps.push("unknown")
    ui.dispatch({
      type: "SET_CONFIG_SNAPSHOT",
      config: { ...ui.state().config, auto_approve_dangerous: true },
      revision: "epoch:1",
      id: "settings-save:designed",
    })
    probe.render()
    ui.renderSlideout()
    if (ui.state().config.auto_approve_dangerous !== false) gaps.push("rolled back")
    if (ui.state().securityAuditLog.length !== 1) gaps.push("late audit")
    if (!ui.state().settingsOpen) gaps.push("late close")
    assert.deepEqual(gaps, [], draft)
  }
})

test("audit written at snapshot dispatch is not an effect confirmation", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true })
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...ui.state().config, auto_approve_dangerous: false },
    revision: "epoch:2",
    id: "settings-save:sync",
  })
  ui.dispatch({
    type: "ADD_SECURITY_AUDIT",
    entry: {
      id: "sync", ts: "t", level: "info", tool_name: "allow_all_schemes", action: "changed",
      risk_level: "low", risk_score: 0, source: "ui_phrase_confirmed", message: "已关闭协议解锁",
    },
  })
  const gaps: string[] = []
  if (ui.state().securityAuditLog.length !== 0) gaps.push(`audit before effect flush=${ui.state().securityAuditLog.length}`)
  ui.renderSlideout()
  assert.deepEqual(gaps, ["audit before effect flush=1"])
  assert.equal(ui.state().securityAuditLog.length, 1)
})

test("effect flush records one confirmation only after render", () => {
  const timing = harness().flushProbe()
  assert.equal(timing.before, 0)
  assert.equal(timing.after, 1)
  assert.equal(timing.repeat, 1)
})

test("a confirmed main save keeps settings open for another save", () => {
  const ui = harness()
  ready(ui, { model_name: "old" })
  ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "kept" } })
  ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save").props.onClick()
  assert.equal(ui.state().settingsSave.status, "pending")
  assert.equal(ui.state().settingsOpen, true)
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...ui.state().config, model_name: "kept" },
    revision: "epoch:2",
    id: "settings-save:owned-uuid",
    appliedRevision: "epoch:2",
  })
  assert.equal(ui.state().settingsSave.status, "saved")
  assert.equal(ui.state().settingsOpen, true)
  assert.equal(Object.keys(ui.state().settingsDraft.dirty).length, 0)
  ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "next" } })
  ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save again").props.onClick()
  assert.equal(ui.state().settingsSave.pending?.revision, "epoch:2")
  assert.equal(ui.state().settingsSave.pending?.patch.model_name, "next")
})

test("the model test clears an earlier fallback error and submits one sequential probe", () => {
  const ui = harness()
  ready(ui, { vision_enabled: true })
  const socket = ui.errorSocket()
  socket.send({ type: "config.testResult", ok: true, native_vision: false, vision_fallback: { ok: false, error: "旧结果" } })
  assert.match(ui.state().testVisionResult, /旧结果/)

  ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.children === "测试模型连接", "model test").props.onClick()
  const requests = ui.messages.filter(message => message.type === "config.test" || message.type === "config.testVision")
  assert.equal(requests.length, 1)
  assert.equal(requests[0].type, "config.test")
  assert.equal(requests[0].testVisionFallback, true)
  assert.equal(ui.state().testVisionResult, null)

  socket.send({ type: "config.testResult", ok: true, native_vision: true })
  assert.match(ui.state().testResult, /主模型端点接受图片输入/)
  assert.equal(ui.state().testVisionResult, null)
})

test("immediate confirmation keeps drafts open and does not borrow the main save result", () => {
  const failures: string[] = []
  for (const mode of ["dirty", "clean", "none"] as const) {
    const ui = harness()
    const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true, model_name: "old" }))
    if (mode === "dirty") ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
    if (mode === "none") ui.dispatch({ type: "END_SETTINGS_DRAFT" })
    ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
    const gaps = acceptedReceipt(ui)
    ui.dispatch({
      type: "SET_CONFIG_SNAPSHOT",
      config: { ...ui.state().config, auto_approve_dangerous: false, model_name: "old" },
      revision: "epoch:2",
      id: ui.configSets().at(-1)?.id,
    })
    if (ui.state().securityAuditLog.length !== 0) gaps.push(`audit before effect flush=${ui.state().securityAuditLog.length}`)
    ui.renderSlideout()
    if (mode === "dirty" && ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost")
    if (!ui.state().settingsOpen) gaps.push("settings closed")
    if (ui.state().settingsSave.status === "saved" || ui.state().settingsSave.status === "unknown") gaps.push(`settingsSave.status=${ui.state().settingsSave.status}`)
    if (ui.state().immediateSave?.status !== "confirmed") gaps.push(`immediateSave=${String(ui.state().immediateSave?.status)}`)
    ui.renderSlideout()
    if (!ui.state().settingsOpen) gaps.push("repeat closed settings")
    if (gaps.length) failures.push(`${mode}: ${gaps.join("; ")}`)
  }
  assert.deepEqual(failures, [])
})

test("accepted transport does not mark full tool history saved before a snapshot", () => {
  const ui = harness()
  ready(ui, { persist_full_tool_history: false })
  const hosts = ui.rows(ui.renderSlideout()).filter((node: any) => textOf(node).includes("保存完整操作史") && ui.rows(node).some((child: any) => child.type === "button"))
  const host = hosts.sort((left: any, right: any) => textOf(left).length - textOf(right).length)[0]
  assert.ok(host, "full tool history control")
  ui.rows(host).find((node: any) => node.type === "button").props.onClick()
  const gaps = acceptedReceipt(ui)
  if (ui.state().config.persist_full_tool_history) gaps.push("persist flag left the snapshot")
  const shown = ui.rows(ui.renderSlideout()).filter((node: any) => textOf(node).includes("保存完整操作史") && ui.rows(node).some((child: any) => child.type === "button"))
    .sort((left: any, right: any) => textOf(left).length - textOf(right).length)[0]
  if (textOf(ui.rows(shown).find((node: any) => node.type === "button")) !== "默认关闭") gaps.push("history button left the snapshot")
  assert.deepEqual(gaps, [])
})

test("an unrelated snapshot does not confirm an immediate save", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...ui.state().config, auto_approve_dangerous: false },
    revision: "epoch:2",
    id: "settings-save:someone-else",
  })
  ui.renderSlideout()
  if (ui.state().immediateSave?.status !== "accepted") gaps.push(`status=${String(ui.state().immediateSave?.status)}`)
  if (ui.state().securityAuditLog.length !== 0) gaps.push(`audit=${ui.state().securityAuditLog.length}`)
  if (!ui.state().settingsOpen) gaps.push("settings closed")
  assert.deepEqual(gaps, [])
})

test("a second immediate change waits instead of replacing the unanswered request", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true, auto_approve_enterprise_tools: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  const sent = ui.configSets().length
  ui.checkbox(ui.openAdvanced(ui.renderSlideout()), "全局自动批准企业高危工具").props.onChange({ target: { checked: false } })
  if (ui.configSets().length !== sent) gaps.push("second request sent")
  if (ui.state().immediateSave?.status !== "accepted") gaps.push(`status=${String(ui.state().immediateSave?.status)}`)
  if (!textOf(ui.renderSlideout()).includes("上一次设置还在等待确认")) gaps.push("wait notice hidden")
  assert.deepEqual(gaps, [])
})

test("connection loss fails a pending main save and an immediate save without discarding the draft", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true, model_name: "old" })
  ui.dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
  ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save").props.onClick()
  const mainId = ui.state().settingsSave.pending?.id
  assert.equal(ui.state().settingsSave.status, "pending")
  const view = ui.openAdvanced(ui.renderSlideout())
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  const gaps = acceptedReceipt(ui)
  const immediateId = ui.state().immediateSave?.id
  if (!mainId || !immediateId || mainId === immediateId) gaps.push(`ids collided ${String(mainId)} ${String(immediateId)}`)
  ui.dispatch({ type: "SET_CONNECTION", state: "disconnected" })
  if (ui.state().settingsSave.status !== "unknown" || ui.state().settingsSave.pending) gaps.push(`settingsSave=${ui.state().settingsSave.status}`)
  if (ui.state().immediateSave?.status !== "unknown") gaps.push(`immediateSave=${String(ui.state().immediateSave?.status)}`)
  if (ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost")
  if (ui.state().config.auto_approve_dangerous !== true) gaps.push("flag changed")
  if (ui.state().securityAuditLog.length !== 0) gaps.push("audit increased")
  if (!ui.state().settingsOpen) gaps.push("settings closed")
  ui.dispatch({ type: "SET_CONNECTION", state: "connected" })
  if (ui.state().settingsSave.status !== "unknown") gaps.push(`reconnected settingsSave=${ui.state().settingsSave.status}`)
  if (ui.state().immediateSave?.status === "accepted" || ui.state().immediateSave?.status === "confirmed") gaps.push("reconnected immediate looked successful")
  if (ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost on reconnect")
  ui.find(ui.renderSlideout(), node => node.type === "button" && textOf(node) === "我已核对，允许重新保存", "retry").props.onClick()
  if (ui.state().settingsSave.status !== "idle") gaps.push(`after retry=${ui.state().settingsSave.status}`)
  if (ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost on retry")
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT",
    config: { ...ui.state().config, model_name: "old", auto_approve_dangerous: true },
    revision: "epoch:2",
  })
  const save = ui.find(ui.renderSlideout(), node => node.type === "button" && node.props.className === "cm-settings-save", "save again")
  if (save.props.disabled) gaps.push("save stayed disabled")
  save.props.onClick()
  if (ui.state().settingsSave.status !== "pending") gaps.push(`retry save=${ui.state().settingsSave.status}`)
  if (ui.state().settingsDraft?.value.model_name !== "mine") gaps.push("draft lost after retry save")
  if (ui.state().securityAuditLog.length !== 0) gaps.push("audit after retry")
  assert.deepEqual(gaps, [])
})

test("a settings-save error frame marks only the matching immediate save unknown", () => {
  const ui = harness()
  ready(ui, { auto_approve_dangerous: true, model_name: "old" })
  ui.dispatch({ type: "BEGIN_IMMEDIATE_SAVE", id: "settings-save:immediate", revision: "epoch:1", patch: { auto_approve_dangerous: false } })
  ui.dispatch({ type: "IMMEDIATE_SAVE_ACCEPTED", id: "settings-save:immediate" })
  ui.dispatch({ type: "BEGIN_SETTINGS_SAVE", submission: { id: "settings-save:main", revision: "epoch:1", patch: {}, generations: {} } })
  assert.equal(ui.state().settingsSave.status, "pending")
  const socket = ui.errorSocket()
  socket.send({ type: "error", id: "settings-save:immediate", error: "这次设置没有写入" })
  assert.equal(ui.state().immediateSave?.status, "unknown")
  assert.equal(ui.state().immediateSave?.error, "这次设置没有写入")
  assert.equal(ui.state().settingsSave.status, "pending")
  assert.equal(ui.state().settingsSave.pending?.id, "settings-save:main")
  socket.send({ type: "error", id: "settings-save:main", error: "主保存失败" })
  assert.equal(ui.state().settingsSave.status, "unknown")
  assert.equal(ui.state().settingsDraft?.value.model_name, "old")
  assert.equal(ui.state().immediateSave?.status, "unknown")
})

test("concurrency transport ok alone leaves the previous limit in place", () => {
  const ui = harness()
  ready(ui, { acp: { enabled: false, max_concurrent_sessions: 1 } })
  const select = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency")
  select.props.onChange({ target: { value: "4" } })
  ui.replyLast({ ok: true })
  const again = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency unchanged")
  assert.equal(String(again.props.value), "1")
})
