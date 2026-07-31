import type { CSSProperties } from "react"
import type { CapabilityLevel } from "../types"
import { tokens } from "./tokens"
import { IconChat, IconGlobe, IconMonitor } from "./icons"

export function ModeBadge({
  level,
  label,
  pinned,
  onTogglePin,
}: {
  level: CapabilityLevel
  label: string
  pinned?: boolean
  onTogglePin?: () => void
}) {
  const theme =
    level === "computer"
      ? {
          bg: tokens.modeComputerBg,
          color: tokens.modeComputerText,
          border: "1px solid #14532d",
          Icon: IconMonitor,
        }
      : level === "browser"
        ? {
            bg: tokens.modeBrowserBg,
            color: tokens.modeBrowserText,
            border: "1px solid #bfdbfe",
            Icon: IconGlobe,
          }
        : {
            bg: tokens.modeChatBg,
            color: tokens.modeChatText,
            border: "1px solid #e5e7eb",
            Icon: IconChat,
          }

  const Icon = theme.Icon
  const pinTitle = pinned
    ? `能力层级：${label}（已钉住 — 点击取消钉住，允许自动降级）`
    : `能力层级：${label}（点击钉住当前层级，阻止自动降级）`

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 650,
    letterSpacing: "0.02em",
    padding: "4px 10px 4px 7px",
    borderRadius: tokens.radiusPill,
    background: theme.bg,
    color: theme.color,
    border: pinned ? `1.5px solid ${tokens.accent}` : theme.border,
    lineHeight: 1,
    flexShrink: 0,
    fontFamily: tokens.font,
    cursor: onTogglePin ? "pointer" : "default",
    boxShadow: pinned
      ? `0 0 0 3px ${tokens.accentSoft}`
      : "0 1px 2px rgba(15, 23, 42, 0.04)",
    transition: `box-shadow ${tokens.transitionFast} ease, border-color ${tokens.transitionFast} ease`,
  }

  if (onTogglePin) {
    return (
      <button
        type="button"
        role="status"
        aria-live="polite"
        aria-pressed={!!pinned}
        title={pinTitle}
        onClick={onTogglePin}
        style={{ ...style, appearance: "none" as const }}
      >
        <Icon size={13} />
        <span>{label}</span>
        {pinned && (
          <span style={{ fontSize: 9, opacity: 0.9 }} aria-hidden>
            钉
          </span>
        )}
      </button>
    )
  }

  return (
    <span role="status" aria-live="polite" title={`能力层级：${label}`} style={style}>
      <Icon size={13} />
      <span>{label}</span>
    </span>
  )
}
