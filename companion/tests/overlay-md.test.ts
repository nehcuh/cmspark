import test from "node:test"
import assert from "node:assert/strict"
import { OVERLAY_RENDER_MD_JS } from "../src/summoner/overlay-md"

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function loadRender(): (src: string) => string {
  const fn = new Function("esc", OVERLAY_RENDER_MD_JS + "\nreturn renderMd")
  return fn(esc) as (src: string) => string
}

test("overlay markdown source parses", () => {
  assert.doesNotThrow(() => new Function(OVERLAY_RENDER_MD_JS))
})

test("overlay markdown renders bold, italic, code, lists, headings", () => {
  const renderMd = loadRender()
  const html = renderMd("# Hi\n\n**bold** and *em* and `code`\n\n- a\n- b\n\n1. one")
  assert.match(html, /<h1>Hi<\/h1>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>em<\/em>/)
  assert.match(html, /<code>code<\/code>/)
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/)
  assert.match(html, /<ol><li>one<\/li><\/ol>/)
})

test("overlay markdown escapes HTML and drops javascript links", () => {
  const renderMd = loadRender()
  const html = renderMd('<script>alert(1)</script>\n[x](javascript:alert(1))\n[ok](https://example.com)')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.match(html, /<a href="https:\/\/example.com"/)
})

test("overlay markdown keeps fenced code escaped", () => {
  const renderMd = loadRender()
  const html = renderMd("```js\nconst x = \"<b>\"\n```")
  assert.match(html, /<pre><code>/)
  assert.match(html, /&lt;b&gt;/)
  assert.doesNotMatch(html, /<b>/)
})

test("overlay markdown does not break out of href with quote in URL", () => {
  const renderMd = loadRender()
  const html = renderMd('[x](https://evil/"onclick="alert(1))')
  assert.match(html, /<a href="https:\/\/evil\/&quot;onclick=&quot;alert\(1"/)
  assert.doesNotMatch(html, /\sonclick=/i)
  assert.doesNotMatch(html, /href="https:\/\/evil\/"/)
  const href = html.match(/href="([^"]*)"/)
  if (href) assert.doesNotMatch(href[1], /"/)
})

test("overlay markdown query ampersand is a single HTML escape", () => {
  const renderMd = loadRender()
  const html = renderMd("[ok](https://example.com/?a=1&b=2)")
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/)
  assert.doesNotMatch(html, /&amp;amp;/)
})
