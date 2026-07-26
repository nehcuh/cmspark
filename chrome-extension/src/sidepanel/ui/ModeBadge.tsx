import type { CapabilityLevel } from "../types"
import { tokens } from "./tokens"
import { IconChat, IconGlobe, IconMonitor } from "./icons"

export function ModeBadge({
  level,
  label,
}: {
  level: CapabilityLevel
  label: string
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
  return (
    <span
      role="status"
      aria-live="polite"
      title={`能力层级：${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        padding: "3px 8px 3px 6px",
        borderRadius: tokens.radiusPill,
        background: theme.bg,
        color: theme.color,
        border: theme.border,
        lineHeight: 1,
        flexShrink: 0,
        fontFamily: tokens.font,
      }}
    >
      <Icon size={13} />
      <span>{label}</span>
    </span>
  )
}
