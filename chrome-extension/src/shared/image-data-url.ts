// Generated from companion/src/image-data-url.ts by companion/scripts/generate-client-contracts.mjs.
// Inline raster image parsing shared by Companion and the browser extension.

/** Decoded payload size cap for data: images (WS ceiling is 10MB; keep headroom). */
export const IMAGE_DATA_URL_MAX_DECODED_BYTES = 6 * 1024 * 1024 // 6291456

/** Raster formats accepted in inline image URLs and composer uploads. */
export const ALLOWED_IMAGE_MIMES_LIST = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type RasterMime = typeof ALLOWED_IMAGE_MIMES_LIST[number]

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

function base64ByteLength(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding)
}

function decodePayload(header: string, payload: string): string {
  if (header.toLowerCase().includes("base64")) return payload.replace(/\s/g, "")
  // Both historical decoders kept the low byte of each UTF-16 code unit.
  const binary = decodeURIComponent(payload).replace(/[\u0100-\uffff]/g,
    char => String.fromCharCode(char.charCodeAt(0) & 0xff))
  return btoa(binary)
}

/** Decode the inline payload without applying the raster format or size policy. */
export function decodeDataUrl(src: string): { base64: string; mime: string } {
  const comma = src.indexOf(",")
  if (comma < 0) throw new Error("Invalid data: URL (no payload)")
  const header = src.slice(5, comma)
  return { base64: decodePayload(header, src.slice(comma + 1)), mime: header.split(";")[0] || "image/jpeg" }
}

/** Estimate decoded payload bytes (base64 4→3; percent-encoded via decodeURIComponent). */
export function estimateDataUrlPayloadBytes(src: string): number {
  const comma = src.indexOf(",")
  if (comma < 0) return 0
  const header = src.slice(5, comma)
  const payload = src.slice(comma + 1).replace(/\s/g, "")
  if (header.toLowerCase().indexOf("base64") >= 0) {
    return base64ByteLength(payload)
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
      // The classifier reads error text. Keep the supplied MIME in its own field.
      error: "Unsupported image MIME (not a recognized image type)",
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
    const base64 = decodePayload(header, payload)
    const byte_len = base64ByteLength(base64)
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

/** Magic-prefix → data URL for persisted thumbs (PNG/GIF/WEBP/JPEG). */
export function previewDataUrl(b64: string): string {
  if (b64.startsWith("iVBOR")) return `data:image/png;base64,${b64}`
  if (b64.startsWith("R0lGOD") || b64.startsWith("R0lGod")) return `data:image/gif;base64,${b64}`
  if (b64.startsWith("UklGR")) return `data:image/webp;base64,${b64}`
  return `data:image/jpeg;base64,${b64}`
}
