// Reusable modal-dialog behavior: focus trap + Escape-to-close + focus restore.
//
// Extracted 1:1 from the inline effect that shipped in SecurityConfirmationDialog
// (audit H10 / PR #19). Generalized so every overlay dialog (settings, MCP form,
// skill craft, security confirm) shares one correctness-checked implementation
// instead of each rolling its own — or (as most did) shipping with none at all.
//
// The focus-wrap logic lives in two PURE helpers below (getFocusableEdges /
// computeTabWrap) plus the FOCUSABLE_SELECTOR constant, all unit-tested without
// a DOM dep (see tests/use-modal-dialog.test.ts — computeTabWrap is
// identity-based; getFocusableEdges takes a stubbed root; the selector is pinned
// as an exact string). The hook itself is a thin, manually-verified effect shell
// over them (its listener wiring is identical to the effect that shipped in
// SecurityConfirmationDialog PR #19).

import { useEffect, useRef } from "react"

export interface UseModalDialogOptions {
  /** Gate: when false the effect is a no-op (and <Modal> renders null). */
  open: boolean
  /** Invoked on Escape. Use a ref-backed handler (this hook stores the latest). */
  onClose: () => void
  /**
   * Element to focus when the dialog opens. Defaults to the first focusable
   * element inside the overlay. SecurityConfirmationDialog points this at the
   * safe non-destructive action ("拒绝") to preserve its shipped behavior.
   */
  initialFocusRef?: React.RefObject<HTMLElement>
  /** Restore focus to the element that was focused before opening. Default true. */
  restoreFocus?: boolean
  /**
   * Extra deps that re-run the effect (re-trap + re-focus) without toggling
   * `open`. Used by SecurityConfirmationDialog to re-focus on each new
   * confirmation_id while the dialog stays open across a queue.
   */
  deps?: ReadonlyArray<unknown>
}

// Focusable elements inside a modal. Mirrors the original query selector, plus
// textarea/select/link for the broader set of dialogs this now serves.
export const FOCUSABLE_SELECTOR =
  'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Return the first and last focusable elements under `root`, or null if none.
 * Pure + DOM-driven so it can be unit-tested without React.
 */
export function getFocusableEdges(
  root: HTMLElement,
): { first: HTMLElement; last: HTMLElement } | null {
  const list = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  if (!list.length) return null
  return { first: list[0], last: list[list.length - 1] }
}

/**
 * Decide whether a Tab keypress at the edge of the focus cycle should wrap.
 * Returns "first" (move focus to first), "last" (move to last), or null (let
 * the browser handle it natively). Pure for testability.
 */
export function computeTabWrap(
  active: Element | null,
  first: HTMLElement,
  last: HTMLElement,
  shiftKey: boolean,
): "first" | "last" | null {
  if (shiftKey && active === first) return "last"
  if (!shiftKey && active === last) return "first"
  return null
}

export function useModalDialog(opts: UseModalDialogOptions) {
  const overlayRef = useRef<HTMLDivElement>(null)
  // Keep the latest onClose without re-subscribing the listener each render
  // (mirrors the denyRef pattern the security dialog already used).
  const onCloseRef = useRef(opts.onClose)
  onCloseRef.current = opts.onClose

  const { open, initialFocusRef, restoreFocus = true, deps = [] } = opts

  useEffect(() => {
    if (!open) return
    const overlay = overlayRef.current
    if (!overlay) return

    const prevFocus = document.activeElement as HTMLElement | null

    // Initial focus: caller-specified element, else first focusable in the overlay.
    if (initialFocusRef?.current) {
      initialFocusRef.current.focus()
    } else {
      const edges = getFocusableEdges(overlay)
      edges?.first.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key === "Tab") {
        const edges = getFocusableEdges(overlay)
        if (!edges) return
        const wrap = computeTabWrap(document.activeElement, edges.first, edges.last, e.shiftKey)
        if (wrap === "last") {
          e.preventDefault()
          edges.last.focus()
        } else if (wrap === "first") {
          e.preventDefault()
          edges.first.focus()
        }
      }
    }

    overlay.addEventListener("keydown", onKeyDown)
    return () => {
      overlay.removeEventListener("keydown", onKeyDown)
      if (restoreFocus) prevFocus?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFocusRef, ...deps])

  return overlayRef
}
