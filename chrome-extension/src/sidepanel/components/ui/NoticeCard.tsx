// Shared notice-card primitive (#321 PR-6 — 消息行降噪).
//
// One shell for every compact notice strip in the chat column: the four-variant
// context-budget banner (shrink / unknown / prompt / compacted) and the
// ToolCallCard inset notices (#322 settings pointer, warning userHint) previously
// each rolled their own style object — including the pre-PR-1 #7a5b00 warning
// text, now folded into the warning token family (warningSoft / warning /
// warningText / warningBorder).
//
// Red line (FINAL-SYNTHESIS §1.1-5): a NoticeCard is ALWAYS fully visible when
// mounted — this primitive has no collapsed state and must never grow one.
// Failure / security disclosure (userHint, SEC-C) rides it precisely because
// nothing here can default-fold.

import type { CSSProperties, ReactNode } from "react"
import { tokens } from "../../ui/tokens"

export type NoticeTone = "warning" | "info" | "danger" | "muted"

export interface NoticeCardProps {
  /** Visual family. "warning" = context-budget / userHint amber family. */
  tone?: NoticeTone
  /** ARIA role; notices are live-ish status strips ("status" by default). */
  role?: string
  /** data-testid passthrough (callers keep their stable ids). */
  testId?: string
  /** Merged over the base+tone style (inset sizing, flex, margins…). */
  style?: CSSProperties
  children: ReactNode
}

const toneStyles: Record<NoticeTone, CSSProperties> = {
  warning: {
    background: tokens.warningSoft,
    borderLeft: `2px solid ${tokens.warning}`,
    color: tokens.warningText,
  },
  info: {
    background: tokens.accentSoft,
    borderLeft: `2px solid ${tokens.accent}`,
    color: tokens.text,
  },
  danger: {
    background: tokens.dangerSoft,
    borderLeft: `2px solid ${tokens.danger}`,
    color: tokens.text,
  },
  muted: {
    background: tokens.bgMuted,
    borderLeft: `2px solid ${tokens.borderStrong}`,
    color: tokens.textSecondary,
  },
}

export function NoticeCard({
  tone = "warning",
  role = "status",
  testId,
  style,
  children,
}: NoticeCardProps) {
  return (
    <div
      role={role}
      data-testid={testId}
      style={{
        margin: "8px 10px 4px",
        padding: "8px 10px",
        borderRadius: tokens.radiusMd,
        border: `1px solid ${tokens.border}`,
        fontSize: 11,
        lineHeight: 1.45,
        fontFamily: tokens.font,
        ...toneStyles[tone],
        ...style,
      }}
    >
      {children}
    </div>
  )
}
