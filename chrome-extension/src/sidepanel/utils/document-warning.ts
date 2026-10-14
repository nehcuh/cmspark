/** Document import notices are bounded display metadata, never HTML/body. */
export function normalizeDocumentWarning(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 512) || undefined
}

export type DocumentNotice = { filename: string; warning: string }
export function parseDocumentNotices(value: unknown): DocumentNotice[] | undefined {
  if (!Array.isArray(value)) return undefined
  const notices: DocumentNotice[] = []
  for (const file of value.slice(0, 20)) {
    if (!file || typeof file.filename !== "string") continue
    const warning = normalizeDocumentWarning(file.warning)
    if (!warning) continue
    notices.push({ filename: file.filename.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 256), warning })
  }
  return notices.length ? notices : undefined
}
