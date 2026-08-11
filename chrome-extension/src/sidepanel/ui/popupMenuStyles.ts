// Shared popup menu chrome — StatusRail ⋯ and ThreadList ⋯ (Phase 2b density).
// Keep padding / type / radius in lock-step.

import type { CSSProperties } from "react"
import { tokens } from "./tokens"

export const popupMenuStyles: Record<string, CSSProperties> = {
  menu: {
    minWidth: 200,
    maxHeight: 360,
    overflowY: "auto",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusMenu,
    boxShadow: tokens.shadowLg,
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    fontFamily: tokens.font,
  },
  menuItem: {
    border: "none",
    background: "transparent",
    borderRadius: tokens.radiusMd,
    padding: "9px 11px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 9,
    color: tokens.text,
    textAlign: "left",
    width: "100%",
    fontFamily: tokens.font,
  },
  menuDivider: {
    height: 1,
    background: tokens.border,
    margin: "5px 8px",
  },
  /** Icon trigger (⋯) matching StatusRail iconBtn density */
  menuTrigger: {
    width: 32,
    height: 32,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: tokens.shadowSm,
    fontSize: 14,
    lineHeight: 1,
    fontFamily: tokens.font,
    transition: `background ${tokens.transitionFast}, border-color ${tokens.transitionFast}`,
  },
}
