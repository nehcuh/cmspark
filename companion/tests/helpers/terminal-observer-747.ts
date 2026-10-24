/** Test-only observer. Never opens a DOM terminal or changes the real PTY/ACK. */
import type { Terminal } from '@xterm/xterm'

export const terminalMarker747 = 'D476_TERMINAL_中'
export function parsedMarker747(terminal: Pick<Terminal, 'cols' | 'rows' | 'buffer'>, marker = terminalMarker747): boolean {
 if (!marker || !Number.isSafeInteger(terminal.cols) || terminal.cols < 1 || terminal.cols > 500 || !Number.isSafeInteger(terminal.rows) || terminal.rows < 1 || terminal.rows > 200) return false
 const buffer = terminal.buffer.active
 if (!Number.isSafeInteger(buffer.length) || buffer.length < 1 || buffer.length > 5000 + terminal.rows) return false
 let suffix = '', found = false
 for (let index = 0; index < buffer.length; index++) {
  const line = buffer.getLine(index)
  if (!line || typeof line.isWrapped !== 'boolean') return false
  if (!line.isWrapped) suffix = ''
  // xterm trims unoccupied cells here, not real ASCII spaces. Its own public
  // selection service uses this translation when joining softwrapped rows.
  const text = line.translateToString(true)
  const whole = suffix + text
  if (whole.includes(marker)) found = true
  suffix = whole.slice(-(marker.length - 1))
 }
 return found
}

/** Search before retaining the bounded diagnostic suffix; not parsed truth. */
export function rawMarker747(suffix: string, text: string) {
 const whole = suffix + text
 return { suffix: whole.slice(-128), found: whole.includes(terminalMarker747) }
}

type Parser = Pick<Terminal, 'cols' | 'rows' | 'buffer' | 'write' | 'resize' | 'dispose'>
type Binding = { id: string; threadId: string; owner: object; cols: number; rows: number }
type Resize = { kind: 'resize'; cols: number; rows: number; accepted?: boolean }
type Data = { kind: 'data'; bytes: Uint8Array }
export function createTerminalObserver747(factory: (cols: number, rows: number) => Parser, signal: AbortSignal, onFault: (error: Error) => void) {
 let binding: Binding | undefined, parser: Parser | undefined, openDecision: boolean | undefined
 let writing = false, sealed = false, disposed = false, fault: Error | undefined
 const queue: Array<Resize | Data> = [], waiters = new Set<{ resolve(): void; reject(error: Error): void }>()
 const fail = (cause: unknown): Error => {
  if (!fault) {
   fault = cause instanceof Error ? cause : Error(String(cause))
   for (const waiter of waiters) waiter.reject(fault)
   waiters.clear()
   onFault(fault)
  }
  return fault
 }
 const abort = () => { fail(Error('TERMINAL_OBSERVER_ABORTED')) }
 signal.addEventListener('abort', abort, { once: true })
 if (signal.aborted) abort()
 const check = () => {
  if (fault) throw fault
  if (disposed || sealed) throw fail(Error('TERMINAL_OBSERVER_AFTER_FENCE'))
 }
 const settle = () => {
  if (!writing && queue.length === 0 && openDecision === true) {
   for (const waiter of waiters) waiter.resolve()
   waiters.clear()
  }
 }
 const pump = () => {
  if (fault || disposed || writing || openDecision !== true || !parser) return
  while (queue.length) {
   const entry = queue[0]
   if (entry.kind === 'resize') {
    if (entry.accepted === undefined) return
    queue.shift()
    if (entry.accepted) { try { parser.resize(entry.cols, entry.rows) } catch (error) { fail(error); return } }
   } else {
    queue.shift(); writing = true
    try {
     parser.write(entry.bytes, () => {
      if (disposed || fault) return
      writing = false
      pump()
     })
    } catch (error) { writing = false; fail(error) }
    return
   }
  }
  settle()
 }
 const own = (id: string, threadId?: string, owner?: object) => {
  if (!binding || id !== binding.id || (threadId !== undefined && threadId !== binding.threadId) || (owner !== undefined && owner !== binding.owner)) throw fail(Error('TERMINAL_OBSERVER_FOREIGN_OPERATION'))
 }
 const dimensions = (cols: number, rows: number) => {
  if (!Number.isSafeInteger(cols) || cols < 1 || cols > 500 || !Number.isSafeInteger(rows) || rows < 1 || rows > 200) throw fail(Error('TERMINAL_OBSERVER_DIMENSIONS'))
 }
 return {
  reserveOpen(input: Binding) {
   check()
   if (binding || !input.id || !input.threadId || !input.owner || typeof input.owner !== 'object') throw fail(Error('TERMINAL_OBSERVER_OPEN_BINDING'))
   dimensions(input.cols, input.rows)
   binding = { ...input }
   return binding
  },
  commitOpen(token: Binding, accepted: boolean) {
   check()
   if (token !== binding || openDecision !== undefined) throw fail(Error('TERMINAL_OBSERVER_OPEN_TOKEN'))
   openDecision = accepted
   if (!accepted) throw fail(Error('TERMINAL_OBSERVER_OPEN_REFUSED'))
   try { parser = factory(token.cols, token.rows) } catch (error) { throw fail(error) }
   pump()
  },
  data(id: string, threadId: string, owner: object, bytes: Uint8Array) {
   check(); own(id, threadId, owner)
   queue.push({ kind: 'data', bytes: Uint8Array.from(bytes) }); pump()
  },
  reserveResize(id: string, cols: number, rows: number) {
   check(); own(id); dimensions(cols, rows)
   const token: Resize = { kind: 'resize', cols, rows }
   queue.push(token)
   return token
  },
  commitResize(token: Resize, accepted: boolean) {
   check()
   if (!queue.includes(token) || token.accepted !== undefined) throw fail(Error('TERMINAL_OBSERVER_RESIZE_TOKEN'))
   token.accepted = accepted; pump()
  },
  async finish() {
   check(); sealed = true
   if (!binding || openDecision !== true) throw fail(Error('TERMINAL_OBSERVER_NOT_OPEN'))
   if (writing || queue.length) await new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); pump() })
   if (fault) throw fault
   if (signal.aborted || disposed || !parser) throw fail(Error('TERMINAL_OBSERVER_NOT_SETTLED'))
   return parsedMarker747(parser)
  },
  dispose() {
   if (disposed) return
   disposed = true; signal.removeEventListener('abort', abort)
   if (writing || queue.length || waiters.size) fail(Error('TERMINAL_OBSERVER_DISPOSED_WITH_PENDING_WRITES'))
   try { parser?.dispose() } finally { if (fault) throw fault }
  },
 }
}
