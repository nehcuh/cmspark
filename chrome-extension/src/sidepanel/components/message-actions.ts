// Message action-bar visibility policy (#321 PR-6 — 消息行降噪).
//
// Pure decision helpers so the hover/coarse/last-message matrix is unit-testable
// without a DOM. The gating itself lives in CSS (`.cmspark-msg-actions` — see
// quietActionsCSS in ChatView.tsx): hidden bars use opacity 0 + pointer-events
// none, NEVER display:none / visibility:hidden, so the buttons stay in the tab
// order and :focus-within genuinely reveals the bar (keyboard reachability is a
// hard acceptance of this slice).

export type MessageActionMode = "gated" | "persistent" | "coarse"

/**
 * Which action-bar presentation a message row uses:
 * - "coarse": touch / no reliable hover → one always-visible ⋯ per message that
 *   expands the full action set inline (hard acceptance: the sidebar is often
 *   touch-driven)
 * - "persistent": last message keeps its bar visible (hover unnecessary)
 * - "gated": hover or keyboard focus reveals the bar
 */
export function messageActionMode(opts: { coarse: boolean; isLast: boolean }): MessageActionMode {
  if (opts.coarse) return "coarse"
  if (opts.isLast) return "persistent"
  return "gated"
}

/**
 * Coarse-pointer probe (media query, per spec). Injectable window for tests;
 * fail-closed to fine pointer (hover gating) when matchMedia is unavailable.
 */
export function isCoarsePointer(
  win: { matchMedia?: (query: string) => { matches: boolean } } = typeof window !== "undefined"
    ? window
    : {},
): boolean {
  try {
    return win.matchMedia?.("(pointer: coarse)")?.matches === true
  } catch {
    return false
  }
}
