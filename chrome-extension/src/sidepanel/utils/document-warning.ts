import { normalizeDocumentWarning, type DocumentNotice } from "../../shared/file-formats"
export { normalizeDocumentWarning, type DocumentNotice } from "../../shared/file-formats"

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
