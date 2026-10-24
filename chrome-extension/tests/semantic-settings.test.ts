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
