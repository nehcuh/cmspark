// #611: exercise real parsers and native/WASM conversion in one serial suite.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import AdmZip from "adm-zip"
import { parseFile, type FileParseResult } from "../src/file-parser"
import { convertOfficeDocument, renderDocumentPages, __testOfficeRuntimeState } from "../src/office-runtime"

const fixtures = path.resolve(process.cwd(), "tests/fixtures/office-611")
const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(fixtures, name))
}

async function parsed(bytes: Buffer, name: string, mime = "application/octet-stream"): Promise<FileParseResult> {
  const result = await parseFile(bytes, name, mime)
  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.filename, name, "conversion must preserve source filename")
  assert.equal(result.fileSize, bytes.length, "conversion must preserve source byte length")
  return result
}

function officeZip(parts: Record<string, string>): Buffer {
  const zip = new AdmZip(undefined, { noSort: true })
  for (const [name, xml] of Object.entries(parts)) {
    zip.addFile(name, Buffer.from(xml))
    // ODF requires mimetype to be the first, uncompressed ZIP entry.
    if (name === "mimetype") zip.getEntry(name)!.header.method = 0
  }
  return zip.toBuffer()
}

/** Raw headers preserve traversal and ZIP64 fields that ZIP writers may normalize. */
function rawZip(opts: { name?: string; localExtra?: Buffer; centralExtra?: Buffer; expandedBytes?: number }): Buffer {
  const name = Buffer.from(opts.name || "content.xml")
  const localExtra = opts.localExtra || Buffer.alloc(0)
  const centralExtra = opts.centralExtra || Buffer.alloc(0)
  const local = Buffer.alloc(30 + name.length + localExtra.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(opts.expandedBytes || 0, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(localExtra.length, 28)
  name.copy(local, 30)
  localExtra.copy(local, 30 + name.length)
  const central = Buffer.alloc(46 + name.length + centralExtra.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt32LE(opts.expandedBytes || 0, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(centralExtra.length, 30)
  name.copy(central, 46)
  centralExtra.copy(central, 46 + name.length)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}

function repeatedNumericDocx(): Buffer {
  const paragraphs = ["重复业务正文", "12345", "重复业务正文", "67890", "重复业务正文"]
  return officeZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`,
  })
}

function twoSheetWorkbook(): Buffer {
  const stringCell = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
  const numberCell = (ref: string, value: number) => `<c r="${ref}"><v>${value}</v></c>`
  const worksheet = (rows: string) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
  return officeZip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="收入" sheetId="1" r:id="rId1"/><sheet name="Expenses" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": worksheet(`<row r="1">${stringCell("A1", "收入数值")}${stringCell("B1", "缓存合计")}</row><row r="2">${numberCell("A2", 17)}<c r="B2"><f>SUM(A2:A3)</f><v>42</v></c></row><row r="3">${numberCell("A3", 25)}</row>`),
    "xl/worksheets/sheet2.xml": worksheet(`<row r="1">${stringCell("A1", "Expense amount")}</row><row r="2">${numberCell("A2", -7.5)}</row><row r="3">${numberCell("A3", 12345)}</row>`),
  })
}

function twoSheetOds(): Buffer {
  const row = (text: string) => `<table:table-row><table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell></table:table-row>`
  const numericRow = (value: number) => `<table:table-row><table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell></table:table-row>`
  return officeZip({
    mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "META-INF/manifest.xml": '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="收入">${row("收入数值")}${numericRow(17)}${numericRow(25)}</table:table><table:table table:name="Expenses">${row("Expense amount")}${numericRow(-7.5)}${numericRow(12345)}</table:table></office:spreadsheet></office:body></office:document-content>`,
  })
}

/** Real PDF with valid xref offsets and colored geometry; no text operators. */
function scannedStylePdf(pageCount: number): Buffer {
  const pages = Array.from({ length: pageCount }, (_, i) => 3 + i * 2)
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map(n => `${n} 0 R`).join(" ")}] >>`,
  ]
  for (const page of pages) {
    const stream = "q 0.1 0.3 0.8 rg 20 20 80 60 re f Q\n"
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 108] /Resources << >> /Contents ${page + 1} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  }
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${value}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

test("#611 actual Office conversion, text integrity, refusal and rendering", { timeout: 240000 }, async t => {
  const cases = [
    ["one-page.doc", "application/msword", "2483a8cafde92910a0ea857cce49c07e6fa6bf58ab4a4f0852dfd2f488dedba1"],
    ["one-sheet.xls", "application/vnd.ms-excel", "311df8fcb797cfeffb552f254a054976ab61611d4a2cf68cd11f3ae7e2a73d37"],
    ["one-slide.ppt", "application/vnd.ms-powerpoint", "1f0eb633897433cbc7cf05e7ee99f43424205dddc180aff4c58c4b18964816ce"],
    ["one-sheet.ods", "application/vnd.oasis.opendocument.spreadsheet", "10d559250aa9022008cc4808f7ad9cd04c69e37f00cc5ec8648fd963666b6246"],
    ["one-slide.odp", "application/vnd.oasis.opendocument.presentation", "84846bd209b92baf5ad00261d17a8e4171297fd7a52bcff29908ce7ba1449ca5"],
  ]
  for (const [name, mime, hash] of cases) {
    await t.test(`${name}: real bytes retain English/Chinese text and original metadata`, async () => {
      const bytes = fixture(name)
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash)
      const result = await parsed(bytes, name)
      assert.equal(result.mimeType, mime)
      assert.match(result.text, /Office preview 中文文档/)
      assert.notEqual(result.requiresVision, true)
    })
  }

  await t.test("real DOCX retains all repeated paragraphs and standalone numbers", async () => {
    const result = await parsed(repeatedNumericDocx(), "重复正文.docx", WORD)
    assert.equal(result.mimeType, WORD)
    assert.equal(result.text.match(/重复业务正文/g)?.length, 3)
    assert.match(result.text, /12345/)
    assert.match(result.text, /67890/)
  })

  await t.test("real XLSX retains both worksheets, signed/decimal numbers and stored formula result", async () => {
    const result = await parsed(twoSheetWorkbook(), "两张表.xlsx", SHEET)
    for (const expected of ["收入数值", "缓存合计", "17", "25", "42", "Expense amount", "-7.5", "12345"]) {
      assert.ok(result.text.includes(expected), `missing ${expected}: ${result.text}`)
    }
  })

  await t.test("real ODS retains both worksheets and signed/decimal numbers", async () => {
    const result = await parsed(twoSheetOds(), "两张表.ods")
    assert.equal(result.mimeType, "application/vnd.oasis.opendocument.spreadsheet")
    for (const expected of ["收入数值", "17", "25", "Expense amount", "-7.5", "12345"]) {
      assert.ok(result.text.includes(expected), `missing ${expected}: ${result.text}`)
    }
  })

  await t.test("WPS/ET/DPS are refused even when renamed bytes form valid standard Office", async () => {
    for (const [name, bytes] of [["renamed.wps", fixture("one-page.doc")], ["renamed.et", fixture("one-sheet.xls")], ["renamed.dps", fixture("one-slide.ppt")]] as const) {
      const result = await parseFile(bytes, name, "application/octet-stream")
      assert.equal(result.success, false)
      if (!result.success) assert.match(result.error, /另存/)
    }
    assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
  })

  await t.test("malformed expected ZIP and unsafe ODP are rejected before conversion", async () => {
    for (const [bytes, name] of [[Buffer.from("not an Office ZIP"), "bad.odp"], [rawZip({ name: "../escape.xml" }), "unsafe.odp"]] as const) {
      const result = await parseFile(bytes, name, "application/octet-stream")
      assert.equal(result.success, false)
      if (!result.success) assert.match(result.error, /ZIP|zip|Office|路径|容器|条目/)
      assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
    }
  })

  await t.test("both central and local ZIP64 extras are refused before any ZIP consumer", async () => {
    const extra = Buffer.alloc(12)
    extra.writeUInt16LE(1, 0) // ZIP64 extended information
    extra.writeUInt16LE(8, 2)
    for (const [where, bytes] of [
      ["central", rawZip({ centralExtra: extra })],
      ["local", rawZip({ localExtra: extra })],
      ["sentinel", rawZip({ expandedBytes: 0xffffffff })],
    ] as const) {
      const result = await parseFile(bytes, `${where}.odp`, "application/octet-stream")
      assert.equal(result.success, false)
      if (!result.success) assert.match(result.error, /ZIP64/)
      assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
    }
  })

  await t.test("declared ZIP expansion above 100MiB is refused before inflation", async () => {
    const result = await parseFile(rawZip({ expandedBytes: 100 * 1024 * 1024 + 1 }), "archive-limit.odp", "application/octet-stream")
    assert.equal(result.success, false)
    if (!result.success) assert.match(result.error, /解压大小超过预算/)
    assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
  })

  await t.test("small compressed Office input cannot inflate an over-budget embedded image", async () => {
    const zip = new AdmZip(repeatedNumericDocx())
    // Compression keeps the upload far below 10 MiB; its image expands beyond 8 MiB.
    const image = Buffer.alloc(8 * 1024 * 1024 + 1)
    Buffer.from("89504e470d0a1a0a", "hex").copy(image)
    zip.addFile("word/media/oversized.png", image)
    const bytes = zip.toBuffer()
    assert.ok(bytes.length < 100_000)
    const result = await parseFile(bytes, "image-limit.docx", WORD)
    assert.equal(result.success, false)
    if (!result.success) assert.match(result.error, /图片|image|预算|大小|限制/i)
    assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
  })

  await t.test("real PDF with Linux WPS MIME alias reaches the standard PDF parser", async () => {
    const result = await parsed(scannedStylePdf(1), "WPS-export.pdf", "application/wps-office.pdf")
    assert.equal(result.mimeType, "application/pdf")
    assert.equal(result.pageCount, 1)
    assert.equal(result.requiresVision, true)
    assert.equal(result.embeddedImages?.length, 1)
  })

  await t.test("11-page vector-only PDF needs vision and renders only 10 pages", async () => {
    const result = await parsed(scannedStylePdf(11), "扫描示例.pdf")
    assert.equal(result.mimeType, "application/pdf")
    assert.equal(result.pageCount, 11)
    assert.equal(result.requiresVision, true)
    assert.equal(result.embeddedImages?.length, 10)
    assert.match(result.warning || "", /10/)
    assert.match(result.text + result.warning, /11/)
    for (const image of result.embeddedImages || []) {
      assert.equal(image.format, "png")
      assert.ok(image.width > 0 && image.height > 0)
      assert.equal(Buffer.from(image.base64, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
    }
    assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
  })

  await t.test("PDF parsing accepts both zero-offset Buffer and nonzero-offset Buffer views", async () => {
    const pdf = scannedStylePdf(1)
    const zero = Buffer.alloc(pdf.length)
    pdf.copy(zero)
    const backing = Buffer.alloc(pdf.length + 16)
    pdf.copy(backing, 8)
    const view = backing.subarray(8, 8 + pdf.length)
    assert.equal(zero.byteOffset, 0)
    assert.equal(view.byteOffset, 8)
    for (const [name, bytes] of [["zero.pdf", zero], ["view.pdf", view]] as const) {
      const result = await parsed(bytes, name)
      assert.equal(result.pageCount, 1)
      assert.equal(result.requiresVision, true)
      assert.equal(result.embeddedImages?.length, 1)
    }
  })

  await t.test("aborting an admitted real conversion disposes work and removes failed output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-office-test-"))
    const source = path.join(dir, "input.doc")
    const output = path.join(dir, "output.docx")
    fs.writeFileSync(source, fixture("one-page.doc"))
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const operation = convertOfficeDocument(source, output, controller.signal)
      assert.equal(__testOfficeRuntimeState().active, 1, "operation must be admitted before cancellation")
      timer = setTimeout(() => controller.abort(new Error("office test running cancellation")), 100)
      await assert.rejects(operation, /abort|cancel|cancell|取消/i)
      assert.equal(fs.existsSync(output), false)
      assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
      assert.deepEqual(fs.readdirSync(dir), ["input.doc"])
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await t.test("parser deadline cancels actual legacy conversion and returns after engine disposal", async () => {
    const result = await parseFile(fixture("one-page.doc"), "deadline.doc", "application/msword", { timeoutMs: 100 })
    assert.equal(result.success, false)
    if (!result.success) assert.match(result.error, /超时|timeout/i)
    assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
  })

  await t.test("real PDF renderer cleans private output directory after successful render", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-office-test-"))
    const source = path.join(dir, "input.pdf")
    fs.writeFileSync(source, scannedStylePdf(1))
    try {
      const result = await renderDocumentPages(source, 1, new AbortController().signal)
      assert.equal(result.pageCount, 1)
      assert.equal(result.pages.length, 1)
      assert.deepEqual(fs.readdirSync(dir), ["input.pdf"])
      assert.deepEqual(__testOfficeRuntimeState(), { active: 0, pending: 0 })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
