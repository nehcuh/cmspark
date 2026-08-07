import type { CSSProperties } from "react"
import { IconMic, IconMicOff, IconSpinner } from "../ui/icons"
import { tokens } from "../ui/tokens"

export function VoiceMicButton(props: {
  listening: boolean
  /** Local STT upload/infer — spinner chrome; cancel still via onClick. */
  processing?: boolean
  disabled?: boolean
  title: string
  /** Override aria-label (defaults from listening/processing). */
  ariaLabel?: string
  onClick: () => void
  style?: CSSProperties
  /**
   * Compact remaining/elapsed badge while local listening (e.g. "0:32").
   * Rendered on the mic — not a permanent third status row.
   */
  timerLabel?: string | null
  /**
   * Polite live region for local listen/processing status
   * (timer + “结束后本机识别” / “本机识别中…”).
   */
  liveStatus?: string | null
}) {
  const {
    listening,
    processing = false,
    disabled,
    title,
    ariaLabel,
    onClick,
    style,
    timerLabel,
    liveStatus,
  } = props

  const active = listening || processing
  const defaultAria = processing
    ? "本机识别中，点击取消"
    : listening
      ? "结束语音输入"
      : "语音输入"

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        data-testid="voice-mic-btn"
        data-processing={processing ? "true" : undefined}
        aria-label={ariaLabel || defaultAria}
        aria-pressed={active}
        aria-busy={processing || undefined}
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
          border: active ? `1px solid ${tokens.danger}` : "none",
          background: active ? "rgba(220, 38, 38, 0.12)" : "transparent",
          color: disabled
            ? tokens.textMuted
            : active
              ? tokens.danger
              : tokens.textSecondary,
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: disabled ? 0.45 : 1,
          animation:
            listening && !processing
              ? "cmspark-mic-pulse 1.2s ease-in-out infinite"
              : undefined,
          ...style,
        }}
      >
        {processing ? (
          <IconSpinner size={16} />
        ) : disabled && !active ? (
          <IconMicOff size={16} />
        ) : (
          <IconMic size={16} />
        )}
      </button>
      {timerLabel && listening && !processing ? (
        <span
          data-testid="voice-mic-timer"
          aria-hidden
          style={{
            position: "absolute",
            right: -2,
            bottom: -4,
            fontSize: 9,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: tokens.danger,
            background: tokens.bgElevated,
            borderRadius: 3,
            padding: "1px 2px",
            pointerEvents: "none",
            border: `1px solid ${tokens.border}`,
          }}
        >
          {timerLabel}
        </span>
      ) : null}
      {liveStatus ? (
        <span
          data-testid="voice-mic-live"
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {liveStatus}
        </span>
      ) : null}
    </span>
  )
}
