// CMspark Browser Agent — Root App Component

import { useState } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { ChatView } from "./components/ChatView"
import { ThreadList } from "./components/ThreadList"
import { BottomBar } from "./components/BottomBar"
import { SettingsSlideout } from "./components/SettingsSlideout"
import { AgentStoreProvider, useAgentStore } from "./store/agentStore"
import type { ConnectionState } from "./types"

export function App() {
  return (
    <AgentStoreProvider>
      <AppContent />
    </AgentStoreProvider>
  )
}

function AppContent() {
  const { connectionState } = useWebSocket()

  return (
    <div style={styles.container}>
      <Header connectionState={connectionState} />
      <ChatView />
      <BottomBar />
      <InputArea />
      <SettingsSlideout />
      <DisconnectedOverlay visible={connectionState === "disconnected"} />
    </div>
  )
}

function Header({ connectionState }: { connectionState: ConnectionState }) {
  return (
    <div style={styles.header}>
      <ThreadList />
      <div style={styles.headerTitle}>CMspark Agent</div>
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

  const canSend = text.trim().length > 0 && !!state.activeThreadId && state.connectionState === "connected"
  const needsThread = !state.activeThreadId
  const needsConnection = state.connectionState !== "connected"

  const getPlaceholder = () => {
    if (needsThread) return "请先创建或选择一个线程"
    if (needsConnection) return "等待 companion 连接..."
    return "输入指令..."
  }

  const handleSend = () => {
    if (!canSend) return
    const trimmed = text.trim()

    chrome.runtime.sendMessage({
      type: "chat.send",
      threadId: state.activeThreadId,
      message: trimmed,
      skillIds: state.activeSkillIds,
    })
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
    setText("")
  }

  return (
    <div style={styles.inputArea}>
      <textarea
        style={{
          ...styles.textarea,
          background: needsThread || needsConnection ? "#f9f9f9" : "#fff",
        }}
        placeholder={getPlaceholder()}
        rows={2}
        value={text}
        disabled={needsThread || needsConnection}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && canSend) {
            e.preventDefault()
            handleSend()
          }
        }}
      />
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
      <button style={styles.settingsBtn} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>⚙</button>
    </div>
  )
}

function DisconnectedOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div style={styles.overlay}>
      <div style={styles.overlayContent}>
        <div style={styles.overlayIcon}>🔌</div>
        <h3 style={styles.overlayTitle}>Companion 未连接</h3>
        <p style={styles.overlayText}>请运行以下命令启动 companion：</p>
        <code style={styles.overlayCode}>cmspark-agent start</code>
        <button
          style={styles.copyBtn}
          onClick={() => navigator.clipboard.writeText("cmspark-agent start")}
        >
          复制命令
        </button>
      </div>
    </div>
  )
}

// --- Styles ---

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
  inputArea: {
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    padding: "8px 12px",
    borderTop: "1px solid #eee",
    flexShrink: 0,
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
  overlay: {
    position: "absolute" as const,
    inset: 0,
    background: "rgba(255,255,255,0.95)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  overlayContent: {
    textAlign: "center" as const,
    padding: 24,
  },
  overlayIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  overlayTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 8,
  },
  overlayText: {
    color: "#666",
    marginBottom: 8,
  },
  overlayCode: {
    display: "block",
    background: "#f5f5f5",
    padding: "8px 14px",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 12,
  },
  copyBtn: {
    padding: "6px 16px",
    borderRadius: 6,
    border: "1px solid #4A90D9",
    background: "#fff",
    color: "#4A90D9",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
}
