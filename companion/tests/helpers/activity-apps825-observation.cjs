'use strict'
const fs = require('node:fs')
const path = require('node:path')
const names = ['MAIN_ENTER', 'RUN_ENTER', 'SOURCE_INITIALIZED', 'LOADED', 'CONTENT_RENDERED', 'READY_WRITTEN']
// Positive history, never readiness or continuous state. Missing means UNKNOWN.
module.exports = function projectApps825(dir) {
  const points = Object.create(null)
  for (const name of names) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, 'apps-initial-' + name + '.json'), 'utf8'))
      if (value && value.phase === name && typeof value.sameSta === 'boolean' && Object.keys(value).length === 2) points[name] = value.sameSta
    } catch { /* Missing, partial or foreign data remains UNKNOWN. */ }
  }
  return { schema: 1, status: Object.keys(points).length ? 'OBSERVED' : 'UNKNOWN', points }
}
