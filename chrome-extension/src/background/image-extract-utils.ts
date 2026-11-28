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

import { decodeDataUrlImage } from "../shared/image-data-url"
export {
  ALLOWED_IMAGE_MIMES_LIST,
  IMAGE_DATA_URL_MAX_DECODED_BYTES,
  decodeDataUrl,
  decodeDataUrlImage,
  estimateDataUrlPayloadBytes,
  normalizeImageMime,
  type DecodeDataUrlImageResult,
} from "../shared/image-data-url"

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

/** Coerce image dimensions from CDP/page metadata: only positive finite values. */
export function sanitizeImageDim(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * Post-CDP promotion of canvas-fallback fetchSrc (unit-testable; no CDP).
 *  - data: → canvas bytes (or gated error)
 *  - blob: → clear error (never fetch_required)
 *  - else → fetch_required for companion IMAGE_FETCH_GATE
 */
export type PromoteFetchSrcResult =
  | { kind: "canvas"; image_base64: string; mime: string; byte_len: number }
  | {
      kind: "error"
      error: string
      error_code: "INVALID_DATA_URL" | "IMAGE_MIME_REJECTED" | "IMAGE_TOO_LARGE" | "BLOB_URL_UNSUPPORTED"
      mime?: string
      byte_len?: number
    }
  | { kind: "fetch_required"; candidate_url: string }

export function promoteFetchSrc(fetchSrc: string): PromoteFetchSrcResult {
  const src = String(fetchSrc || "")
  const scheme5 = src.slice(0, 5).toLowerCase()
  if (scheme5 === "data:") {
    const decoded = decodeDataUrlImage(src)
    if (decoded.ok === true) {
      return {
        kind: "canvas",
        image_base64: decoded.base64,
        mime: decoded.mime,
        byte_len: decoded.byte_len,
      }
    }
    return {
      kind: "error",
      error: decoded.ok === false ? decoded.error : "Invalid data: URL image",
      error_code: decoded.ok === false ? decoded.error_code : "INVALID_DATA_URL",
      mime: decoded.ok === false ? decoded.mime : undefined,
      byte_len: decoded.ok === false ? decoded.byte_len : undefined,
    }
  }
  if (scheme5 === "blob:") {
    return {
      kind: "error",
      error: "blob: image sources cannot be analyzed (page-scoped; not fetchable from extension)",
      error_code: "BLOB_URL_UNSUPPORTED",
    }
  }
  return { kind: "fetch_required", candidate_url: src }
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
