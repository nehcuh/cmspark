import { useAgentStore } from "./store/agentStore"
import type { ConnectionState } from "../types"

interface ConnectionStatusProps {
  state: ConnectionState
  onRetry: () => void
}

export function ConnectionStatus({ state, onRetry }: ConnectionStatusProps) {
  const colors: Record<ConnectionState, { bg: string; dot: string; label: string }> = {
    connected:   { bg: "#E8F5E9", dot: "#4CAF50", label: "已连接" },
    connecting:  { bg: "#FFF3E0", dot: "#FF9800", label: "连接中..." },
    disconnected:{ bg: "#FFEBEE", dot: "#F44336", label: "已断开" },
  }
  const c = colors[state]

  if (state === "disconnected") {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(255,255,255,0.97)", zIndex: 9999,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔌</div>
        <h3 style={{ color: "#333", marginBottom: 8 }}>未连接到 Companion</h3>
        <p style={{ color: "#666", fontSize: 13, maxWidth: 240, textAlign: "center", lineHeight: 1.5 }}>
          Companion 未运行或连接中断。请在终端中运行以下命令启动：
        </p>
        <pre style={{
          background: "#f5f5f5", padding: "8px 16px", borderRadius: 6,
          fontSize: 12, marginTop: 12, color: "#333",
          whiteSpace: "nowrap",
        }}>
          cmspark-agent start
        </pre>
        <button
          style={{
            marginTop: 16, padding: "8px 32px", border: "none",
            borderRadius: 6, background: "#4A90D9", color: "#fff",
            fontSize: 13, cursor: "pointer",
          }}
          onClick={onRetry}
        >
          重试连接
        </button>
      </div>
    )
  }

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 8px", borderRadius: 4, fontSize: 12,
      background: c.bg, color: "#333",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: c.dot, display: "inline-block",
      }} />
      {c.label}
    </div>
  )
}
