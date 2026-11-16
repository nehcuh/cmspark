/**
 * Phase 2b: shell gate navigation and module-power waiting.
 * Calls the real navigation handler and the real PacksPanel enable path.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { humanizeSidepanelGateError } from "../src/sidepanel/utils/gate-error-copy"
import { extractShellCardData } from "../src/sidepanel/utils/shell-card-utils"

const FORBIDDEN = ["modules.set_enabled", "modules.set_profile", "config.set", "pack.apply"]

function textOf(node: any): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (typeof node === "object") return textOf(node.props?.children)
  return ""
}

test("shell and enterprise gate errors keep the existing copy and add navigation", async () => {
  const { gateErrorChatMessage } = await import("../src/sidepanel/utils/shell-enable-navigation")
  const shell = gateErrorChatMessage("module_disabled:shell — enable in settings (modules.set_enabled) before use", "thread-a", "id-shell")
  const profile = gateErrorChatMessage("enterprise_profile_required — set capability_profile=enterprise for shell/netsec", "thread-a", "id-profile")
  assert.equal(shell.content, humanizeSidepanelGateError("module_disabled:shell — enable in settings (modules.set_enabled) before use"))
  assert.match(shell.content, /本机能力/)
  assert.match(shell.content, /能力档/)
  assert.deepEqual(shell.shellEnableNavigation, { packs: true, settingsSection: "integrations" })
  assert.deepEqual(profile.shellEnableNavigation, { packs: true, settingsSection: "integrations" })
  for (const raw of [
    "module_disabled:netsec — enable in settings (modules.set_enabled) before use",
    "本机能力未开启",
    "tool_not_allowed",
    "NETSEC_SCOPE",
  ]) {
    const message = gateErrorChatMessage(raw, "thread-a", "id-other")
    assert.equal(message.shellEnableNavigation, undefined, raw)
    assert.equal(message.content, humanizeSidepanelGateError(raw))
  }
})

test("navigation buttons open packs and the capability page without sending permission messages", async () => {
  const sent: any[] = []
  const opened: string[] = []
  const actions: any[] = []
  const ui = renderActions(() => import("../src/sidepanel/components/ShellEnableActions"), {
    send(message: any) { sent.push(message) },
    openPacks(id: string) { opened.push(id); return Promise.resolve(true) },
    dispatch(action: any) { actions.push(action) },
  })
  const buttons = ui.rows(ui.render()).filter((node: any) => node.type === "button")
  assert.equal(buttons.length, 2)
  buttons[0].props.onClick()
  buttons[1].props.onClick()
  assert.deepEqual(opened, ["packs"])
  assert.equal(JSON.stringify(actions), JSON.stringify([{ type: "OPEN_SETTINGS_SECTION", section: "integrations" }]))
  assert.deepEqual(sent.filter(message => FORBIDDEN.includes(message?.type)), [])
})

test("the first shell_exec module failure renders navigation on the tool card", async () => {
  const result = {
    success: false,
    error: "module_disabled:shell — enable in settings (modules.set_enabled) before use",
    data: { error_code: "SHELL_SCOPE_DENIED" },
  }
  const card = extractShellCardData({ command: "pwd" }, result)
  assert.match(card.stderr, /module_disabled:shell/)
  assert.match(card.body, /\[stderr\][\s\S]*module_disabled:shell/)
  const unrelated = extractShellCardData({ command: "pwd" }, { success: false, error: "command not found", data: { stderr: "command not found", exit_code: 127 } })
  const sent: any[] = []
  const opened: string[] = []
  const actions: any[] = []
  const ports = { send(message: any) { sent.push(message) }, openPacks(id: string) { opened.push(id); return Promise.resolve(true) }, dispatch(action: any) { actions.push(action) } }
  const shown = renderNavigation(null, { text: card.stderr }, ports)
  assert.equal(shown.rows(shown.render()).filter((node: any) => node.type === "button").length, 2)
  shown.rows(shown.render()).filter((node: any) => node.type === "button").forEach((node: any) => node.props.onClick())
  const hidden = renderNavigation(null, { text: unrelated.stderr }, ports)
  assert.equal(hidden.rows(hidden.render()).filter((node: any) => node.type === "button").length, 0)
  assert.deepEqual(opened, ["packs"])
  assert.equal(JSON.stringify(actions), JSON.stringify([{ type: "OPEN_SETTINGS_SECTION", section: "integrations" }]))
  assert.deepEqual(sent.filter(message => FORBIDDEN.includes(message?.type)), [])
})

test("a formatted enterprise gate chat.error still exposes navigation after the machine code is removed", async () => {
  const { gateErrorChatMessage } = await import("../src/sidepanel/utils/shell-enable-navigation")
  const format = loadFormatChatErrorLine()
  const formatted = format("non_recoverable", "enterprise_profile_required — set capability_profile=enterprise for shell/netsec")
  assert.equal(formatted.includes("enterprise_profile_required"), false)
  assert.match(formatted, /本机能力未开启或当前安装通道不足/)
  const message = gateErrorChatMessage(formatted, "thread-a", "id-formatted")
  assert.deepEqual(message.shellEnableNavigation, { packs: true, settingsSection: "integrations" })
  assert.match(message.content, /本机能力/)
  const other = gateErrorChatMessage(format("non_recoverable", "NETSEC_SCOPE target denied"), "thread-a", "id-other")
  assert.equal(other.shellEnableNavigation, undefined)
})

test("shell scene row follows provision and netsec keeps its power button", () => {
  // Enterprise no longer has a shell power switch, so this row cannot send modules.set_enabled for shell.
  const ui = packsPanel()
  ui.deliver({ type: "modules.list", shell_provision: "community", modules: { shell: { available: true, enabled: false }, netsec: { available: true, enabled: false } } })
  const view = ui.render()
  const shown = ui.rows(view).map((node: any) => textOf(node)).join("")
  assert.match(shown, /确认升档后可用/)
  assert.equal(textOf(view).includes("未开启：本机命令"), false)
  const beforeProfile = ui.messages.length
  ui.button("前往能力档确认升档").props.onClick()
  assert.deepEqual(ui.messages.slice(beforeProfile).filter(message => FORBIDDEN.includes(message?.type)), [])
  ui.buttonIn(view, "网络扫描", "开启").props.onClick()
  assert.equal(JSON.stringify(ui.messages.filter(message => message.type === "modules.set_enabled").at(-1)), JSON.stringify({ type: "modules.set_enabled", module: "netsec", enabled: true }))
  ui.deliver({ type: "error", error: "SHELL_PROVISION_RESULT_UNKNOWN" })
  const unknown = ui.render()
  assert.match(ui.rows(unknown).map((node: any) => textOf(node)).join(""), /提供状态未知/)
  const beforeRefresh = ui.messages.length
  ui.button("刷新本机能力列表").props.onClick()
  const refreshMessages = ui.messages.slice(beforeRefresh)
  assert.deepEqual(refreshMessages.map(message => message.type), ["modules.list"])
  assert.deepEqual(refreshMessages.filter(message => FORBIDDEN.includes(message.type)), [])
  ui.deliver({ type: "modules.list", shell_provision: "provided", modules: { shell: { available: true, enabled: true }, netsec: { available: true, enabled: true } } })
  const providedView = ui.render()
  const provided = ui.rows(providedView).map((node: any) => textOf(node)).join("")
  assert.match(provided, /已由 enterprise 档提供/)
  assert.match(provided, /✓ 网络扫描/)
  assert.equal(provided.includes("未开启：本机命令"), false)
})

function loadFormatChatErrorLine() {
  const output: any = {}
  const source = fs.readFileSync(path.resolve(process.cwd(), "../companion/src/capability/user-gate-copy.ts"), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: output,
    require: () => { throw new Error("user-gate-copy must stay pure") },
  }, { timeout: 5000, filename: "user-gate-copy.ts" })
  return output.formatChatErrorLine as (level: string, raw: string) => string
}

function loadNavigationModule() {
  const output: any = {}
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/sidepanel/utils/shell-enable-navigation.ts"), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: output,
    require: (id: string) => {
      if (id === "../types") return {}
      if (id === "./gate-error-copy") return { humanizeSidepanelGateError }
      throw new Error(id)
    },
  }, { timeout: 5000, filename: "shell-enable-navigation.ts" })
  return output
}

function renderNavigation(Component: any, props: any, ports: { send: (message: any) => void; openPacks: (id: string) => Promise<boolean>; dispatch: (action: any) => void }) {
  return renderComponent(Component, props, ports)
}

function renderActions(load: () => Promise<any>, ports: { send: (message: any) => void; openPacks: (id: string) => Promise<boolean>; dispatch: (action: any) => void }) {
  return renderComponent(loadNavigationComponent(), { navigation: { packs: true, settingsSection: "integrations" } }, ports, load)
}

function loadNavigationComponent() {
  return renderComponentModule().ShellEnableActions
}

function renderComponentModule() {
  const output: any = {}
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/sidepanel/components/ShellEnableActions.tsx"), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: output,
    require: (id: string) => {
      if (id === "react") return { useState: (v: any) => [v, () => {}], useRef: (v: any) => ({ current: v }), useEffect() {} }
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
      if (id === "../store/agentStore") return { useAgentStore: () => ({ dispatch() {} }) }
      if (id === "./ContextPanelHost") return { useContextPanelHostOptional: () => null }
      if (id === "../utils/shell-enable-navigation") return loadNavigationModule()
      throw new Error(id)
    },
  }, { timeout: 5000, filename: "ShellEnableActions.tsx" })
  return output
}

function renderComponent(Component: any, props: any, ports: { send: (message: any) => void; openPacks: (id: string) => Promise<boolean>; dispatch: (action: any) => void }, load?: () => Promise<any>) {
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  const effectQueue: Array<() => void> = []
  const flush = () => { while (effectQueue.length) effectQueue.shift()!() }
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
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps, cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const root = path.resolve(process.cwd(), "src/sidepanel")
  const source = fs.readFileSync(path.join(root, "components/ShellEnableActions.tsx"), "utf8")
  const output: any = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: output,
    require: (id: string) => {
      if (id === "react") return react
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
      if (id === "../store/agentStore") return { useAgentStore: () => ({ dispatch: ports.dispatch }) }
      if (id === "./ContextPanelHost") return { useContextPanelHostOptional: () => ({ openPanelForce: ports.openPacks }) }
      if (id === "../utils/shell-enable-navigation") return loadNavigationModule()
      throw new Error(`unexpected ${id}`)
    },
    chrome: { runtime: { sendMessage: ports.send } },
  }, { timeout: 5000, filename: "ShellEnableActions.tsx" })
  void load
  const rows = (node: any, depth = 0): any[] => {
    if (!node || typeof node !== "object" || depth > 6) return []
    if (Array.isArray(node)) return node.flatMap(child => rows(child, depth))
    const rendered = typeof node.type === "function" ? rows(node.type(node.props), depth + 1) : []
    return [node, ...rows(node.props?.children, depth), ...rendered]
  }
  return { rows, render() { if (!slots.has("actions")) slots.set("actions", { cells: [], effects: [] }); frame = slots.get("actions"); cursor = 0; effectCursor = 0; const ui = (props.text !== undefined ? output.ShellFailureNavigation : output.ShellEnableActions)(props); frame = undefined; flush(); return ui } }
}

function packsPanel() {
  const messages: any[] = []
  const callbacks: Array<((response?: any) => void) | undefined> = []
  let lastError: { message: string } | undefined
  const listeners: Array<(message: any) => void> = []
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  const effectQueue: Array<() => void> = []
  const flush = () => { while (effectQueue.length) effectQueue.shift()!() }
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
    useCallback: (fn: any) => fn,
    useEffect: (effect: () => any, deps: any[] = []) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps, cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const root = path.resolve(process.cwd(), "src/sidepanel")
  const modules = new Map<string, any>()
  function load(file: string): any {
    const filename = path.resolve(file)
    if (modules.has(filename)) return modules.get(filename)
    const output: any = {}
    modules.set(filename, output)
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, {
      exports: output,
      require: (id: string) => {
        if (id === "react") return react
        if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" }
        if (id === "../store/agentStore") return { useAgentStore: () => ({ state: { activeThreadId: "thread-a", threads: [], knowledgeDocs: [] }, dispatch: stableDispatch }) }
        if (id === "./ContextPanelHost") return { useContextPanelHostOptional: () => null }
        if (id === "./ShellEnableActions") return load(path.join(root, "components/ShellEnableActions.tsx"))
        if (id === "./ShellProvisionRow") return load(path.join(root, "components/ShellProvisionRow.tsx"))
        if (id === "../utils/shell-enable-navigation" || id === "./gate-error-copy") return id.endsWith("gate-error-copy") ? { humanizeSidepanelGateError } : loadNavigationModule()
        if (id === "../types") return {}
        if (id === "../ui/tokens") return load(path.join(root, "ui/tokens.ts"))
        if (id === "../packs-panel-logic") return load(path.join(root, "packs-panel-logic.ts"))
        throw new Error(`unexpected ${id}`)
      },
      chrome: { runtime: {
        get lastError() { return lastError },
        sendMessage: (message: any, callback?: (response?: any) => void) => { messages.push(message); callbacks.push(callback); return Promise.resolve() },
        onMessage: { addListener(fn: any) { listeners.push(fn) }, removeListener() {} },
      } },
      window: { confirm: () => false, setTimeout: () => 1, clearTimeout() {} },
      setTimeout: () => 1,
      clearTimeout() {},
      console,
    }, { timeout: 5000, filename })
    return output
  }
  const stableDispatch = () => {}
  const panel = load(path.join(root, "components/PacksPanel.tsx"))
  const rows = (node: any, depth = 0): any[] => {
    if (!node || typeof node !== "object" || depth > 6) return []
    if (Array.isArray(node)) return node.flatMap(child => rows(child, depth))
    const rendered = typeof node.type === "function" ? rows(node.type(node.props), depth + 1) : []
    return [node, ...rows(node.props?.children, depth), ...rendered]
  }
  const api = {
    messages,
    rows,
    render() {
      if (!slots.has("packs")) slots.set("packs", { cells: [], effects: [] })
      frame = slots.get("packs"); cursor = 0; effectCursor = 0
      const ui = panel.PacksPanel()
      frame = undefined
      flush()
      return ui
    },
    deliver(message: any) { for (const listener of listeners) listener(message) },
    replyLast(response?: any, error?: { message: string }) {
      const callback = callbacks.at(-1)
      assert.equal(typeof callback, "function")
      lastError = error
      try { callback!(response) } finally { lastError = undefined }
    },
    button(label: string) {
      const found = rows(api.render()).filter((node: any) => node.type === "button" && textOf(node) === label)
      assert.equal(found.length, 1, label)
      return found[0]
    },
    buttonIn(view: any, rowText: string, label: string) {
      const hosts = rows(view).filter((node: any) => textOf(node).includes(rowText) && rows(node).some((child: any) => child.type === "button" && textOf(child) === label))
      const host = hosts.sort((left: any, right: any) => textOf(left).length - textOf(right).length)[0]
      assert.ok(host, `${rowText} ${label}`)
      return rows(host).find((node: any) => node.type === "button" && textOf(node) === label)
    },
  }
  api.render()
  return api
}
