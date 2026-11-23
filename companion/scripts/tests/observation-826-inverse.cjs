/** Source lineage only; never normalize runtime evidence. */
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const profiles = {
  "helper": {
    "current": "80b4d54471bb1007bb237c8236846b8bb84db86c88c96df4f163686cb215aa7e",
    "prior": "8e5dad707a9c66cb98bb53bc03562d3cb1dd31e7bb5b2ac524c935d5788704c0",
    "blocks": 16
  },
  "native": {
    "current": "08dcaea7cc828719ea144c2b42129d90919f8693854782db683bddb0deca0ab0",
    "prior": "46d852529cfbb6016484b8680d534549303d9c88e0083ffa83d9071b18886e16",
    "blocks": 9
  }
}
// This pair is behavioral initial-input admission, not observation. Its exact
// whole-source hash and two-call inverse precede the independent OBS layer.
const initialInput826 = {
  current: '9e80020deed6f46ede58481ecbd2e631c796b0cc653995ad1f6bdbfa9d2cbabe',
  calls: ['LOCAL', 'ARCHIVE'].map(role => `/*OWNED_INPUT826_${role}*/if(process.platform==='win32')hostedTerminalHost705();`),
}
const initialFixture826 = { current: 'b47fbcf511cde13a2072dc345bba95379ef50a8cad14d9f570554b50c378ca1e', prior: '50abdc4f2b30c8d19049448e2897ff9b973171b1a9eeb7b3e67b804021a32531' }
function restoreInitialFixture826(raw) {
  if (!raw.includes('/*OWNED_INPUT826_IMPORT_') && !raw.includes('/*OWNED_INPUT826_GENERATOR_')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const digest = text => createHash('sha256').update(text).digest('hex')
  let value = raw.replace(/\r\n/g, '\n')
  assert.equal(digest(value), initialFixture826.current, 'OWNED_INPUT826_GENERATOR_CURRENT')
  for (const kind of ['IMPORT', 'GENERATOR']) {
    assert.equal(value.split(`/*OWNED_INPUT826_${kind}_BEGIN*/`).length, 2)
    value = value.replace(new RegExp(`/\\*OWNED_INPUT826_${kind}_BEGIN\\*/[\\s\\S]*?/\\*OWNED_INPUT826_${kind}_END\\*/`), '')
  }
  const call = 'desktopOwnedCaptionSetup826(eol) + parts[0]'
  assert.equal(value.split(call).length, 2); value = value.replace(call, 'parts[0]')
  assert.equal(digest(value), initialFixture826.prior, 'OWNED_INPUT826_COMPLETE_PRIOR_GENERATOR')
  return value.replace(/\n/g, eol)
}
function restoreInitialOwnedInput826(raw) {
  raw = restoreWorkspaceTeardown(raw)
  if (!raw.includes('/*OWNED_INPUT826_')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  const digest = text => createHash('sha256').update(text).digest('hex')
  assert.equal(digest(value), initialInput826.current, 'OWNED_INPUT826_CURRENT_SOURCE')
  for (const call of initialInput826.calls) { assert.equal(value.split(call).length, 2); value = value.replace(call, '') }
  assert.equal(digest(value), profiles.native.current, 'OWNED_INPUT826_COMPLETE_OBSERVATION_SOURCE')
  return value.replace(/\n/g, eol)
}
function restoreWorkspaceTeardown(raw) {
  const begin = '/*WORKSPACE_TEARDOWN_BEGIN*/'
  const end = '/*WORKSPACE_TEARDOWN_END*/'
  if (!raw.includes(begin) && !raw.includes(end) && !raw.includes('/*WORKSPACE_PATH_')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const prior = [
    '',
    "path.join(os.tmpdir(),'native-workspace-476-')",
    '',
    "channel.revokeHost('owned-native-workspace-476')",
    "   assertionSite=2;assert.equal(await Promise.race([exit,failure.then(()=>{throw Error('OWNED_WORKSPACE_NATIVE_PHASE_FAILED')}),new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_WORKSPACE_NATIVE_DEADLINE')),{once:true}))]),0)\n" +
      "   if(uiDone){assertionSite=3;assert.equal((await uiDone).ok,true,'owned acknowledged UI runner must genuinely close quiescent')}\n",
  ]
  const expected = [
    'b3e1fe725ead3d85bbac31098e11a7f812225adef249057cb96a0c6afd2ae48c',
    'b7c8757243f1cfee628940985e85dc8c4685385308f9c8f449cee3d0b218087f',
    'a33b28d44008d5640275965fd0ec6c79cb7f576d8b3e2ffc1371f67514c469d9',
    'dc7d55f881406a8bdaba8faad2c64bb67b8f429e8d3e4cd99ab0db4557ece876',
    'f96c612701d79f67300252ff592753e06e9c7a5547f83be4efbaf17f87121b9b',
  ]
  let restored = 0
  const value = raw.replace(/\/\*WORKSPACE_(TEARDOWN|PATH)_BEGIN\*\/[\s\S]*?\/\*WORKSPACE_\1_END\*\//g, block => {
    const digest = createHash('sha256').update(block.replace(/\r\n/g, '\n')).digest('hex')
    assert.equal(digest, expected[restored], 'WORKSPACE_TEARDOWN_SOURCE')
    return prior[restored++].replace(/\n/g, eol)
  })
  assert.equal(restored, prior.length)
  return value
}

function restoreObservation826(kind, raw) {
  raw = require('./workspace-query-101-inverse.cjs').restoreWorkspaceQuery101(kind, raw)
  if (kind === 'native') raw = restoreInitialOwnedInput826(raw)
  if (!raw.includes('/*OBS826_')) return raw
  assert.ok(Object.hasOwn(profiles, kind), 'OBS826_SOURCE_KIND')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n', value = raw.replace(/\r\n/g, '\n'), profile = profiles[kind]
  const digest = value => createHash('sha256').update(value).digest('hex')
  assert.equal(digest(value), profile.current, 'OBS826_CURRENT_SOURCE')
  assert.equal(value.split('/*OBS826_BEGIN*/').length - 1, profile.blocks)
  assert.equal(value.split('/*OBS826_END*/').length - 1, profile.blocks)
  const prior = value.replace(/\/\*OBS826_BEGIN\*\/[\s\S]*?\/\*OBS826_END\*\//g, '')
  assert.equal(digest(prior), profile.prior, 'OBS826_COMPLETE_PRIOR_SOURCE')
  return prior.replace(/\n/g, eol)
}
module.exports = { restoreObservation826, restoreInitialOwnedInput826, restoreInitialFixture826 }
