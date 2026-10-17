import AdmZip from "adm-zip"
import { DOMParser, type Element, type Node } from "@xmldom/xmldom"

const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
const DRAW_NS = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
const XLINK_NS = "http://www.w3.org/1999/xlink"
const OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
const CHART_NS = "urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
const ODF_MIMES: Record<string, string> = {
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
}

// Static admission limits, not a promise to interrupt synchronous XML parsing.
const MAX_XML_BYTES = 8 * 1024 * 1024
const MAX_COLUMNS = 50_000
const MAX_NODES = 100_000
// UTF-16 code units, matching JavaScript string/AST expansion rather than ZIP bytes.
const MAX_TEXT = 8 * 1024 * 1024
const MAX_DEPTH = 128
interface Cost { columns: number; nodes: number; text: number; logicalRows: number }
const zero = (): Cost => ({ columns: 0, nodes: 0, text: 0, logicalRows: 0 })

function refuse(detail: string): never {
  throw new Error(`ODF 文档展开超过解析预算或格式无效（${detail}），请拆分文档或另存为标准 Office 文件。`)
}

function bounded(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) refuse(label)
  return value
}

function check(cost: Cost): Cost {
  bounded(cost.columns, MAX_COLUMNS, "列循环")
  bounded(cost.nodes, MAX_NODES, "展开节点")
  bounded(cost.text, MAX_TEXT, "展开文本")
  bounded(cost.logicalRows, Number.MAX_SAFE_INTEGER, "行位置溢出")
  return cost
}

function add(left: Cost, right: Cost): Cost {
  return check({ columns: left.columns + right.columns, nodes: left.nodes + right.nodes,
    text: left.text + right.text, logicalRows: left.logicalRows + right.logicalRows })
}

function repetition(element: Element, namespace: string, name: string): number {
  const value = element.getAttributeNS(namespace, name)
  if (value === null) return 1
  // XML attributes are entity-decoded by the DOM; parseInt's partial/Infinity values are refused.
  if (!/^[0-9]+$/.test(value)) refuse(`非法重复次数 ${name}`)
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count <= 0) refuse(`非法重复次数 ${name}`)
  return count
}

function tableElement(node: Node, localName: string): node is Element {
  return node.nodeType === 1 && node.namespaceURI === TABLE_NS && node.localName === localName
}

function checkNamespaces(element: Element): void {
  // Upstream also matches qualified names without checking their namespace.
  for (const [prefix, namespace] of [["table", TABLE_NS], ["text", TEXT_NS], ["draw", DRAW_NS], ["xlink", XLINK_NS], ["office", OFFICE_NS], ["chart", CHART_NS]] as const) {
    if (element.tagName.startsWith(`${prefix}:`) && element.namespaceURI !== namespace) refuse("命名空间不一致")
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!
      if (attribute.name.startsWith(`${prefix}:`) && attribute.namespaceURI !== namespace) refuse("属性命名空间不一致")
    }
  }
  for (const name of ["table", "table-row", "table-cell", "covered-table-cell"]) {
    if (element.tagName === name && element.namespaceURI !== TABLE_NS) refuse("表格缺少命名空间")
  }
  for (const [names, namespace] of [[["p", "span"], TEXT_NS], [["frame", "image", "object"], DRAW_NS]] as const) {
    if ((names as readonly string[]).includes(element.tagName) && element.namespaceURI !== namespace) refuse("内容缺少命名空间")
  }
  for (const name of ["chart", "series", "categories", "axis", "title"]) {
    if (element.tagName === name && element.namespaceURI !== CHART_NS) refuse("图表缺少命名空间")
  }
}

function odsEmitsCell(cell: Element): boolean {
  const paragraphs = cell.getElementsByTagNameNS(TEXT_NS, "p")
  // Multiple empty paragraphs insert newlines; even empty spans create text AST children.
  if (paragraphs.length > 1 || cell.getElementsByTagNameNS(DRAW_NS, "frame").length > 0) return true
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs.item(i)!
    if (paragraph.textContent || paragraph.getElementsByTagNameNS(TEXT_NS, "span").length > 0) return true
  }
  return false
}

interface ObjectReferences { paths: string[]; seen: Set<string> }

// These selectors intentionally mirror chartUtils' qualified-name-first semantics.
function descendants(node: Element | import("@xmldom/xmldom").Document, name: string): Element[] {
  const qualified = Array.from(node.getElementsByTagName(name))
  return qualified.length ? qualified : Array.from(node.getElementsByTagName(name.split(":").pop()!))
}

function direct(node: Element, name: string): Element[] {
  const children: Element[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (child as Element).tagName === name) children.push(child as Element)
  }
  return children
}

function chartCost(document: import("@xmldom/xmldom").Document, kind: string, originalHead: string, entryName: string): Cost {
  // Only embedded content can be read by object extraction or chart attachments.
  if (entryName === "content.xml" || entryName === "styles.xml") return zero()
  // extractChartData chooses ODF by this literal namespace in the first 500 bytes.
  if (!originalHead.includes(CHART_NS)) {
    // Its other branch accepts OOXML chart caches inside ODF objects, including
    // nested rich-text duplication and ODS external sheet ranges. That mixed
    // format cannot use the ODF accounting model; refuse it explicitly.
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      if (element.tagName.startsWith("c:")) refuse("不支持 ODF 内嵌 OOXML 图表")
    }
    return zero()
  }
  const chart = descendants(document, "chart:chart")[0] || document.documentElement
  if (!chart) return zero()
  const title = descendants(chart, "chart:title")[0]
  const titleLength = title ? descendants(title, "text:p")[0]?.textContent?.length || 0 : 0
  let datasets = 0, names = 0, nameLength = 0, labels = 0, labelLength = 0, values = 0, valueLength = 0
  const count = (n: number) => bounded(n, MAX_NODES, "图表条目")
  const chars = (n: number) => bounded(n, MAX_TEXT, "图表展开文本")
  const reference = (value: string): void => {
    if (kind === "ods" && value.startsWith("[")) refuse("不支持 ODS 图表范围引用")
  }
  const table = descendants(chart, "table:table")[0]
  if (table) {
    const headerRows = direct(table, "table:table-header-rows")[0]
    const rows = [...(headerRows ? direct(headerRows, "table:table-row") : []), ...direct(table, "table:table-row")]
    const header = rows[0] ? direct(rows[0], "table:table-cell") : []
    for (const cell of header.slice(1)) {
      const repeat = repetition(cell, TABLE_NS, "number-columns-repeated")
      const length = direct(cell, "text:p")[0]?.textContent?.length || 0
      datasets = count(datasets + repeat)
      if (length) { names = count(names + repeat); nameLength = chars(nameLength + length * repeat) }
    }
    for (const row of rows.slice(1)) {
      const cells = direct(row, "table:table-cell")
      const label = cells[0] ? direct(cells[0], "text:p")[0]?.textContent || "" : ""
      if (label) { reference(label); labels = count(labels + 1); labelLength = chars(labelLength + label.length) }
      let index = 0
      for (const cell of cells.slice(1)) {
        const repeat = repetition(cell, TABLE_NS, "number-columns-repeated")
        const value = cell.getAttribute("office:value") || direct(cell, "text:p")[0]?.textContent || ""
        reference(value)
        const pushed = Math.min(repeat, Math.max(0, datasets - index))
        values = count(values + pushed)
        valueLength = chars(valueLength + value.length * pushed)
        index = bounded(index + repeat, Number.MAX_SAFE_INTEGER, "图表列位置")
      }
    }
  } else {
    for (const series of descendants(chart, "chart:series")) {
      const label = series.getAttribute("chart:label-cell-address") || ""
      const range = series.getAttribute("chart:values-cell-range-address") || ""
      if (kind === "ods" && range) refuse("不支持 ODS 图表范围引用")
      const paragraph = descendants(series, "text:p")[0]?.textContent || ""
      const name = paragraph || (label ? `Series ${label.split(".").pop()!.replace(/\$/g, "") || label}` : "")
      datasets = count(datasets + 1)
      if (name) { names = count(names + 1); nameLength = chars(nameLength + name.length) }
      if (range) { values = count(values + 1); valueLength = chars(valueLength + range.length + 2) }
    }
    const range = descendants(chart, "chart:categories")[0]?.getAttribute("table:cell-range-address") || ""
    if (kind === "ods" && range) refuse("不支持 ODS 图表范围引用")
    if (range) { labels = 1; labelLength = chars(range.length + 2) }
  }
  // rawTexts repeats every label for every dataset, even without repetition attributes.
  const rawEntries = count((titleLength ? 1 : 0) + names + datasets * labels + values)
  const rawChars = chars(titleLength + nameLength + datasets * labelLength + valueLength + Math.max(0, rawEntries - 1))
  // Main object extraction plus attachment extraction/assignment each retain/join chart text.
  return check({ columns: 0, nodes: count((datasets + labels + values + rawEntries) * 2), text: chars(rawChars * 4), logicalRows: 0 })
}

function checkObjectReferences(document: Node, references: ObjectReferences): void {
  const referencedNodes = new Set<Element>()
  const charge = (object: Element): void => {
    referencedNodes.add(object)
    const href = object.getAttributeNS(XLINK_NS, "href")
    if (!href) return
    // Match upstream's basename/suffix resolution, including ambiguous path aliases.
    const basename = href.replace(/^\.\//, "").replace(/\/$/, "").split("/").pop() || ""
    const suffix = `${basename}/content.xml`
    for (const target of references.paths.filter(name => name === suffix || name.endsWith(suffix))) {
      if (references.seen.has(target)) refuse("重复引用的嵌入对象")
      references.seen.add(target)
    }
  }
  const root = document as import("@xmldom/xmldom").Document
  const frames = root.getElementsByTagNameNS(DRAW_NS, "frame")
  for (let i = 0; i < frames.length; i++) {
    // Nested frames can independently revisit the same descendant object upstream.
    const object = frames.item(i)!.getElementsByTagNameNS(DRAW_NS, "object").item(0)
    if (object) charge(object)
  }
  const objects = root.getElementsByTagNameNS(DRAW_NS, "object")
  for (let i = 0; i < objects.length; i++) {
    const object = objects.item(i)!
    if (!referencedNodes.has(object)) charge(object)
  }
}

function xmlCost(xml: string, kind: string, xmlNodes: { count: number }, references: ObjectReferences, entryName: string, originalHead: string, rawColumns: { count: number }): Cost {
  const sanitized = xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml.trim()
  interface Attributes {
    length: number
    getURI(index: number): string | null
    getLocalName(index: number): string
    getValue(index: number): string
  }
  interface Builder { startElement(namespace: string, local: string, qualified: string, attributes: Attributes): void }
  let earlyFailure: unknown
  let document: import("@xmldom/xmldom").Document
  try {
    // The pinned xmldom builder hook charges the existing ODS column budget
    // before allocating each cell. Other ODF kinds keep their row semantics.
    const Base = (new DOMParser() as unknown as { domHandler: new (options: unknown) => Builder }).domHandler
    class ColumnBoundedBuilder extends Base {
      startElement(namespace: string, local: string, qualified: string, attributes: Attributes): void {
        if (kind === "ods" && namespace === TABLE_NS && local === "table-cell") {
          let value: string | null = null
          for (let i = 0; i < attributes.length; i++) {
            if (attributes.getURI(i) === TABLE_NS && attributes.getLocalName(i) === "number-columns-repeated") value = attributes.getValue(i)
          }
          try {
            if (value !== null && !/^[0-9]+$/.test(value)) refuse("非法重复次数 number-columns-repeated")
            const count = value === null ? 1 : Number(value)
            if (!Number.isSafeInteger(count) || count <= 0) refuse("非法重复次数 number-columns-repeated")
            rawColumns.count = bounded(rawColumns.count + count, MAX_COLUMNS, "列循环")
          } catch (error) { earlyFailure = error; throw error }
        }
        super.startElement(namespace, local, qualified, attributes)
      }
    }
    // Warnings remain refusals; xmldom may wrap a thrown onError in an English
    // fatalError. Normalize only DOM construction, not later budget/conversion errors.
    document = new DOMParser({ domHandler: ColumnBoundedBuilder, onError: () => refuse("XML 损坏") }).parseFromString(sanitized, "application/xml")
  } catch {
    if (earlyFailure) throw earlyFailure
    refuse("XML 损坏")
  }
  const ordered: Node[] = []
  const stack: Array<{ node: Node; depth: number; insideTable: boolean }> = [{ node: document, depth: 0, insideTable: false }]
  while (stack.length) {
    const { node, depth, insideTable } = stack.pop()!
    bounded(++xmlNodes.count, MAX_NODES, "XML 节点")
    bounded(depth, MAX_DEPTH, "XML 嵌套")
    if (node.nodeType === 1) {
      checkNamespaces(node as Element)
      if (kind === "ods" && insideTable && tableElement(node, "table")) refuse("不支持嵌套的 ODS 表格")
    }
    ordered.push(node)
    for (let child = node.lastChild; child; child = child.previousSibling) {
      stack.push({ node: child, depth: depth + 1, insideTable: insideTable || tableElement(node, "table") })
    }
  }
  checkObjectReferences(document, references)
  const costs = new Map<Node, Cost>()
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]!
    let cost = zero()
    for (let child = node.firstChild; child; child = child.nextSibling) cost = add(cost, costs.get(child)!)
    cost.nodes++
    if (node.nodeType === 3 || node.nodeType === 4) cost.text += node.nodeValue?.length || 0
    if (node.nodeType === 1) {
      const element = node as Element
      if (element.namespaceURI === TEXT_NS && element.localName === "s") {
        cost.text = repetition(element, TEXT_NS, "c")
      }
      if (tableElement(node, "table-cell")) {
        const count = repetition(element, TABLE_NS, "number-columns-repeated")
        if (count > 1 && element.getElementsByTagNameNS(DRAW_NS, "object").length) refuse("重复的嵌入对象")
        cost.columns += count // Empty ODS cells still execute every column iteration.
        const emits = kind !== "ods" || odsEmitsCell(element)
        if (kind === "ods" && emits) {
          // ODS concatenates every descendant paragraph/span, including overlapping spans.
          let text = 0
          const paragraphs = element.getElementsByTagNameNS(TEXT_NS, "p")
          for (let p = 0; p < paragraphs.length; p++) {
            const paragraph = paragraphs.item(p)!
            const spans = paragraph.getElementsByTagNameNS(TEXT_NS, "span")
            if (spans.length) {
              for (let s = 0; s < spans.length; s++) text = bounded(text + (spans.item(s)!.textContent?.length || 0), MAX_TEXT, "展开文本")
            } else text = bounded(text + (paragraph.textContent?.length || 0), MAX_TEXT, "展开文本")
            if (p + 1 < paragraphs.length) text++
          }
          cost.text = Math.max(cost.text, text)
        }
        cost.nodes = emits ? cost.nodes * count : 0
        cost.text = emits ? cost.text * count : 0
      }
      if (tableElement(node, "covered-table-cell")) repetition(element, TABLE_NS, "number-columns-repeated")
      if (tableElement(node, "table-row")) {
        const count = repetition(element, TABLE_NS, "number-rows-repeated")
        if (count > 1 && element.getElementsByTagNameNS(DRAW_NS, "object").length) refuse("重复的嵌入对象")
        let cells = zero()
        if (kind === "ods") {
          if (element.getElementsByTagNameNS(TABLE_NS, "table-row").length) refuse("不支持嵌套的 ODS 行")
          const descendants = element.getElementsByTagNameNS(TABLE_NS, "table-cell")
          for (let c = 0; c < descendants.length; c++) cells = add(cells, costs.get(descendants.item(c)!)!)
        } else {
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (tableElement(child, "table-cell")) cells = add(cells, costs.get(child)!)
          }
        }
        // Childless/single-empty-paragraph ODS tails advance rowIndex in O(1).
        const emits = kind !== "ods" || cells.nodes > 0
        cost = { columns: cells.columns, nodes: emits ? (cells.nodes + 1) * count : 0,
          text: emits ? cells.text * count : 0, logicalRows: count }
      }
    }
    costs.set(node, check(cost))
  }
  return add(costs.get(document)!, chartCost(document, kind, originalHead, entryName))
}

/** Caller must first validate ZIP paths, declarations and compression/container limits. */
export function validateOdfExpansion(buffer: Buffer, extension: string): void {
  const mime = ODF_MIMES[extension]
  if (!mime) return
  const zip = new AdmZip(buffer)
  const mimeEntry = zip.getEntry("mimetype")
  if (!mimeEntry || mimeEntry.header.size > 256 || mimeEntry.getData().toString() !== mime || !zip.getEntry("content.xml")) {
    refuse("容器类型或主文档不一致")
  }
  let xmlBytes = 0
  let total = zero()
  const xmlNodes = { count: 0 }
  const rawColumns = { count: 0 }
  const references: ObjectReferences = { paths: zip.getEntries().filter(entry => !entry.isDirectory && entry.entryName.includes("content.xml")).map(entry => entry.entryName), seen: new Set() }
  for (const entry of zip.getEntries()) {
    // Upstream selects content.xml by substring (including embedded Object documents).
    if (entry.isDirectory || (!entry.entryName.includes("content.xml") && entry.entryName !== "styles.xml")) continue
    xmlBytes = bounded(xmlBytes + entry.header.size, MAX_XML_BYTES, "XML 内容大小")
    const data = entry.getData()
    if (data.length !== entry.header.size) refuse("XML 大小不一致")
    total = add(total, xmlCost(data.toString("utf8"), extension, xmlNodes, references, entry.entryName, data.subarray(0, 500).toString("utf8"), rawColumns))
  }
}
