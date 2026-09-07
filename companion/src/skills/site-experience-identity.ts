import { createHash } from "node:crypto"

/** Versioned, bounded filename identity. Keep punctuation significant; replacing
 * dots with hyphens aliases a.b-c with a-b.c. Metadata is still checked on read
 * and write, so even an occupied identifier never authorizes a foreign append. */
export function siteExperienceIdentity(site: string): { host: string; id: string; legacyId: string } {
  const url = new URL(site.includes("://") ? site : `https://${site}`)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Site experience requires HTTP(S)")
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (!host) throw new Error("Site experience requires a hostname")
  return {
    host,
    id: `site-exp-v1-${createHash("sha256").update(host).digest("hex")}`,
    // Historical producer used the canonical origin's host, including a
    // non-default port. Preserve that key when the caller knows the origin.
    legacyId: url.host.toLowerCase().replace(/^www\./, "").replace(/\./g, "-"),
  }
}

interface ExperienceDocument {
  type: string
  site?: string
  tags?: string[]
}

function matchesSiteExperience(doc: ExperienceDocument | undefined, site: string, legacyRead = false): boolean {
  if (!doc || doc.type !== "site_knowledge" || (!legacyRead && !doc.tags?.includes("auto")) || !doc.tags?.includes("site-op-memory") || !doc.site) return false
  try {
    // Wildcard/manual/general knowledge must never become an automatic write target.
    if (doc.site.includes("*") || doc.site.includes(",")) return false
    return siteExperienceIdentity(doc.site).host === siteExperienceIdentity(site).host
  } catch {
    return false
  }
}

export function isOwnedSiteExperience(doc: ExperienceDocument | undefined, site: string): boolean {
  return matchesSiteExperience(doc, site)
}

/** Read-through migration: retain old documents unchanged, but accept only
 * metadata-bound automatic experience. New writes always use the v1 identity. */
export function readSiteExperienceEntries<T extends { content: string }>(
  site: string,
  get: (id: string) => (ExperienceDocument & { entries?: T[] }) | undefined,
): T[] {
  const identity = siteExperienceIdentity(site)
  const entries = new Map<string, T>()
  for (const id of [identity.id, identity.legacyId]) {
    const doc = get(id)
    // 63aa4c63 originally wrote ["site-op-memory"]; 6e6bd20d added "auto".
    // Accept the historical marker only for legacy reads, never v1 writes.
    if (!matchesSiteExperience(doc, site, id === identity.legacyId)) continue
    for (const entry of doc?.entries || []) {
      if (!entries.has(entry.content)) entries.set(entry.content, entry)
    }
  }
  return [...entries.values()]
}
