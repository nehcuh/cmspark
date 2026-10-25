/** Unshipped observation only. Each clock retains its own origin. */
import { types } from 'node:util'
type Row772 = [number, number, number]
type NativeRow772 = [number, number, number, boolean]
export function createConfirmationObservation772(role: 'LOCAL' | 'TERMINAL', clock: () => number, diagnostic: (message: string) => void) {
  const server: Row772[] = [], native: NativeRow772[] = [], pairs = { server: new Set<string>(), native: new Set<string>() }
  let malformed = false, emitted = false, ordinal = 1, origin = 0
  try { origin = clock(); if (!Number.isFinite(origin)) malformed = true } catch { malformed = true }
  const append = (kind: 'server' | 'native', point: number, round: number, bucket: number, value?: boolean) => {
    if (!Number.isSafeInteger(point) || point < 1 || point > (kind === 'server' ? 5 : 128) || !Number.isSafeInteger(round) || round < 1 || round > 8 || !Number.isSafeInteger(bucket) || bucket < 0 || bucket > 240 || (kind === 'native' && typeof value !== 'boolean')) { malformed = true; return }
    const key = `${point}:${round}`, rows = kind === 'server' ? server : native
    if (pairs[kind].has(key)) return // First actual observation only; never advance an action.
    if (rows.length >= (kind === 'server' ? 40 : 1024)) { malformed = true; return }
    pairs[kind].add(key); if (kind === 'server') server.push([point, round, bucket]); else native.push([point, round, bucket, value!])
  }
  return {
    server(point: number, round = ordinal) {
      try {
        ordinal = round
        const elapsed = clock() - origin
        if (!Number.isFinite(elapsed) || elapsed < 0) { malformed = true; return }
        append('server', point, round, Math.min(240, Math.floor(elapsed / 250)))
      } catch { malformed = true }
    },
    native(frame: unknown) {
      try {
        if (!frame || typeof frame !== 'object' || types.isProxy(frame)) return
        const own = (key: string) => { const value = Object.getOwnPropertyDescriptor(frame, key); return value && 'value' in value ? value.value : undefined }
        if (own('type') !== 'system.ping') return
        const id = own('id')
        if (typeof id !== 'string' || !id.startsWith('D476_CF_')) return
        const match = /^D476_CF_(LOCAL|TERMINAL)_([1-9][0-9]{0,2})_([1-8])_(0|[1-9][0-9]{0,2})_([01])$/.exec(id)
        if (!match || match[1] !== role || Reflect.ownKeys(frame).length !== 2) { malformed = true; return }
        append('native', Number(match[2]), Number(match[3]), Number(match[4]), match[5] === '1')
      } catch { malformed = true }
    },
    snapshot(moment: 'ABORT' | 'FINALLY') {
      return { schema: 1, role, moment, server: server.map(row => [...row]), native: native.map(row => [...row]), malformed }
    },
    emit(moment: 'ABORT' | 'FINALLY') {
      if (emitted) return
      emitted = true
      // A diagnostic sink failure never becomes authority or replaces an error.
      try { diagnostic('D476_NATIVE_CONFIRMATION_PHASE ' + JSON.stringify(this.snapshot(moment))) } catch { /* no retry */ }
    },
  }
}
