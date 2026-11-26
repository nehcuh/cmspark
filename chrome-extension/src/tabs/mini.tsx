import { useEffect, useRef, useState, type FormEvent } from 'react'
import { requestMini, type MiniDoc, type MiniSearchHit, type MiniTarget } from '../utils/mini-request'
import '../styles/mini.css'

const names = { ask: '截图问答', ocr: '截图 OCR', capture: '区域截图', search: '资料搜索' }
type View = keyof typeof names
const selected = new URLSearchParams(location.search).get('view')
const view: View = selected && Object.hasOwn(names, selected) ? selected as View : 'search'

export default function MiniPage() {
  const [image, setImage] = useState('')
  const [target, setTarget] = useState<MiniTarget>()
  const [input, setInput] = useState('')
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<{ question: string; answer: string; model: string }[]>([])
  const [hits, setHits] = useState<MiniSearchHit[]>()
  const [doc, setDoc] = useState<MiniDoc>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const started = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
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

  function submit(event: FormEvent) {
    event.preventDefault()
    const query = input.trim()
    if (!query) return
    void run(async () => {
      if (view === 'search') {
        setDoc(undefined)
        const result = await requestMini('search', { query })
        if (!result.ok) throw new Error(result.error)
        setHits(result.hits || [])
      } else {
        const result = await requestMini('ask', { image_base64: image, expected_target: target?.id, question: query })
        if (result.target) setTarget(result.target)
        if (!result.ok) throw new Error(result.error)
        setTurns(history => [...history, { question: query, answer: result.text || '', model: result.model || '' }])
        setInput('')
      }
    })
  }

  function read(id: string) {
    void run(async () => {
      const result = await requestMini('read', { doc_id: id })
      if (!result.ok || !result.doc) throw new Error(result.error || '未取得资料正文')
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
      <label htmlFor="mini-query">{view === 'ask' ? '关于这张截图，你想问什么？' : '搜索知识库中的资料名称、描述或标签'}</label>
      <div className="mini-query"><input id="mini-query" ref={inputRef} autoFocus maxLength={view === 'ask' ? 4000 : 120}
        value={input} onChange={event => setInput(event.target.value)} autoComplete="off" disabled={busy} />
        <button className="mini-primary" disabled={!canSubmit}>{view === 'ask' ? '发送截图' : '搜索'}</button></div>
    </form>}
    {busy && <p role="status">{view === 'ocr' ? '正在本机识别文字…' : view === 'ask' && image ? '正在等待模型回答…' : '正在读取…'}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!!turns.length && <section aria-label="截图问答记录">{turns.slice().reverse().map((turn, index) => <article key={turns.length - index}>
      <h2>{turn.question}</h2><div className="mini-prose">{turn.answer}</div><small>{turn.model}</small>
    </article>)}</section>}
    {view === 'search' && (doc ? <article><button className="mini-back" onClick={() => { setDoc(undefined); inputRef.current?.focus() }}>返回搜索结果</button>
      <h2>{doc.title}</h2><div className="mini-prose">{doc.body}</div>{doc.truncated && <p>当前显示资料预览。</p>}</article> :
      hits && <section aria-label="搜索结果">{hits.length === 0 ? <p>没有找到匹配的资料。</p> : hits.map(hit =>
        <button key={hit.id} className="mini-hit" disabled={busy} onClick={() => read(hit.id)}><strong>{hit.title}</strong>
          {hit.folder && <small>{hit.folder}</small>}{hit.snippet !== hit.title && <span>{hit.snippet}</span>}</button>)}</section>)}
  </main>
}
