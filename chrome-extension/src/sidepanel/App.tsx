// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { useCapabilityMode } from "./hooks/useCapabilityMode"
import { ChatView } from "./components/ChatView"
import { BottomBar } from "./components/BottomBar"
import {
  ContextPanelHost,
  ContextPanelHostProvider,
  useContextPanelHost,
} from "./components/ContextPanelHost"
import { FocusBand } from "./components/FocusBand"
import { SceneStatusBar } from "./components/SceneStatusBar"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
import { AtThreadPopover, type AtThreadChoice } from "./components/AtThreadPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { NotebooklmImporterPanel } from "./components/NotebooklmImporterPanel"
import { StatusRail } from "./components/StatusRail"
import { ComposerChips } from "./components/ComposerChips"
import { ComposeDrawer } from "./components/ComposeDrawer"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import type { CapabilityLevel, SkillMeta, FileAttachment } from "./types"
import {
  META_PANEL_SLASH,
  composerPlaceholder,
  resolveMetaSlash,
  type ComposerChipAction,
} from "./composer/meta-slash"
import { tokens } from "./ui/tokens"
import { ui } from "./ui/flags"
import {
  IconSend,
  IconStop,
  IconAttach,
  IconAlert,
} from "./ui/icons"
import { collectRunningTools } from "./utils/running-tools"
import {
  buildScopedRunBusyInput,
  composerBusyPlaceholder,
  deriveRunBusy,
  deriveThreadBusy,
  resolveComposerMode,
} from "./utils/thread-busy"
import { shouldApplyStreamEvent } from "./hooks/useWebSocket"
import { WorkerScopeBar } from "./components/WorkerScopeBar"
import { RunBusyChip } from "./components/RunBusyChip"
import { FleetWorkerListPortal } from "./components/FleetWorkerList"

// Error Boundary — catches rendering errors to prevent white screen
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 20,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: 13,
          color: "#333",
        }}>
          <h3 style={{ color: tokens.danger, marginBottom: 12 }}>界面渲染错误</h3>
          <pre style={{
            background: tokens.bgMuted,
            padding: 12,
            borderRadius: 6,
            fontSize: 11,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 300,
          }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            style={{
              marginTop: 12,
              padding: "6px 16px",
              border: `1px solid ${tokens.accent}`,
              borderRadius: 6,
              background: tokens.bgElevated,
              color: tokens.accent,
              cursor: "pointer",
              fontSize: 12,
            }}
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <AgentStoreProvider>
        <AppContent />
      </AgentStoreProvider>
    </ErrorBoundary>
  )
}

function AppContent() {
  const { connectionState } = useWebSocket()
  const [craftOpen, setCraftOpen] = useState(false)
  const [nbImporterOpen, setNbImporterOpen] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const { state: appState, dispatch } = useAgentStore()
  const [toast, setToast] = useState("")

  // Show auto-matched skill toast
  useEffect(() => {
    if (appState.autoSkillNames) {
      setToast(`🤖 自动匹配: ${appState.autoSkillNames}`)
      dispatch({ type: "SET_AUTO_SKILLS", names: "" })
      setTimeout(() => setToast(""), 4000)
    }
  }, [appState.autoSkillNames])

  // Capability level (chat / browser / computer) — StatusRail badge, chips / FocusBand
  const onEscalate = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 4000)
  }, [])
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 4000)
  }, [])
  const { level, badgeLabel } = useCapabilityMode(onEscalate)
  const isComputer = level === "computer"

  // P1: auto-open Cockpit when entering L2 (openOrFocus is idempotent)
  useEffect(() => {
    if (!isComputer) return
    chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
      void chrome.runtime.lastError
    })
  }, [isComputer])

  return (
    <ContextPanelHostProvider capabilityLevel={level}>
    <div style={styles.container}>
      <style>{globalCSS}</style>
      {toast && <div style={toastStyles.toast}>{toast}</div>}
      <StatusRail
        connectionState={connectionState}
        capabilityLevel={level}
        badgeLabel={badgeLabel}
        onCraft={() => setCraftOpen(true)}
        onToggleLogs={() => setShowLogs(!showLogs)}
        onOpenNotebooklmImporter={() => setNbImporterOpen(true)}
        onToast={showToast}
      />
      {/* UIUX v2 §4.3 FocusBand: Confirm > L2 Safety+急停 > Fleet > L1 Context; ≤80px */}
      <FocusBand capabilityLevel={level} />
      {/* Scene / workspace status — Mission Pack UX redesign P0 */}
      <SceneStatusBar />
      <RunBusyChip />
      <WorkerScopeBar />
      <ChatView />
      <FleetWorkerListPortal />
      {/* R3: ComputerTaskBar removed — step timeline only in Cockpit dual-track */}
      {/* UIUX v2 §4.7 M3/PR5: permanent BottomBar strip behind ui.bottomBarStrip (default off). Host is SoT. */}
      {ui.bottomBarStrip ? <BottomBar capabilityLevel={level} /> : null}
      <ContextPanelHost />
      <InputArea capabilityLevel={level} />
      {showLogs && <LogBar onClose={() => setShowLogs(false)} />}
      <SettingsSlideout />
      {/* P1 D10′: full confirm dialog removed from Panel — Cockpit ConfirmElevated + MinimalConfirm */}
      <McpServerForm />
      {craftOpen && <SkillCraftPanel onClose={() => setCraftOpen(false)} />}
      {nbImporterOpen && <NotebooklmImporterPanel onClose={() => setNbImporterOpen(false)} />}
      <DisconnectedBanner
        visible={connectionState === "disconnected"}
        onRetry={() => {
          // Probe status only — auto-reconnect is owned by background ws-client.
          // Feedback stays in-banner / toast; never alert() (UIUX v2-P0).
          chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              showToast("无法联系扩展后台，请刷新 Side Panel 后重试")
              return
            }
            if (response?.connectionState === "connected") {
              showToast("已连接 Companion")
              return
            }
            showToast("正在尝试重新连接…若 Companion 已启动将自动恢复")
          })
        }}
      />
    </div>
    </ContextPanelHostProvider>
  )
}

function InputArea({ capabilityLevel = "chat" }: { capabilityLevel?: CapabilityLevel }) {
  const { state, dispatch } = useAgentStore()
  const { openPanelForce, closePanel, activePanel } = useContextPanelHost()
  const [text, setText] = useState("")
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [atVisible, setAtVisible] = useState(false)
  const [atQuery, setAtQuery] = useState("")
  const [threadRefs, setThreadRefs] = useState<AtThreadChoice[]>([])
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const [composeOpen, setComposeOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  /** Fresh active thread for SW upload callbacks (closure state is stale after switch). */
  const activeThreadIdRef = useRef(state.activeThreadId)
  activeThreadIdRef.current = state.activeThreadId
  const isComputer = capabilityLevel === "computer"

  const openCompose = useCallback(() => {
    // Landfill: only one secondary surface (drawer | Host | settings)
    closePanel()
    dispatch({ type: "SET_SETTINGS_OPEN", open: false })
    setComposeOpen(true)
  }, [closePanel, dispatch])

  const closeCompose = useCallback(() => {
    setComposeOpen(false)
  }, [])

  const handleChipAction = useCallback(
    (action: ComposerChipAction) => {
      if (action.kind === "compose") {
        openCompose()
        return
      }
      if (action.kind === "cockpit") {
        setComposeOpen(false)
        chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
          void chrome.runtime.lastError
        })
        return
      }
      // panel
      setComposeOpen(false)
      dispatch({ type: "SET_SETTINGS_OPEN", open: false })
      openPanelForce(action.panelId)
    },
    [openCompose, openPanelForce, dispatch],
  )

  // Host open → dismiss 装配 (landfill)
  useEffect(() => {
    if (activePanel) setComposeOpen(false)
  }, [activePanel])

  // R4: empty-state suggestion chips fill the composer
  useEffect(() => {
    const onFill = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail
      if (!detail?.text) return
      setText(detail.text)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = detail.text!.length
        el.setSelectionRange(len, len)
      })
    }
    window.addEventListener("cmspark:fill-composer", onFill as EventListener)
    return () => window.removeEventListener("cmspark:fill-composer", onFill as EventListener)
  }, [])

  // Empty state / external: open 装配 drawer
  useEffect(() => {
    const onOpen = () => openCompose()
    window.addEventListener("cmspark:open-compose", onOpen)
    return () => window.removeEventListener("cmspark:open-compose", onOpen)
  }, [openCompose])

  // Optional Cmd/Ctrl+K → 装配 (§6.2)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "k" && e.key !== "K")) return
      const tag = (e.target as HTMLElement | null)?.tagName
      // Allow even from textarea — primary IA entry
      if (tag === "INPUT" && (e.target as HTMLInputElement).type === "password") return
      e.preventDefault()
      openCompose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openCompose])

  const isStreaming = !!state.streamingContent
  const hasContent = text.trim().length > 0 || selectedFiles.length > 0
  // D12′ must-fix: hard-gate Panel send while computer task is active (running/paused)
  const taskActive =
    isComputer &&
    !!state.computerTask &&
    (state.computerTask.status === "running" || state.computerTask.status === "paused")
  const runningTools = collectRunningTools(state.messages)
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  const mapBusy = !!(activeId && state.threadBusyById[activeId])
  const threadBusy = deriveThreadBusy({
    streaming: isStreaming,
    isProcessing: state.isProcessing,
    runningToolCount: runningTools.length,
    mapBusy,
  })
  const fleet = state.fleet
  const workers = fleet?.workers || []
  const busyThreadIds = Object.entries(state.threadBusyById)
    .filter(([, b]) => b)
    .map(([id]) => id)
  const { runBusyInput } = buildScopedRunBusyInput({
    active: activeThread
      ? {
          id: activeThread.id,
          agent_role: activeThread.agent_role,
          parent_thread_id: activeThread.parent_thread_id,
          orchestrator_run_id: activeThread.orchestrator_run_id,
        }
      : activeId
        ? { id: activeId }
        : null,
    workers,
    locks: fleet?.locks,
    openIntentCount: fleet?.open_intent_count,
    openIntentsByRun: fleet?.open_intents_by_run,
    llmActiveThreadIds: fleet?.llm_active_thread_ids,
    busyThreadIds,
  })
  const lockCount = runBusyInput.lockCount
  const runBusy = deriveRunBusy(runBusyInput)
  const composerMode = resolveComposerMode({ taskActive, threadBusy, runBusy })
  const isWorker = activeThread?.agent_role === "worker"
  const canSend =
    composerMode !== "l2_task" &&
    composerMode !== "thread_busy" &&
    hasContent &&
    !!state.activeThreadId &&
    state.connectionState === "connected"
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"
  const showStop = threadBusy || isStreaming

  const getPlaceholder = () => {
    if (needsThread) return "请先创建或选择一个线程"
    if (needsConnection) return "等待 companion 连接..."
    const busyPh = composerBusyPlaceholder(composerMode, {
      lockCount,
      isWorker,
      roleLabel: activeThread?.worker_role_label || activeThread?.alias || undefined,
    })
    if (busyPh) return busyPh
    return composerPlaceholder(capabilityLevel)
  }

  // Detect slash command: check if cursor is after a "/" at start or after space
  const detectSlash = useCallback((value: string, cursorPos: number) => {
    // Find the last "/" before cursor
    const beforeCursor = value.substring(0, cursorPos)
    const slashIdx = beforeCursor.lastIndexOf("/")

    if (slashIdx === -1) {
      setSlashVisible(false)
      return
    }

    // Check character before "/" — must be start of string or whitespace
    const charBefore = slashIdx === 0 ? null : value[slashIdx - 1]
    if (charBefore !== null && charBefore !== " " && charBefore !== "\n") {
      setSlashVisible(false)
      return
    }

    // Extract query: everything after "/" up to cursor position (no spaces → still typing)
    const query = beforeCursor.substring(slashIdx + 1)
    if (query.includes(" ") || query.includes("\n")) {
      setSlashVisible(false)
      return
    }
    setSlashQuery(query)
    setSlashVisible(true)
    setAtVisible(false)
  }, [])

  // Detect @ thread ref (P1.5)
  const detectAt = useCallback((value: string, cursorPos: number) => {
    const beforeCursor = value.substring(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx === -1) {
      setAtVisible(false)
      return
    }
    const charBefore = atIdx === 0 ? null : value[atIdx - 1]
    if (charBefore !== null && charBefore !== " " && charBefore !== "\n") {
      setAtVisible(false)
      return
    }
    const query = beforeCursor.substring(atIdx + 1)
    // stop if user finished the token with space
    if (query.includes(" ") || query.includes("\n") || query.includes("」")) {
      setAtVisible(false)
      return
    }
    setAtQuery(query)
    setAtVisible(true)
    setSlashVisible(false)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setText(newValue)
    const pos = e.target.selectionStart || 0
    detectSlash(newValue, pos)
    detectAt(newValue, pos)
  }

  const clearSlashToken = (slashIdx: number, cursorPos: number) => {
    const afterCursor = text.substring(cursorPos)
    const newText = (text.substring(0, slashIdx) + afterCursor).replace(/\s+$/, " ").trimStart()
    setText(newText)
    setSlashVisible(false)
  }

  const handleAtSelect = (choice: AtThreadChoice) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart || 0
    const beforeCursor = text.substring(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx < 0) return
    const afterCursor = text.substring(cursorPos)
    const insert = `@「${choice.title}」 `
    const newText = text.substring(0, atIdx) + insert + afterCursor
    setText(newText)
    setAtVisible(false)
    setThreadRefs((prev) => {
      if (prev.some((r) => r.id === choice.id)) return prev
      return [...prev, choice].slice(0, 8)
    })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      const pos = atIdx + insert.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const handleSlashSelect = (skill: SkillMeta) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart || 0
    const beforeCursor = text.substring(0, cursorPos)

    // Find the "/" that started this command
    const slashIdx = beforeCursor.lastIndexOf("/")
    if (slashIdx === -1) return

    // PR4 §4.8: meta slash parity (Host / 装配 / settings / 确认台)
    const meta = resolveMetaSlash(skill)
    if (meta) {
      clearSlashToken(slashIdx, cursorPos)
      if (meta.metaKind === "compose") {
        openCompose()
        return
      }
      if (meta.metaKind === "settings") {
        setComposeOpen(false)
        closePanel()
        dispatch({ type: "SET_SETTINGS_OPEN", open: true })
        return
      }
      if (meta.metaKind === "cockpit") {
        setComposeOpen(false)
        chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
          void chrome.runtime.lastError
        })
        return
      }
      if (meta.metaKind === "panel" && meta.panelId) {
        setComposeOpen(false)
        dispatch({ type: "SET_SETTINGS_OPEN", open: false })
        openPanelForce(meta.panelId)
        return
      }
      // Legacy site-based open
      if (skill.site) {
        window.dispatchEvent(
          new CustomEvent("cmspark:open-context-panel", { detail: { panel: skill.site } }),
        )
      }
      return
    }

    // Replace from "/" to cursor with "/skill-name "
    const afterCursor = text.substring(cursorPos)
    const newText = text.substring(0, slashIdx) + "/" + skill.name + " " + afterCursor
    const newCursorPos = slashIdx + skill.name.length + 2 // after "/name "

    setText(newText)
    setSlashVisible(false)

    // Set cursor position after the inserted text
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  // §4.8 virtual slash entries + real skills
  const slashSkills: SkillMeta[] = [
    ...META_PANEL_SLASH,
    ...(Array.isArray(state.skills) ? state.skills : []),
  ]

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If popover is open and navigating/selecting, let the popover handle it
    // Dual-review B3: gate @ popover the same way as / (parity)
    if (
      (slashVisible || atVisible) &&
      ["ArrowDown", "ArrowUp", "Escape", "Enter"].includes(e.key)
    ) {
      return
    }

    const shortcut = state.sendShortcut || "Enter"
    let shouldSend = false

    if (shortcut === "Enter") {
      shouldSend = e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey
    } else if (shortcut === "Cmd+Enter") {
      // Strict: Cmd (metaKey) only — Ctrl+Enter must NOT trigger when user chose Cmd+Enter.
      // Cross-platform: on Windows/Linux keyboards without a meta key this shortcut is a no-op;
      // users on those platforms should pick Ctrl+Enter instead.
      shouldSend = e.key === "Enter" && e.metaKey && !e.ctrlKey
    } else if (shortcut === "Ctrl+Enter") {
      shouldSend = e.key === "Enter" && e.ctrlKey && !e.metaKey
    }

    if (shouldSend && canSend) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!canSend || sendingRef.current) return
    // Defense in depth: never dual-conduct while L2 task is active
    if (
      isComputer &&
      state.computerTask &&
      (state.computerTask.status === "running" || state.computerTask.status === "paused")
    ) {
      return
    }
    sendingRef.current = true
    try {
      const trimmed = text.trim()

      // Parse slash command to auto-activate skill
      const slashMatch = trimmed.match(/^\/(\S+)/)
      let skillIds = state.activeSkillIds
      if (slashMatch) {
        const cmdName = slashMatch[1]
        const matchedSkill = state.skills.find(
          s => s.name.toLowerCase() === cmdName.toLowerCase()
        )
        if (matchedSkill && !skillIds.includes(matchedSkill.name)) {
          skillIds = [...skillIds, matchedSkill.name]
        }
      }

      // File upload path
      if (selectedFiles.length > 0) {
        const userMessage = trimmed || "请分析我上传的文件"
        const fileSummary = selectedFiles.map(f => f.name).join(", ")
        const uploadThreadId = state.activeThreadId
        const panelDiag = {
          thread_id: uploadThreadId,
          connection: state.connectionState,
          isProcessing: state.isProcessing,
          mapBusy: !!(uploadThreadId && state.threadBusyById[uploadThreadId]),
          file_count: selectedFiles.length,
          files: selectedFiles.map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            content_b64_len: f.content?.length ?? 0,
          })),
        }
        // Local + companion-forwarded via SW (background listens and logToCompanion).
        console.info("[cmspark] file.upload panel_dispatch", panelDiag)
        try {
          chrome.runtime.sendMessage({
            type: "diag.file_upload",
            phase: "panel_dispatch",
            ...panelDiag,
          })
        } catch {
          /* ignore */
        }

        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        if (uploadThreadId) {
          dispatch({ type: "SET_THREAD_BUSY", threadId: uploadThreadId, busy: true })
        }
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `${uploadThreadId}_${Date.now()}`,
            thread_id: uploadThreadId!,
            role: "user",
            content: `${userMessage}\n📎 ${fileSummary}`,
            created_at: new Date().toISOString(),
          },
        })

        chrome.runtime.sendMessage(
          {
            type: "file.upload",
            threadId: uploadThreadId,
            message: userMessage,
            files: selectedFiles,
            skillIds,
          },
          (response) => {
            // Companion down / SW failed — free the busy UI (file.upload_error path
            // only covers companion-side parse failures after WS delivers).
            const swErr = chrome.runtime.lastError?.message
            console.info("[cmspark] file.upload panel_response", {
              thread_id: uploadThreadId,
              swErr: swErr || null,
              response,
            })
            try {
              chrome.runtime.sendMessage({
                type: "diag.file_upload",
                phase: "panel_response",
                thread_id: uploadThreadId,
                sw_error: swErr || null,
                ok: !!response?.ok,
                diag: response?.diag || null,
              })
            } catch {
              /* ignore */
            }
            if (swErr || !response?.ok) {
              // Always clear mapBusy for the upload thread.
              if (uploadThreadId) {
                dispatch({ type: "SET_THREAD_BUSY", threadId: uploadThreadId, busy: false })
              }
              // S45 P0: do not unlock / pollute another thread if user switched mid-send.
              if (!shouldApplyStreamEvent(uploadThreadId, activeThreadIdRef.current)) {
                return
              }
              dispatch({ type: "SET_PROCESSING_STATUS", status: null })
              dispatch({ type: "SET_PROCESSING", isProcessing: false })
              dispatch({
                type: "ADD_MESSAGE",
                message: {
                  id: `${uploadThreadId || "file"}_send_err_${Date.now()}`,
                  thread_id: uploadThreadId || "",
                  role: "assistant",
                  content: `\u274c ${swErr || "Companion 未连接，无法上传文件"}`,
                  created_at: new Date().toISOString(),
                },
              })
            }
          },
        )
      } else {
        // Same clientMessageId as SW `chat.user` echo so ADD_MESSAGE dedupes
        // when both optimistic local append and multi-surface broadcast land.
        const clientMessageId = `${state.activeThreadId}_user_${Date.now()}`
        const context_refs = threadRefs.map((r) => ({
          type: "thread" as const,
          id: r.id,
          mode: "summary_card" as const,
          title: r.title,
        }))
        chrome.runtime.sendMessage({
          type: "chat.send",
          threadId: state.activeThreadId,
          message: trimmed,
          skillIds,
          clientMessageId,
          context_refs: context_refs.length ? context_refs : undefined,
        })
        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        if (state.activeThreadId) {
          dispatch({ type: "SET_THREAD_BUSY", threadId: state.activeThreadId, busy: true })
        }
        const displayContent =
          context_refs.length > 0
            ? `${trimmed}\n\n📎 引用 ${context_refs.length} 个会话`
            : trimmed
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: clientMessageId,
            thread_id: state.activeThreadId!,
            role: "user",
            content: displayContent,
            created_at: new Date().toISOString(),
          },
        })
      }

      setText("")
      setSlashVisible(false)
      setAtVisible(false)
      setThreadRefs([])
      setSelectedFiles([])
    } finally {
      sendingRef.current = false
    }
  }

  const handleStop = () => {
    chrome.runtime.sendMessage({
      type: "chat.abort",
      threadId: state.activeThreadId,
    })
    dispatch({ type: "SET_STREAMING", content: "" })
    dispatch({ type: "SET_STREAMING_REASONING", content: "" })
    dispatch({ type: "SET_PROCESSING_STATUS", status: null })
    dispatch({ type: "SET_PROCESSING", isProcessing: false })
    if (state.activeThreadId) {
      dispatch({ type: "SET_THREAD_BUSY", threadId: state.activeThreadId, busy: false })
    }
  }

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const maxFileSize = 10 * 1024 * 1024
    const newFiles: FileAttachment[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.size > maxFileSize) {
        setFileError(`文件 "${file.name}" 超过 10MB 限制`)
        continue
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(",")[1])
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const ext = file.name.split(".").pop()?.toLowerCase()
      const mimeMap: Record<string, string> = {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pdf: "application/pdf",
        odt: "application/vnd.oasis.opendocument.text",
        rtf: "application/rtf",
        csv: "text/csv",
        md: "text/markdown",
        txt: "text/plain",
        html: "text/html",
        htm: "text/html",
      }
      newFiles.push({
        name: file.name,
        type: file.type || mimeMap[ext || ""] || "application/octet-stream",
        size: file.size,
        content: base64,
      })
    }
    setSelectedFiles(prev => [...prev, ...newFiles])
    e.target.value = ""
  }, [])

  const removeFile = useCallback((idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  return (
    <div style={{ borderTop: `1px solid ${tokens.border}`, flexShrink: 0, position: "relative" as const, background: tokens.bg }}>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept=".docx,.pptx,.xlsx,.pdf,.odt,.rtf,.csv,.md,.txt,.html,.htm"
        onChange={handleFileSelect}
      />
      {fileError && (
        <div style={{
          padding: "4px 12px", background: tokens.warningSoft, color: tokens.warning,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{fileError}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setFileError("")}>×</span>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "8px 12px 0",
        }}>
          {selectedFiles.map((file, idx) => (
            <span key={idx} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", background: tokens.accentSoft, borderRadius: tokens.radiusPill,
              fontSize: 11, color: tokens.accentText, maxWidth: 200,
            }}>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", minWidth: 0,
              }}>
                {file.name} ({formatFileSize(file.size)})
              </span>
              <span
                role="button"
                onClick={() => removeFile(idx)}
                style={{ cursor: "pointer", marginLeft: 2, fontWeight: "bold", flexShrink: 0 }}
              >
                {"\u00d7"}
              </span>
            </span>
          ))}
        </div>
      )}
      {threadRefs.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "6px 12px 0",
          }}
          aria-label="引用的会话"
        >
          {threadRefs.map((r) => (
            <span
              key={r.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: tokens.bgMuted,
                borderRadius: tokens.radiusPill,
                fontSize: 11,
                color: tokens.textSecondary,
                maxWidth: 180,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                @{r.title}
              </span>
              <span
                role="button"
                onClick={() => setThreadRefs((prev) => prev.filter((x) => x.id !== r.id))}
                style={{ cursor: "pointer", fontWeight: "bold", flexShrink: 0 }}
              >
                {"\u00d7"}
              </span>
            </span>
          ))}
        </div>
      )}
      <AtThreadPopover
        threads={state.threads}
        excludeId={state.activeThreadId}
        searchText={atQuery}
        visible={atVisible}
        anchorEl={textareaRef.current}
        onSelect={handleAtSelect}
        onDismiss={() => setAtVisible(false)}
      />
      {/* PR4: ComposerDock chips + capsule; 装配 drawer is portal-like fixed sheet */}
      <div style={styles.inputArea}>
        <ComposerChips capabilityLevel={capabilityLevel} onAction={handleChipAction} />
        <div
          style={{
            ...styles.composerCapsule,
            opacity: needsThread || needsConnection ? 0.85 : 1,
            background: needsThread || needsConnection ? tokens.bgMuted : tokens.bgElevated,
          }}
        >
          {!showStop && (
            <button
              type="button"
              style={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={needsThread || needsConnection || threadBusy}
              title="上传文件"
            >
              <IconAttach size={16} />
            </button>
          )}
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            placeholder={getPlaceholder()}
            rows={2}
            value={text}
            disabled={needsThread || needsConnection || threadBusy}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          {showStop ? (
            <button
              type="button"
              style={styles.stopBtn}
              onClick={handleStop}
              title={isWorker ? "停止该子任务（本轮）" : "停止本轮"}
            >
              <IconStop size={14} />
            </button>
          ) : (
            <button
              type="button"
              style={{
                ...styles.sendBtn,
                opacity: canSend ? 1 : 0.45,
                cursor: canSend ? "pointer" : "not-allowed",
              }}
              onClick={handleSend}
              disabled={!canSend}
              title={
                needsThread
                  ? "请先创建线程"
                  : needsConnection
                    ? "Companion 未连接"
                    : taskActive
                      ? "任务进行中，请在确认台发送"
                      : threadBusy
                        ? "本对话处理中"
                        : "发送"
              }
            >
              <IconSend size={15} />
            </button>
          )}
        </div>
        <SlashCommandPopover
          skills={slashSkills}
          searchText={slashQuery}
          visible={slashVisible}
          anchorEl={textareaRef.current}
          onSelect={handleSlashSelect}
          onDismiss={() => setSlashVisible(false)}
        />
      </div>
      <ComposeDrawer
        open={composeOpen}
        onClose={closeCompose}
        capabilityLevel={capabilityLevel}
        onOpenSection={(panelId) => {
          setComposeOpen(false)
          dispatch({ type: "SET_SETTINGS_OPEN", open: false })
          openPanelForce(panelId)
        }}
      />
    </div>
  )
}

function DisconnectedBanner({ visible, onRetry }: { visible: boolean; onRetry: () => void }) {
  const [hint, setHint] = useState("")

  useEffect(() => {
    if (!visible) setHint("")
  }, [visible])

  if (!visible) return null

  const logsPath = "~/.cmspark-agent/logs/"

  const handleOpenLogs = () => {
    // Prefer native host; otherwise surface path in-banner (no alert — offline hygiene).
    if (typeof chrome !== "undefined" && chrome.runtime?.sendNativeMessage) {
      try {
        chrome.runtime.sendNativeMessage(
          "com.cmspark.agent",
          { action: "open_directory", path: logsPath },
          () => {
            if (chrome.runtime.lastError) {
              setHint(`请手动打开日志目录：${logsPath}`)
              return
            }
            setHint("已请求打开日志目录")
          },
        )
        return
      } catch {
        // fall through
      }
    }
    setHint(`请手动打开日志目录：${logsPath}`)
  }

  return (
    <div style={bannerStyles.container} role="alert">
      <div style={bannerStyles.iconWrap}>
        <IconAlert size={22} style={{ color: tokens.warning }} />
      </div>
      <div style={bannerStyles.content}>
        <h3 style={bannerStyles.title}>Companion 未连接</h3>
        <p style={bannerStyles.text}>
          请通过菜单栏启动 Companion，或检查守护进程状态。
        </p>
        {hint ? <p style={bannerStyles.hint}>{hint}</p> : null}
        <div style={bannerStyles.actions}>
          <button type="button" style={bannerStyles.primaryBtn} onClick={onRetry}>
            重新连接
          </button>
          <button type="button" style={bannerStyles.secondaryBtn} onClick={handleOpenLogs}>
            查看日志
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Styles ---

const globalCSS = `
  @keyframes cmspark-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes cmspark-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  @keyframes cmspark-dots {
    0% { width: 0; }
    100% { width: 20px; }
  }
  html, body, #root {
    background: ${tokens.bg};
  }
  ::selection {
    background: ${tokens.accentSoft};
    color: ${tokens.accentText};
  }
  /* Thin, quiet scrollbar */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(15, 23, 42, 0.18) transparent;
  }
  *::-webkit-scrollbar { width: 6px; height: 6px; }
  *::-webkit-scrollbar-thumb {
    background: rgba(15, 23, 42, 0.16);
    border-radius: 999px;
  }
  *::-webkit-scrollbar-track { background: transparent; }
  button, a, [role="button"] {
    transition: background ${tokens.transitionFast} ease, color ${tokens.transitionFast} ease,
      border-color ${tokens.transitionFast} ease, opacity ${tokens.transitionFast} ease,
      box-shadow ${tokens.transitionFast} ease, transform ${tokens.transitionFast} ease;
  }
  button:active:not(:disabled) {
    transform: scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
    button:active:not(:disabled) { transform: none; }
  }
`

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: tokens.font,
    fontSize: 13,
    color: tokens.text,
    background: `linear-gradient(180deg, ${tokens.bg} 0%, #eef0f6 100%)`,
    WebkitFontSmoothing: "antialiased",
  },
  inputArea: {
    display: "flex",
    flexDirection: "column",
    padding: "12px 14px 16px",
    background: "rgba(255, 255, 255, 0.62)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    borderTop: `1px solid ${tokens.border}`,
    flexShrink: 0,
    position: "relative" as const,
  },
  composerCapsule: {
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusComposer,
    padding: "10px 10px 10px 8px",
    background: tokens.bgElevated,
    boxShadow: `${tokens.shadowMd}, 0 0 0 1px rgba(255,255,255,0.8) inset`,
    transition: `border-color ${tokens.transitionFast} ease, box-shadow ${tokens.transitionFast} ease`,
  },
  textarea: {
    flex: 1,
    border: "none",
    borderRadius: tokens.radiusMd,
    padding: "8px 8px",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: 44,
    maxHeight: 120,
    background: "transparent",
    color: tokens.text,
    lineHeight: 1.5,
  },
  attachBtn: {
    width: 34,
    height: 34,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: "transparent",
    color: tokens.textSecondary,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: `linear-gradient(145deg, ${tokens.accent} 0%, ${tokens.accentHover} 100%)`,
    color: "#fff",
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: "0 2px 8px rgba(79, 70, 229, 0.35)",
  },
  stopBtn: {
    width: 34,
    height: 34,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.danger,
    color: "#fff",
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: "0 2px 8px rgba(220, 38, 38, 0.28)",
  },
}

function LogBar({ onClose }: { onClose: () => void }) {
  const { state } = useAgentStore()
  const logs = state.logs.slice(-5)
  return (
    <div style={logStyles.container}>
      <button onClick={onClose} style={logStyles.closeBtn}>✕</button>
      {logs.map((l, i) => (
        <div key={i} style={logStyles.line}>
          <span style={{...logStyles.level, color: l.level === "error" ? tokens.danger : l.level === "warn" ? tokens.warning : tokens.textMuted}}>{l.level.toUpperCase().padEnd(5)}</span>
          <span style={logStyles.source}>{l.source.padEnd(14)}</span>
          <span style={logStyles.event}>{l.event}</span>
        </div>
      ))}
    </div>
  )
}

const logStyles: Record<string, React.CSSProperties> = {
  container: { position: "relative" as const, borderTop: "1px solid #eee", padding: "4px 8px", maxHeight: 120, overflowY: "auto", background: "#fafafa", fontFamily: "monospace", fontSize: 10 },
  line: { display: "flex", gap: 8, padding: "1px 0", whiteSpace: "nowrap" },
  level: { width: 40, flexShrink: 0 },
  source: { width: 120, color: "#666", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" },
  event: { flex: 1, overflow: "hidden", textOverflow: "ellipsis" },
  closeBtn: { position: "absolute" as const, right: 4, top: 2, background: "none", border: "none", fontSize: 12, cursor: "pointer", color: "#999" },
}

const toastStyles: Record<string, React.CSSProperties> = {
  toast: {
    position: "fixed" as const,
    top: 52,
    left: 10,
    right: 10,
    background: tokens.text,
    color: "#fff",
    padding: "8px 12px",
    borderRadius: tokens.radiusMd,
    fontSize: 12,
    fontWeight: 500,
    zIndex: 300,
    boxShadow: tokens.shadowMd,
  },
}

const bannerStyles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 14px",
    background: tokens.warningSoft,
    borderBottom: "1px solid #fcd34d",
    flexShrink: 0,
    fontFamily: tokens.font,
  },
  iconWrap: {
    flexShrink: 0,
    marginTop: 1,
    width: 32,
    height: 32,
    borderRadius: tokens.radiusMd,
    background: "#fff",
    border: "1px solid #fcd34d",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    margin: "0 0 4px",
    fontSize: 13,
    fontWeight: 650,
    color: tokens.text,
  },
  text: {
    margin: "0 0 10px",
    fontSize: 12,
    color: tokens.textSecondary,
    lineHeight: 1.5,
  },
  hint: {
    margin: "0 0 10px",
    fontSize: 11,
    color: tokens.textSecondary,
    lineHeight: 1.45,
    wordBreak: "break-all" as const,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  primaryBtn: {
    padding: "6px 12px",
    borderRadius: tokens.radiusSm,
    border: "none",
    background: tokens.accent,
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  secondaryBtn: {
    padding: "6px 12px",
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.borderStrong}`,
    background: "#fff",
    color: tokens.textSecondary,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
}

export default App
