import { normalizeImageMime } from "../image-data-url"

export type RasterMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

export function sniffRasterImage(buf: Buffer): RasterMime | null {
  if (buf.length < 12) return null
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return "image/gif"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp"
  return null
}

export function admitComposerImage(
  buf: Buffer,
  declaredType: string | undefined | null,
): { ok: true; mime: RasterMime } | { ok: false; error: string } {
  const sniffed = sniffRasterImage(buf)
  if (!sniffed) return { ok: false, error: "文件内容与类型不符，已拒绝" }
  const declared = normalizeImageMime(declaredType)
  if (!declared) return { ok: false, error: "不支持该图片格式（请使用 PNG / JPEG / GIF / WebP）" }
  if (sniffed !== declared) return { ok: false, error: "文件内容与类型不符，已拒绝" }
  return { ok: true, mime: sniffed }
}

export function sniffedExt(mime: RasterMime): "png" | "jpg" | "gif" | "webp" {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/gif") return "gif"
  return "webp"
}
