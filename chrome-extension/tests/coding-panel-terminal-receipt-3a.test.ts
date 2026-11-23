/**
 * Phase 3a product cases render CodingAgentPanel. They describe the receipt
 * sequence a later fix can pass. The closed-settings confirmation is a probe:
 * it does not click the panel. The ACP case locks the current list gate and
 * is not a request to add a settings id.
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
  const messages: any[] = []
  const callbacks: Array<((response?: any) => void) | undefined> = []
  let lastError: { message: string } | undefined
  let uuid = 0
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  const effectQueue: Array<() => void> = []
  const flush = () => { while (effectQueue.length) effectQueue.shift()!() }
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
    useId: () => { const owned = frame!, index = cursor++; if (!(index in owned.cells)) owned.cells[index] = `panel-${index}`; return owned.cells[index] },
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || !deps || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps: deps || [], cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
    memo: (component: any) => component,
  }
  const runtime = { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
  const leaves = new Set([
    "ui/Modal", "UserEnvSection", "SiteCounterSettingsSection", "NetSecSettingsSection",
    "CapabilityProfileSection", "OutboundMcpSettingsSection", "HotkeyCaptureField",
    "AutopilotConsequenceMatrix", "KnowledgeSubPanel", "McpPanel", "AppsPanel", "PacksPanel",
    "BoardPanel", "MeetingPanel", "ProjectPanel", "personal-workspace/RecentActivitySources",
  ])
  const chromeValue = { runtime: {
    get lastError() { return lastError },
    getURL: (value: string) => value,
    sendMessage: (message: any, callback?: (response?: any) => void) => {
      messages.push(message)
      callbacks.push(typeof callback === "function" ? callback : undefined)
      return Promise.resolve()
    },
    onMessage: { addListener() {}, removeListener() {} },
  }, tabs: { query() {}, create: () => Promise.resolve({}) }, storage: { local: { get() {}, remove() {} } } }
  const store = load(at("store/agentStore.tsx"))
  let state = store.initialState
  const dispatch = (action: any) => { state = store.agentReducer(state, action) }

  function load(filename: string): any {
    filename = path.resolve(filename)
    if (modules.has(filename)) return modules.get(filename)
    const output: any = {}
    modules.set(filename, output)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    vm.runInNewContext(code, {
      exports: output,
      require: (id: string) => {
        if (id === "react") return react
        if (id === "react/jsx-runtime") return runtime
        if (!id.startsWith(".")) throw new Error(`unexpected nonlocal dependency ${id} from ${path.basename(filename)}`)
        const target = path.resolve(path.dirname(filename), id)
        if (target === at("store/agentStore")) return { ...store, useAgentStore: () => ({ state, dispatch }) }
        if (target === at("components/ContextPanelHost")) return { useContextPanelHostOptional: () => null, useContextPanelHost() { throw new Error("host") } }
        const leaf = [...leaves].find(name => target === at("components/" + name))
        if (leaf) return new Proxy({}, { get: () => function UnmountedLeaf() { return null } })
        const actual = [target + ".ts", target + ".tsx", target + "/index.ts", target + "/index.tsx"].find(file => fs.existsSync(file))
        if (!actual) throw new Error(`missing dependency ${id} from ${path.basename(filename)}`)
        return load(actual)
      },
      chrome: chromeValue,
      window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { pathname: "/sidepanel.html", search: "" } },
      document: { addEventListener() {}, removeEventListener() {}, hidden: false },
      navigator: { userAgent: "node", clipboard: { writeText: async () => {} } },
      crypto: { randomUUID: () => `panel-${++uuid}` },
      setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      console,
    }, { timeout: 5000, filename: path.basename(filename) })
    return output
  }

  function render(name: string, component: any, props?: any) {
    if (!slots.has(name)) slots.set(name, { cells: [], effects: [] })
    frame = slots.get(name)
    cursor = 0
    effectCursor = 0
    const ui = component(props)
    frame = undefined
    flush()
    return ui
  }

  const panelModule = load(at("components/CodingAgentPanel.tsx"))
  const settingsModule = load(at("components/SettingsSlideout.tsx"))
  const props = {
    open: true,
    onClose() {},
    workspaceRoot: "/repo",
    messages: [],
    seedGoal: "检查这个仓库",
    threadId: "thread-a",
    acpEnabled: false,
    acpAgents: [{ id: "agent-1", display_name: "Local", enabled: true, command: "agent", profile: "default" }],
  }
  return {
    messages, callbacks, dispatch, props,
    state: () => state,
    setLastError(error?: { message: string }) { lastError = error },
    renderPanel() { return render("panel", panelModule.CodingAgentPanel, props) },
    renderClosedSettings() { return render("settings", settingsModule.SettingsSlideout) },
    rows(node: any): any[] { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => this.rows(child)) : [node, ...this.rows(node.props?.children)] },
    checkbox(view: any, label: string) {
      return this.rows(view).find((node: any) => node.type === "label" && textOf(node).includes(label))
    },
    terminalInput(view: any) {
      const label = this.checkbox(view, codingHandoffCopy.panelOpenLocalTerminal)
      return this.rows(label).find((node: any) => node.type === "input" && node.props?.type === "checkbox")
    },
    prepare() {
      dispatch({ type: "SET_CONNECTION", state: "connected" })
      dispatch({ type: "SET_THREADS", threads: [{ id: "thread-a", workspace_root: "/repo" }] })
      dispatch({ type: "SET_ACTIVE_THREAD", threadId: "thread-a" })
      dispatch({ type: "SET_CONFIG_SNAPSHOT", config: { ...state.config, coding_handoff: { open_local_terminal: false } }, revision: "epoch:1" })
      dispatch({ type: "SET_CONFIG_HYDRATED", hydrated: true })
      const view = this.renderPanel()
      return this.renderPanel() || view
    },
    configSets() { return messages.filter(message => message?.type === "config.set") },
    errorSocket() {
      const effects: Array<() => void> = []
      const refs: any[] = []
      let cursor = 0
      let listener: ((message: any) => void) | undefined
      const socketReact = {
        useRef(value: any) { const owned = refs[cursor] || { current: value }; refs[cursor] = owned; cursor += 1; return owned },
        useEffect(effect: () => void) { effects.push(effect) },
      }
      const output: any = {}
      const code = ts.transpileModule(fs.readFileSync(at("hooks/useWebSocket.ts"), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText
      vm.runInNewContext(code, {
        exports: output, console,
        require: (id: string) => {
          if (id === "react") return socketReact
          if (id === "../store/agentStore") return { useAgentStore: () => ({ state, dispatch }), overlayStandbyFromError: () => null }
          if (id === "../utils/settings-draft") return load(at("utils/settings-draft.ts"))
          if (id === "../coding-handoff/workspace-hints") return load(at("coding-handoff/workspace-hints.ts"))
          const Stub = function Stub() {}
          const fn: any = new Proxy(Stub, { get: () => fn, apply: () => undefined })
          return new Proxy({}, { get: () => fn })
        },
        chrome: { runtime: { lastError: null, onMessage: { addListener(fn: any) { listener = fn }, removeListener() {} }, sendMessage() {}, connect: () => ({ disconnect() {} }) }, storage: { local: { get() {}, remove() {} } } },
        document: { addEventListener() {}, removeEventListener() {} },
        window: { dispatchEvent: () => true }, setInterval: () => 1, clearInterval() {},
      }, { timeout: 5000, filename: "useWebSocket.ts" })
      cursor = 0
      output.useWebSocket()
      for (const effect of effects) effect()
      assert.equal(typeof listener, "function")
      return { send: (message: any) => listener!(message) }
    },
  }
}

function receiptGaps(ui: ReturnType<typeof harness>, index: number) {
  const gaps: string[] = []
  const sent = ui.messages[index]
  if (!sent || sent.type !== "config.set") gaps.push("config.set missing")
  else {
    if (typeof sent.id !== "string" || !/^settings-save:[A-Za-z0-9_-]+$/.test(sent.id)) gaps.push(`id=${String(sent.id)}`)
    if (sent.config_revision !== "epoch:1") gaps.push(`config_revision=${String(sent.config_revision)}`)
    if (typeof ui.callbacks[index] !== "function") gaps.push("config.set has no receipt callback")
  }
  return gaps
}

test("probe: a closed settings page still confirms an accepted immediate save", () => {
  const ui = harness()
  ui.prepare()
  assert.equal(ui.state().settingsOpen, false)
  ui.dispatch({
    type: "BEGIN_IMMEDIATE_SAVE", id: "settings-save:probe", revision: "epoch:1",
    patch: { coding_handoff: { open_local_terminal: true } }, audit: null,
  })
  ui.dispatch({ type: "IMMEDIATE_SAVE_ACCEPTED", id: "settings-save:probe" })
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT", id: "settings-save:probe", revision: "epoch:2",
    config: { ...ui.state().config, coding_handoff: { open_local_terminal: true } },
  })
  ui.renderClosedSettings()
  assert.equal(ui.state().settingsOpen, false)
  assert.equal(ui.state().immediateSave?.status, "confirmed")
  assert.equal(ui.state().config.coding_handoff.open_local_terminal, true)
})

test("the coding panel local terminal waits for an authoritative snapshot", () => {
  const ui = harness()
  const view = ui.prepare()
  const input = ui.terminalInput(view)
  assert.ok(input, "local terminal checkbox")
  input.props.onChange({ target: { checked: true } })
  const gaps: string[] = []
  if (ui.state().config.coding_handoff?.open_local_terminal !== false) gaps.push("config changed before a snapshot")
  const again = ui.renderPanel()
  if (ui.terminalInput(again)?.props.checked !== false) gaps.push("checkbox left the snapshot")
  const index = ui.messages.findIndex(message => message?.type === "config.set" && message.config?.coding_handoff)
  gaps.push(...receiptGaps(ui, index))
  if (typeof ui.callbacks[index] !== "function") gaps.push("authoritative confirmation did not run")
  else {
    ui.callbacks[index]!({ ok: true })
    ui.renderPanel()
    ui.renderClosedSettings()
    if (ui.state().config.coding_handoff.open_local_terminal !== false) gaps.push("transport ok changed config")
    if (ui.state().immediateSave?.status !== "accepted") gaps.push(`accepted status=${ui.state().immediateSave?.status}`)
    ui.dispatch({
      type: "SET_CONFIG_SNAPSHOT", id: ui.messages[index].id, revision: "epoch:2",
      config: { ...ui.state().config, coding_handoff: { ...ui.state().config.coding_handoff, open_local_terminal: true } },
    })
    ui.renderClosedSettings()
    const confirmed = ui.renderPanel()
    if (ui.state().immediateSave?.status !== "confirmed") gaps.push(`confirmed status=${ui.state().immediateSave?.status}`)
    if (ui.terminalInput(confirmed)?.props.checked !== true) gaps.push("confirmed checkbox stayed off")
    if (ui.state().settingsOpen !== false) gaps.push("settings opened by the panel receipt")
  }
  assert.deepEqual(gaps, [])
})

test("a refused coding panel terminal click stays on the snapshot and is visible", () => {
  const ui = harness()
  const input = ui.terminalInput(ui.prepare())
  assert.ok(input)
  ui.setLastError({ message: "扩展通道不可用" })
  input.props.onChange({ target: { checked: true } })
  const gaps: string[] = []
  if (ui.state().config.coding_handoff?.open_local_terminal !== false) gaps.push("config changed after lastError")
  const index = ui.messages.findIndex(message => message?.type === "config.set" && message.config?.coding_handoff)
  if (typeof ui.callbacks[index] !== "function") gaps.push("lastError has no receipt callback")
  else ui.callbacks[index]!({ ok: false, error: "不应被读取" })
  const view = ui.renderPanel()
  if (!textOf(view).includes("扩展通道不可用")) gaps.push("lastError is not visible on the panel")
  if (ui.terminalInput(view)?.props.checked !== false) gaps.push("checkbox left the snapshot")
  assert.deepEqual(gaps, [])
})

test("disconnect and a matching error recover the coding panel request without touching the main save", () => {
  const ui = harness()
  ui.prepare()
  ui.dispatch({ type: "BEGIN_SETTINGS_DRAFT" })
  ui.dispatch({ type: "BEGIN_SETTINGS_SAVE", submission: { id: "settings-save:main", revision: "epoch:1", patch: { temperature: 0.2 }, generations: { temperature: 1 } } })
  const input = ui.terminalInput(ui.renderPanel())
  assert.ok(input)
  input.props.onChange({ target: { checked: true } })
  const gaps: string[] = []
  if (ui.state().settingsSave.pending?.id !== "settings-save:main") gaps.push("main save pending changed")
  if (ui.state().config.coding_handoff?.open_local_terminal !== false) gaps.push("config changed before disconnect recovery")
  const index = ui.messages.findIndex(message => message?.type === "config.set" && message.config?.coding_handoff)
  gaps.push(...receiptGaps(ui, index))
  if (typeof ui.callbacks[index] !== "function") gaps.push("disconnect recovery did not run")
  else {
    ui.callbacks[index]!({ ok: true })
    ui.dispatch({ type: "SET_CONNECTION", state: "disconnected" })
    const dropped = ui.renderPanel()
    if (ui.state().immediateSave?.status !== "unknown") gaps.push(`disconnect status=${ui.state().immediateSave?.status}`)
    if (ui.state().settingsSave.status !== "unknown") gaps.push(`main disconnect status=${ui.state().settingsSave.status}`)
    if (!textOf(dropped).includes("连接已断开")) gaps.push("disconnect is not visible on the panel")
    if (ui.state().config.coding_handoff?.open_local_terminal !== false) gaps.push("disconnect kept an optimistic value")
  }
  const rejected = harness()
  rejected.prepare()
  rejected.dispatch({ type: "BEGIN_SETTINGS_DRAFT" })
  rejected.dispatch({ type: "BEGIN_SETTINGS_SAVE", submission: { id: "settings-save:main", revision: "epoch:1", patch: { temperature: 0.2 }, generations: { temperature: 1 } } })
  const rejectedInput = rejected.terminalInput(rejected.renderPanel())
  assert.ok(rejectedInput)
  rejectedInput.props.onChange({ target: { checked: true } })
  const rejectedIndex = rejected.messages.findIndex(message => message?.type === "config.set" && message.config?.coding_handoff)
  if (typeof rejected.messages[rejectedIndex]?.id !== "string") gaps.push("matching error recovery did not run")
  else {
    if (typeof rejected.callbacks[rejectedIndex] === "function") rejected.callbacks[rejectedIndex]!({ ok: true })
    rejected.errorSocket().send({ type: "error", id: rejected.messages[rejectedIndex].id, error: "这次写入被拒绝" })
    const view = rejected.renderPanel()
    if (rejected.state().immediateSave?.status !== "unknown") gaps.push(`error status=${rejected.state().immediateSave?.status}`)
    if (rejected.state().settingsSave.pending?.id !== "settings-save:main") gaps.push("matching error changed the main save")
    if (!textOf(view).includes("这次写入被拒绝")) gaps.push("matching error is not visible on the panel")
    rejected.errorSocket().send({ type: "error", id: "settings-save:someone-else", error: "别的请求失败" })
    if (textOf(rejected.renderPanel()).includes("别的请求失败")) gaps.push("unmatched error became visible")
  }
  assert.deepEqual(gaps, [])
})

test("a coding panel click does not replace an in-flight immediate save or its audit", () => {
  const ui = harness()
  ui.prepare()
  const audit = { id: "audit-1", ts: "t", level: "info", tool_name: "allow_all_schemes", action: "changed", risk_level: "low", risk_score: 0, source: "ui_phrase_confirmed", message: "已关闭协议解锁" }
  ui.dispatch({ type: "BEGIN_IMMEDIATE_SAVE", id: "settings-save:inflight", revision: "epoch:1", patch: { allow_all_schemes: false }, audit })
  ui.dispatch({ type: "ADD_SECURITY_AUDIT", entry: audit })
  const input = ui.terminalInput(ui.renderPanel())
  assert.ok(input)
  const before = ui.messages.length
  input.props.onChange({ target: { checked: true } })
  const gaps: string[] = []
  if (ui.state().immediateSave?.id !== "settings-save:inflight") gaps.push("in-flight immediate save was replaced")
  if (ui.state().immediateSave?.audit?.message !== "已关闭协议解锁") gaps.push("in-flight audit was lost")
  if (ui.state().securityAuditLog.length !== 1) gaps.push(`audit log=${ui.state().securityAuditLog.length}`)
  if (ui.state().config.coding_handoff?.open_local_terminal !== false) gaps.push("config changed while another immediate save was in flight")
  if (ui.messages.slice(before).some(message => message?.type === "config.set")) gaps.push("panel sent config.set while another immediate save was in flight")
  if (!textOf(ui.renderPanel()).includes("上一次设置还在等待确认")) gaps.push("rejected click is not visible")
  assert.deepEqual(gaps, [])
})

test("an unknown terminal save can be retried with a new id", () => {
  const ui = harness()
  const first = ui.terminalInput(ui.prepare())
  assert.ok(first)
  first.props.onChange({ target: { checked: true } })
  const index = ui.messages.findIndex(message => message?.type === "config.set" && message.config?.coding_handoff)
  assert.equal(typeof ui.callbacks[index], "function")
  ui.callbacks[index]!({ ok: false, error: "写入失败" })
  const failed = ui.renderPanel()
  assert.equal(ui.state().immediateSave?.status, "unknown")
  assert.equal(textOf(failed).includes("写入失败"), true)
  const retry = ui.terminalInput(failed)
  assert.ok(retry)
  const before = ui.messages.length
  retry.props.onChange({ target: { checked: true } })
  const again = ui.messages.slice(before).filter(message => message?.type === "config.set")
  assert.equal(again.length, 1)
  assert.ok(again[0].id !== ui.messages[index].id)
  assert.match(again[0].id, /^settings-save:[A-Za-z0-9_-]+$/)
  const callback = ui.callbacks[ui.messages.lastIndexOf(again[0])]
  assert.equal(typeof callback, "function")
  callback!({ ok: true })
  assert.equal(ui.state().immediateSave?.status, "accepted")
  ui.dispatch({
    type: "SET_CONFIG_SNAPSHOT", id: again[0].id, revision: "epoch:2",
    config: { ...ui.state().config, coding_handoff: { open_local_terminal: true } },
  })
  ui.renderClosedSettings()
  const confirmed = ui.renderPanel()
  assert.equal(ui.state().immediateSave?.status, "confirmed")
  assert.equal(ui.terminalInput(confirmed)?.props.checked, true)
  assert.equal(textOf(confirmed).includes("写入失败"), false)
})

test("no revision and a dropped connection do not send a terminal config.set", () => {
  const offline = harness()
  offline.prepare()
  offline.dispatch({ type: "SET_CONNECTION", state: "disconnected" })
  offline.dispatch({ type: "SET_CONNECTION", state: "connected" })
  assert.equal(offline.state().connectionState, "connected")
  assert.equal(offline.state().configRevision, null)
  const before = offline.messages.length
  const input = offline.terminalInput(offline.renderPanel())
  assert.ok(input)
  input.props.onChange({ target: { checked: true } })
  assert.equal(offline.messages.slice(before).some(message => message?.type === "config.set"), false)
  assert.equal(textOf(offline.renderPanel()).includes("没有发送"), true)
  assert.equal(offline.state().config.coding_handoff?.open_local_terminal, false)

  const dropped = harness()
  dropped.prepare()
  dropped.dispatch({ type: "SET_CONNECTION", state: "disconnected" })
  const droppedBefore = dropped.messages.length
  const droppedInput = dropped.terminalInput(dropped.renderPanel())
  assert.ok(droppedInput)
  droppedInput.props.onChange({ target: { checked: true } })
  assert.equal(dropped.messages.slice(droppedBefore).some(message => message?.type === "config.set"), false)
  assert.equal(dropped.state().config.coding_handoff?.open_local_terminal, false)
})

test("another immediate save error is not shown as the terminal switch", () => {
  const ui = harness()
  ui.prepare()
  ui.dispatch({ type: "BEGIN_IMMEDIATE_SAVE", id: "settings-save:other", revision: "epoch:1", patch: { allow_all_schemes: false }, audit: null })
  ui.dispatch({ type: "SETTINGS_SAVE_UNKNOWN", id: "settings-save:other", error: "协议解锁失败" })
  const view = ui.renderPanel()
  assert.equal(textOf(view).includes("协议解锁失败"), false)
  assert.equal(ui.terminalInput(view)?.props.checked, false)
})

test("a settings terminal request and the next panel click do not overwrite each other", () => {
  const ui = harness()
  ui.prepare()
  ui.dispatch({ type: "SET_SETTINGS_OPEN", open: true })
  const settings = ui.renderClosedSettings()
  const section = ui.rows(settings).find((node: any) => node.type?.name === "CodingHandoffSettingsSection")
  assert.ok(section, "settings coding section")
  section.props.onToggleOpenLocalTerminal(true)
  assert.equal(ui.configSets().length, 0, "editing does not submit before 保存")
  const updated = ui.renderClosedSettings()
  const save = ui.rows(updated).find((node: any) => node.type === "button" && node.props.className === "cm-settings-save")
  assert.ok(save && !save.props.disabled, "footer save is available")
  save.props.onClick()
  const sent = ui.configSets().filter(message => message.config?.coding_handoff)
  assert.equal(sent.length, 1)
  const panel = ui.renderPanel()
  const before = ui.messages.length
  ui.terminalInput(panel).props.onChange({ target: { checked: false } })
  assert.equal(ui.messages.slice(before).some(message => message?.type === "config.set"), false)
  assert.equal(ui.state().settingsSave.pending?.id, sent[0].id)
  assert.equal(ui.state().config.coding_handoff.open_local_terminal, false)
  assert.equal(textOf(ui.renderPanel()).includes("上一次设置还在等待确认"), true)
})

test("baseline: first ACP enable waits for acp.list and does not change local config", () => {
  const ui = harness()
  let view = ui.prepare()
  const disclosure = ui.rows(view).find((node: any) => node.type === "label" && textOf(node).includes(codingHandoffCopy.disclosureCheckbox))
  const disclosureInput = ui.rows(disclosure).find((node: any) => node.type === "input")
  assert.ok(disclosureInput, "disclosure checkbox")
  disclosureInput.props.onChange({ target: { checked: true } })
  view = ui.renderPanel()
  const start = ui.rows(view).find((node: any) => node.type === "button" && textOf(node).includes(codingHandoffCopy.ctaEnableAndStart))
  assert.ok(start, "enable and start")
  const before = ui.messages.length
  start.props.onClick()
  const sent = ui.messages.slice(before).filter(message => message?.type === "config.set")
  assert.equal(sent.length, 1)
  assert.equal(JSON.stringify(sent[0].config), JSON.stringify({ acp: { enabled: true } }))
  assert.equal(ui.state().acpEnabled, false)
  assert.equal(ui.state().config.acp?.enabled, undefined)
  const callback = ui.callbacks[ui.messages.lastIndexOf(sent[0])]
  assert.equal(typeof callback, "function")
  callback!({ ok: true })
  assert.equal(ui.messages.some(message => message?.type === "acp.ui_start"), false)
  assert.equal(ui.state().acpEnabled, false)
  assert.equal(textOf(ui.renderPanel()).includes("正在启用本机 Agent 会话"), true)
})
