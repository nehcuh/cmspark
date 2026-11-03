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
  if (!raw.includes('/*OWNED_INPUT826_')) return raw
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let value = raw.replace(/\r\n/g, '\n')
  const digest = text => createHash('sha256').update(text).digest('hex')
  assert.equal(digest(value), initialInput826.current, 'OWNED_INPUT826_CURRENT_SOURCE')
  for (const call of initialInput826.calls) { assert.equal(value.split(call).length, 2); value = value.replace(call, '') }
  assert.equal(digest(value), profiles.native.current, 'OWNED_INPUT826_COMPLETE_OBSERVATION_SOURCE')
  return value.replace(/\n/g, eol)
}
function restoreObservation826(kind, raw) {
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
