// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { useCapabilityMode } from "./hooks/useCapabilityMode"
import { ChatView } from "./components/ChatView"
import { SafetyStrip } from "./components/SafetyStrip"
import { ContextStrip } from "./components/ContextStrip"
import { ThreadList } from "./components/ThreadList"
import { BottomBar } from "./components/BottomBar"
import { FleetStrip } from "./components/FleetStrip"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { NotebooklmImporterPanel } from "./components/NotebooklmImporterPanel"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import type { ConnectionState, CapabilityLevel, SkillMeta, FileAttachment } from "./types"
import { tokens } from "./ui/tokens"
import { ModeBadge } from "./ui/ModeBadge"
import {
  IconCraft,
  IconDownload,
  IconNotebook,
  IconSave,
  IconBrain,
  IconLogs,
  IconSettings,
  IconSend,
  IconStop,
  IconAttach,
  IconAlert,
  IconSpinner,
  IconMore,
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

  // Capability level (chat / browser / computer) — badge in Header, tabs in BottomBar
  const onEscalate = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 4000)
  }, [])
  const { level, badgeLabel } = useCapabilityMode(onEscalate)
  const isComputer = level === "computer"
  const isBrowser = level === "browser"
  const hasPendingConfirm = appState.pendingSecurityConfirmations.length > 0

  // P1: auto-open Cockpit when entering L2 (openOrFocus is idempotent)
  useEffect(() => {
    if (!isComputer) return
    chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
      void chrome.runtime.lastError
    })
  }, [isComputer])

  return (
    <div style={styles.container}>
      <style>{globalCSS}</style>
      {toast && <div style={toastStyles.toast}>{toast}</div>}
      <Header
        connectionState={connectionState}
        capabilityLevel={level}
        badgeLabel={badgeLabel}
        onCraft={() => setCraftOpen(true)}
        onToggleLogs={() => setShowLogs(!showLogs)}
        onOpenNotebooklmImporter={() => setNbImporterOpen(true)}
        onToast={(msg) => {
          setToast(msg)
          setTimeout(() => setToast(""), 4000)
        }}
      />
      {/* §4: L1 ContextStrip — current tab + user-only「展开工作区」 */}
      {isBrowser && <ContextStrip />}
      {/* P1 content-split: SafetyStrip for L2 task AND any pending confirm (L0/L1 MinimalConfirm) */}
      {(isComputer || hasPendingConfirm) && <SafetyStrip />}
      <ChatView />
      {/* P1: ComputerTaskBar relocated — step timeline only in Cockpit */}
      <FleetStrip />
      <BottomBar capabilityLevel={level} />
      <InputArea capabilityLevel={level} />
      {showLogs && <LogBar onClose={() => setShowLogs(false)} />}
      <SettingsSlideout />
      {/* P1 D10′: full confirm dialog removed from Panel — Cockpit ConfirmElevated + MinimalConfirm */}
      <McpServerForm />
      {craftOpen && <SkillCraftPanel onClose={() => setCraftOpen(false)} />}
      {nbImporterOpen && <NotebooklmImporterPanel onClose={() => setNbImporterOpen(false)} />}
      <DisconnectedBanner visible={connectionState === "disconnected"} onRetry={() => {
        chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
          if (chrome.runtime.lastError) return
          if (response?.connectionState === "disconnected") {
            // Trigger a manual reconnect attempt by reloading the extension context
            // or prompting the user to wait for auto-reconnect
            alert("正在尝试重新连接...\n如果 Companion 已启动，连接将自动恢复。")
          }
        })
      }} />
    </div>
  )
}

function Header({
  connectionState,
  capabilityLevel,
  badgeLabel,
  onCraft,
  onToggleLogs,
  onOpenNotebooklmImporter,
  onToast,
}: {
  connectionState: ConnectionState
  capabilityLevel: CapabilityLevel
  badgeLabel: string
  onCraft: () => void
  onToggleLogs: () => void
  onOpenNotebooklmImporter: () => void
  onToast?: (msg: string) => void
}) {
  const { state, dispatch } = useAgentStore()
  const hasMessages = state.messages.length > 0 && !!state.activeThreadId
  const [nbState, setNbState] = useState<"idle" | "working" | "warning">("idle")
  const [nbTooltip, setNbTooltip] = useState<string>("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // useRef lock is mandatory: React state updates are async, so a rapid second click
  // within the same tick can pass the `nbState === "working"` guard before the first
  // setNbState commits — both fire sendMessage → double download. The ref is synchronous.
  const nbInflightRef = useRef(false)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  const resetNbIdle = (delay: number, immediate?: boolean) => {
    if (immediate) {
      setNbState("idle")
      setNbTooltip("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
      nbInflightRef.current = false
      return
    }
    setTimeout(() => {
      setNbState("idle")
      setNbTooltip("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
      nbInflightRef.current = false
    }, delay)
  }

  const runNotebooklmExport = async () => {
    if (nbInflightRef.current) return
    nbInflightRef.current = true
    setNbState("working")
    setNbTooltip("正在抽取页面内容…")

    // Race against a 30s timeout: if the service worker is killed mid-extraction
    // (MV3 lifecycle), the sendMessage promise may never resolve. Without this,
    // the button stays disabled forever. (Phase 4 review catch.)
    const timeout = new Promise<{ _timeout: true }>(resolve => setTimeout(() => resolve({ _timeout: true }), 30_000))

    type ExportResponse = { ok?: boolean; content?: string; filename?: string; truncated?: boolean; error?: string }
    type RaceResult = ExportResponse | { _timeout: true } | undefined

    try {
      const res = (await Promise.race<RaceResult>([
        chrome.runtime.sendMessage({ type: "page.import_notebooklm" }) as Promise<ExportResponse>,
        timeout,
      ])) as RaceResult

      if (res && typeof res === "object" && "_timeout" in res) {
        setNbState("warning")
        setNbTooltip("导出超时（30s）— service worker 可能被挂起，请重试")
        resetNbIdle(6000)
        return
      }

      // After the timeout early-return, res is narrowed to ExportResponse | undefined.
      const r = res as ExportResponse | undefined
      if (r && r.ok && r.content) {
        const blob = new Blob([new TextEncoder().encode(r.content)], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = r.filename || "notebooklm-export.md"
        // Append-then-click-then-remove: some Chrome contexts silently ignore .click()
        // on a detached anchor. (Phase 4 review catch.)
        document.body.appendChild(a)
        a.click()
        a.remove()
        // Delay revoke — Chrome may not have started the download yet at click() return.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        if (r.truncated) {
          setNbState("warning")
          setNbTooltip("已导出（内容超过 200k 字符，已截断）")
          resetNbIdle(6000)
        } else {
          setNbTooltip("已导出 ✓")
          resetNbIdle(2500)
        }
      } else {
        const err = (r && r.error) || "导出失败"
        setNbState("warning")
        setNbTooltip(err)
        resetNbIdle(6000)
      }
    } catch (e: any) {
      setNbState("warning")
      setNbTooltip(`导出失败: ${e?.message || String(e)}`)
      resetNbIdle(6000)
    }
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <div
      style={{
        ...styles.header,
        // L1 tint: tokens.modeBrowserBg (was ad-hoc #f5f9ff; DESIGN #eef4ff)
        ...(capabilityLevel === "browser"
          ? { background: tokens.modeBrowserBg, borderBottomColor: "#bfdbfe" }
          : {}),
        ...(capabilityLevel === "computer"
          ? { background: tokens.bgMuted, borderBottomColor: tokens.border }
          : {}),
      }}
    >
      <ThreadList />
      <div style={styles.headerTitle}>CMspark</div>
      <ModeBadge level={capabilityLevel} label={badgeLabel} />
      <div
        title={
          connectionState === "connected"
            ? "已连接"
            : connectionState === "connecting"
              ? "连接中"
              : "未连接"
        }
        style={{
          ...styles.statusDot,
          background:
            connectionState === "connected"
              ? tokens.success
              : connectionState === "connecting"
                ? tokens.warning
                : tokens.danger,
          boxShadow:
            connectionState === "connected"
              ? "0 0 0 3px rgba(22, 163, 74, 0.15)"
              : "none",
        }}
      />
      {/* P0: power actions in ⋯ menu — not permanent icon strip */}
      <div ref={menuRef} style={{ position: "relative", flexShrink: 0, marginLeft: 2 }}>
        <button
          type="button"
          style={{
            ...styles.iconBtn,
            ...(menuOpen || nbState === "warning"
              ? {
                  background: nbState === "warning" ? tokens.warningSoft : tokens.bgActive,
                  borderColor: nbState === "warning" ? "#fcd34d" : "#bfdbfe",
                }
              : {}),
          }}
          onClick={() => setMenuOpen((v) => !v)}
          title="更多工具与设置"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          {nbState === "working" ? <IconSpinner size={15} /> : <IconMore size={15} />}
        </button>
        {menuOpen && (
          <div style={styles.headerMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              style={{
                ...styles.headerMenuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages}
              onClick={() => {
                if (!hasMessages) return
                closeMenu()
                onCraft()
              }}
            >
              <IconCraft size={14} />
              <span>提取技能</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{
                ...styles.headerMenuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages}
              onClick={() => {
                if (!hasMessages || !state.activeThreadId) return
                closeMenu()
                chrome.runtime.sendMessage({
                  type: "thread.export_obsidian",
                  thread_id: state.activeThreadId,
                  scope: "thread",
                })
              }}
            >
              <IconDownload size={14} />
              <span>导出线程 (Obsidian)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{
                ...styles.headerMenuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages || state.summarizingThreadId === state.activeThreadId}
              onClick={() => {
                if (!hasMessages || !state.activeThreadId) return
                closeMenu()
                dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: state.activeThreadId })
                chrome.runtime.sendMessage({
                  type: "thread.export_obsidian",
                  thread_id: state.activeThreadId,
                  scope: "summary",
                })
              }}
            >
              <IconBrain size={14} />
              <span>
                {state.summarizingThreadId === state.activeThreadId ? "摘要导出中…" : "导出摘要"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={styles.headerMenuItem}
              onClick={() => {
                closeMenu()
                onOpenNotebooklmImporter()
              }}
            >
              <IconNotebook size={14} />
              <span>NotebookLM 导入</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={styles.headerMenuItem}
              disabled={nbState === "working"}
              title={nbTooltip}
              onClick={() => {
                closeMenu()
                void runNotebooklmExport()
              }}
            >
              {nbState === "warning" ? <IconAlert size={14} /> : <IconSave size={14} />}
              <span>导出当前页 (NB)</span>
            </button>
            <div style={styles.headerMenuDivider} />
            <button
              type="button"
              role="menuitem"
              style={styles.headerMenuItem}
              onClick={() => {
                closeMenu()
                onToggleLogs()
              }}
            >
              <IconLogs size={14} />
              <span>日志</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={styles.headerMenuItem}
              onClick={() => {
                closeMenu()
                dispatch({ type: "TOGGLE_SETTINGS" })
              }}
            >
              <IconSettings size={14} />
              <span>设置</span>
            </button>
            <div style={styles.headerMenuDivider} />
            <button
              type="button"
              role="menuitem"
              style={{ ...styles.headerMenuItem, color: tokens.textMuted, fontSize: 11 }}
              onClick={() => {
                closeMenu()
                onToast?.(
                  "任务包 / 任务板已移至底栏「更多」— 主栏仅保留当前模式高频入口",
                )
              }}
            >
              <span>关于「更多」面板</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InputArea({ capabilityLevel = "chat" }: { capabilityLevel?: CapabilityLevel }) {
  const { state, dispatch } = useAgentStore()
  const [text, setText] = useState("")
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  const isComputer = capabilityLevel === "computer"

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
    if (taskActive) return "任务进行中 — 请在操控台发送指令或先急停"
    if (isComputer) return "排队跟进…（主指令请在操控台发送）"
    return "输入指令... (输入 / 调用技能)"
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

  const handleSlashSelect = (skill: SkillMeta) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart || 0
    const beforeCursor = text.substring(0, cursorPos)

    // Find the "/" that started this command
    const slashIdx = beforeCursor.lastIndexOf("/")
    if (slashIdx === -1) return

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
        chrome.runtime.sendMessage({
          type: "chat.send",
          threadId: state.activeThreadId,
          message: trimmed,
          skillIds,
        })
        dispatch({ type: "SET_PROCESSING", isProcessing: true })
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `${state.activeThreadId}_${Date.now()}`,
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
      {/* P2: unified composer capsule — attach + textarea + send inside one surface */}
      <div style={styles.inputArea}>
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
                      ? "任务进行中，请在操控台发送"
                      : "发送"
              }
            >
              <IconSend size={15} />
            </button>
          )}
        </div>
        <SlashCommandPopover
          skills={state.skills}
          searchText={slashQuery}
          visible={slashVisible}
          anchorEl={textareaRef.current}
          onSelect={handleSlashSelect}
          onDismiss={() => setSlashVisible(false)}
        />
      </div>
    </div>
  )
}

function DisconnectedBanner({ visible, onRetry }: { visible: boolean; onRetry: () => void }) {
  if (!visible) return null

  const handleOpenLogs = () => {
    // Try to open logs directory via native messaging or show instructions
    const logsPath = "~/.cmspark-agent/logs/"
    if (typeof chrome !== "undefined" && chrome.runtime?.sendNativeMessage) {
      // Attempt to open via a native host if available; otherwise fallback
      try {
        chrome.runtime.sendNativeMessage(
          "com.cmspark.agent",
          { action: "open_directory", path: logsPath },
          (response) => {
            if (chrome.runtime.lastError) {
              // Native host not available — show fallback
              alert(`请手动打开日志目录：\n${logsPath}`)
            }
          }
        )
      } catch {
        alert(`请手动打开日志目录：\n${logsPath}`)
      }
    } else {
      alert(`请手动打开日志目录：\n${logsPath}`)
    }
  }

  return (
    <div style={bannerStyles.container}>
      <div style={bannerStyles.iconWrap}>
        <IconAlert size={22} style={{ color: tokens.warning }} />
      </div>
      <div style={bannerStyles.content}>
        <h3 style={bannerStyles.title}>Companion 未连接</h3>
        <p style={bannerStyles.text}>
          请通过菜单栏启动 Companion，或检查守护进程状态。
        </p>
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
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bg,
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 650,
    letterSpacing: "-0.01em",
    color: tokens.text,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
  },
  headerMenu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 4px)",
    minWidth: 200,
    maxHeight: 360,
    overflowY: "auto",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    boxShadow: tokens.shadowMd,
    zIndex: 50,
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  headerMenuItem: {
    border: "none",
    background: "transparent",
    borderRadius: tokens.radiusSm,
    padding: "8px 10px",
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: tokens.text,
    textAlign: "left" as const,
    width: "100%",
    fontFamily: tokens.font,
  },
  headerMenuDivider: {
    height: 1,
    background: tokens.border,
    margin: "4px 6px",
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  craftBtn: {
    width: 28,
    height: 28,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    cursor: "pointer",
    fontSize: 13,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
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
