/**
 * Current module receipts carry the same shell authority as list.
 * Profile success and failure belong only to this section's pending switch.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const nodeRequire = createRequire(path.join(__dirname, "shell-provision-receipt.test.js"))

function repoRoot(): string {
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "companion/src/message-router.ts"))) return dir
    dir = path.dirname(dir)
  }
  throw new Error("repo root not found")
}

function loadRouter() {
  const root = repoRoot()
  const base = path.join(root, "companion/src")
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-receipt-"))
  const previousData = process.env.CMSPARK_DATA_DIR
  const extensions = (nodeRequire as unknown as { extensions: Record<string, (mod: { _compile: (code: string, filename: string) => void }, file: string) => void> }).extensions
  const previousTs = extensions[".ts"]
  process.env.CMSPARK_DATA_DIR = owned
  extensions[".ts"] = (mod, file) => {
    mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  }
  fs.writeFileSync(path.join(owned, "config.json"), "{}")
  const config = nodeRequire(path.join(base, "config.ts"))
  const modules = nodeRequire(path.join(base, "capability/modules.ts"))
  const audit = nodeRequire(path.join(base, "packs/audit-log.ts"))
  const sourceFile = ts.createSourceFile("message-router.ts", fs.readFileSync(path.join(base, "message-router.ts"), "utf8"), ts.ScriptTarget.Latest, true)
  const found: ts.CaseClause[] = []
  const walk = (node: ts.Node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && ["modules.list", "modules.set_enabled", "modules.set_profile", "modules.update"].includes(node.expression.text)) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  assert.equal(found.length, 4)
  const source = "globalThis.route=async(type,rest)=>{switch(type){" + found.map(node => node.getText(sourceFile)).join("\n") + "}}"
  const ctx: any = {
    getConfig: config.getConfig,
    getConfigSnapshot: config.getConfigSnapshot,
    saveConfigWithReceipt: config.saveConfigWithReceipt,
    getCommittedConfigRevision: config.getCommittedConfigRevision,
    peekCommittedConfigRevision: config.peekCommittedConfigRevision,
    ensureModulesDefaults: modules.ensureModulesDefaults,
    appendCapabilityAudit: audit.appendCapabilityAudit,
    structuredClone,
    Date,
    require(id: string) {
      if (id === "./capability/modules") return modules
      if (id === "./capability/shell-provision") return nodeRequire(path.join(base, "capability/shell-provision.ts"))
      if (id === "./packs/pack-engine") return { setCapabilityProfile: ctx.profile }
      throw new Error("unexpected import " + id)
    },
  }
  const profileFile = ts.createSourceFile("profile", fs.readFileSync(path.join(base, "packs/pack-engine.ts"), "utf8"), ts.ScriptTarget.Latest, true)
  const declarations = profileFile.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "setCapabilityProfile")
  assert.equal(declarations.length, 1)
  vm.runInNewContext(ts.transpileModule(declarations[0].getText(profileFile).replace(/^export\s+/, "") + "\nglobalThis.profile=setCapabilityProfile;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx)
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx)
  config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: false }, netsec: { available: true, enabled: false, target_allowlist: [] } } })
  return {
    config,
    route: ctx.route as (type: string, rest: Record<string, unknown>) => Promise<any>,
    cleanup() {
      if (previousData === undefined) delete process.env.CMSPARK_DATA_DIR
      else process.env.CMSPARK_DATA_DIR = previousData
      if (previousTs) extensions[".ts"] = previousTs
      else delete extensions[".ts"]
      fs.rmSync(owned, { recursive: true, force: true })
    },
  }
}

function textOf(node: any): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (typeof node === "object") return textOf(node.props?.children)
  return ""
}

function mountSurfaces() {
  const listeners: Array<(message: any) => void> = []
  const slots = new Map<string, { cells: any[]; effects: any[] }>()
  let frame: { cells: any[]; effects: any[] } | undefined
  let cursor = 0
  let effectCursor = 0
  const effectQueue: Array<() => void> = []
  const flush = () => { while (effectQueue.length) effectQueue.shift()!() }
  let confirm = false
  let runtimeError: { message: string } | undefined
  let transport: () => any = () => ({ ok: true })
  const sent: any[] = []
  const timers = new Map<number, { fn: () => void; delay: number }>()
  let timerSeq = 0
  const react: any = {
    useState: (initial: any) => {
      const owned = frame!
      const index = cursor++
      if (!(index in owned.cells)) owned.cells[index] = typeof initial === "function" ? initial() : initial
      return [owned.cells[index], (value: any) => { owned.cells[index] = typeof value === "function" ? value(owned.cells[index]) : value }]
    },
    useRef: (initial: any) => {
      const owned = frame!
      const index = cursor++
      if (!(index in owned.cells)) owned.cells[index] = { current: initial }
      return owned.cells[index]
    },
    useCallback: (fn: any) => fn,
    useEffect: (effect: () => any, deps: any[] = []) => {
      const owned = frame!
      const index = effectCursor++
      const old = owned.effects[index]
      if (!old || deps.length !== old.deps.length || deps.some((value: any, i: number) => value !== old.deps[i])) {
        const next = { deps, cleanup: undefined as any }
        owned.effects[index] = next
        effectQueue.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const root = path.join(repoRoot(), "chrome-extension/src/sidepanel")
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
        if (id === "../store/agentStore") return { useAgentStore: () => ({ state: { activeThreadId: "thread-a", threads: [], knowledgeDocs: [] }, dispatch() {} }) }
        if (id === "./ContextPanelHost") return { useContextPanelHostOptional: () => null }
        if (id === "./ShellEnableActions") return { ShellFailureNavigation() { return null } }
        if (id === "./ShellProvisionRow") return load(path.join(root, "components/ShellProvisionRow.tsx"))
        if (id === "../ui/tokens") return load(path.join(root, "ui/tokens.ts"))
        if (id === "../packs-panel-logic") return load(path.join(root, "packs-panel-logic.ts"))
        if (id === "../utils/capability-profile") return load(path.join(root, "utils/capability-profile.ts"))
        if (id === "../utils/shell-enable-navigation" || id === "./gate-error-copy" || id === "../types") return {}
        throw new Error(`unexpected ${id}`)
      },
      chrome: { runtime: {
        get lastError() { return runtimeError },
        sendMessage(message: any, callback?: (response?: any) => void) {
          sent.push(message)
          if (typeof callback === "function") callback(transport())
          return Promise.resolve()
        },
        onMessage: {
          addListener(fn: any) { listeners.push(fn) },
          removeListener(fn: any) {
            const index = listeners.indexOf(fn)
            if (index >= 0) listeners.splice(index, 1)
          },
        },
      } },
      window: { confirm: () => confirm },
      setTimeout(fn: () => void, delay?: number) { const id = ++timerSeq; timers.set(id, { fn, delay: delay || 0 }); return id },
      clearTimeout(id: number) { timers.delete(id) },
      console,
    }, { timeout: 5000, filename })
    return output
  }
  const packs = load(path.join(root, "components/PacksPanel.tsx"))
  const profile = load(path.join(root, "components/CapabilityProfileSection.tsx"))
  const rows = (node: any, depth = 0): any[] => {
    if (!node || typeof node !== "object" || depth > 6) return []
    if (Array.isArray(node)) return node.flatMap(child => rows(child, depth))
    const rendered = typeof node.type === "function" ? rows(node.type(node.props), depth + 1) : []
    return [node, ...rows(node.props?.children, depth), ...rendered]
  }
  const render = (name: string, draw: () => any) => {
    if (!slots.has(name)) slots.set(name, { cells: [], effects: [] })
    frame = slots.get(name)
    cursor = 0
    effectCursor = 0
    const ui = draw()
    frame = undefined
    flush()
    return ui
  }
  render("packs", () => packs.PacksPanel())
  render("profile", () => profile.CapabilityProfileSection())
  return {
    deliver(message: any) { for (const listener of listeners) listener(message) },
    scene() { return rows(render("packs", () => packs.PacksPanel())).map(textOf).join("") },
    profile() { return rows(render("profile", () => profile.CapabilityProfileSection())).map(textOf).join("") },
    switchButton() {
      const found = rows(render("profile", () => profile.CapabilityProfileSection())).filter(node => node.type === "button")
      assert.equal(found.length, 1)
      return found[0]
    },
    confirmSwitch() {
      confirm = true
      const before = sent.length
      this.switchButton().props.onClick()
      confirm = false
      const message = sent.slice(before).reverse().find(item => item?.type === "modules.set_profile")
      assert.ok(message, "profile switch must send modules.set_profile")
      return message
    },
    refuseSend(error: string) { transport = () => ({ ok: false, error }); runtimeError = undefined },
    runtimeFailure(message: string) { runtimeError = { message }; transport = () => undefined },
    acceptSend() { runtimeError = undefined; transport = () => ({ ok: true }) },
    expire() {
      let chosen: number | undefined
      let delay = -1
      for (const [id, timer] of timers) {
        if (timer.delay >= delay) { delay = timer.delay; chosen = id }
      }
      if (chosen == null) return false
      const timer = timers.get(chosen)
      timers.delete(chosen)
      timer?.fn()
      return true
    },
    unmountProfile() {
      const cleanup = slots.get("profile")?.effects?.[0]?.cleanup
      if (typeof cleanup === "function") cleanup()
    },
  }
}

test("enterprise netsec receipts keep shell provided and do not settle a profile switch", async () => {
  const router = loadRouter()
  try {
    const ui = mountSurfaces()
    const list = await router.route("modules.list", {})
    assert.equal(list.shell_provision, "provided")
    ui.deliver(list)
    assert.match(ui.scene(), /已由 enterprise 档提供/)
    assert.match(ui.profile(), /enterprise/)

    const enabled = await router.route("modules.set_enabled", { module: "netsec", enabled: true, by: "user" })
    assert.equal(enabled.type, "modules.updated")
    assert.equal(enabled.shell_provision, "provided")
    assert.equal(Object.hasOwn(enabled, "capability_profile"), false)
    assert.equal(enabled.modules.netsec.enabled, true)
    ui.deliver(enabled)
    assert.match(ui.scene(), /已由 enterprise 档提供/)
    assert.equal(ui.scene().includes("提供状态未知"), false)
    assert.equal(ui.profile().includes("没有权威的能力档回执"), false)
    assert.match(ui.profile(), /enterprise/)

    const updated = await router.route("modules.update", { module: "netsec", patch: { target_allowlist: ["owned.example"] } })
    assert.equal(updated.type, "modules.updated")
    assert.equal(updated.shell_provision, "provided")
    assert.equal(Object.hasOwn(updated, "capability_profile"), false)
    ui.deliver(updated)
    assert.match(ui.scene(), /已由 enterprise 档提供/)
    assert.equal(ui.scene().includes("提供状态未知"), false)
    assert.equal(ui.profile().includes("没有权威的能力档回执"), false)

    const firstSwitch = ui.confirmSwitch()
    assert.equal(typeof firstSwitch.id, "string")
    assert.equal(ui.switchButton().props.disabled, true)
    ui.deliver(enabled)
    ui.deliver(updated)
    assert.equal(ui.switchButton().props.disabled, true)
    assert.equal(ui.profile().includes("没有权威的能力档回执"), false)
    assert.equal(ui.profile().includes("能力档已更新"), false)
    assert.match(ui.profile(), /enterprise/)
    assert.match(ui.scene(), /已由 enterprise 档提供/)

    ui.deliver({ type: "modules.list", capability_profile: "enterprise", modules: list.modules })
    assert.match(ui.scene(), /提供状态未知/)
    assert.match(ui.profile(), /enterprise/)

    const profileReply = await router.route("modules.set_profile", { profile: "community", by: "owned-test" })
    assert.equal(profileReply.type, "modules.updated")
    assert.equal(profileReply.capability_profile, "community")
    const missing = { ...profileReply, id: firstSwitch.id }
    delete missing.shell_provision
    ui.deliver(missing)
    assert.match(ui.profile(), /没有权威的能力档回执/)
    assert.equal(ui.profile().includes("能力档已更新"), false)
    assert.match(ui.profile(), /enterprise/)
    assert.equal(ui.switchButton().props.disabled, false)

    const retrySwitch = ui.confirmSwitch()
    assert.ok(retrySwitch.id !== firstSwitch.id)
    ui.deliver({ ...profileReply, id: retrySwitch.id })
    assert.match(ui.profile(), /能力档已更新|能力档已切换/)
    assert.match(ui.profile(), /community/)
    assert.equal(ui.profile().includes("没有权威的能力档回执"), false)
    assert.match(ui.scene(), /确认升档后可用/)

    const lifecycle = fs.readFileSync(path.join(repoRoot(), "companion/src/ws/lifecycle.ts"), "utf8")
    const background = fs.readFileSync(path.join(repoRoot(), "chrome-extension/src/background/index.ts"), "utf8")
    assert.match(lifecycle, /\{ \.\.\.response, id: msg\?\.id \}/)
    assert.match(background, /if \(!sent\) \{/)
    assert.match(background, /Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接/)

    router.config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: true, enabled_by: "profile.enterprise" }, netsec: { available: true, enabled: false, target_allowlist: [] } } })
    const failed = mountSurfaces()
    failed.deliver(await router.route("modules.list", {}))
    const failedSwitch = failed.confirmSwitch()
    failed.deliver({ type: "error", id: failedSwitch.id, error: "PROFILE_STATE_INVALID" })
    assert.equal(failed.switchButton().props.disabled, false)
    assert.match(failed.profile(), /PROFILE_STATE_INVALID/)
    assert.equal(failed.profile().includes("能力档已更新"), false)
    assert.equal(failed.profile().includes("能力档已切换"), false)
    assert.match(failed.profile(), /enterprise/)
    const late = await router.route("modules.set_profile", { profile: "community", by: "owned-test" })
    failed.deliver({ ...late, id: failedSwitch.id })
    assert.equal(failed.profile().includes("能力档已更新"), false)
    assert.equal(failed.profile().includes("能力档已切换"), false)
    assert.match(failed.profile(), /enterprise/)
    const failedRetry = failed.confirmSwitch()
    assert.ok(failedRetry.id !== failedSwitch.id)
    failed.deliver({ ...late, id: failedRetry.id, shell_provision: "community" })
    assert.match(failed.profile(), /能力档已更新|能力档已切换/)
    assert.match(failed.profile(), /community/)

    router.config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: true, enabled_by: "profile.enterprise" }, netsec: { available: true, enabled: false, target_allowlist: [] } } })
    const refused = mountSurfaces()
    refused.deliver(await router.route("modules.list", {}))
    refused.refuseSend("Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接")
    const refusedSwitch = refused.confirmSwitch()
    assert.equal(refused.switchButton().props.disabled, false)
    assert.match(refused.profile(), /未连接/)
    assert.match(refused.profile(), /enterprise/)
    refused.deliver({ ...late, id: refusedSwitch.id, shell_provision: "community" })
    assert.equal(refused.profile().includes("能力档已切换"), false)
    assert.match(refused.profile(), /enterprise/)
    refused.runtimeFailure("The message port closed before a response was received")
    const runtimeSwitch = refused.confirmSwitch()
    assert.ok(runtimeSwitch.id !== refusedSwitch.id)
    assert.equal(refused.switchButton().props.disabled, false)
    assert.match(refused.profile(), /结果未知/)
    assert.equal(refused.profile().includes("未执行"), false)
    assert.match(refused.profile(), /enterprise/)

    router.config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: true, enabled_by: "profile.enterprise" }, netsec: { available: true, enabled: false, target_allowlist: [] } } })
    const pending = mountSurfaces()
    pending.deliver(await router.route("modules.list", {}))
    const pendingSwitch = pending.confirmSwitch()
    pending.deliver({ type: "error", id: "netsec-request", error: "enterprise_profile_required — set capability_profile=enterprise for shell/netsec" })
    pending.deliver({ type: "error", error: "module not available: appsec" })
    pending.deliver(enabled)
    assert.equal(pending.switchButton().props.disabled, true)
    assert.match(pending.profile(), /enterprise/)
    assert.equal(pending.profile().includes("没有权威的能力档回执"), false)
    assert.equal(pending.profile().includes("module not available"), false)
    pending.deliver({ type: "thread.mutation.connection", state: "disconnected" })
    assert.equal(pending.switchButton().props.disabled, false)
    assert.match(pending.profile(), /结果未知/)
    assert.equal(pending.profile().includes("未执行"), false)
    assert.match(pending.profile(), /enterprise/)
    pending.deliver({ ...late, id: pendingSwitch.id, shell_provision: "community" })
    assert.equal(pending.profile().includes("能力档已切换"), false)
    assert.match(pending.profile(), /enterprise/)
    const timed = pending.confirmSwitch()
    assert.equal(pending.expire(), true)
    assert.equal(pending.switchButton().props.disabled, false)
    assert.match(pending.profile(), /结果未知/)
    pending.deliver({ ...late, id: timed.id, shell_provision: "community" })
    assert.equal(pending.profile().includes("能力档已切换"), false)
    assert.match(pending.profile(), /enterprise/)

    const unmounted = mountSurfaces()
    unmounted.deliver(await router.route("modules.list", {}))
    const unmountedSwitch = unmounted.confirmSwitch()
    unmounted.unmountProfile()
    unmounted.expire()
    unmounted.deliver({ ...late, id: unmountedSwitch.id, shell_provision: "community" })
    assert.match(unmounted.profile(), /enterprise/)
    assert.equal(unmounted.profile().includes("能力档已切换"), false)
    assert.equal(unmounted.profile().includes("结果未知"), false)
  } finally {
    router.cleanup()
  }
})
