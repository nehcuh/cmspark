// Composer image paste / drop / picker helpers.
// Pure functions (plus optional canvas compress) — node:test, no React.

export const IMAGE_MAX_DECODED = 4 * 1024 * 1024
export const IMAGE_MAX_TOTAL_DECODED = 6 * 1024 * 1024
export const IMAGE_MAX_COUNT = 4
export const IMAGE_MAX_EDGE = 1568

export const IMAGE_ACCEPT =
  ".docx,.pptx,.xlsx,.pdf,.odt,.rtf,.csv,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp"

export const IMAGE_PREFLIGHT_NO_VISION =
  "当前主模型不支持直接看图，且未启用视觉分析。请在设置中开启视觉分析，或改用支持图片的模型。"

export const IMAGE_GIF_SHRINK_FIRST = "动画图请先缩小"

const ALLOWED_IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

/** Allowlisted raster MIME (png/jpeg/gif/webp). image/jpg → jpeg. */
export function isAllowlistedImageMime(t: string): boolean {
  const m = String(t || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim()
  if (m === "image/jpg") return true
  return ALLOWED_IMAGE_MIMES.has(m)
}

function looksLikeUrlName(name: string): boolean {
  const n = String(name || "").trim()
  if (!n) return false
  if (/^https?:\/\//i.test(n)) return true
  if (/^ftp:\/\//i.test(n)) return true
  // Browser 0-byte URL-drag leftovers sometimes omit the scheme.
  if (/^www\./i.test(n) && /\./.test(n.slice(4))) return true
  return false
}

/**
 * Drop classifier. Rejects URI-list / moz-url (never fetch) and 0-byte files
 * whose name looks like a URL (browser URL-drag artifact).
 */
export function classifyDrop(
  types: string[],
  files: Array<{ type: string; size: number; name: string }>,
): { ok: true } | { ok: false; error: string } {
  const typeSet = new Set((types || []).map((t) => String(t).toLowerCase()))
  if (typeSet.has("text/uri-list") || typeSet.has("text/x-moz-url")) {
    return { ok: false, error: "不支持拖入网页链接（不会下载远程图片）" }
  }
  for (const f of files || []) {
    if ((f.size || 0) === 0 && looksLikeUrlName(f.name)) {
      return { ok: false, error: "不支持拖入网页链接（不会下载远程图片）" }
    }
  }
  if (!files || files.length === 0) {
    return { ok: false, error: "没有可添加的文件" }
  }
  return { ok: true }
}

/** Display name for a clipboard screenshot: `截图 YYYY-MM-DD HH:mm`. */
export function clipboardImageDisplayName(now?: Date): string {
  const d = now ?? new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const h = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `截图 ${y}-${mo}-${day} ${h}:${min}`
}

/**
 * Caption when the user did not type one.
 * User text wins; images only → 请看这张图 / 请看这些图片;
 * docs only → 请分析我上传的文件; mixed → 请查看附件.
 */
export function defaultCaption(opts: {
  images: number
  docs: number
  userText: string
}): string {
  const user = (opts.userText || "").trim()
  if (user) return user
  const images = opts.images || 0
  const docs = opts.docs || 0
  if (images > 0 && docs > 0) return "请查看附件"
  if (images > 0) return images === 1 ? "请看这张图" : "请看这些图片"
  if (docs > 0) return "请分析我上传的文件"
  return ""
}

/**
 * Transcript edit box: caption only.
 * Strips the `📎 …` attachment/ref line and the `<!-- 用户附图分析 -->` vision block.
 */
export function captionOnlyForEdit(content: string): string {
  let text = String(content || "")
  text = text.replace(/\n*<!-- 用户附图分析 -->[\s\S]*$/, "")
  text = text.replace(/(^|\n)📎[^\n]*/g, "")
  return text.replace(/^\s+|\s+$/g, "")
}

/** Vision rail is open when enabled and file-upload vision is not explicitly off. */
export function visionRailOpen(cfg: {
  vision_enabled?: boolean
  file_upload_vision?: boolean
}): boolean {
  return !!(cfg.vision_enabled && cfg.file_upload_vision !== false)
}

export function needsCompress(bytes: number, width?: number, height?: number): boolean {
  if (bytes > IMAGE_MAX_DECODED) return true
  if (width != null && height != null) {
    return Math.max(width, height) > IMAGE_MAX_EDGE
  }
  return false
}

export function checkComposerImageCaps(
  images: Array<{ name: string; size: number }>,
): string | undefined {
  if (images.length > IMAGE_MAX_COUNT) {
    return `一次最多添加 ${IMAGE_MAX_COUNT} 张图片`
  }
  let total = 0
  for (const img of images) {
    if (img.size > IMAGE_MAX_DECODED) {
      return `图片 "${img.name}" 过大，单张不超过 4MB`
    }
    total += img.size
  }
  if (total > IMAGE_MAX_TOTAL_DECODED) {
    return `图片总大小超过 6MB 上限`
  }
  return undefined
}

function isGifMime(t: string): boolean {
  return (
    String(t || "")
      .trim()
      .toLowerCase()
      .split(";")[0]
      .trim() === "image/gif"
  )
}

export type CompressImageResult = {
  blob: Blob
  compressed: boolean
  width?: number
  height?: number
}

function canvasAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.createElement === "function" &&
    typeof Image !== "undefined"
  )
}

function loadImageElement(
  blob: Blob,
): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      resolve({ image: img, width, height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("图片解码失败"))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("图片压缩失败"))),
      type,
      quality,
    )
  })
}

/**
 * Downscale / re-encode oversized rasters via canvas (Chrome Side Panel).
 * Animated GIFs that need compress are refused — canvas would flatten them.
 * When canvas is unavailable (node tests), still refuse oversized GIFs and
 * oversized decoded payloads; dimension-only compress is skipped.
 */
export async function compressImageBlob(blob: Blob): Promise<CompressImageResult> {
  const mime = String(blob.type || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim()
  const gif = isGifMime(mime)

  if (gif && needsCompress(blob.size)) {
    throw new Error(IMAGE_GIF_SHRINK_FIRST)
  }

  if (!canvasAvailable()) {
    if (needsCompress(blob.size)) {
      throw new Error(gif ? IMAGE_GIF_SHRINK_FIRST : "图片过大，请先缩小")
    }
    return { blob, compressed: false }
  }

  let decoded: { image: HTMLImageElement; width: number; height: number }
  try {
    decoded = await loadImageElement(blob)
  } catch {
    if (needsCompress(blob.size)) {
      throw new Error(gif ? IMAGE_GIF_SHRINK_FIRST : "图片过大，请先缩小")
    }
    return { blob, compressed: false }
  }

  if (gif && needsCompress(blob.size, decoded.width, decoded.height)) {
    throw new Error(IMAGE_GIF_SHRINK_FIRST)
  }
  if (!needsCompress(blob.size, decoded.width, decoded.height)) {
    return {
      blob,
      compressed: false,
      width: decoded.width,
      height: decoded.height,
    }
  }

  const longEdge = Math.max(decoded.width, decoded.height) || 1
  const scale = Math.min(1, IMAGE_MAX_EDGE / longEdge)
  const w = Math.max(1, Math.round(decoded.width * scale))
  const h = Math.max(1, Math.round(decoded.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("图片过大，请先缩小")
  ctx.drawImage(decoded.image, 0, 0, w, h)

  // Photos / large rasters → JPEG; keep PNG only when already PNG and small enough.
  let outType = mime === "image/png" ? "image/png" : "image/jpeg"
  let out = await canvasToBlob(canvas, outType, 0.86)
  if (out.size > IMAGE_MAX_DECODED && outType === "image/png") {
    outType = "image/jpeg"
    out = await canvasToBlob(canvas, outType, 0.82)
  }
  if (out.size > IMAGE_MAX_DECODED && outType === "image/jpeg") {
    out = await canvasToBlob(canvas, "image/jpeg", 0.7)
  }
  if (out.size > IMAGE_MAX_DECODED) {
    throw new Error("图片过大，请先缩小")
  }
  return { blob: out, compressed: true, width: w, height: h }
}

/** Generic clipboard names (OS / Chrome screenshot) → 截图 timestamp. */
export function pasteImageDisplayName(fileName: string, now?: Date): string {
  const n = (fileName || "").trim()
  if (!n || n === "blob" || /^image\.(png|jpe?g|gif|webp)$/i.test(n)) {
    return clipboardImageDisplayName(now)
  }
  return n
}
