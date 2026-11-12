import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import AdmZip from "adm-zip"
import { parseFile } from "../src/file-parser"
import { isWpsWithWordDocContent, padWordDocFinalSector } from "../src/wps-doc"

const fixture = fs.readFileSync(path.resolve(process.cwd(), "tests/fixtures/office-611/one-page.doc"))

/** Move the real fixture's table out of the mini stream into a final regular stream. */
function wordWithShortFinalTable(): Buffer {
  const sector = (index: number) => fixture.subarray((index + 1) * 512, (index + 2) * 512)
  const fat = sector(fixture.readUInt32LE(76))
  function chain(start: number, allocation: Buffer, read: (index: number) => Buffer): Buffer {
    const parts: Buffer[] = []
    for (let i = start; i !== 0xfffffffe; i = allocation.readUInt32LE(i * 4)) parts.push(read(i))
    return Buffer.concat(parts)
  }
  const directoryStart = fixture.readUInt32LE(48)
  const directory = sector(directoryStart)
  const root = directory.subarray(0, 128)
  const miniStream = chain(root.readUInt32LE(116), fat, sector)
  const miniFat = chain(fixture.readUInt32LE(60), fat, sector)
  let tableOffset = -1
  for (let offset = 128; offset < directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64)
    const name = directory.toString("utf16le", offset, offset + Math.max(0, nameLength - 2))
    if (name === "1Table") tableOffset = offset
  }
  assert.ok(tableOffset > 0)
  const entry = directory.subarray(tableOffset, tableOffset + 128)
  const table = chain(entry.readUInt32LE(116), miniFat, i => miniStream.subarray(i * 64, (i + 1) * 64))
  const tableSize = 4097 // final sector contains one declared byte and 511 unused bytes
  const result = Buffer.concat([fixture, Buffer.alloc(tableSize)])
  const firstSector = fixture.length / 512 - 1
  table.subarray(0, entry.readUInt32LE(120)).copy(result, fixture.length)
  const entryOffset = (directoryStart + 1) * 512 + tableOffset
  result.writeUInt32LE(firstSector, entryOffset + 116)
  result.writeUInt32LE(tableSize, entryOffset + 120)
  const fatOffset = (fixture.readUInt32LE(76) + 1) * 512
  for (let i = 0; i < 9; i++) {
    result.writeUInt32LE(i === 8 ? 0xfffffffe : firstSector + i + 1, fatOffset + (firstSector + i) * 4)
  }
  return result
}

function docxWithLists(): Buffer {
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  const paragraph = (id: number, level: number, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
  zip.addFile("word/document.xml", Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(0, -1, "取消编号正文 12345")}${paragraph(1, -1, "负层级列表 67890")}${paragraph(1, 1, "正常嵌套列表")}</w:body></w:document>`))
  return zip.toBuffer()
}

test("DOC restores missing final-sector padding only after validating declared streams and Word text", async () => {
  const short = wordWithShortFinalTable()
  const original = Buffer.from(short)
  const padded = padWordDocFinalSector(short)
  assert.equal(padded.length, short.length + 511)
  assert.deepEqual(padded.subarray(0, short.length), original)
  assert.deepEqual(short, original, "normalization must not change uploaded bytes")
  assert.ok(isWpsWithWordDocContent(padded))
  assert.equal(padWordDocFinalSector(padded), padded)
  assert.equal(padWordDocFinalSector(fixture), fixture)

  const result = await parseFile(short, "short-padding.doc", "application/msword")
  assert.equal(result.success, true, JSON.stringify(result))
  if (result.success) {
    assert.match(result.text, /Office preview 中文文档/)
    assert.equal(result.fileSize, short.length)
    assert.equal(result.filename, "short-padding.doc")
  }

  // Removing even one declared byte is data truncation, not missing padding.
  const truncated = short.subarray(0, short.length - 1)
  assert.equal(padWordDocFinalSector(truncated), truncated)
  const rejected = await parseFile(short.subarray(0, short.length - 2), "truncated.doc", "application/msword")
  assert.equal(rejected.success, false)
  const badHeader = Buffer.from(short)
  badHeader.writeUInt16LE(0, 28)
  assert.equal(padWordDocFinalSector(badHeader), badHeader)
  const encrypted = Buffer.from(short)
  const fib = encrypted.indexOf(Buffer.from("eca50101", "hex"))
  assert.ok(fib > 0)
  encrypted.writeUInt16LE(encrypted.readUInt16LE(fib + 10) | 0x100, fib + 10)
  assert.equal(padWordDocFinalSector(encrypted), encrypted)
  assert.equal(isWpsWithWordDocContent(short), false, "WPS admission keeps its existing strict contract")
})

test("DOCX negative list levels preserve unnumbered text, formatting and valid nesting", async () => {
  const result = await parseFile(docxWithLists(), "list-levels.docx", "application/octet-stream")
  assert.equal(result.success, true, JSON.stringify(result))
  if (result.success) {
    assert.match(result.text, /^\*\*取消编号正文 12345\*\*$/m)
    assert.match(result.text, /^1\. \*\*负层级列表 67890\*\*$/m)
    assert.match(result.text, /^ {4}1\. \*\*正常嵌套列表\*\*$/m)
  }
})
