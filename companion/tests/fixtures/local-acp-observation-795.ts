// Test-only observation of the existing ACP promise. It grants no lifecycle authority.
import {types} from 'node:util'
type Outcome = 'NOT_STARTED' | 'PENDING' | 'HANDLE' | 'NULL' | 'THREW' | 'AMBIGUOUS'
type ErrorClass = 'ENOENT' | 'EACCES' | 'EPERM' | 'EPIPE' | 'ECONNRESET' | 'ERR_STREAM_DESTROYED' | 'OTHER' | 'UNKNOWN'
export function createLocalAcpObservation795(enabled: boolean, clock: () => number = () => performance.now()) {
  let attempts = 0
  let outcome: Outcome = 'NOT_STARTED'
  let rejectionBucket: number | null = null, abortBucket: number | null = null, errorClass: ErrorClass | null = null
  let origin: number | null = null
  function now(): number | null { try { const n=clock(); return Number.isFinite(n) && n>=0 ? n : null } catch { return null } }
  if (enabled) origin=now()
  function bucket(): number | null {const n=now();if(origin===null||n===null||n<origin)return null;return Math.min(65535,Math.floor((n-origin)/250))}
  function classify(error: unknown): ErrorClass {
    try {
      if ((typeof error!=='object' && typeof error!=='function')||error===null||types.isProxy(error))return 'UNKNOWN'
      const d=Object.getOwnPropertyDescriptor(error,'code');if(!d||!('value' in d)||typeof d.value!=='string')return 'UNKNOWN'
      switch(d.value){case 'ENOENT':case 'EACCES':case 'EPERM':case 'EPIPE':case 'ECONNRESET':case 'ERR_STREAM_DESTROYED':return d.value;default:return 'OTHER'}
    } catch {return 'UNKNOWN'}
  }
  function markAbort() { if(enabled && abortBucket===null) abortBucket=bucket() }
  function track<T>(original: Promise<T>): Promise<T> {
    if (!enabled) return original
    attempts = Math.min(attempts + 1, 2)
    outcome = attempts === 1 ? 'PENDING' : 'AMBIGUOUS'
    return original.then(value => {
      if (attempts === 1) outcome = value ? 'HANDLE' : 'NULL'
      return value
    }, error => {
      if (attempts === 1) { outcome = 'THREW'; rejectionBucket=bucket(); errorClass=classify(error) }
      throw error
    })
  }
  function snapshot() { return { schema: 1, attempts, outcome } }
  function detail() { return { schema: 1, attempts, outcome, rejectionBucket: attempts===1 ? rejectionBucket : null, abortBucket, errorClass: attempts===1 ? errorClass : null } }
  return { track, markAbort, snapshot, detail }
}
