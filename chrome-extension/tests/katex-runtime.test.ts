import test from "node:test"
import assert from "node:assert/strict"
import katex from "katex"
import { Marked } from "marked"
import markedKatex from "marked-katex-extension"

test("patched KaTeX renders through the shipped Markdown extension", async () => {
  const marked = new Marked(markedKatex({ throwOnError: false, output: "html", nonStandard: true }))
  const html = await marked.parse("Inline $x^2$ and display:\n\n$$\n\\frac{1}{2}\n$$")
  assert.match(html, /class="katex"/)
  assert.match(html, /katex-display/)
  assert.doesNotMatch(html, /katex-error/)
})

test("inherited trust cannot enable unsafe KaTeX links", () => {
  const before = Object.getOwnPropertyDescriptor(Object.prototype, "trust")
  try {
    Object.defineProperty(Object.prototype, "trust", { configurable: true, writable: true, value: true })
    const formula = String.raw`\href{javascript:alert(1)}{link}`
    assert.match(katex.renderToString(formula, { trust: true, throwOnError: false, output: "html" }), /\bhref\s*=/)
    const html = katex.renderToString(formula, { throwOnError: false, output: "html" })
    assert.doesNotMatch(html, /\bhref\s*=/)
  } finally {
    if (before) Object.defineProperty(Object.prototype, "trust", before)
    else delete (Object.prototype as any).trust
  }
})
