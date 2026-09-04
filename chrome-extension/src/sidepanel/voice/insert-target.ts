// #258 tier-2 insert target (pure). Content script + panel share this.

export const PAGE_INSERT_FALLBACK_HINT = "已插入侧栏输入框"

export type InsertSource = "page" | "sidepanel"
export type InsertTarget = "page" | "composer"

export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false
  const tag = (el.tagName || "").toUpperCase()
  if (tag === "INPUT" || tag === "TEXTAREA") return true
  return el.isContentEditable === true
}

export function decideInsertTarget(opts: {
  source: InsertSource
  pageEditable: boolean
}): InsertTarget {
  if (opts.source === "page" && opts.pageEditable) return "page"
  return "composer"
}
