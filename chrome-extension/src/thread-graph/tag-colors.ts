// Stable tag → color groups for thread graph (Obsidian-like "颜色组").
// Pure helpers — no DOM / chrome APIs.

/** Soft pastel dots that read well on near-black canvas. */
export const TAG_PALETTE = [
  "#6b9fff", // blue
  "#f472b6", // pink
  "#34d399", // green
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#e879f9", // fuchsia
  "#4ade80", // lime
  "#94a3b8", // slate (fallback-ish)
] as const

export const UNTAGGED_COLOR = "#64748b"
export const UNTAGGED_LABEL = "未标注"

/** FNV-1a-ish stable hash for string → palette index. */
export function hashTag(tag: string): number {
  const s = tag.trim().toLowerCase()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function colorForTag(tag: string | null | undefined): string {
  if (!tag || !tag.trim()) return UNTAGGED_COLOR
  const i = hashTag(tag) % TAG_PALETTE.length
  return TAG_PALETTE[i]
}

/** Primary tag = first non-empty digest tag (stable assignment source). */
export function primaryTag(tags: string[] | undefined | null): string | null {
  if (!tags || tags.length === 0) return null
  for (const t of tags) {
    const s = (t || "").trim()
    if (s) return s
  }
  return null
}

export type ColorGroup = {
  tag: string
  color: string
  count: number
}

/**
 * Build per-node color map + legend groups (sorted by count desc, then tag).
 * `nodeIds` limits which threads appear in the legend counts.
 */
export function buildTagColorIndex(
  threads: Array<{ id: string; digest?: { tags?: string[] } | null }>,
  nodeIds?: Set<string> | string[],
): {
  colorById: Map<string, string>
  tagById: Map<string, string | null>
  groups: ColorGroup[]
} {
  const allow =
    nodeIds == null
      ? null
      : nodeIds instanceof Set
        ? nodeIds
        : new Set(nodeIds)

  const colorById = new Map<string, string>()
  const tagById = new Map<string, string | null>()
  const counts = new Map<string, number>()

  for (const t of threads) {
    if (allow && !allow.has(t.id)) continue
    const tag = primaryTag(t.digest?.tags)
    const key = tag ?? UNTAGGED_LABEL
    tagById.set(t.id, tag)
    colorById.set(t.id, colorForTag(tag))
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const groups: ColorGroup[] = [...counts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      color: tag === UNTAGGED_LABEL ? UNTAGGED_COLOR : colorForTag(tag),
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh"))

  return { colorById, tagById, groups }
}

/** Lighten hex for focus/hover (simple channel blend toward white). */
export function lightenHex(hex: string, amount = 0.35): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount))
  const to = (c: number) => c.toString(16).padStart(2, "0")
  return `#${to(mix(r))}${to(mix(g))}${to(mix(b))}`
}

/** Apply alpha to #rrggbb → rgba(). */
export function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r},${g},${b},${a})`
}
