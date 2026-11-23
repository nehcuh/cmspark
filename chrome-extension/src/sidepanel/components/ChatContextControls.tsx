import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useAgentStore } from "../store/agentStore"
import { IconGlobe, IconKnowledge, IconSkills } from "../ui/icons"
import { popupMenuStyles } from "../ui/popupMenuStyles"
import { tokens } from "../ui/tokens"
import { maxContextSources, saveChatContext, useChatContext } from "../utils/chat-context"
import { useContextPanelHostOptional } from "./ContextPanelHost"

export function ChatContextControls({ compact }: { compact: boolean }) {
  const { state } = useAgentStore()
  const host = useContextPanelHostOptional()
  const threadId = state.activeThreadId
  const options = useChatContext(threadId)
  const [open, setOpen] = useState(false)
  const [supported, setSupported] = useState(false)
  const [query, setQuery] = useState("")
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const dialogId = useId()

  useEffect(() => {
    let current = true
    setSupported(false)
    if (state.connectionState === "connected") {
      chrome.runtime.sendMessage({ type: "chat.context.support" }).then(
        response => { if (current) setSupported(response?.supported === true) },
        () => {},
      )
    }
    return () => { current = false }
  }, [state.connectionState])

  useEffect(() => {
    setOpen(false)
    setQuery("")
  }, [threadId])

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", outside)
    return () => document.removeEventListener("mousedown", outside)
  }, [open])

  const automaticKnowledge = options?.automatic_knowledge !== false
  const includePage = options?.include_page !== false
  const knowledge = options?.knowledge_ids || []
  const skills = options?.skill_ids
  const count = knowledge.length + (skills?.length || 0)
  const editable = supported && !!threadId
  const status = !threadId ? "请先新建对话" : !supported ? "请连接支持对话上下文控制的 Companion" : ""
  const update = (changes: NonNullable<typeof options>) => {
    if (editable && threadId) saveChatContext(threadId, { ...options, ...changes })
  }
  const togglePanel = () => {
    if (!open) {
      setQuery("")
      if (editable) {
        void chrome.runtime.sendMessage({ type: "knowledge.list" }).catch(() => {})
        void chrome.runtime.sendMessage({ type: "skill.refresh" }).catch(() => {})
      }
    }
    setOpen(!open)
  }
  const match = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const changeSelection = (id: string, list: string[]) =>
    list.includes(id) ? list.filter(item => item !== id) : [...list, id]
  const skillItems = state.skills.filter(skill =>
    skill.type !== "site_knowledge" && skill.type !== "domain_knowledge" && match(skill.name))
  const manualSkillList = skills || []
  const toggle = (title: string, pressed: boolean, action: () => void, icon: ReactNode) => (
    <button type="button" className="cm-icon-button" style={{ color: pressed ? tokens.text : tokens.textMuted, opacity: pressed ? 1 : 0.62 }}
      title={status || `${title} · ${pressed ? "已开启" : "已关闭"}`} aria-label={title}
      aria-pressed={pressed} disabled={!editable} onClick={action}>
      {icon}
    </button>
  )

  return (
    <div ref={root} className="cm-chat-context" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
      onKeyDown={event => {
        if (event.key !== "Escape" || !open) return
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }}>
      {!compact && <>
        {toggle("自动匹配知识", automaticKnowledge, () => update({ automatic_knowledge: !automaticKnowledge }), <IconKnowledge size={16} />)}
        {toggle("带入当前网页", includePage, () => update({ include_page: !includePage }), <IconGlobe size={16} />)}
      </>}
      <button ref={button} type="button" className="cm-icon-button" onClick={togglePanel}
        title={status || `对话上下文 · 知识${automaticKnowledge ? "自动" : "手动"} · 网页${includePage ? "开启" : "关闭"}`}
        aria-label="对话上下文" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
        style={{ color: count || !automaticKnowledge || !includePage || skills ? tokens.accent : tokens.textSecondary, gap: 3 }}>
        <IconSkills size={16} />
        {count > 0 && <span style={{ fontSize: 10 }}>{count}</span>}
      </button>
      {open && (
        <section id={dialogId} role="dialog" aria-label="对话上下文" style={{
          ...popupMenuStyles.menu, position: "absolute", insetInlineEnd: 8, top: "calc(100% + 8px)",
          width: "min(268px, 82vw)", zIndex: 49, padding: 10, fontSize: 12, gap: 7,
        }}>
          {!editable ? <span>{status}</span> : <>
            <label><input type="checkbox" checked={automaticKnowledge} onChange={event => update({ automatic_knowledge: event.target.checked })} /> 自动匹配知识</label>
            <label><input type="checkbox" checked={includePage} onChange={event => update({ include_page: event.target.checked })} /> 带入当前网页</label>
            <small style={{ color: tokens.textSecondary }}>引用的内容会发送给当前对话模型。</small>
            <input ref={search} type="search" aria-label="查找知识和技能" placeholder="查找知识和技能" value={query} onChange={event => setQuery(event.target.value)} />
            <fieldset style={{ minWidth: 0 }}>
              <legend>知识</legend>
              <div style={{ display: "grid", gap: 4, maxHeight: 108, overflowY: "auto" }}>
                {state.knowledgeDocs.filter(doc => match(doc.title || doc.name)).map(doc => {
                  const id = doc.id || doc.name
                  const selected = knowledge.includes(id)
                  return <label key={id}><input type="checkbox" checked={selected}
                    disabled={!selected && knowledge.length >= maxContextSources}
                    onChange={() => update({ knowledge_ids: changeSelection(id, knowledge) })} /> {doc.title || doc.name}</label>
                })}
                {state.knowledgeDocs.length === 0 && <span>暂无可选知识</span>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {host && <button type="button" onClick={() => { setOpen(false); void host.openPanelForce("knowledge") }}>管理知识</button>}
                {knowledge.length > 0 && <button type="button" onClick={() => update({ knowledge_ids: [] })}>清除选择</button>}
              </div>
            </fieldset>
            <fieldset style={{ minWidth: 0 }}>
              <legend>技能</legend>
              <label><input type="checkbox" checked={skills !== undefined}
                onChange={event => update({ skill_ids: event.target.checked ? [] : undefined })} /> 仅列出所选技能</label>
              <div style={{ display: "grid", gap: 4, maxHeight: 108, overflowY: "auto" }}>
                {skillItems.map(skill => {
                  const selected = manualSkillList.includes(skill.name)
                  return <label key={skill.name}><input type="checkbox" checked={selected}
                    disabled={!selected && manualSkillList.length >= maxContextSources}
                    onChange={() => update({ skill_ids: changeSelection(skill.name, manualSkillList) })} /> {skill.name}</label>
                })}
                {state.skills.length === 0 && <span>暂无可选技能</span>}
              </div>
              {host && <button type="button" style={{ marginTop: 4 }} onClick={() => { setOpen(false); void host.openPanelForce("skills") }}>管理技能</button>}
            </fieldset>
          </>}
        </section>
      )}
    </div>
  )
}
