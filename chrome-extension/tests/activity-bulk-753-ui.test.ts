import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createActivityFixture } from './helpers/activity-bulk-753'

type Fixture = Awaited<ReturnType<typeof createActivityFixture>>
type BulkCall = { action: string; items: any[]; current: () => boolean; promise: Promise<any[]>; resolve: (results: any[]) => void }
const plain = (value: any) => JSON.parse(JSON.stringify(value))
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }

/**
 * Complete actual WorkspaceFrame -> PersonalWorkspace -> TodoPanel runs, including
 * the real reducer and registry. React scheduling/browser APIs are explicit inert
 * boundaries. The controller is a deferred observation port, not a replacement
 * bulk algorithm; request/service sequencing has its own owning test file.
 */
function uiHarness(fixture: Fixture, { full = true, initialView = 'todos' } = {}) {
  const root = path.resolve(process.cwd(), 'src/sidepanel'), at = (name: string) => path.resolve(root, name)
  const modules = new Map<string, any>(), frames = new Map<string, { cells: any[]; effects: any[] }>()
  const effects: Array<() => void> = [], listeners = new Map<string, Set<(event: any) => void>>()
  const calls: BulkCall[] = [], writes: Array<{ frame: string; value: any }> = []
  const resultWaiters: Array<() => void> = []
  let frame: { cells: any[]; effects: any[] } | undefined, frameName = '', cursor = 0, effectCursor = 0, deferEffects = false
  let store: any, state: any
  const controller: any = { snapshot: plain(fixture.initial), busy: false, loading: false, error: '', notice: '', session: { connected: true },
    refresh: () => assert.fail('unrelated state refresh invoked'), mutate: () => assert.fail('individual editor was not selected'),
    mutateBulk(action: string, items: any[], current: () => boolean) {
      const pending = deferred<any[]>(); calls.push({ action, items, current, ...pending }); return pending.promise
    },
  }
  const flush = () => { while (effects.length) effects.shift()!() }
  const react: any = {
    createContext: (value: any) => { const context: any = { current: value }; context.Provider = { context }; return context },
    useContext: (context: any) => context.current,
    useState(initial: any) {
      const owned = frame!, key = frameName, slot = cursor++
      if (!(slot in owned.cells)) owned.cells[slot] = typeof initial === 'function' ? initial() : initial
      return [owned.cells[slot], (value: any) => {
        owned.cells[slot] = typeof value === 'function' ? value(owned.cells[slot]) : value
        writes.push({ frame: key, value: owned.cells[slot] })
        if (key.startsWith('todo:') && Array.isArray(owned.cells[slot]) && owned.cells[slot].length && owned.cells[slot].every((item: any) => ['confirmed', 'unconfirmed', 'not_sent'].includes(item.status))) {
          for (const resolve of resultWaiters.splice(0)) resolve()
        }
      }]
    },
    useRef(initial: any) { const owned = frame!, slot = cursor++; if (!(slot in owned.cells)) owned.cells[slot] = { current: initial }; return owned.cells[slot] },
    useMemo(fn: any, deps: any[]) { const owned = frame!, slot = cursor++, old = owned.cells[slot]; if (!old || deps.length !== old.deps.length || deps.some((v, i) => v !== old.deps[i])) owned.cells[slot] = { deps, value: fn() }; return owned.cells[slot].value },
    useCallback(fn: any, deps: any[]) { return react.useMemo(() => fn, deps) },
    useId() { const owned = frame!, slot = cursor++; if (!(slot in owned.cells)) owned.cells[slot] = 'bulk-ui-' + slot; return owned.cells[slot] },
    useEffect(effect: () => any, deps: any[]) {
      const owned = frame!, slot = effectCursor++, old = owned.effects[slot]
      if (!old || deps.length !== old.deps.length || deps.some((value, index) => value !== old.deps[index])) {
        const next = { deps, cleanup: undefined as any }; owned.effects[slot] = next
        effects.push(() => { old?.cleanup?.(); next.cleanup = effect() })
      }
    },
  }
  const jsx = { jsx: (type: any, props: any, key: any) => ({ type, props, key }), jsxs: (type: any, props: any, key: any) => ({ type, props, key }), Fragment: 'fragment' }
  const unrelated = () => assert.fail('unrelated UI, browser, provider or native boundary executed')
  const browserWindow = {
    location: { pathname: full ? '/tabs/workspace.html' : '/sidepanel.html', search: '?view=' + initialView },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener(name: string, fn: any) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn) },
    removeEventListener(name: string, fn: any) { listeners.get(name)?.delete(fn) },
    dispatchEvent(event: any) { for (const fn of listeners.get(event.type) || []) fn(event); return true },
  }
  class CustomEventValue { type: string; detail: any; constructor(type: string, options?: any) { this.type = type; this.detail = options?.detail } }
  const leafNames = new Set(['KnowledgeSubPanel', 'McpPanel', 'AppsPanel', 'PacksPanel', 'BoardPanel', 'MeetingPanel', 'ProjectPanel', 'personal-workspace/RecentActivitySources'])
  function load(file: string): any {
    file = path.resolve(file)
    if (modules.has(file)) return modules.get(file)
    const exports: any = {}; modules.set(file, exports)
    const source = fs.readFileSync(file === at('components/personal-workspace/PersonalWorkspace.tsx') && process.env.ACTIVITY_752_OLD_PERSONAL ? process.env.ACTIVITY_752_OLD_PERSONAL : file, 'utf8')
    const requireValue = (id: string): any => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return jsx
      assert.ok(id.startsWith('.'), `unexpected UI dependency ${id}`)
      const target = path.resolve(path.dirname(file), id)
      if (target === at('store/agentStore') && store) return { ...store, useAgentStore: () => ({ state, dispatch: (action: any) => { state = store.agentReducer(state, action) } }) }
      if (target === at('components/personal-workspace/useActivity')) return { useActivity: () => controller }
      if (target === at('components/ThreadList')) return { createBlankThread: unrelated }
      for (const name of leafNames) if (target === at('components/' + name)) return { [path.basename(name)]: unrelated }
      const actual = [target + '.ts', target + '.tsx', target + '/index.ts', target + '/index.tsx'].find(candidate => fs.existsSync(candidate))
      assert.ok(actual, `missing actual UI dependency ${id}`)
      const result = load(actual!)
      if (target === at('components/ContextPanelHost')) return { ...result, useContextPanelHost: () => ({ openPanelForce: unrelated, closePanel: unrelated, activePanel: null }) }
      return result
    }
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    vm.runInNewContext(code, { exports, require: requireValue, window: browserWindow,
      document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} },
      chrome: { runtime: { getURL: unrelated, sendMessage: unrelated }, tabs: { create: unrelated, query: unrelated } },
      CustomEvent: CustomEventValue, URLSearchParams, AbortController, console,
    }, { timeout: 1000, filename: file })
    return exports
  }
  store = load(at('store/agentStore.tsx'))
  state = { ...store.initialState, connectionState: 'connected', activeThreadId: 'bulk-owner-a' }
  const workspace = load(at('components/WorkspaceFrame.tsx')), personal = load(at('components/personal-workspace/PersonalWorkspace.tsx'))
  const rows = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(rows) : [node, ...rows(node.props?.children)]
  const text = (node: any): string => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
  const find = (ui: any, predicate: (node: any) => boolean) => { const found = rows(ui).filter(predicate); assert.equal(found.length, 1); return found[0] }
  const renderComponent = (key: string, fn: any, props: any) => {
    if (!frames.has(key)) frames.set(key, { cells: [], effects: [] })
    frame = frames.get(key); frameName = key; cursor = 0; effectCursor = 0
    const ui = fn(props); frame = undefined; frameName = ''
    if (!deferEffects) flush()
    return ui
  }
  const render = (destination = 'todos') => {
    const rootUI = renderComponent('workspace', workspace.WorkspaceFrame, { children: null })
    const child = rows(rootUI).find(node => node.type === personal.PersonalWorkspace && node.props.destination === destination)
    if (!child) return { root: rootUI, personal: null, panel: null }
    const personalUI = renderComponent('personal:' + destination, personal.PersonalWorkspace, child.props)
    const todo = find(personalUI, node => typeof node.type === 'function' && node.type.name === 'TodoPanel')
    const panel = renderComponent('todo:' + destination, todo.type, todo.props)
    return { root: rootUI, personal: personalUI, panel }
  }
  const button = (ui: any, title: string) => find(ui, node => node.type === 'button' && text(node) === title)
  const box = (ui: any, kind: 'todo' | 'candidate', item: any) => find(ui, node => node.type === 'input' && node.props['aria-label'] === `选择${kind === 'todo' ? '待办' : '候选'}：${item.title}`)
  const select = (item: any, kind: 'todo' | 'candidate' = 'todo') => { const checkbox = box(render().panel, kind, item); assert.equal(checkbox.props.disabled, false); checkbox.props.onChange(); return render().panel }
  const begin = (title = '记录所选已处理') => {
    let panel = render().panel; const action = button(panel, title); assert.equal(action.props.disabled, false); action.props.onClick(); panel = render().panel
    const confirmation = button(panel, '确认逐项保存'); assert.equal(confirmation.props.disabled, false); confirmation.props.onClick()
    assert.ok(calls.length); return calls[calls.length - 1]
  }
  const navigate = (destination: string) => { const ui = render().root; const nav = find(ui, node => typeof node.type === 'function' && node.type.name === 'WorkspaceNavigation'); nav.props.onView(destination) }
  render(); render()
  return {
    controller, calls, writes, rows, text, find, render, button, box, select, begin, navigate,
    setState(patch: any) { state = { ...state, ...patch } },
    state: () => state,
    defer() { deferEffects = true }, flush() { deferEffects = false; flush() },
    selectionABA() { const id = state.activeThreadId, revision = state.activeThreadSelectionRevision; state = store.agentReducer(state, { type: 'SET_ACTIVE_THREAD', threadId: 'bulk-owner-b' }); state = store.agentReducer(state, { type: 'SET_ACTIVE_THREAD', threadId: id }); assert.equal(state.activeThreadId, id); assert.equal(state.activeThreadSelectionRevision, revision + 2) },
    async settle(call: BulkCall, results: any[]) { const saved = deferred<void>(); resultWaiters.push(() => saved.resolve()); call.resolve(results); await saved.promise },
    unmount() { for (const owned of frames.values()) for (const effect of owned.effects) effect?.cleanup?.() },
    async dispose() { this.unmount(); for (const call of calls) call.resolve(call.items.map(item => ({ ...item, status: 'not_sent', message: 'Controlled UI port disposed' }))); await Promise.all(calls.map(call => call.promise)) },
  }
}

async function withUI(run: (fixture: Fixture, ui: ReturnType<typeof uiHarness>) => Promise<void>) {
  const fixture = await createActivityFixture(); let ui: ReturnType<typeof uiHarness> | undefined
  try { ui = uiHarness(fixture); await run(fixture, ui) } finally { if (ui) await ui.dispose(); fixture.dispose() }
}

test('753 actual full-page rows select explicit identities with sibling controls and preserve filtered selection preview', async () => withUI(async (fixture, ui) => {
  let panel = ui.render().panel
  const firstBox = ui.box(panel, 'todo', fixture.todos[0])
  const parent = ui.find(panel, node => node.type === 'div' && Array.isArray(node.props.children) && node.props.children.includes(firstBox))
  assert.equal(parent.props.className, 'cm-personal-selectable')
  assert.equal(parent.props.children.some((node: any) => node?.type === 'button'), true)
  for (const button of ui.rows(panel).filter(node => node.type === 'button')) assert.equal(ui.rows(button).some(node => node.type === 'input'), false)
  ui.select(fixture.todos[0]); panel = ui.select(fixture.todos[1])
  assert.equal(ui.calls.length, 0); assert.ok(ui.text(panel).includes('已选择 2 项'))
  ui.find(panel, node => node.props?.['aria-label'] === '搜索待办及来源').props.onChange({ target: { value: 'no-row-matches-this' } })
  panel = ui.render().panel
  assert.equal(ui.rows(panel).filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 0)
  const preview = ui.find(panel, node => node.type === 'details' && ui.text(node).includes('核对所选'))
  for (const item of fixture.todos.slice(0, 2)) assert.ok(ui.text(preview).includes(item.title))
  assert.ok(ui.text(preview).includes('包含当前筛选外的选择')); assert.equal(ui.calls.length, 0)
  const call = ui.begin(); assert.equal(call.action, 'handling_done')
  assert.deepEqual(plain(call.items), fixture.todos.slice(0, 2).map((item: any) => ({ kind: 'todo', id: item.id, revision: item.revision, title: item.title })))
  assert.equal(call.current(), true)
}))

test('753 actual Today and sidebar do not expose bulk processing controls', async () => {
  const fixture = await createActivityFixture(); let today: ReturnType<typeof uiHarness> | undefined, sidebar: ReturnType<typeof uiHarness> | undefined
  try {
    today = uiHarness(fixture, { initialView: 'today' }); sidebar = uiHarness(fixture, { full: false })
    const panel = today.render('today').panel
    assert.equal(today.rows(panel).some(node => node.props?.['aria-label'] === '批量整理个人事项'), false)
    assert.equal(today.rows(panel).filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 0)
    const side = sidebar.render()
    assert.equal(side.panel, null); assert.equal(side.personal, null)
    assert.equal(sidebar.rows(side.root).some(node => node.props?.['aria-label'] === '批量整理个人事项'), false)
    assert.equal(today.calls.length, 0); assert.equal(sidebar.calls.length, 0)
  } finally { if (today) await today.dispose(); if (sidebar) await sidebar.dispose(); fixture.dispose() }
})

test('753 actual bulk actions distinguish handled feedback and candidate dismissal without confirming unknown owners', async () => withUI(async (fixture, ui) => {
  ui.select(fixture.todos[0])
  ui.button(ui.render().panel, '记录所选已处理').props.onClick()
  assert.ok(ui.text(ui.render().panel).includes('需要反馈的事项仍保持待反馈'))
  ui.button(ui.render().panel, '取消').props.onClick(); assert.equal(ui.calls.length, 0)
  const feedback = ui.begin('记录所选已反馈')
  assert.equal(feedback.action, 'feedback_done'); assert.equal(feedback.items[0].id, fixture.todos[0].id)
  assert.ok(ui.text(ui.render().panel).includes('不会向来源聊天发送消息'))
  await ui.settle(feedback, feedback.items.map(item => ({ ...item, status: 'not_sent', message: 'Controlled UI boundary' })))
  ui.button(ui.render().panel, '清除选择').props.onClick()
  ui.find(ui.render().panel, node => node.type === 'button' && ui.text(node).startsWith('待整理 ')).props.onClick()
  assert.equal(fixture.candidates.every((item: any) => item.owner === ''), true)
  ui.select(fixture.candidates[0], 'candidate'); ui.select(fixture.candidates[1], 'candidate')
  let panel = ui.render().panel
  assert.equal(ui.rows(panel).some(node => node.type === 'button' && /记录所选已处理|记录所选已反馈/.test(ui.text(node))), false)
  ui.button(panel, '忽略所选候选').props.onClick(); panel = ui.render().panel
  assert.ok(ui.text(panel).includes('来源记录保留'))
  ui.button(panel, '确认逐项保存').props.onClick()
  const dismiss = ui.calls[1]; assert.equal(dismiss.action, 'dismiss')
  assert.deepEqual(plain(dismiss.items).map((item: any) => item.id), fixture.candidates.map((item: any) => item.id))
  assert.equal(ui.calls.some(call => /confirm|create|remind/.test(call.action)), false)
  assert.equal(fixture.state().todos.length, 3); assert.equal(fixture.state().candidates.every((item: any) => item.status === 'pending'), true)
}))

test('753 actual mounted TodoPanel cancels continuation on hidden view safety priority selection ABA and unmount', async () => {
  for (const mode of ['hidden', 'security', 'computer', 'settings', 'selection-aba', 'unmount']) await withUI(async (fixture, ui) => {
    ui.select(fixture.todos[0]); const call = ui.begin(); assert.equal(call.current(), true)
    ui.defer()
    if (mode === 'hidden') ui.navigate('chat')
    if (mode === 'security') ui.setState({ pendingSecurityConfirmations: [{ id: 'controlled-UI-only-blocker' }] })
    if (mode === 'computer') ui.setState({ computerTask: { status: 'running' } })
    if (mode === 'settings') ui.setState({ settingsOpen: true })
    if (mode === 'selection-aba') ui.selectionABA()
    if (mode === 'unmount') ui.unmount(); else ui.render()
    assert.equal(call.current(), false, mode)
    ui.flush()
    assert.equal(call.current(), false, mode)
  })
})

test('753 actual clear and changed list invalidate continuation while expired item selection remains visible until explicit clear', async () => withUI(async (fixture, ui) => {
  ui.select(fixture.todos[0]); const call = ui.begin(); assert.equal(call.current(), true)
  ui.button(ui.render().panel, '清除选择').props.onClick(); ui.render(); assert.equal(call.current(), false)
  await ui.settle(call, call.items.map(item => ({ ...item, status: 'not_sent', message: 'Selection cleared at controlled UI port' })))
  ui.select(fixture.todos[1]); const filtered = ui.begin()
  ui.find(ui.render().panel, node => node.props?.['aria-label'] === '搜索待办及来源').props.onChange({ target: { value: 'retained-selection' } })
  ui.render(); assert.equal(filtered.current(), false)
  await ui.settle(filtered, filtered.items.map(item => ({ ...item, status: 'not_sent', message: 'List changed at controlled UI port' })))
  ui.button(ui.render().panel, '清除选择').props.onClick()
  ui.find(ui.render().panel, node => node.props?.['aria-label'] === '搜索待办及来源').props.onChange({ target: { value: '' } })
  ui.select(fixture.todos[2])
  const changed = await fixture.handle({ type: 'todo.update', id: 'ui-source-stale', todo_id: fixture.todos[2].id, expected_revision: fixture.todos[2].revision, patch: { handling_status: 'done' } })
  assert.equal(changed.ok, true); ui.controller.snapshot = changed.state
  const panel = ui.render().panel
  assert.ok(ui.text(panel).includes('选择中的事项或连接已有变化'))
  assert.ok(ui.text(panel).includes(fixture.todos[2].title))
  assert.equal(ui.button(panel, '记录所选已处理').props.disabled, true)
  ui.button(panel, '清除选择').props.onClick()
  assert.ok(ui.text(ui.render().panel).includes('已选择 0 项'))
}))

test('753 actual UI retains distinct per-item results and the original selection without automatic resubmission', async () => withUI(async (fixture, ui) => {
  for (const todo of fixture.todos) ui.select(todo)
  const call = ui.begin()
  // Real service creates the acknowledged persisted item. Remaining statuses are
  // controlled UI-port outcomes, not fabricated service replies or native proof.
  const reply = await fixture.handle({ type: 'todo.update', id: 'ui-confirmed-source', todo_id: call.items[0].id, expected_revision: call.items[0].revision, patch: { handling_status: 'done' } })
  assert.equal(reply.ok, true)
  const saved = reply.state.todos.find((item: any) => item.id === call.items[0].id)
  assert.equal(saved.revision, call.items[0].revision + 1); assert.equal(saved.handling_status, 'done')
  ui.controller.snapshot = reply.state
  const outcomes = call.items.map((item: any, index: number) => ({ ...item, status: index === 0 ? 'confirmed' : index === 1 ? 'unconfirmed' : 'not_sent', message: ['后台已确认保存', '已发送但回执未确认', '未发送'][index] }))
  await ui.settle(call, outcomes)
  const panel = ui.render().panel, text = ui.text(panel)
  assert.ok(text.includes('后台确认 1 项，未确认 1 项，未发送 1 项'))
  assert.ok(text.includes('选择保留，不会自动重试'))
  assert.ok(text.includes('已选择 3 项'))
  for (const todo of fixture.todos) assert.ok(text.includes(todo.title))
  assert.equal(ui.calls.length, 1); assert.equal(ui.controller.snapshot.revision, reply.state.revision)
  assert.ok(text.includes('选择中的事项或连接已有变化'))
}))


test('752 actual real-source APP search retains only matching todos and pending candidates', async () => withUI(async (fixture, ui) => {
  const sources = fixture.initial.sources
  assert.equal(sources.length, 2)
  for (const source of sources) for (const query of [source.app_name, source.app_id]) {
    let panel = ui.render().panel
    ui.find(panel, node => node.props?.['aria-label'] === '搜索待办及来源').props.onChange({ target: { value: query } })
    panel = ui.render().panel
    const selected = ui.rows(panel).filter(node => node.props?.className === 'cm-personal-row-title').map(node => ui.text(node))
    const expected = fixture.todos.filter((todo: any) => todo.evidence.app_id === source.app_id).map((todo: any) => todo.title)
    assert.ok(expected.length > 0); assert.deepEqual(selected.sort(), expected.sort())
    ui.find(panel, node => node.type === 'button' && ui.text(node).startsWith('待整理 ')).props.onClick()
    panel = ui.render().panel
    const candidates = ui.rows(panel).filter(node => node.props?.className === 'cm-personal-row-title').map(node => ui.text(node))
    const expectedCandidates = fixture.candidates.filter((candidate: any) => candidate.evidence.app_id === source.app_id).map((candidate: any) => candidate.title)
    assert.ok(expectedCandidates.length > 0); assert.deepEqual(candidates.sort(), expectedCandidates.sort())
    ui.button(panel, '全部待处理').props.onClick()
  }
  assert.equal(ui.calls.length, 0)
}))
