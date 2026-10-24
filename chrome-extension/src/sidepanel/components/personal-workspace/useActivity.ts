import { useCallback, useEffect, useRef, useState } from 'react'
import { requestActivity, type ActivitySnapshot } from './activity-request'

export function useActivity(connected: boolean) {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const live = useRef(true), reading = useRef(false), writing = useRef(false)
  // Revisions belong to one connected service. A repaired/re-paired store can start at zero.
  const needsBaseline = useRef(true)
  const controller = useRef<AbortController | null>(null), readController = useRef<AbortController | null>(null)
  const accept = useCallback((value?: ActivitySnapshot) => {
    if (!value || !live.current) return
    const replace = needsBaseline.current
    needsBaseline.current = false
    setSnapshot(old => replace || !old || value.revision >= old.revision ? value : old)
  }, [])
  const refresh = useCallback(async () => {
    if (!connected || reading.current || writing.current) return
    reading.current = true; setLoading(true)
    const abort = new AbortController(); readController.current = abort
    try { const result = await requestActivity('activity.state', {}, abort.signal); if (!abort.signal.aborted) { accept(result.state); if (live.current) setError('') } }
    catch (e) { if (live.current && !abort.signal.aborted) setError((e as Error).message) }
    finally { if (readController.current === abort) { readController.current = null; reading.current = false; if (live.current) setLoading(false) } }
  }, [connected, accept])
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); readController.current?.abort() } }, [])
  useEffect(() => {
    if (!connected) { needsBaseline.current = true; return }
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 20_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); readController.current?.abort(); readController.current = null; reading.current = false; setLoading(false); controller.current?.abort() }
  }, [connected, refresh])
  const mutate = useCallback(async (type: string, data: Record<string, unknown>, success: string) => {
    if (!connected || writing.current) return false
    writing.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try {
      const result = await requestActivity(type, data, abort.signal)
      if (!live.current) return false
      accept(result.state); setNotice(success); return true
    } catch (e) { if (live.current) setError((e as Error).message); return false }
    finally { writing.current = false; if (live.current) setBusy(false); if (controller.current === abort) controller.current = null }
  }, [connected, accept])
  return { snapshot, error, notice, busy, loading, refresh, mutate }
}
export type ActivityController = ReturnType<typeof useActivity>
