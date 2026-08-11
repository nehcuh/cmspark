// Shared secondary-panel section header (Precision Instrument Phase 2b).
// Type scale: title 13 / meta 11. Hairline bottom — no emoji chrome.

import type { CSSProperties, ReactNode } from "react"
import { tokens } from "./tokens"

export function SectionHeader({
  title,
  meta,
  action,
  style,
}: {
  title: string
  /** Right-side meta (count, status) */
  meta?: ReactNode
  /** Optional action control (button) */
  action?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={{ ...styles.row, ...style }} data-section-header={title}>
      <div style={styles.title}>{title}</div>
      {meta != null && <div style={styles.meta}>{meta}</div>}
      {action != null && <div style={styles.action}>{action}</div>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0 6px",
    marginBottom: 4,
    borderBottom: `1px solid ${tokens.border}`,
    fontFamily: tokens.font,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text,
    letterSpacing: "-0.01em",
  },
  meta: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.textMuted,
  },
  action: {
    flexShrink: 0,
  },
}
