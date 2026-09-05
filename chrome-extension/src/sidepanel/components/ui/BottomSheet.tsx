// Shared bottom-sheet primitive (#321 PR-5 — Sheet 家族统一).
//
// One shell for every bottom-anchored sheet: scrim backdrop + top-rounded
// elevated panel + drag handle, built on ui/Modal so focus trap / Escape /
// focus restore come from the same audited path (useModalDialog) everywhere.
// ComposeDrawer is the reference consumer; KnowledgeImportModal and
// VoicePrivacySheet migrated onto this in PR-5.
//
// Callers keep their per-surface overrides (z-index, scrim strength, panel
// padding/maxHeight) via overlayStyle/sheetStyle, merged OVER the defaults.

import type { CSSProperties, ReactNode, RefObject } from "react"
import { tokens } from "../../ui/tokens"
import { Modal } from "./Modal"

export interface BottomSheetProps {
  /** Gate visibility + focus management. Renders null when false. */
  open: boolean
  /** Called on Escape (and on backdrop click unless backdropDismiss=false). */
  onClose: () => void
  /** Accessible name when there's no visible title to point at. */
  ariaLabel?: string
  /** Accessible name pointing at a visible title element's id. Preferred. */
  ariaLabelledBy?: string
  /** Click on the scrim calls onClose. Default true. */
  backdropDismiss?: boolean
  /** Element to focus on open (passed through to useModalDialog). */
  initialFocusRef?: RefObject<HTMLElement>
  /** Restore focus on close (passed through to useModalDialog). */
  restoreFocus?: boolean
  /** Render the top drag handle. Default true. */
  showHandle?: boolean
  /** Merged over the default scrim style (z-index, scrim color, …). */
  overlayStyle?: CSSProperties
  /** Merged over the default sheet style (padding, maxHeight, …). */
  sheetStyle?: CSSProperties
  children: ReactNode
}

const defaultOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 250,
  background: tokens.scrim,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
}

const defaultSheet: CSSProperties = {
  background: tokens.bgElevated,
  borderTopLeftRadius: tokens.radiusSheet,
  borderTopRightRadius: tokens.radiusSheet,
  boxShadow: tokens.shadowLg,
  maxHeight: "78vh",
  overflowY: "auto",
  padding: "10px 0 18px",
  fontFamily: tokens.font,
  width: "100%",
}

const handleStyle: CSSProperties = {
  width: 36,
  height: 4,
  borderRadius: tokens.radiusPill,
  background: tokens.borderStrong,
  margin: "2px auto 12px",
}

export function BottomSheet({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  backdropDismiss = true,
  initialFocusRef,
  restoreFocus,
  showHandle = true,
  overlayStyle,
  sheetStyle,
  children,
}: BottomSheetProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      role="dialog"
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      backdropDismiss={backdropDismiss}
      initialFocusRef={initialFocusRef}
      restoreFocus={restoreFocus}
      overlayStyle={{ ...defaultOverlay, ...overlayStyle }}
      panelStyle={{ ...defaultSheet, ...sheetStyle }}
    >
      {showHandle ? <div style={handleStyle} aria-hidden /> : null}
      {children}
    </Modal>
  )
}
