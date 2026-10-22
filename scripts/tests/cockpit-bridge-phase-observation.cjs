// Optional, finite diagnostics only. No process, filesystem or acceptance authority.
'use strict'

function validProjection(value) {
  try {
    const data = (object, key) => {
      const property = Object.getOwnPropertyDescriptor(object, key)
      return property && Object.hasOwn(property, 'value') ? property : null
    }
    const sequence = (value, maximum) => {
      if (value === null) return true
      if (!Array.isArray(value) || value.length < 1 || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false
      let lastId = 0, lastBucket = -1
      for (let index = 0; index < value.length; index++) {
        const entry = data(value, String(index))?.value
        if (!Array.isArray(entry) || entry.length !== 2 || Reflect.ownKeys(entry).length !== 3) return false
        const id = data(entry, '0')?.value, bucket = data(entry, '1')?.value
        if (!Number.isInteger(id) || id < 1 || id > maximum || id <= lastId || (index === 0 && id !== 1) ||
            !Number.isInteger(bucket) || bucket < 0 || bucket > 180 || bucket < lastBucket) return false
        lastId = id; lastBucket = bucket
      }
      return true
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 4 || !['v', 'phases', 'registrar', 'at'].every(key => keys.includes(key) && data(value, key))) return false
    return data(value, 'v').value === 1 && ['ABORT', 'CLOSE', 'UNKNOWN'].includes(data(value, 'at').value) &&
      sequence(data(value, 'phases').value, 9) && sequence(data(value, 'registrar').value, 8)
  } catch { return false }
}

function createObservation(now = () => performance.now()) {
  const phases = [], registrar = [], partial = Buffer.alloc(64)
  let phasesOK = true, registrarOK = true, origin = 0, lastTime = 0, started = false
  let bytes = 0, lines = 0, used = 0, successSeen = false, entrySeen = false, latched = null
  const clock = () => {
    const value = now()
    if (typeof value !== 'number' || !Number.isFinite(value)) throw null
    return value
  }
  try { origin = lastTime = clock() } catch { phasesOK = false }
  const invalidateRegistrar = () => { registrarOK = false; used = 0 }
  return {
    start() {
      if (latched || started) return
      started = true
      try {
        if (!phasesOK || phases.length) { phasesOK = false; return }
        const value = clock()
        if (value < lastTime) { phasesOK = false; return }
        origin = lastTime = value
      } catch { phasesOK = false }
    },
    mark(id) {
      if (latched || !phasesOK) return
      try {
        const previous = phases.at(-1)
        if (!Number.isInteger(id) || id < 1 || id > 9 || (previous ? id <= previous[0] : id !== 1)) { phasesOK = false; return }
        const value = clock(), bucket = Math.floor((value - origin) / 250)
        if (value < lastTime || !Number.isInteger(bucket) || bucket < 0 || bucket > 180 || (previous && bucket < previous[1])) { phasesOK = false; return }
        lastTime = value; phases.push([id, bucket])
      } catch { phasesOK = false }
    },
    feed(chunk) {
      if (latched || !registrarOK) return false
      let entry = false
      try {
        if (!Buffer.isBuffer(chunk)) { invalidateRegistrar(); return false }
        for (const byte of chunk) {
          bytes++
          if (bytes > 1024 || used === 64 || (byte !== 10 && byte !== 13 && (byte < 32 || byte > 126))) { invalidateRegistrar(); break }
          partial[used++] = byte
          if (byte !== 10) continue
          if (++lines > 16) { invalidateRegistrar(); break }
          const line = partial.toString('ascii', 0, used); used = 0
          if (/^(?:COCKPIT_BRIDGE_REGISTERED|COCKPIT_BRIDGE_ALREADY_REGISTERED)\r?\n$/.test(line)) {
            if (successSeen) { invalidateRegistrar(); break }
            successSeen = true; continue
          }
          const token = /^CM723P ([1-8]) (0|[1-9][0-9]{0,2})\r?\n$/.exec(line)
          if (!token) { invalidateRegistrar(); break }
          const id = Number(token[1]), bucket = Number(token[2]), previous = registrar.at(-1)
          if (bucket > 180 || (previous ? id <= previous[0] || bucket < previous[1] : id !== 1)) { invalidateRegistrar(); break }
          registrar.push([id, bucket])
          if (id === 1 && !entrySeen) { entrySeen = true; entry = true }
        }
      } catch { invalidateRegistrar() }
      return entry
    },
    sinkFailure() {
      if (!latched) invalidateRegistrar()
    },
    snapshot(at) {
      if (latched) return latched
      try {
        if (used || !entrySeen) invalidateRegistrar()
        const copy = value => Object.freeze(value.map(row => Object.freeze([row[0], row[1]])))
        latched = Object.freeze({ v: 1, phases: phasesOK && phases.length ? copy(phases) : null,
          registrar: registrarOK ? copy(registrar) : null, at: ['ABORT', 'CLOSE', 'UNKNOWN'].includes(at) ? at : 'UNKNOWN' })
      } catch { latched = Object.freeze({ v: 1, phases: null, registrar: null, at: 'UNKNOWN' }) }
      return latched
    },
  }
}

module.exports = { createObservation, validProjection }
