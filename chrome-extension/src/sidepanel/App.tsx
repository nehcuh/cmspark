// CMspark Browser Agent — Root App Component

import { Component, useState, useRef, useCallback, useEffect } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { ChatView } from "./components/ChatView"
import { ComputerTaskBar } from "./components/ComputerTaskBar"
import { ThreadList } from "./components/ThreadList"
import { BottomBar } from "./components/BottomBar"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { McpServerForm } from "./components/McpServerForm"
import { SlashCommandPopover } from "./components/SlashCommandPopover"
import { SkillCraftPanel } from "./components/SkillCraftPanel"
import { NotebooklmImporterPanel } from "./components/NotebooklmImporterPanel"
import { Modal } from "./components/ui/Modal"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import { canOfferThreadTrust, threadTrustHint } from "./utils/apps-utils"
import { previewImageSafe } from "./utils/computer-utils"
import type { ConnectionState, SkillMeta, FileAttachment } from "./types"

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

  return (
    <div style={styles.container}>
      <style>{globalCSS}</style>
      {toast && <div style={toastStyles.toast}>{toast}</div>}
      <Header connectionState={connectionState} onCraft={() => setCraftOpen(true)} onToggleLogs={() => setShowLogs(!showLogs)} onOpenNotebooklmImporter={() => setNbImporterOpen(true)} />
      <ChatView />
      <ComputerTaskBar />
      <BottomBar />
      <InputArea />
      {showLogs && <LogBar onClose={() => setShowLogs(false)} />}
      <SettingsSlideout />
      <SecurityConfirmationDialog />
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

function SecurityConfirmationDialog() {
  const { state, dispatch } = useAgentStore()
  const request = state.pendingSecurityConfirmations[0]

  const relevantDomain = request?.relevant_domains?.[0]
  const relevantApp = request?.relevant_apps?.[0]
  const nonceChallenge = request?.nonce_challenge
  // Phase 1 W7 + App tab WP4 (W1 follow-up): thread-scoped trust applies to
  // host_read (read-only lock) AND host_app L0 no-arg launches (owner decision
  // 2, W7 Blocker-1 "app-launch" exception). Writes always require biometric
  // per call — Q1 ship blocker; the checkbox stays hidden for host_write even
  // when relevant_apps is set.
  const canThreadTrust = canOfferThreadTrust(request?.tool_name, relevantApp)
  const [whitelistMode, setWhitelistMode] = useState<"none" | "exact" | "wildcard">("none")
  const [threadTrust, setThreadTrust] = useState(false)
  // Phase 1 W9: Linux nonce input. User must TYPE the code (no paste).
  const [nonceInput, setNonceInput] = useState("")
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const nonceMatches = !!nonceChallenge && nonceInput.toUpperCase() === nonceChallenge.toUpperCase()
  // WP4 (WI-3): L2 标注截图渲染失败时静默回退纯文本——确认门永不被图片阻塞。
  const [previewImgFailed, setPreviewImgFailed] = useState(false)

  // Reset selection whenever the active confirmation changes — otherwise the
  // radio from a previous prompt would bleed into the next one.
  useEffect(() => {
    setWhitelistMode("none")
    setThreadTrust(false)
    setNonceInput("")
    setPasteBlocked(false)
    setPreviewImgFailed(false)
  }, [request?.confirmation_id])

  // H10/M18 (audit): keyboard a11y (focus trap + Escape→deny + aria-modal +
  // focus restore) now lives in the shared <Modal>/useModalDialog primitive.
  // denyRef stays a ref so Escape always calls the latest decide() (whitelist
  // radio may have changed since mount); denyBtnRef pins initial focus to
  // "拒绝" — the safe non-destructive default ([0]=拒绝并停止, [1]=拒绝).
  const denyRef = useRef<() => void>(() => {})
  const denyBtnRef = useRef<HTMLButtonElement>(null)

  if (!request) return null

  const riskLevel = request.risk_level || "high"
  const riskColor = riskLevel === "low" ? "#FFC107" : riskLevel === "medium" ? "#FF9800" : "#F44336"
  const riskLabel = riskLevel === "low" ? "低风险" : riskLevel === "medium" ? "中风险" : "高风险"
  // WP6a (Finding 3): a host_app launch is not a code execution — the dialog
  // gets launch-appropriate copy (no「高风险 API：未知」scare section when the
  // dangerous-API list is empty; the code_preview already reads
  // `Launch app "<display>" (<token>) — no arguments`). host_read/host_write/
  // evaluate rendering is unchanged.
  const isAppLaunch = request.tool_name === "host_app"
  // WP4 (WI-3): 坐标 computer-use 的 L2 对话框——徽标点名操作性质;
  // full_preview(P1 独立字段)存在时优先于 code_preview 渲染;标注截图过
  // previewImageSafe 守卫才渲染,渲染失败静默回退纯文本。
  const isComputerTask = request.tool_name === "host_computer"
  const dialogLabel = isAppLaunch ? "启动应用确认" : isComputerTask ? "坐标操作确认" : `${riskLabel}操作确认`
  const showPreviewImage = isComputerTask && !previewImgFailed && previewImageSafe(request.preview_image)

  const decide = (approved: boolean, stopThread = false) => {
    const addToWhitelist: string[] = []
    if (approved && relevantDomain && whitelistMode !== "none") {
      addToWhitelist.push(whitelistMode === "wildcard" ? `*.${relevantDomain}` : relevantDomain)
    }
    // Phase 1 W9: when nonceChallenge is set, approval is BLOCKED until user
    // types the code correctly. The Approve button is disabled; this is a
    // safety net in case decide() is invoked another way (keyboard shortcut).
    if (approved && nonceChallenge && !nonceMatches) {
      return  // silently no-op — button should be disabled anyway
    }
    chrome.runtime.sendMessage({
      type: "security.confirmation.response",
      confirmation_id: request.confirmation_id,
      approved,
      stop_thread: stopThread,
      add_to_whitelist: addToWhitelist,
      // Phase 1 W7 (extended by WP4 W1) — only send add_to_thread_whitelist
      // when allowed (host_read / host_app + user checked the box). Companion
      // validates against relevantApps[0].
      add_to_thread_whitelist: approved && canThreadTrust && threadTrust,
      // Phase 1 W9 — send typed nonce for Linux biometric tier validation.
      nonce_response: approved && nonceChallenge ? nonceInput.toUpperCase() : undefined,
    })
    dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: request.confirmation_id })
    if (stopThread) {
      chrome.runtime.sendMessage({ type: "chat.abort", threadId: state.activeThreadId })
      dispatch({ type: "SET_STREAMING", content: "" })
    }
    const trustMsg = approved && canThreadTrust && threadTrust ? `（本线程内信任 ${relevantApp}）` : ""
    const nonceMsg = approved && nonceChallenge ? `（输入确认码 ${nonceChallenge}）` : ""
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
        message: `${approved ? "允许" : "拒绝"}执行 ${request.tool_name}${addToWhitelist.length ? `（加入白名单：${addToWhitelist.join(", ")}）` : ""}${trustMsg}${nonceMsg}`,
      },
    })
  }

  denyRef.current = () => decide(false)

  return (
    <Modal
      open
      onClose={() => denyRef.current()}
      backdropDismiss={false}
      role="dialog"
      ariaLabel={dialogLabel}
      overlayStyle={styles.securityOverlay}
      panelStyle={styles.securityCard}
      initialFocusRef={denyBtnRef}
      deps={[request?.confirmation_id]}
    >
      <div style={{ ...styles.securityBadge, background: riskColor + "22", color: riskColor }}>
        {dialogLabel}
      </div>
      <h3 style={styles.securityTitle}>
        {isAppLaunch ? "允许启动此应用吗？" : `允许执行 \`${request.tool_name}\` 吗？`}
      </h3>
      {(!isAppLaunch || request.dangerous_apis.length > 0) && (
        <p style={styles.securityText}>
          检测到高风险 API：{" "}
          <span style={{ color: "#F44336", fontWeight: 700 }}>
            {request.dangerous_apis.join(", ") || "未知"}
          </span>
          。请确认这段代码符合你的意图后再允许执行。
        </p>
      )}
      {isAppLaunch && (
        <p style={styles.securityText}>
          host_app 将启动白名单中的应用（无参数启动）。请确认这是你要启动的应用：
        </p>
      )}
      {request.defense_layer !== undefined && (
        <div style={styles.defenseLayerHint}>
          防御层：Layer {request.defense_layer}
        </div>
      )}
      {showPreviewImage && (
        <div style={styles.computerPreview}>
          <img
            src={`data:image/jpeg;base64,${request.preview_image}`}
            alt="目标窗口标注截图（凭证区已黑化）"
            style={styles.computerPreviewImg}
            onError={() => setPreviewImgFailed(true)}
          />
          {request.preview_caption && (
            <div style={styles.computerPreviewCaption}>{request.preview_caption}</div>
          )}
        </div>
      )}
      {request.full_preview ? (
        // P1:完整预览文本独立字段——30 动作 + 2000 语料逐条枚举对人完整可见;
        // 可滚动区(maxHeight + overflow),纯文本 pre-wrap(非代码,不高亮)。
        <div style={styles.securityFullPreview}>{request.full_preview}</div>
      ) : (
        <div style={styles.securityCode}>
          <HighlightedCode code={request.code_preview || "(无代码预览)"} />
        </div>
      )}
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
      {canThreadTrust && (
        <div style={{ ...styles.whitelistSection, marginTop: 8 }}>
          <label style={{ ...styles.whitelistOption, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={threadTrust}
              onChange={(e) => setThreadTrust(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            <span>
              信任 <code style={styles.whitelistCode}>{relevantApp}</code>，本线程内不再询问
              <span style={{ color: "#888", fontSize: 11, marginLeft: 4 }}>
                {threadTrustHint(request?.tool_name)}
              </span>
            </span>
          </label>
        </div>
      )}
      {nonceChallenge && (
        <div style={{ ...styles.whitelistSection, marginTop: 8, background: "#FFF3CD", border: "1px solid #FFC107" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            🔐 请输入确认码（手动输入，不可粘贴）：
          </div>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: 8, fontFamily: "monospace",
            textAlign: "center", padding: "12px 0", background: "#fff", borderRadius: 6,
            border: "2px dashed #FFC107", userSelect: "none",
          }}>
            {nonceChallenge}
          </div>
          <input
            type="text"
            maxLength={6}
            value={nonceInput}
            onChange={(e) => {
              setNonceInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              setPasteBlocked(false)
            }}
            onPaste={(e) => {
              e.preventDefault()
              setPasteBlocked(true)
            }}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              // Block Cmd+V / Ctrl+V / Shift+Insert
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
                e.preventDefault()
                setPasteBlocked(true)
              }
              if (e.shiftKey && e.key === "Insert") {
                e.preventDefault()
                setPasteBlocked(true)
              }
            }}
            onDrop={(e) => e.preventDefault()}
            placeholder="6 位确认码"
            style={{
              width: "100%", marginTop: 8, padding: "10px 12px", fontSize: 18,
              fontFamily: "monospace", letterSpacing: 4, textAlign: "center",
              borderRadius: 6, border: `2px solid ${nonceMatches ? "#4CAF50" : pasteBlocked ? "#F44336" : "#FFC107"}`,
              outline: "none",
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {pasteBlocked && (
            <div style={{ color: "#F44336", fontSize: 12, marginTop: 4 }}>
              ⛔ 粘贴被禁止 — 请手动输入确认码（Round 2 §2.3 安全要求）
            </div>
          )}
          {!pasteBlocked && !nonceMatches && nonceInput.length > 0 && (
            <div style={{ color: "#FF9800", fontSize: 12, marginTop: 4 }}>
              输入与确认码不匹配
            </div>
          )}
          {nonceMatches && (
            <div style={{ color: "#4CAF50", fontSize: 12, marginTop: 4 }}>
              ✓ 确认码匹配，可以允许执行
            </div>
          )}
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
        <button ref={denyBtnRef} style={styles.denyBtn} onClick={() => decide(false)} title="拒绝本次操作">拒绝</button>
        <button
          style={{ ...styles.allowBtn, background: nonceChallenge && !nonceMatches ? "#999" : riskColor, cursor: nonceChallenge && !nonceMatches ? "not-allowed" : "pointer" }}
          onClick={() => decide(true)}
          disabled={!!nonceChallenge && !nonceMatches}
          title={nonceChallenge && !nonceMatches ? "请先正确输入确认码" : "允许执行本次操作"}
        >
          允许执行
        </button>
      </div>
    </Modal>
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

function Header({ connectionState, onCraft, onToggleLogs, onOpenNotebooklmImporter }: { connectionState: ConnectionState; onCraft: () => void; onToggleLogs: () => void; onOpenNotebooklmImporter: () => void }) {
  const { state, dispatch } = useAgentStore()
  const hasMessages = state.messages.length > 0 && !!state.activeThreadId
  const [nbState, setNbState] = useState<"idle" | "working" | "warning">("idle")
  const [nbTooltip, setNbTooltip] = useState<string>("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
  // useRef lock is mandatory: React state updates are async, so a rapid second click
  // within the same tick can pass the `nbState === "working"` guard before the first
  // setNbState commits — both fire sendMessage → double download. The ref is synchronous.
  const nbInflightRef = useRef(false)

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

  return (
    <div style={styles.header}>
      <ThreadList />
      <div style={styles.headerTitle}>CMspark Agent</div>
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
      <button
        style={{
          ...styles.craftBtn,
        }}
        onClick={onOpenNotebooklmImporter}
        title="打开 NotebookLM 导入器（在线批量导入到 NotebookLM）"
      >
        📓
      </button>
      <button
        style={{
          ...styles.craftBtn,
          ...(nbState === "warning" ? { background: "#FFF3CD" } : {}),
        }}
        disabled={nbState === "working"}
        onClick={runNotebooklmExport}
        title={nbTooltip}
      >
        {nbState === "working" ? "⏳" : nbState === "warning" ? "⚠️" : "💾"}
      </button>
      <button
        style={{
          ...styles.craftBtn,
          opacity: hasMessages ? 1 : 0.4,
          cursor: hasMessages ? "pointer" : "not-allowed",
        }}
        disabled={!hasMessages || state.summarizingThreadId === state.activeThreadId}
        onClick={() => {
          if (state.activeThreadId) {
            dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: state.activeThreadId })
            chrome.runtime.sendMessage({
              type: "thread.export_obsidian",
              thread_id: state.activeThreadId,
              scope: "summary",
            })
          }
        }}
        title={hasMessages ? "导出整线程摘要到 Obsidian(结构化总结 + 折叠原文)" : "当前线程没有消息"}
      >
        {state.summarizingThreadId === state.activeThreadId ? "⏳" : "🧠"}
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
  const sendingRef = useRef(false)

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
  // WP4 (WI-3): full_preview 可滚动区——比 code 区更高,长枚举清单少翻页。
  securityFullPreview: {
    maxHeight: 260,
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
  // WP4 (WI-3): L2 标注截图块(凭证区已黑化 + 十字线)。
  computerPreview: {
    marginBottom: 10,
  },
  computerPreviewImg: {
    display: "block",
    width: "100%",
    borderRadius: 6,
    border: "1px solid #e5e7eb",
  },
  computerPreviewCaption: {
    marginTop: 6,
    fontSize: 11,
    color: "#666",
    lineHeight: 1.5,
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
