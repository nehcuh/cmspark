import { useEffect, useRef, useState, type FormEvent } from 'react'
import { requestMini, type MiniDoc, type MiniSearchHit, type MiniTarget } from '../utils/mini-request'
import '../styles/mini.css'

const names = { ask: '截图问答', ocr: '截图 OCR', capture: '区域截图', search: '资料搜索' }
type View = keyof typeof names
const selected = new URLSearchParams(location.search).get('view')
const view: View = selected && Object.hasOwn(names, selected) ? selected as View : 'search'

function sourceLabel(item: { role?: 'user' | 'assistant'; created_at?: string; folder?: string }) {
  if (!item.role) return ['知识库', item.folder].filter(Boolean).join(' · ')
  const date = item.created_at && new Date(item.created_at)
  return ['历史对话', item.role === 'user' ? '我' : '助手', date && !isNaN(date.getTime()) && date.toLocaleString()].filter(Boolean).join(' · ')
}

function hitKey(hit: MiniSearchHit) {
  return JSON.stringify([hit.kind, hit.id, hit.message_id])
}

export default function MiniPage() {
  const [image, setImage] = useState('')
  const [target, setTarget] = useState<MiniTarget>()
  const [input, setInput] = useState('')
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<{ question: string; answer: string; model: string }[]>([])
  const [hits, setHits] = useState<MiniSearchHit[]>()
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [nextOffset, setNextOffset] = useState<number>()
  const matchRef = useRef<HTMLElement>(null)
  const returnToHit = useRef<string>()
  const [doc, setDoc] = useState<MiniDoc>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const started = useRef(false)
  const resultText = useRef<HTMLTextAreaElement>(null)

  async function recognize(encoded: string) {
    const result = await requestMini('ocr', { image_base64: encoded })
    if (!result.ok) throw new Error(result.error || '文字识别失败')
    setText(result.text || '')
    setNotice(result.text?.trim() ? '' : '选区内没有识别到文字')
  }

  useEffect(() => {
    document.title = names[view] + ' · CMspark'
    if (started.current || view === 'search') return
    started.current = true
    const ticket = location.hash.slice(1)
    setBusy(true)
    void requestMini('claim', { action: view, ticket }).then(async result => {
      if (!result.ok || !result.image_base64) throw new Error(result.error || '截图已过期，请重新框选')
      setImage(result.image_base64)
      setTarget(result.target)
      if (view === 'ocr') await recognize(result.image_base64)
    }).catch(err => setError(err.message)).finally(() => setBusy(false))
  }, [])

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try { await work() } catch (err) { setError(err instanceof Error ? err.message : '操作失败，请重试') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (doc?.highlight) matchRef.current?.scrollIntoView({ block: 'center' })
    else if (!doc && returnToHit.current) {
      document.getElementById(returnToHit.current)?.focus()
      returnToHit.current = undefined
    }
  }, [doc])

  async function search(query: string, offset = 0) {
    if (offset === 0) {
      returnToHit.current = undefined
      setDoc(undefined)
      setHits(undefined)
      setNextOffset(undefined)
    }
    const result = await requestMini('search', { query, scope: 'passages', offset })
    if (!result.ok) throw new Error(result.error || '搜索失败，请重试')
    if (typeof result.has_more !== 'boolean') throw new Error('请更新本机 Companion 后搜索知识正文和历史对话')
    const rows = result.hits || []
    setSubmittedQuery(query)
    setNextOffset(result.has_more ? offset + rows.length : undefined)
    setHits(previous => {
      if (!offset || !previous) return rows
      const combined = new Map(previous.map(hit => [hitKey(hit), hit]))
      for (const hit of rows) combined.set(hitKey(hit), hit)
      return [...combined.values()]
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const query = input.trim()
    if (!query) return
    void run(async () => {
      if (view === 'search') {
        await search(query)
      } else {
        const result = await requestMini('ask', { image_base64: image, expected_target: target?.id, question: query })
        if (result.target) setTarget(result.target)
        if (!result.ok) throw new Error(result.error)
        setTurns(history => [...history, { question: query, answer: result.text || '', model: result.model || '' }])
        setInput('')
      }
    })
  }

  function read(hit: MiniSearchHit) {
    void run(async () => {
      const source = hit.kind === 'message' ? { thread_id: hit.id, message_id: hit.message_id } : { doc_id: hit.id }
      const result = await requestMini('read', { scope: 'passages', kind: hit.kind, query: submittedQuery, ...source })
      if (!result.ok || !result.doc) throw new Error(result.error || '未取得资料正文')
      returnToHit.current = hitKey(hit)
      setDoc(result.doc)
    })
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(text); setNotice('已复制文字') }
    catch { resultText.current?.focus(); resultText.current?.select(); setNotice('已选中文字，请按 Ctrl+C 或 ⌘C 复制') }
  }

  const dataUrl = image ? 'data:image/png;base64,' + image : ''
  const canSubmit = input.trim() && !busy && (view === 'search' || (target && !target.unavailable && image))
  return <main className="mini-tools">
    <header><span className="mini-brand">CMspark Mini</span><h1>{names[view]}</h1></header>
    {image && <img className="mini-preview" src={dataUrl} alt="框选的屏幕区域" />}
    {view === 'capture' && image && <div className="mini-actions">
      <a className="mini-primary" href={dataUrl} download="CMspark-截图.png">保存 PNG</a>
      <button onClick={() => void run(async () => {
        const blob = await (await fetch(dataUrl)).blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setNotice('已复制截图')
      })}>复制截图</button>
    </div>}
    {view === 'ocr' && text && <>
      <label htmlFor="ocr-text">识别文字</label>
      <textarea id="ocr-text" ref={resultText} value={text} onChange={event => setText(event.target.value)} rows={8} />
      <button onClick={() => void copyText()}>复制文字</button>
    </>}
    {view === 'ocr' && image && !text && !busy && <button onClick={() => void run(() => recognize(image))}>重新识别</button>}
    {view === 'ask' && target && <p className="mini-model">发送目标 · {target.label}
      {target.unavailable && <button disabled={busy} onClick={() => void run(async () => {
        const result = await requestMini('target', {})
        if (!result.ok || !result.target) throw new Error(result.error || '无法读取图像模型设置')
        setTarget(result.target)
      })}>重新读取设置</button>}
    </p>}
    {(view === 'ask' || view === 'search') && <form onSubmit={submit}>
      <label htmlFor="mini-query">{view === 'ask' ? '关于这张截图，你想问什么？' : '搜索知识库和历史对话'}</label>
      <div className="mini-query"><input id="mini-query" autoFocus maxLength={view === 'ask' ? 4000 : 120}
        value={input} onChange={event => setInput(event.target.value)} autoComplete="off" disabled={busy} />
        <button className="mini-primary" disabled={!canSubmit}>{view === 'ask' ? '发送截图' : '搜索'}</button></div>
    </form>}
    {busy && <p role="status">{view === 'ocr' ? '正在本机识别文字…' : view === 'ask' && image ? '正在等待模型回答…' : '正在读取…'}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!!turns.length && <section aria-label="截图问答记录">{turns.slice().reverse().map((turn, index) => <article key={turns.length - index}>
      <h2>{turn.question}</h2><div className="mini-prose">{turn.answer}</div><small>{turn.model}</small>
    </article>)}</section>}
    {view === 'search' && (doc ? <article><button className="mini-back" onClick={() => setDoc(undefined)}>返回搜索结果</button>
      <small>{sourceLabel(doc)}</small><h2>{doc.title}</h2>
      <div className="mini-prose">{doc.highlight ? <>
        {doc.body.slice(0, doc.highlight.start)}
        <mark ref={matchRef}>{doc.body.slice(doc.highlight.start, doc.highlight.start + doc.highlight.length)}</mark>
        {doc.body.slice(doc.highlight.start + doc.highlight.length)}
      </> : doc.body}</div>{doc.truncated && <small>当前显示部分原文。</small>}</article> :
      hits && <section aria-label="搜索结果">{hits.length === 0 ? <p>知识库和历史对话里都没有找到“{submittedQuery}”。</p> : hits.map(hit =>
        <button key={hitKey(hit)} id={hitKey(hit)} className="mini-hit" disabled={busy} onClick={() => read(hit)}><small>{sourceLabel(hit)}</small><strong>{hit.title}</strong>
          {hit.snippet !== hit.title && <span>{hit.snippet}</span>}</button>)}
        {nextOffset !== undefined && <button className="mini-more" disabled={busy} onClick={() => void run(() => search(submittedQuery, nextOffset))}>更多结果</button>}
      </section>)}
  </main>
}
