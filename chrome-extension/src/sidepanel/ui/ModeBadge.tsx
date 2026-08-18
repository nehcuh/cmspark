import type { CSSProperties } from "react"
import type { CapabilityLevel } from "../types"
import { tokens } from "./tokens"
import { IconChat, IconGlobe, IconMonitor, IconPin } from "./icons"

export function ModeBadge({
  level,
  label,
  pinned,
  onTogglePin,
  whisper,
}: {
  level: CapabilityLevel
  label: string
  pinned?: boolean
  onTogglePin?: () => void
  /** Icon-only whisper for 320px rail (S0.2). */
  whisper?: boolean
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

  const Icon = whisper ? IconPin : theme.Icon
  const pinTitle = pinned
    ? `已钉住「${label}」— 点击取消，允许自动降级`
    : `钉住「${label}」— 阻止自动降级`

  const style: CSSProperties = whisper
    ? {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        border: "none",
        borderRadius: tokens.radiusMd,
        background: pinned ? tokens.accentSoft : "transparent",
        color: pinned ? tokens.accentText : tokens.text,
        lineHeight: 1,
        flexShrink: 0,
        fontFamily: tokens.font,
        cursor: onTogglePin ? "pointer" : "default",
      }
    : {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
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
        aria-label={pinTitle}
        onClick={onTogglePin}
        style={{ ...style, appearance: "none" as const }}
      >
        <Icon size={whisper ? 18 : 13} />
        {!whisper && <span>{label}</span>}
        {!whisper && pinned && (
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
      {!whisper && <span>{label}</span>}
    </span>
  )
}
