import type { openWorkbench } from "../navigation/open-workbench"
// Owns panel navigation, loading, close guards and the cmspark event listeners.
// ContextPanelBody mounts the selected view.
// #321 PR-1: legacy permanent BottomBar tab strip deleted (was PR5-gated off).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { useAgentStore } from "../store/agentStore"
import {
  contextBarTabsForLevel,
  contextBarOverflowTabsForLevel,
} from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"
import {
  IconTabs,
  IconHistory,
  IconSkills,
  IconKnowledge,
  IconMcp,
  IconApps,
  IconPacks,
  IconMic,
  IconList,
} from "../ui/icons"

// ── Registry ───────────────────────────────────────────────────────────────

export type ContextPanelId =
  | "tabs"
  | "history"
  | "skills"
  | "knowledge"
  | "packs"
  | "board"
  | "mcp"
  | "apps"
  | "meeting"

export type ContextPanelTabDef = {
  id: ContextPanelId
  label: string
  Icon: ComponentType<{ size?: number }>
}

/** Canonical panel registry (labels + icons). Strip and Host share this. */
// #321 PR-5: packs/meeting/board each get their own icon (were all IconSkills
// collisions); icons come from the existing ui/icons set — nothing new drawn.
export const CONTEXT_PANEL_TABS: ContextPanelTabDef[] = [
  { id: "tabs", label: "浏览器标签页", Icon: IconTabs },
  { id: "history", label: "历史", Icon: IconHistory },
  { id: "skills", label: "技能", Icon: IconSkills },
  { id: "knowledge", label: "知识", Icon: IconKnowledge },
  { id: "packs", label: "场景与专家", Icon: IconPacks },
  { id: "meeting", label: "会议", Icon: IconMic },
  { id: "board", label: "任务板", Icon: IconList },
  { id: "mcp", label: "MCP", Icon: IconMcp },
  { id: "apps", label: "应用", Icon: IconApps },
]

const KNOWN_IDS = new Set(CONTEXT_PANEL_TABS.map((t) => t.id))

export function isContextPanelId(id: string): id is ContextPanelId {
  return KNOWN_IDS.has(id as ContextPanelId)
}

export function contextPanelLabel(id: ContextPanelId): string {
  return CONTEXT_PANEL_TABS.find((t) => t.id === id)?.label ?? id
}

// ── Loaders ────────────────────────────────────────────────────────────────

export function loadPanelData(
  id: ContextPanelId,
  activeThreadId: string | null,
  dispatch: ReturnType<typeof useAgentStore>["dispatch"],
) {
  if (id === "tabs") {
    chrome.tabs.query({}, (tabs) => {
      dispatch({ type: "SET_TAB_LIST", tabs })
    })
  }
  if (id === "history") {
    chrome.runtime.sendMessage({ type: "history.query", limit: 50, thread_id: activeThreadId })
  }
  if (id === "skills") {
    // Force rescan when opening Skills — picks up Finder drops / external edits
    // even if mtime fingerprint was edge-case stale; cheap after ensureFresh path.
    chrome.runtime.sendMessage({ type: "skill.refresh" })
  }
  if (id === "knowledge") {
    chrome.runtime.sendMessage({ type: "knowledge.list" })
  }
  if (id === "packs") {
    chrome.runtime.sendMessage({ type: "pack.list" })
    chrome.runtime.sendMessage({ type: "modules.list" })
  }
  if (id === "mcp") {
    chrome.runtime.sendMessage({ type: "mcp.list" })
  }
  if (id === "apps") {
    chrome.runtime.sendMessage({ type: "apps.list" })
  }
}

// ── Host API context ───────────────────────────────────────────────────────

export type ContextPanelHostApi = {
  activePanel: ContextPanelId | null
  /** Toggle: same id closes; different id opens + loads. */
  openPanel: (id: ContextPanelId) => void
  /** Force-open; true only for this current request, thread and active panel. */
  openPanelForce: (id: ContextPanelId) => Promise<boolean>
  closePanel: () => void
  /** A recording panel can finish its last segment before navigation unmounts it. */
  registerBeforeClose: (guard: () => Promise<boolean>) => () => void
}

const ContextPanelHostContext = createContext<ContextPanelHostApi | null>(null)

export function useContextPanelHost(): ContextPanelHostApi {
  const ctx = useContext(ContextPanelHostContext)
  if (!ctx) {
    throw new Error("useContextPanelHost must be used within ContextPanelHostProvider")
  }
  return ctx
}

/** Soft read for optional chrome that may render outside provider in tests. */
export function useContextPanelHostOptional(): ContextPanelHostApi | null {
  return useContext(ContextPanelHostContext)
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ContextPanelHostProvider({
  capabilityLevel,
  openMeetingWorkspace,
  children,
}: {
  capabilityLevel: CapabilityLevel
  openMeetingWorkspace?: typeof openWorkbench
  children: ReactNode
}) {
  const [activePanel, setActivePanel] = useState<ContextPanelId | null>(null)
  const activePanelRef = useRef(activePanel)
  activePanelRef.current = activePanel
  const beforeCloseRef = useRef<(() => Promise<boolean>) | null>(null)
  const transitionRef = useRef<Promise<boolean> | null>(null)
  const targetRef = useRef<ContextPanelId | null>(null)
  const transitionVersion = useRef(0)
  const pendingKnowledgeFocus = useRef<string | null>(null)
  const { state, dispatch } = useAgentStore()
  const activeThreadId = state.activeThreadId
  const activeThreadRef = useRef(activeThreadId)
  activeThreadRef.current = activeThreadId
  const activeThreadSelectionRef = useRef(state.activeThreadSelectionRevision)
  activeThreadSelectionRef.current = state.activeThreadSelectionRevision
  const navigationBlocked = useRef(false)
  navigationBlocked.current = state.pendingSecurityConfirmations.length > 0 || !!state.computerTask && ["running", "paused"].includes(state.computerTask.status)

  const allowedIds = useMemo(
    () => new Set(contextBarTabsForLevel(capabilityLevel)),
    [capabilityLevel],
  )
  const overflowIds = useMemo(
    () => contextBarOverflowTabsForLevel(capabilityLevel),
    [capabilityLevel],
  )

  const registerBeforeClose = useCallback((guard: () => Promise<boolean>) => {
    beforeCloseRef.current = guard
    return () => { if (beforeCloseRef.current === guard) beforeCloseRef.current = null }
  }, [])

  const requestPanelChange = useCallback((id: ContextPanelId | null): Promise<boolean> => {
    targetRef.current = id
    transitionVersion.current += 1
    if (transitionRef.current) return transitionRef.current
    if (activePanelRef.current === id) {
      if (id) loadPanelData(id, activeThreadRef.current, dispatch)
      return Promise.resolve(true)
    }
    const apply = () => {
      const target = targetRef.current
      activePanelRef.current = target
      setActivePanel(target)
      if (target) loadPanelData(target, activeThreadRef.current, dispatch)
    }
    const guard = beforeCloseRef.current
    if (!guard) { apply(); return Promise.resolve(true) }
    const pending = Promise.resolve().then(guard).then(allowed => {
      if (allowed) apply()
      return allowed
    }, () => false).finally(() => { transitionRef.current = null })
    transitionRef.current = pending
    return pending
  }, [dispatch])

  const closePanel = useCallback(() => { void requestPanelChange(null) }, [requestPanelChange])

  useEffect(() => {
    if (!state.settingsOpen) return
    if (!beforeCloseRef.current) { closePanel(); return }
    // Keep the finishing/error state visible; open settings after a successful close.
    dispatch({ type: "SET_SETTINGS_OPEN", open: false })
    const pending = requestPanelChange(null)
    const version = transitionVersion.current
    void pending.then(allowed => {
      if (allowed && version === transitionVersion.current) dispatch({ type: "SET_SETTINGS_OPEN", open: true })
    })
  }, [state.settingsOpen, closePanel, dispatch, requestPanelChange])

  const openPanelForce = useCallback(
    (id: ContextPanelId): Promise<boolean> => {
      const thread = activeThreadRef.current, selectionRevision = activeThreadSelectionRef.current
      const workbench = id === "meeting" && openMeetingWorkspace
      if (workbench && navigationBlocked.current) return Promise.resolve(false)
      const pending = requestPanelChange(workbench ? null : id)
      const version = transitionVersion.current
      return pending.then(allowed => {
        if (!allowed || version !== transitionVersion.current || activeThreadRef.current !== thread || activeThreadSelectionRef.current !== selectionRevision) return false
        if (workbench) return !navigationBlocked.current && workbench("meeting")
        return activePanelRef.current === id
      })
    },
    [requestPanelChange, openMeetingWorkspace],
  )

  const openPanel = useCallback(
    (id: ContextPanelId) => {
      if (id === "meeting" && openMeetingWorkspace) { void openPanelForce(id); return }
      void requestPanelChange(activePanelRef.current === id ? null : id)
    },
    [requestPanelChange, openMeetingWorkspace, openPanelForce],
  )

  // Close open panel if it is no longer primary or overflow for this level
  useEffect(() => {
    if (activePanel == null) return
    if (!allowedIds.has(activePanel) && !overflowIds.includes(activePanel)) {
      closePanel()
    }
  }, [activePanel, allowedIds, overflowIds, closePanel])

  // S1: slash meta commands (/packs /board /mcp) open panels via soft event
  useEffect(() => {
    const onOpen = (e: Event) => {
      const raw = (e as CustomEvent<{ panel?: string }>).detail?.panel
      if (!raw || !isContextPanelId(raw)) return
      openPanelForce(raw)
    }
    window.addEventListener("cmspark:open-context-panel", onOpen as EventListener)
    const onKnowledge = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id) pendingKnowledgeFocus.current = id
      openPanelForce("knowledge")
    }
    window.addEventListener("cmspark:open-knowledge", onKnowledge as EventListener)
    const onGraphDoc = (msg: { type?: string; id?: string }) => {
      if (msg?.type !== "knowledge_graph.doc_selected" || !msg.id) return
      pendingKnowledgeFocus.current = msg.id
      openPanelForce("knowledge")
    }
    chrome.runtime.onMessage.addListener(onGraphDoc)
    return () => {
      window.removeEventListener("cmspark:open-context-panel", onOpen as EventListener)
      window.removeEventListener("cmspark:open-knowledge", onKnowledge as EventListener)
      chrome.runtime.onMessage.removeListener(onGraphDoc)
    }
  }, [openPanelForce])

  useEffect(() => {
    if (activePanel !== "knowledge") return
    const id = pendingKnowledgeFocus.current
    if (!id) return
    pendingKnowledgeFocus.current = null
    window.dispatchEvent(new CustomEvent("cmspark:focus-knowledge", { detail: { id } }))
  }, [activePanel])

  const api = useMemo<ContextPanelHostApi>(
    () => ({ activePanel, openPanel, openPanelForce, closePanel, registerBeforeClose }),
    [activePanel, openPanel, openPanelForce, closePanel, registerBeforeClose],
  )

  return (
    <ContextPanelHostContext.Provider value={api}>
      {children}
    </ContextPanelHostContext.Provider>
  )
}
