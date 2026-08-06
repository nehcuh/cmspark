// Companion residual decoder for analyze_image data: URLs (old-extension skew).
// Mirrors chrome-extension image-extract-utils rules: raster MIME allowlist +
// 6 MiB decoded payload cap. Intentionally duplicated (do not import extension).
// Cross-pin: ALLOWED_IMAGE_MIMES_LIST + IMAGE_DATA_URL_MAX_DECODED_BYTES must
// match extension (see tests/image-data-url.test.ts + extension image-extract-utils tests).

/** Decoded payload size cap for data: images (WS ceiling is 10MB; keep headroom). */
export const IMAGE_DATA_URL_MAX_DECODED_BYTES = 6 * 1024 * 1024 // 6291456

/** Sorted allowlist — lock-step with chrome-extension ALLOWED_IMAGE_MIMES_LIST. */
export const ALLOWED_IMAGE_MIMES_LIST = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

const ALLOWED_IMAGE_MIMES = new Set<string>(ALLOWED_IMAGE_MIMES_LIST)

export type DecodeDataUrlImageResult =
  | { ok: true; base64: string; mime: string; byte_len: number }
  | {
      ok: false
      error: string
      error_code: "INVALID_DATA_URL" | "IMAGE_MIME_REJECTED" | "IMAGE_TOO_LARGE"
      mime?: string
      byte_len?: number
    }

/** Normalize MIME; image/jpg → image/jpeg. Null = not allowlisted. */
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

/** Estimate decoded payload bytes (base64 4→3; percent-encoded via decodeURIComponent). */
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

/**
 * Log/error hygiene: never emit multi-KB data: payloads.
 * Returns scheme + short summary (+ mime/byte_len for data:).
 */
export function summarizeCandidateUrl(url: string): {
  scheme: string
  summary: string
  mime?: string
  byte_len?: number
} {
  const s = String(url || "")
  let scheme = ""
  try {
    scheme = new URL(s).protocol
  } catch {
    const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/)
    scheme = m ? m[1].toLowerCase() : ""
  }
  if (s.toLowerCase().startsWith("data:")) {
    const comma = s.indexOf(",")
    const header = comma >= 0 ? s.slice(5, comma) : s.slice(5, Math.min(s.length, 64))
    const mime = (header.split(";")[0] || "").trim() || undefined
    const byte_len = estimateDataUrlPayloadBytes(s)
    const prefix = s.slice(0, Math.min(48, s.length))
    return {
      scheme: "data:",
      summary: `data:${mime || "?"}…(${byte_len}b) ${prefix}…`,
      mime,
      byte_len,
    }
  }
  if (s.length > 200) {
    return { scheme, summary: s.slice(0, 120) + "…" }
  }
  return { scheme, summary: s }
}

/** Gate + decode data: for analyze_image residual path (no network). */
export function decodeDataUrlImage(src: string): DecodeDataUrlImageResult {
  if (typeof src !== "string" || !src.toLowerCase().startsWith("data:")) {
    return { ok: false, error: "Not a data: URL", error_code: "INVALID_DATA_URL" }
  }
  const comma = src.indexOf(",")
  if (comma < 0) {
    return { ok: false, error: "Invalid data: URL (no payload)", error_code: "INVALID_DATA_URL" }
  }
  const header = src.slice(5, comma)
  const payload = src.slice(comma + 1)
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
    let base64: string
    if (header.toLowerCase().indexOf("base64") >= 0) {
      // Strip whitespace so returned base64 matches byte_len (RFC 4648 §3.3).
      base64 = payload.replace(/\s/g, "")
    } else {
      const decoded = decodeURIComponent(payload)
      base64 = Buffer.from(decoded, "binary").toString("base64")
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
    const byte_len = base64
      ? Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
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
    return { ok: true, base64, mime, byte_len }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Failed to decode data: URL",
      error_code: "INVALID_DATA_URL",
    }
  }
}
