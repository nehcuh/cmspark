import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

// Actual PersonalWorkspace/ActivityPanel/ActivityConfigEditor source, with only
// React scheduling and the app-list transport replaced by inert boundaries.
// No desktop, browser, application or user data is touched.
function harness(platform: 'win32' | 'darwin' = 'win32', separated = false) {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/sidepanel/components/personal-workspace/PersonalWorkspace.tsx'), 'utf8')
  const frames = new Map<Function, any[]>()
  let cells: any[] = [], cursor = 0
  const react = {
    useState(initial: any) { const current = cells, slot = cursor++; if (!(slot in current)) current[slot] = typeof initial === 'function' ? initial() : initial; return [current[slot], (next: any) => { current[slot] = typeof next === 'function' ? next(current[slot]) : next }] },
    useRef(initial: any) { const current = cells, slot = cursor++; if (!(slot in current)) current[slot] = { current: initial }; return current[slot] },
    useEffect() {},
  }
  const jsx = { jsx: (type: any, props: any, key: any) => ({ type, props: props || {}, key }), jsxs: (type: any, props: any, key: any) => ({ type, props: props || {}, key }), Fragment: 'fragment' }
  const appA = platform === 'darwin' ? 'com.example.chat.one' : 'win.' + 'a'.repeat(64)
  const appB = platform === 'darwin' ? 'com.example.chat.two' : 'win.' + 'b'.repeat(64)
  const appName = platform === 'darwin' ? '微信' : 'WeChat'
  const apps = separated ? [{ app_id: appA, app_name: appName }, ...Array.from({ length: 5 }, (_, i) => ({ app_id: `com.example.other${i}`, app_name: `Other ${i}` })), { app_id: appB, app_name: appName }] : [{ app_id: appA, app_name: appName }, { app_id: appB, app_name: appName }]
  const saves: any[] = []
  const controller = { snapshotCurrent: true, snapshot: { revision: 7, sources: [], runtime: { supported: true, platform, running: true, scanning: false, status: 'no_visible_allowed_window', coverage: '', platform_note: '', last_success_at: null, error: '' }, config: { enabled: true, allowed_apps: [], interval_ms: 30000, retention_days: 7, max_storage_mb: 128, ocr_ai_enabled: false, ocr_language: 'zh-Hans' } }, busy: false, loading: false, error: '', notice: '', refresh() {}, async mutate(type: string, value: any) { saves.push({ type, value }); return true } }
  const exports: any = {}
  const requireValue = (id: string) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return jsx
    if (id === '../ContextPanelHost') return { CONTEXT_PANEL_TABS: [] }
    if (id === './RecentActivitySources') return { RecentActivitySources: () => null }
    if (id === './activity-request') return { formatTaskTime: () => '—', requestActivity: async (type: string) => { assert.equal(type, 'activity.apps'); return { apps } } }
    throw Error('unexpected import: ' + id)
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, require: requireValue, AbortController, console }, { timeout: 1000 })
  const expand = (node: any): any => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const previous = cells, previousCursor = cursor
      if (!frames.has(node.type)) frames.set(node.type, [])
      cells = frames.get(node.type)!; cursor = 0
      const rendered = node.type(node.props)
      cells = previous; cursor = previousCursor
      return expand(rendered)
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children) } }
  }
  const render = (connected = true) => expand({ type: exports.PersonalWorkspace, props: { destination: 'activity', controller, connected, active: true, navigationOwner: {}, navigate() {}, openResource() {} } })
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
  const text = (node: any): string => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
  const button = (tree: any, label: string) => { const found = nodes(tree).filter(n => n.type === 'button' && text(n) === label); assert.equal(found.length, 1, label); return found[0] }
  const choices = (tree: any) => nodes(tree).filter(n => n.type === 'label' && n.props.className === 'cm-personal-check' && text(n).includes(appName))
  return { render, nodes, text, button, choices, appA, appB, saves, controller }
}

test('752 no visible allowed window explains why capture has no result', () => {
  const h = harness()
  h.controller.snapshot.config.allowed_apps = [h.appA]
  const tree = h.render()
  assert.match(h.text(tree), /未能安全完成前台窗口采集，未保存截图/, 'the real UI must explain that capture was not safely completed')
  assert.doesNotMatch(h.text(tree), /未找到可安全采集/, 'a post-capture identity change must not be described as a missing window')
})

test('752 stopped service and unchanged capture have distinct explanations', () => {
  const h = harness()
  h.controller.snapshot.runtime.running = false
  assert.match(h.text(h.render()), /采集后台当前未运行/)
  assert.doesNotMatch(h.text(h.render()), /采集已开启/)
  assert.doesNotMatch(h.text(h.render()), /未能安全完成前台窗口采集/)
  h.controller.snapshot.runtime.running = true
  h.controller.snapshot.runtime.status = 'unchanged'
  assert.match(h.text(h.render()), /截图或识别文字与已有来源重复/)
  assert.doesNotMatch(h.text(h.render()), /未能安全完成前台窗口采集/)
})

test('752 stale disconnected snapshot does not claim current capture state', () => {
  const h = harness()
  h.controller.snapshot.runtime.running = false
  assert.doesNotMatch(h.text(h.render(false)), /采集后台当前未运行/)
  h.controller.snapshot.runtime.running = true
  h.controller.snapshot.runtime.status = 'no_visible_allowed_window'
  assert.doesNotMatch(h.text(h.render(false)), /未能安全完成前台窗口采集/)
  h.controller.snapshotCurrent = false
  assert.doesNotMatch(h.text(h.render(true)), /未能安全完成前台窗口采集/)
  assert.match(h.text(h.render(true)), /采集状态待确认/)
  h.controller.snapshot.config.enabled = false
  h.controller.snapshot.runtime.error = '旧连接的错误'
  assert.match(h.text(h.render(true)), /采集状态待确认/)
  assert.doesNotMatch(h.text(h.render(true)), /采集已暂停|旧连接的错误/)
  h.controller.snapshotCurrent = true
  assert.match(h.text(h.render(true)), /采集已暂停/)
  assert.match(h.text(h.render(true)), /旧连接的错误/)
})

test('752 same-named applications remain visually distinguishable', async () => {
  const h = harness(); let tree = h.render()
  h.button(tree, '设置应用与隐私').props.onClick(); tree = h.render()
  h.button(tree, '选择正在运行的应用').props.onClick(); await new Promise<void>(resolve => setImmediate(resolve)); tree = h.render()
  const labels = h.choices(tree); assert.equal(labels.length, 2)
  assert.notEqual(h.text(labels[0]), h.text(labels[1]), 'identical application names need distinct visible labels')
})

test('752 same-named identities can be independently selected and saved', async () => {
  const h = harness(); let tree = h.render()
  h.button(tree, '设置应用与隐私').props.onClick(); tree = h.render()
  h.button(tree, '选择正在运行的应用').props.onClick(); await new Promise<void>(resolve => setImmediate(resolve)); tree = h.render()
  let labels = h.choices(tree); assert.equal(labels.length, 2)
  h.nodes(labels[0]).find(n => n.type === 'input').props.onChange({ target: { checked: true } }); tree = h.render()
  labels = h.choices(tree); assert.equal(h.nodes(labels[0]).find(n => n.type === 'input').props.checked, true); assert.equal(h.nodes(labels[1]).find(n => n.type === 'input').props.checked, false)
  h.nodes(labels[1]).find(n => n.type === 'input').props.onChange({ target: { checked: true } }); tree = h.render()
  const form = h.nodes(tree).find(n => n.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); await Promise.resolve()
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].type, 'activity.configure')
  assert.deepEqual(Array.from(h.saves[0].value.patch.allowed_apps), [h.appA, h.appB])
})

test('752 macOS same-named apps expose distinct bundle identities', async () => {
  const h = harness('darwin'); let tree = h.render()
  h.button(tree, '设置应用与隐私').props.onClick(); tree = h.render()
  h.button(tree, '选择正在运行的应用').props.onClick(); await new Promise<void>(resolve => setImmediate(resolve)); tree = h.render()
  const labels = h.choices(tree); assert.equal(labels.length, 2)
  assert.match(h.text(labels[0]), /com\.example\.chat\.one/)
  assert.match(h.text(labels[1]), /com\.example\.chat\.two/)
})

test('752 same names across pages stay distinguishable and selections persist', async () => {
  const h = harness('darwin', true); let tree = h.render()
  h.button(tree, '设置应用与隐私').props.onClick(); tree = h.render()
  h.button(tree, '选择正在运行的应用').props.onClick(); await new Promise<void>(resolve => setImmediate(resolve)); tree = h.render()
  let labels = h.choices(tree); assert.equal(labels.length, 1); assert.match(h.text(labels[0]), /com\.example\.chat\.one/)
  h.nodes(labels[0]).find(n => n.type === 'input').props.onChange({ target: { checked: true } }); tree = h.render()
  h.button(tree, '下一页').props.onClick(); tree = h.render()
  labels = h.choices(tree); assert.equal(labels.length, 1); assert.match(h.text(labels[0]), /com\.example\.chat\.two/)
  h.nodes(labels[0]).find(n => n.type === 'input').props.onChange({ target: { checked: true } }); tree = h.render()
  const form = h.nodes(tree).find(n => n.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); await Promise.resolve()
  assert.deepEqual(Array.from(h.saves[0].value.patch.allowed_apps), [h.appA, h.appB])
})
