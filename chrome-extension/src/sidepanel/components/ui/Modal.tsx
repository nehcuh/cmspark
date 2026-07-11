// Shared modal/overlay primitive (audit M18).
//
// Wraps useModalDialog (focus trap + Escape + focus restore) and applies the
// dialog ARIA contract (role + aria-modal + aria-label/labelledby) so every
// overlay dialog gets consistent keyboard + screen-reader behavior.
//
// Callers pass their OWN overlay + panel styles (position fixed vs absolute,
// z-index, backdrop color, alignment differ per dialog and are kept verbatim)
// and their panel content as children. The outer overlay receives role/aria and
// the backdrop-dismiss click; the inner panel stops propagation so clicks inside
// don't close the dialog.
//
// NOTE: this is for DIALOGS only — things that take focus and trap it. Popovers
// that should NOT steal focus (e.g. SlashCommandPopover, a combobox/listbox) must
// NOT use this; they need listbox semantics instead. See ARIA guidance in WCAG.

import type { CSSProperties, ReactNode, RefObject } from "react"
import { useModalDialog, type UseModalDialogOptions } from "../../hooks/useModalDialog"

export interface ModalProps {
  /** Gate visibility + focus management. Renders null when false. */
  open: boolean
  /** Called on Escape, and on overlay click when backdropDismiss is true. */
  onClose: () => void
  /** Accessible role. Use "alertdialog" for destructive-action gates. */
  role?: "dialog" | "alertdialog"
  /** Accessible name when there's no visible title to point at. */
  ariaLabel?: string
  /** Accessible name pointing at a visible title element's id. Preferred over ariaLabel. */
  ariaLabelledBy?: string
  /** Click on the overlay/backdrop calls onClose. Default true. */
  backdropDismiss?: boolean
  /** Element to focus on open (passed through to useModalDialog). */
  initialFocusRef?: RefObject<HTMLElement>
  /** Restore focus on close (passed through to useModalDialog). */
  restoreFocus?: boolean
  /** Extra effect deps (e.g. a dialog id) — passed through to useModalDialog. */
  deps?: UseModalDialogOptions["deps"]
  /** Style for the overlay/backdrop element (position, z-index, bg, alignment). */
  overlayStyle?: CSSProperties
  /** Style for the inner panel. */
  panelStyle?: CSSProperties
  /** Extra className on the panel if a caller uses CSS classes. */
  panelClassName?: string
  children: ReactNode
}

export function Modal(props: ModalProps) {
  const {
    open,
    onClose,
    role = "dialog",
    ariaLabel,
    ariaLabelledBy,
    backdropDismiss = true,
    initialFocusRef,
    restoreFocus,
    deps,
    overlayStyle,
    panelStyle,
    panelClassName,
    children,
  } = props

  const overlayRef = useModalDialog({ open, onClose, initialFocusRef, restoreFocus, deps })

  if (!open) return null

  const aria = ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : { "aria-label": ariaLabel }

  return (
    <div
      ref={overlayRef}
      role={role}
      aria-modal="true"
      {...aria}
      style={overlayStyle}
      onClick={backdropDismiss ? onClose : undefined}
    >
      <div style={panelStyle} className={panelClassName} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
