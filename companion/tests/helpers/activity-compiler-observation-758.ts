/** Failure-only finite projection for the fixed owned compiler. No paths or raw output. */
export function compilerFailureObservation758(error: unknown) {
  try {
    if (!error || typeof error !== 'object') return { version: 1, kind: 'UNAVAILABLE' as const }
    const d = Object.getOwnPropertyDescriptors(error)
    const value = (key: string): unknown => {
      const entry = d[key]
      return entry && 'value' in entry ? entry.value : undefined
    }
    const rawCode = value('code'), rawSignal = value('signal'), rawKilled = value('killed')
    const code = typeof rawCode === 'number' && Number.isSafeInteger(rawCode) && rawCode >= -2147483648 && rawCode <= 4294967295 ? rawCode : null
    const spawnCode = typeof rawCode === 'string' && ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ABORT_ERR', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(rawCode) ? rawCode : null
    const signal = rawSignal === 'SIGTERM' || rawSignal === 'SIGKILL' ? rawSignal : null
    const killed = typeof rawKilled === 'boolean' ? rawKilled : null
    const codes = new Set<string>()
    let outputState: 'UNAVAILABLE' | 'EMPTY' | 'PRESENT' | 'TOO_LARGE' = 'UNAVAILABLE'
    for (const key of ['stdout', 'stderr']) {
      const output = value(key)
      if (typeof output !== 'string') continue
      if (output.length > 4096) { outputState = 'TOO_LARGE'; continue }
      if (outputState !== 'TOO_LARGE') outputState = output.length > 0 ? 'PRESENT' : outputState === 'PRESENT' ? 'PRESENT' : 'EMPTY'
      for (const match of output.matchAll(/\b(?:error|warning)\s+(CS[0-9]{4})\b/gi)) codes.add(match[1].toUpperCase())
    }
    return { version: 1, kind: 'COMPILER_FAILURE' as const, code, spawnCode, signal, killed, outputState, compilerCodes: [...codes].sort().slice(0, 4), compilerMore: codes.size > 4 }
  } catch {
    return { version: 1, kind: 'UNAVAILABLE' as const }
  }
}
