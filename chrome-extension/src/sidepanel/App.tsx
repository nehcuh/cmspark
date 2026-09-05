/* THESIS: Side Panel is a consumer assistant empty, not an instrument desk — first viewport is a person who greets you.
   OWN-WORLD: White surface, ink type, 22px greeting, sentence rows, circular send, indigo spark only on the companion mark.
   STORY: Open → meet someone → type or tap a sentence → work still fits 320px.
   FIRST VIEWPORT: Centered CompanionMark, 要我帮你做什么？, sentence invitations, quiet composer, 新对话.
   FORM: Canon (知乎看山 quality bar) · seed e96a500f · Comp A approved.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { useCapabilityMode } from "./hooks/useCapabilityMode"
import { ToastHost, useToastQueue } from "./components/ToastHost"
import { ChatView } from "./components/ChatView"
import {
  ContextPanelHost,
  ContextPanelHostProvider,
  useContextPanelHost,
} from "./components/ContextPanelHost"
import { FocusBand } from "./components/FocusBand"
import { CodingAgentPanel } from "./components/CodingAgentPanel"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
import { AtThreadPopover } from "./components/AtThreadPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { NotebooklmImporterPanel } from "./components/NotebooklmImporterPanel"
import { StatusRail } from "./components/StatusRail"
import { ComposerChips } from "./components/ComposerChips"
import { ComposerCruisePicker } from "./components/ComposerCruisePicker"
import { ComposerDock } from "./components/ComposerDock"
import { ComposeDrawer } from "./components/ComposeDrawer"
import { ThreadRefChips } from "./components/ThreadRefChips"
import { UploadChips } from "./components/UploadChips"
import { VoiceBanner } from "./components/VoiceBanner"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import type { CapabilityLevel, FileAttachment } from "./types"
import {
  composerPlaceholder,
  type ComposerChipAction,
} from "./composer/meta-slash"
import { tokens } from "./ui/tokens"
import { PanelBanner, panelBannerBtnStyles } from "./ui/PanelBanner"
import {
  IconSend,
  IconStop,
  IconAttach,
  IconAlert,
} from "./ui/icons"
import { VoiceMicButton } from "./components/VoiceMicButton"
import { VoiceStatusCapsule } from "./components/VoiceStatusCapsule"
import { VoicePrivacySheet } from "./components/VoicePrivacySheet"
import { POSTPROCESS_BADGE_LABEL } from "./voice/postprocess-badge"
import { capsuleView } from "./voice/capsule-view"
import { collectRunningTools } from "./utils/running-tools"
import {
  composerBusyPlaceholder,
  resolveComposerMode,
} from "./utils/thread-busy"
import {
  IMAGE_ACCEPT,
  IMAGE_PREFLIGHT_NO_VISION,
  checkComposerImageCaps,
  defaultCaption,
  isAllowlistedImageMime,
  visionRailOpen,
} from "./utils/image-compose"
import { useComposerVoice } from "./hooks/useComposerVoice"
import { useComposerIngest } from "./hooks/useComposerIngest"
import { useComposerMentions } from "./hooks/useComposerMentions"
import { extractHostname, resolveNativeVision } from "./components/vision-reuse-logic"
import { buildOptimisticUploadBubble, nextComposerText, uploadSendFailureOps, uploadSendOutcome } from "./utils/upload-send"
import { newTempUserMessageId } from "../utils/temp-message-id"
import { shouldApplyStreamEvent } from "./hooks/useWebSocket"
import { useScopedRunBusy } from "./hooks/use-scoped-run-busy"
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
          fontFamily: tokens.font,
          fontSize: 13,
          color: tokens.text,
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
  const { toasts, showToast, closeToast } = useToastQueue()
  // Full-height Coding Agent Panel (Zed-like shell) — primary /code surface
  const [codingPanelOpen, setCodingPanelOpen] = useState(false)
  const [codingPanelSeed, setCodingPanelSeed] = useState<string | undefined>()

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { seedGoal?: string } | undefined
      setCodingPanelSeed(detail?.seedGoal)
      setCodingPanelOpen(true)
    }
    window.addEventListener("cmspark:open-coding-handoff", onOpen as EventListener)
    return () => window.removeEventListener("cmspark:open-coding-handoff", onOpen as EventListener)
  }, [])

  // Auto-open panel when a coding session starts (e.g. from offer CTA)
  useEffect(() => {
    if (appState.codingSession) setCodingPanelOpen(true)
  }, [appState.codingSession?.sessionId])

  // Show auto-matched skill toast (#321 PR-3: single queue, no bare setToast)
  useEffect(() => {
    if (appState.autoSkillNames) {
      showToast(`🤖 自动匹配: ${appState.autoSkillNames}`)
      dispatch({ type: "SET_AUTO_SKILLS", names: "" })
    }
  }, [appState.autoSkillNames, showToast, dispatch])

  // Capability level (chat / browser / computer) — StatusRail badge, chips / FocusBand
  const onEscalate = useCallback((msg: string) => {
    showToast(msg)
  }, [showToast])
  // #321 PR-2: pop the active thread into a dialog window (moved from ChatView bar → rail)
  const handlePopout = useCallback(() => {
    const threadId = appState.activeThreadId
    if (!threadId) return
    chrome.runtime.sendMessage({ type: "overlay.shell.open", thread_id: threadId }, (response) => {
      if (chrome.runtime.lastError || response?.ok === false) {
        showToast("无法弹出对话框")
      }
    })
  }, [appState.activeThreadId, showToast])
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail !== "string" || !detail) return
      showToast(detail)
    }
    window.addEventListener("cmspark:toast", onToast as EventListener)
    return () => window.removeEventListener("cmspark:toast", onToast as EventListener)
  }, [showToast])
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
      <StatusRail
        connectionState={connectionState}
        capabilityLevel={level}
        badgeLabel={badgeLabel}
        onCraft={() => setCraftOpen(true)}
        onToggleLogs={() => setShowLogs(!showLogs)}
        onOpenNotebooklmImporter={() => setNbImporterOpen(true)}
        onToast={showToast}
        onPopout={handlePopout}
        canPopout={!!appState.activeThreadId}
      />
      {/* #321 PR-3: toast host lives in a zero-height slot right under the rail —
          its top is DOM-anchored to the rail, so no `top:52` rail-height magic. */}
      <div style={{ position: "relative", height: 0, flexShrink: 0 }}>
        <ToastHost toasts={toasts} onClose={closeToast} />
      </div>
      {/* UIUX v2 §4.3 FocusBand: Confirm > L2 Safety+急停 > Fleet > L1 Context; ≤80px.
          #321 PR-2「一条 Now」: SceneStatusBar / RunBusyChip / WorkerScopeBar merged
          into FocusBand slots — no fourth band above the conversation. */}
      <FocusBand capabilityLevel={level} />
      <ChatView />
      <FleetWorkerListPortal />
      {/* R3: ComputerTaskBar removed — step timeline only in Cockpit dual-track */}
      {/* #321 PR-1: legacy BottomBar strip deleted (was permanently gated off). Host is SoT. */}
      <ContextPanelHost />
      <InputArea capabilityLevel={level} />
      {showLogs && <LogBar onClose={() => setShowLogs(false)} />}
      <SettingsSlideout />
      {/* Full-height 编程接力 壳 — replaces old task-package-only modal as primary UX */}
      <CodingAgentPanel
        open={codingPanelOpen}
        onClose={() => setCodingPanelOpen(false)}
        workspaceRoot={
          (
            appState.threads.find((t) => t.id === appState.activeThreadId) as
              | { workspace_root?: string | null }
              | undefined
          )?.workspace_root ?? null
        }
        messages={(appState.messages || []) as Array<{ role?: string; content?: string }>}
        pageUrl={(appState as { lastTabUrl?: string }).lastTabUrl || null}
        pageTitle={(appState as { lastTabTitle?: string }).lastTabTitle || null}
        seedGoal={codingPanelSeed}
        threadId={appState.activeThreadId}
        acpEnabled={appState.acpEnabled}
        acpAgents={appState.acpAgents}
        openLocalTerminal={
          (
            appState.config as
              | { coding_handoff?: { open_local_terminal?: boolean } }
              | undefined
          )?.coding_handoff?.open_local_terminal === true
        }
      />
      {/* P1 D10′: full confirm dialog removed from Panel — Cockpit ConfirmElevated + MinimalConfirm */}
      <McpServerForm />
      {craftOpen && <SkillCraftPanel onClose={() => setCraftOpen(false)} />}
      {nbImporterOpen && <NotebooklmImporterPanel onClose={() => setNbImporterOpen(false)} />}
      <DisconnectedBanner
        visible={connectionState === "disconnected"}
        onRetry={() => {
          // P1 C-RACE-07: force SW reconnect (reset backoff), then probe status.
          chrome.runtime.sendMessage({ type: "ws.forceReconnect" }, () => {
            if (chrome.runtime.lastError) {
              showToast("无法联系扩展后台，请刷新 Side Panel 后重试", "error")
              return
            }
            chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
              if (chrome.runtime.lastError) {
                showToast("正在尝试重新连接…", "warning")
                return
              }
              if (response?.connectionState === "connected") {
                showToast("已连接 Companion", "info")
                return
              }
              showToast("正在尝试重新连接…若 Companion 已启动将自动恢复", "warning")
            })
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

  useEffect(() => {
    const restore = state.composerRestore
    if (!restore?.text) return
    setText((prev) => nextComposerText(prev, restore.text))
    dispatch({ type: "CLEAR_COMPOSER_RESTORE" })
  }, [state.composerRestore?.token])
  const [composeOpen, setComposeOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const textRef = useRef(text)
  textRef.current = text
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
  // D12′ must-fix: hard-gate Panel send while computer task is active (running/paused)
  const taskActive =
    isComputer &&
    !!state.computerTask &&
    (state.computerTask.status === "running" || state.computerTask.status === "paused")
  const runningTools = collectRunningTools(state.messages)
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  // #321 PR-2: single scoped run-busy derivation (shared with FocusBand).
  const scopedRunBusy = useScopedRunBusy()
  const threadBusy = scopedRunBusy.threadBusy
  const lockCount = scopedRunBusy.lockCount
  const runBusy = scopedRunBusy.runBusy
  const composerMode = resolveComposerMode({ taskActive, threadBusy, runBusy })
  const isWorker = activeThread?.agent_role === "worker"
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"
  const showStop = threadBusy || isStreaming

  const {
    slashVisible, setSlashVisible, slashQuery,
    atVisible, setAtVisible, atQuery,
    threadRefs, setThreadRefs, slashSkills,
    handleChange, handleAtSelect, handleSlashSelect, dismissThreadRef,
  } = useComposerMentions({ text, setText, textareaRef, openCompose, setComposeOpen })

  const {
    voice, voiceLevel, pttLocked, voiceCapsuleHint, postprocessedBadge,
    voicePrivacyOpen, setVoicePrivacyOpen, voicePrivacyKind,
    engineSwitchNote, setEngineSwitchNote, sttEngine, showVoiceMic,
    voiceMicDisabled, voiceMicTitle, voiceMicTimerLabel, voiceMicLiveStatus,
    voiceBannerCta, handleSwitchBrowserEngine, handleOpenVoiceSettings,
  } = useComposerVoice({
    textRef, setText, textareaRef, threadBusy, needsThread, isWorker,
    closePanel, setComposeOpen,
  })

  const overlayStandby = state.overlayStandby

  const ingestBlocked =
    needsThread ||
    needsConnection ||
    threadBusy ||
    composerMode === "l2_task" ||
    voice.liveOverlay !== null ||
    voice.listening ||
    !!overlayStandby

  const {
    selectedFiles, selectedFilesRef, fileError, setFileError,
    destAck, setDestAck, destAckRef, dragOver, fileInputRef,
    handleFileSelect, handleComposerPaste, handleComposerDragOver,
    handleComposerDragEnter, handleComposerDragLeave, handleComposerDrop,
    removeFile, gestureSendRef,
  } = useComposerIngest({ ingestBlocked, textRef })

  const hasContent = text.trim().length > 0 || selectedFiles.length > 0
  // Disable send while dictating — mid-listen send would ship base snapshot only
  const canSend =
    composerMode !== "l2_task" &&
    hasContent &&
    !!state.activeThreadId &&
    state.connectionState === "connected" &&
    !voice.listening &&
    !overlayStandby

  const effectiveModel =
    (activeThread?.config_override?.model_name || "").trim() ||
    state.config.model_name
  const effectiveLlmBase =
    (typeof activeThread?.config_override?.base_url === "string" &&
      activeThread.config_override.base_url.trim()) ||
    state.config.base_url
  const useNativeVision = resolveNativeVision({
    modelName: effectiveModel,
    baseUrl: effectiveLlmBase,
    mode: state.config.native_vision,
    // Probe bit is keyed {url,model} (companion config.test echo), so preflight,
    // destHost and the dest-ack route exactly like the companion probe cache.
    // Never pass the unkeyed session flag — it would treat any later model as
    // native after one test.
  })
  const destHost = extractHostname(
    useNativeVision ? effectiveLlmBase : state.config.vision_base_url,
  )
  const getPlaceholder = () => {
    if (overlayStandby) return overlayStandby.label
    if (needsThread) return "请先创建或选择一个线程"
    if (needsConnection) return "等待 companion 连接..."
    if (voice.processing) return sttEngine === "local" ? "正在本机识别…" : "正在识别…"
    if (voice.listening) {
      const localNearRt =
        sttEngine === "local" &&
        state.voiceDictationMode === "continuous" &&
        state.voiceRealtimeStreaming !== false
      if (sttEngine === "local") {
        return localNearRt ? "正在听…约 8 秒出第一段字" : "正在听…结束后出字"
      }
      return "正在听…"
    }
    if (voice.refining) return "正在纠错…"
    const busyPh = composerBusyPlaceholder(composerMode, {
      lockCount,
      isWorker,
      roleLabel: activeThread?.worker_role_label || activeThread?.alias || undefined,
    })
    if (busyPh) return busyPh
    return composerPlaceholder(capabilityLevel)
  }
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

    if (threadBusy && e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && canSend) {
      e.preventDefault()
      handleSend(undefined, { enqueue: true })
      return
    }

    if (shouldSend && canSend) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = (overrideFiles?: FileAttachment[], opts?: { enqueue?: boolean }) => {
    const files = Array.isArray(overrideFiles) ? overrideFiles : selectedFilesRef.current
    const trimmed = textRef.current.trim()
    const sendAllowed =
      composerMode !== "l2_task" &&
      !!state.activeThreadId &&
      state.connectionState === "connected" &&
      !voice.listening &&
      !state.overlayStandby
    if (!sendAllowed || sendingRef.current) return
    if (!trimmed && files.length === 0) return
    if (threadBusy) {
      if (files.length > 0) return
      sendingRef.current = true
      try {
        chrome.runtime.sendMessage({
          type: "chat.send",
          threadId: state.activeThreadId,
          message: trimmed,
          ...(opts?.enqueue ? { enqueue: true } : { steer: true }),
        })
        setText("")
        // New user turn: the previous compaction notice is no longer latest.
        if (state.activeThreadId) {
          dispatch({ type: "CLEAR_CONTEXT_COMPACTED", threadId: state.activeThreadId })
        }
      } finally {
        sendingRef.current = false
      }
      return
    }
    // Defense in depth: never dual-conduct while L2 task is active
    if (
      isComputer &&
      state.computerTask &&
      (state.computerTask.status === "running" || state.computerTask.status === "paused")
    ) {
      return
    }

    const imageFiles = files.filter((f) => isAllowlistedImageMime(f.type))
    const docFiles = files.filter((f) => !isAllowlistedImageMime(f.type))
    if (imageFiles.length > 0) {
      const capErr = checkComposerImageCaps(imageFiles)
      if (capErr) {
        setFileError(capErr)
        return
      }
      const useNative = resolveNativeVision({
        modelName: effectiveModel,
        baseUrl: effectiveLlmBase,
        mode: state.config.native_vision,
      })
      if (!useNative && !visionRailOpen(state.config)) {
        setFileError(IMAGE_PREFLIGHT_NO_VISION)
        return
      }
      if (useNative) {
        const host = extractHostname(effectiveLlmBase)
        const ackKey = `cmspark.imageDestAck.${host}`
        if (!destAckRef.current[ackKey]) {
          setDestAck(`图片将发送至 ${host}`)
          const iso = new Date().toISOString()
          destAckRef.current[ackKey] = iso
          try {
            chrome.storage.local.set({ [ackKey]: iso })
          } catch {
            /* ignore */
          }
        }
      }
    }

    sendingRef.current = true
    // New user turn: the previous compaction notice is no longer latest.
    // (after all preflight early-returns, so a blocked send keeps the banner)
    if (state.activeThreadId) {
      dispatch({ type: "CLEAR_CONTEXT_COMPACTED", threadId: state.activeThreadId })
    }
    try {
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
      if (files.length > 0) {
        const userMessage = defaultCaption({
          images: imageFiles.length,
          docs: docFiles.length,
          userText: trimmed,
        })
        const uploadThreadId = state.activeThreadId
        const panelDiag = {
          thread_id: uploadThreadId,
          connection: state.connectionState,
          isProcessing: state.isProcessing,
          mapBusy: !!(uploadThreadId && state.threadBusyById[uploadThreadId]),
          file_count: files.length,
          files: files.map((f) => ({
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

        // Optimistic bubble (F2): a new companion's chat.user echo adopts it via
        // client_message_id; an old companion (no echo) simply keeps it — the
        // upload turn never vanishes from the transcript.
        const { clientMessageId, message: uploadBubble } = buildOptimisticUploadBubble({
          threadId: uploadThreadId!,
          userMessage,
          fileNames: files.map((f) => f.name),
        })
        dispatch({ type: "ADD_MESSAGE", message: uploadBubble })
        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        if (uploadThreadId) {
          dispatch({ type: "SET_THREAD_BUSY", threadId: uploadThreadId, busy: true })
        }
        dispatch({
          type: "SET_PENDING_UPLOAD",
          threadId: uploadThreadId!,
          messageId: clientMessageId,
          composerText: userMessage,
        })

        chrome.runtime.sendMessage(
          {
            type: "file.upload",
            threadId: uploadThreadId,
            message: userMessage,
            files,
            skillIds,
            clientMessageId,
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
            const sendOutcome = uploadSendOutcome(swErr, response)
            if (sendOutcome !== "ok") {
              // F2 failure retract: drop the optimistic user turn unless the
              // WS frame was accepted. Ops run even after a thread switch so
              // mapBusy clears; panel unlock / error bubble stay gated.
              const ops = uploadSendFailureOps({
                clientMessageId,
                uploadThreadId: uploadThreadId || "",
                sendOutcome,
                swErr,
                applyToActivePanel: shouldApplyStreamEvent(uploadThreadId, activeThreadIdRef.current),
                composerText: userMessage,
              })
              for (const op of ops) {
                if (op.op === "retract") {
                  dispatch({ type: "REMOVE_MESSAGE", id: op.id })
                  if (uploadThreadId) {
                    dispatch({ type: "CLEAR_PENDING_UPLOAD", threadId: uploadThreadId })
                  }
                } else if (op.op === "busy_off") {
                  dispatch({ type: "SET_THREAD_BUSY", threadId: op.threadId, busy: false })
                } else if (op.op === "unlock_panel") {
                  dispatch({ type: "SET_PROCESSING_STATUS", status: null })
                  dispatch({ type: "SET_PROCESSING", isProcessing: false })
                } else if (op.op === "restore_composer") {
                  setText((prev) => nextComposerText(prev, op.text))
                } else if (op.op === "error_bubble") {
                  dispatch({
                    type: "ADD_MESSAGE",
                    message: {
                      id: `${uploadThreadId || "file"}_send_err_${Date.now()}`,
                      thread_id: uploadThreadId || "",
                      role: "assistant",
                      content: op.content,
                      created_at: new Date().toISOString(),
                    },
                  })
                }
              }
            }
          },
        )
      } else {
        // Same clientMessageId as SW `chat.user` echo so ADD_MESSAGE dedupes
        // when both optimistic local append and multi-surface broadcast land.
        const clientMessageId = newTempUserMessageId(state.activeThreadId)
        const context_refs = threadRefs.map((r) => ({
          type: "thread" as const,
          id: r.id,
          mode: "summary_card" as const,
          title: r.title,
        }))
        const displayContent =
          context_refs.length > 0
            ? `${trimmed}\n\n📎 引用 ${context_refs.length} 个会话`
            : trimmed
        // Paint the user bubble before busy chrome so the transcript never
        // shows 「思考中」 without the query that started it.
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
      }

      setText("")
      setSlashVisible(false)
      setAtVisible(false)
      setThreadRefs([])
      // selectedFiles stay until companion file.uploaded (BUMP_COMPOSER_UPLOAD_CLEAR).
    } finally {
      sendingRef.current = false
    }
  }

  const handleStop = () => {
    // SoT §6.4: abort recognition first, then chat.abort
    voice.abortForChatStop()
    chrome.runtime.sendMessage({
      type: "chat.abort",
      threadId: state.activeThreadId,
    })
    dispatch({ type: "SET_STREAMING", content: "" })
    dispatch({ type: "SET_STREAMING_REASONING", content: "" })
    dispatch({ type: "SET_PROCESSING_STATUS", status: null })
    dispatch({ type: "SET_PROCESSING", isProcessing: false })
  }

  gestureSendRef.current = (files) => handleSend(files)

  return (
    <div
      style={{ borderTop: `1px solid ${tokens.border}`, flexShrink: 0, position: "relative" as const, background: tokens.bg }}
      onPaste={handleComposerPaste}
      onDragEnter={handleComposerDragEnter}
      onDragOver={handleComposerDragOver}
      onDragLeave={handleComposerDragLeave}
      onDrop={handleComposerDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={IMAGE_ACCEPT}
        onChange={handleFileSelect}
      />
      <UploadChips
        fileError={fileError}
        onDismissError={() => setFileError("")}
        destAck={destAck}
        onDismissAck={() => setDestAck("")}
        selectedFiles={selectedFiles}
        destHost={destHost}
        onRemove={removeFile}
      />
      <ThreadRefChips threadRefs={threadRefs} onDismiss={dismissThreadRef} />
      <AtThreadPopover
        threads={state.threads}
        excludeId={state.activeThreadId}
        searchText={atQuery}
        visible={atVisible}
        anchorEl={textareaRef.current}
        onSelect={handleAtSelect}
        onDismiss={() => setAtVisible(false)}
      />
      <VoiceStatusCapsule
        view={capsuleView({
          phase: voice.phase,
          engine: sttEngine === "local" ? "local" : "browser",
          locked: pttLocked,
          level: voiceLevel,
        })}
        level={voiceLevel}
        extraHint={voiceCapsuleHint}
        badge={postprocessedBadge ? POSTPROCESS_BADGE_LABEL : null}
      />
      {/* PR4: ComposerDock chips + capsule; 装配 lives on the chip, not in the field */}
      <ComposerDock
        chips={<ComposerChips capabilityLevel={capabilityLevel} onAction={handleChipAction} />}
      >
        <div
          style={{
            ...styles.composerCapsule,
            opacity: needsThread || needsConnection ? 0.85 : 1,
            background: needsThread || needsConnection ? tokens.bgMuted : tokens.bgElevated,
            borderColor: dragOver ? tokens.accent : tokens.borderStrong,
            boxShadow: dragOver ? `0 0 0 1px ${tokens.accent}` : tokens.shadowSm,
          }}
        >
          {/* Attach stays visible in the empty composer — first-run affordance. */}
          {!showStop && !(voice.listening && showVoiceMic) && (
            <button
              type="button"
              style={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
              // l2_task: ingest is blocked for an active computer task — don't
              // present a clickable affordance whose selection is silently dropped.
              disabled={needsThread || needsConnection || threadBusy || composerMode === "l2_task" || !!overlayStandby}
              title="添加文件或图片"
              aria-label="添加文件或图片"
            >
              <IconAttach size={16} />
            </button>
          )}
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            placeholder={getPlaceholder()}
            rows={1}
            value={voice.liveOverlay !== null ? voice.liveOverlay : text}
            // Disable whenever live overlay owns the value (listening + processing gaps).
            // Otherwise keystrokes are invisible and next final flush overwrites them.
            disabled={
              needsThread ||
              needsConnection ||
              voice.liveOverlay !== null ||
              !!overlayStandby
            }
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handleComposerPaste}
          />
          {showVoiceMic && (
            <VoiceMicButton
              listening={voice.listening && !voice.processing}
              processing={voice.processing}
              disabled={voiceMicDisabled && !voice.listening}
              title={voiceMicTitle}
              timerLabel={voiceMicTimerLabel}
              liveStatus={voiceMicLiveStatus}
              onClick={() => voice.toggle()}
            />
          )}
          {showStop && threadBusy && !taskActive && (
            <button
              type="button"
              style={styles.sendBtn}
              onClick={() => handleSend()}
              disabled={!canSend}
              title="纠偏当前这一轮"
            >
              纠偏
            </button>
          )}
          {showStop && threadBusy && !taskActive && (
            <button
              type="button"
              style={styles.attachBtn}
              onClick={() => handleSend(undefined, { enqueue: true })}
              disabled={!canSend}
              title="排队到本轮结束后"
            >
              排队
            </button>
          )}
          <ComposerCruisePicker />
          {showStop ? (
            <button
              type="button"
              style={styles.stopBtn}
              onClick={handleStop}
              title={
                voice.listening
                  ? "停止听写并停止本轮"
                  : isWorker
                    ? "停止该子任务（本轮）"
                    : "停止本轮"
              }
            >
              <IconStop size={14} />
            </button>
          ) : (
            <button
              type="button"
              style={{
                ...styles.sendBtn,
                background: canSend ? tokens.accent : tokens.sendDisabledBg,
                color: canSend ? tokens.userBubbleText : tokens.textMuted,
                cursor: canSend ? "pointer" : "not-allowed",
              }}
              onClick={() => handleSend()}
              disabled={!canSend}
              title={
                overlayStandby
                  ? overlayStandby.label
                  : needsThread
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
        <VoiceBanner
          banner={voice.banner}
          engineSwitchNote={engineSwitchNote}
          rawSnapshot={voice.rawSnapshot}
          refining={voice.refining}
          voiceBannerCta={voiceBannerCta}
          onRestoreRaw={() => voice.restoreRaw()}
          onSwitchBrowser={handleSwitchBrowserEngine}
          onOpenSettings={handleOpenVoiceSettings}
          onDismiss={() => {
            voice.dismissBanner()
            setEngineSwitchNote(null)
          }}
        />
        <VoicePrivacySheet
          open={voicePrivacyOpen}
          kind={voicePrivacyKind}
          onCancel={() => setVoicePrivacyOpen(false)}
          onAgree={() => {
            if (voicePrivacyKind === "v3") {
              dispatch({ type: "SET_VOICE_PRIVACY_ACK_V3", ack: true })
              setVoicePrivacyOpen(false)
              voice.toggle({ privacyAck: true, privacyAckV3: true })
            } else if (voicePrivacyKind === "v2") {
              dispatch({ type: "SET_VOICE_PRIVACY_ACK_V2", ack: true })
              setVoicePrivacyOpen(false)
              voice.toggle({ privacyAckV2: true })
            } else {
              dispatch({ type: "SET_VOICE_PRIVACY_ACK_V1", ack: true })
              setVoicePrivacyOpen(false)
              // Pass ack override — React state may not have re-rendered yet
              voice.toggle({ privacyAck: true })
            }
          }}
        />
        <SlashCommandPopover
          skills={slashSkills}
          searchText={slashQuery}
          visible={slashVisible}
          anchorEl={textareaRef.current}
          onSelect={handleSlashSelect}
          onDismiss={() => setSlashVisible(false)}
        />
        {state.messages.length === 0 && !isStreaming && (
          <div style={styles.legal}>本地 Companion · 确认后才会执行危险操作</div>
        )}
      </ComposerDock>
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
    <PanelBanner
      tone="warning"
      title="Companion 未连接"
      icon={<IconAlert size={22} style={{ color: tokens.warning }} />}
      actions={
        <>
          <button type="button" style={panelBannerBtnStyles.primary} onClick={onRetry}>
            重新连接
          </button>
          <button type="button" style={panelBannerBtnStyles.secondary} onClick={handleOpenLogs}>
            查看日志
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        请通过菜单栏启动 Companion，或检查守护进程状态。
      </p>
      {hint ? (
        <p style={{ margin: "8px 0 0", fontSize: 11, wordBreak: "break-all" as const }}>
          {hint}
        </p>
      ) : null}
    </PanelBanner>
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
  @keyframes cmspark-mic-pulse {
    0%, 100% { box-shadow: 0 0 0 0 ${tokens.dangerPulse}; }
    50% { box-shadow: 0 0 0 6px ${tokens.dangerPulseFade}; }
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
    scrollbar-color: ${tokens.scrollbar} transparent;
  }
  *::-webkit-scrollbar { width: 6px; height: 6px; }
  *::-webkit-scrollbar-thumb {
    background: ${tokens.scrollbarThumb};
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
  // Precision Instrument Desk — solid canvas, flat composer (Phase 1)
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: tokens.font,
    fontSize: 13,
    color: tokens.text,
    background: tokens.bg,
    WebkitFontSmoothing: "antialiased",
    position: "relative" as const,
  },
  composerCapsule: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusComposer,
    padding: "6px 10px 6px 12px",
    background: tokens.bgElevated,
    minHeight: 52,
    transition: `border-color ${tokens.transitionFast} ease, box-shadow ${tokens.transitionFast} ease`,
  },
  textarea: {
    flex: 1,
    // Replaced element: without minWidth 0 the cols=20 min-content overflows
    // the 4-element capsule row (attach/textarea/mic/send) in narrow panels.
    minWidth: 0,
    border: "none",
    borderRadius: tokens.radiusMd,
    padding: "4px 0",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: 32,
    maxHeight: 120,
    background: "transparent",
    color: tokens.text,
    lineHeight: 1.45,
  },
  attachBtn: {
    width: 32,
    height: 32,
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
    width: 32,
    height: 32,
    borderRadius: tokens.radiusPill,
    border: "none",
    background: tokens.sendDisabledBg,
    color: tokens.userBubbleText,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  stopBtn: {
    width: 32,
    height: 32,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.danger,
    color: tokens.userBubbleText,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  legal: {
    textAlign: "center" as const,
    fontSize: 11,
    color: tokens.textMuted,
    padding: "8px 4px 0",
    lineHeight: 1.4,
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
  container: {
    position: "relative" as const,
    borderTop: `1px solid ${tokens.border}`,
    padding: "4px 8px",
    maxHeight: 120,
    overflowY: "auto",
    background: tokens.bgMuted,
    fontFamily: tokens.fontMono,
    fontSize: 10,
  },
  line: { display: "flex", gap: 8, padding: "1px 0", whiteSpace: "nowrap" },
  level: { width: 40, flexShrink: 0 },
  source: {
    width: 120,
    color: tokens.textSecondary,
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  event: { flex: 1, overflow: "hidden", textOverflow: "ellipsis" },
  closeBtn: {
    position: "absolute" as const,
    right: 4,
    top: 2,
    background: "none",
    border: "none",
    fontSize: 12,
    cursor: "pointer",
    color: tokens.textMuted,
  },
}

export default App
