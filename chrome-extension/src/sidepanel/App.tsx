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
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
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
      <ChatView />
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
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const [composeOpen, setComposeOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
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
  const canSend =
    !isStreaming &&
    hasContent &&
    !!state.activeThreadId &&
    state.connectionState === "connected" &&
    !taskActive
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"

  const getPlaceholder = () => {
    if (needsThread) return "请先创建或选择一个线程"
    if (needsConnection) return "等待 companion 连接..."
    // P1 D12′: Cockpit is task conductor — Panel cannot interject mid-task
    if (taskActive) return "任务进行中 — 请在确认台发送指令或先急停"
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

    // Extract query: everything after "/" up to cursor position
    const query = beforeCursor.substring(slashIdx + 1)
    setSlashQuery(query)
    setSlashVisible(true)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setText(newValue)
    detectSlash(newValue, e.target.selectionStart || 0)
  }

  const clearSlashToken = (slashIdx: number, cursorPos: number) => {
    const afterCursor = text.substring(cursorPos)
    const newText = (text.substring(0, slashIdx) + afterCursor).replace(/\s+$/, " ").trimStart()
    setText(newText)
    setSlashVisible(false)
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
    if (slashVisible && ["ArrowDown", "ArrowUp", "Escape", "Enter"].includes(e.key)) {
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

        chrome.runtime.sendMessage({
          type: "file.upload",
          threadId: state.activeThreadId,
          message: userMessage,
          files: selectedFiles,
          skillIds,
        })
        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `${state.activeThreadId}_${Date.now()}`,
            thread_id: state.activeThreadId!,
            role: "user",
            content: `${userMessage}\n📎 ${fileSummary}`,
            created_at: new Date().toISOString(),
          },
        })
      } else {
        // Same clientMessageId as SW `chat.user` echo so ADD_MESSAGE dedupes
        // when both optimistic local append and multi-surface broadcast land.
        const clientMessageId = `${state.activeThreadId}_user_${Date.now()}`
        chrome.runtime.sendMessage({
          type: "chat.send",
          threadId: state.activeThreadId,
          message: trimmed,
          skillIds,
          clientMessageId,
        })
        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: clientMessageId,
            thread_id: state.activeThreadId!,
            role: "user",
            content: trimmed,
            created_at: new Date().toISOString(),
          },
        })
      }

      setText("")
      setSlashVisible(false)
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
    dispatch({ type: "SET_PROCESSING", isProcessing: false })
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
          {!isStreaming && (
            <button
              type="button"
              style={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={needsThread || needsConnection}
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
            disabled={needsThread || needsConnection}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          {isStreaming ? (
            <button type="button" style={styles.stopBtn} onClick={handleStop} title="停止生成">
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
  button, a, [role="button"] {
    transition: background ${tokens.transitionFast} ease, color ${tokens.transitionFast} ease,
      border-color ${tokens.transitionFast} ease, opacity ${tokens.transitionFast} ease;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
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
    background: tokens.bgElevated,
  },
  inputArea: {
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px 12px",
    background: tokens.bg,
    flexShrink: 0,
    position: "relative" as const,
  },
  composerCapsule: {
    display: "flex",
    alignItems: "flex-end",
    gap: 4,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusLg,
    padding: "6px 6px 6px 4px",
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
    minHeight: 36,
    maxHeight: 100,
    background: "transparent",
    color: tokens.text,
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
    color: "#fff",
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
    color: "#fff",
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
