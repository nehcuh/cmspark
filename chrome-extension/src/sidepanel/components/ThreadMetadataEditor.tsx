import { useEffect, useRef, useState } from "react"
import type { Thread } from "../types"
import { saveThreadMetadata } from "../utils/thread-management"

export function ThreadMetadataEditor({ thread, folders, onSaved, onClose }: {
  thread: Thread; folders: string[]; onSaved: (thread: Thread) => void; onClose: () => void
}) {
  const [tags, setTags] = useState((thread.user_tags || []).join("，"))
  const [folder, setFolder] = useState(thread.topic_folder || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  const firstInput = useRef<HTMLInputElement>(null)
  useEffect(() => { firstInput.current?.focus(); return () => controller.current?.abort() }, [])
  return <form className="cm-thread-editor" aria-label="编辑对话分类" onSubmit={async event => {
    event.preventDefault()
    if (controller.current) return
    const userTags = tags.split(/[,，\n]/).map(tag => tag.normalize("NFC").replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean)
    if (userTags.length > 20 || userTags.some(tag => tag.length > 40)) { setError("最多20个标签，每个不超过40字"); return }
    const request = new AbortController()
    controller.current = request
    setSaving(true); setError("")
    try {
      const saved = await saveThreadMetadata(thread.id, { user_tags: userTags, topic_folder: folder.normalize("NFC").replace(/[\x00-\x1F\x7F\\/]/g, "").trim() || null }, request.signal)
      if (!request.signal.aborted) onSaved(saved)
    } catch (error) {
      if (!request.signal.aborted) setError(error instanceof Error ? error.message : "保存失败")
    } finally {
      controller.current = null
      if (!request.signal.aborted) setSaving(false)
    }
  }}>
    <strong>编辑标签与分组</strong>
    <label>人工标签<input ref={firstInput} value={tags} onChange={event => setTags(event.target.value)} disabled={saving} placeholder="用逗号分隔，例如：支付，待跟进" /></label>
    <p>人工标签单独保存，不会被 AI 提取覆盖。AI 标签：{thread.digest?.tags?.join("、") || "尚未提取"}（只读）</p>
    <label>手动分组<input list="cm-thread-folders" value={folder} onChange={event => setFolder(event.target.value)} disabled={saving} maxLength={40} placeholder="选择已有分组或输入新名称；留空移出" /></label>
    <datalist id="cm-thread-folders">{folders.map(name => <option key={name} value={name} />)}</datalist>
    {error && <p role="alert">{error}</p>}
    <div className="cm-thread-editor-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" disabled={saving}>{saving ? "等待保存确认…" : "保存分类"}</button></div>
  </form>
}
