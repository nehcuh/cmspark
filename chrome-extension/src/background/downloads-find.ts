/**
 * downloads.find — read-only search of completed Chrome downloads (#au4dch DL-1).
 * Prefer over re-clicking browser_download when the file already exists.
 *
 * Security (adversarial B1): only return paths whose path contains a common
 * Downloads folder segment (`Downloads` / `下载`). This is a lightweight
 * name-segment allowlist (not OS realpath of the official Downloads dir);
 * paths under Desktop/Documents without that segment are dropped.
 */

export type DownloadsSearchApi = {
  search(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]>
}

export type FindDownloadsParams = {
  filenameHint?: string
  urlContains?: string
  limit?: number
  /** Injectable for tests */
  __downloadsApi?: DownloadsSearchApi
  /** Injectable Downloads root segments / absolute prefixes (tests). */
  __downloadsRoots?: string[]
}

export type FoundDownload = {
  id: number
  path: string
  filename: string
  bytes: number
  url: string
  endTime?: string
  source: "cache"
}

export type ToolResult = { success: boolean; data?: any; error?: string }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Strip query/hash from URL before returning to LLM (presigned URL hygiene). */
export function redactDownloadUrl(url: string): string {
  if (!url) return ""
  try {
    const u = new URL(url)
    u.search = ""
    u.hash = ""
    return u.toString()
  } catch {
    const q = url.indexOf("?")
    return q >= 0 ? url.slice(0, q) : url
  }
}

/**
 * True if absolute path is under a user Downloads directory.
 * Accepts common folder names: Downloads, 下载 (zh-CN).
 * Fail-closed: unknown / empty path → false.
 */
export function isPathUnderDownloads(
  filePath: string,
  extraRoots?: string[],
): boolean {
  if (!filePath || typeof filePath !== "string") return false
  const norm = filePath.replace(/\\/g, "/").toLowerCase()
  // Path segment check (default Chrome Downloads + zh-CN)
  const segments = norm.split("/").filter(Boolean)
  if (segments.includes("downloads") || segments.includes("下载")) return true
  if (extraRoots && extraRoots.length) {
    for (const root of extraRoots) {
      if (!root) continue
      const r = root.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
      if (r && (norm === r || norm.startsWith(r + "/"))) return true
    }
  }
  return false
}

/**
 * Pure filter used by find + prefer_existing (unit-tested without chrome).
 */
export function filterCompletedDownloads(
  items: Array<{
    id: number
    filename?: string
    url?: string
    state?: string
    exists?: boolean
    fileSize?: number
    totalBytes?: number
    endTime?: string
    startTime?: string
  }>,
  opts: {
    filenameHint?: string
    urlContains?: string
    limit: number
    downloadsRoots?: string[]
  },
): FoundDownload[] {
  const fh = (opts.filenameHint || "").trim().toLowerCase()
  const uc = (opts.urlContains || "").trim().toLowerCase()
  const out: FoundDownload[] = []
  for (const item of items) {
    if (item.state && item.state !== "complete") continue
    if (item.exists === false) continue
    const path = item.filename || ""
    if (!path) continue
    // B1: refuse out-of-Downloads absolute paths
    if (!isPathUnderDownloads(path, opts.downloadsRoots)) continue
    const base = path.split(/[/\\]/).pop() || path
    if (fh && !path.toLowerCase().includes(fh) && !base.toLowerCase().includes(fh)) continue
    if (uc && !(item.url || "").toLowerCase().includes(uc)) continue
    out.push({
      id: item.id,
      path,
      filename: base,
      bytes: item.fileSize ?? item.totalBytes ?? 0,
      url: redactDownloadUrl(item.url || ""),
      endTime: item.endTime || item.startTime,
      source: "cache",
    })
    if (out.length >= opts.limit) break
  }
  return out
}

export async function runDownloadsFind(params: FindDownloadsParams): Promise<ToolResult> {
  const filenameHint =
    typeof params.filenameHint === "string" && params.filenameHint.trim()
      ? params.filenameHint.trim()
      : undefined
  const urlContains =
    typeof params.urlContains === "string" && params.urlContains.trim()
      ? params.urlContains.trim()
      : undefined
  if (!filenameHint && !urlContains) {
    return {
      success: false,
      error: "downloads.find requires filenameHint and/or urlContains",
      data: { error_code: "HINT_REQUIRED" },
    }
  }
  let limit = 5
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    limit = Math.min(20, Math.max(1, Math.floor(params.limit)))
  }

  const api: DownloadsSearchApi =
    params.__downloadsApi ||
    (typeof chrome !== "undefined" && chrome.downloads
      ? chrome.downloads
      : (null as any))
  if (!api?.search) {
    return {
      success: false,
      error: "downloads API unavailable",
      data: { error_code: "DOWNLOADS_API_UNAVAILABLE" },
    }
  }

  const query: chrome.downloads.DownloadQuery = {
    state: "complete",
    exists: true,
    orderBy: ["-startTime"],
    limit: 50,
  }
  // Chrome filenameRegex is RE2-ish; escape literal hints.
  if (filenameHint) {
    query.filenameRegex = escapeRegExp(filenameHint)
  }

  let items: chrome.downloads.DownloadItem[] = []
  try {
    items = await api.search(query)
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || String(e),
      data: { error_code: "DOWNLOADS_SEARCH_FAILED" },
    }
  }

  const matches = filterCompletedDownloads(items, {
    filenameHint,
    urlContains,
    limit,
    downloadsRoots: params.__downloadsRoots,
  })
  return {
    success: true,
    data: {
      count: matches.length,
      matches,
      note:
        matches.length > 0
          ? "Use path from matches (Downloads only); set browser_download force_redownload=true only if you need a fresh copy."
          : "No complete existing download under Downloads matched; proceed with browser_download click if needed.",
    },
  }
}

/** First best match for prefer_existing short-circuit. */
export async function findPreferredExistingDownload(
  params: FindDownloadsParams,
): Promise<FoundDownload | null> {
  const r = await runDownloadsFind({ ...params, limit: params.limit ?? 1 })
  if (!r.success || !r.data?.matches?.length) return null
  return r.data.matches[0] as FoundDownload
}
