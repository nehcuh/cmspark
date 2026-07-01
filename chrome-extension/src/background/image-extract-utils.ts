// Image extraction helpers for the background service worker.
//
// Used by analyze_image as a fallback when an <img> cannot be read via canvas:
// cross-origin images served without Access-Control-Allow-Origin taint the
// canvas, so canvas.toDataURL() throws ("Tainted canvases may not be exported").
// The extension manifest grants host_permissions: ["<all_urls>"], so the
// service worker's own fetch() bypasses page-level CORS and can read the raw
// image bytes directly.

export interface ExtractedImage {
  base64: string
  mime: string
}

/** Decode a Uint8Array to base64 without FileReader (which is unavailable in a
 *  MV3 service worker). Chunked to stay well under the String.fromCharCode.apply
 *  argument limit (~65k) on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = Array.from(bytes.subarray(i, i + CHUNK))
    parts.push(String.fromCharCode.apply(null, chunk))
  }
  return btoa(parts.join(""))
}

/** Decode a `data:` URL into {base64, mime}. Handles base64 payloads (the
 *  common case for inline images) and, defensively, URL-encoded payloads. */
export function decodeDataUrl(src: string): ExtractedImage {
  const comma = src.indexOf(",")
  if (comma < 0) throw new Error("Invalid data: URL (no payload)")
  // Header sits between "data:" and the comma, e.g. "image/png;base64".
  const header = src.slice(5, comma)
  const payload = src.slice(comma + 1)
  const mime = header.split(";")[0] || "image/jpeg"
  if (header.indexOf("base64") >= 0) {
    return { base64: payload, mime }
  }
  // URL-encoded (percent-encoded) payload — decode, then re-encode to base64.
  // Note: decodeURIComponent assumes a UTF-8 percent-encoded *text* payload;
  // binary data: URLs should use base64 (handled above). This defensive branch
  // covers the rare text-only case.
  const decoded = decodeURIComponent(payload)
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return { base64: bytesToBase64(bytes), mime }
}

/** Fetch an image URL from the service worker and return its base64 bytes.
 *
 *  - `data:` URLs are decoded inline (no network).
 *  - `blob:` URLs are page-scoped and cannot be dereferenced from the SW — throws.
 *  - http(s): fetched with credentials:"omit" first; on 401/403 (authed CDN) we
 *    retry once with credentials:"include". Any non-2xx final status throws. */
export async function fetchImageAsBase64(src: string): Promise<ExtractedImage> {
  const scheme = src.slice(0, 5).toLowerCase()
  if (scheme === "data:") return decodeDataUrl(src)
  if (scheme === "blob:") {
    // blob: URLs are scoped to the page's origin and cannot be dereferenced from
    // the service worker. A future enhancement could fall back to a CDP element
    // screenshot (Page.captureScreenshot clip) for this case.
    throw new Error("blob: URLs cannot be fetched from the background service worker (page-scoped)")
  }

  let resp = await fetch(src, { credentials: "omit" })
  if (resp.status === 401 || resp.status === 403) {
    // Authed CDN: retry once attaching credentials so we get the rendered image.
    resp = await fetch(src, { credentials: "include" })
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${src}`)
  }
  const blob = await resp.blob()
  const buf = await blob.arrayBuffer()
  const mime = blob.type || resp.headers.get("content-type") || "image/jpeg"
  return { base64: bytesToBase64(new Uint8Array(buf)), mime }
}
