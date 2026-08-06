import type { CSSProperties } from "react"
import { IconMic, IconMicOff } from "../ui/icons"
import { tokens } from "../ui/tokens"

export function VoiceMicButton(props: {
  listening: boolean
  disabled?: boolean
  title: string
  onClick: () => void
  style?: CSSProperties
}) {
  const { listening, disabled, title, onClick, style } = props
  return (
    <button
      type="button"
      data-testid="voice-mic-btn"
      aria-label={listening ? "结束语音输入" : "语音输入"}
      aria-pressed={listening}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        width: 34,
        height: 34,
        borderRadius: tokens.radiusMd,
        border: listening ? `1px solid ${tokens.danger}` : "none",
        background: listening ? "rgba(220, 38, 38, 0.12)" : "transparent",
        color: disabled
          ? tokens.textMuted
          : listening
            ? tokens.danger
            : tokens.textSecondary,
        cursor: disabled ? "not-allowed" : "pointer",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        opacity: disabled ? 0.45 : 1,
        animation: listening ? "cmspark-mic-pulse 1.2s ease-in-out infinite" : undefined,
        ...style,
      }}
    >
      {disabled && !listening ? <IconMicOff size={16} /> : <IconMic size={16} />}
    </button>
  )
}
