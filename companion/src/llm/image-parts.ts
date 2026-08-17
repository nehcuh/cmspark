import type { CanonicalChatMessage, UserContentPart } from "./provider"

export interface ImageAttachmentMeta {
  kind: "image"
  name: string
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  sha256: string
  bytes: number
  preview_jpeg_b64?: string
  width?: number
  height?: number
}

export function estimateImagePartTokens(width?: number, height?: number): number {
  if (width && height && width > 0 && height > 0) {
    const short = Math.min(width, height)
    const long = Math.max(width, height)
    const aspect = long / short
    if (aspect <= 1.3 && short >= 1200) return 2800
  }
  return 1600
}

export function userContentToText(content: string | UserContentPart[] | undefined | null): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((p) => (p.type === "text" ? p.text : `[图片]`)).join("\n")
}

export function hydrateUserImageParts(
  rebuilt: CanonicalChatMessage[],
  persisted: Array<{ role: string; content?: string | null; attachments?: ImageAttachmentMeta[] }>,
  opts: {
    useNative: boolean
    maxImages: number
    /** Method syntax keeps callback params bivariant so tests can pass a narrower `typeof att`. */
    readImage(att: ImageAttachmentMeta): { base64: string; mime: string } | null
  },
): CanonicalChatMessage[] {
  const userIdx: number[] = []
  rebuilt.forEach((m, i) => { if (m.role === "user") userIdx.push(i) })
  const persistedUsers = persisted.filter((m) => m.role === "user")

  type Slot = { rebuiltIndex: number; att: ImageAttachmentMeta }
  const slots: Slot[] = []
  userIdx.forEach((ri, ui) => {
    const atts = persistedUsers[ui]?.attachments || []
    for (const att of atts) {
      if (att.kind === "image") slots.push({ rebuiltIndex: ri, att })
    }
  })

  const keep = new Set<ImageAttachmentMeta>()
  if (opts.useNative) {
    const newest = slots.slice(-opts.maxImages)
    for (const s of newest) keep.add(s.att)
  }

  const out = rebuilt.map((m) => ({ ...m })) as CanonicalChatMessage[]
  userIdx.forEach((ri, ui) => {
    const p = persistedUsers[ui]
    const atts = p?.attachments || []
    if (!atts.length) return
    const baseText = typeof out[ri].content === "string"
      ? (out[ri] as { role: "user"; content: string }).content
      : userContentToText((out[ri] as { role: "user"; content: string | UserContentPart[] }).content)

    if (!opts.useNative) {
      ;(out[ri] as { role: "user"; content: string }).content = baseText
      return
    }

    const parts: UserContentPart[] = [{ type: "text", text: baseText }]
    for (const att of atts) {
      if (!keep.has(att)) {
        parts.push({ type: "text", text: `\n[图片: ${att.name}]` })
        continue
      }
      const loaded = opts.readImage(att)
      if (!loaded) {
        parts.push({ type: "text", text: `\n[图片丢失: ${att.name}]` })
        continue
      }
      parts.push({
        type: "image_url",
        image_url: { url: `data:${loaded.mime};base64,${loaded.base64}` },
      })
    }
    ;(out[ri] as { role: "user"; content: UserContentPart[] }).content = parts
  })
  return out
}
