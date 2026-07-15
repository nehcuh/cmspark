// YouTube Data API v3 client (Phase E / v1.2).
//
// Requires user-provided API key (stored in chrome.storage.local under
// STORAGE_KEYS.YOUTUBE_API_KEY). Fetches all videos in a playlist with pagination,
// returns normalized entries for the importer UI.

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
const STORAGE_KEY = "notebooklm_youtube_api_key"

const MAX_RESULTS_PER_PAGE = 50

export interface YouTubeVideo {
  videoId: string
  title: string
  channelTitle: string
  publishedAt: string
  durationSeconds?: number
  url: string
  thumbnail?: string
}

/** Save the YouTube API key. */
export async function setYouTubeApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key })
}

/** Get the stored YouTube API key (or empty string). */
export async function getYouTubeApiKey(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result?.[STORAGE_KEY] as string) || ""
}

/** Extract the playlist ID from a YouTube URL. */
export function parsePlaylistId(url: string): string | null {
  try {
    const u = new URL(url)
    const list = u.searchParams.get("list")
    if (list) return list
    // Handle youtu.be short URLs and embed URLs
    if (u.pathname.startsWith("/playlist")) return list
    return null
  } catch {
    // Maybe just a raw playlist ID
    if (/^[A-Za-z0-9_-]{10,}$/.test(url)) return url
    return null
  }
}

/** Fetch all videos in a playlist, paginating. Returns progressively via onProgress. */
export async function fetchPlaylist(
  playlistId: string,
  onProgress?: (videosSoFar: number, totalEstimate?: number) => void,
): Promise<{ ok: boolean; videos?: YouTubeVideo[]; error?: string }> {
  const apiKey = await getYouTubeApiKey()
  if (!apiKey) {
    return { ok: false, error: "未配置 YouTube Data API key（设置中粘贴）" }
  }

  const videos: YouTubeVideo[] = []
  let pageToken: string | undefined = undefined
  let totalResults: number | undefined

  try {
    do {
      const params = new URLSearchParams({
        part: "snippet,contentDetails",
        maxResults: String(MAX_RESULTS_PER_PAGE),
        playlistId,
        key: apiKey,
      })
      if (pageToken) params.set("pageToken", pageToken)

      const resp = await fetch(`${YOUTUBE_API_BASE}/playlistItems?${params}`, {
        credentials: "omit",
      })
      if (!resp.ok) {
        const body = await resp.text()
        if (resp.status === 403 || resp.status === 401) {
          return { ok: false, error: `YouTube API key 无效或额度已用完 (HTTP ${resp.status})` }
        }
        if (resp.status === 404) {
          return { ok: false, error: "找不到该 playlist（可能是私有的）" }
        }
        return { ok: false, error: `YouTube API HTTP ${resp.status}: ${body.slice(0, 200)}` }
      }
      const data = await resp.json()
      totalResults = data?.pageInfo?.totalResults ?? totalResults

      for (const item of data?.items || []) {
        const sn = item.snippet || {}
        const cd = item.contentDetails || {}
        const videoId = cd.videoId || sn.resourceId?.videoId
        if (!videoId) continue
        // Skip deleted/private videos (snippet has "title": "Deleted video" + no thumbnails)
        if ((sn.title || "").toLowerCase().includes("deleted") && !sn.thumbnails) continue
        if ((sn.title || "").toLowerCase().includes("private") && !sn.thumbnails) continue
        videos.push({
          videoId,
          title: sn.title || "(no title)",
          channelTitle: sn.videoOwnerChannelTitle || sn.channelTitle || "",
          publishedAt: sn.publishedAt || cd.videoPublishedAt || "",
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url,
        })
      }

      pageToken = data?.nextPageToken
      onProgress?.(videos.length, totalResults)
    } while (pageToken)

    // Optional: fetch durations in a second pass (videos endpoint, batched by 50 IDs)
    await enrichWithDuration(videos, apiKey)

    return { ok: true, videos }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Fetch content details (duration) for up to 50 videos per call. */
async function enrichWithDuration(videos: YouTubeVideo[], apiKey: string): Promise<void> {
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50)
    const ids = batch.map(v => v.videoId).join(",")
    try {
      const params = new URLSearchParams({ part: "contentDetails", id: ids, key: apiKey })
      const resp = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`, { credentials: "omit" })
      if (!resp.ok) continue
      const data = await resp.json()
      for (const item of data?.items || []) {
        const iso = item.contentDetails?.duration
        const sec = isoToSeconds(iso)
        const match = batch.find(v => v.videoId === item.id)
        if (match && sec != null) match.durationSeconds = sec
      }
    } catch {
      // Duration enrichment is best-effort
    }
  }
}

/** Parse ISO 8601 duration (e.g. "PT1H23M45S") to seconds. */
function isoToSeconds(iso?: string): number | null {
  if (!iso) return null
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (!m) return null
  const h = parseInt(m[1] || "0", 10)
  const min = parseInt(m[2] || "0", 10)
  const s = parseInt(m[3] || "0", 10)
  return h * 3600 + min * 60 + s
}
