// File parser — extract text from uploaded files into Markdown

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

export interface FileParseResult {
  success: true
  text: string
  filename: string
  mimeType: string
  fileSize: number
  pageCount?: number
  warning?: string
}

export interface FileParseError {
  success: false
  error: string
  filename: string
  mimeType: string
}

export type FileParseResponse = FileParseResult | FileParseError

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

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

async function parseOfficeFile(buffer: Buffer, filename: string, mimeType: string): Promise<FileParseResponse> {
  const officeparser = await import("officeparser")
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-upload-"))
  const tmpPath = path.join(tmpDir, filename)
  fs.writeFileSync(tmpPath, buffer)

  try {
    const text = await officeparser.parseOfficeAsync(tmpPath)
    return { success: true, text, filename, mimeType, fileSize: buffer.length }
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

  // Build markdown table
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
    // Plain text formats — direct read
    if (resolvedMime === "text/plain" || resolvedMime === "text/markdown") {
      return parseText(buffer, filename, resolvedMime)
    }

    // CSV — convert to markdown table
    if (resolvedMime === "text/csv") {
      return parseCsv(buffer, filename, resolvedMime)
    }

    // PDF
    if (resolvedMime === "application/pdf") {
      return await parsePdf(buffer, filename, resolvedMime)
    }

    // Office formats (docx, pptx, xlsx, odt, rtf, html)
    if (isOfficeFormat(resolvedMime)) {
      return await parseOfficeFile(buffer, filename, resolvedMime)
    }

    // Fallback: try as text
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
