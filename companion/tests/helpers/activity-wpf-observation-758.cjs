'use strict'
const fs = require('node:fs')
const path = require('node:path')
// A missing, malformed, or non-closed receipt is omitted (UNKNOWN).
const names = ['RUN_ENTER','SOURCE_INITIALIZED','LOADED','TIMER_TICK','CONTENT_RENDERED','READY_WRITTEN','RUN_RETURN']
module.exports = function projectWpf758(dir) {
  const out = Object.create(null)
  for (const name of names) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, 'wpf-' + name + '.json'), 'utf8'))
      if (value && value.phase === name && typeof value.sameSta === 'boolean' && Object.keys(value).length === 2) out[name] = value.sameSta
    } catch { /* UNKNOWN, never change the native result */ }
  }
  return out
}
