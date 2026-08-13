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
import { CodingSessionShell } from "./components/CodingSessionShell"
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
import { PanelBanner, panelBannerBtnStyles } from "./ui/PanelBanner"
import { CodingTaskPackageModal } from "./components/CodingTaskPackageModal"
import { codingHandoffCopy } from "./coding-handoff/copy"
import {
  IconSend,
  IconStop,
  IconAttach,
  IconAlert,
} from "./ui/icons"
import { VoiceMicButton } from "./components/VoiceMicButton"
import { parseHotkeyChord, eventMatchesChord } from "./voice/hotkey-chord"
import { useVoiceInput } from "./hooks/useVoiceInput"
import {
  VOICE_PRIVACY_ACK_V2_BODY,
  VOICE_PRIVACY_ACK_V3_BODY,
} from "./voice/privacy-copy"
import {
  TOAST_SWITCHED_BROWSER,
  formatListenRemaining,
  localListeningStatusLabel,
  localSttBannerCta,
  mapLocalSttError,
} from "./voice/error-map"
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
      {/* ACP Client shell — stay in side panel for input / timeline (Zed-like) */}
      {state.codingSession ? (
        <div style={{ padding: "0 8px 8px" }}>
          <CodingSessionShell session={state.codingSession} />
        </div>
      ) : null}
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
          // P1 C-RACE-07: force SW reconnect (reset backoff), then probe status.
          chrome.runtime.sendMessage({ type: "ws.forceReconnect" }, () => {
            if (chrome.runtime.lastError) {
              showToast("无法联系扩展后台，请刷新 Side Panel 后重试")
              return
            }
            chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
              if (chrome.runtime.lastError) {
                showToast("正在尝试重新连接…")
                return
              }
              if (response?.connectionState === "connected") {
                showToast("已连接 Companion")
                return
              }
              showToast("正在尝试重新连接…若 Companion 已启动将自动恢复")
            })
          })
        }}
      />
    </div>
    </ContextPanelHostProvider>
  )
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
  const [voicePrivacyOpen, setVoicePrivacyOpen] = useState(false)
  /** Privacy sheet: v1 browser · v2 local · v3 continuous/refiner. */
  const [voicePrivacyKind, setVoicePrivacyKind] = useState<"v1" | "v2" | "v3">("v1")
  /** Fail-closed lastKnown engine when companion state not yet mirrored. */
  const [lastKnownVoiceEngine, setLastKnownVoiceEngine] = useState<
    "browser" | "local" | null
  >(null)
  /** Post-CTA residual note after「改用浏览器听写」(Task 7). */
  const [engineSwitchNote, setEngineSwitchNote] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // Path B: lastKnownVoiceEngine for disconnect fail-closed (SoT §7 / ADR-023 L13).
  useEffect(() => {
    try {
      chrome.storage.local.get(["lastKnownVoiceEngine"], (result) => {
        if (result.lastKnownVoiceEngine === "local" || result.lastKnownVoiceEngine === "browser") {
          setLastKnownVoiceEngine(result.lastKnownVoiceEngine)
        }
      })
    } catch {
      /* ignore */
    }
  }, [])

  // Keep lastKnown in sync when live voice.model.state arrives
  useEffect(() => {
    const eng = state.voiceModel?.sttEngine
    if (eng === "local" || eng === "browser") {
      setLastKnownVoiceEngine(eng)
    }
  }, [state.voiceModel?.sttEngine])

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
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"
  const showStop = threadBusy || isStreaming

  // Path B mic matrix (plan Task 6): engine from live state or lastKnown.
  const sttEngine: "browser" | "local" =
    state.voiceModel?.sttEngine === "local" ||
    (state.voiceModel == null && lastKnownVoiceEngine === "local")
      ? "local"
      : "browser"
  const activeModelId =
    state.voiceModel?.localModelId || "medium"
  const localModelReady =
    state.voiceModel?.models?.[activeModelId]?.status === "ready"
  const localBinaryReady = state.voiceModel?.binary?.status === "ready"
  const companionConnected = state.connectionState === "connected"

  // Pull voice.model.state when engine is local so mic gates have live ready flags.
  useEffect(() => {
    if (sttEngine !== "local" || !companionConnected) return
    if (state.voiceModel) return
    try {
      chrome.runtime.sendMessage({ type: "voice.model.get_state" })
    } catch {
      /* */
    }
  }, [sttEngine, companionConnected, state.voiceModel])

  // threadBusy / no thread still block; local readiness is gated inside useVoiceInput
  // so a click can surface mapLocalSttError banners.
  // Mtg1: meeting live capture holds global max-1 STT — block dictation start.
  const voiceAllowStart =
    !threadBusy &&
    !needsThread &&
    state.voiceInputEnabled !== false &&
    !state.meetingCaptureActive

  const voice = useVoiceInput({
    getBaseText: () => textRef.current,
    realtimeStreaming: state.voiceRealtimeStreaming !== false,
    onDraft: (merged) => {
      setText(merged)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = merged.length
        el.setSelectionRange(len, len)
      })
    },
    threadId: state.activeThreadId,
    allowStart: voiceAllowStart,
    enabled: state.voiceInputEnabled !== false,
    privacyAck: state.voicePrivacyAckV1 === true,
    onNeedPrivacyAck: () => {
      setVoicePrivacyKind("v1")
      setVoicePrivacyOpen(true)
    },
    onNeedPermissionBootstrap: () => {
      try {
        const url = chrome.runtime.getURL("tabs/voice-permission.html")
        chrome.tabs.create({ url })
      } catch {
        /* ignore */
      }
    },
    sttEngine,
    companionConnected,
    localReady: { model: localModelReady, binary: localBinaryReady },
    privacyAckV2: state.voicePrivacyAckV2 === true,
    onNeedPrivacyAckV2: () => {
      setVoicePrivacyKind("v2")
      setVoicePrivacyOpen(true)
    },
    modelId: activeModelId,
    dictationMode: state.voiceDictationMode === "continuous" ? "continuous" : "classic",
    privacyAckV3: state.voicePrivacyAckV3 === true,
    onNeedPrivacyAckV3: () => {
      setVoicePrivacyKind("v3")
      setVoicePrivacyOpen(true)
    },
    asrRefinerEnabled: state.asrRefinerEnabled === true,
    getCurrentDraft: () => textRef.current,
  })

  // Mirror dictation activity for MeetingPanel mutual-exclusion (SoT Mtg1).
  useEffect(() => {
    const active =
      voice.listening === true ||
      voice.processing === true ||
      voice.refining === true
    dispatch({ type: "SET_DICTATION_CAPTURE_ACTIVE", active })
  }, [voice.listening, voice.processing, voice.refining, dispatch])

  // D2 hold: keep stable refs so effect is NOT torn down every listenTick (REJECT #1).
  const holdStartRef = useRef(voice.holdStart)
  const holdStopRef = useRef(voice.holdStop)
  holdStartRef.current = voice.holdStart
  holdStopRef.current = voice.holdStop
  const meetingCaptureRef = useRef(state.meetingCaptureActive)
  meetingCaptureRef.current = state.meetingCaptureActive
  const voiceAllowStartRef = useRef(voiceAllowStart)
  voiceAllowStartRef.current = voiceAllowStart
  const privacyRef = useRef({
    v1: state.voicePrivacyAckV1 === true,
    v2: state.voicePrivacyAckV2 === true,
    v3: state.voicePrivacyAckV3 === true,
  })
  privacyRef.current = {
    v1: state.voicePrivacyAckV1 === true,
    v2: state.voicePrivacyAckV2 === true,
    v3: state.voicePrivacyAckV3 === true,
  }

  // Dictation+ D2: hold hotkey (Side Panel window key capture).
  // SoT §5.2 — default off; ban fn/Win+V; xor meeting capture.
  useEffect(() => {
    if (!state.dictationHotkeyEnabled) return
    const chord = parseHotkeyChord(state.dictationHotkeyChord)
    if (!chord) return

    let down = false
    let notified = false
    let notifyTimer: ReturnType<typeof setTimeout> | null = null
    const notifyHold = (active: boolean) => {
      try {
        chrome.runtime.sendMessage({
          type: "voice.dictation.hold_state",
          v: 1,
          active,
          chord: chord.label,
        })
      } catch {
        /* */
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!eventMatchesChord(e, chord)) return
      if (e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      if (down) return
      if (meetingCaptureRef.current) return
      if (!voiceAllowStartRef.current) return
      down = true
      notified = false
      const ok = holdStartRef.current({
        privacyAck: privacyRef.current.v1,
        privacyAckV2: privacyRef.current.v2,
        privacyAckV3: privacyRef.current.v3,
      })
      if (!ok) {
        down = false
        return
      }
      // Defer notify ~400ms so privacy-sheet / failed start does not flash tray
      if (notifyTimer) clearTimeout(notifyTimer)
      notifyTimer = setTimeout(() => {
        if (down && !notified) {
          notified = true
          notifyHold(true)
        }
      }, 400)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!down) return
      const modUp =
        (chord.ctrl && e.key === "Control") ||
        (chord.alt && (e.key === "Alt" || e.key === "AltGraph")) ||
        (chord.shift && e.key === "Shift") ||
        (chord.meta && (e.key === "Meta" || e.key === "OS"))
      const mainUp = eventMatchesChord(e, chord)
      // Also treat keyup of the main key even if modifiers already released
      const keyIsMain =
        chord.key === "space"
          ? e.key === " " || e.key === "Spacebar" || e.code === "Space"
          : e.key.toLowerCase() === chord.key
      if (!mainUp && !modUp && !keyIsMain) return
      e.preventDefault()
      down = false
      if (notifyTimer) {
        clearTimeout(notifyTimer)
        notifyTimer = null
      }
      holdStopRef.current()
      if (notified) notifyHold(false)
      notified = false
    }

    const onBlur = () => {
      if (!down) return
      down = false
      if (notifyTimer) {
        clearTimeout(notifyTimer)
        notifyTimer = null
      }
      holdStopRef.current()
      if (notified) notifyHold(false)
      notified = false
    }

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", onBlur)
      if (notifyTimer) clearTimeout(notifyTimer)
      if (down) {
        holdStopRef.current()
        if (notified) notifyHold(false)
      }
    }
  }, [state.dictationHotkeyEnabled, state.dictationHotkeyChord])

  // Hide: feature off | unsupported for selected engine | worker | no thread.
  // Local + no gUM → voice.supported false → hide.
  // Browser + no SpeechRecognition → hide.
  const showVoiceMic =
    voice.supported &&
    state.voiceInputEnabled !== false &&
    !isWorker &&
    !needsThread

  // Disable only for thread/feature gates; local readiness fails open on click → banner.
  const voiceMicDisabled = !voiceAllowStart && !voice.listening
  const capturing =
    voice.listening &&
    !voice.processing &&
    voice.listenRemainingMs != null
  const localCapturing = sttEngine === "local" && capturing
  const continuousMode = state.voiceDictationMode === "continuous"
  const continuousCapturing = continuousMode && capturing
  const continuousProcessing =
    continuousMode && voice.processing && voice.listenRemainingMs != null
  const voiceMicTimerLabel =
    localCapturing || continuousCapturing || continuousProcessing
      ? formatListenRemaining(voice.listenRemainingMs!)
      : null
  const voiceMicLiveStatus = voice.refining
    ? "纠错中…点击取消"
    : continuousProcessing
      ? `本机分段识别中… · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
      : voice.processing
        ? "本机识别中…点击取消"
        : continuousCapturing
          ? `连续听写 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
          : localCapturing
            ? localListeningStatusLabel(voice.listenRemainingMs!)
            : null
  const voiceMicTitle = (() => {
    if (state.meetingCaptureActive) return "会议录音进行中，请先结束会议再听写"
    if (threadBusy) return "处理中无法听写"
    if (voice.refining) return "纠错中…点击取消"
    if (continuousProcessing) {
      return `本机分段识别中… · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
    }
    if (voice.processing) return "本机识别中…点击取消"
    if (continuousCapturing) {
      return `连续听写中 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · 再点结束`
    }
    if (localCapturing) {
      return localListeningStatusLabel(voice.listenRemainingMs!)
    }
    if (voice.listening) return "结束语音输入"
    if (sttEngine === "local") {
      if (!companionConnected) return mapLocalSttError("companion_disconnected").message
      if (!localModelReady) return mapLocalSttError("model_missing").message
      if (!localBinaryReady) return mapLocalSttError("binary_missing").message
    }
    return "语音输入（听写进草稿）"
  })()

  /** Banner recovery CTA (Task 7): switch browser or open settings. */
  const voiceBannerCta =
    sttEngine === "local" && voice.banner
      ? localSttBannerCta(voice.errorCode)
      : null

  const handleSwitchBrowserEngine = useCallback(() => {
    // Write path: same dual fence as Settings (SoT §5.3).
    try {
      chrome.runtime.sendMessage({
        type: "voice.model.set_engine",
        engine: "browser",
        source: "settings",
      })
    } catch {
      /* SW missing */
    }
    // Optimistic: so disconnect recovery works before companion ack.
    try {
      chrome.storage.local.set({ lastKnownVoiceEngine: "browser" })
    } catch {
      /* */
    }
    setLastKnownVoiceEngine("browser")
    if (state.voiceModel) {
      dispatch({
        type: "SET_VOICE_MODEL_STATE",
        modelState: { ...state.voiceModel, sttEngine: "browser" },
      })
    }
    voice.dismissBanner()
    setEngineSwitchNote(TOAST_SWITCHED_BROWSER)
  }, [dispatch, state.voiceModel, voice])

  const handleOpenVoiceSettings = useCallback(() => {
    voice.dismissBanner()
    setComposeOpen(false)
    closePanel()
    dispatch({ type: "OPEN_SETTINGS_SECTION", section: "model" })
  }, [closePanel, dispatch, voice])

  // Disable send while dictating — mid-listen send would ship base snapshot only
  const canSend =
    composerMode !== "l2_task" &&
    composerMode !== "thread_busy" &&
    hasContent &&
    !!state.activeThreadId &&
    state.connectionState === "connected" &&
    !voice.listening

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
    // Dual-review residual: drop chips whose @「title」 token was deleted from text
    setThreadRefs((prev) =>
      prev.filter((r) => newValue.includes(`@「${r.title}」`) || newValue.includes(`@${r.id}`)),
    )
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

  const [codingHandoffOpen, setCodingHandoffOpen] = useState(false)
  const [codingHandoffSeed, setCodingHandoffSeed] = useState<string | undefined>()

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { seedGoal?: string } | undefined
      setCodingHandoffSeed(detail?.seedGoal)
      setCodingHandoffOpen(true)
    }
    window.addEventListener("cmspark:open-coding-handoff", onOpen as EventListener)
    return () => window.removeEventListener("cmspark:open-coding-handoff", onOpen as EventListener)
  }, [])

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
      if (meta.metaKind === "coding_handoff") {
        setComposeOpen(false)
        setCodingHandoffSeed(undefined)
        setCodingHandoffOpen(true)
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
                onClick={() => {
                  setThreadRefs((prev) => prev.filter((x) => x.id !== r.id))
                  // Keep textarea token in sync when chip is dismissed
                  setText((t) =>
                    t
                      .replace(new RegExp(`@「${escapeRegExp(r.title)}」\\s*`, "g"), "")
                      .replace(new RegExp(`@${escapeRegExp(r.id)}\\s*`, "g"), ""),
                  )
                }}
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
          {!showStop && !(voice.listening && showVoiceMic) && (
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
            value={voice.liveOverlay !== null ? voice.liveOverlay : text}
            // Disable whenever live overlay owns the value (listening + processing gaps).
            // Otherwise keystrokes are invisible and next final flush overwrites them.
            disabled={
              needsThread ||
              needsConnection ||
              threadBusy ||
              voice.liveOverlay !== null
            }
            onChange={handleChange}
            onKeyDown={handleKeyDown}
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
        {(voice.banner || engineSwitchNote) && (
          <div
            data-testid="voice-banner"
            role="status"
            style={{
              marginTop: 6,
              fontSize: 11,
              color: tokens.textSecondary,
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              lineHeight: 1.4,
              flexWrap: "wrap" as const,
            }}
          >
            <span style={{ flex: "1 1 140px", minWidth: 0 }}>
              {engineSwitchNote || voice.banner}
            </span>
            {voice.rawSnapshot &&
            !voice.refining &&
            voice.banner &&
            /纠错|识别原文/.test(voice.banner) &&
            !engineSwitchNote ? (
              <button
                type="button"
                data-testid="voice-cta-restore-raw"
                onClick={() => {
                  voice.restoreRaw()
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: tokens.accent,
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 0,
                  flexShrink: 0,
                  textDecoration: "underline",
                }}
              >
                还原识别原文
              </button>
            ) : null}
            {voiceBannerCta && !engineSwitchNote ? (
              <button
                type="button"
                data-testid={
                  voiceBannerCta.kind === "switch_browser"
                    ? "voice-cta-switch-browser"
                    : "voice-cta-open-settings"
                }
                onClick={() => {
                  if (voiceBannerCta.kind === "switch_browser") {
                    handleSwitchBrowserEngine()
                  } else {
                    handleOpenVoiceSettings()
                  }
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: tokens.accent,
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 0,
                  flexShrink: 0,
                  textDecoration: "underline",
                }}
              >
                {voiceBannerCta.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                voice.dismissBanner()
                setEngineSwitchNote(null)
              }}
              style={{
                border: "none",
                background: "transparent",
                color: tokens.textMuted,
                cursor: "pointer",
                fontSize: 11,
                padding: 0,
                flexShrink: 0,
              }}
            >
              关闭
            </button>
          </div>
        )}
        {voicePrivacyOpen && (
          <div
            data-testid="voice-privacy-sheet"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              background: tokens.bgElevated,
              fontSize: 12,
              lineHeight: 1.5,
              color: tokens.textSecondary,
            }}
          >
            <div
              style={{
                marginBottom: 8,
                color: tokens.text,
                whiteSpace: "pre-wrap" as const,
              }}
            >
              {voicePrivacyKind === "v3"
                ? VOICE_PRIVACY_ACK_V3_BODY
                : voicePrivacyKind === "v2"
                  ? VOICE_PRIVACY_ACK_V2_BODY
                  : "可选麦克风：浏览器将语音转成文字后填入输入框，默认不自动发送。转写可能使用 Chrome 语音服务（音频可能经网络发送至浏览器厂商），不经过 CMspark Companion。发送后的文字与键入相同，仍受现有确认与信任设置约束。"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={{
                  ...styles.attachBtn,
                  width: "auto",
                  padding: "4px 10px",
                  border: `1px solid ${tokens.border}`,
                  fontSize: 12,
                }}
                onClick={() => setVoicePrivacyOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                style={{
                  ...styles.sendBtn,
                  width: "auto",
                  padding: "4px 12px",
                  fontSize: 12,
                  boxShadow: "none",
                }}
                onClick={() => {
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
              >
                同意并继续
              </button>
            </div>
          </div>
        )}
        <SlashCommandPopover
          skills={slashSkills}
          searchText={slashQuery}
          visible={slashVisible}
          anchorEl={textareaRef.current}
          onSelect={handleSlashSelect}
          onDismiss={() => setSlashVisible(false)}
        />
        <CodingTaskPackageModal
          open={codingHandoffOpen}
          onClose={() => setCodingHandoffOpen(false)}
          workspaceRoot={
            (activeThread as { workspace_root?: string | null } | undefined)?.workspace_root ??
            null
          }
          messages={(state.messages || []) as Array<{ role?: string; content?: string }>}
          pageUrl={(state as { lastTabUrl?: string }).lastTabUrl || null}
          pageTitle={(state as { lastTabTitle?: string }).lastTabTitle || null}
          seedGoal={codingHandoffSeed}
          threadId={state.activeThreadId}
          acpEnabled={state.acpEnabled}
          acpAgents={state.acpAgents}
          onRequestWorkspace={() => {
            // P0: pick in-place — do NOT close modal or only jump to packs
            const tid = state.activeThreadId
            if (!tid) {
              dispatch({
                type: "SET_PROCESSING_STATUS",
                status: "请先选择对话再绑定工作区",
              })
              return
            }
            dispatch({
              type: "SET_PROCESSING_STATUS",
              status: "正在打开文件夹选择…",
            })
            chrome.runtime.sendMessage(
              { type: "workspace.pick", thread_id: tid },
              () => {
                void chrome.runtime.lastError
              },
            )
          }}
          onPasteBack={(note) => {
            const prefix = `【${codingHandoffCopy.productName} handback】\n`
            setText((t) => (t ? `${t}\n\n${prefix}${note}` : `${prefix}${note}`))
            setCodingHandoffOpen(false)
          }}
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
    0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.35); }
    50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
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
  },
  inputArea: {
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px 12px",
    background: tokens.bgElevated,
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
    padding: "8px 8px 8px 6px",
    background: tokens.bgElevated,
    boxShadow: tokens.shadowSm,
    transition: `border-color ${tokens.transitionFast} ease, box-shadow ${tokens.transitionFast} ease`,
  },
  textarea: {
    flex: 1,
    border: "none",
    borderRadius: tokens.radiusMd,
    padding: "6px 8px",
    fontSize: 13,
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
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.accent,
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

const toastStyles: Record<string, React.CSSProperties> = {
  toast: {
    position: "fixed" as const,
    top: 52,
    left: 10,
    right: 10,
    background: tokens.text,
    color: tokens.userBubbleText,
    padding: "8px 12px",
    borderRadius: tokens.radiusMd,
    fontSize: 12,
    fontWeight: 500,
    zIndex: 300,
    boxShadow: tokens.shadowMd,
  },
}

export default App
