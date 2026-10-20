export type PageReadRequest = { kind: "text" } | { kind: "html"; selector: string }
export interface PageReadSnapshot { content: string; url?: string; codeComparison?: unknown; comparisonRefusal?: string; releaseRelation?: unknown; releaseRefusal?: string }

/** Serialized into CDP/chrome.scripting. Every extractor helper is deliberately
 * nested: the serialized function must not depend on module/import closures. */
export function pageReadSnapshot(request: PageReadRequest): PageReadSnapshot {
  const content = request.kind === "text" ? document.body?.innerText || ""
    : document.querySelector(request.selector)?.outerHTML?.substring(0, 500000) || ""
  const result: PageReadSnapshot = { content, url: location.href }
  // A release relation is a current platform statement, never artifact/build
  // authenticity. Only this complete metadata selector can carry the sidecar.
  if (request.kind === "html" && request.selector === ".Box-body div.d-flex.flex-row.flex-wrap.color-fg-muted.flex-items-end") {
    let refusal = "UNSUPPORTED_RELEASE_VIEW"
    try {
      const u = new URL(location.href)
      const route = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/tag\/([A-Za-z0-9_][A-Za-z0-9_.-]*)$/.exec(u.pathname)
      if (u.origin !== "https://github.com" || !route || u.search || u.hash || u.username || u.password) throw 0
      const repository = u.origin + "/" + route[1] + "/" + route[2], tag = route[3]
      refusal = "RELEASE_CAPACITY"
      if (new TextEncoder().encode(result.content).length > 65536) throw 0
      refusal = "UNSUPPORTED_RELEASE_VIEW"
      const attr = (e: Element, name: string) => e.getAttribute(name) || ""
      const cls = (e: Element, name: string) => attr(e, "class").split(/\s+/).includes(name)
      const one = (nodes: Element[]) => { if (nodes.length !== 1) throw 0; return nodes[0] }
      const header = one(Array.from(document.querySelectorAll(request.selector)))
      const wrapper = header.parentNode as Element, box = wrapper?.parentNode as Element
      if (header.tagName.toLowerCase() !== "div" || wrapper?.tagName.toLowerCase() !== "div"
        || !["tmp-mb-3", "tmp-pb-md-4", "border-md-bottom"].every(c => cls(wrapper, c))
        || box?.tagName.toLowerCase() !== "div" || !cls(box, "Box-body") || !cls(box.parentNode as Element, "Box")) throw 0
      for (let n: Node | null = header; n; n = n.parentNode) if (n.nodeType === 1) {
        const e = n as Element
        if (["article", "script", "template"].includes(e.tagName.toLowerCase()) || cls(e, "markdown-body") || cls(e, "comment-body")
          || e.hasAttribute("hidden") || attr(e, "aria-hidden") === "true" || cls(e, "d-none")
          || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(attr(e, "style"))) throw 0
      }
      const children = Array.from(header.childNodes)
      if (children.some(n => n.nodeType === 3 ? !!(n.nodeValue || "").trim() : n.nodeType !== 1
        || (n as Element).tagName.toLowerCase() !== "div" || !cls(n as Element, "tmp-mr-4") || !cls(n as Element, "mb-2"))) throw 0
      const all = Array.from(header.getElementsByTagName("*"))
      if (all.some(e => ["script", "style", "template", "iframe"].includes(e.tagName.toLowerCase())
        || e.hasAttribute("hidden") || attr(e, "aria-hidden") === "true" || cls(e, "d-none")
        || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(attr(e, "style")))) throw 0
      if (!/\breleased this\b/.test(header.textContent || "") || !attr(one(all.filter(e => e.tagName.toLowerCase() === "relative-time")), "datetime")) throw 0
      refusal = "RELEASE_IDENTITY_MISMATCH"
      const links = all.filter(e => e.tagName.toLowerCase() === "a")
      const parsed = links.map(node => ({ node, url: new URL(attr(node, "href"), u) }))
      const tagLink = one(parsed.filter(x => /\/tree\//.test(x.url.pathname)).map(x => x.node))
      if (new URL(attr(tagLink, "href"), u).href !== repository + "/tree/" + tag || (tagLink.textContent || "").trim() !== tag
        || !Array.from(tagLink.getElementsByTagName("svg")).some(e => attr(e, "aria-label") === "Tag")) throw 0
      const commitLink = one(parsed.filter(x => /\/commit\//.test(x.url.pathname)).map(x => x.node))
      const commitUrl = new URL(attr(commitLink, "href"), u), m = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/commit\/([a-f0-9]{40})$/.exec(commitUrl.pathname)
      if (!m || commitUrl.href !== repository + "/commit/" + m[3] || attr(commitLink, "data-hovercard-type") !== "commit"
        || !Array.from(commitLink.getElementsByTagName("svg")).some(e => attr(e, "aria-label") === "Commit")) throw 0
      const label = (one(Array.from(commitLink.getElementsByTagName("code"))).textContent || "").trim()
      if (!/^[a-f0-9]{7,40}$/.test(label) || !m[3].startsWith(label)) throw 0
      refusal = "RELEASE_TARGET_CHANGED"
      let connected = false
      for (let n: Node | null = header; n; n = n.parentNode) if (n === document) connected = true
      if (!connected || location.href !== result.url || document.querySelectorAll(request.selector).length !== 1
        || document.querySelector(request.selector) !== header || header.outerHTML !== result.content) throw 0
      const relation = { schema_version: 1, adapter: "github_tagged_release.v1", repository, release_url: u.href, tag, head: m[3] }
      refusal = "RELEASE_CAPACITY"
      if (new TextEncoder().encode(result.content).length + new TextEncoder().encode(JSON.stringify(relation)).length > 65536) throw 0
      result.releaseRelation = relation
    } catch { result.releaseRefusal = refusal }
    return result
  }
  if (request.kind !== "text" || !/^https:\/\/github\.com\//.test(location.href)) return result
  const u = new URL(location.href)
  const route = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/compare\/([a-f0-9]{40})\.\.([a-f0-9]{40})$/.exec(u.pathname)
  if (u.origin !== "https://github.com" || !route || u.search || u.hash || u.username || u.password || route[3] === route[4]) return result
  const repository = u.origin + "/" + route[1] + "/" + route[2]
  let reason = "UNSUPPORTED_VIEW"
  try {
    const attr = (e: Element, name: string) => e.getAttribute(name) || ""
    const cls = (e: Element, name: string) => attr(e, "class").split(/\s+/).includes(name)
    const elements = (e: Document | Element, tag = "*") => Array.from(e.getElementsByTagName(tag)).filter(n => {
      for (let p: Node | null = n.parentNode; p && p !== e; p = p.parentNode) if (p.nodeType === 1 && ["template", "script"].includes((p as Element).tagName.toLowerCase())) return false
      return true
    })
    const one = (nodes: Element[]) => { if (nodes.length !== 1) throw 0; return nodes[0] }
    const byId = (id: string) => one(elements(document).filter(e => attr(e, "id") === id))
    const connected = (e: Node) => { for (let p: Node | null = e; p; p = p.parentNode) if (p === document) return true; return false }
    const text = (e: Element) => e.textContent || ""
    const hidden = (e: Element) => e.hasAttribute("hidden") || attr(e, "aria-hidden") === "true" || cls(e, "d-none")
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(attr(e, "style"))
    const visible = (e: Element) => {
      for (let p: Node | null = e; p; p = p.parentNode) if (p.nodeType === 1 && hidden(p as Element)) throw 0
    }
    const outsideDiff = (e: Element) => {
      for (let p: Node | null = e; p; p = p.parentNode) if (p.nodeType === 1) {
        const node = p as Element
        if (["files_bucket", "toc", "files"].includes(attr(node, "id")) || node.hasAttribute("data-code-marker")
          || cls(node, "file") || cls(node, "blob-code") || node.tagName.toLowerCase() === "table") throw 0
      }
    }
    const codeText = (e: Element) => {
      visible(e)
      const value = text(e), children = Array.from(e.childNodes)
      // GitHub represents a genuinely empty line by one direct, empty BR.
      if (!value && children.length === 1 && children[0].nodeType === 1) {
        const br = children[0] as Element
        if (br.tagName.toLowerCase() === "br" && br.attributes.length === 0 && br.childNodes.length === 0) return value
      }
      const pending = [...children]
      while (pending.length) {
        const node = pending.pop()!
        if (node.nodeType === 3) continue
        if (node.nodeType !== 1) throw 0
        const span = node as Element
        if (span.tagName.toLowerCase() !== "span" || Array.from(span.attributes).some(a => a.name !== "class")
          || attr(span, "class").split(/\s+/).filter(Boolean).some(c => !/^(?:pl-[a-z0-9_-]+|x|x-first|x-last)$/.test(c))) throw 0
        pending.push(...Array.from(span.childNodes))
      }
      return value
    }
    const integer = (s: string) => { if (!/^(?:0|[1-9]\d*)$/.test(s)) throw 0; const n = Number(s); if (!Number.isSafeInteger(n)) throw 0; return n }
    const validPath = (p: string) => !!p && p.length <= 8192 && !/[\x00-\x1f\x7f-\x9f\\"]/u.test(p) && !p.startsWith("/") && !p.split("/").some(s => !s || s === "." || s === "..")
    const ref = (id: string, sha: string) => {
      const root = byId(id), values = elements(root, "ref-selector").map(e => attr(e, "current-committish"))
      if (!values.length || values.some(v => atob(v) !== sha)) throw 0
      return root
    }
    const baseRoot = ref("base-ref-selector", route[3]), headRoot = ref("head-ref-selector", route[4])
    const heading = one(elements(document).filter(e => cls(e, "compare-show-header")))
    ;[baseRoot, headRoot, heading].forEach(outsideDiff)
    if (!text(heading).includes("This is a direct comparison between two commits")) throw 0
    const alternate = elements(document, "link").filter(e => attr(e, "rel") === "alternate" && attr(e, "type") === "text/x-diff")
    if (alternate.length !== 1 || new URL(attr(alternate[0], "href"), u).href !== u.href + ".diff") throw 0
    reason = "FILES_NOT_LOADED"
    const bucket = byId("files_bucket"), toc = byId("toc"), filesRoot = byId("files")
    for (const root of [bucket, toc, filesRoot]) for (let node: Node | null = root; node; node = node.parentNode)
      if ([baseRoot, headRoot, heading].includes(node as Element)) throw 0
    if (elements(bucket, "include-fragment").length || elements(bucket).some(e => attr(e, "aria-busy") === "true")) throw 0
    reason = "UNSUPPORTED_VIEW"
    const selected = elements(toc, "button").filter(e => attr(e, "name") === "diff" && attr(e, "aria-current") === "true")
    if (selected.length !== 1 || attr(selected[0], "value") !== "unified") throw 0
    // Unknown visible non-file children are not silently ignored as another layout.
    if (elements(bucket).some(e => /(?:diff-load|diff-error|diff-too-big|diff-file-error|js-diff-file-filter)/.test(attr(e, "class"))
      || e.tagName.toLowerCase() === "input" && /(?:filter|whitespace)/.test(attr(e, "name") + attr(e, "id")) && !!attr(e, "value"))) throw 0
    const stats = one(elements(toc).filter(e => cls(e, "toc-diff-stats")))
    const statsText = text(stats)
    const total = /\b(\d+) changed files\b[\s\S]*?\b(\d+) additions\b[\s\S]*?\b(\d+) deletions\b/.exec(statsText)
    if (!total) throw 0
    const n = integer(total[1]), additions = integer(total[2]), deletions = integer(total[3])
    reason = "CAPACITY"
    if (n < 1 || n > 128) throw 0
    reason = "INVENTORY_MISMATCH"
    const lists = elements(toc, "ol"), list = one(lists)
    const entries = Array.from(list.childNodes).filter(e => e.nodeType === 1) as Element[]
    if (entries.length !== n || entries.some(e => e.tagName.toLowerCase() !== "li")) throw 0
    const inventory = entries.map(e => {
      const links = elements(e, "a").filter(a => attr(a, "href").startsWith("#diff-") && !attr(a, "aria-label"))
      const a = one(links), anchor = attr(a, "href").slice(1), p = text(a)
      const status = one(elements(e, "svg").filter(s => !!attr(s, "title")))
      const kind = attr(status, "title")
      if (!validPath(p) || !["modified", "added", "removed"].includes(kind)) throw 0
      const plus = one(elements(e, "span").filter(s => cls(s, "color-fg-success"))), minus = one(elements(e, "span").filter(s => cls(s, "color-fg-danger")))
      return { anchor, path: p, kind, additions: integer(text(plus).trim().replace(/^\+/, "")), deletions: integer(text(minus).trim().replace(/^−/, "")) }
    })
    if (new Set(inventory.map(x => x.anchor)).size !== n || new Set(inventory.map(x => x.path)).size !== n) throw 0
    const roots = elements(filesRoot).filter(e => cls(e, "file") && cls(e, "js-file"))
    if (roots.length !== n) throw 0
    const manifest: { old_path: string | null; new_path: string | null; additions: number; deletions: number }[] = []
    const diff: string[] = []
    for (const item of inventory) {
      const file = one(roots.filter(e => attr(e, "id") === item.anchor))
      if (attr(file, "data-tagsearch-path") !== item.path) throw 0
      reason = "UNSUPPORTED_VIEW"
      const header = one(elements(file).filter(e => cls(e, "file-header")))
      const toggle = one(elements(header, "button").filter(e => attr(e, "aria-label") === "Toggle diff contents"))
      if (file.hasAttribute("hidden") || attr(file, "aria-hidden") === "true" || cls(file, "d-none") || /display\s*:\s*none/i.test(attr(file, "style"))
        || attr(toggle, "aria-expanded") !== "true" || attr(header, "data-path") !== item.path || attr(header, "data-anchor") !== item.anchor) throw 0
      const table = one(elements(file, "table").filter(e => cls(e, "js-diff-table")))
      if (attr(table, "data-diff-anchor") !== item.anchor) throw 0
      visible(table)
      const old = item.kind === "added" ? null : item.path, next = item.kind === "removed" ? null : item.path
      const lines = [`diff --git a/${item.path} b/${item.path}`, `--- ${old ? "a/" + old : "/dev/null"}`, `+++ ${next ? "b/" + next : "/dev/null"}`]
      let a = 0, d = 0, oldAt = 0, newAt = 0, oldLeft = 0, newLeft = 0, hunks = 0, previousOld = 0, previousNew = 0
      reason = "HUNK_INCOMPLETE"
      for (const row of elements(table, "tr")) {
        visible(row)
        const cells = Array.from(row.childNodes).filter(e => e.nodeType === 1 && (e as Element).tagName.toLowerCase() === "td") as Element[]
        const children = Array.from(row.childNodes).filter(e => e.nodeType !== 3 || !!(e.nodeValue || "").trim())
        if (!cells.length) {
          // Only the fixed accessibility column labels are outside the diff.
          // Unknown visible rows must not disappear from a complete snapshot.
          const section = row.parentNode as Element
          const labels = ["Original file line number", "Diff line number", "Diff line change"]
          if (section?.tagName?.toLowerCase() !== "thead" || section.parentNode !== table || !cls(section, "sr-only")
            || children.length !== labels.length || children.some((node, i) => node.nodeType !== 1
              || (node as Element).tagName.toLowerCase() !== "th" || attr(node as Element, "scope") !== "col"
              || text(node as Element).trim() !== labels[i] || Array.from(node.childNodes).some(child => child.nodeType !== 3))) throw 0
          continue
        }
        if (children.length !== cells.length) throw 0
        const h = cells.filter(e => cls(e, "blob-code-hunk"))
        if (h.length) {
          // The recorded unified hunk has one two-column expander and its hunk.
          // Every direct cell must be accounted for, including empty expanders.
          if (h.length !== 1 || cells.length !== 2 || cells[1] !== h[0]
            || !cls(cells[0], "blob-num") || !cls(cells[0], "blob-num-expandable")
            || cls(cells[0], "blob-code") || attr(cells[0], "colspan") !== "2"
            || cls(h[0], "blob-num") || oldLeft || newLeft) throw 0
          // A completed hunk may end with an empty unchanged-context expander.
          if (!text(h[0]).trim() && cls(row, "js-expandable-line") && !oldLeft && !newLeft) continue
          const value = text(h[0]), m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(value)
          if (!m) throw 0
          oldAt = integer(m[1]); newAt = integer(m[3]); oldLeft = integer(m[2] ?? "1"); newLeft = integer(m[4] ?? "1")
          if (oldAt < previousOld || newAt < previousNew || oldLeft + newLeft === 0 || oldLeft > 65536 || newLeft > 65536 || !old && oldLeft || !next && newLeft) throw 0
          lines.push(value); hunks++; continue
        }
        if (!attr(row, "data-hunk")) throw 0
        const code = one(cells.filter(e => cls(e, "blob-code")))
        const inner = one(elements(code).filter(e => e.hasAttribute("data-code-marker")))
        // A supported code cell is exactly its direct marker plus formatting
        // whitespace. Extra siblings/wrappers could carry omitted visible code.
        if (inner.parentNode !== code || Array.from(code.childNodes).some(node => node !== inner
          && (node.nodeType !== 3 || !!(node.nodeValue || "").trim()))) throw 0
        const marker = attr(inner, "data-code-marker"), value = codeText(inner)
        if (![" ", "+", "-"].includes(marker) || /[\r\n]/.test(value)) throw 0
        const numbers = cells.filter(e => cls(e, "blob-num"))
        // The supported unified changed/context row is exactly old/new/code.
        if (numbers.length !== 2 || cells.length !== 3
          || cells[0] !== numbers[0] || cells[1] !== numbers[1] || cells[2] !== code
          || numbers.includes(code)) throw 0
        const left = attr(numbers[0], "data-line-number"), right = attr(numbers[1], "data-line-number")
        const takesOld = marker !== "+", takesNew = marker !== "-"
        if (takesOld ? oldLeft <= 0 || integer(left) !== oldAt || oldAt === 0 : !!left) throw 0
        if (takesNew ? newLeft <= 0 || integer(right) !== newAt || newAt === 0 : !!right) throw 0
        if (takesOld) { oldAt++; oldLeft-- }
        if (takesNew) { newAt++; newLeft-- }
        if (marker === "+") a++; if (marker === "-") d++
        lines.push(marker + value); previousOld = oldAt; previousNew = newAt
      }
      if (!hunks || oldLeft || newLeft || a !== item.additions || d !== item.deletions || a + d === 0) throw 0
      manifest.push({ old_path: old?.normalize("NFC") ?? null, new_path: next?.normalize("NFC") ?? null, additions: a, deletions: d }); diff.push(...lines)
    }
    reason = "INVENTORY_MISMATCH"
    if (manifest.reduce((s, f) => s + f.additions, 0) !== additions || manifest.reduce((s, f) => s + f.deletions, 0) !== deletions) throw 0
    const comparison = { schema_version: 1, adapter: "github_compare_two_dot.v1", repository, base: route[3], head: route[4], semantics: "two_dot_trees", file_count: n, additions, deletions, diff_text: diff.join("\n").normalize("NFC") + "\n", manifest }
    reason = "CAPACITY"
    if (new TextEncoder().encode(JSON.stringify(comparison)).length > 65536) throw 0
    reason = "TARGET_CHANGED"
    if (location.href !== result.url || ![bucket, toc, filesRoot, baseRoot, headRoot, heading, ...roots].every(connected)
      || ref("base-ref-selector", route[3]) !== baseRoot || ref("head-ref-selector", route[4]) !== headRoot || text(stats) !== statsText
      || byId("files_bucket") !== bucket || byId("toc") !== toc || byId("files") !== filesRoot) throw 0
    result.codeComparison = comparison
  } catch { result.comparisonRefusal = reason }
  return result
}

export function pageReadExpression(request: PageReadRequest): string {
  return `(${pageReadSnapshot.toString()})(${JSON.stringify(request)})`
}
