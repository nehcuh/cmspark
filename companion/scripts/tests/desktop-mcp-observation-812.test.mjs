import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { desktopMcpFixture } from '../desktop-mcp-fixture.mjs'
import { desktopMcpObservationFixture } from '../desktop-mcp-observation-fixture.mjs'

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
const original = read('src/desktop/native/DesktopHost.cpp')
const fixture = read('tests/fixtures/desktop-476/native-acceptance.cpp')
const form = read('tests/fixtures/desktop-476/native-form.js')
const base = desktopMcpFixture('cpp', original, fixture, form)

test('812 observation recovers the actual complete fixture and production source', () => {
  for (const eol of ['\n', '\r\n']) {
    const body = base.source.replace(/\r?\n/g, eol)
    const obs = desktopMcpObservationFixture(body, form)
    assert.equal(obs.inverse, body)
    assert.equal(base.inverse, original)
    assert.match(obs.source, /std::atomic<unsigned> seen/)
    assert.match(obs.source, /catch\(\.\.\.\)\{\}/)
    const labels = [...new Set(obs.source.match(/D476_OBS_[A-Z0-9_]+/g))].sort()
    assert.deepEqual(labels, ['READY','NAV_000','NAV_001','NAV_010','NAV_011','NAV_100','NAV_101','NAV_110','NAV_111','DOCUMENT','CALL_OK','CALL_FAIL','CALLBACK_OK','CALLBACK_FAIL','JS_BEGIN','CLICK_ENTER','CLICK_RETURN'].map(x => 'D476_OBS_'+x).sort())
  }
})

test('812 observation refuses missing and duplicated source anchors', () => {
  const anchor = 'DESKTOP_TEST_NOTE(ready_accepted)'
  assert.throws(() => desktopMcpObservationFixture(base.source.replace(anchor, ''), form), /ANCHOR/)
  assert.throws(() => desktopMcpObservationFixture(base.source.replace(anchor, anchor + anchor), form), /ANCHOR/)
  for (const formAnchor of ['  const original=window.cmsparkDesktopReceive;', '  document.querySelector(\'[data-page="mcp.list"]\').click();']) {
    assert.equal(form.split(formAnchor).length, 2, 'fixture contains exactly one real anchor')
    assert.throws(() => desktopMcpObservationFixture(base.source, form.replace(formAnchor, '')), /MCP_OBSERVATION_FORM_ANCHOR/)
    assert.throws(() => desktopMcpObservationFixture(base.source, form.replace(formAnchor, formAnchor + formAnchor)), /MCP_OBSERVATION_FORM_ANCHOR/)
  }
})

test('812 actual form observation stays bounded and does not suppress the original click when its sink throws', () => {
  const marked = desktopMcpObservationFixture(base.source, form).form
  for (const failSink of [false, true]) {
    const ids = []; let clicks = 0
    const context = {
      documentGeneration: 'owned',
      window: { chrome: { webview: { postMessage(value) { if (failSink) throw Error('sink failed'); ids.push(value.id) } } }, cmsparkDesktopReceive() {} },
      document: { querySelector(selector) { assert.equal(selector, '[data-page="mcp.list"]'); return { click() { clicks++ } } } },
    }
    vm.runInNewContext(marked, context)
    assert.equal(clicks, 1)
    assert.deepEqual(ids, failSink ? [] : ['D476_OBS_JS_BEGIN','D476_OBS_CLICK_ENTER','D476_OBS_CLICK_RETURN'])
  }
})

test('812 builder confines the reversible variant to Windows MCP acceptance', () => {
  const builder = read('scripts/build-desktop-windows.mjs')
  assert.match(builder, /family==="mcp"\?desktopMcpObservationFixture\(mcpVariant\.source,mcpForm\)/)
  assert.match(builder, /mcpObserved\.inverse!==mcpVariant\.source/)
  const testSource = read('tests/desktop-native-mcp-476.test.ts')
  assert.match(testSource, /timeout:20000/)
  assert.match(testSource, /surfaceLease\.retain\(\)/)
  assert.match(testSource, /surfaceLease\.settled\(\)/)
})
