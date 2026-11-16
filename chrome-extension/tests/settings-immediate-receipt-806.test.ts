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
  const messageCallbacks: Array<(response?: any) => void> = []
  let lastError: { message: string } | undefined
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
      if (typeof callback === "function") messageCallbacks.push(callback)
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
      URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, crypto: { randomUUID: () => "owned-uuid" },
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
    replyLast(response?: any) {
      const callback = messageCallbacks.at(-1)
      assert.ok(callback, "the control registered a sendMessage callback")
      callback!(response)
    },
    configSets() { return messages.filter(message => message?.type === "config.set") },
  }
}

function ready(ui: ReturnType<typeof harness>, patch: Record<string, unknown>, revision = "epoch:1") {
  ui.dispatch({ type: "SET_CONNECTION", state: "connected" })
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, ...patch }, revision })
  ui.dispatch({ type: "SET_CONFIG_HYDRATED", hydrated: true })
  return ui.renderSlideout()
}

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

test("disconnect does not show dangerous auto-approve as off or record success", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.setLastError({ message: "Could not establish connection. Receiving end does not exist." })
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  if (ui.messageCallbacks.length) ui.replyLast({ ok: false, error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接" })
  const again = ui.openAdvanced(ui.renderSlideout())
  assert.equal(ui.checkbox(again, "自动批准所有危险操作").props.checked, true)
  assert.equal(ui.state().config.auto_approve_dangerous, true)
  assert.equal(ui.state().securityAuditLog.length, 0)
})

test("transport ok without a snapshot does not commit dangerous auto-approve", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { auto_approve_dangerous: true }))
  ui.checkbox(view, "自动批准所有危险操作").props.onChange({ target: { checked: false } })
  if (ui.messageCallbacks.length) ui.replyLast({ ok: true })
  const again = ui.openAdvanced(ui.renderSlideout())
  assert.equal(ui.checkbox(again, "自动批准所有危险操作").props.checked, true)
  assert.equal(ui.state().config.auto_approve_dangerous, true)
  assert.ok(ui.state().settingsSave.status !== "saved")
})

test("protocol unlock audit is written only after a newer confirming snapshot", () => {
  const ui = harness()
  const view = ui.openAdvanced(ready(ui, { allow_all_schemes: true }))
  ui.checkbox(view, "协议解锁（会放行").props.onChange({ target: { checked: false } })
  assert.equal(ui.state().securityAuditLog.length, 0)
  assert.equal(ui.checkbox(ui.openAdvanced(ui.renderSlideout()), "协议解锁（会放行").props.checked, true)
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, allow_all_schemes: false }, revision: "epoch:2", id: ui.configSets().at(-1)?.id })
  const confirmed = ui.openAdvanced(ui.renderSlideout())
  assert.equal(ui.checkbox(confirmed, "协议解锁（会放行").props.checked, false)
  assert.equal(ui.state().securityAuditLog.length, 1)
  assert.match(ui.state().securityAuditLog[0].message, /已关闭协议解锁/)
  ui.dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...ui.state().config, allow_all_schemes: false }, revision: "epoch:2", id: ui.configSets().at(-1)?.id })
  assert.equal(ui.state().securityAuditLog.length, 1)
})

test("transport ok does not turn coding suggestions off before a snapshot", () => {
  const ui = harness()
  ready(ui, { coding_handoff: { auto_suggest: true, open_local_terminal: false, local_terminal_app: "auto" } })
  const section = ui.handoffUi()
  ui.checkbox(section, codingHandoffCopy.settingsAutoSuggest).props.onChange({ target: { checked: false } })
  if (ui.messageCallbacks.length) ui.replyLast({ ok: true })
  assert.equal(ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsAutoSuggest).props.checked, true)
  assert.equal(ui.state().config.coding_handoff.auto_suggest, true)
})

test("a refused embedded-terminal toggle does not show the terminal as enabled", () => {
  const ui = harness()
  ready(ui, { embedded_terminal: { enabled: false } })
  const section = ui.handoffUi()
  ui.setLastError({ message: "port closed" })
  ui.checkbox(section, codingHandoffCopy.settingsEmbeddedTerminal).props.onChange({ target: { checked: true } })
  if (ui.messageCallbacks.length) ui.replyLast({ ok: false, error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接" })
  assert.equal(ui.checkbox(ui.handoffUi(), codingHandoffCopy.settingsEmbeddedTerminal).props.checked, false)
  assert.equal(ui.state().config.embedded_terminal.enabled, false)
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

test("concurrency transport ok alone leaves the previous limit in place", () => {
  const ui = harness()
  ready(ui, { acp: { enabled: false, max_concurrent_sessions: 1 } })
  const select = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency")
  select.props.onChange({ target: { value: "4" } })
  ui.replyLast({ ok: true })
  const again = ui.find(ui.handoffUi(), node => node.type === "select" && node.props["aria-label"] === "编程接力并发上限", "concurrency unchanged")
  assert.equal(String(again.props.value), "1")
})
