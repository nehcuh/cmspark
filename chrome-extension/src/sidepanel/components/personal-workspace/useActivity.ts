import { useCallback, useEffect, useRef, useState } from 'react'
import { requestActivity, type ActivitySnapshot } from './activity-request'

export type ActivityBulkAction = 'handling_done' | 'feedback_done' | 'dismiss'
export type ActivityBulkItem = { kind: 'todo' | 'candidate'; id: string; revision: number; title: string }
export type ActivityBulkResult = ActivityBulkItem & { status: 'confirmed' | 'unconfirmed' | 'not_sent'; message: string }

export function useActivity(connected: boolean, connectionRevision: number) {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const live = useRef(true), reading = useRef(false), writing = useRef<object | null>(null)
  const snapshotRef = useRef<ActivitySnapshot | null>(null)
  // Existing reducer connection revision is a UI cancellation fence, never wire authority.
  const peer = useRef({ connected }), props = useRef({ connected, connectionRevision })
  if (props.current.connected !== connected || props.current.connectionRevision !== connectionRevision) {
    props.current = { connected, connectionRevision }; peer.current = { connected }
  }
  const snapshotPeer = useRef<typeof peer.current | null>(null)
  const controller = useRef<AbortController | null>(null), readController = useRef<AbortController | null>(null)
  const accept = useCallback((value: ActivitySnapshot | undefined, owner: typeof peer.current) => {
    if (!value || !live.current || peer.current !== owner || !owner.connected) return
    const old = snapshotRef.current
    if (snapshotPeer.current !== owner || !old || value.revision >= old.revision) {
      snapshotPeer.current = owner; snapshotRef.current = value; setSnapshot(value)
    }
  }, [])
  const refresh = useCallback(async () => {
    const owner = peer.current
    if (!connected || !owner.connected || reading.current || writing.current) return
    reading.current = true; setLoading(true)
    const abort = new AbortController(); readController.current = abort
    try { const result = await requestActivity('activity.state', {}, abort.signal); if (!abort.signal.aborted && peer.current === owner) { accept(result.state, owner); if (live.current) setError('') } }
    catch (e) { if (live.current && !abort.signal.aborted && peer.current === owner) setError((e as Error).message) }
    finally { if (readController.current === abort) { readController.current = null; reading.current = false; if (live.current) setLoading(false) } }
  }, [connected, connectionRevision, accept])
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); readController.current?.abort() } }, [])
  useEffect(() => {
    // discardSocket broadcasts this even on silent reconnect. Cancel before React renders.
    const lost = (message: { type?: unknown; state?: unknown }) => {
      if (message?.type !== 'thread.mutation.connection' || message.state !== 'disconnected' && message.state !== 'connecting') return
      peer.current = { connected: false }; snapshotPeer.current = null
      controller.current?.abort(); readController.current?.abort()
      if (live.current) setError('连接已变化；已发出的更改请刷新核实，后续不会自动提交。')
    }
    chrome.runtime.onMessage.addListener(lost)
    return () => chrome.runtime.onMessage.removeListener(lost)
  }, [])
  useEffect(() => {
    if (!connected) { snapshotPeer.current = null; return }
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 20_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); readController.current?.abort(); readController.current = null; reading.current = false; setLoading(false); controller.current?.abort() }
  }, [connected, connectionRevision, refresh])
  const mutate = useCallback(async (type: string, data: Record<string, unknown>, success: string) => {
    const owner = peer.current
    if (!connected || !owner.connected || snapshotPeer.current !== owner || writing.current) {
      if (live.current && connected && (!owner.connected || snapshotPeer.current !== owner)) setError('连接已变化，请先刷新本机记录后再保存。')
      return false
    }
    const write = {}; writing.current = write; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try {
      const result = await requestActivity(type, data, abort.signal)
      if (!live.current || abort.signal.aborted || peer.current !== owner) return false
      accept(result.state, owner); setNotice(success); return true
    } catch (e) { if (live.current && peer.current === owner) setError((e as Error).message); return false }
    finally { if (writing.current === write) { writing.current = null; if (live.current) setBusy(false) }; if (controller.current === abort) controller.current = null }
  }, [connected, connectionRevision, accept])
  const mutateBulk = useCallback(async (action: ActivityBulkAction, selected: readonly ActivityBulkItem[], current: () => boolean): Promise<ActivityBulkResult[]> => {
    // Freeze explicit identities/revisions once. Replies never rebase subsequent writes.
    const items = selected.map(item => ({ ...item })), owner = peer.current
    const results: ActivityBulkResult[] = items.map(item => ({ ...item, status: 'not_sent', message: '未发送' }))
    const eligible = () => live.current && owner.connected && peer.current === owner && snapshotPeer.current === owner && current()
    if (!connected || writing.current || !items.length || !eligible()) return results
    if (!['handling_done', 'feedback_done', 'dismiss'].includes(action) || new Set(items.map(item => `${item.kind}:${item.id}`)).size !== items.length || items.some(item => !item.id || !Number.isSafeInteger(item.revision) || item.revision < 0 || item.kind !== (action === 'dismiss' ? 'candidate' : 'todo'))) return results
    const write = {}; writing.current = write; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        if (!eligible() || abort.signal.aborted) { results[index].message = '页面或连接已变化，后续未发送'; break }
        const state = snapshotRef.current
        const candidate = state?.candidates.find(value => value.id === item.id)
        const todo = state?.todos.find(value => value.id === item.id)
        const record = item.kind === 'candidate' ? candidate : todo
        if (!record || record.revision !== item.revision || action === 'dismiss' && candidate?.status !== 'pending' || action === 'handling_done' && todo?.handling_status !== 'open' || action === 'feedback_done' && (!todo?.feedback_required || todo.feedback_status !== 'pending')) {
          results[index].message = '事项已变化，请重新核对；后续未发送'; break
        }
        try {
          const result = await requestActivity(action === 'dismiss' ? 'todo.dismiss' : 'todo.update', action === 'dismiss'
            ? { candidate_id: item.id, expected_revision: item.revision }
            : { todo_id: item.id, expected_revision: item.revision, patch: action === 'handling_done' ? { handling_status: 'done' } : { feedback_status: 'done' } }, abort.signal)
          if (!eligible() || abort.signal.aborted) { results[index] = { ...item, status: 'unconfirmed', message: '已发送，页面或连接已变化，请刷新核实' }; break }
          accept(result.state, owner)
          const persisted = action === 'dismiss' ? result.state?.candidates.find(value => value.id === item.id) : result.state?.todos.find(value => value.id === item.id)
          const saved = !!persisted && persisted.revision === item.revision + 1 && (action === 'dismiss' ? 'status' in persisted && persisted.status === 'dismissed' : 'handling_status' in persisted && (action === 'handling_done' ? persisted.handling_status === 'done' : persisted.feedback_status === 'done'))
          if (!saved) { results[index] = { ...item, status: 'unconfirmed', message: '回执未确认该项更改，请刷新核实' }; break }
          results[index] = { ...item, status: 'confirmed', message: '后台已确认保存' }
        } catch {
          results[index] = { ...item, status: 'unconfirmed', message: '更改未确认，请刷新核实；不会自动重试' }; break
        }
      }
      return results
    } finally { if (writing.current === write) { writing.current = null; if (live.current) setBusy(false) }; if (controller.current === abort) controller.current = null }
  }, [connected, connectionRevision, accept])
  const snapshotCurrent = connected && peer.current.connected && snapshotPeer.current === peer.current && snapshot !== null && snapshotRef.current === snapshot
  return { snapshot, snapshotCurrent, error, notice, busy, loading, refresh, mutate, mutateBulk, session: peer.current }
}
export type ActivityController = ReturnType<typeof useActivity>
