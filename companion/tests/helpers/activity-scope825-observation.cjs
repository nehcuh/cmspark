'use strict'
const fs = require('node:fs')
const path = require('node:path')
const names = ['RUN_ENTER', 'SOURCE_INITIALIZED', 'LOADED', 'CONTENT_RENDERED', 'READY_WRITTEN', 'RUN_RETURN', 'ACTIVATE_TRUE', 'ACTIVATE_FALSE', 'FOCUS_TRUE', 'FOCUS_FALSE', 'NOT_RENDERED', 'NOT_CURRENT', 'NOT_RECEIPT_WINDOW', 'NO_PENDING', 'NO_HWND', 'NOT_FOREGROUND', 'NO_KEYBOARD_FOCUS', 'QUALIFIED']
// Each entry proves a point was observed once, never its deadline/last state.
module.exports = function projectInitialScope825(dir) {
  const points = Object.create(null)
  for (const name of names) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, 'scope-initial-' + name + '.json'), 'utf8'))
      if (value && value.phase === name && typeof value.sameSta === 'boolean' && Object.keys(value).length === 2) points[name] = value.sameSta
    } catch { /* Missing, partial or foreign data remains UNKNOWN. */ }
  }
  return { schema: 1, status: Object.keys(points).length ? 'OBSERVED' : 'UNKNOWN', points }
}
