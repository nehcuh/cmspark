declare module "pdf-parse" {
  interface PdfData {
    numpages: number
    numrender: number
    info: Record<string, any>
    metadata: string | null
    text: string
    version: string
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, any>,
  ): Promise<PdfData>

  export default pdfParse
}
