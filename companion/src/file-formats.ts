// Explicit document formats shared by parser dispatch and upload admission.
export const DOCUMENT_MIMES: Readonly<Record<string, string>> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  pdf: "application/pdf",
  rtf: "application/rtf",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
}

export const LEGACY_UPLOAD_MIMES = [
  DOCUMENT_MIMES.pdf, DOCUMENT_MIMES.docx, DOCUMENT_MIMES.pptx, DOCUMENT_MIMES.xlsx,
  DOCUMENT_MIMES.txt, DOCUMENT_MIMES.md, DOCUMENT_MIMES.csv, DOCUMENT_MIMES.html,
  DOCUMENT_MIMES.rtf, DOCUMENT_MIMES.odt,
] as const

export const DEFAULT_UPLOAD_MIMES = [
  ...LEGACY_UPLOAD_MIMES, DOCUMENT_MIMES.doc, DOCUMENT_MIMES.xls,
  DOCUMENT_MIMES.ppt, DOCUMENT_MIMES.ods, DOCUMENT_MIMES.odp,
]

export const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "html", "htm"])
export const OFFICE_MIMES = new Set([...OFFICE_EXTENSIONS].map(ext => DOCUMENT_MIMES[ext]))
export const CONVERTED_EXTENSIONS: Readonly<Record<string, string>> = {
  doc: "docx", xls: "xlsx", ppt: "pptx", odp: "pptx",
}

/** Import notices are display metadata, never document/model text. */
export function normalizeDocumentWarning(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 512) || undefined
}

export function documentExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || ""
}

export function resolveDocumentMime(filename: string, providedMime: string): string {
  const normalized = String(providedMime || "").trim().toLowerCase().split(";")[0].trim()
  // WPS on Linux can label standard PDF bytes with this application-specific alias.
  const mime = normalized === "application/wps-office.pdf" ? DOCUMENT_MIMES.pdf : normalized
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    return DOCUMENT_MIMES[documentExtension(filename)] || mime
  }
  return mime
}

/** Adapt the historical product default without mutating custom/cached config. */
export function effectiveUploadAllowedTypes(types: readonly string[]): readonly string[] {
  const normalized = new Set(types.map(type => resolveDocumentMime("", type)))
  if (normalized.size === LEGACY_UPLOAD_MIMES.length && LEGACY_UPLOAD_MIMES.every(type => normalized.has(type))) {
    return DEFAULT_UPLOAD_MIMES
  }
  return types
}

export function unsupportedWpsError(filename: string): string | undefined {
  return ["wps", "et", "dps"].includes(documentExtension(filename))
    ? `暂不支持 WPS 专有格式 (${filename})，请用 WPS 另存为 .docx/.xlsx/.pptx 或 PDF 后导入。`
    : undefined
}
