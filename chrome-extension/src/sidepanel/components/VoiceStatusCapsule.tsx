import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import type { CapsuleView } from "../voice/capsule-view"

export function VoiceStatusCapsule(props: {
  view: CapsuleView
  level: number
  extraHint?: string | null
}) {
  const { view, level, extraHint } = props
  if (!view.visible && !extraHint) return null
  const scale = view.useLevel ? 1 + Math.min(0.35, Math.max(0, level) * 0.35) : 1
  const opacity = view.useLevel ? 0.55 + Math.min(0.45, Math.max(0, level) * 0.45) : 1
  const bg =
    view.tone === "red"
      ? "rgba(220, 38, 38, 0.14)"
      : view.tone === "blue"
        ? "rgba(37, 99, 235, 0.14)"
        : tokens.bgMuted
  const fg =
    view.tone === "red" ? tokens.danger : view.tone === "blue" ? tokens.accent : tokens.textSecondary
  const wrap: CSSProperties = {
    position: "relative",
    margin: "0 12px 6px",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${tokens.border}`,
    background: bg,
    color: fg,
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    gap: 8,
    transform: `scale(${scale})`,
    transformOrigin: "left center",
    opacity,
    animation: view.pulse
      ? "cmspark-mic-pulse 1.2s ease-in-out infinite"
      : view.tone === "blue"
        ? "cmspark-mic-pulse 1.6s ease-in-out infinite"
        : undefined,
  }
  return (
    <div style={wrap} role="status">
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
        aria-live="polite"
      >
        {view.live}
        {extraHint ? ` ${extraHint}` : ""}
      </span>
      {view.visible ? <span>{view.label}</span> : null}
      {view.hint ? <span style={{ color: tokens.textMuted, fontSize: 10 }}>{view.hint}</span> : null}
      {extraHint ? <span style={{ color: tokens.textMuted, fontSize: 10 }}>{extraHint}</span> : null}
    </div>
  )
}
