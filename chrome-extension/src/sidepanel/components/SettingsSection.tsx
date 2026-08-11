// Collapsible settings section shell (settings-thread-compact W1).

import type { ReactNode } from "react"
import { tokens } from "../ui/tokens"

export function SettingsSection({
  title,
  open,
  onToggle,
  badge,
  children,
  forceHint,
}: {
  title: string
  open: boolean
  onToggle: () => void
  /** Always-visible when collapsed (e.g. armed trust). */
  badge?: ReactNode
  children: ReactNode
  /** Optional subline under header when force-open (e.g. 未配对). */
  forceHint?: string | null
}) {
  return (
    <section style={styles.section} data-settings-section={title}>
      <button
        type="button"
        style={styles.header}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span style={styles.chevron} aria-hidden>
          {open ? "▼" : "▶"}
        </span>
        <span style={styles.title}>{title}</span>
        {badge != null && <span style={styles.badgeSlot}>{badge}</span>}
      </button>
      {forceHint && !open && (
        <div style={styles.forceHint}>{forceHint}</div>
      )}
      {/* Keep children mounted when closed so arm phrase panels / forms are not torn down (D-S8). */}
      <div
        style={{
          display: open ? "block" : "none",
          paddingTop: 4,
          paddingBottom: 8,
        }}
        aria-hidden={!open}
      >
        {children}
      </div>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    borderBottom: `1px solid ${tokens.border}`,
    marginBottom: 4,
  },
  header: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 0",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    minHeight: 40,
  },
  chevron: {
    fontSize: 10,
    color: tokens.textMuted,
    width: 12,
    flexShrink: 0,
  },
  title: {
    // Phase 2b — align with SectionHeader (13/600, no 14/700 chrome drift)
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text,
    flex: 1,
    letterSpacing: "-0.01em",
  },
  badgeSlot: {
    flexShrink: 0,
  },
  forceHint: {
    fontSize: 11,
    color: tokens.warning,
    padding: "0 0 6px 20px",
  },
}
