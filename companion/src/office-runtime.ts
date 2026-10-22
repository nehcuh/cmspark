// Local, caller-owned Office/PDF compatibility operations. No WS path API.
import * as fs from "node:fs"
import * as path from "node:path"
import { createRequire } from "node:module"
import type { Converter } from "@deepseek-ai/libreoffice-kit"

export const OFFICE_OUTPUT_MAX_BYTES = 32 * 1024 * 1024
export const OFFICE_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024
export const OFFICE_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const OFFICE_IMAGES_MAX_BYTES = 16 * 1024 * 1024
export const DOCUMENT_PAGE_LIMIT = 10
const MAX_ACTIVE = 2
const MAX_PENDING = 8
let active = 0
type Waiter = { resolve: (release: () => void) => void; reject: (error: unknown) => void; signal: AbortSignal; abort: () => void }
const pending: Waiter[] = []

function releaseSlot(): void {
  active--
  const next = pending.shift()
  if (next) {
    next.signal.removeEventListener("abort", next.abort)
    active++
    next.resolve(releaseSlot)
  }
}

async function acquireSlot(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  if (active < MAX_ACTIVE) { active++; return releaseSlot }
  if (pending.length >= MAX_PENDING) throw new Error("文档转换队列已满，请稍后重试。")
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal, abort: () => {
      const index = pending.indexOf(waiter)
      if (index >= 0) pending.splice(index, 1)
      reject(signal.reason)
    } }
    pending.push(waiter)
    signal.addEventListener("abort", waiter.abort, { once: true })
  })
}

type Kit = typeof import("@deepseek-ai/libreoffice-kit")
let kit: Kit | undefined
function loadKit(): Kit {
  if (kit) return kit
  try { kit = require("@deepseek-ai/libreoffice-kit") as Kit }
  catch (firstError) {
    try { kit = createRequire(process.execPath)("@deepseek-ai/libreoffice-kit") as Kit }
    catch { throw new Error(`本地 Office 引擎不可用，请安装完整版 CMspark（需要 Node.js 22.23.4 或更新的 22.x 安全版本）。${String(firstError)}`) }
  }
  return kit
}

async function withConverter<T>(signal: AbortSignal, operation: (converter: Converter) => Promise<T>): Promise<T> {
  const release = await acquireSlot(signal)
  let converter: Converter | undefined
  try {
    signal.throwIfAborted()
    converter = await loadKit().createConverter({
      timeoutMs: 30_000,
      maxInputBytes: OFFICE_OUTPUT_MAX_BYTES,
      maxOutputBytes: OFFICE_OUTPUT_MAX_BYTES,
      maxArchiveEntries: 20_000,
      maxUncompressedBytes: OFFICE_ARCHIVE_MAX_BYTES,
      maxFontFiles: 20_000,
      maxFontFileBytes: 32 * 1024 * 1024,
      maxLoadedFontBytes: 128 * 1024 * 1024,
    })
    signal.throwIfAborted()
    return await operation(converter)
  } catch (error: any) {
    if (signal.aborted) throw signal.reason
    if (error?.code === "unavailable") {
      throw new Error(`本地 Office 引擎不可用，请检查完整安装和系统字体；Windows 还需要对应架构的 Microsoft VC++ v14 运行库。${error.message}`)
    }
    throw error
  } finally {
    try { await converter?.dispose() }
    finally { release() }
  }
}

export function convertOfficeDocument(inputPath: string, outputPath: string, signal: AbortSignal): Promise<{ missingFonts: string[] }> {
  return withConverter(signal, converter => converter.convert({ inputPath, outputPath }, signal))
}

export interface DocumentPage {
  base64: string
  pageNumber: number
  width: number
  height: number
}

export async function renderDocumentPages(inputPath: string, pageCount: number | undefined, signal: AbortSignal): Promise<{ pages: DocumentPage[]; pageCount: number }> {
  // Kit requires a fresh output directory; caller owns the containing private directory.
  const renderRoot = fs.mkdtempSync(path.join(path.dirname(inputPath), "render-"))
  const outputDir = path.join(renderRoot, "pages")
  try {
    return await withConverter(signal, async converter => {
      const result = await converter.renderImages({
        inputPath, outputDir,
        ...(pageCount ? { pages: Array.from({ length: Math.min(pageCount, DOCUMENT_PAGE_LIMIT) }, (_, i) => i + 1) } : {}),
        maxPages: DOCUMENT_PAGE_LIMIT,
        dpi: 96,
        maxPixels: 4 * 1024 * 1024,
        maxDimension: 4096,
      }, signal)
      let totalBytes = 0
      const pages: DocumentPage[] = []
      for (const image of result.images) {
        signal.throwIfAborted()
        const size = fs.statSync(image.path).size
        totalBytes += size
        if (size > OFFICE_IMAGE_MAX_BYTES || totalBytes > OFFICE_IMAGES_MAX_BYTES) throw new Error("页面图片超过文档解析预算，请拆分文件后导入。")
        pages.push({ base64: fs.readFileSync(image.path).toString("base64"), pageNumber: image.page || image.index, width: image.width, height: image.height })
      }
      return { pages, pageCount: result.pageCount }
    })
  } finally {
    // withConverter awaits the engine exit even after cancellation.
    fs.rmSync(renderRoot, { recursive: true, force: true })
  }
}

export function __testOfficeRuntimeState(): { active: number; pending: number } {
  return { active, pending: pending.length }
}
