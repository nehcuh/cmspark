// ComposerDock context chips — mode-aware, ≤3 (UIUX v2 §4.4).
// Opens Host / 装配 / 确认台; never Abort (thumb-zone safety).

import type { CSSProperties } from "react"
import type { CapabilityLevel } from "../types"
import {
  composerChipsForLevel,
  type ComposerChip,
  type ComposerChipAction,
} from "../composer/meta-slash"
import { tokens } from "../ui/tokens"

export type ComposerChipsProps = {
  capabilityLevel: CapabilityLevel
  onAction: (action: ComposerChipAction) => void
}

export function ComposerChips({ capabilityLevel, onAction }: ComposerChipsProps) {
  const chips = composerChipsForLevel(capabilityLevel)
  if (chips.length === 0) return null

  return (
    <div
      style={styles.row}
      role="toolbar"
      aria-label="组合快捷入口"
      data-testid="composer-chips"
    >
      {chips.map((chip) => (
        <ChipButton key={chip.id} chip={chip} onAction={onAction} />
      ))}
    </div>
  )
}

function ChipButton({
  chip,
  onAction,
}: {
  chip: ComposerChip
  onAction: (action: ComposerChipAction) => void
}) {
  return (
    <button
      type="button"
      style={{
        ...styles.chip,
        ...(chip.primary ? styles.chipPrimary : null),
      }}
      onClick={() => onAction(chip.action)}
      data-testid={`composer-chip-${chip.id}`}
      title={chip.label}
    >
      {chip.label}
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "0 0 10px",
    alignItems: "center",
  },
  chip: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusPill,
    background: "rgba(255, 255, 255, 0.85)",
    color: tokens.textSecondary,
    fontSize: 11,
    fontWeight: 550,
    padding: "5px 12px",
    cursor: "pointer",
    fontFamily: tokens.font,
    lineHeight: 1.3,
    letterSpacing: "0.01em",
    boxShadow: tokens.shadowSm,
  },
  chipPrimary: {
    borderColor: "rgba(79, 70, 229, 0.22)",
    background: tokens.accentSoft,
    color: tokens.accentText,
    fontWeight: 650,
    boxShadow: "0 1px 3px rgba(79, 70, 229, 0.12)",
  },
}
