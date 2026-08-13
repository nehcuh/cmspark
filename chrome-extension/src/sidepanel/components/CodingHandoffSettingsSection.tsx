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
}
