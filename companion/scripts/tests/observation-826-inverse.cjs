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
    "current": "46f4bb51b67c339ad605142b9ad9177b3c119d1a2bb67126ad3a52b515ba4c03",
    "prior": "46d852529cfbb6016484b8680d534549303d9c88e0083ffa83d9071b18886e16",
    "blocks": 5
  }
}
function restoreObservation826(kind, raw) {
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
module.exports = { restoreObservation826 }
