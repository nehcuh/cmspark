'use strict'
// Pinned offline xterm compatibility. Never patch a global Document or relax CSP.
const {createHash} = require('node:crypto')
const XTERM_VERSION = '6.0.0'
const XTERM_BYTES = 488663
const XTERM_SHA256 = '14903579ff54664cd72f8e8699e6961a6272c21863ec1c3b118cdc8af5d4a972'
const SITES = Object.freeze([
  ['s.mainDocument.createElement("style")', 's.mainDocument', 1],
  ['this._document.createElement("style")', 'this._document', 2],
  ['document.createElement("style")', 'document', 1],
])
function replacement(receiver) {
  // Evaluate the original receiver once, retain createElement's receiver/argument,
  // set only this new style's nonce, and return that same element.
  return '/*CMSPARK_STYLE_NONCE_476*/((d)=>{const e=d.createElement("style"),m=d.querySelectorAll(\'meta[name="cmspark-style-nonce"]\'),n=m.length===1?m[0].content:null;if(typeof n!=="string"||!/^[a-f0-9]{64}$/.test(n))throw new Error("XTERM_STYLE_NONCE_UNAVAILABLE");e.nonce=n;return e})(' + receiver + ')'
}
function transformXtermStyleNonce(source, version) {
  if (!Buffer.isBuffer(source) || version !== XTERM_VERSION || source.length !== XTERM_BYTES ||
      createHash('sha256').update(source).digest('hex') !== XTERM_SHA256)
    throw new Error('XTERM_STYLE_VENDOR_MISMATCH')
  const original = source.toString('utf8')
  const counts = new Map(SITES.map(([literal]) => [literal, 0]))
  const changed = original.replace(/s\.mainDocument\.createElement\("style"\)|this\._document\.createElement\("style"\)|document\.createElement\("style"\)/g, literal => {
    const site = SITES.find(([value]) => value === literal)
    if (!site) throw new Error('XTERM_STYLE_VENDOR_MISMATCH')
    counts.set(literal, counts.get(literal) + 1)
    return replacement(site[1])
  })
  if (SITES.some(([literal, , count]) => counts.get(literal) !== count))
    throw new Error('XTERM_STYLE_VENDOR_MISMATCH')
  // Pin the outside bytes too: inversion cannot mask an accidental broad edit.
  let restored = changed
  for (const [literal, receiver] of SITES) restored = restored.split(replacement(receiver)).join(literal)
  if (restored !== original) throw new Error('XTERM_STYLE_VENDOR_MISMATCH')
  return Buffer.from(changed, 'utf8')
}
module.exports = Object.freeze({transformXtermStyleNonce, XTERM_VERSION, XTERM_BYTES, XTERM_SHA256})
