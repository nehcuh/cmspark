import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { readPageHtml, readPageText } from "../src/background/page-read-tools"
import { PageSanitizer } from "../src/background/page-sanitizer"

test("page read result carries the actual channel, sanitized content and stable target", async () => {
  for (const channel of ["cdp", "isolated", "main"] as const) {
    const document = { body: { innerText: "Release PROD-1" }, querySelector: (selector: string) => {
      assert.equal(selector, "#release")
      return { outerHTML: '<section onclick="alert(1)">Release PROD-1<script>secret()</script></section>' }
    } }
    const deps = {
      tab: async () => ({ url: "https://user:secret@example.test/release?token=private#tab", title: "Release" }),
      evaluate: async (_id: number, expression: string, _html: unknown, report: (value: typeof channel) => void) => {
        report(channel)
        return { result: { value: vm.runInNewContext(expression, { document, location: { href: "https://user:secret@example.test/release?token=private#tab" } }) } }
      },
      outerHtml: async () => { throw new Error("unexpected fallback") }, sanitizer: new PageSanitizer(),
    }
    const text = await readPageText(7, deps)
    const html = await readPageHtml(7, "#release", deps)
    assert.equal(text.data.text, "Release PROD-1")
    assert.equal(text.data.provenance.channel, channel)
    assert.equal(html.data.source, "runtime")
    assert.equal(html.data.html, "<section>Release PROD-1</section>")
    assert.equal(html.data.provenance.capture_status, "eligible")
    assert.deepEqual(html.data.provenance.scope, { kind: "selector", selector: "#release" })
    assert.ok(!JSON.stringify(html).includes("secret"))
    assert.ok(!JSON.stringify(html).includes("private"))
    assert.equal((html.data as any).observation_id, undefined)
  }
})

test("DOM fallback keeps selector and explicit clipping; malformed text is not a successful empty read", async () => {
  const deps = {
    tab: async () => ({ url: "https://example.test/release" }),
    evaluate: async () => { throw new Error("unavailable") },
    outerHtml: async (_id: number, selector: string) => { assert.equal(selector, "#one"); return { content: "x".repeat(500000), url: "https://example.test/release" } },
    sanitizer: new PageSanitizer(),
  }
  const html = await readPageHtml(7, "#one", deps)
  assert.equal(html.data.provenance.channel, "dom")
  assert.equal(html.data.provenance.coverage, "partial")
  assert.equal(html.data.truncated, true)
  let error = ""
  try { await readPageText(7, { ...deps, evaluate: async () => ({ result: {} }) }) }
  catch (value) { error = (value as Error).message }
  assert.equal(error, "PAGE_READ_INVALID_RESULT")
})
