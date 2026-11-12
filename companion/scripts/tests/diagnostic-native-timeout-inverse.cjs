// TEMP source lineage only; removed with the diagnostic hook.
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const hook = "/*TEMP_NATIVE_TRACE_BEGIN*/;try{require(path.resolve(this.resultSourceRoot,'../../../../scripts/diagnose-macos-native-timeout.mjs')).saveSceneTrace(this.scene.root)}catch{}/*TEMP_NATIVE_TRACE_END*/"
exports.restore = raw => {
 if (!raw.includes('/*TEMP_NATIVE_TRACE_BEGIN*/')) return raw
 const eol = raw.includes('\r\n') ? '\r\n' : '\n'
 const value = raw.replace(/\r\n/g, '\n'), digest = s => createHash('sha256').update(s).digest('hex')
 assert.equal(digest(value), 'fbe01738171625de7a82eed2972f50a57b6da86aae4ceadbdc45c0270dd6fc58', 'TEMP_TRACE_COMPLETE_SOURCE')
 assert.equal(value.split(hook).length, 2)
 const prior = value.replace(hook, '')
 assert.equal(digest(prior), '80b4d54471bb1007bb237c8236846b8bb84db86c88c96df4f163686cb215aa7e', 'TEMP_TRACE_COMPLETE_PRIOR')
 return prior.replace(/\n/g, eol)
}
