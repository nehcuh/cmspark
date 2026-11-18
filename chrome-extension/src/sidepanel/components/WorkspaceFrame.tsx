import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useAgentStore } from "../store/agentStore"
import {
  displayThreadTitle,
  filterConversationEnum,
  isFleetWorkerThread,
  threadRecency,
  workerBelongTitle,
} from "../utils/thread-timeline"
import { CompanionMark, IconChevronDown, IconNewChat, IconSettings } from "../ui/icons"
import { CONTEXT_PANEL_TABS, useContextPanelHost } from "./ContextPanelHost"
import { createBlankThread } from "./ThreadList"
import { ProjectPanel } from "./ProjectPanel"
import { useNavigationStartup } from "../navigation/useNavigationStartup"
import { RESIDENT_MIN_WIDTH, type NavigationSurface } from "../navigation/navigation-mode"
import { toolGroups } from "../navigation/tool-groups"
import type { CapabilityLevel } from "../types"
import { PersonalWorkspace, WORKSPACE_DESTINATIONS, type WorkspaceDestination } from "./personal-workspace/PersonalWorkspace"
import { useActivity } from "./personal-workspace/useActivity"
import { dueToday } from "./personal-workspace/activity-request"
import { personalWorkspaceCSS } from "./personal-workspace/styles"

/** Workspace destinations project one Companion state; chat stays mounted during navigation. */
export function WorkspaceFrame({ children, level = "chat", top, bottom, overlays }: {
  children: ReactNode
  level?: CapabilityLevel
  top?: ReactNode
  bottom?: ReactNode
  overlays?: ReactNode
}) {
  useNavigationStartup()
  const { state, dispatch } = useAgentStore()
  const { openPanelForce } = useContextPanelHost()
  const full = window.location.pathname === "/tabs/workspace.html"
  const surface: NavigationSurface = full ? "workspace" : new URLSearchParams(window.location.search).get("surface") === "popout" ? "popout" : "sidepanel"
  const [view, setView] = useState<WorkspaceDestination>(() => {
    if (!full) return "chat"
    const requested = new URLSearchParams(window.location.search).get("view")
    if (WORKSPACE_DESTINATIONS.some(item => item.id === requested)) return requested as WorkspaceDestination
    try { const saved = localStorage.getItem("cmspark.workspace.destination"); if (WORKSPACE_DESTINATIONS.some(item => item.id === saved)) return saved as WorkspaceDestination } catch { /* View persistence is optional. */ }
    return "today"
  })
  const [wide, setWide] = useState(() => window.matchMedia(`(min-width: ${RESIDENT_MIN_WIDTH}px)`).matches)
  const [open, setOpen] = useState(false)
  const [openingError, setOpeningError] = useState("")
  const controller = useActivity(state.connectionState === "connected", state.codingHistoryConnectionRevision)
  const navRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const destinationBlocked = state.pendingSecurityConfirmations.length > 0 || !!state.computerTask && ["running", "paused"].includes(state.computerTask.status)
  const destinationOwnerRef = useRef({ threadId: state.activeThreadId, selectionRevision: state.activeThreadSelectionRevision, settingsOpen: state.settingsOpen, blocked: destinationBlocked })
  const previousDestinationOwner = destinationOwnerRef.current
  if (previousDestinationOwner.threadId !== state.activeThreadId || previousDestinationOwner.selectionRevision !== state.activeThreadSelectionRevision || previousDestinationOwner.settingsOpen !== state.settingsOpen || previousDestinationOwner.blocked !== destinationBlocked) {
    destinationOwnerRef.current = { threadId: state.activeThreadId, selectionRevision: state.activeThreadSelectionRevision, settingsOpen: state.settingsOpen, blocked: destinationBlocked }
  }
  const destinationOwner = destinationOwnerRef.current
  const forceChat = state.settingsOpen || state.pendingSecurityConfirmations.length > 0 || !!state.computerTask && ["running", "paused"].includes(state.computerTask.status)
  const visibleView = forceChat ? "chat" : view
  const navigate = (destination: WorkspaceDestination) => {
    if (forceChat && destination !== "chat") {
      window.dispatchEvent(new CustomEvent("cmspark:toast", { detail: "先处理待确认操作或结束电脑执行，再切换工作区。" }))
      return
    }
    setView(destination)
    if (full) try { localStorage.setItem("cmspark.workspace.destination", destination) } catch { /* Navigation still works without storage. */ }
  }
  useEffect(() => { if (forceChat) setView("chat") }, [forceChat])
  useEffect(() => {
    const showChat = () => setView("chat")
    const events = ["cmspark:open-context-panel", "cmspark:open-coding-handoff", "cmspark:open-thread-manager", "cmspark:open-knowledge"]
    events.forEach(event => window.addEventListener(event, showChat))
    return () => events.forEach(event => window.removeEventListener(event, showChat))
  }, [])
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
    const query = window.matchMedia(`(min-width: ${RESIDENT_MIN_WIDTH}px)`)
    const resize = () => { setWide(query.matches); setOpen(false) }
    const toggle = () => setOpen(value => !value)
    query.addEventListener("change", resize)
    window.addEventListener("cmspark:toggle-navigation", toggle)
    return () => { query.removeEventListener("change", resize); window.removeEventListener("cmspark:toggle-navigation", toggle) }
  }, [])
  const openFull = () => {
    setOpeningError("")
    void chrome.tabs.create({ url: chrome.runtime.getURL("tabs/workspace.html") }).catch(() => setOpeningError("无法打开工作中心，请重试。"))
  }
  useEffect(() => {
    let current = true, opening = false
    const isCurrent = () => current && destinationOwnerRef.current === destinationOwner
    const notify = (message: string) => window.dispatchEvent(new CustomEvent("cmspark:toast", { detail: message }))
    const openDestination = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      const destination = typeof detail === "string" ? detail : detail && typeof detail === "object" && "view" in detail ? detail.view : undefined
      if (destination !== "activity" && destination !== "todos") return
      if (!isCurrent()) {
        notify(destinationOwnerRef.current.blocked ? "先处理待确认操作或结束电脑执行，再切换工作区。" : "页面已变化，请重试。")
        return
      }
      if (state.pendingSecurityConfirmations.length || state.computerTask && ["running", "paused"].includes(state.computerTask.status)) {
        notify("先处理待确认操作或结束电脑执行，再切换工作区。")
        return
      }
      if (full) { setView(destination); dispatch({ type: "SET_SETTINGS_OPEN", open: false }) }
      else {
        if (opening) { notify("工作中心正在打开，请稍候。"); return }
        opening = true
        setOpeningError("")
        void chrome.tabs.create({ url: chrome.runtime.getURL(`tabs/workspace.html?view=${destination}`) }).then(() => {
          if (isCurrent()) dispatch({ type: "SET_SETTINGS_OPEN", open: false })
        }).catch(() => {
          if (!isCurrent()) return
          setOpeningError("无法打开工作中心，请重试。")
          notify("无法打开工作中心，请重试。")
        }).finally(() => { opening = false })
      }
    }
    window.addEventListener("cmspark:open-workspace-destination", openDestination)
    return () => { current = false; window.removeEventListener("cmspark:open-workspace-destination", openDestination) }
  }, [dispatch, full, destinationOwner, state.settingsOpen, state.activeThreadId, state.activeThreadSelectionRevision, state.pendingSecurityConfirmations.length, state.computerTask])
  const openResource = (panel: Parameters<typeof openPanelForce>[0]) => { navigate("chat"); openPanelForce(panel) }
  const navProps = { full, destination: visibleView, onView: navigate }
  if (!full) return <>
    <style>{personalWorkspaceCSS}</style>
    <div className="cm-workspace" data-navigation-surface={surface}>
      <WorkspaceNavigation {...navProps} level={level} onNavigate={() => {}} />
      <main className="cm-workspace-main cm-shell-column">
        {top}
        <div className="cm-shell-layers"><div className="cm-chat-mount">{children}</div></div>
        <div className="cm-shell-bottom">{bottom}</div>
        {overlays}
      </main>
    </div>
  </>
  return <div className="cm-workspace cm-workspace-full">
    <style>{personalWorkspaceCSS}</style>
    {full && <>
    {wide && <WorkspaceNavigation {...navProps} level={level} onNavigate={() => {}} />}
    {!wide && <WorkspaceNavigation {...navProps} level={level} onNavigate={() => {}} />}
    <main className="cm-workspace-main cm-shell-column" aria-label="个人工作中心">
      {top}
      {openingError && <p role="alert" className="cm-personal-fieldnote">{openingError}</p>}
      {full && <nav className="cm-personal-mobile-nav" aria-label="工作中心页面">{WORKSPACE_DESTINATIONS.map(item => <button type="button" key={item.id} aria-current={visibleView === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}<button type="button" disabled={state.pendingSecurityConfirmations.length > 0 || !!state.computerTask && ["running", "paused"].includes(state.computerTask.status)} onClick={() => { navigate("chat"); dispatch({ type: "SET_SETTINGS_OPEN", open: true }) }}>设置</button></nav>}
      {full && visibleView !== "chat" && state.meetingCaptureActive && <div className="cm-personal-banner" role="status"><span>会议录制中</span><button className="cm-icon-button" type="button" onClick={() => openResource("meeting")}>返回会议</button></div>}
      <div className="cm-shell-layers">
        <div className="cm-chat-mount" hidden={visibleView !== "chat"}>{children}</div>
        {(["today", "todos", "materials", "activity"] as const).map(destination => <div className="cm-personal-mount" key={destination} hidden={visibleView !== destination}><PersonalWorkspace destination={destination} controller={controller} connected={state.connectionState === "connected"} active={visibleView === destination && !forceChat} navigationOwner={destinationOwner} navigate={navigate} openResource={openResource} /></div>)}
      </div>
      <div className="cm-shell-bottom">{bottom}</div>
      {overlays}
    </main>
    </>}
  </div>
}

function WorkspaceNavigation({ onNavigate, onClose, full, destination, onView, level }: {
  onNavigate: () => void; onClose?: () => void; full: boolean; destination: WorkspaceDestination; onView: (view: WorkspaceDestination) => void; level: CapabilityLevel
}) {
  const { state, dispatch } = useAgentStore()
  const { activePanel, openPanelForce, closePanel } = useContextPanelHost()
  const [query, setQuery] = useState("")
  const [projectFilter, setProjectFilter] = useState("*")
  const [conversationsOpen, setConversationsOpen] = useState(true)
  const conversationsId = useId()
  const q = query.toLocaleLowerCase().trim()
  const recent = filterConversationEnum(
    state.threads.filter(t => !t.trashed_at),
    { activeThreadId: state.activeThreadId, query },
  ).filter(t => {
    if (projectFilter !== "*" && (t.project_id || "") !== projectFilter) return false
    if (!q) return true
    const parent = state.threads.find(p => p.id === t.parent_thread_id)
    const hay = `${workerBelongTitle(t, parent)} ${t.id || ""} ${t.worker_role_label || ""}`.toLocaleLowerCase()
    return hay.includes(q)
  }).sort((a, b) => threadRecency(b).localeCompare(threadRecency(a))).slice(0, 30)
  const resources = <div className="cm-tool-groups">{toolGroups(level).map(group => <div role="group" aria-label={group.title} key={group.title}><p className="cm-nav-section">{group.title}</p><nav aria-label={group.title} className="cm-nav-resources">{group.ids.map(id => {
    const tab = CONTEXT_PANEL_TABS.find(item => item.id === id)
    if (!tab) return null
    const { label, Icon } = tab
    return <button type="button" key={id} className={`cm-nav-item${id === "tabs" ? " cm-nav-browser" : ""}`} title={label} aria-current={activePanel === id ? "true" : undefined} onClick={() => {
      onView("chat"); dispatch({ type: "SET_SETTINGS_OPEN", open: false }); openPanelForce(id); onNavigate()
    }}><Icon size={16} /><span>{id === "board" ? "Agent 执行记录" : label}</span></button>
  })}</nav></div>)}</div>
  return <nav className="cm-navigation" aria-label="工作区">
    <div className="cm-nav-brand"><CompanionMark size={24} /><strong>CMspark</strong>
      {onClose && <button type="button" className="cm-icon-button" aria-label="关闭导航" onClick={onClose}>×</button>}
    </div>
    {full && <nav className="cm-workspace-destinations" aria-label="主要功能">{WORKSPACE_DESTINATIONS.map(item => <button type="button" className="cm-nav-item" key={item.id} aria-current={destination === item.id ? "page" : undefined} onClick={() => { onView(item.id); onNavigate() }}>{item.label}</button>)}</nav>}
    <button type="button" className="cm-nav-new" onClick={() => { onView("chat"); createBlankThread(dispatch); onNavigate() }}><IconNewChat size={17} />新对话</button>
    <ProjectPanel filter={projectFilter} onFilter={setProjectFilter} />
    <p className="cm-nav-section">资料与工具</p>
    {resources}
    <label className="cm-nav-search-label">查找对话
      <input className="cm-nav-search" aria-label="筛选最近对话" placeholder="查找对话…" value={query} onChange={e => setQuery(e.target.value)} />
    </label>
    <section className="cm-nav-conversations" data-collapsed={!conversationsOpen} aria-label="最近对话">
    <div className="cm-nav-section"><button type="button" className="cm-nav-collapse" aria-expanded={conversationsOpen} aria-controls={conversationsId} onClick={() => setConversationsOpen(value => !value)}><IconChevronDown size={14} /><span>最近对话</span></button><button type="button" className="cm-nav-manage" disabled={state.pendingSecurityConfirmations.length > 0} onClick={() => { onView("chat"); onNavigate(); window.dispatchEvent(new Event("cmspark:open-thread-manager")) }}>管理对话</button></div>
    <div id={conversationsId} className="cm-nav-conversation-body" hidden={!conversationsOpen}>
    <div className="cm-nav-threads">
      {recent.map(thread => <button type="button" className="cm-nav-thread" key={thread.id} aria-current={thread.id === state.activeThreadId ? "page" : undefined}
        title={isFleetWorkerThread(thread) ? workerBelongTitle(thread, state.threads.find(p => p.id === thread.parent_thread_id)) : displayThreadTitle(thread)} onClick={() => {
          onView("chat"); dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread.id }); chrome.runtime.sendMessage({ type: "thread.select", threadId: thread.id }); onNavigate()
        }}><span>{isFleetWorkerThread(thread) ? workerBelongTitle(thread, state.threads.find(p => p.id === thread.parent_thread_id)) : displayThreadTitle(thread)}</span>{state.threadBusyById[thread.id] && <span className="cm-nav-running" aria-label="运行中">·</span>}</button>)}
      {!recent.length && <p className="cm-nav-empty">{query ? "没有匹配的对话" : "新对话会保存在这里"}</p>}
    </div>
    </div>
    </section>
    <button type="button" className="cm-nav-item cm-nav-settings" onClick={() => { onView("chat"); closePanel(); dispatch({ type: "SET_SETTINGS_OPEN", open: true }); onNavigate() }}><IconSettings size={16} />设置</button>
  </nav>
}
