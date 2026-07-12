// MCP servers panel — mirrors SkillsPanel layout for consistency.
// Shows configured MCP servers, their connection status, exposed tools, and lets the
// user toggle per-thread enable mode (auto/all/manual) plus open the add/edit form.

import { useState } from "react"
import { useAgentStore } from "../store/agentStore"
import type { McpServerMeta, McpSelectionMode } from "../types"

const STATUS_COLORS: Record<string, string> = {
  connected: "#22c55e",
  connecting: "#f59e0b",
  disconnected: "#9ca3af",
  error: "#ef4444",
  dead: "#6b7280",
}

const STATUS_LABELS: Record<string, string> = {
  connected: "已连接",
  connecting: "连接中",
  disconnected: "未连接",
  error: "错误",
  dead: "已停止",
}

const TRUST_LABELS: Record<string, string> = {
  manual: "每次确认",
  "first-use": "首次确认",
  trusted: "信任",
}

export function McpPanel() {
  const { state, dispatch } = useAgentStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleModeChange = (mode: McpSelectionMode) => {
    dispatch({ type: "SET_MCP_SELECTION_MODE", mode })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { mcp_selection_mode: mode },
      })
    }
  }

  const handleToggleServer = (name: string, enabledInConfig: boolean) => {
    // Toggle the config-level enabled flag (not the per-thread active set)
    chrome.runtime.sendMessage({
      type: "mcp.toggle_server",
      name,
      enabled: !enabledInConfig,
    })
  }

  const handleToggleActive = (name: string) => {
    const next = state.activeMcpServerIds.includes(name)
      ? state.activeMcpServerIds.filter((id) => id !== name)
      : [...state.activeMcpServerIds, name]
    dispatch({ type: "TOGGLE_MCP_SERVER", serverName: name })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { active_mcp_server_ids: next },
      })
    }
  }

  const handleEdit = (name: string) => {
    dispatch({ type: "OPEN_MCP_SERVER_FORM", editing: name })
    setMenuOpen(null)
  }

  const handleDelete = (name: string) => {
    if (confirm(`确定删除 MCP server "${name}"？此操作不可撤销。`)) {
      chrome.runtime.sendMessage({ type: "mcp.delete", name })
    }
    setMenuOpen(null)
  }

  const handleAdd = () => {
    dispatch({ type: "OPEN_MCP_SERVER_FORM", editing: null })
  }

  const handleRefresh = () => {
    chrome.runtime.sendMessage({ type: "mcp.list" })
  }

  const modeLabels: Record<string, string> = { auto: "自动", all: "全部", manual: "按需" }
  const modeHints: Record<string, string> = {
    auto: "索引注入 system prompt，LLM 按需调用",
    all: "所有 server 的 tools 直接给 LLM",
    manual: "仅勾选的 server 暴露工具",
  }

  return (
    <div style={styles.panelContent}>
      {/* Mode switcher */}
      <div style={styles.modeSwitcher}>
        {(["auto", "all", "manual"] as const).map((mode) => (
          <button
            key={mode}
            style={{
              ...styles.modeBtn,
              background: state.mcpSelectionMode === mode ? "#4A90D9" : "#fff",
              color: state.mcpSelectionMode === mode ? "#fff" : "#666",
              borderColor: state.mcpSelectionMode === mode ? "#4A90D9" : "#ddd",
            }}
            onClick={() => handleModeChange(mode)}
            title={modeHints[mode]}
          >
            {modeLabels[mode]}
          </button>
        ))}
        <button
          style={{ ...styles.modeBtn, marginLeft: "auto", minWidth: "auto" }}
          onClick={handleRefresh}
          title="刷新 MCP 状态"
        >
          ↻
        </button>
      </div>

      {/* Server list */}
      {state.mcpServers.length === 0 && (
        <div style={styles.emptyText}>
          尚未配置 MCP server。点击下方按钮添加，让 agent 接入 filesystem / git / 数据库等外部工具。
        </div>
      )}

      {state.mcpServers.map((server) => (
        <ServerCard
          key={server.name}
          server={server}
          selectionMode={state.mcpSelectionMode}
          activeInThread={state.activeMcpServerIds.includes(server.name)}
          expanded={expanded.has(server.name)}
          menuOpen={menuOpen === server.name}
          onToggleExpand={() => toggleExpand(server.name)}
          onToggleEnabled={() => handleToggleServer(server.name, server.enabled)}
          onToggleActive={() => handleToggleActive(server.name)}
          onEdit={() => handleEdit(server.name)}
          onDelete={() => handleDelete(server.name)}
          onMenuToggle={() => setMenuOpen(menuOpen === server.name ? null : server.name)}
        />
      ))}

      {/* Add button */}
      <button style={styles.addBtn} onClick={handleAdd}>
        + 添加 MCP Server
      </button>
    </div>
  )
}

interface ServerCardProps {
  server: McpServerMeta
  selectionMode: McpSelectionMode
  activeInThread: boolean
  expanded: boolean
  menuOpen: boolean
  onToggleExpand: () => void
  onToggleEnabled: () => void
  onToggleActive: () => void
  onEdit: () => void
  onDelete: () => void
  onMenuToggle: () => void
}

function ServerCard(props: ServerCardProps) {
  const { server, selectionMode, activeInThread, expanded, menuOpen } = props
  const status = server.connection.status
  const transportLabel = server.transport === "stdio" ? "本地" : "远程"
  const enabledInThread = selectionMode === "all" || (selectionMode === "manual" && activeInThread) || selectionMode === "auto"

  return (
    <div
      style={{
        ...styles.serverCard,
        background: enabledInThread ? "#f0f7ff" : "#fafafa",
        opacity: server.enabled ? 1 : 0.55,
        borderColor: status === "error" || status === "dead" ? "#fecaca" : "#e5e7eb",
      }}
    >
      <div style={styles.cardHeader}>
        <span
          style={{ ...styles.statusDot, background: STATUS_COLORS[status] }}
          title={STATUS_LABELS[status] + (server.connection.last_error ? `: ${server.connection.last_error}` : "")}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.cardTitle}>
            <span style={{ fontWeight: 500 }}>{server.name}</span>
            <span style={styles.transportBadge}>{transportLabel}</span>
            <span style={styles.trustBadge}>信任：{TRUST_LABELS[server.trust_level]}</span>
            {Array.isArray(server.config?.security_capabilities) && server.config.security_capabilities.length > 0 && (
              <span
                style={styles.capBadge}
                title={`声明的安全能力（§6.3 能力门）：${server.config.security_capabilities.join(", ")}`}
              >
                🔒 {server.config.security_capabilities.join("/")}
              </span>
            )}
          </div>
          <div style={styles.cardMeta}>
            {server.tools.length > 0 && <span>🛠 {server.tools.length} 工具</span>}
            {server.capabilities.resources && <span>📦 资源</span>}
            {server.capabilities.prompts && <span>💬 提示词</span>}
            {server.connection.restart_count > 0 && (
              <span style={{ color: "#f59e0b" }}>↻ 重启 {server.connection.restart_count}</span>
            )}
          </div>
        </div>
        <label
          style={styles.enabledToggle}
          title={server.enabled ? "已启用（点击关闭）" : "已停用（点击启用）"}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={props.onToggleEnabled}
            style={{ marginRight: 4 }}
          />
          启用
        </label>
        {selectionMode === "manual" && (
          <label style={styles.activeToggle} title="在此线程激活" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={activeInThread}
              onChange={props.onToggleActive}
              style={{ marginRight: 4 }}
            />
            当前
          </label>
        )}
        <button
          style={styles.expandBtn}
          onClick={props.onToggleExpand}
          title={expanded ? "收起" : "展开工具列表"}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <button style={styles.menuBtn} onClick={props.onMenuToggle} title="更多操作">
          ···
        </button>
        {menuOpen && (
          <div style={styles.menuDropdown}>
            <button style={styles.menuItem} onClick={props.onEdit}>✏️ 编辑</button>
            <button
              style={{ ...styles.menuItem, color: "#F44336" }}
              onClick={props.onDelete}
            >
              🗑️ 删除
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={styles.cardExpanded}>
          {server.connection.last_error && (
            <div style={styles.errorLine}>⚠ {server.connection.last_error}</div>
          )}
          {server.server_info?.name && (
            <div style={styles.serverInfoLine}>
              服务端：{server.server_info.name} {server.server_info.version ? `v${server.server_info.version}` : ""}
            </div>
          )}
          {server.tools.length === 0 && server.capabilities.tools && (
            <div style={styles.emptyMini}>工具列表为空</div>
          )}
          {status === "connected" && server.tools.length === 0 && !server.capabilities.tools && (
            <div style={styles.emptyMini}>此 server 未声明 tools 能力</div>
          )}
          {(status === "disconnected" || status === "connecting") && server.tools.length === 0 && (
            <div style={styles.emptyMini}>{STATUS_LABELS[status]}，无法获取工具列表</div>
          )}
          {server.tools.map((tool) => (
            <div key={tool.namespacedName} style={styles.toolRow}>
              <code style={styles.toolName}>{tool.name}</code>
              {tool.description && (
                <div style={styles.toolDesc}>{tool.description.slice(0, 120)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panelContent: {
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  modeSwitcher: {
    display: "flex",
    gap: 4,
    marginBottom: 4,
  },
  modeBtn: {
    flex: 1,
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 12,
    cursor: "pointer",
    background: "#fff",
    color: "#666",
  },
  emptyText: {
    padding: "16px 8px",
    textAlign: "center",
    fontSize: 12,
    color: "#888",
    lineHeight: 1.5,
  },
  serverCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 8,
    background: "#fafafa",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    position: "relative",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    flexWrap: "wrap",
  },
  transportBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#e0e7ff",
    color: "#3730a3",
  },
  trustBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#fef3c7",
    color: "#92400e",
  },
  capBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#f3e8ff",
    color: "#6b21a8",
  },
  cardMeta: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    color: "#666",
    marginTop: 2,
    flexWrap: "wrap",
  },
  enabledToggle: {
    fontSize: 10,
    color: "#555",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  activeToggle: {
    fontSize: 10,
    color: "#4A90D9",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  expandBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 6px",
    fontSize: 14,
    color: "#666",
  },
  menuBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: 14,
    color: "#666",
    letterSpacing: -1,
  },
  menuDropdown: {
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 10,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    minWidth: 100,
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    color: "#333",
  },
  cardExpanded: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px dashed #e5e7eb",
  },
  errorLine: {
    fontSize: 11,
    color: "#dc2626",
    marginBottom: 4,
  },
  serverInfoLine: {
    fontSize: 11,
    color: "#888",
    marginBottom: 4,
  },
  emptyMini: {
    fontSize: 11,
    color: "#999",
    fontStyle: "italic",
  },
  toolRow: {
    marginBottom: 6,
    padding: "4px 6px",
    background: "#fff",
    borderRadius: 3,
    border: "1px solid #f3f4f6",
  },
  toolName: {
    fontSize: 11,
    color: "#4A90D9",
    fontFamily: "ui-monospace, monospace",
  },
  toolDesc: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  addBtn: {
    marginTop: 6,
    padding: "8px 12px",
    border: "1px dashed #4A90D9",
    borderRadius: 6,
    background: "transparent",
    color: "#4A90D9",
    cursor: "pointer",
    fontSize: 12,
  },
}
