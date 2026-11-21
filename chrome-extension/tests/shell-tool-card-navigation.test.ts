/**
 * Product regression for the shell tool card. Renders ChatView's real
 * ToolHistoryBlock and ToolCallCard. The audit chip stays collapsed until the
 * test clicks it. This is not the helper-only shell-enable case.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const FORBIDDEN = ["modules.set_enabled", "modules.set_profile", "config.set", "pack.apply"]

function textOf(node: any): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (typeof node === "object") return textOf(node.props?.children)
  return ""
}

function harness() {
  const root = path.resolve(process.cwd(), "src/sidepanel")
  const modules = new Map<string, any>()
  const messages: any[] = []
  const actions: any[] = []
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
    useId: () => { const owned = frame!, index = cursor++; if (!(index in owned.cells)) owned.cells[index] = `card-${index}`; return owned.cells[index] },
    useEffect: (effect: () => any, deps: any[]) => {
      const owned = frame!, index = effectCursor++, old = owned.effects[index]
      if (!old || !deps || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps: deps || [], cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
    memo: (component: any) => component,
    Fragment: "fragment",
  }
  const runtime = {
    jsx: (type: any, props: any) => ({ type, props }),
    jsxs: (type: any, props: any) => ({ type, props }),
    Fragment: "fragment",
  }
  const store = load(path.join(root, "store/agentStore.tsx"))
  let state = {
    ...store.initialState,
    connectionState: "connected",
    activeThreadId: "thread-a",
    threads: [{ id: "thread-a" }],
    messages: [
      { id: "user-1", role: "user", content: "跑一下", thread_id: "thread-a" },
      {
        id: "tool-row",
        role: "tool",
        thread_id: "thread-a",
        tool_calls: [
          {
            id: "shell-disabled",
            tool_name: "shell_exec",
            status: "error",
            params: { command: "pwd" },
            result: {
              success: false,
              error: "module_disabled:shell — enable in settings (modules.set_enabled) before use",
              data: { error_code: "SHELL_SCOPE_DENIED" },
            },
          },
          {
            id: "shell-other",
            tool_name: "shell_exec",
            status: "error",
            params: { command: "uname" },
            result: { success: false, error: "command not found", data: { stderr: "command not found", exit_code: 127 } },
          },
        ],
      },
      { id: "answer-1", role: "assistant", content: "没有跑成", thread_id: "thread-a" },
    ],
  }
  const dispatch = (action: any) => { actions.push(action); state = store.agentReducer(state, action) }
  const opened: string[] = []
  const host = { openPanelForce: (id: string) => { opened.push(id); return Promise.resolve(true) } }

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
        if (id === "marked") return { marked: { use() {}, parse: (value: string) => value } }
        if (id === "marked-katex-extension") return { default: () => ({}) }
        if (id === "dompurify") return { default: { addHook() {}, sanitize: (value: string) => value } }
        if (id === "katex/dist/katex.min.css") return {}
        if (!id.startsWith(".")) throw new Error(`unexpected nonlocal dependency ${id} from ${path.basename(filename)}`)
        const target = path.resolve(path.dirname(filename), id)
        const modulePath = target.replace(/\\/g, "/")
        if (modulePath.endsWith("/store/agentStore")) return { ...store, useAgentStore: () => ({ state, dispatch }) }
        if (modulePath.endsWith("/components/ContextPanelHost")) {
          const actual = load(target + ".tsx")
          return { ...actual, useContextPanelHostOptional: () => host }
        }
        const actual = [target + ".ts", target + ".tsx", target + "/index.ts", target + "/index.tsx"].find(file => fs.existsSync(file))
        if (!actual) throw new Error(`missing dependency ${id} from ${path.basename(filename)}`)
        return load(actual)
      },
      chrome: { runtime: { sendMessage: (message: any) => { messages.push(message); return Promise.resolve() }, onMessage: { addListener() {}, removeListener() {} }, lastError: undefined, getURL: (value: string) => value }, tabs: { query() {} } },
      window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
      document: { addEventListener() {}, removeEventListener() {}, hidden: false },
      navigator: { userAgent: "node", clipboard: { writeText: async () => {} } },
      crypto: { randomUUID: () => "card-uuid" },
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: () => 1,
      clearTimeout() {},
      requestAnimationFrame: () => 1,
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

  const chat = load(path.join(root, "components/ChatView.tsx"))
  return { chat, render, messages, actions, opened, state: () => state }
}

function rows(node: any): any[] {
  if (!node || typeof node !== "object") return []
  if (Array.isArray(node)) return node.flatMap(rows)
  return [node, ...rows(node.props?.children)]
}

test("the expanded audit renders navigation on the real shell failure card", () => {
  const ui = harness()
  const page = ui.render("chat", ui.chat.ChatView)
  const block = rows(page).find(node => node.type?.name === "ToolHistoryBlock")
  assert.ok(block, "tool history block")
  let audit = ui.render("audit", block.type, block.props)
  assert.equal(rows(audit).some(node => node.type === "button" && /打开场景里的本机能力|打开能力档/.test(textOf(node))), false)
  const chip = rows(audit).find(node => node.type === "button" && textOf(node).includes("展开审计"))
  assert.ok(chip, "collapsed audit chip")
  assert.equal(chip.props["aria-expanded"], false)
  chip.props.onClick()
  audit = ui.render("audit", block.type, block.props)
  const cards = rows(audit).filter(node => node.type?.name === "ToolCallCard")
  assert.equal(cards.length, 2)
  const rendered = cards.map((card, index) => ui.render(`card-${index}`, card.type, card.props))
  const disabled = rendered.find(card => textOf(card).includes("module_disabled:shell"))
  const unrelated = rendered.find(card => textOf(card).includes("command not found"))
  assert.ok(disabled && unrelated, "both shell cards")
  const actions = rows(disabled).filter(node => typeof node.type === "function" && node.type.name === "ShellFailureNavigation")
  assert.equal(actions.length, 1)
  const failure = ui.render("failure", actions[0].type, actions[0].props)
  const action = rows(failure).find(node => node.type?.name === "ShellEnableActions")
  assert.ok(action, "shell enable actions")
  const buttons = rows(ui.render("buttons", action.type, action.props)).filter(node => node.type === "button")
  assert.deepEqual(buttons.map(node => textOf(node)), ["打开场景里的本机能力", "打开能力档"])
  const unrelatedAction = rows(unrelated).find(node => node.type?.name === "ShellFailureNavigation")
  assert.ok(unrelatedAction, "unrelated shell card still uses the same navigation component")
  const unrelatedButtons = rows(ui.render("unrelated", unrelatedAction.type, unrelatedAction.props)).filter(node => node.type === "button")
  assert.equal(unrelatedButtons.length, 0)
  const before = ui.messages.length
  buttons.forEach(node => node.props.onClick())
  assert.deepEqual(ui.opened, ["packs"])
  assert.equal(JSON.stringify(ui.actions.filter(action => action.type === "OPEN_SETTINGS_SECTION")), JSON.stringify([{ type: "OPEN_SETTINGS_SECTION", section: "integrations" }]))
  assert.deepEqual(ui.messages.slice(before).filter(message => FORBIDDEN.includes(message?.type)), [])
})
