// Pure Cockpit StatusRail helpers (UIUX v2 PR7) — no React / chrome.

/** Cockpit mode chip copy — same Surface grammar as Panel ModeBadge (L2 · LIVE). */
export function cockpitModeBadgeLabel(opts: {
  live: boolean
  hasTask: boolean
  hasConfirm: boolean
}): string {
  if (opts.live) return "L2 · LIVE"
  if (opts.hasTask) return "L2"
  if (opts.hasConfirm) return "确认"
  return "工作区"
}
