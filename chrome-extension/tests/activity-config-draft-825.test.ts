import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { Buffer } from 'node:buffer'
import ts from 'typescript'
import { forwardWorkspaceRequest } from '../src/background/workspace-sender'

const plain = (value: any) => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let turn = 0; turn < 16; turn++) await Promise.resolve() }
const root = process.cwd()

function exportedModule(source: string, file: string, requireValue = createRequire(file)): any {
  const output: any = {}
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext('(function(exports,require){' + code + '\n})', { process, console, Buffer, URL, URLSearchParams, AbortController, crypto: globalThis.crypto, setTimeout, clearTimeout }, { filename: file })(output, requireValue)
  return output
}

/** Reuse the real WorkspaceFrame/PersonalWorkspace renderer without registering
 * its older tests. Only Chrome delivery and model/native leaves are controlled;
 * no copy of submit, revision checks, RPC matching, service or store logic. */
function loadHarness() {
  const fixtureFile = path.join(root, 'tests/helpers/activity-bulk-753.ts')
  let fixtureSource = fs.readFileSync(fixtureFile, 'utf8')
  fixtureSource = fixtureSource.replace('  const forbidden = () =>', '  const models = { llm: {}, computer: {}, vision: { base_url: "https://owned.invalid/v1", model_name: "owned-vl", api_key: "owned-fixture-only" } };\n  const forbidden = () =>')
    .replace('getConfig: () => ({ llm: {}, computer: {} })', 'getConfig: () => models')
    .replace('return { directory, handle, state:', 'return { service, into, models, directory, handle, state:')
  const fixtureModule = exportedModule(fixtureSource, fixtureFile)
  const uiFile = path.join(root, 'tests/activity-bulk-753-ui.test.ts')
  let uiSource = fs.readFileSync(uiFile, 'utf8')
  uiSource = uiSource.replace('  const configurationCalls:', '  const stateRequests: any[] = [];\n  const configurationCalls:')
    .replace('        sendMessage: (message: any) => {', "        sendMessage: (message: any) => {\n          if (message.type === 'activity.state') { stateRequests.push(message); return Promise.resolve({ ok: true }) }")
    .replace('    controller, calls, configurationCalls,', '    stateRequests, deliver(message: any) { for (const listener of [...chromeListeners]) listener(message) }, controller, calls, configurationCalls,')
  const realRequire = createRequire(uiFile)
  const uiModule = exportedModule(uiSource + '\nexport { uiHarness };', uiFile, (id: string) => id === 'node:test' ? () => {} : id === './helpers/activity-bulk-753' ? fixtureModule : realRequire(id))
  return { createFixture: fixtureModule.createActivityFixture, uiHarness: uiModule.uiHarness }
}
const harness = loadHarness()
const recorded = JSON.parse(fs.readFileSync(path.resolve(root, '../companion/tests/fixtures/activity-scope825.json'), 'utf8'))
const scopes = recorded.configured.state.config.chat_scopes, appId = scopes[0].app_id

async function setup(platform = 'win32') {
  const fixture = await harness.createFixture()
  const chosenApp = platform === 'darwin' ? 'com.example.OwnedChat' : platform === 'linux' ? 'linux.' + 'a'.repeat(64) : appId
  const chosenScopes = scopes.map((scope: any) => ({ ...scope, app_id: chosenApp }))
  const reply = await fixture.handle({ type: 'activity.configure', expected_revision: fixture.state().revision, patch: { allowed_apps: [chosenApp] } })
  assert.equal(reply.ok, true)
  fixture.initial = reply.state
  // UI platform projection only; the real service/store still run without any
  // OS capture, timers, models or native calls in this test.
  fixture.initial.runtime = { ...fixture.initial.runtime, platform, supported: true, chat_scope_supported: platform === 'win32' ? undefined : true }
  const ui = harness.uiHarness(fixture, { initialView: 'activity', allowConfigure: true })
  const render = () => ui.render('activity').panel
  ui.button(render(), '设置应用与隐私').props.onClick()
  const scopeNode = () => ui.find(render(), (node: any) => typeof node.type === 'function' && node.type.name === 'ChatScopeEditor')
  scopeNode().props.onChange(plain(chosenScopes))
  let sourceNumber = 0
  const addSource = () => fixture.service.store.addSource(fixture.into({ app_id: appId, app_name: 'Owned chat', window_title: 'Owned source', origin: 'foreground', ocr_text: 'Owned source ' + ++sourceNumber, captured_at: '2026-11-02T09:00:00Z' }), Buffer.from('owned-source-' + sourceNumber))
  const submit = () => ui.find(render(), (node: any) => node.type === 'form').props.onSubmit({ preventDefault() {} })
  const serviceRead = async (request: any) => {
    let pending: Promise<any> | undefined
    const ack = forwardWorkspaceRequest(request, { id: 'owned', url: 'chrome-extension://owned/tabs/workspace.html', frameId: 0 }, 'owned', {
      getState: () => 'connected', send(frame) { pending = fixture.handle(frame); return true },
    })
    assert.equal(ack.ok, true)
    return pending!
  }
  const fresh = async (request = ui.stateRequests.at(-1)) => {
    assert.ok(request, 'submit must use the real activity.state RPC')
    const result = await serviceRead(request)
    ui.deliver(result)
    await flush()
    return result
  }
  return { fixture, ui, render, scopeNode, submit, fresh, serviceRead, addSource, chosenScopes,
    assertDraft() { assert.equal(JSON.stringify(plain(scopeNode().props.scopes)), JSON.stringify(chosenScopes)) },
    async dispose() { await ui.dispose(); await fixture.service.stop(); fixture.dispose() } }
}

test('825 source-only refresh preserves scope draft bytes and saves using the fresh Service revision', async () => {
  const f = await setup()
  try {
    const opened = f.fixture.state(), expectedBytes = JSON.stringify(scopes)
    f.addSource()
    const sourceState = f.fixture.state()
    assert.ok(sourceState.revision > opened.revision)
    assert.deepEqual(sourceState.config, opened.config)
    f.ui.controller.snapshot = { ...sourceState, runtime: { ...sourceState.runtime, platform: 'win32', supported: true, chat_scope_supported: undefined } }
    f.assertDraft()
    assert.equal(f.ui.configurationCalls.length, 0)
    f.submit()
    assert.equal(f.ui.stateRequests.length, 1)
    const reply = await f.fresh()
    assert.equal(f.ui.configurationCalls.length, 1, f.ui.text(f.render()))
    const call = f.ui.configurationCalls[0]
    assert.equal(call.payload.expected_revision, reply.state.revision)
    assert.equal((await call.promise).ok, true)
    assert.equal(JSON.stringify(call.payload.patch.chat_scopes), expectedBytes)
    assert.equal(JSON.stringify(f.fixture.state().config.chat_scopes), expectedBytes)
  } finally { await f.dispose() }
})

for (const platform of ['darwin', 'linux']) {
  test(`work center saves the chat scope on ${platform} when Companion advertises support`, async () => {
    const f = await setup(platform)
    try {
      f.assertDraft()
      f.submit()
      await f.fresh()
      assert.equal(f.ui.configurationCalls.length, 1)
      assert.equal((await f.ui.configurationCalls[0].promise).ok, true)
      assert.deepEqual(plain(f.fixture.state().config.chat_scopes), f.chosenScopes)
    } finally { await f.dispose() }
  })
}

test('825 changed live config or model identity rejects before any configuration, retaining scope draft', async () => {
  for (const changed of ['config', 'model'] as const) for (const refreshed of [false, true]) {
    const f = await setup()
    try {
      if (changed === 'config') {
        const result = await f.fixture.handle({ type: 'activity.configure', expected_revision: f.fixture.state().revision, patch: { interval_ms: 60000 } })
        assert.equal(result.ok, true)
      } else {
        const before = f.fixture.state()
        f.fixture.models.vision.api_key = 'changed-owned-fixture-only'
        assert.deepEqual(f.fixture.state().config, before.config)
        assert.ok(f.fixture.state().runtime.model_target_ids.vision !== before.runtime.model_target_ids.vision)
      }
      if (refreshed) { const state = f.fixture.state(); f.ui.controller.snapshot = { ...state, runtime: { ...state.runtime, platform: 'win32', supported: true, chat_scope_supported: undefined } } }
      f.submit()
      if (!refreshed) await f.fresh()
      else assert.equal(f.ui.stateRequests.length, 0)
      assert.equal(f.ui.configurationCalls.length, 0)
      f.assertDraft()
      assert.ok(f.ui.text(f.render()).includes('草稿保留'), `${changed}/${refreshed}: ${f.ui.text(f.render())}`)
    } finally { await f.dispose() }
  }
})

test('825 failed read or mismatched late response cannot configure or clear scope draft', async () => {
  for (const failure of ['backend-error', 'wrong-id'] as const) {
    const f = await setup()
    try {
      f.submit()
      const request = f.ui.stateRequests[0]
      if (failure === 'backend-error') {
        f.ui.deliver({ type: 'activity.result', id: request.id, ok: false, error: 'Owned read failure' })
        await flush()
        await f.fresh(request) // A late successful response after failure remains ignored.
        assert.ok(f.ui.text(f.render()).includes('Owned read failure'))
      } else {
        const reply = await f.serviceRead(request)
        f.ui.deliver({ ...reply, id: 'unrelated-owned-request' })
        await flush()
      }
      assert.equal(f.ui.configurationCalls.length, 0)
      f.assertDraft()
    } finally { await f.dispose() }
  }
})

test('825 unmount, connection peer change and busy transition abort the pending fresh read', async () => {
  for (const change of ['unmount', 'disconnected', 'connecting', 'busy'] as const) {
    const f = await setup()
    try {
      f.submit()
      const request = f.ui.stateRequests[0]
      if (change === 'unmount') f.ui.unmount()
      else if (change === 'busy') { f.ui.controller.busy = true; f.render() }
      else f.ui.deliver({ type: 'thread.mutation.connection', state: change })
      await f.fresh(request)
      assert.equal(f.ui.configurationCalls.length, 0)
      if (change !== 'unmount') f.assertDraft()
    } finally { await f.dispose() }
  }
})

test('825 double submit starts one fresh read and one configuration', async () => {
  const f = await setup()
  try {
    const form = f.ui.find(f.render(), (node: any) => node.type === 'form')
    form.props.onSubmit({ preventDefault() {} })
    form.props.onSubmit({ preventDefault() {} })
    assert.equal(f.ui.stateRequests.length, 1)
    await f.fresh()
    assert.equal(f.ui.configurationCalls.length, 1)
    assert.equal((await f.ui.configurationCalls[0].promise).ok, true)
  } finally { await f.dispose() }
})

test('825 source write after fresh read remains an atomic revision conflict and retains scope draft without retry', async () => {
  const f = await setup()
  try {
    f.submit()
    const request = f.ui.stateRequests[0], read = await f.serviceRead(request)
    f.addSource() // Supported source write between state response and configure.
    f.ui.deliver(read)
    await flush()
    assert.equal(f.ui.configurationCalls.length, 1)
    const call = f.ui.configurationCalls[0], reply = await call.promise
    assert.equal(call.payload.expected_revision, read.state.revision)
    assert.equal(reply.ok, false)
    assert.equal(reply.error_code, 'REVISION_CONFLICT')
    assert.equal(f.fixture.state().config.chat_scopes, undefined)
    f.assertDraft()
    await flush()
    assert.equal(f.ui.stateRequests.length, 1)
    assert.equal(f.ui.configurationCalls.length, 1)
  } finally { await f.dispose() }
})
