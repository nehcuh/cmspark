import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
const repoRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../.." : "../..")
const { DOMParser } = createRequire(path.join(repoRoot, "companion/package.json"))("@xmldom/xmldom")
import { pageReadExpression } from "../src/background/page-read-snapshot"

// Selected actual anonymous HTTP HTML. Not a recorded authenticated browser read.
const html = fs.readFileSync(path.join(repoRoot, "chrome-extension/tests/fixtures/github-compare-two-dot-464.html"), "utf8")
const url = "https://github.com/nehcuh/cmspark/compare/30f4aa867ca1b9970f0fa4d72fc993a13af49972..06f3bf3fae687eebd518371be859379389642bc7"
function snapshot(source = html, currentUrl = url) {
  const document = new DOMParser({ onError: () => {} }).parseFromString(source, "application/xml") as unknown as Document
  const body = document.getElementsByTagName("body")[0]
  Object.defineProperty(document, "body", { value: body })
  Object.defineProperty(body, "innerText", { get: () => body.textContent || "" })
  // Actual serialized producer: no imported implementation closure in this VM.
  return JSON.parse(JSON.stringify(vm.runInNewContext(pageReadExpression({ kind: "text" }), {
    document, location: { href: currentUrl }, URL, TextEncoder, atob,
  })))
}
test("serialized GitHub producer derives actual HTTP-source file/hunk facts, not caller metadata", () => {
  const s = snapshot()
  assert.equal(s.codeComparison?.adapter, "github_compare_two_dot.v1", s.comparisonRefusal)
  assert.equal(s.codeComparison.file_count, 4)
  assert.equal(s.codeComparison.additions, 33)
  assert.equal(s.codeComparison.deletions, 4)
  assert.equal(s.codeComparison.manifest[1].new_path, "companion/src/acp/jsonrpc-stdio.ts")
  assert.ok(s.codeComparison.diff_text.includes("-        capabilities: {\n+        clientCapabilities: {"))
  assert.equal(s.text, undefined)
  assert.equal(s.content, snapshot().content)
})
for (const [name, mutate] of [
  ["cut file", (s: string) => s.replace('data-tagsearch-path="CHANGELOG.md"', 'data-tagsearch-path="unknown.md"')],
  ["cut changed row", (s: string) => s.replace('data-code-marker="+"', 'data-code-marker="?"')],
  ["wrong global counts", (s: string) => s.replace('33 additions', '34 additions')],
  ["folded file", (s: string) => s.replace('aria-expanded="true"', 'aria-expanded="false"')],
  ["loading", (s: string) => s.replace('<div id="files_bucket">', '<div id="files_bucket"><include-fragment aria-label="Loading Files"></include-fragment>')],
  ["duplicate TOC", (s: string) => s.replace('id="toc"', 'id="toc-unknown"')],
] as const) test(`serialized producer refuses ${name}`, () => assert.equal(snapshot(mutate(html)).codeComparison, undefined))
for (const current of [url.replace('..', '...'), url + '?w=1', url + '#changed', url.replace('github.com', 'example.com'), url.replace('30f4aa8', '40f4aa8')]) {
  test(`URL identity/layout remains exact ${current.slice(-12)}`, () => assert.equal(snapshot(html, current).codeComparison, undefined))
}
export { snapshot, html, url }

test("normalization remains explicit and code text cannot become a metadata root", () => {
  const captured = snapshot(html.replace("clientCapabilities", "Cafe\u0301"))
  assert.ok(captured.codeComparison.diff_text.includes("Café"))
  // A real element with the reserved metadata id inside a code cell is ambiguous;
  // escaped source text is inert, but injected structure must not be trusted.
  const injected = html.replace('data-code-marker="+">', 'data-code-marker="+"><div id="toc"></div>')
  assert.equal(snapshot(injected).codeComparison, undefined)
})
for (const [name, mutate] of [
  ["oversize inventory", (s: string) => s.replace("4 changed files", "129 changed files")],
  ["side line mismatch", (s: string) => s.replace('data-line-number="4"', 'data-line-number="400"')],
  ["hunk range mismatch", (s: string) => s.replace("@@ -4,6 +4,8 @@", "@@ -4,6 +4,9 @@")],
  ["hidden file", (s: string) => s.replace('data-tagsearch-path="CHANGELOG.md"', 'hidden="" data-tagsearch-path="CHANGELOG.md"')],
  ["unknown status", (s: string) => s.replace('title="modified"', 'title="renamed"')],
] as const) test(`fixed complete-view contract refuses ${name}`, () => assert.equal(snapshot(mutate(html)).codeComparison, undefined))


test("serialized complete comparison refuses ambiguous code structure and hidden table or changed row", () => {
  const token = '<span class="pl-c1 x x-first x-last">clientCapabilities</span>'
  assert.equal(html.split(token).length, 2)
  const baseline = snapshot()
  assert.equal(baseline.codeComparison?.file_count, 4)
  assert.ok(baseline.codeComparison.diff_text.includes("\n+\n"), "sole BR in a genuine empty line stays supported")
  for (const body of ["client<br></br>Capabilities", "client<div>Capabilities</div>", "client<wbr></wbr>Capabilities", "client<script>Capabilities</script>", "client<template>Capabilities</template>", 'client<span style="display:none">Capabilities</span>', 'client<span hidden="">Capabilities</span>']) {
    const changed = html.replace(token, '<span class="pl-c1 x x-first x-last">' + body + '</span>')
    assert.equal(snapshot(changed).codeComparison, undefined, body)
  }
  for (const [before, after] of [
    ['<table class=" diff-table', '<table hidden="" class=" diff-table'],
    ['<tr data-hunk=', '<tr hidden="" data-hunk='],
    ['<tr data-hunk=', '<tr aria-hidden="true" data-hunk='],
    ['<tr data-hunk=', '<tr style="visibility:hidden" data-hunk='],
  ]) {
    assert.ok(html.includes(before), before)
    assert.equal(snapshot(html.replace(before, after)).codeComparison, undefined, after)
  }
})


test("serialized comparison identity cannot originate inside a changed code row", () => {
  const document = new DOMParser({ onError: () => {} }).parseFromString(html, "application/xml") as unknown as Document
  const nodes = Array.from(document.getElementsByTagName("*"))
  const inner = nodes.find(e => e.getAttribute("data-code-marker") === "+")!
  assert.ok(inner)
  const metadata = ["base-ref-selector", "head-ref-selector"].map(id => nodes.find(e => e.getAttribute("id") === id)!)
  metadata.push(nodes.find(e => (e.getAttribute("class") || "").split(/\s+/).includes("compare-show-header"))!)
  function flatten(node: Node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) child.nodeValue = (child.nodeValue || "").replace(/[\r\n]/g, " ")
      else flatten(child)
    }
  }
  for (const node of metadata) { assert.ok(node); flatten(node); inner.appendChild(node) }
  assert.equal(snapshot(document.toString()).codeComparison, undefined)
})


test("serialized complete code cell cannot hide visible siblings or unsupported marker wrappers", () => {
  for (const variant of ["br", "visible-span", "text-before", "text-after", "wrapper"]) {
    const document = new DOMParser({ onError: () => {} }).parseFromString(html, "application/xml") as unknown as Document
    const inner = Array.from(document.getElementsByTagName("*")).find(n => n.getAttribute("data-code-marker") === "+")!
    const cell = inner.parentNode!
    if (variant === "wrapper") {
      const wrapper = document.createElement("span")
      cell.insertBefore(wrapper, inner); wrapper.appendChild(inner)
    } else {
      const node = variant === "br" ? document.createElement("br") : variant === "visible-span" ? document.createElement("span") : document.createTextNode("EXTRA_CODE")
      if (variant === "visible-span") node.appendChild(document.createTextNode("EXTRA_CODE"))
      if (variant === "text-before") cell.insertBefore(node, inner); else cell.appendChild(node)
    }
    assert.equal(snapshot(document.toString()).codeComparison, undefined, variant)
  }
  assert.equal(snapshot().codeComparison.file_count, 4)
})

test("serialized complete comparison refuses unknown rows and mixed row cells while retaining fixed accessibility labels", () => {
  assert.equal(snapshot().codeComparison.file_count, 4)
  for (const variant of ["body-th", "mixed-th", "unknown-header", "visible-header"]) {
    const document = new DOMParser({ onError: () => {} }).parseFromString(html, "application/xml") as unknown as Document
    const table = Array.from(document.getElementsByTagName("table")).find(e => (e.getAttribute("class") || "").split(/\s+/).includes("js-diff-table"))!
    assert.ok(table)
    if (variant === "body-th") {
      const row = document.createElement("tr"), cell = document.createElement("th")
      cell.appendChild(document.createTextNode("UNPARSED_VISIBLE_ROW")); row.appendChild(cell)
      table.getElementsByTagName("tbody")[0].appendChild(row)
    } else if (variant === "mixed-th") {
      const row = Array.from(table.getElementsByTagName("tr")).find(e => !!e.getAttribute("data-hunk"))!
      const cell = document.createElement("th"); cell.appendChild(document.createTextNode("UNPARSED_VISIBLE_CELL")); row.appendChild(cell)
    } else if (variant === "unknown-header") table.getElementsByTagName("th")[0].textContent = "UNPARSED_HEADER"
    else table.getElementsByTagName("thead")[0].removeAttribute("class")
    assert.equal(snapshot(document.toString()).codeComparison, undefined, variant)
  }
})

test("serialized comparison consumes exactly the known changed and hunk row cells", () => {
  const baseline = snapshot()
  assert.equal(baseline.codeComparison.file_count, 4)
  assert.equal(baseline.codeComparison.additions, 33)
  assert.equal(baseline.codeComparison.deletions, 4)
  assert.ok(baseline.codeComparison.diff_text.includes("\n+\n"))
  for (const kind of ["changed", "hunk", "empty-expander"] as const) {
    for (const position of ["first", "last"] as const) {
      const document = new DOMParser({ onError: () => {} }).parseFromString(html, "application/xml") as unknown as Document
      const rows = Array.from(document.getElementsByTagName("tr"))
      const row = rows.find(r => kind === "changed" ? !!r.getAttribute("data-hunk") :
        Array.from(r.getElementsByTagName("td")).some(c => (c.getAttribute("class") || "").split(/\s+/).includes("blob-code-hunk")
          && (kind === "empty-expander" ? !(c.textContent || "").trim() : !!(c.textContent || "").trim())))!
      assert.ok(row)
      const extra = document.createElement("td")
      extra.appendChild(document.createTextNode("UNPARSED_VISIBLE_TD"))
      if (position === "first") row.insertBefore(extra, row.firstChild); else row.appendChild(extra)
      const captured = snapshot(document.toString())
      assert.equal(captured.codeComparison, undefined, `${kind}:${position}`)
      assert.equal(captured.comparisonRefusal, "HUNK_INCOMPLETE")
    }
  }
})
