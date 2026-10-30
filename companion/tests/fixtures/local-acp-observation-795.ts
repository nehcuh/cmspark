// Test-only observation of the existing ACP promise. It grants no lifecycle authority.
type Outcome = 'NOT_STARTED' | 'PENDING' | 'HANDLE' | 'NULL' | 'THREW' | 'AMBIGUOUS'

export function createLocalAcpObservation795(enabled: boolean) {
  let attempts = 0
  let outcome: Outcome = 'NOT_STARTED'
  function track<T>(original: Promise<T>): Promise<T> {
    if (!enabled) return original
    attempts = Math.min(attempts + 1, 2)
    outcome = attempts === 1 ? 'PENDING' : 'AMBIGUOUS'
    return original.then(value => {
      if (attempts === 1) outcome = value ? 'HANDLE' : 'NULL'
      return value
    }, error => {
      if (attempts === 1) outcome = 'THREW'
      throw error
    })
  }
  function snapshot() { return { schema: 1, attempts, outcome } }
  return { track, snapshot }
}
