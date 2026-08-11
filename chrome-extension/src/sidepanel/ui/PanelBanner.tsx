// Unified strip banner for empty / error / disconnected (Phase 3 polish).
// Tone maps to tokens only — no ad-hoc hex.

import type { CSSProperties, ReactNode } from "react"
import { tokens } from "./tokens"

export type PanelBannerTone = "warning" | "danger" | "info" | "neutral"

const toneSurface: Record<
  PanelBannerTone,
  { bg: string; border: string; iconBg: string }
> = {
  warning: {
    bg: tokens.warningSoft,
    border: tokens.warning,
    iconBg: tokens.bgElevated,
  },
  danger: {
    bg: tokens.dangerSoft,
    border: tokens.danger,
    iconBg: tokens.bgElevated,
  },
  info: {
    bg: tokens.accentSoft,
    border: tokens.accent,
    iconBg: tokens.bgElevated,
  },
  neutral: {
    bg: tokens.bgMuted,
    border: tokens.borderStrong,
    iconBg: tokens.bgElevated,
  },
}

export function PanelBanner({
  tone = "warning",
  title,
  children,
  icon,
  actions,
  role = "alert",
}: {
  tone?: PanelBannerTone
  title: string
  children?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  role?: "alert" | "status"
}) {
  const t = toneSurface[tone]
  return (
    <div
      style={{
        ...styles.container,
        background: t.bg,
        borderBottom: `1px solid ${t.border}`,
      }}
      role={role}
    >
      {icon != null && (
        <div
          style={{
            ...styles.iconWrap,
            background: t.iconBg,
            border: `1px solid ${t.border}`,
          }}
        >
          {icon}
        </div>
      )}
      <div style={styles.content}>
        <h3 style={styles.title}>{title}</h3>
        {children != null && <div style={styles.body}>{children}</div>}
        {actions != null && <div style={styles.actions}>{actions}</div>}
      </div>
    </div>
  )
}

/** Shared primary/secondary buttons for banner actions */
export const panelBannerBtnStyles: Record<string, CSSProperties> = {
  primary: {
    padding: "6px 12px",
    borderRadius: tokens.radiusSm,
    border: "none",
    background: tokens.accent,
    color: tokens.userBubbleText,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: tokens.font,
  },
  secondary: {
    padding: "6px 12px",
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: tokens.font,
  },
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    flexShrink: 0,
    fontFamily: tokens.font,
  },
  iconWrap: {
    flexShrink: 0,
    marginTop: 1,
    width: 32,
    height: 32,
    borderRadius: tokens.radiusMd,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    margin: "0 0 4px",
    fontSize: 13,
    fontWeight: 650,
    color: tokens.text,
  },
  body: {
    margin: "0 0 10px",
    fontSize: 12,
    color: tokens.textSecondary,
    lineHeight: 1.5,
  },
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
}
