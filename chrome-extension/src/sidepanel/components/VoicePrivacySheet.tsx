// 麦克风隐私确认 sheet (v1 浏览器听写 / v2 本机转写 / v3 连续听写+ASR 纠错).
// Cut out of App.tsx InputArea in #321 PR-5: was an inline composer block, now
// rides the shared BottomSheet primitive (ui/Modal → useModalDialog), so the
// consent gate gets focus trap + Escape-to-cancel + focus restore for free.
// Escape and scrim click both take the 取消 path (dismiss only, never ack).
// Copy is NOT here — v1/v2/v3 bodies live in voice/privacy-copy.ts (verbatim,
// privacy-reviewed); this component only picks by kind. Button visuals are the
// shipped attachBtn/sendBtn-derived styles, preserved 1:1.

import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { BottomSheet } from "./ui/BottomSheet"
import { voicePrivacyBodyForKind, type VoicePrivacyKind } from "../voice/privacy-copy"

export type VoicePrivacySheetProps = {
  open: boolean
  kind: VoicePrivacyKind
  /** Dismiss without acking (取消 / Escape / scrim click). */
  onCancel: () => void
  /** 同意并继续 — caller acks the right version and starts voice. */
  onAgree: () => void
}

export function VoicePrivacySheet({ open, kind, onCancel, onAgree }: VoicePrivacySheetProps) {
  return (
    <BottomSheet open={open} onClose={onCancel} ariaLabel="麦克风隐私说明">
      <div
        data-testid="voice-privacy-sheet"
        style={{
          padding: "0 14px",
          fontSize: 12,
          lineHeight: 1.5,
          color: tokens.textSecondary,
        }}
      >
        <div
          style={{
            marginBottom: 8,
            color: tokens.text,
            whiteSpace: "pre-wrap" as const,
          }}
        >
          {voicePrivacyBodyForKind(kind)}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={styles.cancelBtn} onClick={onCancel}>
            取消
          </button>
          <button type="button" style={styles.agreeBtn} onClick={onAgree}>
            同意并继续
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

// Computed results of the shipped overrides (…attachBtn/sendBtn + per-button
// extras), inlined so this component no longer depends on App.tsx styles.
const styles: Record<string, CSSProperties> = {
  cancelBtn: {
    height: 32,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: "transparent",
    color: tokens.textSecondary,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: tokens.font,
  },
  agreeBtn: {
    height: 32,
    borderRadius: tokens.radiusPill,
    border: "none",
    background: tokens.sendDisabledBg,
    color: tokens.userBubbleText,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 12px",
    fontSize: 12,
    boxShadow: "none",
    fontFamily: tokens.font,
  },
}
