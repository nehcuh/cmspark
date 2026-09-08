/** Human labels are independent of the rebuildable AI digest. */
export function sanitizeUserTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(tag => typeof tag !== "string")) {
    throw new Error("user_tags must be an array of at most 20 strings")
  }
  const seen = new Set<string>()
  return value.map(tag => tag.normalize("NFC").replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40))
    .filter(tag => {
      const key = tag.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
