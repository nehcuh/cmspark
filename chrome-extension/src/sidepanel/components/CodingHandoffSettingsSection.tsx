// Settings → 编程助手 (Phase A minimal + ACP opt-in flag display)

import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { SectionHeader } from "../ui/SectionHeader"
import { codingHandoffCopy } from "../coding-handoff/copy"

type Props = {
  /** From companion config.acp.enabled when available */
  acpEnabled?: boolean
  autoSuggest?: boolean
  onToggleAutoSuggest?: (v: boolean) => void
  onToggleAcp?: (v: boolean) => void
}

export function CodingHandoffSettingsSection({
  acpEnabled = false,
  autoSuggest = true,
  onToggleAutoSuggest,
  onToggleAcp,
}: Props) {
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

      <p style={styles.hint}>
        快捷入口：对话中输入 <code>/code</code> 或 <code>/编程</code>，或消息旁「
        {codingHandoffCopy.ctaHandoff}」。
      </p>
      <button
        type="button"
        style={styles.redetect}
        onClick={() => {
          chrome.runtime.sendMessage({ type: "acp.rediscover" }, () => {
            void chrome.runtime.lastError
          })
        }}
      >
        {codingHandoffCopy.rediscover}
      </button>
      <button
        type="button"
        style={styles.redetect}
        onClick={() => {
          chrome.runtime.sendMessage({ type: "acp.adopt_discovered" }, () => {
            void chrome.runtime.lastError
          })
        }}
      >
        {codingHandoffCopy.adoptConfig}
      </button>
      <p style={styles.hint}>
        开启 ACP 后会探测 PATH 上的 claude / gemini / codex / pi；可持久化路径，也可直接用「已检测」临时启动。
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
  hint: {
    fontSize: 11,
    color: tokens.textMuted || "#888",
    lineHeight: 1.4,
    margin: "0 0 8px",
  },
  redetect: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bg || "#fff",
    cursor: "pointer",
    marginBottom: 8,
  },
}
