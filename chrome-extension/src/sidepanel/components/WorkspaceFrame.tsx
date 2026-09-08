import { useEffect, useRef, useState, type ReactNode } from "react"
import { useAgentStore } from "../store/agentStore"
import { displayThreadTitle, threadRecency } from "../utils/thread-timeline"
import { tokens } from "../ui/tokens"
import { CompanionMark, IconNewChat, IconSettings } from "../ui/icons"
import { CONTEXT_PANEL_TABS, useContextPanelHost } from "./ContextPanelHost"
import { createBlankThread } from "./ThreadList"

/** Presentation only: existing store, context loaders and thread.select own data. */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 760px)").matches)
  const [open, setOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(".cm-navigation-toggle")
    trigger?.setAttribute("aria-expanded", String(!wide && open))
    if (!wide && open) {
      triggerRef.current = trigger
      navRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    }
  }, [wide, open])
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  useEffect(() => {
    const query = window.matchMedia("(min-width: 760px)")
    const resize = () => { setWide(query.matches); setOpen(false) }
    const toggle = () => setOpen(value => !value)
    query.addEventListener("change", resize)
    window.addEventListener("cmspark:toggle-navigation", toggle)
    return () => { query.removeEventListener("change", resize); window.removeEventListener("cmspark:toggle-navigation", toggle) }
  }, [])
  return <div className="cm-workspace">
    {wide && <WorkspaceNavigation onNavigate={() => {}} />}
    {!wide && open && <div ref={navRef} className="cm-navigation-disclosure" role="dialog" aria-modal="false" aria-label="工作区导航" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
    }}>
      <WorkspaceNavigation onNavigate={close} onClose={close} />
    </div>}
    <main className="cm-workspace-main" aria-label="对话工作区">{children}</main>
  </div>
}

function WorkspaceNavigation({ onNavigate, onClose }: { onNavigate: () => void; onClose?: () => void }) {
  const { state, dispatch } = useAgentStore()
  const { activePanel, openPanelForce, closePanel } = useContextPanelHost()
  const [query, setQuery] = useState("")
  const recent = state.threads.filter(t => !t.trashed_at && displayThreadTitle(t).toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => threadRecency(b).localeCompare(threadRecency(a))).slice(0, 30)
  return <aside className="cm-navigation" aria-label="工作区">
    <div className="cm-nav-brand"><CompanionMark size={24} /><strong>CMspark</strong>
      {onClose && <button type="button" className="cm-icon-button" aria-label="关闭导航" onClick={onClose}>×</button>}
    </div>
    <button type="button" className="cm-nav-new" onClick={() => { createBlankThread(dispatch); onNavigate() }}><IconNewChat size={17} />新对话</button>
    <div className="cm-nav-section"><span>最近对话</span><button type="button" className="cm-nav-manage" disabled={state.pendingSecurityConfirmations.length > 0} onClick={() => { onNavigate(); window.dispatchEvent(new Event("cmspark:open-thread-manager")) }}>管理对话</button></div>
    <input className="cm-nav-search" aria-label="筛选最近对话" placeholder="查找对话…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="cm-nav-threads">
      {recent.map(thread => <button type="button" className="cm-nav-thread" key={thread.id} aria-current={thread.id === state.activeThreadId ? "page" : undefined}
        title={displayThreadTitle(thread)} onClick={() => {
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread.id }); chrome.runtime.sendMessage({ type: "thread.select", threadId: thread.id }); onNavigate()
        }}><span>{displayThreadTitle(thread)}</span>{state.threadBusyById[thread.id] && <span className="cm-nav-running" aria-label="运行中">·</span>}</button>)}
      {!recent.length && <p className="cm-nav-empty">{query ? "没有匹配的对话" : "新对话会保存在这里"}</p>}
    </div>
    <details className="cm-nav-tools"><summary>资料与工具</summary>
    <nav aria-label="资源与能力" className="cm-nav-resources">
      {CONTEXT_PANEL_TABS.filter(t => t.id !== "history").map(({ id, label, Icon }) => <button type="button" key={id} className="cm-nav-item" aria-current={activePanel === id ? "true" : undefined} onClick={() => {
        dispatch({ type: "SET_SETTINGS_OPEN", open: false }); openPanelForce(id); onNavigate()
      }}><Icon size={16} /><span>{label}</span></button>)}
    </nav>
    </details>
    <button type="button" className="cm-nav-item cm-nav-settings" onClick={() => { closePanel(); dispatch({ type: "SET_SETTINGS_OPEN", open: true }); onNavigate() }}><IconSettings size={16} />设置</button>
  </aside>
}
