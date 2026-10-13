// PDF page renderer — renders scanned PDF pages to PNG for vision analysis

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { renderDocumentPages } from "./office-runtime"

export interface RenderedPage {
  base64: string
  pageNumber: number
  width: number
  height: number
}

/** The engine exits before its caller-owned private directory is removed. */
export async function renderPdfPages(buffer: Buffer, signal: AbortSignal, pageCount?: number): Promise<RenderedPage[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pdf-"))
  try {
    signal.throwIfAborted()
    const inputPath = path.join(tmpDir, "input.pdf")
    fs.writeFileSync(inputPath, buffer)
    return (await renderDocumentPages(inputPath, pageCount, signal)).pages
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
