export type RunProgressViewItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
}

export function defaultExpanded(itemCount: number): boolean {
  return itemCount >= 1 && itemCount <= 3
}

export function skipHeaderChrome(items: RunProgressViewItem[]): boolean {
  return items.length === 1 && items[0]!.source !== "model_draft"
}

export function countNM(items: RunProgressViewItem[]): { n: number; m: number } {
  let n = 0
  let m = 0
  for (const it of items) {
    if (it.source === "model_draft") continue
    m += 1
    if (it.done === true) n += 1
  }
  return { n, m }
}

export function previewText(items: RunProgressViewItem[]): string | null {
  const current = items.find((it) => it.done !== true && it.source !== "model_draft")
  if (current) return current.text
  const draft = items.find((it) => it.source === "model_draft")
  return draft ? `草稿 · ${draft.text}` : null
}
