// Settings → 编程助手 (Phase A minimal + ACP opt-in flag display)

import { useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { SectionHeader } from "../ui/SectionHeader"
import { codingHandoffCopy } from "../coding-handoff/copy"

type AcpAgent = {
  id: string
  display_name: string
  enabled: boolean
  command: string
  source?: "config" | "discovered"
}

/** Preset options for coding_handoff.local_terminal_app */
export const LOCAL_TERMINAL_APP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "系统自动（推荐）" },
  { value: "wt", label: "Windows Terminal" },
  { value: "cmd", label: "Windows 控制台 (cmd)" },
  { value: "Terminal", label: "Terminal.app（macOS）" },
  { value: "iTerm", label: "iTerm2" },
  { value: "Warp", label: "Warp（可能需粘贴任务）" },
  { value: "Alacritty", label: "Alacritty" },
  { value: "Kitty", label: "Kitty" },
  { value: "Ghostty", label: "Ghostty" },
]

type Props = {
  /** From companion config.acp.enabled when available */
  acpEnabled?: boolean
  autoSuggest?: boolean
  /** Mode C: open host Terminal with interactive agent on start */
  openLocalTerminal?: boolean
  /** Mode C: preferred terminal app id or path */
  localTerminalApp?: string
  /** Last acp.list agents (discovery independent of master switch) */
  acpAgents?: AcpAgent[]
  onToggleAutoSuggest?: (v: boolean) => void
  onToggleAcp?: (v: boolean) => void
  onToggleOpenLocalTerminal?: (v: boolean) => void
  /** #432: embedded_terminal.enabled（默认关） */
  embeddedTerminal?: boolean
  onToggleEmbeddedTerminal?: (v: boolean) => void
  onChangeLocalTerminalApp?: (v: string) => void
}

export function CodingHandoffSettingsSection({
  acpEnabled = false,
  autoSuggest = true,
  openLocalTerminal = false,
  localTerminalApp = "auto",
  acpAgents = [],
  onToggleAutoSuggest,
  onToggleAcp,
  onToggleOpenLocalTerminal,
  embeddedTerminal = false,
  onToggleEmbeddedTerminal,
  onChangeLocalTerminalApp,
}: Props) {
  const [busy, setBusy] = useState<"none" | "rediscover" | "adopt">("none")
  const [flash, setFlash] = useState("")

  const runList = (type: "acp.rediscover" | "acp.adopt_discovered", label: string) => {
    setBusy(type === "acp.rediscover" ? "rediscover" : "adopt")
    setFlash("")
    chrome.runtime.sendMessage({ type }, () => {
      void chrome.runtime.lastError
      setBusy("none")
      // Companion pushes acp.list → store; flash after short delay for store update
      window.setTimeout(() => {
        setFlash(label)
      }, 200)
    })
  }

  return (
    <div style={styles.wrap}>
      <SectionHeader title={codingHandoffCopy.settingsTitle} />
      <p style={styles.blurb}>{codingHandoffCopy.productBlurb}</p>
      <p style={styles.contrast}>{codingHandoffCopy.outboundContrast}</p>

      <label style={styles.row}>
        <input
          type="checkbox"
          checked={autoSuggest}
          onChange={(e) => onToggleAutoSuggest?.(e.target.checked)}
        />
        <span>{codingHandoffCopy.settingsAutoSuggest}</span>
      </label>

      <label style={styles.row}>
        <input
          type="checkbox"
          checked={acpEnabled}
          onChange={(e) => onToggleAcp?.(e.target.checked)}
        />
        <span>{codingHandoffCopy.settingsAcpEnabled}</span>
      </label>
      <p style={styles.hint}>{codingHandoffCopy.settingsAcpHint}</p>

      <label style={styles.row}>
        <input
          type="checkbox"
          checked={openLocalTerminal}
          onChange={(e) => onToggleOpenLocalTerminal?.(e.target.checked)}
        />
        <span>{codingHandoffCopy.settingsOpenLocalTerminal}</span>
      </label>
      <p style={styles.hint}>{codingHandoffCopy.settingsOpenLocalTerminalHint}</p>

      <label style={styles.row}>
        <input
          type="checkbox"
          checked={embeddedTerminal}
          onChange={(e) => onToggleEmbeddedTerminal?.(e.target.checked)}
        />
        <span>{codingHandoffCopy.settingsEmbeddedTerminal}</span>
      </label>
      <p style={styles.hint}>{codingHandoffCopy.settingsEmbeddedTerminalHint}</p>
      {embeddedTerminal ? (
        <button
          type="button"
          style={{ ...styles.select, cursor: "pointer", textAlign: "left" }}
          onClick={() => {
            chrome.runtime.sendMessage({ type: "terminal.open_tab" }, () => {
              void chrome.runtime.lastError
            })
          }}
        >
          {codingHandoffCopy.settingsEmbeddedTerminalOpen} →
        </button>
      ) : null}

      <label style={{ ...styles.row, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{codingHandoffCopy.settingsLocalTerminalApp}</span>
        <select
          style={styles.select}
          value={
            LOCAL_TERMINAL_APP_OPTIONS.some((o) => o.value === (localTerminalApp || "auto"))
              ? localTerminalApp || "auto"
              : "__custom__"
          }
          disabled={!openLocalTerminal}
          onChange={(e) => {
            const v = e.target.value
            if (v === "__custom__") return
            onChangeLocalTerminalApp?.(v)
          }}
        >
          {LOCAL_TERMINAL_APP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!LOCAL_TERMINAL_APP_OPTIONS.some((o) => o.value === (localTerminalApp || "auto")) ? (
            <option value="__custom__">自定义：{localTerminalApp}</option>
          ) : null}
        </select>
        <input
          type="text"
          style={styles.pathInput}
          placeholder="或填绝对路径，如 /Applications/iTerm.app"
          disabled={!openLocalTerminal}
          defaultValue={
            LOCAL_TERMINAL_APP_OPTIONS.some((o) => o.value === (localTerminalApp || "auto"))
              ? ""
              : localTerminalApp || ""
          }
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v) onChangeLocalTerminalApp?.(v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim()
              if (v) onChangeLocalTerminalApp?.(v)
            }
          }}
        />
      </label>
      <p style={styles.hint}>{codingHandoffCopy.settingsLocalTerminalAppHint}</p>

      <div style={styles.detectBox}>
        <div style={styles.detectTitle}>{codingHandoffCopy.discoveredTitle}</div>
        {acpAgents.length === 0 ? (
          <p style={styles.hint}>{codingHandoffCopy.discoveredEmpty}</p>
        ) : (
          <ul style={styles.agentList}>
            {acpAgents.map((a) => (
              <li key={a.id} style={styles.agentItem}>
                <strong>{a.display_name}</strong>
                <span style={styles.agentMeta}>
                  {" "}
                  · {a.command || "—"}
                  {a.source === "discovered" ? " · 已检测" : " · 已配置"}
                  {!a.enabled ? " · 已禁用" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!acpEnabled && acpAgents.length > 0 ? (
          <p style={styles.needEnable}>{codingHandoffCopy.discoveredNeedEnable}</p>
        ) : null}
        <p style={styles.hint}>{codingHandoffCopy.rediscoverHint}</p>
      </div>

      <p style={styles.hint}>
        快捷入口：对话中输入 <code>/code</code> 或 <code>/编程</code>，或消息旁「
        {codingHandoffCopy.ctaHandoff}」。
      </p>
      <button
        type="button"
        style={styles.redetect}
        disabled={busy !== "none"}
        onClick={() => runList("acp.rediscover", "已重新检测")}
      >
        {busy === "rediscover" ? "检测中…" : codingHandoffCopy.rediscover}
      </button>
      <button
        type="button"
        style={styles.redetect}
        disabled={busy !== "none"}
        onClick={() => runList("acp.adopt_discovered", "已写入 config（若有新增）")}
      >
        {busy === "adopt" ? "写入中…" : codingHandoffCopy.adoptConfig}
      </button>
      {flash ? <p style={styles.flash}>{flash}</p> : null}
      <p style={styles.hint}>
        开启 ACP 后可用列表中的 claude / gemini / codex / pi / grok / kimi / opencode
        启动会话；也可「写入 config」持久化路径。
      </p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { padding: "4px 0 12px" },
  blurb: {
    fontSize: 12,
    color: tokens.textSecondary || "#555",
    lineHeight: 1.45,
    margin: "0 0 6px",
  },
  contrast: {
    fontSize: 11,
    color: tokens.textMuted || "#888",
    lineHeight: 1.4,
    margin: "0 0 10px",
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 12,
    marginBottom: 8,
    color: tokens.text || "#111",
  },
  select: {
    width: "100%",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bgElevated || "#fff",
    color: tokens.text || "#111",
  },
  pathInput: {
    width: "100%",
    fontSize: 11,
    padding: "5px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bgElevated || "#fff",
    color: tokens.text || "#111",
    boxSizing: "border-box" as const,
  },
  hint: {
    fontSize: 11,
    color: tokens.textMuted || "#888",
    lineHeight: 1.4,
    margin: "0 0 8px",
  },
  detectBox: {
    border: `1px solid ${tokens.border || "#e5e5e5"}`,
    borderRadius: 8,
    padding: "8px 10px",
    marginBottom: 10,
    background: tokens.bgElevated || "#fafafa",
  },
  detectTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    color: tokens.text || "#111",
  },
  agentList: {
    margin: "0 0 6px",
    paddingLeft: 18,
    fontSize: 12,
    color: tokens.text || "#111",
  },
  agentItem: { marginBottom: 4, lineHeight: 1.35 },
  agentMeta: { fontWeight: 400, color: tokens.textMuted || "#888", fontSize: 11 },
  needEnable: {
    fontSize: 11,
    color: tokens.accent || "#0b6bcb",
    margin: "0 0 6px",
    lineHeight: 1.4,
  },
  redetect: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bg || "#fff",
    cursor: "pointer",
    marginBottom: 8,
    marginRight: 8,
  },
  flash: {
    fontSize: 11,
    color: tokens.accent || "#0b6bcb",
    margin: "0 0 8px",
  },
}
