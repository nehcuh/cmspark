import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { tokens } from '../../ui/tokens'
import { recognitionLabel } from './RecentActivitySources'
import { selectWindowFrame } from './WindowScreenshotImport'
import type { ActivityController } from './useActivity'
import { requestMini } from '../../../utils/mini-request'

type FloatingWindow = { requestWindow(options: { width: number; height: number }): Promise<Window> }

export function ScreenshotTodoEntry({ controller, connected, active, review, configure, navigateToTodos, manual }: {
  controller: ActivityController
  connected: boolean
  active: boolean
  review: (id: string) => void
  configure: () => void
  navigateToTodos: () => void
  manual: (sourceId: string) => ReactNode
}) {
  const { snapshot, busy, mutate } = controller
  const [expanded, setExpanded] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).get('capture') === 'todo')
  const [preview, setPreview] = useState(''), [sourceId, setSourceId] = useState('')
  const [error, setError] = useState(''), [selecting, setSelecting] = useState(false)
  const [floating, setFloating] = useState<Window | null>(null)
  const popup = useRef<Window | null>(null), capture = useRef<AbortController | null>(null), alive = useRef(false)
  const panel = useRef<HTMLElement>(null)
  const claimed = useRef('')
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; capture.current?.abort(); popup.current?.close() }
  }, [])

  useEffect(() => {
    if (active && expanded) panel.current?.focus()
  }, [active, expanded])
  useEffect(() => {
    const reopen = () => {
      const hash = window.location.hash || ''
      if (!hash.startsWith('#todos/capture/')) return
      setExpanded(true)
      const ticket = hash.match(/^#todos\/capture\/mini\/([a-f\d-]{36})$/i)?.[1]
      if (!connected || !ticket || ticket === claimed.current) return
      claimed.current = ticket
      setError('')
      void requestMini('claim', { action: 'todo', ticket }).then(result => {
        if (!alive.current || claimed.current !== ticket) return
        if (!result.ok || !result.image_base64) throw new Error(result.error || '未取得截图')
        setPreview('data:image/png;base64,' + result.image_base64)
        setSourceId('')
      }).catch(error => { if (alive.current && claimed.current === ticket) setError(error.message) })
    }
    reopen()
    window.addEventListener('hashchange', reopen)
    return () => window.removeEventListener('hashchange', reopen)
  }, [connected])
  const pip = typeof window === 'undefined' ? undefined : (window as Window & { documentPictureInPicture?: FloatingWindow }).documentPictureInPicture
  const source = snapshot?.sources.find(item => item.id === sourceId && !item.deleted)
  const candidates = snapshot?.candidates.filter(item => item.status === 'pending' && item.evidence.source_id === sourceId) || []
  const imageMode = (snapshot?.config.extraction_mode ?? 'ocr') !== 'ocr'
  const authorized = imageMode ? snapshot?.config.image_ai_enabled : snapshot?.config.ocr_ai_enabled
  const target = snapshot?.runtime.model_target_id
  const unavailable = !connected || !controller.snapshotCurrent || busy || selecting
  function showPanel() {
    navigateToTodos(); setExpanded(true)
    requestAnimationFrame(() => { panel.current?.scrollIntoView?.({ block: 'nearest' }); panel.current?.focus() })
  }
  async function select(read: (signal: AbortSignal) => Promise<string>) {
    if (capture.current || unavailable) return
    const owner = new AbortController()
    capture.current = owner; setSelecting(true); setError('')
    try {
      const data = await read(owner.signal)
      if (!owner.signal.aborted) { setPreview(data); setSourceId('') }
    } catch (e) {
      if (!owner.signal.aborted) setError((e as Error).name === 'NotAllowedError' ? '选窗已取消。也可以使用系统截图后粘贴。' : (e as Error).message)
    } finally {
      if (!owner.signal.aborted) setSelecting(false)
      capture.current = null
    }
  }
  function readFile(file: File) {
    void select(async () => {
      if (file.type !== 'image/png' || !file.size || file.size > 6 * 1024 * 1024) throw new Error('请选择不超过 6 MiB 的 PNG 截图。')
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('截图读取失败，请重新选择。'))
        reader.readAsDataURL(file)
      })
    })
  }
  const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia &&
    typeof HTMLVideoElement !== 'undefined' && !!HTMLVideoElement.prototype.requestVideoFrameCallback
  function captureWindow() {
    showPanel()
    if (canCapture) void select(selectWindowFrame)
  }
  async function openFloating() {
    if (!pip) return
    if (popup.current && !popup.current.closed) { popup.current.focus(); return }
    try {
      const win = await pip.requestWindow({ width: 180, height: 72 })
      if (!alive.current) { win.close(); return }
      popup.current = win
      win.document.title = '截图录待办'
      win.document.body.style.margin = '0'
      win.addEventListener('pagehide', () => {
        if (popup.current === win) { popup.current = null; if (alive.current) setFloating(null) }
      }, { once: true })
      setFloating(win)
    } catch { setExpanded(true); setError('当前窗口无法置顶，可以在这里选窗或粘贴截图。') }
  }
  return <section ref={panel} tabIndex={-1} aria-label="截图录待办" className="cm-personal-config-section" onPaste={event => {
    if (!expanded || unavailable) return
    const file = Array.from(event.clipboardData.items).find(item => item.type === 'image/png')?.getAsFile()
    if (file) { event.preventDefault(); readFile(file) }
  }}>
    <div className="cm-personal-actions"><button type="button" className="cm-p-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>截图录待办</button>
      {pip && <button type="button" className="cm-p-link" onClick={() => void openFloating()}>{floating ? '显示桌面小窗' : '置顶桌面小窗'}</button>}
    </div>
    {floating && createPortal(<button type="button" disabled={unavailable} onClick={() => { window.focus(); captureWindow() }}
      style={{ width: '100%', height: '100vh', cursor: 'pointer', border: 0, background: tokens.actionPrimary, color: tokens.actionInk, font: '600 15px ' + tokens.font }}>截图录待办</button>, floating.document.body)}
    {expanded && <>
      <p className="cm-personal-fieldnote">选一个窗口，或用系统截图框选任意屏幕的区域，再把截图粘贴到这里。</p>
      <div className="cm-personal-actions">{canCapture && <button type="button" className="cm-p-button" disabled={unavailable} onClick={captureWindow}>{selecting ? '正在读取截图…' : '选择窗口截图'}</button>}
        <label className="cm-personal-fieldnote">导入 PNG <input type="file" accept="image/png" disabled={unavailable} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) readFile(file) }} /></label>
      </div>
      {error && <p role="alert">{error}</p>}
      {preview && <div><img className="cm-personal-source-image" src={preview} alt="待识别的截图" />
        <p className="cm-personal-fieldnote">{snapshot?.runtime.model_target}。{imageMode ? '确认后发送这张截图。' : '确认后在本机识别文字，再发送文字抽取待办。'}</p>
        <button type="button" className="cm-p-button cm-p-primary" disabled={unavailable || !authorized || !target} onClick={async () => {
          setError('')
          const saved = await mutate('activity.import', { image_base64: preview.slice(preview.indexOf(',') + 1), expected_model_target: target }, '截图已提交。', reply => {
            if (reply.source_id) { setSourceId(reply.source_id); setPreview('') }
            else setError('当前 Companion 未返回截图编号，请在活动记录核对并更新 Companion。')
          })
          if (!saved) setError('截图尚未确认提交，请核对工作台提示后重试。')
        }}>识别待办</button>
        <button type="button" className="cm-p-link" disabled={busy} onClick={() => setPreview('')}>丢弃截图</button>
      </div>}
      {!authorized && <button type="button" className="cm-p-link" onClick={configure}>前往活动记录授权待办识别</button>}
      {source && <div><p role="status">{recognitionLabel(source.recognition)}</p>
        {(source.recognition?.status === 'failed' || source.recognition?.status === 'saved') && <button type="button" className="cm-p-button" disabled={unavailable || !authorized} onClick={() => void mutate('activity.analyze', { source_id: source.id, queue_only: true }, '已重新提交识别。')}>重试识别</button>}
        {source.recognition?.status === 'complete' && candidates.map(candidate => <button className="cm-personal-row" type="button" key={candidate.id} onClick={() => review(candidate.id)}>{candidate.title} · 核对草稿</button>)}
        {manual(source.id)}
      </div>}
    </>}
  </section>
}
