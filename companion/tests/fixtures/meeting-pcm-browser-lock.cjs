const assert = require('node:assert/strict')

// Node 22 has no Web Locks API. Give the actual panel owner one exclusive,
// non-queueing browser slot, held until its request callback settles.
module.exports = function captureLock() {
  let held = false
  return {
    get held() { return held },
    async request(name, options, callback) {
      assert.equal(name, 'cmspark-workbench-capture')
      assert.deepEqual(options, { ifAvailable: true })
      if (held) return callback(null)
      held = true
      try { return await callback({ name, mode: 'exclusive' }) }
      finally { held = false }
    },
  }
}
