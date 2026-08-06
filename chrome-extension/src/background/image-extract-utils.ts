// Image extraction helpers for the background service worker.
//
// Used by analyze_image as a fallback when an <img> cannot be read via canvas:
// cross-origin images served without Access-Control-Allow-Origin taint the
// canvas, so canvas.toDataURL() throws ("Tainted canvases may not be exported").
// The extension manifest grants host_permissions: ["<all_urls>"], so the
// service worker's own fetch() bypasses page-level CORS and can read the raw
// image bytes directly.
//
// data: URLs: decoded inline with a strict raster MIME allowlist and decoded
// payload size cap (6 MiB). Never network-fetch data:; never return
// fetch_required for data: (companion IMAGE_FETCH_GATE is http(s) only).

export interface ExtractedImage {
  base64: string
  mime: string
}

/** Decoded payload size cap for data: images (WS ceiling is 10MB; keep headroom). */
export const IMAGE_DATA_URL_MAX_DECODED_BYTES = 6 * 1024 * 1024 // 6291456

/** Raster MIME allowlist for analyze_image data: promotion (both extension + companion). */
const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

export type DecodeDataUrlImageResult =
  | { ok: true; base64: string; mime: string; byte_len: number }
  | {
      ok: false
      error: string
      error_code: "INVALID_DATA_URL" | "IMAGE_MIME_REJECTED" | "IMAGE_TOO_LARGE"
      mime?: string
      byte_len?: number
    }

/** Normalize a Content-Type / data: header MIME. image/jpg → image/jpeg.
 *  Returns null for non-allowlisted types (incl. image/svg+xml, text/*). */
export function normalizeImageMime(raw: string | undefined | null): string | null {
  const m = String(raw || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim()
  if (m === "image/jpg") return "image/jpeg"
  if (ALLOWED_IMAGE_MIMES.has(m)) return m
  return null
}

/** Estimate decoded payload bytes from a data: URL (no network). Base64 uses
 *  the standard 4→3 mapping; percent-encoded uses decodeURIComponent length. */
export function estimateDataUrlPayloadBytes(src: string): number {
  const comma = src.indexOf(",")
  if (comma < 0) return 0
  const header = src.slice(5, comma)
  const payload = src.slice(comma + 1).replace(/\s/g, "")
  if (header.toLowerCase().indexOf("base64") >= 0) {
    if (!payload) return 0
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
  }
  try {
    return decodeURIComponent(payload).length
  } catch {
    return payload.length
  }
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
 *  common case for inline images) and, defensively, URL-encoded payloads.
 *  Low-level: no MIME allowlist / size gate — prefer decodeDataUrlImage for
 *  analyze_image promotion. */
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

/** Gate + decode a data: URL for analyze_image. Applies raster MIME allowlist
 *  and decoded-payload size cap. Never touches the network. */
export function decodeDataUrlImage(src: string): DecodeDataUrlImageResult {
  if (typeof src !== "string" || !src.toLowerCase().startsWith("data:")) {
    return { ok: false, error: "Not a data: URL", error_code: "INVALID_DATA_URL" }
  }
  const comma = src.indexOf(",")
  if (comma < 0) {
    return { ok: false, error: "Invalid data: URL (no payload)", error_code: "INVALID_DATA_URL" }
  }
  const header = src.slice(5, comma)
  const rawMime = (header.split(";")[0] || "").trim()
  // Cap mime echo length so pathological headers cannot flood tool errors/logs.
  const rawMimeShort = rawMime.length > 64 ? rawMime.slice(0, 64) + "…" : rawMime
  const mime = normalizeImageMime(rawMime)
  if (!mime) {
    return {
      ok: false,
      error: `Unsupported image MIME: ${rawMimeShort || "(empty)"}`,
      error_code: "IMAGE_MIME_REJECTED",
      mime: rawMimeShort || undefined,
    }
  }
  const estimated = estimateDataUrlPayloadBytes(src)
  if (estimated > IMAGE_DATA_URL_MAX_DECODED_BYTES) {
    return {
      ok: false,
      error: `Image too large (${estimated} bytes; max ${IMAGE_DATA_URL_MAX_DECODED_BYTES})`,
      error_code: "IMAGE_TOO_LARGE",
      mime,
      byte_len: estimated,
    }
  }
  try {
    const extracted = decodeDataUrl(src)
    // Re-check size from base64 (authoritative for base64 payloads).
    const payload = extracted.base64.replace(/\s/g, "")
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
    const byte_len = payload
      ? Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
      : 0
    if (byte_len > IMAGE_DATA_URL_MAX_DECODED_BYTES) {
      return {
        ok: false,
        error: `Image too large (${byte_len} bytes; max ${IMAGE_DATA_URL_MAX_DECODED_BYTES})`,
        error_code: "IMAGE_TOO_LARGE",
        mime,
        byte_len,
      }
    }
    return { ok: true, base64: extracted.base64, mime, byte_len }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Failed to decode data: URL",
      error_code: "INVALID_DATA_URL",
    }
  }
}

/** Fetch an image URL from the service worker and return its base64 bytes.
 *
 *  - `data:` URLs are decoded inline (no network). MIME/size gates applied.
 *  - `blob:` URLs are page-scoped and cannot be dereferenced from the SW — throws.
 *  - http(s): fetched with credentials:"omit" first; on 401/403 (authed CDN) we
 *    retry once with credentials:"include". Any non-2xx final status throws. */
export async function fetchImageAsBase64(src: string): Promise<ExtractedImage> {
  const scheme = src.slice(0, 5).toLowerCase()
  if (scheme === "data:") {
    // Explicit === true/false: plasmo base tsconfig has strict:false — truthiness
    // does not narrow DecodeDataUrlImageResult (ok true|false union).
    const r = decodeDataUrlImage(src)
    if (r.ok === true) return { base64: r.base64, mime: r.mime }
    throw new Error(r.ok === false ? r.error : "Invalid data: URL image")
  }
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
