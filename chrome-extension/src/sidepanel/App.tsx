// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { ChatView } from "./components/ChatView"
import { ThreadList } from "./components/ThreadList"
import { BottomBar } from "./components/BottomBar"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import type { ConnectionState, SkillMeta, PrivilegeMode, FileAttachment } from "./types"

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
          <h3 style={{ color: "#F44336", marginBottom: 12 }}>界面渲染错误</h3>
          <pre style={{
            background: "#f5f5f5",
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
              border: "1px solid #4A90D9",
              borderRadius: 6,
              background: "#fff",
              color: "#4A90D9",
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

  return (
    <div style={styles.container}>
      <style>{globalCSS}</style>
      {toast && <div style={toastStyles.toast}>{toast}</div>}
      <Header connectionState={connectionState} onCraft={() => setCraftOpen(true)} onToggleLogs={() => setShowLogs(!showLogs)} />
      <ChatView />
      <BottomBar />
      <InputArea />
      {showLogs && <LogBar onClose={() => setShowLogs(false)} />}
      <SettingsSlideout />
      <SecurityConfirmationDialog />
      <McpServerForm />
      {craftOpen && <SkillCraftPanel onClose={() => setCraftOpen(false)} />}
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

function SecurityConfirmationDialog() {
  const { state, dispatch } = useAgentStore()
  const request = state.pendingSecurityConfirmations[0]

  const relevantDomain = request?.relevant_domains?.[0]
  const [whitelistMode, setWhitelistMode] = useState<"none" | "exact" | "wildcard">("none")

  // Reset selection whenever the active confirmation changes — otherwise the
  // radio from a previous prompt would bleed into the next one.
  useEffect(() => {
    setWhitelistMode("none")
  }, [request?.confirmation_id])

  if (!request) return null

  const riskLevel = request.risk_level || "high"
  const riskColor = riskLevel === "low" ? "#FFC107" : riskLevel === "medium" ? "#FF9800" : "#F44336"
  const riskLabel = riskLevel === "low" ? "低风险" : riskLevel === "medium" ? "中风险" : "高风险"

  const decide = (approved: boolean, stopThread = false) => {
    const addToWhitelist: string[] = []
    if (approved && relevantDomain && whitelistMode !== "none") {
      addToWhitelist.push(whitelistMode === "wildcard" ? `*.${relevantDomain}` : relevantDomain)
    }
    chrome.runtime.sendMessage({
      type: "security.confirmation.response",
      confirmation_id: request.confirmation_id,
      approved,
      stop_thread: stopThread,
      add_to_whitelist: addToWhitelist,
    })
    dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: request.confirmation_id })
    if (stopThread) {
      chrome.runtime.sendMessage({ type: "chat.abort", threadId: state.activeThreadId })
      dispatch({ type: "SET_STREAMING", content: "" })
    }
    dispatch({
      type: "ADD_SECURITY_AUDIT",
      entry: {
        id: request.confirmation_id,
        ts: new Date().toISOString(),
        level: approved ? "warn" : "block",
        tool_name: request.tool_name,
        action: approved ? "allowed" : "denied",
        risk_level: riskLevel,
        risk_score: request.risk_score || 0,
        defense_layer: request.defense_layer,
        message: `${approved ? "允许" : "拒绝"}执行 ${request.tool_name}${addToWhitelist.length ? `（加入白名单：${addToWhitelist.join(", ")}）` : ""}`,
      },
    })
  }

  return (
    <div style={styles.securityOverlay}>
      <div style={styles.securityCard}>
        <div style={{ ...styles.securityBadge, background: riskColor + "22", color: riskColor }}>
          {riskLabel}操作确认
        </div>
        <h3 style={styles.securityTitle}>允许执行 `{request.tool_name}` 吗？</h3>
        <p style={styles.securityText}>
          检测到高风险 API：{" "}
          <span style={{ color: "#F44336", fontWeight: 700 }}>
            {request.dangerous_apis.join(", ") || "未知"}
          </span>
          。请确认这段代码符合你的意图后再允许执行。
        </p>
        {request.defense_layer !== undefined && (
          <div style={styles.defenseLayerHint}>
            防御层：Layer {request.defense_layer}
          </div>
        )}
        <div style={styles.securityCode}>
          <HighlightedCode code={request.code_preview || "(无代码预览)"} />
        </div>
        {relevantDomain && (
          <div style={styles.whitelistSection}>
            <div style={styles.whitelistLabel}>添加到自动批准白名单（避免下次再问）：</div>
            <label style={styles.whitelistOption}>
              <input
                type="radio"
                name={`wl-${request.confirmation_id}`}
                checked={whitelistMode === "none"}
                onChange={() => setWhitelistMode("none")}
              />
              <span>不添加</span>
            </label>
            <label style={styles.whitelistOption}>
              <input
                type="radio"
                name={`wl-${request.confirmation_id}`}
                checked={whitelistMode === "exact"}
                onChange={() => setWhitelistMode("exact")}
              />
              <span>添加 <code style={styles.whitelistCode}>{relevantDomain}</code>（仅此主机名）</span>
            </label>
            <label style={styles.whitelistOption}>
              <input
                type="radio"
                name={`wl-${request.confirmation_id}`}
                checked={whitelistMode === "wildcard"}
                onChange={() => setWhitelistMode("wildcard")}
              />
              <span>添加 <code style={styles.whitelistCode}>*.{relevantDomain}</code>（含所有子域名）</span>
            </label>
          </div>
        )}
        {state.pendingSecurityConfirmations.length > 1 && (
          <div style={styles.securityQueueHint}>
            还有 {state.pendingSecurityConfirmations.length - 1} 个确认请求在等待。
          </div>
        )}
        <div style={styles.securityActions}>
          <button style={styles.denyStopBtn} onClick={() => decide(false, true)} title="拒绝本次操作并停止对话">
            拒绝并停止对话
          </button>
          <button style={styles.denyBtn} onClick={() => decide(false)} title="拒绝本次操作">拒绝</button>
          <button style={{ ...styles.allowBtn, background: riskColor }} onClick={() => decide(true)} title="允许执行本次操作">
            允许执行
          </button>
        </div>
      </div>
    </div>
  )
}

function HighlightedCode({ code }: { code: string }) {
  const keywords = ["function", "const", "let", "var", "return", "if", "else", "for", "while", "async", "await", "import", "export", "from", "class", "new", "try", "catch", "throw"]
  const tokens = code.split(/(\b)/)
  return (
    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}>
      {tokens.map((token, i) => {
        if (keywords.includes(token)) {
          return <span key={i} style={{ color: "#4A90D9", fontWeight: 600 }}>{token}</span>
        }
        if (/^["'`].*["'`]$/.test(token)) {
          return <span key={i} style={{ color: "#2E7D32" }}>{token}</span>
        }
        if (/^\d+$/.test(token)) {
          return <span key={i} style={{ color: "#E65100" }}>{token}</span>
        }
        if (/^[{}()\[\];,.]$/.test(token)) {
          return <span key={i} style={{ color: "#999" }}>{token}</span>
        }
        return <span key={i}>{token}</span>
      })}
    </pre>
  )
}

function PrivilegeModeIndicator({ mode }: { mode: PrivilegeMode }) {
  const color = mode === "readonly" ? "#4CAF50" : mode === "standard" ? "#FFC107" : "#F44336"
  const label = mode === "readonly" ? "只读" : mode === "standard" ? "标准" : "高级"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#666", cursor: "pointer" }} title={`特权模式: ${label}`}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  )
}

function Header({ connectionState, onCraft, onToggleLogs }: { connectionState: ConnectionState; onCraft: () => void; onToggleLogs: () => void }) {
  const { state } = useAgentStore()
  const hasMessages = state.messages.length > 0 && !!state.activeThreadId

  return (
    <div style={styles.header}>
      <ThreadList />
      <div style={styles.headerTitle}>CMspark Agent</div>
      <PrivilegeModeIndicator mode={state.privilegeMode} />
      <button
        style={{
          ...styles.craftBtn,
          opacity: hasMessages ? 1 : 0.4,
          cursor: hasMessages ? "pointer" : "not-allowed",
        }}
        disabled={!hasMessages}
        onClick={onCraft}
        title={hasMessages ? "提取技能" : "当前线程没有消息"}
      >
        🔧
      </button>
      <button
        style={{
          ...styles.craftBtn,
          opacity: hasMessages ? 1 : 0.4,
          cursor: hasMessages ? "pointer" : "not-allowed",
        }}
        disabled={!hasMessages}
        onClick={() => {
          if (state.activeThreadId) {
            chrome.runtime.sendMessage({
              type: "thread.export_obsidian",
              thread_id: state.activeThreadId,
              scope: "thread",
            })
          }
        }}
        title={hasMessages ? "导出整个线程到 Obsidian" : "当前线程没有消息"}
      >
        📥
      </button>
      <button onClick={onToggleLogs} style={styles.craftBtn} title="日志">📋</button>
      <div
        style={{
          ...styles.statusDot,
          background:
            connectionState === "connected" ? "#4CAF50"
            : connectionState === "connecting" ? "#FFC107"
            : "#F44336",
        }}
      />
    </div>
  )
}

function InputArea() {
  const { state, dispatch } = useAgentStore()
  const [text, setText] = useState("")
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isStreaming = !!state.streamingContent
  const hasContent = text.trim().length > 0 || selectedFiles.length > 0
  const canSend = !isStreaming && hasContent && !!state.activeThreadId && state.connectionState === "connected"
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"

  const getPlaceholder = () => {
    if (needsThread) return "请先创建或选择一个线程"
    if (needsConnection) return "等待 companion 连接..."
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
      shouldSend = e.key === "Enter" && !e.shiftKey
    } else if (shortcut === "Cmd+Enter") {
      shouldSend = e.key === "Enter" && (e.metaKey || e.ctrlKey)
    } else if (shortcut === "Ctrl+Enter") {
      shouldSend = e.key === "Enter" && e.ctrlKey && !e.metaKey
    }

    if (shouldSend && canSend) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!canSend) return
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
    <div style={{ borderTop: "1px solid #eee", flexShrink: 0, position: "relative" as const }}>
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
          padding: "4px 12px", background: "#FFF3E0", color: "#E65100",
          fontSize: 11, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{fileError}</span>
          <span role="button" style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setFileError("")}>×</span>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "6px 12px 0",
        }}>
          {selectedFiles.map((file, idx) => (
            <span key={idx} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", background: "#f0f4ff", borderRadius: 12,
              fontSize: 11, color: "#4A90D9", maxWidth: 200,
            }}>
              {/* Text truncates; × is always visible with flexShrink:0 */}
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
      <div style={styles.inputArea}>
        <textarea
          ref={textareaRef}
          style={{
            ...styles.textarea,
            background: needsThread || needsConnection ? "#f9f9f9" : "#fff",
          }}
          placeholder={getPlaceholder()}
          rows={2}
          value={text}
          disabled={needsThread || needsConnection}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <SlashCommandPopover
          skills={state.skills}
          searchText={slashQuery}
          visible={slashVisible}
          anchorEl={textareaRef.current}
          onSelect={handleSlashSelect}
          onDismiss={() => setSlashVisible(false)}
        />
        {!isStreaming && (
          <button
            style={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={needsThread || needsConnection}
            title="上传文件"
          >
            {"📎"}
          </button>
        )}
        {isStreaming ? (
          <button
            style={styles.stopBtn}
            onClick={handleStop}
            title="停止生成"
          >
            ■
          </button>
        ) : (
          <button
            style={{
              ...styles.sendBtn,
              opacity: canSend ? 1 : 0.4,
              cursor: canSend ? "pointer" : "not-allowed",
            }}
            onClick={handleSend}
            disabled={!canSend}
            title={needsThread ? "请先创建线程" : needsConnection ? "Companion 未连接" : "发送"}
          >
            ▶
          </button>
        )}
        <button style={styles.settingsBtn} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })} title="设置">⚙</button>
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
      <div style={bannerStyles.icon}>⚠️</div>
      <div style={bannerStyles.content}>
        <h3 style={bannerStyles.title}>Companion 未连接</h3>
        <p style={bannerStyles.text}>
          请通过菜单栏启动 Companion，或检查守护进程状态。
        </p>
        <div style={bannerStyles.actions}>
          <button style={bannerStyles.primaryBtn} onClick={onRetry}>
            重新连接
          </button>
          <button style={bannerStyles.secondaryBtn} onClick={handleOpenLogs}>
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
`

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    color: "#1a1a1a",
    background: "#ffffff",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid #e5e5e5",
    background: "#fafafa",
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  craftBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
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
    alignItems: "flex-end",
    gap: 6,
    padding: "8px 12px",
    borderTop: "1px solid #eee",
    flexShrink: 0,
    position: "relative" as const,
  },
  textarea: {
    flex: 1,
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: 36,
    maxHeight: 100,
  },
  attachBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "none",
    background: "#4A90D9",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    flexShrink: 0,
  },
  stopBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "none",
    background: "#F44336",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    flexShrink: 0,
  },
  securityOverlay: {
    position: "absolute" as const,
    inset: 0,
    background: "rgba(0,0,0,0.32)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 120,
  },
  securityCard: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 10px 36px rgba(0,0,0,0.22)",
    padding: 16,
  },
  securityBadge: {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    background: "#FFF4E5",
    color: "#B26B00",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 10,
  },
  securityTitle: {
    margin: "0 0 8px",
    fontSize: 16,
    lineHeight: 1.35,
  },
  securityText: {
    margin: "0 0 10px",
    color: "#444",
    lineHeight: 1.5,
  },
  securityCode: {
    maxHeight: 180,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: "#f6f8fa",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 10,
    fontSize: 11,
    lineHeight: 1.45,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  securityQueueHint: {
    marginTop: 8,
    color: "#666",
    fontSize: 12,
  },
  defenseLayerHint: {
    marginTop: 6,
    color: "#888",
    fontSize: 11,
    fontStyle: "italic",
  },
  whitelistSection: {
    marginTop: 10,
    padding: 10,
    background: "#F5FBFF",
    border: "1px solid #CFE6F7",
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  whitelistLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#2C5D8F",
    marginBottom: 2,
  },
  whitelistOption: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 12,
    color: "#333",
    cursor: "pointer",
    lineHeight: 1.4,
  },
  whitelistCode: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    background: "#EAF4FB",
    padding: "1px 4px",
    borderRadius: 3,
    fontSize: 11,
    color: "#1976D2",
  },
  securityActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 14,
  },
  denyBtn: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    color: "#333",
    cursor: "pointer",
    fontSize: 13,
  },
  denyStopBtn: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #F44336",
    background: "#fff",
    color: "#F44336",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  allowBtn: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "none",
    background: "#D97706",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
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
          <span style={{...logStyles.level, color: l.level === "error" ? "#F44336" : l.level === "warn" ? "#FF9800" : "#999"}}>{l.level.toUpperCase().padEnd(5)}</span>
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
    position: "fixed" as const, top: 48, left: 8, right: 8,
    background: "#4A90D9", color: "#fff", padding: "6px 12px",
    borderRadius: 6, fontSize: 12, zIndex: 300,
  },
}

const bannerStyles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    background: "#FFF8E1",
    borderBottom: "1px solid #FFE082",
    flexShrink: 0,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  icon: {
    fontSize: 20,
    lineHeight: 1,
    flexShrink: 0,
    marginTop: 2,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    margin: "0 0 4px",
    fontSize: 13,
    fontWeight: 600,
    color: "#5D4037",
  },
  text: {
    margin: "0 0 10px",
    fontSize: 12,
    color: "#795548",
    lineHeight: 1.45,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  primaryBtn: {
    padding: "5px 12px",
    borderRadius: 5,
    border: "none",
    background: "#4A90D9",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  secondaryBtn: {
    padding: "5px 12px",
    borderRadius: 5,
    border: "1px solid #ccc",
    background: "#fff",
    color: "#555",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
}

export default App
