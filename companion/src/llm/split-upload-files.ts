import { createHash } from "node:crypto"
import { normalizeImageMime } from "../image-data-url"
import { admitComposerImage } from "./image-sniff"

import { checkComposerImageCaps, IMAGE_FORMAT_REFUSED } from "./composer-image-policy"
export {
  MAX_UPLOAD_IMAGES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGES_TOTAL_BYTES,
  planStandaloneImageAnalysis,
} from "./composer-image-policy"

export type PartitionedImage = { name: string; type: string; buf: Buffer }
export type PartitionedDoc = { name: string; type: string; content: string }

export function validateImageCaps(
  images: Array<{ name: string; buf: Buffer }>,
): string | undefined {
  return checkComposerImageCaps(images.map(({ name, buf }) => ({ name, size: buf.length })))
}

/**
 * Split file.upload payload by declared MIME.
 * `normalizeImageMime(type)` non-null → decode + admitComposerImage (images).
 * Everything else → docs. Does NOT consult allowed_types.
 */
export function partitionUploadFiles(
  files: Array<{ name: string; type: string; content: string }>,
): {
  images: PartitionedImage[]
  docs: PartitionedDoc[]
  error?: string
} {
  const images: PartitionedImage[] = []
  const docs: PartitionedDoc[] = []
  const list = Array.isArray(files) ? files : []

  for (const f of list) {
    const name = typeof f?.name === "string" && f.name ? f.name : "file"
    const type = typeof f?.type === "string" ? f.type : ""
    const content = typeof f?.content === "string" ? f.content : ""
    const ext = name.split(".").pop()?.toLowerCase() || ""
    if (ext === "wps") {
      docs.push({ name, type, content })
      continue
    }
    if (ext === "heic" || ext === "heif" || ext === "svg") {
      return {
        images: [],
        docs,
        error: IMAGE_FORMAT_REFUSED,
      }
    }
    const declaredImage = type.toLowerCase().startsWith("image/")
    if (declaredImage && !normalizeImageMime(type)) {
      return {
        images: [],
        docs,
        error: IMAGE_FORMAT_REFUSED,
      }
    }
    if (normalizeImageMime(type)) {
      let buf: Buffer
      try {
        buf = Buffer.from(content, "base64")
      } catch {
        return { images: [], docs, error: `图片 "${name}" 解码失败` }
      }
      const admitted = admitComposerImage(buf, type)
      if (!admitted.ok) {
        return { images: [], docs, error: admitted.error }
      }
      images.push({ name, type: admitted.mime, buf })
    } else {
      docs.push({ name, type, content })
    }
  }

  const capErr = validateImageCaps(images)
  if (capErr) return { images: [], docs, error: capErr }
  return { images, docs }
}

/** §5.1a: persist vision descriptions into the user turn (text-only models). */
export function buildVisionAttachMessage(
  userMessage: string,
  results: Array<{ name: string; description: string }>,
): string {
  if (!results.length) return userMessage
  const names = results.map((r) => r.name).join(", ")
  const attach = names ? `📎 ${names}` : ""
  const block = `<!-- 用户附图分析 -->\n${results.map((r) => `[图片: ${r.name}] ${r.description}`).join("\n")}`
  return [userMessage.trim(), attach, block].filter(Boolean).join("\n\n")
}

export const VISION_ANALYSIS_MARKER = "<!-- 用户附图分析 -->"

/** Keep 📎 + vision block on disk when the user edits only the caption. */
export function spliceEditedCaption(diskContent: string, editedCaption: string): string {
  const raw = String(diskContent || "")
  const markerIdx = raw.indexOf(VISION_ANALYSIS_MARKER)
  const pin = raw.search(/(^|\n)📎/)
  let cut = -1
  if (markerIdx >= 0 && pin >= 0) cut = Math.min(markerIdx, pin === 0 ? 0 : pin)
  else if (markerIdx >= 0) cut = markerIdx
  else if (pin >= 0) cut = pin === 0 ? 0 : pin
  const suffix = cut >= 0 ? raw.slice(cut).replace(/^\n+/, "") : ""
  const cap = String(editedCaption || "").trim()
  if (!suffix) return cap
  return cap ? `${cap}\n\n${suffix}` : suffix
}

export function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

/** Companion-chosen id so writeImageSidecar can run before chatCreate/addMessage. */
export function allocateUploadMessageId(threadId: string): string {
  const raw = `${threadId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128)
}
