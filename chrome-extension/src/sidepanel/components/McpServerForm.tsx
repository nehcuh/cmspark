// MCP server add/edit form modal. Opens when state.mcpServerFormOpen is true.
// Editing an existing server pre-fills from state.mcpServers by name; new server
// starts blank. Submits via mcp.add (new) or mcp.update (existing) WS messages.

import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
  McpTrustLevel,
  McpTransportKind,
} from "../types"

interface EnvEntry {
  key: string
  value: string
}

const TRUST_OPTIONS: { value: McpTrustLevel; label: string; desc: string }[] = [
  { value: "manual", label: "每次确认", desc: "每次调用都弹安全确认（最严格）" },
  { value: "first-use", label: "首次确认", desc: "首次调用确认，同 session 后续跳过（推荐）" },
  { value: "trusted", label: "信任", desc: "完全不确认（仅用于可信 server，如本地 filesystem）" },
]

export function McpServerForm() {
  const { state, dispatch } = useAgentStore()
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<McpTransportKind>("stdio")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([{ key: "", value: "" }])
  const [cwd, setCwd] = useState("")
  const [url, setUrl] = useState("")
  const [headerEntries, setHeaderEntries] = useState<EnvEntry[]>([{ key: "", value: "" }])
  const [trustLevel, setTrustLevel] = useState<McpTrustLevel>("first-use")
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmTrusted, setConfirmTrusted] = useState(false)

  // Pre-fill when editing
  useEffect(() => {
    if (!state.mcpServerFormOpen) return
    setError(null)
    setConfirmTrusted(false)
    const editing = state.mcpServerFormEditing
    const existing = editing ? state.mcpServers.find((s) => s.name === editing) : null
    if (existing) {
      const serverCfg = existing.config
      setName(existing.name)
      setTransport(existing.transport)
      setTrustLevel(existing.trust_level)
      setEnabled(existing.enabled)
      if (serverCfg?.transport === "stdio") {
        setCommand(serverCfg.command || "")
        setArgs(Array.isArray(serverCfg.args) ? serverCfg.args.join(" ") : "")
        setEnvEntries(
          serverCfg.env
            ? Object.entries(serverCfg.env).map(([k, v]) => ({ key: k, value: String(v) }))
            : [{ key: "", value: "" }],
        )
        setCwd(serverCfg.cwd || "")
      } else if (serverCfg?.transport === "http") {
        setUrl(serverCfg.url || "")
        setHeaderEntries(
          serverCfg.headers
            ? Object.entries(serverCfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
            : [{ key: "", value: "" }],
        )
      } else {
        setCommand("")
        setArgs("")
        setEnvEntries([{ key: "", value: "" }])
        setCwd("")
        setUrl("")
        setHeaderEntries([{ key: "", value: "" }])
      }
    } else {
      // New server — defaults
      setName("")
      setTransport("stdio")
      setCommand("")
      setArgs("")
      setEnvEntries([{ key: "", value: "" }])
      setCwd("")
      setUrl("")
      setHeaderEntries([{ key: "", value: "" }])
      setTrustLevel("first-use")
      setEnabled(true)
    }
  }, [state.mcpServerFormOpen, state.mcpServerFormEditing, state.mcpServers, state.config])

  if (!state.mcpServerFormOpen) return null

  const close = () => dispatch({ type: "CLOSE_MCP_SERVER_FORM" })

  const handleAddEnvRow = () => setEnvEntries([...envEntries, { key: "", value: "" }])
  const handleRemoveEnvRow = (i: number) =>
    setEnvEntries(envEntries.filter((_, idx) => idx !== i))
  const handleEnvChange = (i: number, field: keyof EnvEntry, v: string) => {
    const next = [...envEntries]
    next[i] = { ...next[i], [field]: v }
    setEnvEntries(next)
  }
  const handleAddHeaderRow = () => setHeaderEntries([...headerEntries, { key: "", value: "" }])
  const handleRemoveHeaderRow = (i: number) =>
    setHeaderEntries(headerEntries.filter((_, idx) => idx !== i))
  const handleHeaderChange = (i: number, field: keyof EnvEntry, v: string) => {
    const next = [...headerEntries]
    next[i] = { ...next[i], [field]: v }
    setHeaderEntries(next)
  }

  const buildConfig = (): McpServerConfig | { error: string } => {
    const trimmedName = name.trim()
    if (!trimmedName) return { error: "Server 名称不能为空" }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      return { error: "Server 名称只能包含字母、数字、下划线和连字符" }
    }
    // Collect env/headers into objects, dropping blank keys
    const envObj: Record<string, string> = {}
    for (const e of envEntries) {
      if (e.key.trim()) envObj[e.key.trim()] = e.value
    }
    const headersObj: Record<string, string> = {}
    for (const h of headerEntries) {
      if (h.key.trim()) headersObj[h.key.trim()] = h.value
    }

    if (transport === "stdio") {
      if (!command.trim()) return { error: "command 不能为空（stdio server 必填）" }
      const cfg: McpStdioServerConfig = {
        transport: "stdio",
        command: command.trim(),
        enabled,
        trust_level: trustLevel,
      }
      const argsArr = args.trim() ? splitArgs(args) : undefined
      if (argsArr && argsArr.length > 0) cfg.args = argsArr
      if (Object.keys(envObj).length > 0) cfg.env = envObj
      if (cwd.trim()) cfg.cwd = cwd.trim()
      return cfg
    } else {
      if (!url.trim()) return { error: "url 不能为空（http server 必填）" }
      try {
        new URL(url.trim())
      } catch {
        return { error: "url 格式无效" }
      }
      const cfg: McpHttpServerConfig = {
        transport: "http",
        url: url.trim(),
        enabled,
        trust_level: trustLevel,
      }
      if (Object.keys(headersObj).length > 0) cfg.headers = headersObj
      return cfg
    }
  }

  const handleSave = () => {
    setError(null)
    const result = buildConfig()
    if ("error" in result) {
      setError(result.error)
      return
    }
    // Require explicit double-confirm when promoting to trusted
    if (trustLevel === "trusted" && !confirmTrusted) {
      setError("选择 trust=trusted 需要再次确认 — 该 server 的所有调用将不再弹安全确认。请勾选下方确认框。")
      return
    }
    const isEditing = !!state.mcpServerFormEditing
    if (isEditing) {
      chrome.runtime.sendMessage({
        type: "mcp.update",
        name: state.mcpServerFormEditing,
        patch: result,
      })
    } else {
      chrome.runtime.sendMessage({
        type: "mcp.add",
        name: name.trim(),
        server: result,
      })
    }
    dispatch({ type: "CLOSE_MCP_SERVER_FORM" })
  }

  return (
    <div style={styles.backdrop} onClick={close}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {state.mcpServerFormEditing ? "编辑 MCP Server" : "添加 MCP Server"}
          </h3>
          <button style={styles.closeBtn} onClick={close}>✕</button>
        </div>

        <div style={styles.body}>
          {/* Name */}
          <div style={styles.field}>
            <label style={styles.label}>名称 *</label>
            <input
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!state.mcpServerFormEditing}
              placeholder="filesystem"
            />
            <div style={styles.hint}>字母、数字、下划线、连字符；用作工具前缀 mcp__&lt;名称&gt;__&lt;工具&gt;</div>
          </div>

          {/* Transport */}
          <div style={styles.field}>
            <label style={styles.label}>传输方式</label>
            <div style={styles.radioRow}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="transport"
                  checked={transport === "stdio"}
                  onChange={() => setTransport("stdio")}
                />
                <span><b>本地 stdio</b><br /><span style={styles.hint}>spawn 子进程，如 npx/python3</span></span>
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="transport"
                  checked={transport === "http"}
                  onChange={() => setTransport("http")}
                />
                <span><b>远程 HTTP</b><br /><span style={styles.hint}>Streamable HTTP 端点</span></span>
              </label>
            </div>
          </div>

          {/* stdio fields */}
          {transport === "stdio" && (
            <>
              <div style={styles.field}>
                <label style={styles.label}>command *</label>
                <input
                  style={styles.input}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>args（空格分隔）</label>
                <input
                  style={styles.input}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp/foo"
                />
                <div style={styles.hint}>包含空格的参数请用双引号包裹，如：-c "console.log('hi')"</div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>环境变量（可选）</label>
                {envEntries.map((entry, i) => (
                  <div key={i} style={styles.kvRow}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      value={entry.key}
                      onChange={(e) => handleEnvChange(i, "key", e.target.value)}
                      placeholder="KEY"
                    />
                    <input
                      style={{ ...styles.input, flex: 2 }}
                      value={entry.value}
                      onChange={(e) => handleEnvChange(i, "value", e.target.value)}
                      placeholder="value"
                    />
                    <button style={styles.minusBtn} onClick={() => handleRemoveEnvRow(i)}>−</button>
                  </div>
                ))}
                <button style={styles.addRowBtn} onClick={handleAddEnvRow}>+ 添加变量</button>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>工作目录（可选）</label>
                <input
                  style={styles.input}
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="/Users/you/project"
                />
              </div>
            </>
          )}

          {/* http fields */}
          {transport === "http" && (
            <>
              <div style={styles.field}>
                <label style={styles.label}>URL *</label>
                <input
                  style={styles.input}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Headers（可选，如 Authorization）</label>
                {headerEntries.map((entry, i) => (
                  <div key={i} style={styles.kvRow}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      value={entry.key}
                      onChange={(e) => handleHeaderChange(i, "key", e.target.value)}
                      placeholder="Header-Name"
                    />
                    <input
                      style={{ ...styles.input, flex: 2 }}
                      value={entry.value}
                      onChange={(e) => handleHeaderChange(i, "value", e.target.value)}
                      placeholder="value"
                    />
                    <button style={styles.minusBtn} onClick={() => handleRemoveHeaderRow(i)}>−</button>
                  </div>
                ))}
                <button style={styles.addRowBtn} onClick={handleAddHeaderRow}>+ 添加 Header</button>
              </div>
            </>
          )}

          {/* Trust level */}
          <div style={styles.field}>
            <label style={styles.label}>信任级别</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {TRUST_OPTIONS.map((opt) => (
                <label key={opt.value} style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="trust"
                    checked={trustLevel === opt.value}
                    onChange={() => {
                      setTrustLevel(opt.value)
                      setConfirmTrusted(false)
                    }}
                  />
                  <span>
                    <b>{opt.label}</b><br />
                    <span style={styles.hint}>{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            {trustLevel === "trusted" && (
              <label style={styles.confirmRow}>
                <input
                  type="checkbox"
                  checked={confirmTrusted}
                  onChange={(e) => setConfirmTrusted(e.target.checked)}
                />
                <span style={{ color: "#dc2626", fontSize: 11 }}>
                  我理解此 server 的所有调用将不再弹安全确认
                </span>
              </label>
            )}
          </div>

          {/* Enabled */}
          <div style={styles.field}>
            <label style={styles.radioLabel}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span><b>启用</b><br /><span style={styles.hint}>关闭后此 server 不会自动启动</span></span>
            </label>
          </div>

          {error && (
            <div style={styles.errorBox}>{error}</div>
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={close}>取消</button>
          <button style={styles.saveBtn} onClick={handleSave}>
            {state.mcpServerFormEditing ? "保存修改" : "添加"}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Split a shell-style args string into an argv array, honoring double quotes. */
function splitArgs(s: string): string[] {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "")
  }
  return out
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    background: "#fff",
    borderRadius: 8,
    width: "90%",
    maxWidth: 420,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid #eee",
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 16,
    color: "#666",
  },
  body: {
    padding: "12px 14px",
    overflowY: "auto",
    flex: 1,
  },
  field: {
    marginBottom: 12,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: "#333",
  },
  input: {
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "ui-monospace, monospace",
    outline: "none",
  },
  hint: {
    fontSize: 10,
    color: "#888",
    lineHeight: 1.4,
  },
  radioRow: {
    display: "flex",
    gap: 8,
  },
  radioLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    cursor: "pointer",
    fontSize: 12,
    padding: 4,
    borderRadius: 4,
  },
  kvRow: {
    display: "flex",
    gap: 4,
    marginBottom: 4,
  },
  minusBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    cursor: "pointer",
    padding: "0 8px",
    color: "#dc2626",
  },
  addRowBtn: {
    border: "1px dashed #aaa",
    background: "transparent",
    borderRadius: 4,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 11,
    color: "#666",
    alignSelf: "flex-start",
  },
  confirmRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    padding: "6px 8px",
    background: "#fef2f2",
    borderRadius: 4,
    cursor: "pointer",
  },
  errorBox: {
    padding: "8px 10px",
    background: "#fef2f2",
    color: "#dc2626",
    borderRadius: 4,
    fontSize: 12,
    marginBottom: 8,
  },
  footer: {
    padding: "10px 14px",
    borderTop: "1px solid #eee",
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: "6px 12px",
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
  },
  saveBtn: {
    padding: "6px 12px",
    border: "none",
    background: "#4A90D9",
    color: "#fff",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
  },
}
