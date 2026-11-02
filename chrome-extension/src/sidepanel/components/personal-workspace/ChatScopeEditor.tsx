import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { requestActivity, type ActivityApp, type ActivityChatProfile, type ActivityChatScope, type ActivityPreview, type ActivityRect } from './activity-request'

export const profileLayoutKey = (p: Pick<ActivityChatProfile, 'window_class' | 'width' | 'height'>): string => JSON.stringify([p.window_class, p.width, p.height])
export function validScopeRect(r: ActivityRect | null, width: number, height: number): r is ActivityRect {
  return !!r && [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height
}
export const titleInsideContent = (content: ActivityRect, title: ActivityRect): boolean => title.x >= content.x && title.y >= content.y && title.x + title.width <= content.x + content.width && title.y + title.height <= content.y + content.height
export function dragScopeRect(a: { x: number; y: number }, b: { x: number; y: number }): ActivityRect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
function switchDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); resolve() }
    const timer = setTimeout(finish, 5000)
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('预览等待已取消')) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}
function RectInputs({ label, rect, change, disabled }: { label: string; rect: ActivityRect | null; change: (r: ActivityRect) => void; disabled: boolean }) {
  return <fieldset className="cm-chat-scope-coordinates" disabled={disabled}><legend>{label}</legend>{(['x', 'y', 'width', 'height'] as const).map((key, index) => <label key={key}>{['左边距', '上边距', '宽', '高'][index]}<input aria-label={`${label} ${key}`} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={8192} step={1} value={rect?.[key] ?? ''} onChange={e => change({ x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0, [key]: Number(e.target.value) })} /></label>)}</fieldset>
}

export function ChatScopeEditor({ appIds, apps, scopes, language, busy, onChange }: { appIds: string[]; apps: ActivityApp[]; scopes: ActivityChatScope[]; language: 'zh-Hans' | 'zh-Hant' | 'en-US'; busy: boolean; onChange: (value: ActivityChatScope[]) => void }) {
  const [editingApp, setEditingApp] = useState<string | null>(null), [preview, setPreview] = useState<ActivityPreview | null>(null)
  const [content, setContent] = useState<ActivityRect | null>(null), [title, setTitle] = useState<ActivityRect | null>(null), [drawing, setDrawing] = useState<'content' | 'title'>('content')
  const [recognized, setRecognized] = useState<string | null>(null), [names, setNames] = useState(''), [phase, setPhase] = useState<'waiting' | 'preview' | 'ocr' | null>(null), [error, setError] = useState('')
  const version = useRef(0), request = useRef<AbortController | null>(null), image = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ x: number; y: number; kind: 'content' | 'title'; pointer: number } | null>(null)
  const originalLanguage = useRef(language)
  function invalidate() { version.current++; request.current?.abort(); request.current = null; setRecognized(null); setPhase(null) }
  function close() { invalidate(); setEditingApp(null); setPreview(null); setContent(null); setTitle(null); setNames(''); setError('') }
  useEffect(() => () => { version.current++; request.current?.abort() }, [])
  useEffect(() => { invalidate() }, [language])
  useEffect(() => { if (editingApp && !appIds.includes(editingApp)) close() }, [appIds.join('\n')])
  const appName = (id: string) => apps.find(app => app.app_id === id)?.app_name || id
  function updateApp(id: string, profiles: ActivityChatProfile[] | null) {
    const next = scopes.filter(scope => scope.app_id !== id)
    if (profiles !== null) next.push({ app_id: id, profiles })
    onChange(next)
  }
  async function capture(id: string) {
    close(); setEditingApp(id); setPhase('waiting')
    const controller = new AbortController(), own = version.current; request.current = controller
    try {
      await switchDelay(controller.signal)
      if (own !== version.current) return
      setPhase('preview')
      const reply = await requestActivity('activity.preview', { app_id: id }, controller.signal)
      if (own !== version.current) return
      setPreview(reply.preview!); setDrawing('content')
    } catch (e) { if (own === version.current) setError((e as Error).message) }
    finally { if (own === version.current) setPhase(null) }
  }
  function changeRect(kind: 'content' | 'title', rect: ActivityRect) {
    invalidate(); setError(''); setNames('')
    if (kind === 'content') { setContent(rect); if (title && !titleInsideContent(rect, title)) setTitle(null) }
    else setTitle(rect)
  }
  function point(e: PointerEvent) {
    const bounds = image.current?.getBoundingClientRect()
    if (!preview || !bounds?.width || !bounds.height) return null
    return { x: Math.max(0, Math.min(preview.width, Math.round((e.clientX - bounds.left) * preview.width / bounds.width))), y: Math.max(0, Math.min(preview.height, Math.round((e.clientY - bounds.top) * preview.height / bounds.height))) }
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (busy || phase === 'waiting' || phase === 'preview' || e.button !== 0) return
    const p = point(e); if (!p) return
    invalidate(); drag.current = { ...p, kind: drawing, pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault()
  }
  function move(e: PointerEvent<HTMLDivElement>) { const start = drag.current, end = point(e); if (start && end && start.pointer === e.pointerId) changeRect(start.kind, dragScopeRect(start, end)) }
  function up(e: PointerEvent<HTMLDivElement>) { move(e); drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }
  const rectsValid = !!preview && validScopeRect(content, preview.width, preview.height) && validScopeRect(title, preview.width, preview.height) && titleInsideContent(content, title)
  async function readTitle() {
    if (!preview || !rectsValid) return
    invalidate(); setError(''); setNames(''); setPhase('ocr')
    const controller = new AbortController(), own = version.current; request.current = controller
    try {
      const reply = await requestActivity('activity.preview_ocr', { image_base64: preview.image_data_url.slice('data:image/png;base64,'.length), rect: title, ocr_language: language }, controller.signal)
      if (own !== version.current) return
      setRecognized(reply.recognized_title!); setNames(reply.recognized_title!)
      if (!reply.recognized_title) setError('未读到标题；请只框当前聊天标题，并核对本机 OCR 语言。')
    } catch (e) { if (own === version.current) setError((e as Error).message) }
    finally { if (own === version.current) setPhase(null) }
  }
  const allowed = [...new Set(names.split('\n').map(value => value.trim()).filter(Boolean))]
  const namesValid = allowed.length > 0 && allowed.length <= 20 && allowed.every(value => value.length <= 200)
  const editingScope = scopes.find(scope => scope.app_id === editingApp)
  const replacing = preview && editingScope?.profiles.some(p => profileLayoutKey(p) === profileLayoutKey(preview))
  function addProfile() {
    if (!editingApp || !preview || !rectsValid || !recognized || !namesValid) return
    const profile = { window_class: preview.window_class, width: preview.width, height: preview.height, content: content!, title: title!, allowed_titles: allowed }
    const profiles = (scopes.find(scope => scope.app_id === editingApp)?.profiles || []).filter(p => profileLayoutKey(p) !== profileLayoutKey(profile))
    if (profiles.length >= 8) { setError('每个应用最多保留 8 种窗口布局；请先移除不再使用的范围。'); return }
    updateApp(editingApp, [...profiles, profile]); close()
  }
  function overlay(rect: ActivityRect | null, kind: string) { return preview && rect && <span aria-hidden="true" className={`cm-chat-scope-box cm-chat-scope-box-${kind}`} style={{ left: `${rect.x * 100 / preview.width}%`, top: `${rect.y * 100 / preview.height}%`, width: `${rect.width * 100 / preview.width}%`, height: `${rect.height * 100 / preview.height}%` }}>{kind === 'content' ? '聊天内容' : '当前标题'}</span> }
  return <section className="cm-personal-wide cm-chat-scopes" aria-label="指定聊天范围"><h2>指定群聊或联系人</h2><p className="cm-personal-fieldnote">可为主窗口和独立聊天窗口分别校准。只处理框选聊天内容；左侧其它聊天预览不进入识别。更改窗口大小、布局或缩放后，请重新校准。</p>
    {!appIds.length && <p className="cm-personal-fieldnote">先在上方选择聊天应用。</p>}
    {originalLanguage.current !== language && <p role="status" className="cm-personal-fieldnote">OCR 语言已变化，请重新核对已有标题范围；当前预检结果已清除。</p>}
    {appIds.map(id => { const scope = scopes.find(item => item.app_id === id); return <div className="cm-chat-scope-app" key={id}><label className="cm-personal-check"><input type="checkbox" checked={!!scope} disabled={busy || !!phase} onChange={e => { if (editingApp === id) close(); updateApp(id, e.target.checked ? [] : null) }} />{appName(id)}：仅记录指定对话</label>
      {scope && <><p className="cm-personal-fieldnote">{scope.profiles.length ? '以下范围保存后生效；标题不匹配时跳过。' : '尚未校准；保存后该应用会跳过采集，不会回退为整窗记录。'}</p>
        {scope.profiles.map((profile, index) => <div className="cm-chat-scope-profile" key={profileLayoutKey(profile)}><div><strong>{profile.allowed_titles.join('、')}</strong><p className="cm-personal-fieldnote">适用窗口 {profile.width} × {profile.height} · 仅保留所选聊天区域</p></div><button type="button" className="cm-p-link" disabled={busy || !!phase} onClick={() => updateApp(id, scope.profiles.filter((_, i) => i !== index))}>移除此范围</button></div>)}
        <button type="button" className="cm-p-button" disabled={busy || !!phase} onClick={() => void capture(id)}>本机预览并校准：{appName(id)}</button></>}
    </div> })}
    {editingApp && <div className="cm-chat-scope-calibration"><div className="cm-personal-section-title"><h3>校准 {appName(editingApp)}</h3><button type="button" className="cm-p-link" onClick={close}>取消预览</button></div>
      <p className="cm-personal-fieldnote">仅本机整窗预览用于画框，不保存来源、不调用模型。采集正忙时请稍后重试；大于 6 MiB 时请缩小窗口后重试。</p>
      {phase === 'waiting' && <p role="status">请在 5 秒内手动切到目标聊天窗口；不会替你切换应用。</p>}{phase === 'preview' && <p role="status">正在读取当前前台聊天窗口…</p>}
      {preview && <><div className="cm-chat-scope-steps"><button type="button" className="cm-p-button" aria-pressed={drawing === 'content'} onClick={() => setDrawing('content')}>1. 框聊天内容（包含标题）</button><button type="button" className="cm-p-button" aria-pressed={drawing === 'title'} onClick={() => setDrawing('title')}>2. 框当前聊天标题</button></div>
        <div className="cm-chat-scope-preview" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }}><img ref={image} src={preview.image_data_url} alt="当前聊天窗口的本机预览" draggable={false} onLoad={e => { if (e.currentTarget.naturalWidth !== preview.width || e.currentTarget.naturalHeight !== preview.height) { invalidate(); setPreview(null); setError('预览尺寸不一致，请重新获取窗口预览。') } }} />{overlay(content, 'content')}{overlay(title, 'title')}</div>
        <p className="cm-personal-fieldnote">聊天内容框请排除侧栏；标题框只放当前群聊或联系人标题，不要框侧栏条目或消息正文。</p>
        <details><summary>用像素精确调整区域</summary><RectInputs label="聊天内容" rect={content} change={r => changeRect('content', r)} disabled={busy} /><RectInputs label="聊天标题" rect={title} change={r => changeRect('title', r)} disabled={busy} /></details>
        {!rectsValid && <p className="cm-personal-fieldnote">需要两个有效区域，标题框须完全位于聊天内容框内。</p>}
        <button type="button" className="cm-p-button" disabled={busy || !!phase || !rectsValid} onClick={() => void readTitle()}>{phase === 'ocr' ? '正在本机核对标题…' : '3. 本机识别标题'}</button>
        {recognized && <><p role="status">实际识别标题：<strong>{recognized}</strong></p><label>允许的完整标题（每行一个，最多 20 个）<textarea value={names} onChange={e => setNames(e.target.value)} disabled={busy || !!phase} /></label><p className="cm-personal-fieldnote">按完整识别文字匹配，保留空格、标点及群人数。同名对话无法据此区分；可填写完整标题变体。</p><button type="button" className="cm-p-button" disabled={busy || !!phase || !rectsValid || !namesValid} onClick={addProfile}>{replacing ? '替换此窗口布局的范围草稿' : '添加范围草稿'}</button><p className="cm-personal-fieldnote">添加后仍需点击“保存范围与隐私设置”。</p></>}
      </>}{error && <p role="alert">{error}</p>}
    </div>}
  </section>
}
