// Admission and routing for standalone images attached to a chat message.
const MIB = 1024 * 1024
export const MAX_UPLOAD_IMAGES = 4
export const MAX_UPLOAD_IMAGE_BYTES = 4 * MIB
export const MAX_UPLOAD_IMAGES_TOTAL_BYTES = 6 * MIB

export const IMAGE_PREFLIGHT_NO_VISION =
  "当前主模型不支持直接看图，且未启用视觉分析。请在设置中开启视觉分析，或改用支持图片的模型。"

export const IMAGE_FORMAT_REFUSED =
  "不支持该图片格式（请使用 PNG / JPEG / GIF / WebP）"

export function checkComposerImageCaps(
  images: ReadonlyArray<{ name: string; size: number }>,
): string | undefined {
  if (images.length > MAX_UPLOAD_IMAGES) {
    return `一次最多添加 ${MAX_UPLOAD_IMAGES} 张图片`
  }
  let total = 0
  for (const img of images) {
    if (img.size > MAX_UPLOAD_IMAGE_BYTES) {
      return `图片 "${img.name}" 过大，单张不超过 ${MAX_UPLOAD_IMAGE_BYTES / MIB}MB`
    }
    total += img.size
  }
  if (total > MAX_UPLOAD_IMAGES_TOTAL_BYTES) {
    return `图片总大小超过 ${MAX_UPLOAD_IMAGES_TOTAL_BYTES / MIB}MB 上限`
  }
  return undefined
}

/**
 * Standalone (composer) images only — not document-embedded images.
 * useNative skips analyzeImage; the main model consumes sidecar bytes.
 */
export function planStandaloneImageAnalysis(opts: {
  imageCount: number
  useNative: boolean
  visionRailOn: boolean
}): { analyze: boolean; error?: string } {
  if (opts.imageCount <= 0) return { analyze: false }
  if (opts.useNative) return { analyze: false }
  if (opts.visionRailOn) return { analyze: true }
  return {
    analyze: false,
    error: IMAGE_PREFLIGHT_NO_VISION,
  }
}
