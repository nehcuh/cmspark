// Lifecycle evidence for the isolated relocated smoke process, never authority.
const dc = require('node:diagnostics_channel')
const { Worker } = require('node:worker_threads')
const { ChildProcess } = require('node:child_process')

const PHASES = new Set(['kit-load-start', 'kit-load-ready', 'create-start', 'create-ready',
  'convert-start', 'convert-resolved', 'assertions-pass', 'dispose-start', 'dispose-settled', 'operation-failure'])
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGXFSZ', 'SIGBREAK'])

function createOfficeSmokeObserver() {
  const started = performance.now()
  const events = [], tracked = [], seen = new WeakSet()
  let objectOverflow = false, eventOverflow = false, observerFailure = false, stopped = false, summary
  function record(role, object, event, extra = {}) {
    if (stopped) return
    if (events.length === 64) { eventOverflow = true; return }
    const value = Object.freeze({
      elapsed_ms: Math.max(0, Math.trunc(performance.now() - started)), role, object, event,
      message_kind: extra.message_kind ?? null, ok: extra.ok ?? null,
      has_snapshot: extra.has_snapshot ?? null, has_fonts: extra.has_fonts ?? null,
      has_output: extra.has_output ?? null, exit_code: extra.exit_code ?? null, signal: extra.signal ?? null,
    })
    events.push(value)
    // Emit as the phase happens: an outer kill may prevent finish(). This is
    // bounded partial evidence, not an EOF or persistence guarantee.
    try { console.error(JSON.stringify({ schema: 'cmspark.office-smoke.lifecycle.v1', kind: 'event', ...value })) }
    catch { observerFailure = true }
  }
  // A subscriber must never throw into the observed conversion or consume stdio.
  const guarded = fn => (...args) => { try { fn(...args) } catch { observerFailure = true } }
  const exitCode = value => Number.isInteger(value) && value >= 0 && value <= 255 ? value : null
  const signalName = value => value == null ? null : SIGNALS.has(value) ? value : 'other'
  function track(object, role) {
    if (stopped || seen.has(object)) return null
    if (tracked.length === 8) { objectOverflow = true; return null }
    seen.add(object)
    const entry = { object, role, id: tracked.length + 1, finished: false, listeners: [] }
    tracked.push(entry)
    record(role, entry.id, 'created')
    return entry
  }
  function once(entry, name, callback) {
    const listener = guarded(callback)
    entry.listeners.push([name, listener])
    entry.object.once(name, listener)
  }
  const onWorker = guarded(({ worker }) => {
    if (!(worker instanceof Worker)) { observerFailure = true; return }
    const entry = track(worker, 'worker')
    if (!entry) return
    once(entry, 'online', () => record('worker', entry.id, 'online'))
    once(entry, 'message', message => {
      const object = message !== null && typeof message === 'object'
      record('worker', entry.id, 'first-message', {
        message_kind: object && message.kind === 'font-cache' ? 'font-cache' : 'other',
        ok: object && message.ok === true,
        has_snapshot: object && Object.hasOwn(message, 'snapshot'),
        has_fonts: object && Object.hasOwn(message, 'fonts'),
        has_output: object && Object.hasOwn(message, 'output'),
      })
    })
    once(entry, 'exit', code => { entry.finished = true; record('worker', entry.id, 'exit', { exit_code: exitCode(code) }) })
  })
  const onChild = guarded(({ process: child }) => {
    if (!(child instanceof ChildProcess)) { observerFailure = true; return }
    const entry = track(child, 'child')
    if (!entry) return
    once(entry, 'spawn', () => record('child', entry.id, 'spawn'))
    once(entry, 'exit', (code, signal) => record('child', entry.id, 'exit', { exit_code: exitCode(code), signal: signalName(signal) }))
    once(entry, 'close', (code, signal) => { entry.finished = true; record('child', entry.id, 'close', { exit_code: exitCode(code), signal: signalName(signal) }) })
  })
  try {
    dc.subscribe('worker_threads', onWorker)
    dc.subscribe('child_process', onChild)
  } catch { observerFailure = true }
  record('probe', 0, 'observer-start')
  return Object.freeze({
    phase(value) {
      if (!PHASES.has(value)) { observerFailure = true; return }
      record('probe', 0, value)
    },
    finish() {
      if (stopped) return summary
      // Remove only this observer's listeners. Existing error/lifetime handlers
      // and streams belong to the kit; in particular, do not add error handlers.
      try { dc.unsubscribe('worker_threads', onWorker) } catch { observerFailure = true }
      try { dc.unsubscribe('child_process', onChild) } catch { observerFailure = true }
      for (const entry of tracked) for (const [name, listener] of entry.listeners) {
        try { entry.object.removeListener(name, listener) } catch { observerFailure = true }
      }
      const open = tracked.filter(entry => !entry.finished).length
      stopped = true
      summary = Object.freeze({
        schema: 'cmspark.office-smoke.lifecycle.v1',
        status: objectOverflow || eventOverflow || observerFailure || open ? 'incomplete' : 'complete',
        objects: tracked.length, open_objects: open, object_overflow: objectOverflow,
        event_overflow: eventOverflow, observer_failure: observerFailure,
        events: Object.freeze(events.slice()),
      })
      return summary
    },
  })
}

module.exports = { createOfficeSmokeObserver }
