// Tiny ≤8KB / 96px preview for user-attach thumbs. Prefer JPEG passthrough,
// then canvas if installed, then PNG nearest-neighbor downscale + PNG encode.

import { deflateSync } from "node:zlib"
import { createHash } from "node:crypto"
import { decodePngToRgba } from "../computer/png-decode"

export const PREVIEW_MAX_EDGE = 96
export const PREVIEW_MAX_BYTES = 8 * 1024

function saneDims(width: number, height: number): { width: number; height: number } | undefined {
  if (width > 0 && height > 0 && width < 20000 && height < 20000) return { width, height }
  return undefined
}

/** Best-effort raster dimensions (PNG IHDR / JPEG SOF / GIF LSD / WebP VP8*). */
export function parseRasterDims(buf: Buffer, mime: string): { width: number; height: number } | undefined {
  if (!buf || buf.length < 10) return undefined
  if (mime === "image/png") {
    if (buf.length < 24) return undefined
    if (buf[0] !== 0x89 || buf[1] !== 0x50) return undefined
    return saneDims(buf.readUInt32BE(16), buf.readUInt32BE(20))
  }
  if (mime === "image/jpeg") {
    let i = 2
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]!
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return saneDims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5))
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      if (i + 3 >= buf.length) break
      const len = buf.readUInt16BE(i + 2)
      if (len < 2) break
      i += 2 + len
    }
    return undefined
  }
  if (mime === "image/gif") {
    if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return undefined
    return saneDims(buf.readUInt16LE(6), buf.readUInt16LE(8))
  }
  if (mime === "image/webp") {
    if (buf.length < 20) return undefined
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return undefined
    const fourcc = buf.toString("ascii", 12, 16)
    if (fourcc === "VP8X") {
      if (buf.length < 30) return undefined
      const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
      const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
      return saneDims(width, height)
    }
    if (fourcc === "VP8L") {
      if (buf.length < 25 || buf[20] !== 0x2f) return undefined
      const bits = buf.readUInt32LE(21)
      return saneDims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (fourcc === "VP8 ") {
      if (buf.length < 30) return undefined
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return undefined
      return saneDims(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
    }
  }
  return undefined
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii")
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBuf), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePngRgba(rgba: Uint8Array, width: number, height: number): Buffer {
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    src.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function nnDownscale(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxEdge: number,
): { rgba: Buffer; width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) return { rgba: Buffer.from(rgba), width, height }
  const scale = maxEdge / long
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) / scale))
      const si = (sy * width + sx) * 4
      const di = (y * w + x) * 4
      out[di] = rgba[si]!
      out[di + 1] = rgba[si + 1]!
      out[di + 2] = rgba[si + 2]!
      out[di + 3] = rgba[si + 3]!
    }
  }
  return { rgba: out, width: w, height: h }
}

async function tryCanvasPreview(buf: Buffer): Promise<string | undefined> {
  try {
    const canvasMod = (await import("canvas")) as Record<string, unknown>
    const root = (canvasMod.loadImage ? canvasMod : canvasMod.default) as {
      createCanvas: (w: number, h: number) => {
        getContext: (k: "2d") => { drawImage: (...a: unknown[]) => void }
        toBuffer: (fmt: string, opts?: { quality?: number }) => Buffer
      }
      loadImage: (src: Buffer) => Promise<{ width: number; height: number }>
    }
    const { loadImage, createCanvas } = root
    if (!loadImage || !createCanvas) return undefined
    const img = await loadImage(buf)
    const long = Math.max(img.width, img.height) || 1
    const scale = long > PREVIEW_MAX_EDGE ? PREVIEW_MAX_EDGE / long : 1
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = createCanvas(w, h)
    canvas.getContext("2d").drawImage(img, 0, 0, w, h)
    let out: Buffer = canvas.toBuffer("image/jpeg", { quality: 0.5 })
    if (out.length > PREVIEW_MAX_BYTES) {
      const s2 = 48 / long
      const w2 = Math.max(1, Math.round(img.width * s2))
      const h2 = Math.max(1, Math.round(img.height * s2))
      const c2 = createCanvas(w2, h2)
      c2.getContext("2d").drawImage(img, 0, 0, w2, h2)
      out = c2.toBuffer("image/jpeg", { quality: 0.4 })
    }
    if (out.length <= PREVIEW_MAX_BYTES) return out.toString("base64")
  } catch {
    return undefined
  }
  return undefined
}

/** Returns base64 preview (PNG or JPEG) capped at 8KB, or undefined. */
export async function makePreviewB64(buf: Buffer, mime: string): Promise<string | undefined> {
  if (!buf || buf.length === 0) return undefined
  if (mime === "image/jpeg" && buf.length <= PREVIEW_MAX_BYTES) {
    return buf.toString("base64")
  }
  const viaCanvas = await tryCanvasPreview(buf)
  if (viaCanvas) return viaCanvas
  if (mime === "image/png") {
    try {
      const decoded = decodePngToRgba(buf)
      const small = nnDownscale(decoded.rgba, decoded.width, decoded.height, PREVIEW_MAX_EDGE)
      const png = encodePngRgba(small.rgba, small.width, small.height)
      if (png.length <= PREVIEW_MAX_BYTES) return png.toString("base64")
      const tiny = nnDownscale(decoded.rgba, decoded.width, decoded.height, 32)
      const png2 = encodePngRgba(tiny.rgba, tiny.width, tiny.height)
      if (png2.length <= PREVIEW_MAX_BYTES) return png2.toString("base64")
    } catch {
      /* fall through */
    }
  }
  if (buf.length <= PREVIEW_MAX_BYTES && (mime === "image/gif" || mime === "image/webp" || mime === "image/jpeg")) {
    return buf.toString("base64")
  }
  return undefined
}

export function previewDataUrl(b64: string): string {
  if (b64.startsWith("iVBOR")) return `data:image/png;base64,${b64}`
  if (b64.startsWith("R0lGOD") || b64.startsWith("R0lGod")) return `data:image/gif;base64,${b64}`
  if (b64.startsWith("UklGR")) return `data:image/webp;base64,${b64}`
  return `data:image/jpeg;base64,${b64}`
}

/** Unused hash helper kept for tests / callers that want a stable id. */
export function previewFingerprint(b64: string): string {
  return createHash("sha256").update(b64).digest("hex").slice(0, 12)
}
