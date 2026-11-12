/** Source lineage only: never normalize compiled code or runtime evidence. */
'use strict'
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const profiles = {
  "ui": {
    "current": "2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8",
    "prior": "1b4837f6ce7945273d0a1ead0542712503191a422f36b8a743a9622aab89c37a",
    "marker": "let w=windows.firstMatch",
    "pairs": [
      [
        "let w=windows.firstMatch",
        "let w=windows.element"
      ],
      [
        "w.sheets.firstMatch.waitForExistence",
        "w.sheets.element.waitForExistence"
      ],
      [
        "return w.sheets.firstMatch",
        "return w.sheets.element"
      ]
    ]
  },
  "helper": {
    "current": "56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5",
    "prior": "80b4d54471bb1007bb237c8236846b8bb84db86c88c96df4f163686cb215aa7e",
    "marker": "2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8",
    "pairs": [
      [
        "2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8",
        "1b4837f6ce7945273d0a1ead0542712503191a422f36b8a743a9622aab89c37a"
      ]
    ]
  }
}
exports.restoreWorkspaceQuery101 = (kind, raw) => {
 const profile = profiles[kind]
 if (!profile || !raw.includes(profile.marker)) return raw
 const eol = raw.includes('\r\n') ? '\r\n' : '\n'
 let value = raw.replace(/\r\n/g, '\n')
 const digest = s => createHash('sha256').update(s).digest('hex')
 assert.equal(digest(value), profile.current, 'QUERY101_COMPLETE_CURRENT_SOURCE')
 for (const [current, prior] of profile.pairs) { assert.equal(value.split(current).length, 2); value = value.replace(current, prior) }
 assert.equal(digest(value), profile.prior, 'QUERY101_COMPLETE_PRIOR_SOURCE')
 return value.replace(/\n/g, eol)
}
