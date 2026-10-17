import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import AdmZip from "adm-zip"
import { validateOdfExpansion } from "../src/odf-expansion"
import { parseFile } from "../src/file-parser"
import { OfficeParser } from "officeparser"

const TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
const DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
const mime = (kind: string) => `application/vnd.oasis.opendocument.${kind === "ods" ? "spreadsheet" : kind === "odp" ? "presentation" : "text"}`

function xml(body: string, kind = "ods"): string {
  const tag = kind === "ods" ? "spreadsheet" : kind === "odp" ? "presentation" : "text"
  return `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="${TABLE}" xmlns:text="${TEXT}" xmlns:draw="${DRAW}" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2"><office:body><office:${tag}>${body}</office:${tag}></office:body></office:document-content>`
}

function zip(content: string, kind = "ods", extra: Record<string, string> = {}): Buffer {
  const archive = new AdmZip(undefined, { noSort: true })
  for (const [name, value] of Object.entries({ mimetype: mime(kind), "content.xml": content, ...extra })) {
    archive.addFile(name, Buffer.from(value))
    if (name === "mimetype") archive.getEntry(name)!.header.method = 0
  }
  return archive.toBuffer()
}

const cell = (cols = "1", text = "marker") => `<table:table-cell table:number-columns-repeated="${cols}"><text:p>${text}</text:p></table:table-cell>`
const row = (cells: string, rows = "1") => `<table:table-row table:number-rows-repeated="${rows}">${cells}</table:table-row>`
const table = (rows: string) => `<table:table table:name="Sheet">${rows}</table:table>`
const refused = (body: string, kind = "ods", extra: Record<string, string> = {}) => assert.throws(() => validateOdfExpansion(zip(xml(body, kind), kind, extra), kind), /ODF 文档展开/)

test("tiny 100k-column ODS is refused before real parser expansion in a bounded child", () => {
  const bytes = zip(xml(table(row(cell("100000")))))
  assert.ok(bytes.length < 2000)
  const parser = path.join(__dirname, "../src/file-parser.js")
  const child = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", `
    require(${JSON.stringify(parser)}).parseFile(Buffer.from(process.argv[1], 'base64'), 'tiny.ods', ${JSON.stringify(mime("ods"))}, {timeoutMs: 1000}).then(result => {
      if (result.success || !/ODF 文档展开.*列循环/.test(result.error || '')) process.exitCode = 1;
      console.log(JSON.stringify({success: result.success, error: result.error}));
    });`, bytes.toString("base64")], { encoding: "utf8", timeout: 1500, killSignal: "SIGKILL", maxBuffer: 16 * 1024 })
  assert.equal(child.error, undefined, String(child.error))
  assert.equal(child.status, 0, child.stderr + child.stdout)
  assert.match(child.stdout, /列循环/)
})

test("legal repeats preserve six cells; million blank ODS tail rows remain supported", async () => {
  const bytes = zip(xml(table(row(cell("2"), "3") + row("<table:table-cell/>", "1048576") + row("<table:table-cell><text:p/></table:table-cell>", "1048576"))))
  validateOdfExpansion(bytes, "ods")
  const result = await parseFile(bytes, "legal.ods", mime("ods"))
  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.text?.match(/marker/g)?.length, 6)
})

test("ODT and ODP repeat costs include empty rows, nested tables and text:s", () => {
  for (const kind of ["odt", "odp"]) {
    refused(table(row(cell("100000"))), kind)
    refused(table(row("<table:table-cell/>", "100001")), kind)
    refused(table(row(`<table:table-cell>${table(row(cell("200"), "200"))}</table:table-cell>`, "5")), kind)
    refused("<text:p><text:s text:c=\"100000000\"/></text:p>", kind)
    validateOdfExpansion(zip(xml(table(row(cell("2"), "3")), kind), kind), kind)
  }
})

test("empty spans and paragraph newlines materialize repeated ODS rows", () => {
  assert.throws(() => validateOdfExpansion(zip(xml(table(row("<table:table-cell><text:p><text:span/></text:p></table:table-cell>", "100000")))), "ods"), /展开节点|展开文本/)
  assert.throws(() => validateOdfExpansion(zip(xml(table(row("<table:table-cell><text:p/><text:p/></table:table-cell>", "100000")))), "ods"), /展开节点|展开文本/)
})

test("all repetition attributes require positive safe integers after entity decoding", () => {
  for (const count of ["0", "-1", "NaN", "Infinity", "1e309", "1.5", "10junk", "9007199254740992", "9".repeat(309), "&#x39;007199254740992"]) {
    refused(table(row(cell(count))))
    refused(table(row("<table:table-cell/>", count)))
    refused(`<text:p><text:s text:c="${count}"/></text:p>`, "odt")
  }
  refused(table(row("<table:table-cell/>", "9007199254740991") + row("<table:table-cell/>")))
})

test("global budget applies across sheets, descendant cells and embedded XML", () => {
  refused(Array.from({ length: 3 }, () => table(row(cell("20000", "")))).join(""))
  refused(table(row(`<text:section>${cell("100000")}</text:section>`)))
  refused(table(row(`<table:table-cell>${table(row(cell()))}</table:table-cell>`)))
  refused(table(row(cell())), "odt", { "Object 1/content.xml": xml('<text:p><text:s text:c="100000000"/></text:p>', "odt") })
  refused(table(row('<table:table-cell><draw:frame><draw:object/></draw:frame></table:table-cell>', "2")))
})

test("container and namespace matching cannot bypass ODS empty-row exemption", () => {
  assert.throws(() => validateOdfExpansion(zip(xml(table(row("<table:table-cell/>", "1000000"))), "ods", { mimetype: mime("odt") }), "ods"), /容器类型/)
  const noMain = new AdmZip()
  noMain.addFile("mimetype", Buffer.from(mime("ods")))
  noMain.addFile("Object/content.xml", Buffer.from(xml(table(row(cell())))))
  assert.throws(() => validateOdfExpansion(noMain.toBuffer(), "ods"), /主文档/)
  for (const prefix of ["table", "text", "draw"]) {
    const body = table(row('<table:table-cell><text:p><text:span/></text:p><draw:frame><draw:image/></draw:frame></table:table-cell>', "1000000"))
    const wrong = xml(body).replace(`xmlns:${prefix}="${prefix === "table" ? TABLE : prefix === "text" ? TEXT : DRAW}"`, `xmlns:${prefix}="invalid"`)
    assert.throws(() => validateOdfExpansion(zip(wrong), "ods"), /命名空间/)
  }
  refused('<table><table-row table:number-rows-repeated="1000000"><table-cell><p><span/></p></table-cell></table-row></table>')
})

test("DOM reads XML structure and enforces total XML bytes without expanding comments", () => {
  validateOdfExpansion(zip(xml(`<!-- ${table(row(cell("100000000")))} -->${table(row(cell()))}`)), "ods")
  assert.throws(() => validateOdfExpansion(zip(xml(table(row(cell()))), "ods", { "Object/content.xml": " ".repeat(8 * 1024 * 1024) }), "ods"), /XML 内容大小/)
  const bom = "\uFEFF" + xml(table(row(cell())))
  validateOdfExpansion(zip(bom), "ods")
})

test("malformed XML, including DOM warnings, has one fixed Chinese refusal", async () => {
  const message = "ODF 文档展开超过解析预算或格式无效（XML 损坏），请拆分文档或另存为标准 Office 文件。"
  for (const body of [
    '<invalid:p>marker</invalid:p>', // undeclared namespace: DOM fatalError
    '<text:p text:a="1" text:a="2">marker</text:p>', // duplicate attribute: DOM fatalError
    '<text:p text:a=unquoted>marker</text:p>', // DOM warning remains a refusal
    '<text:p>marker</text:span>',
  ]) {
    const bytes = zip(xml(body, "odt"), "odt")
    assert.throws(() => validateOdfExpansion(bytes, "odt"), error => error instanceof Error && error.message === message)
    const result = await parseFile(bytes, "malformed.odt", mime("odt"))
    assert.equal(result.success, false)
    if (!result.success) assert.equal(result.error, `文件解析失败: ${message}`)
  }
})

// Synthetic minimal XML, observed through the locked officeparser producer.
// These are compatibility/cost probes, not authorized business-document fixtures.
test("real ODT producer emits text:s spaces without its invalid child text", async () => {
  const bytes = zip(xml('<text:p>before<text:s text:c="2"><text:span>CHILD_MARKER</text:span></text:s>after</text:p>', "odt"), "odt")
  validateOdfExpansion(bytes, "odt")
  const ast = await OfficeParser.parseOffice(bytes, { fileType: "odt", extractAttachments: true })
  assert.equal(ast.toText(), "before  after")
  assert.equal(ast.toText().includes("CHILD_MARKER"), false)
  const result = await parseFile(bytes, "spaces.odt", mime("odt"))
  assert.equal(result.success, true, JSON.stringify(result))
  if (result.success) {
    assert.match(result.text, /before\s{2}after/)
    assert.equal(result.text.includes("CHILD_MARKER"), false)
  }
})

test("real ODS producer materializes paragraph newlines but not bare frames; frame costing stays conservative", async () => {
  const newline = zip(xml(table(row('<table:table-cell><text:p/><text:p/></table:table-cell>', "2"))))
  validateOdfExpansion(newline, "ods")
  const ast = await OfficeParser.parseOffice(newline, { fileType: "ods" })
  assert.equal(ast.toText(), "\n\n\n")
  assert.equal(ast.content[0]?.children?.length, 2)
  assert.deepEqual(ast.content[0]?.children?.map(r => r.children?.[0]?.text), ["\n", "\n"])
  const frame = zip(xml(table(row('<table:table-cell><draw:frame/></table:table-cell>', "2"))))
  validateOdfExpansion(frame, "ods")
  const frameAst = await OfficeParser.parseOffice(frame, { fileType: "ods", extractAttachments: true })
  assert.equal(frameAst.toText(), "")
  assert.deepEqual(frameAst.content[0]?.children, [])
  assert.deepEqual(frameAst.attachments, [])
  assert.throws(() => validateOdfExpansion(zip(xml(table(row('<table:table-cell><draw:frame/></table:table-cell>', "100000")))), "ods"), /展开节点|展开文本/)
  assert.throws(() => validateOdfExpansion(zip(xml(table(row('<table:table-cell><text:p/><text:p/></table:table-cell>', "100000")))), "ods"), /展开节点|展开文本/)
})

test("synthetic two-sheet column boundary is measured in a bounded real-parser child", t => {
  const sheet = (name: string, blank: number) => `<table:table table:name="${name}">${row(cell("1", name) + '<table:table-cell table:number-columns-repeated="' + blank + '"/>')}</table:table>`
  const bytes = zip(xml(sheet("First", 24999) + sheet("Second", 24999)))
  validateOdfExpansion(bytes, "ods") // 50,000 global column iterations, including blanks.
  assert.throws(() => validateOdfExpansion(zip(xml(sheet("First", 24999) + sheet("Second", 25000))), "ods"), /列循环/)
  const parser = path.join(__dirname, "../src/file-parser.js")
  const child = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", `
    const started = performance.now();
    require(${JSON.stringify(parser)}).parseFile(Buffer.from(process.argv[1], 'base64'), 'synthetic-two-sheet.ods', ${JSON.stringify(mime("ods"))}).then(result => {
      const retained = result.success && result.text.includes('First') && result.text.includes('Second');
      if (!retained) process.exitCode = 1;
      console.log(JSON.stringify({provenance: 'synthetic-two-sheet', success: result.success, retained,
        elapsed_ms: performance.now() - started, max_rss_kib: process.resourceUsage().maxRSS}));
    });`, bytes.toString("base64")], { encoding: "utf8", timeout: 6000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 })
  assert.equal(child.error, undefined, String(child.error))
  assert.equal(child.status, 0, child.stderr + child.stdout)
  const observation = JSON.parse(child.stdout.trim().split("\n").pop()!)
  assert.equal(observation.retained, true)
  assert.ok(observation.elapsed_ms >= 0 && observation.max_rss_kib > 0)
  t.diagnostic(JSON.stringify(observation))
})

test("independent references and nested frames cannot repeatedly expand external MathML", async () => {
  const frame = '<draw:frame><draw:object xlink:href="./Object 1"/></draw:frame>'
  const object = '<math><mi>' + 'a'.repeat(100000) + '</mi></math>'
  const body = table(row(`<table:table-cell>${frame.repeat(90)}</table:table-cell>`))
  const bytes = zip(xml(body), "ods", { "Object 1/content.xml": object })
  const result = await parseFile(bytes, "objects.ods", mime("ods"))
  assert.equal(result.success, false)
  assert.match(result.error || "", /重复引用的嵌入对象/)
  validateOdfExpansion(zip(xml(table(row(`<table:table-cell>${frame}</table:table-cell>`))), "ods", { "Object 1/content.xml": object }), "ods")
  const alias = frame.replace("./Object 1", "path/Object 1/")
  refused(table(row(`<table:table-cell>${frame}${alias}</table:table-cell>`)), "ods", { "Object 1/content.xml": object })
  refused(table(row(`<table:table-cell><draw:frame>${frame}</draw:frame></table:table-cell>`)), "ods", { "Object 1/content.xml": object })
})

function chartDocument(header: string, rows: string): string {
  return `<office:document-content xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="${TABLE}" xmlns:text="${TEXT}"><office:body><office:chart><chart:chart><table:table><table:table-header-rows>${row(header)}</table:table-header-rows>${rows}</table:table></chart:chart></office:chart></office:body></office:document-content>`
}

function chartZip(chart: string, kind = "odt"): Buffer {
  const frame = '<draw:frame><draw:object xlink:href="./Object 1"/></draw:frame>'
  const body = kind === "ods" ? table(row(`<table:table-cell>${frame}</table:table-cell>`)) : frame
  return zip(xml(body, kind), kind, { "Object 1/content.xml": chart })
}

test("chart attribute and text values incur the same repeated text budget", async () => {
  const repeat = "5000", value = "x".repeat(2000)
  const header = cell() + cell(repeat, "series")
  for (const kind of ["odt", "ods"]) {
    for (const attribute of [true, false]) {
      const data = attribute ? `<table:table-cell table:number-columns-repeated="${repeat}" office:value="${value}"/>` : cell(repeat, value)
      const bytes = chartZip(chartDocument(header, row(cell() + data)), kind)
      assert.ok(bytes.length < 3000)
      const result = await parseFile(bytes, `attribute.${kind}`, mime(kind))
      assert.equal(result.success, false, JSON.stringify(result))
      assert.match(result.error || "", /(?:图表)?展开文本/)
    }
  }
})

test("chart label broadcasting and range references have their own admission checks", () => {
  const chart = chartDocument(cell() + cell("24000", "S"), row(cell("1", "L".repeat(400)) + cell("1", "1")))
  assert.throws(() => validateOdfExpansion(chartZip(chart, "ods"), "ods"), /图表展开文本/)
  const rangeValue = chartDocument(cell() + cell(), row(cell("1", "label") + '<table:table-cell office:value="[Sheet.$A$1:.$A$100]"/>'))
  assert.throws(() => validateOdfExpansion(chartZip(rangeValue, "ods"), "ods"), /图表范围引用/)
  for (const prefix of ["office", "chart"]) {
    const wrong = chartDocument(cell() + cell("5000", "series"), row(cell() + '<table:table-cell table:number-columns-repeated="5000" office:value="' + "x".repeat(2000) + '"/>')).replace(`xmlns:${prefix}="urn:oasis:names:tc:opendocument:xmlns:${prefix}:1.0"`, `xmlns:${prefix}="invalid"`)
    assert.throws(() => validateOdfExpansion(chartZip(wrong), "odt"), /命名空间/)
  }
})

test("ordinary two-series chart retains names, labels and attribute values in the real parser", async () => {
  const chart = chartDocument(cell("1", "category") + cell("1", "Revenue") + cell("1", "Expense"),
    row(cell("1", "January") + '<table:table-cell office:value="17"/>' + '<table:table-cell office:value="-7.5"/>') +
    row(cell("1", "February") + '<table:table-cell office:value="25"/>' + '<table:table-cell office:value="9"/>'))
  const bytes = chartZip(chart)
  validateOdfExpansion(bytes, "odt")
  const result = await parseFile(bytes, "ordinary.odt", mime("odt"))
  assert.equal(result.success, true, JSON.stringify(result))
  const ast = await OfficeParser.parseOffice(bytes, { fileType: "odt", extractAttachments: true })
  const attachment = ast.attachments.find(item => item.type === "chart")
  assert.deepEqual(attachment?.chartData?.dataSets.map(data => ({ name: data.name, values: data.values })), [
    { name: "Revenue", values: ["17", "25"] }, { name: "Expense", values: ["-7.5", "9"] },
  ])
  assert.deepEqual(attachment?.chartData?.labels, ["January", "February"])
})

test("chart namespaces preserve ordinary ODS blank tails; mixed OOXML chart caches are refused", async () => {
  const body = table(row(cell()) + row("<table:table-cell/>", "1048576"))
  const main = xml(body).replace('<office:document-content ', '<office:document-content xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" ')
  validateOdfExpansion(zip(main), "ods")
  const mainAst = await OfficeParser.parseOffice(zip(main), { fileType: "ods", extractAttachments: true })
  assert.equal(mainAst.toText(), "marker")
  assert.deepEqual(mainAst.attachments, [], "main content with a chart namespace is not an embedded chart attachment")
  const mainResult = await parseFile(zip(main), "main-with-chart-namespace.ods", mime("ods"))
  assert.equal(mainResult.success, true, JSON.stringify(mainResult))
  if (mainResult.success) assert.match(mainResult.text, /marker/)
  const cache = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:ser><c:tx><c:v>' + "x".repeat(30000) + '</c:v></c:tx></c:ser>' + '<c:ser/>'.repeat(100) + '</c:chartSpace>'
  assert.throws(() => validateOdfExpansion(chartZip(cache), "odt"), /不支持 ODF 内嵌 OOXML 图表/)
  // The extractor selects its branch from original bytes, before trim/BOM normalization.
  const shifted = cache.replace('<c:chartSpace ', '<c:chartSpace xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" ')
  for (const prefix of [" ".repeat(501), "\uFEFF" + " ".repeat(498), "<!--" + "中".repeat(170) + "-->"]) {
    assert.throws(() => validateOdfExpansion(chartZip(prefix + shifted), "odt"), /不支持 ODF 内嵌 OOXML 图表/)
  }
  const externalRange = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:ser><c:cat><c:v>[Sheet.$A$1:.$A$10]</c:v></c:cat></c:ser><chart:chart xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"/></c:chartSpace>'
  assert.throws(() => validateOdfExpansion(chartZip(" ".repeat(501) + externalRange, "ods"), "ods"), /不支持 ODF 内嵌 OOXML 图表/)
  // Invalid UTF-8 expands when decoded/re-encoded. Branch selection must use
  // the original first 500 bytes, exactly like extractChartData.
  const chart = chartDocument(cell() + cell("5000", "S"), row(cell() + '<table:table-cell table:number-columns-repeated="5000" office:value="' + "x".repeat(2000) + '"/>'))
  const archive = new AdmZip(chartZip(chart, "ods"))
  const invalid = Buffer.concat([Buffer.from("<!--"), Buffer.alloc(180, 0xff), Buffer.from("-->" + chart)])
  assert.equal(invalid.subarray(0, 500).toString().includes("urn:oasis:names:tc:opendocument:xmlns:chart:1.0"), true)
  assert.equal(Buffer.from(invalid.toString()).subarray(0, 500).toString().includes("urn:oasis:names:tc:opendocument:xmlns:chart:1.0"), false)
  archive.updateFile("Object 1/content.xml", invalid)
  // Strict DOM may reject replacement characters before the chart admission step.
  assert.throws(() => validateOdfExpansion(archive.toBuffer(), "ods"), /XML 损坏|图表展开文本/)
})

// The pinned SAX-to-DOM adapter must preserve the parser's namespace/entity
// behavior and the shared ODS budget, rather than imposing it on ODT/ODP.
test("ODS preallocation preserves namespace aliases, attribute replacement and other ODF row semantics", () => {
  const alias = (first: string, last: string) => `<table:table-cell xmlns:t="${TABLE}" table:number-columns-repeated="${first}" t:number-columns-repeated="${last}"/>`
  validateOdfExpansion(zip(xml(table(row(alias("60000", "1"))))), "ods")
  refused(table(row(alias("1", "60000"))))
  const renamed = (columns: string) => xml(table(row(`<table:table-cell table:number-columns-repeated="${columns}"/>`)))
    .replaceAll("<table:", "<t:").replaceAll("</table:", "</t:")
    .replaceAll(" table:", " t:").replace("xmlns:table=", "xmlns:t=")
  assert.ok(renamed("50000").includes(`xmlns:t="${TABLE}"`), "alias retains the exact TABLE namespace URI")
  validateOdfExpansion(zip(renamed("50000")), "ods")
  assert.throws(() => validateOdfExpansion(zip(renamed("50001")), "ods"), /列循环/)
  refused(table(row(cell("&#x35;0001"))))
  validateOdfExpansion(zip(xml(table(row('<table:covered-table-cell table:number-columns-repeated="60000"/>')))), "ods")
  const wrapped = '<wrapper xmlns="urn:owned"><table:table-cell table:number-columns-repeated="30000"/></wrapper>'
  for (const kind of ["odt", "odp"]) validateOdfExpansion(zip(xml(table(row(wrapped) + row(wrapped)), kind), kind), kind)
})

test("ODS preallocation counts all selected XML entries under the same column budget", () => {
  const body = xml(table(row(cell("25000", ""))))
  validateOdfExpansion(zip(body, "ods", { "styles.xml": body }), "ods")
  assert.throws(() => validateOdfExpansion(zip(body, "ods", { "styles.xml": xml(table(row(cell("25001", "")))) }), "ods"), /列循环/)
  const unqualified = '<table:table-cell number-columns-repeated="60000"/>'
  validateOdfExpansion(zip(xml(table(row(unqualified)))), "ods")
})


test("ODS oversized columns refuse before retaining an otherwise large DOM in a bounded child", () => {
  const content = xml(table(row(cell("50001") + cell("1").repeat(60000))))
  const archive = new AdmZip(undefined, { noSort: true })
  archive.addFile("mimetype", Buffer.from(mime("ods")))
  archive.addFile("content.xml", Buffer.from(content))
  // Store fresh entry data before any compression. Merely changing the method
  // of an already deflated entry would create a corrupt CRC fixture.
  for (const entry of archive.getEntries()) entry.header.method = 0
  const bytes = archive.toBuffer()
  assert.equal(new AdmZip(bytes).getEntry("content.xml")!.getData().toString(), content)
  assert.ok(bytes.length < 8 * 1024 * 1024)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-admission-615-"))
  const fixture = path.join(dir, "owned.ods"), parser = path.join(__dirname, "../src/file-parser.js")
  fs.writeFileSync(fixture, bytes)
  try {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", TMPDIR: dir, TMP: dir, TEMP: dir, CMSPARK_DATA_DIR: dir }
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    const child = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", `
      require(${JSON.stringify(parser)}).parseFile(require('node:fs').readFileSync(process.argv[1]), 'owned.ods', ${JSON.stringify(mime("ods"))}).then(result => {
        if (result.success || !/ODF 文档展开.*列循环/.test(result.error || '')) process.exitCode = 1;
        console.log(JSON.stringify({refused: result.success === false, columns: /列循环/.test(result.error || '')}));
      });`, fixture], { env, encoding: "utf8", timeout: 6000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 })
    assert.equal(child.error, undefined, String(child.error))
    assert.equal(child.status, 0, child.stderr + child.stdout)
    assert.match(child.stdout, /"refused":true,"columns":true/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
