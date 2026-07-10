import test from "node:test"
import assert from "node:assert/strict"

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * Build a minimal zip buffer (central directory file header + EOCD) with one entry of the given
 * raw name. Hand-crafted because adm-zip normalizes "../" away on read AND write — it can neither
 * detect nor construct a real zip-slip archive. EOCD is included so rawZipEntries (which locates
 * the central directory via EOCD) actually walks the entry. Optionally mark the entry a Unix
 * symlink via external attributes (the link vector of GHSA-mp2f-45pm-3cg9).
 */
function buildOfficeZipBuffer(opts: { name: string; symlink?: boolean }): Buffer {
  const nameBytes = Buffer.from(opts.name, "utf8")
  // Central directory file header: signature (4) + 42 bytes fields + name. Total 46 + nameLen.
  const cd = Buffer.alloc(46 + nameBytes.length)
  cd.writeUInt32LE(0x02014b50, 0) // signature PK\x01\x02
  cd.writeUInt16LE(nameBytes.length, 28) // file name length
  if (opts.symlink) {
    // external file attributes: high 16 bits = unix mode; 0o120000 = symlink
    cd.writeUInt32LE((0o120000 << 16) >>> 0, 38)
  }
  cd.set(nameBytes, 46)
  // End of central directory record (22 bytes). CD sits at offset 0.
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // signature PK\x05\x06
  eocd.writeUInt16LE(1, 10) // total central directory entries
  eocd.writeUInt32LE(cd.length, 12) // size of central directory
  eocd.writeUInt32LE(0, 16) // offset of start of central directory
  return Buffer.concat([cd, eocd])
}

// P0-5 / audit C4 regression: office files are zip archives; officeparser decompresses them
// internally via `decompress` (GHSA-mp2f-45pm-3cg9 — extraction can write files/symlinks outside
// the target dir → arbitrary file write / RCE on the user-upload path). The raw central-directory
// pre-flight in parseOfficeFile must reject traversal AND symlink entries BEFORE officeparser.
test("parseFile rejects office zip with a `..` path component (audit C4 / P0-5)", async () => {
  const { parseFile } = await import("../src/file-parser")
  const result = await parseFile(buildOfficeZipBuffer({ name: "../evil-payload.txt" }), "evil.docx", DOCX_MIME)
  assert.equal(result.success, false, "zip-slip office file must be rejected before officeparser")
  assert.match((result as { error: string }).error, /zip-slip|路径穿越/)
})

test("parseFile does NOT flag a benign double-dot filename as zip-slip (no false positive)", async () => {
  const { parseFile } = await import("../src/file-parser")
  // `budget..2025.xml` has two dots inside a name component but no `..` component — must NOT trip
  // the pre-flight. It will fail later in officeparser (not a real docx body); we only assert the
  // failure is not attributed to zip-slip.
  const result: any = await parseFile(buildOfficeZipBuffer({ name: "budget..2025.xml" }), "ok.docx", DOCX_MIME)
  assert.ok(
    !/zip-slip|路径穿越/.test(result.error || ""),
    "benign double-dot filename must not trip the zip-slip pre-flight",
  )
})

test("parseFile rejects office zip with a symlink entry (CVE link vector)", async () => {
  const { parseFile } = await import("../src/file-parser")
  // Safe-looking name, but the entry is a Unix symlink — its target can escape the extraction dir
  // even with a benign name (the link half of GHSA-mp2f-45pm-3cg9).
  const result = await parseFile(
    buildOfficeZipBuffer({ name: "word/document.xml", symlink: true }),
    "link.docx",
    DOCX_MIME,
  )
  assert.equal(result.success, false, "symlink office entry must be rejected")
  assert.match((result as { error: string }).error, /zip-slip|符号链接/)
})
