// File parser — extract text from uploaded files into Markdown

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import AdmZip from "adm-zip"
import type { SupportedFileType } from "officeparser"
import { logger } from "./logger"
import { CONVERTED_EXTENSIONS, DOCUMENT_MIMES, OFFICE_MIMES, documentExtension, resolveDocumentMime, unsupportedWpsError } from "./file-formats"
import { convertOfficeDocument, OFFICE_OUTPUT_MAX_BYTES, OFFICE_ARCHIVE_MAX_BYTES, OFFICE_IMAGE_MAX_BYTES, OFFICE_IMAGES_MAX_BYTES } from "./office-runtime"
import { validateOdfExpansion } from "./odf-expansion"

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
  /** Pages need successful vision extraction; never store the placeholder as knowledge. */
  requiresVision?: boolean
}

export interface FileParseError {
  success: false
  error: string
  filename: string
  mimeType: string
}

export type FileParseResponse = FileParseResult | FileParseError

export const PARSE_FILE_MAX_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_FILE_SIZE = PARSE_FILE_MAX_BYTES
const MAX_EMBEDDED_IMAGES = 20

const IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "svg"])
const MIN_IMAGE_SIZE = 2048 // skip decorative icons < 2KB

function getExtension(filename: string): string {
  return documentExtension(filename)
}

/**
 * Basename-only upload name for temp writes (S45 multi-lane).
 * Returns null when empty / `.` / `..` after stripping NULs.
 */
export function safeUploadBasename(filename: string): string | null {
  const safeBase = path.basename(filename).replace(/\0/g, "")
  if (!safeBase || safeBase === "." || safeBase === "..") return null
  return safeBase
}

function getMimeType(filename: string, providedMime: string): string {
  return resolveDocumentMime(filename, providedMime)
}

function isOfficeFormat(mimeType: string): boolean {
  return OFFICE_MIMES.has(mimeType)
}

/**
 * Extract embedded images from Office Open XML (ZIP) files.
 * Images live in word/media/, ppt/media/, or xl/media/ directories.
 */
function extractEmbeddedImages(buffer: Buffer, filename: string): EmbeddedImage[] {
  const ext = getExtension(filename)
  if (!["docx", "pptx", "xlsx"].includes(ext)) return []

  const images: EmbeddedImage[] = []
  let totalBytes = 0

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
      if (entry.header.size > OFFICE_IMAGE_MAX_BYTES || totalBytes + entry.header.size > OFFICE_IMAGES_MAX_BYTES) {
        throw new Error("内嵌图片超过文档解析预算，请缩小图片或拆分文件。")
      }

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
      totalBytes += data.length
      if (data.length > OFFICE_IMAGE_MAX_BYTES || totalBytes > OFFICE_IMAGES_MAX_BYTES) throw new Error("内嵌图片超过文档解析预算。")
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
    throw err
  }

  return images
}

/**
 * #285: officeparser inlines images as `data:` URIs. extractEmbeddedImages
 * already stores them as attachments — keeping the base64 in the markdown
 * poisons TF-IDF / LLM context and inflates #281 body hashes. Strip before
 * the text becomes the knowledge SoT.
 */
export function stripEmbeddedDataUris(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(/!\[[^\]]*]\(\s*data:[^)]+\)/gi, "")
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])data:[\s\S]*?\1[^>]*>/gi, "")
  out = out.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "")
  out = out.replace(/\n{3,}/g, "\n\n")
  return out
}

/** Reject unsupported ZIP64 before either ZIP consumer (including nested fflate). */
function rejectZip64Extra(buffer: Buffer, start: number, end: number): void {
  while (start < end) {
    if (start + 4 > end) throw new Error("Office ZIP 扩展字段损坏")
    const kind = buffer.readUInt16LE(start)
    const size = buffer.readUInt16LE(start + 2)
    if (kind === 1) throw new Error("Office ZIP64 容器不受支持，请另存为标准 Office 文件")
    start += 4 + size
    if (start > end) throw new Error("Office ZIP 扩展字段损坏")
  }
}

/** Inspect raw names before libraries normalize them; bound declared expansion before inflation. */
function validateOfficeZip(buffer: Buffer, required: boolean): void {
  let eocd = -1
  for (let e = buffer.length - 22; e >= Math.max(0, buffer.length - 22 - 0xffff); e--) {
    if (buffer.readUInt32LE(e) === 0x06054b50 && e + 22 + buffer.readUInt16LE(e + 20) === buffer.length) { eocd = e; break }
  }
  if (eocd < 0) {
    if (required || buffer.subarray(0, 2).toString() === "PK") throw new Error("Office ZIP 容器损坏或不受支持")
    return
  }
  const count = buffer.readUInt16LE(eocd + 10)
  const offset = buffer.readUInt32LE(eocd + 16)
  const size = buffer.readUInt32LE(eocd + 12)
  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff || (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === 0x07064b50)) throw new Error("Office ZIP64 容器不受支持")
  if (buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6) || buffer.readUInt16LE(eocd + 8) !== count || count > 20000 || offset + size !== eocd) throw new Error("Office ZIP 容器目录损坏或超过预算")
  let pos = offset
  let total = 0
  let imageTotal = 0
  const names = new Set<string>()
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Office ZIP 条目损坏")
    const nameLen = buffer.readUInt16LE(pos + 28), extraLen = buffer.readUInt16LE(pos + 30), commentLen = buffer.readUInt16LE(pos + 32)
    const end = pos + 46 + nameLen + extraLen + commentLen
    if (end > eocd) throw new Error("Office ZIP 条目损坏")
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen)
    const mode = buffer.readUInt32LE(pos + 38) >>> 16
    if (path.isAbsolute(name) || path.win32.isAbsolute(name) || name.split(/[\\/]/).includes("..") || name.includes("\x00") || (mode & 0o170000) === 0o120000) throw new Error(`Office 文件被拒绝：条目 "${name}" 含路径穿越或符号链接（zip-slip）`)
    if (names.has(name)) throw new Error("Office ZIP 含重复条目")
    names.add(name)
    rejectZip64Extra(buffer, pos + 46 + nameLen, pos + 46 + nameLen + extraLen)
    const expanded = buffer.readUInt32LE(pos + 24), compressed = buffer.readUInt32LE(pos + 20), local = buffer.readUInt32LE(pos + 42)
    if (expanded === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) throw new Error("Office ZIP64 容器不受支持")
    total += expanded
    if (total > OFFICE_ARCHIVE_MAX_BYTES) throw new Error("Office ZIP 解压大小超过预算")
    if (/^(word\/media\/|ppt\/media\/|xl\/media\/|Pictures\/)/.test(name)) {
      imageTotal += expanded
      if (expanded > OFFICE_IMAGE_MAX_BYTES || imageTotal > OFFICE_IMAGES_MAX_BYTES) throw new Error("Office 内嵌图片超过解析预算")
    }
    if (local + 30 > offset || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("Office ZIP 本地条目损坏")
    const localNameLen = buffer.readUInt16LE(local + 26), localExtraLen = buffer.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLen + localExtraLen
    if (dataStart + compressed > offset || buffer.toString("utf8", local + 30, local + 30 + localNameLen) !== name) throw new Error("Office ZIP 本地条目不一致")
    rejectZip64Extra(buffer, local + 30 + localNameLen, dataStart)
    if (buffer.readUInt16LE(pos + 8) & 1 || buffer.readUInt16LE(local + 6) & 1) throw new Error("加密 Office ZIP 不受支持，请解除密码后重试")
    pos = end
  }
  if (pos !== offset + size) throw new Error("Office ZIP 目录大小不一致")
}

function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

async function parseOfficeFile(buffer: Buffer, filename: string, mimeType: string, signal: AbortSignal): Promise<FileParseResponse> {
  const sourceExt = getExtension(filename) || Object.keys(DOCUMENT_MIMES).find(ext => DOCUMENT_MIMES[ext] === mimeType) || "docx"
  const zipFormats = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"])
  validateOfficeZip(buffer, zipFormats.has(sourceExt))
  validateOdfExpansion(buffer, sourceExt)
  if (!safeUploadBasename(filename)) throw new Error(`Office 文件被拒绝：非法文件名 "${filename}"`)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-upload-"))
  try {
    signal.throwIfAborted()
    let parsedExt = sourceExt
    let parsedBuffer = buffer
    let inputPath = path.join(tmpDir, `input.${sourceExt}`)
    fs.writeFileSync(inputPath, buffer)
    let conversionWarning = ""
    const destination = CONVERTED_EXTENSIONS[sourceExt]
    if (destination) {
      const outputPath = path.join(tmpDir, `normalized.${destination}`)
      const conversion = await convertOfficeDocument(inputPath, outputPath, signal)
      signal.throwIfAborted()
      if (fs.statSync(outputPath).size > OFFICE_OUTPUT_MAX_BYTES) throw new Error("Office 转换结果超过预算")
      parsedBuffer = fs.readFileSync(outputPath)
      validateOfficeZip(parsedBuffer, true)
      parsedExt = destination
      inputPath = outputPath
      if (conversion.missingFonts.length) conversionWarning = "文档转换时缺少部分字体，布局可能与原文不同。"
    }
    // Extract/bound images BEFORE starting the asynchronous parser, so rejection cannot orphan it.
    const embeddedImages = extractEmbeddedImages(parsedBuffer, `input.${parsedExt}`)
    const officeparser = await import("officeparser")
    signal.throwIfAborted()
    const officeResult = await cancellable(officeparser.convert(parsedBuffer, "md", {
      parseConfig: { abortSignal: signal, fileType: (parsedExt === "htm" ? "html" : parsedExt) as SupportedFileType },
      generatorConfig: { abortSignal: signal, includeImages: false },
    }), signal)
    signal.throwIfAborted()
    const text = stripEmbeddedDataUris(typeof officeResult.value === "string" ? officeResult.value : "")
    const result: FileParseResult = { success: true, text, filename, mimeType, fileSize: buffer.length }
    const warnings = [conversionWarning]
    if (embeddedImages.length) {
      result.embeddedImages = embeddedImages
      warnings.push(`文档包含 ${embeddedImages.filter(i => i.format !== "note").length} 张内嵌图片`)
    }
    if (!text.trim()) {
      if (!embeddedImages.some(image => image.format !== "note")) throw new Error("文档未能提取到正文，请另存为标准 Office 文件或 PDF 后重试")
      result.requiresVision = true
      warnings.push("文档未提取到正文，内嵌图片需要视觉分析。")
    }
    if (warnings.some(Boolean)) result.warning = warnings.filter(Boolean).join("；")
    return result
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function parsePdf(buffer: Buffer, filename: string, mimeType: string, signal: AbortSignal): Promise<FileParseResponse> {
  const pdfParse = (await import("pdf-parse")).default
  signal.throwIfAborted()
  // Old PDF.js expects Uint8Array semantics (not Buffer.slice aliases). A real
  // copy also isolates pooled/nonzero-offset browser base64 decoding buffers.
  const pdfBytes = new Uint8Array(buffer)
  const data = await cancellable(pdfParse(pdfBytes), signal)

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
    result.requiresVision = true
    try {
      const { renderPdfPages } = await import("./pdf-renderer")
      const renderedPages = await renderPdfPages(buffer, signal, data.numpages)

      if (renderedPages.length > 0) {
        result.text = `# ${filename}\n\n[PDF 已渲染 ${renderedPages.length}/${data.numpages} 页为图片，等待视觉分析]\n`
        result.embeddedImages = renderedPages.map(p => ({
          base64: p.base64,
          title: `第 ${p.pageNumber} 页`,
          width: p.width,
          height: p.height,
          format: "png" as const,
        }))
        result.warning = `扫描件 PDF，已渲染 ${renderedPages.length}/${data.numpages} 页为图片${renderedPages.length < data.numpages ? "；其余页面未处理，请拆分后导入" : ""}`
      } else {
        result.text = `# ${filename}\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: ${data.numpages}]`
        result.warning = "扫描件 PDF，无法提取文本，页面渲染不可用"
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      logger.warn("pdf.render_failed", { filename, error: String(error) })
      result.text = `# ${filename}\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: ${data.numpages}]`
      result.warning = `扫描件 PDF，无法提取文本，页面渲染失败：${String(error)}`
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

export interface FileParseOptions { signal?: AbortSignal; timeoutMs?: number }

export async function parseFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  options: FileParseOptions = {},
): Promise<FileParseResponse> {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `文件 "${filename}" 过大 (${Math.round(buffer.length / 1024 / 1024)}MB)，最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB。浏览器「导入文件」上限 6MB；10MB 以内请改用「导入大文件」（Companion 原生选择）。`,
      filename,
      mimeType,
    }
  }

  const resolvedMime = getMimeType(filename, mimeType)

  const controller = new AbortController()
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 30_000
  const parentAbort = () => controller.abort(options.signal?.reason || new Error("文件解析已取消"))
  options.signal?.addEventListener("abort", parentAbort, { once: true })
  if (options.signal?.aborted) parentAbort()
  const timer = setTimeout(() => controller.abort(new Error(`文件 "${filename}" 解析超时 (${timeoutMs / 1000}s)`)), timeoutMs)
  try {
    controller.signal.throwIfAborted()
    const wpsError = unsupportedWpsError(filename)
    if (wpsError) throw new Error(wpsError)
    if (resolvedMime === "text/plain" || resolvedMime === "text/markdown") {
      return parseText(buffer, filename, resolvedMime)
    }

    if (resolvedMime === "text/csv") {
      return parseCsv(buffer, filename, resolvedMime)
    }

    if (resolvedMime === "application/pdf") {
      return await parsePdf(buffer, filename, resolvedMime, controller.signal)
    }

    if (isOfficeFormat(resolvedMime)) {
      return await parseOfficeFile(buffer, filename, resolvedMime, controller.signal)
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
      error: `文件解析失败: ${controller.signal.aborted ? String(controller.signal.reason) : err.message || String(err)}`,
      filename,
      mimeType: resolvedMime,
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", parentAbort)
  }
}
