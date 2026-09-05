/* THESIS: Side Panel is a consumer assistant empty, not an instrument desk — first viewport is a person who greets you.
   OWN-WORLD: White surface, ink type, 22px greeting, sentence rows, circular send, indigo spark only on the companion mark.
   STORY: Open → meet someone → type or tap a sentence → work still fits 320px.
   FIRST VIEWPORT: Centered CompanionMark, 要我帮你做什么？, sentence invitations, quiet composer, 新对话.
   FORM: Canon (知乎看山 quality bar) · seed e96a500f · Comp A approved.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect, useMemo } from "react"
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
import { AtThreadPopover, type AtThreadChoice } from "./components/AtThreadPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { NotebooklmImporterPanel } from "./components/NotebooklmImporterPanel"
import { StatusRail } from "./components/StatusRail"
import { ComposerChips } from "./components/ComposerChips"
import { ComposerCruisePicker } from "./components/ComposerCruisePicker"
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
import { PanelBanner, panelBannerBtnStyles } from "./ui/PanelBanner"
import {
  IconSend,
  IconStop,
  IconAttach,
  IconAlert,
} from "./ui/icons"
import { VoiceMicButton } from "./components/VoiceMicButton"
import { VoiceStatusCapsule } from "./components/VoiceStatusCapsule"
import { parseHotkeyChord, eventMatchesChord, isPttReleaseEvent } from "./voice/hotkey-chord"
import { POSTPROCESS_BADGE_LABEL } from "./voice/postprocess-badge"
import { useVoiceInput } from "./hooks/useVoiceInput"
import { capsuleView } from "./voice/capsule-view"
import { initialPtt, reducePtt, type PttEffect, type PttState } from "./voice/ptt-reducer"
import { PAGE_INSERT_FALLBACK_HINT } from "./voice/insert-target"
import { playVoiceSfx, shouldPlayVoiceSfx, VOICE_SOUND_EFFECTS_KEY, parseVoiceSoundEffectsPref } from "./voice/voice-sfx"
import {
  VOICE_PRIVACY_ACK_V2_BODY,
  VOICE_PRIVACY_ACK_V3_BODY,
} from "./voice/privacy-copy"
import {
  SYSTEM_LISTEN_HINT,
  TOAST_SWITCHED_BROWSER,
  formatListenRemaining,
  localListeningStatusLabel,
  localSttBannerCta,
  mapLocalSttError,
} from "./voice/error-map"
import { collectRunningTools } from "./utils/running-tools"
import {
  composerBusyPlaceholder,
  resolveComposerMode,
} from "./utils/thread-busy"
import {
  IMAGE_ACCEPT,
  IMAGE_GIF_SHRINK_FIRST,
  IMAGE_MAX_DECODED,
  IMAGE_PREFLIGHT_NO_VISION,
  checkComposerImageCaps,
  classifyDrop,
  compressImageBlob,
  defaultCaption,
  imageTypeRefuseReason,
  isAllowlistedImageMime,
  mimeFromName,
  needsCompress,
  nextFileErrorAfterIngest,
  pasteImageDisplayName,
  visionRailOpen,
} from "./utils/image-compose"
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function blobUrlFromB64(b64: string, mime: string): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }))
  } catch {
    return ""
  }
}

function ComposerImageChip({
  file,
  destHost,
  onRemove,
}: {
  file: FileAttachment
  destHost: string
  onRemove: () => void
}) {
  const [broken, setBroken] = useState(false)
  const url = useMemo(() => blobUrlFromB64(file.content, file.type), [file.content, file.type])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px 2px 2px", background: tokens.accentSoft, borderRadius: tokens.radiusPill,
      fontSize: 11, color: tokens.accentText, maxWidth: 220,
    }}>
      {url && !broken ? (
        <img
          src={url}
          alt={file.name}
          width={48}
          height={48}
          onError={() => setBroken(true)}
          style={{
            width: 48, height: 48, objectFit: "cover", borderRadius: tokens.radiusSm,
            border: `1px solid ${tokens.border}`, background: tokens.bgMuted, display: "block", flexShrink: 0,
          }}
        />
      ) : (
        <span style={{
          width: 48, height: 48, borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`,
          background: tokens.bgMuted, display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: tokens.textMuted, flexShrink: 0,
        }}>
          图
        </span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {file.name} ({formatFileSize(file.size)})
        {file.compressed ? " · 已压缩" : ""}
        {` → ${destHost}`}
      </span>
      <span role="button" onClick={onRemove} style={{ cursor: "pointer", marginLeft: 2, fontWeight: "bold", flexShrink: 0 }}>
        {"\u00d7"}
      </span>
    </span>
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
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [atVisible, setAtVisible] = useState(false)
  const [atQuery, setAtQuery] = useState("")
  const [threadRefs, setThreadRefs] = useState<AtThreadChoice[]>([])
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const [destAck, setDestAck] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [voicePrivacyOpen, setVoicePrivacyOpen] = useState(false)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [pttLocked, setPttLocked] = useState(false)
  const [voiceCapsuleHint, setVoiceCapsuleHint] = useState<string | null>(null)
  const [voiceSoundEffects, setVoiceSoundEffects] = useState(true)
  const [postprocessedBadge, setPostprocessedBadge] = useState(false)
  const insertTargetRef = useRef<"composer" | "page">("composer")
  const pendingPageTextRef = useRef<string | null>(null)
  const pttRef = useRef<PttState>(initialPtt)
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Privacy sheet: v1 browser · v2 local · v3 continuous/refiner. */
  const [voicePrivacyKind, setVoicePrivacyKind] = useState<"v1" | "v2" | "v3">("v1")
  /** Fail-closed lastKnown engine when companion state not yet mirrored. */
  const [lastKnownVoiceEngine, setLastKnownVoiceEngine] = useState<
    "browser" | "local" | "system" | null
  >(null)
  /** Post-CTA residual note after「改用浏览器听写」(Task 7). */
  const [engineSwitchNote, setEngineSwitchNote] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  const textRef = useRef(text)
  textRef.current = text
  const selectedFilesRef = useRef(selectedFiles)
  selectedFilesRef.current = selectedFiles
  const dragDepthRef = useRef(0)
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
        if (
          result.lastKnownVoiceEngine === "local" ||
          result.lastKnownVoiceEngine === "browser" ||
          result.lastKnownVoiceEngine === "system"
        ) {
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
    if (eng === "local" || eng === "browser" || eng === "system") {
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

  // Path B mic matrix (plan Task 6): engine from live state or lastKnown.
  // #259: "system" passes through; useVoiceInput fail-closes it to browser
  // off-win32 / when the helper probe is not green.
  const sttEngine: "browser" | "local" | "system" =
    state.voiceModel?.sttEngine === "local" ||
    (state.voiceModel == null && lastKnownVoiceEngine === "local")
      ? "local"
      : state.voiceModel?.sttEngine === "system" ||
          (state.voiceModel == null && lastKnownVoiceEngine === "system")
        ? "system"
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

  // #259: probe the Windows system recognizer once per companion connection —
  // needed both for the configured-system chain and the browser→system escalation.
  useEffect(() => {
    if (!companionConnected) return
    try {
      chrome.runtime.sendMessage({ type: "voice.system.state" })
    } catch {
      /* */
    }
  }, [companionConnected])

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
    onLevel: (level) => setVoiceLevel(level),
    onDraft: (merged, meta) => {
      setPostprocessedBadge(meta?.postprocessed === true)
      if (insertTargetRef.current === "page") {
        pendingPageTextRef.current = merged
        return
      }
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
    systemState: state.voiceSystemState,
    localStateHydrated: state.voiceModel != null,
    autoFallbackToBrowser: state.voiceModel?.autoFallbackToBrowser !== false,
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
  const holdAbortRef = useRef(voice.abortForChatStop)
  holdStartRef.current = voice.holdStart
  holdStopRef.current = voice.holdStop
  holdAbortRef.current = voice.abortForChatStop
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

  // #258 PTT dual-mode on the existing hold chord (default still off).
  useEffect(() => {
    try {
      chrome.storage.local.get(VOICE_SOUND_EFFECTS_KEY, (res) => {
        setVoiceSoundEffects(parseVoiceSoundEffectsPref(res[VOICE_SOUND_EFFECTS_KEY]))
      })
    } catch {
      /* */
    }
  }, [])

  useEffect(() => {
    if (voice.phase !== "idle") return
    const pending = pendingPageTextRef.current
    if (!pending || insertTargetRef.current !== "page") return
    pendingPageTextRef.current = null
    chrome.runtime.sendMessage({ type: "voice.ptt.insert_text", text: pending }, (res) => {
      if (chrome.runtime.lastError || res?.ok === false) {
        insertTargetRef.current = "composer"
        setText(pending)
        setVoiceCapsuleHint(PAGE_INSERT_FALLBACK_HINT)
        return
      }
      insertTargetRef.current = "composer"
    })
  }, [voice.phase])

  useEffect(() => {
    if (!state.dictationHotkeyEnabled) return
    const chord = parseHotkeyChord(state.dictationHotkeyChord)
    if (!chord) return

    const play = (kind: "start" | "stop" | "cancel" | "done", accidental = false) => {
      if (
        !shouldPlayVoiceSfx({
          enabled: state.voiceSoundEffects !== false,
          privacySheetOpen: voicePrivacyOpen,
          accidental,
        })
      ) {
        return
      }
      playVoiceSfx(kind)
    }

    let holdNotified = false
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

    const applyEffect = (effect: PttEffect, source: "sidepanel" | "page") => {
      if (effect === "start" || effect === "lock") {
        insertTargetRef.current = source === "page" ? "page" : "composer"
        setPttLocked(effect === "lock")
        const ok = holdStartRef.current({
          privacyAck: privacyRef.current.v1,
          privacyAckV2: privacyRef.current.v2,
          privacyAckV3: privacyRef.current.v3,
        })
        if (ok) {
          play("start")
          holdNotified = true
          notifyHold(true)
        }
        return
      }
      if (effect === "commit") {
        setPttLocked(false)
        holdStopRef.current()
        play("stop")
        play("done")
        if (holdNotified) notifyHold(false)
        holdNotified = false
        return
      }
      if (effect === "discard") {
        setPttLocked(false)
        holdAbortRef.current()
        if (holdNotified) notifyHold(false)
        holdNotified = false
      }
    }

    const armTick = (until: number | null, source: "sidepanel" | "page") => {
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current)
      pttTimerRef.current = null
      if (until == null) return
      const wait = Math.max(0, until - Date.now())
      pttTimerRef.current = setTimeout(() => {
        const next = reducePtt(pttRef.current, { type: "tick", now: Date.now() })
        pttRef.current = next.state
        applyEffect(next.effect, source)
      }, wait)
    }

    const feed = (type: "down" | "up" | "esc" | "blur", source: "sidepanel" | "page") => {
      if (meetingCaptureRef.current) return
      if (type === "down" && !voiceAllowStartRef.current && pttRef.current.phase === "idle") return
      const next = reducePtt(pttRef.current, { type, now: Date.now() })
      pttRef.current = next.state
      setPttLocked(next.state.phase === "locked")
      applyEffect(next.effect, source)
      armTick(next.state.awaitUntil, source)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pttRef.current.phase === "locked") {
        e.preventDefault()
        feed("esc", "sidepanel")
        return
      }
      if (!eventMatchesChord(e, chord)) return
      if (e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      feed("down", "sidepanel")
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (pttRef.current.phase === "idle") return
      if (!isPttReleaseEvent(e, chord)) return
      e.preventDefault()
      feed("up", "sidepanel")
    }

    const onBlur = () => {
      if (pttRef.current.phase === "idle") return
      feed("blur", "sidepanel")
    }

    const onMsg = (msg: { type?: string; kind?: string }) => {
      if (msg?.type !== "voice.ptt.from_page") return
      if (msg.kind === "down") feed("down", "page")
      if (msg.kind === "up") feed("up", "page")
    }
    chrome.runtime.onMessage.addListener(onMsg)

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", onBlur)
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current)
      if (holdNotified) notifyHold(false)
    }
  }, [state.dictationHotkeyEnabled, state.dictationHotkeyChord, state.voiceSoundEffects, voicePrivacyOpen])

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
  const localCapturing = (sttEngine === "local" || sttEngine === "system") && capturing
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
            ? sttEngine === "system"
              ? `系统识别 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · ${SYSTEM_LISTEN_HINT}`
              : localListeningStatusLabel(voice.listenRemainingMs!)
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
      return sttEngine === "system"
        ? `系统识别 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · ${SYSTEM_LISTEN_HINT}`
        : localListeningStatusLabel(voice.listenRemainingMs!)
    }
    if (voice.listening) return "结束语音输入"
    if (sttEngine === "system" && !companionConnected) {
      return mapLocalSttError("companion_disconnected").message
    }
    if (sttEngine === "local") {
      if (!companionConnected) return mapLocalSttError("companion_disconnected").message
      if (!localModelReady) return mapLocalSttError("model_missing").message
      if (!localBinaryReady) return mapLocalSttError("binary_missing").message
    }
    return "语音输入（听写进草稿）"
  })()

  /** Banner recovery CTA (Task 7): switch browser or open settings. */
  const voiceBannerCta =
    (sttEngine === "local" || sttEngine === "system") && voice.banner
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

  const overlayStandby = state.overlayStandby

  // Disable send while dictating — mid-listen send would ship base snapshot only
  const canSend =
    composerMode !== "l2_task" &&
    hasContent &&
    !!state.activeThreadId &&
    state.connectionState === "connected" &&
    !voice.listening &&
    !overlayStandby

  const ingestBlocked =
    needsThread ||
    needsConnection ||
    threadBusy ||
    composerMode === "l2_task" ||
    voice.liveOverlay !== null ||
    voice.listening ||
    !!overlayStandby
  const ingestBlockedRef = useRef(ingestBlocked)
  ingestBlockedRef.current = ingestBlocked

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
  const destAckRef = useRef<Record<string, string>>({})
  useEffect(() => {
    try {
      chrome.storage.local.get(null, (all) => {
        if (chrome.runtime.lastError) return
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(all || {})) {
          if (k.startsWith("cmspark.imageDestAck.")) next[k] = String(v ?? "")
        }
        destAckRef.current = { ...next, ...destAckRef.current }
      })
    } catch {
      /* ignore */
    }
  }, [])
  const uploadClearSeq = state.composerUploadClearSeq
  const uploadClearSeen = useRef(uploadClearSeq)
  useEffect(() => {
    if (uploadClearSeq !== uploadClearSeen.current) {
      uploadClearSeen.current = uploadClearSeq
      setSelectedFiles([])
    }
  }, [uploadClearSeq])

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
        window.dispatchEvent(new CustomEvent("cmspark:open-coding-handoff", { detail: {} }))
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

  const readFileAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(",")[1] || "")
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })

  const addIncomingFiles = async (
    list: File[],
    opts: { fromGesture?: boolean; fromPaste?: boolean },
  ) => {
    if (ingestBlockedRef.current) return
    const maxDocSize = 10 * 1024 * 1024
    const incoming: FileAttachment[] = []
    let addedImages = 0
    let refuse: string | undefined
    // F5: first per-file rejection survives the post-loop banner merge —
    // otherwise a mixed batch (some accepted, some refused) erases the error
    // and the refused files vanish silently.
    let firstErr: string | undefined
    for (const file of list) {
      const type = file.type || mimeFromName(file.name)
      const refuseReason = imageTypeRefuseReason(type)
      if (refuseReason) {
        refuse = refuseReason
        continue
      }
      const isImage = isAllowlistedImageMime(type)
      if (!isImage && file.size > maxDocSize) {
        if (!firstErr) firstErr = `文件 "${file.name}" 超过 10MB 限制`
        continue
      }
      if (isImage && file.size > IMAGE_MAX_DECODED && /^image\/gif$/i.test(type.split(";")[0].trim())) {
        if (!firstErr) firstErr = IMAGE_GIF_SHRINK_FIRST
        continue
      }
      try {
        let working: Blob = file
        let workingType = type
        let compressed = false
        if (isImage && needsCompress(file.size)) {
          const result = await compressImageBlob(file)
          working = result.blob
          workingType = result.blob.type || type
          compressed = result.compressed
        } else if (isImage) {
          // Dimension-only compress when canvas can decode (no-op in node).
          try {
            const result = await compressImageBlob(file)
            working = result.blob
            workingType = result.blob.type || type
            compressed = result.compressed
          } catch {
            working = file
          }
        }
        const base64 = await readFileAsBase64(working)
        const name = opts.fromPaste
          ? pasteImageDisplayName(file.name)
          : file.name || pasteImageDisplayName("")
        incoming.push({
          name,
          type: workingType,
          size: working.size,
          content: base64,
          ...(compressed ? { compressed: true } : {}),
        })
        if (isImage) addedImages += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : "添加文件失败"
        if (!firstErr) firstErr = msg
      }
    }
    if (incoming.length === 0) {
      const err = nextFileErrorAfterIngest({ refuse, loopErr: firstErr })
      if (err) setFileError(err)
      return
    }

    const nextFiles = [...selectedFilesRef.current, ...incoming]
    const capErr = checkComposerImageCaps(nextFiles.filter((f) => isAllowlistedImageMime(f.type)))
    setFileError(nextFileErrorAfterIngest({ refuse, capErr, loopErr: firstErr }))
    if (capErr) return
    setSelectedFiles(nextFiles)
    selectedFilesRef.current = nextFiles

    // Mixed send: typed text + gesture-added images → send with explicit array.
    if (opts.fromGesture && addedImages > 0 && textRef.current.trim()) {
      handleSend(nextFiles)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    await addIncomingFiles(Array.from(files), { fromGesture: false })
    e.target.value = ""
  }

  const handleComposerPaste = (e: React.ClipboardEvent) => {
    if (e.defaultPrevented) return
    if (ingestBlockedRef.current) return
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== "file") continue
      const f = item.getAsFile()
      if (!f) continue
      const type = item.type || mimeFromName(f.name)
      if (isAllowlistedImageMime(type) || type.startsWith("image/")) {
        imageFiles.push(f)
      }
    }
    if (imageFiles.length === 0) return
    // Keep typed text. Do not let the browser insert an HTML <img>.
    e.preventDefault()
    void addIncomingFiles(imageFiles, { fromGesture: true, fromPaste: true })
  }

  const handleComposerDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (ingestBlockedRef.current) {
      e.dataTransfer.dropEffect = "none"
      return
    }
    e.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  }

  const handleComposerDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (ingestBlockedRef.current) return
    dragDepthRef.current += 1
    setDragOver(true)
  }

  const handleComposerDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }

  const handleComposerDrop = (e: React.DragEvent) => {
    dragDepthRef.current = 0
    setDragOver(false)
    if (ingestBlockedRef.current) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    const types = Array.from(e.dataTransfer?.types || [])
    const rawFiles = Array.from(e.dataTransfer?.files || [])
    const verdict = classifyDrop(
      types,
      rawFiles.map((f) => ({ type: f.type, size: f.size, name: f.name })),
    )
    if (verdict.ok === false) {
      setFileError(verdict.error)
      return
    }
    // NEVER fetch — only local File objects from the drop.
    void addIncomingFiles(rawFiles, { fromGesture: true })
  }

  const removeFile = useCallback((idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

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
      {fileError && (
        <div style={{
          padding: "4px 12px", background: tokens.warningSoft, color: tokens.warning,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{fileError}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setFileError("")}>×</span>
        </div>
      )}
      {destAck && (
        <div style={{
          padding: "4px 12px", color: tokens.textSecondary,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{destAck}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setDestAck("")}>×</span>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "8px 12px 0",
        }}>
          {selectedFiles.map((file, idx) => (
            isAllowlistedImageMime(file.type) ? (
              <ComposerImageChip
                key={`${file.name}-${idx}`}
                file={file}
                destHost={destHost}
                onRemove={() => removeFile(idx)}
              />
            ) : (
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
            )
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
      <div style={styles.inputArea}>
        <ComposerChips capabilityLevel={capabilityLevel} onAction={handleChipAction} />
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
            rows={2}
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
        {state.messages.length === 0 && !isStreaming && (
          <div style={styles.legal}>本地 Companion · 确认后才会执行危险操作</div>
        )}
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
  inputArea: {
    display: "flex",
    flexDirection: "column",
    padding: "8px 14px 12px",
    background: tokens.bgElevated,
    flexShrink: 0,
    position: "relative" as const,
  },
  composerCapsule: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusComposer,
    padding: "10px 10px 10px 14px",
    background: tokens.bgElevated,
    minHeight: 72,
    transition: `border-color ${tokens.transitionFast} ease, box-shadow ${tokens.transitionFast} ease`,
  },
  textarea: {
    flex: 1,
    // Replaced element: without minWidth 0 the cols=20 min-content overflows
    // the 4-element capsule row (attach/textarea/mic/send) in narrow panels.
    minWidth: 0,
    border: "none",
    borderRadius: tokens.radiusMd,
    padding: "4px 0 8px",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: 44,
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
