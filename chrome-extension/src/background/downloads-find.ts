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
      data: {
        error_code: "HINT_REQUIRED",
        user_hint_zh:
          "请提供文件名关键字（filenameHint，如 repo-main.zip）和/或下载 URL 片段（urlContains）后再搜索本地下载。",
        suggested_action: "provide_filenameHint_or_urlContains",
      },
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
      data: {
        error_code: "DOWNLOADS_API_UNAVAILABLE",
        user_hint_zh:
          "Chrome 下载 API 不可用（扩展权限或环境异常）。请重载 CMspark 扩展并确认已授予 downloads 权限；或改用 browser_download 下载后再 skill_install。",
        suggested_action: "reload_extension_or_browser_download",
      },
    }
  }

  /**
   * Chrome downloads.search quirks (Windows / GitHub zip pain):
   * - filenameRegex is RE2 and sometimes returns empty for valid basenames
   * - exists:true in the query can drop items still settling
   * Strategy: try narrow query first; if zero hits after filter, fall back to
   * recent complete downloads without filenameRegex and filter client-side.
   */
  const scanLimit = Math.max(limit, 20)
  let items: chrome.downloads.DownloadItem[] = []
  let searchMode: "narrow" | "broad" = "narrow"
  try {
    items = await searchDownloadsApi(api, {
      filenameHint,
      narrow: true,
    })
    let matches = filterCompletedDownloads(items, {
      filenameHint,
      urlContains,
      limit: scanLimit,
      downloadsRoots: params.__downloadsRoots,
    })
    if (matches.length === 0) {
      searchMode = "broad"
      items = await searchDownloadsApi(api, {
        filenameHint,
        narrow: false,
      })
      matches = filterCompletedDownloads(items, {
        filenameHint,
        urlContains,
        limit: scanLimit,
        downloadsRoots: params.__downloadsRoots,
      })
    }
    const conflict = detectDownloadConflicts(matches)
    const trimmed = matches.slice(0, limit)
    return {
      success: true,
      data: {
        count: trimmed.length,
        matches: trimmed,
        search_mode: searchMode,
        ...(conflict
          ? {
              conflict: true,
              conflict_hint_zh: conflict,
            }
          : {}),
        note:
          trimmed.length > 0
            ? conflict
              ? `Multiple Downloads matches differ in size/time — pick carefully. ${conflict}`
              : "Use path from matches (Downloads only). For skill ZIP: skill_install({ zip_path }). GitHub Code button zips are often named <repo>-main.zip / <repo>-master.zip."
            : githubZipMissHint(filenameHint, urlContains),
      },
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    return {
      success: false,
      error: msg,
      data: {
        error_code: /importScripts|failed to load/i.test(msg)
          ? "DOWNLOADS_FIND_CHUNK_LOAD"
          : "DOWNLOADS_SEARCH_FAILED",
        // Prefer user_hint_zh (ChatView surfaces this); keep recovery_zh for older agents
        user_hint_zh:
          "本地下载列表读取失败。请重载 CMspark 扩展后重试；或改用 browser_download（指定按钮文字如「Download ZIP」）下载，再 skill_install({ zip_path })。",
        recovery_zh:
          "downloads_find 不可用时：用 browser_download 点 GitHub「Code」→「Download ZIP」，或打开 /archive/refs/heads/main.zip；完成后 skill_install({ zip_path })。重载扩展可修复 importScripts/分包加载失败。",
        suggested_action: "reload_extension_or_browser_download",
      },
    }
  }
}

async function searchDownloadsApi(
  api: DownloadsSearchApi,
  opts: { filenameHint?: string; narrow: boolean },
): Promise<chrome.downloads.DownloadItem[]> {
  const base: chrome.downloads.DownloadQuery = {
    state: "complete",
    orderBy: ["-startTime"],
    // Broader limit for client filter; narrow still caps Chrome work.
    limit: opts.narrow ? 50 : 100,
  }
  // Do not put exists:true in query — filter exists in filterCompletedDownloads
  // (exists can be undefined while file is present on disk).
  if (opts.narrow && opts.filenameHint) {
    // Chrome filenameRegex is RE2-ish; escape literal hints.
    base.filenameRegex = escapeRegExp(opts.filenameHint)
  }
  return api.search(base)
}

/** Hint when cache miss — prefer GitHub archive / Code ZIP over shell curl. */
export function githubZipMissHint(
  filenameHint?: string,
  urlContains?: string,
): string {
  const parts = [
    "No complete download under Downloads matched.",
    "Options: (1) browser_download text=\"Download ZIP\" after opening the Code menu on the repo page;",
    "(2) navigate to https://github.com/<owner>/<repo>/archive/refs/heads/main.zip then browser_download;",
    "(3) if the user already saved <repo>-main.zip / <repo>-master.zip, retry downloads_find with that basename;",
    "then skill_install({ zip_path }). Prefer browser_download over shell curl for authenticated GitHub.",
  ]
  if (filenameHint) parts.push(`Tried filenameHint=${filenameHint}.`)
  if (urlContains) parts.push(`Tried urlContains=${urlContains}.`)
  return parts.join(" ")
}

/**
 * DL-4: when multiple complete hits share a basename but differ in bytes or endTime,
 * surface a Chinese hint so the Agent does not pick the wrong file silently.
 */
export function detectDownloadConflicts(matches: FoundDownload[]): string | null {
  if (!matches || matches.length < 2) return null
  const byName = new Map<string, FoundDownload[]>()
  for (const m of matches) {
    const key = (m.filename || "").toLowerCase()
    if (!key) continue
    const arr = byName.get(key) || []
    arr.push(m)
    byName.set(key, arr)
  }
  const hints: string[] = []
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    const sizes = new Set(group.map((g) => g.bytes))
    const times = new Set(group.map((g) => g.endTime || "").filter(Boolean))
    const paths = new Set(group.map((g) => g.path))
    // Conflict if size differs, non-empty endTime differs, or multiple paths share name
    // (same size + missing endTime still multi-path → warn; Pi N1 N1)
    if (sizes.size > 1 || times.size > 1 || paths.size > 1) {
      const sizePart =
        sizes.size > 1
          ? `大小不同: ${[...sizes].map((s) => `${s}B`).join(" / ")}`
          : times.size > 1
            ? "时间戳不同"
            : "多路径同名"
      hints.push(`「${name}」有 ${group.length} 份 (${sizePart})；请用 endTime/bytes/path 选对，勿默认第一项`)
    }
  }
  return hints.length ? hints.join("；") : null
}

/** First best match for prefer_existing short-circuit. */
export async function findPreferredExistingDownload(
  params: FindDownloadsParams,
): Promise<FoundDownload | null> {
  const r = await runDownloadsFind({ ...params, limit: params.limit ?? 1 })
  if (!r.success || !r.data?.matches?.length) return null
  return r.data.matches[0] as FoundDownload
}
