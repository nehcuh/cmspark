// PDF page renderer — renders scanned PDF pages to PNG for vision analysis

import { logger } from "./logger"

export interface RenderedPage {
  base64: string
  pageNumber: number
  width: number
  height: number
}

const MAX_PDF_PAGES = 10

/**
 * Render PDF pages to PNG base64 images for vision analysis.
 * Uses dynamic imports so missing canvas/pdfjs gracefully degrades.
 */
export async function renderPdfPages(buffer: Buffer): Promise<RenderedPage[]> {
  const pages: RenderedPage[] = []

  try {
    const pdfjsLib = await import("pdfjs-dist")
    const { createCanvas } = await import("canvas")

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    })
    const doc = await loadingTask.promise
    const totalPages = Math.min(doc.numPages, MAX_PDF_PAGES)

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await doc.getPage(i)
        const viewport = page.getViewport({ scale: 1.5 })

        const canvas = createCanvas(viewport.width, viewport.height)
        const context = canvas.getContext("2d")

        await page.render({ canvasContext: context, viewport }).promise

        const pngBuffer: Buffer = canvas.toBuffer("image/png")
        const base64 = pngBuffer.toString("base64")

        pages.push({
          base64,
          pageNumber: i,
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
        })
      } catch (pageErr) {
        logger.warn("pdf.render_page_failed", { page: i, error: String(pageErr) })
        continue
      }
    }

    await doc.destroy()
  } catch (err) {
    logger.warn("pdf.render_failed", { error: String(err) })
  }

  return pages
}
