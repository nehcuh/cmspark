// File parser — extract text from uploaded files into Markdown

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import AdmZip from "adm-zip"
import { logger } from "./logger"

export interface EmbeddedImage {
  base64: string
  title: string
  width: number
  height: number
  format: string
}

export interface FileParseResult {
  success: true
  text: string
  filename: string
  mimeType: string
  fileSize: number
  pageCount?: number
  warning?: string
  embeddedImages?: EmbeddedImage[]
}

export interface FileParseError {
  success: false
  error: string
  filename: string
  mimeType: string
}

export type FileParseResponse = FileParseResult | FileParseError

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_EMBEDDED_IMAGES = 20

const EXTENSION_MIME_MAP: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
}

const IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "svg"])
const MIN_IMAGE_SIZE = 2048 // skip decorative icons < 2KB

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || ""
}

function getMimeType(filename: string, providedMime: string): string {
  if (providedMime && providedMime !== "application/octet-stream") return providedMime
  const ext = getExtension(filename)
  return EXTENSION_MIME_MAP[ext] || providedMime
}

function isOfficeFormat(mimeType: string): boolean {
  return [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/rtf",
    "text/html",
  ].includes(mimeType)
}

/**
 * Extract embedded images from Office Open XML (ZIP) files.
 * Images live in word/media/, ppt/media/, or xl/media/ directories.
 */
function extractEmbeddedImages(buffer: Buffer, filename: string): EmbeddedImage[] {
  const ext = getExtension(filename)
  if (!["docx", "pptx", "xlsx"].includes(ext)) return []

  const images: EmbeddedImage[] = []

  try {
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()

    const mediaPrefix = ext === "docx" ? "word/media/"
      : ext === "pptx" ? "ppt/media/"
      : "xl/media/"

    for (const entry of entries) {
      if (!entry.entryName.startsWith(mediaPrefix)) continue
      if (entry.isDirectory) continue

      const rawName = entry.entryName.split("/").pop() || "image"
      const format = rawName.split(".").pop()?.toLowerCase() || "png"

      if (!IMAGE_FORMATS.has(format)) continue
      if (entry.header.size < MIN_IMAGE_SIZE) continue

      if (images.length >= MAX_EMBEDDED_IMAGES) {
        images.push({
          base64: "",
          title: `...及其他图片省略`,
          width: 0,
          height: 0,
          format: "note",
        })
        break
      }

      const data = entry.getData()
      images.push({
        base64: data.toString("base64"),
        title: rawName,
        width: 0,
        height: 0,
        format,
      })
    }
  } catch (err) {
    logger.warn("file.embedded_images_extract_failed", { filename, error: String(err) })
  }

  return images
}

async function parseOfficeFile(buffer: Buffer, filename: string, mimeType: string): Promise<FileParseResponse> {
  const officeparser = await import("officeparser")
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-upload-"))
  const tmpPath = path.join(tmpDir, filename)
  fs.writeFileSync(tmpPath, buffer)

  try {
    const [text, embeddedImages] = await Promise.all([
      officeparser.parseOfficeAsync(tmpPath),
      Promise.resolve(extractEmbeddedImages(buffer, filename)),
    ])

    const result: FileParseResult = {
      success: true,
      text,
      filename,
      mimeType,
      fileSize: buffer.length,
    }

    if (embeddedImages.length > 0) {
      result.embeddedImages = embeddedImages
      const realCount = embeddedImages.filter(i => i.format !== "note").length
      result.warning = `文档包含 ${realCount} 张内嵌图片`
    }

    return result
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function parsePdf(buffer: Buffer, filename: string, mimeType: string): Promise<FileParseResponse> {
  const pdfParse = (await import("pdf-parse")).default
  const data = await pdfParse(buffer)

  if (!data.text || data.text.trim().length === 0) {
    return {
      success: true,
      text: `# ${filename}\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: ${data.numpages}]`,
      filename,
      mimeType,
      fileSize: buffer.length,
      pageCount: data.numpages,
      warning: "扫描件 PDF，无法提取文本",
    }
  }

  return {
    success: true,
    text: `# ${filename}\n\n${data.text}`,
    filename,
    mimeType,
    fileSize: buffer.length,
    pageCount: data.numpages,
  }
}

function parseText(buffer: Buffer, filename: string, mimeType: string): FileParseResponse {
  const text = buffer.toString("utf-8")
  return { success: true, text, filename, mimeType, fileSize: buffer.length }
}

function parseCsv(buffer: Buffer, filename: string, mimeType: string): FileParseResponse {
  const raw = buffer.toString("utf-8")
  const lines = raw.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) {
    return { success: true, text: "", filename, mimeType, fileSize: buffer.length }
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ","
  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, "")))

  const headers = rows[0]
  const separator = headers.map(() => "---")
  const tableRows = rows.slice(1)

  const mdTable = [
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...tableRows.map(row => `| ${row.join(" | ")} |`),
  ].join("\n")

  return { success: true, text: mdTable, filename, mimeType, fileSize: buffer.length }
}

export async function parseFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<FileParseResponse> {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `文件 "${filename}" 过大 (${Math.round(buffer.length / 1024 / 1024)}MB)，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      filename,
      mimeType,
    }
  }

  const resolvedMime = getMimeType(filename, mimeType)

  try {
    if (resolvedMime === "text/plain" || resolvedMime === "text/markdown") {
      return parseText(buffer, filename, resolvedMime)
    }

    if (resolvedMime === "text/csv") {
      return parseCsv(buffer, filename, resolvedMime)
    }

    if (resolvedMime === "application/pdf") {
      return await parsePdf(buffer, filename, resolvedMime)
    }

    if (isOfficeFormat(resolvedMime)) {
      return await parseOfficeFile(buffer, filename, resolvedMime)
    }

    if (resolvedMime.startsWith("text/")) {
      return parseText(buffer, filename, resolvedMime)
    }

    return {
      success: false,
      error: `不支持的文件类型: ${resolvedMime} (${filename})`,
      filename,
      mimeType: resolvedMime,
    }
  } catch (err: any) {
    return {
      success: false,
      error: `文件解析失败: ${err.message || String(err)}`,
      filename,
      mimeType: resolvedMime,
    }
  }
}
