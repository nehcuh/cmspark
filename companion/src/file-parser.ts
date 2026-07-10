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

function cleanHeaderFooter(text: string): string {
  const lines = text.split("\n")
  const lineFreq = new Map<string, number>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    lineFreq.set(trimmed, (lineFreq.get(trimmed) || 0) + 1)
  }

  const highFreqLines = new Set<string>()
  for (const [line, count] of lineFreq) {
    if (count >= 3) highFreqLines.add(line)
  }

  const cleaned: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) { cleaned.push(line); continue }

    // Page number only
    if (/^\d+$/.test(trimmed)) continue

    // 第 X 页 / 共 Y 页
    if (/^第\s*\d+\s*页\s*[/／]\s*共\s*\d+\s*页/.test(trimmed)) continue

    // Page X of Y
    if (/^Page\s+\d+\s+of\s+\d+/i.test(trimmed)) continue

    // Repeated header/footer
    if (highFreqLines.has(trimmed)) continue

    cleaned.push(line)
  }

  return cleaned.join("\n")
}

/**
 * Walk the zip central directory (located via the End-of-Central-Directory record PK\x05\x06)
 * and yield each entry's raw name + unix mode. Robustness (Kimi 终审 2026-07-09):
 *  - Locate the central directory via EOCD rather than scanning the whole buffer for PK\x01\x02,
 *    so a `PK\x01\x02` byte sequence that legitimately appears inside file DATA is not misread.
 *  - Stride by `46 + nameLen + extraLen + commentLen` (the real entry layout) instead of re-search.
 *  - Surface the unix mode (external attrs >> 16) so callers can reject symlinks — the link half
 *    of GHSA-mp2f-45pm-3cg9 (link targets can escape the target dir even with a safe entry name).
 * CRITICAL: adm-zip is unusable here — it normalizes "../" away on read AND write. Office files
 * are zip archives, so this works for .docx/.pptx/.xlsx. Yields nothing if no EOCD is present.
 */
function* rawZipEntries(buffer: Buffer): Generator<{ name: string; unixMode: number }> {
  const CD_SIG = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  // Locate EOCD canonically (Kimi 独立评审 2026-07-10): the real EOCD is followed by a comment of
  // length commentLen, so `e + 22 + commentLen` must equal buffer.length. Validating this — instead
  // of lastIndexOf(PK\x05\x06) — prevents an attacker from embedding a forged EOCD in trailing data
  // to make the pre-flight walk a benign central directory while officeparser reads the real one.
  const minEocd = 22
  const maxComment = 0xffff
  const scanStart = Math.max(0, buffer.length - minEocd - maxComment)
  let eocd = -1
  for (let e = buffer.length - minEocd; e >= scanStart; e--) {
    if (buffer[e] === 0x50 && buffer[e + 1] === 0x4b && buffer[e + 2] === 0x05 && buffer[e + 3] === 0x06) {
      const commentLen = buffer.readUInt16LE(e + 20)
      if (e + minEocd + commentLen === buffer.length) { eocd = e; break }
    }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) return
  const cdCount = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  let pos = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > buffer.length || buffer.indexOf(CD_SIG, pos) !== pos) break
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const extAttr = buffer.readUInt32LE(pos + 38)
    const nameStart = pos + 46
    if (nameStart + nameLen > buffer.length) break
    yield { name: buffer.toString("utf8", nameStart, nameStart + nameLen), unixMode: extAttr >>> 16 }
    pos += 46 + nameLen + extraLen + commentLen
  }
}

async function parseOfficeFile(buffer: Buffer, filename: string, mimeType: string): Promise<FileParseResponse> {
  const officeparser = await import("officeparser")

  // P0-5 (audit C4): pre-flight zip-slip check via raw central-directory walk. Office files are
  // zip archives; officeparser decompresses them internally via `decompress`, which is vulnerable
  // to GHSA-mp2f-45pm-3cg9 (extraction can write files/symlinks outside the target dir →
  // arbitrary file write / RCE on the user-upload path). Reject entries with absolute paths, a
  // `..` path component, a NUL byte, or a Unix symlink mode BEFORE handing the buffer to
  // officeparser. Proper fix (officeparser 7.x) tracked as P1-2.
  for (const { name, unixMode } of rawZipEntries(buffer)) {
    const traverses = path.isAbsolute(name)
      || name.split(/[\\/]/).includes("..") // component-level: avoids false-positive on "budget..2025.xml"
      || name.includes("\x00")
    const isSymlink = (unixMode & 0o170000) === 0o120000 // link targets can escape even with a safe name
    if (traverses || isSymlink) {
      logger.warn("file.office_zip_slip_rejected", { filename, bad_entry: name, symlink: isSymlink })
      return {
        success: false,
        error: `Office 文件被拒绝：条目 "${name}" ${isSymlink ? "是符号链接" : "含路径穿越序列"}（zip-slip）`,
        filename,
        mimeType,
      }
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-upload-"))
  const tmpPath = path.join(tmpDir, filename)
  fs.writeFileSync(tmpPath, buffer)

  try {
    const [officeResult, embeddedImages] = await Promise.all([
      officeparser.convert(tmpPath, "md"),
      Promise.resolve(extractEmbeddedImages(buffer, filename)),
    ])
    const rawText = typeof officeResult.value === "string" ? officeResult.value : ""

    const text = cleanHeaderFooter(rawText)

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

  const result: FileParseResult = {
    success: true,
    text: data.text?.trim() ? `# ${filename}\n\n${data.text}` : "",
    filename,
    mimeType,
    fileSize: buffer.length,
    pageCount: data.numpages,
  }

  // Scanned PDF — text too short to be useful, try page rendering
  if (!data.text || data.text.trim().length < 50) {
    try {
      const { renderPdfPages } = await import("./pdf-renderer")
      const renderedPages = await renderPdfPages(buffer)

      if (renderedPages.length > 0) {
        result.text = `# ${filename}\n\n[PDF 已渲染 ${renderedPages.length}/${data.numpages} 页为图片，等待视觉分析]\n`
        result.embeddedImages = renderedPages.map(p => ({
          base64: p.base64,
          title: `第 ${p.pageNumber} 页`,
          width: p.width,
          height: p.height,
          format: "png" as const,
        }))
        result.warning = `扫描件 PDF，已渲染 ${renderedPages.length} 页为图片`
      } else {
        result.text = `# ${filename}\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: ${data.numpages}]`
        result.warning = "扫描件 PDF，无法提取文本，页面渲染不可用"
      }
    } catch {
      result.text = `# ${filename}\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: ${data.numpages}]`
      result.warning = "扫描件 PDF，无法提取文本"
    }
  }

  return result
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
