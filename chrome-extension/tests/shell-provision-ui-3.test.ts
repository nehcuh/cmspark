/** Task 3: profile confirm, scene row, and shell navigation follow provision. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as jsxRuntime from "react/jsx-runtime"
import { buildProfileSwitchConfirm, resolveProfileSwitchSend } from "../src/sidepanel/utils/capability-profile"
import { humanizeSidepanelGateError } from "../src/sidepanel/utils/gate-error-copy"
import { ShellProvisionRow } from "../src/sidepanel/components/ShellProvisionRow"

const FORBIDDEN = ["modules.set_enabled", "modules.set_profile", "config.set", "pack.apply"]

test("upgrade confirm says shell is provided and netsec stays independent", () => {
  const confirm = buildProfileSwitchConfirm({ from: "community", to: "enterprise", shellEnabled: false, netsecEnabled: false })
  assert.ok(confirm)
  assert.match(confirm!.body, /提供 shell/)
  assert.match(confirm!.body, /netsec/)
  assert.doesNotMatch(confirm!.body, /不会开启任何模块|不会自动开启任何模块/)
  assert.equal(resolveProfileSwitchSend({ confirmed: false, from: "community", to: "enterprise" }), null)
})

test("downgrade confirm removes shell provision and still names an open netsec switch", () => {
  const confirm = buildProfileSwitchConfirm({ from: "enterprise", to: "community", shellEnabled: true, netsecEnabled: true })
  assert.ok(confirm)
  assert.match(confirm!.body, /shell 不再提供/)
  assert.match(confirm!.body, /netsec/)
  assert.match(confirm!.body, /强制|关闭/)
})

test("shell gate copy points at the profile and netsec keeps its own switch", () => {
  const shell = humanizeSidepanelGateError("enterprise_profile_required — set capability_profile=enterprise for shell")
  const legacy = humanizeSidepanelGateError("module_disabled:shell — enable in settings (modules.set_enabled) before use")
  assert.doesNotMatch(shell + legacy, /开启对应电源|打开 shell 电源/)
  assert.match(shell, /本机与工具|能力档/)
  const netsec = humanizeSidepanelGateError("module_disabled:netsec — enable in settings (modules.set_enabled) before use")
  assert.match(netsec, /电源|网络扫描/)
})

test("scene shell row does not enable shell and unknown refresh only lists modules", () => {
  const sent: any[] = []
  ;(globalThis as any).chrome = { runtime: { sendMessage: (message: any) => { sent.push(message) } } }
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  const community = ShellProvisionRow({ view: "community" })
  const button = rows(community).find(node => node.type === "button")
  button.props.onClick()
  const unknown = ShellProvisionRow({ view: "unknown" })
  rows(unknown).find(node => node.type === "button").props.onClick()
  assert.deepEqual(sent, [{ type: "modules.list" }])
  assert.match(JSON.stringify(community), /确认升档后可用/)
  assert.doesNotMatch(JSON.stringify(community), /开启/)
  const packs = fs.readFileSync(path.resolve(process.cwd(), "src/sidepanel/components/PacksPanel.tsx"), "utf8")
  assert.doesNotMatch(packs, /\["appsec", "devsec-workspace", "shell", "netsec"\]/)
  assert.match(packs, /<ShellProvisionRow/)
})

test("settings assistant navigation click sends no shell writes", async () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/sidepanel/components/SettingsIntentBar.tsx"), "utf8")
  const cells: any[] = [], calls: any[] = [], opened: string[] = [], effects: any[] = []
  let cursor = 0, effectCursor = 0
  const proposal = { id: "controlled", expiresAt: Date.now() + 300000, intent: "如何开启shell", candidates: [{ id: "first", title: "查看 shell 资格", reason: "按当前档位说明", tradeoffs: "不会自动执行", changes: [{ id: "one", settingId: "shell.provision", label: "shell 资格", before: "shell 随 enterprise 档提供。请打开「本机与工具」，确认升档。命令执行仍需单独授权。", after: "review", reason: "打开确认页", scope: "manual", section: "integrations", prerequisites: [] }] }] }
  const receipt = [{ settingId: "shell.provision", label: "shell 资格", status: "manual", message: proposal.candidates[0].changes[0].before, section: "integrations" }]
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, AbortController,
    require(id: string) {
      if (id === "react") return { useState(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = initial; return [cells[slot], (value: any) => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value }] }, useRef(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot] }, useCallback(fn: any) { return fn }, useEffect(effect: () => any, deps: any[]) { const slot = effectCursor++; const old = effects[slot]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); effects[slot] = { deps, cleanup: effect() } } } }
      if (id === "react/jsx-runtime") return jsxRuntime
      if (id === "../utils/settings-intent") return { parseSettingsIntent: () => ({ type: "unknown", reason: "no_match" }) }
      if (id === "../utils/semantic-settings") return { semanticValue: (value: unknown) => String(value), requestSemanticSettings: async (type: string) => { calls.push(type); return type.endsWith("propose") ? { proposal } : { items: receipt } } }
      if (id === "../voice/detect") return { getSpeechRecognitionCtor: () => null, VOICE_DEFAULT_LANG: "zh-CN" }
      if (id === "../ui/tokens") return { tokens: {} }
      throw Error(id)
    },
  }, { timeout: 1000 })
  const rows = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  const render = () => { cursor = 0; effectCursor = 0; return exports.SettingsIntentBar({ active: true, onIntent: () => "未使用", onOpenSection: (section: string) => opened.push(section) }) }
  const find = (ui: any, text: string) => rows(ui).find(node => node.type === "button" && String(node.props?.children || "").includes(text))
  rows(render()).find(node => node.type === "input" && node.props.type === "text").props.onChange({ target: { value: "如何开启shell" } })
  find(render(), "生成候选").props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  const confirm = find(render(), "确认提交")
  assert.ok(confirm, rows(render()).filter(node => node.type === "button").map(node => String(node.props?.children || "")).join("|"))
  confirm.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  const buttons = rows(render()).filter(node => node.type === "button").map(node => String(node.props?.children || ""))
  const open = rows(render()).find(node => node.type === "button" && String(node.props?.children || "").includes("打开对应设置"))
  assert.ok(open, buttons.join("|"))
  open.props.onClick()
  assert.deepEqual(opened, ["integrations"])
  assert.deepEqual(calls, ["settings.assistant.propose", "settings.assistant.apply"])
  assert.equal(JSON.stringify(calls).includes(FORBIDDEN.join("|")), false)
})
