// Composer voice recovery banner — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: same testids, copy, and inline styles as the shipped block.

import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import type { LocalBannerCta } from "../voice/error-map"

export type VoiceBannerProps = {
  banner: string | null | undefined
  engineSwitchNote: string | null
  rawSnapshot: string | null | undefined
  refining: boolean
  voiceBannerCta: LocalBannerCta | null
  onRestoreRaw: () => void
  onSwitchBrowser: () => void
  onOpenSettings: () => void
  onDismiss: () => void
}

export function VoiceBanner({
  banner,
  engineSwitchNote,
  rawSnapshot,
  refining,
  voiceBannerCta,
  onRestoreRaw,
  onSwitchBrowser,
  onOpenSettings,
  onDismiss,
}: VoiceBannerProps) {
  if (!(banner || engineSwitchNote)) return null
  return (
    <div
      data-testid="voice-banner"
      role="status"
      style={{
        marginTop: 6,
        fontSize: 11,
        color: tokens.textSecondary,
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        lineHeight: 1.4,
        flexWrap: "wrap" as const,
      }}
    >
      <span style={{ flex: "1 1 140px", minWidth: 0 }}>
        {engineSwitchNote || banner}
      </span>
      {rawSnapshot &&
      !refining &&
      banner &&
      /纠错|识别原文/.test(banner) &&
      !engineSwitchNote ? (
        <button
          type="button"
          data-testid="voice-cta-restore-raw"
          onClick={() => {
            onRestoreRaw()
          }}
          style={linkBtn}
        >
          还原识别原文
        </button>
      ) : null}
      {voiceBannerCta && !engineSwitchNote ? (
        <button
          type="button"
          data-testid={
            voiceBannerCta.kind === "switch_browser"
              ? "voice-cta-switch-browser"
              : "voice-cta-open-settings"
          }
          onClick={() => {
            if (voiceBannerCta.kind === "switch_browser") {
              onSwitchBrowser()
            } else {
              onOpenSettings()
            }
          }}
          style={linkBtn}
        >
          {voiceBannerCta.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        style={dismissBtn}
      >
        关闭
      </button>
    </div>
  )
}

const linkBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: tokens.accent,
  cursor: "pointer",
  fontSize: 11,
  padding: 0,
  flexShrink: 0,
  textDecoration: "underline",
}

const dismissBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: tokens.textMuted,
  cursor: "pointer",
  fontSize: 11,
  padding: 0,
  flexShrink: 0,
}
