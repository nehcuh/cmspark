import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import ts from 'typescript'

/** Real service/store/validation output; only native/provider leaves are inert. */
export async function createActivityFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-bulk-753-'))
  const root = path.resolve(process.cwd(), '../companion/src/activity')
  const modules = new Map<string, any>(), hostRequire = createRequire(path.resolve(process.cwd(), 'package.json'))
  const forbidden = () => assert.fail('unrelated native, provider, notification or background timer executed')
  const context = vm.createContext({ Buffer, process: { platform: 'linux', env: {} }, AbortController,
    setInterval: forbidden, clearInterval: forbidden, console })
  const into = (value: unknown) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context)
  function load(file: string): any {
    file = path.resolve(file)
    if (modules.has(file)) return modules.get(file)
    assert.ok(['service', 'store', 'types', 'validation', 'platform', 'image'].some(name => file === path.join(root, name + '.ts')), `unexpected source ${file}`)
    const output: any = {}; modules.set(file, output)
    const requireValue = (id: string): any => {
      if (id === '../config') return { DATA_DIR: directory }
      if (id === './adapters') return { extractActivity: forbidden, submitReminder: forbidden, MacPassiveRecorder: class { constructor() { forbidden() } } }
      if (id === '../host-use/win/powershell') return { runPs: forbidden, resolveWinScript: forbidden }
      if (id === 'node:child_process') return { execFile: forbidden }
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'))
      assert.ok(['node:fs', 'node:path', 'node:crypto', 'node:util', 'fs', 'path', 'crypto'].includes(id), `unexpected builtin ${id}`)
      return hostRequire(id)
    }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    context.exports = output; context.require = requireValue; context.__dirname = path.dirname(file)
    // Evaluate a wrapper so nested module loading cannot replace its exports/require.
    vm.runInContext('(function(exports,require,__dirname){' + code + '\n})', context, { timeout: 1000 })(output, requireValue, path.dirname(file))
    return output
  }
  try {
    const { ActivityService } = load(path.join(root, 'service.ts'))
    const service = new ActivityService({ dataDir: directory, platform: 'linux', now: () => Date.parse('2026-10-25T09:00:00Z'),
      recorder: { capture: forbidden }, extract: forbidden, notify: forbidden })
    const source = service.store.addSource(into({ app_id: 'fixture.chat.wechat', app_name: '微信', window_title: 'Synthetic group', origin: 'foreground',
      ocr_text: 'Synthetic owned task evidence', captured_at: '2026-10-25T08:00:00Z' }), Buffer.from('inert-owned-source-bytes'))
    assert.ok(source)
    const otherSource = service.store.addSource(into({ app_id: 'fixture.chat.dingtalk', app_name: '钉钉', window_title: 'Other synthetic group', origin: 'foreground',
      ocr_text: 'Other synthetic owned task evidence', captured_at: '2026-10-25T08:01:00Z' }), Buffer.from('other-inert-owned-source-bytes'))
    assert.ok(otherSource)
    const handle = async (message: Record<string, unknown>) => JSON.parse(JSON.stringify(await service.handle(into(message))))
    for (const title of ['First owned task', 'Second owned task', 'Third owned task']) {
      const reply = await handle({ type: 'todo.create', id: 'fixture-create', source_id: title.startsWith('Third') ? otherSource.id : source.id, expected_revision: service.state().revision,
        task: { title, owner: 'Fixture owner', feedback_required: true, feedback_to: 'Fixture group', due_at: '2026-10-25T10:00:43.987Z', remind_at: '2026-10-25T09:30:12.345Z' } })
      assert.equal(reply.ok, true)
    }
    for (const [index, itemSource] of [source, otherSource].entries()) service.store.addCandidates(itemSource, into([{ title: index ? 'Second candidate' : 'First candidate', owner: '', due_at: null, feedback_to: '', feedback_required: false,
      evidence: { source_id: itemSource.id, app_id: itemSource.app_id, group: 'Fixture group', sender: 'Fixture sender', message_time: '', quote: 'Synthetic candidate ' + index } }]))
    const initial = (await handle({ type: 'activity.state', id: 'fixture-state' })).state
    assert.equal(initial.todos.length, 3); assert.equal(initial.candidates.length, 2)
    assert.equal('ocr_text' in initial.sources[0], false)
    return { directory, handle, state: () => JSON.parse(JSON.stringify(service.state())), initial, todos: initial.todos, candidates: initial.candidates,
      dispose: () => fs.rmSync(directory, { recursive: true, force: true }) }
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error }
}
