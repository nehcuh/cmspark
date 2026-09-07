import test from "node:test"
import assert from "node:assert/strict"
import { readWithProvenance } from "../src/background/page-read-provenance"

test("read provenance preserves content but never invents collection completeness", async () => {
  const result = await readWithProvenance(4, { kind: "selector", selector: "#release" },
    async () => ({ url: "https://user:secret@example.com/release?token=private#one", title: "Release" }),
    async () => ({ content: "version 1", rawUrl: "https://user:secret@example.com/release?token=private#one", channel: "isolated", truncated: false, limit: 500000 }))
  assert.equal(result.payload.content, "version 1")
  assert.equal(result.provenance.channel, "isolated")
  assert.equal(result.provenance.target?.url, "https://example.com/release")
  assert.equal(result.provenance.capture_status, "eligible")
  assert.equal(result.provenance.coverage, "unknown")
  assert.equal(result.provenance.complete_for_scope, false)
  assert.equal(result.provenance.pagination, "unknown")
  assert.equal(result.provenance.virtualization, "unknown")
  assert.equal(result.provenance.iframe_coverage, "not_traversed")
  assert.ok(!JSON.stringify(result).includes("secret"))
  assert.ok(!JSON.stringify(result).includes("private"))
})

test("route changes during extraction cannot be attributed to either page", async () => {
  for (const changed of ["https://example.com/a?x=2#one", "https://example.com/a?x=1#two", "https://www.example.com/a?x=1#one"]) {
    let current = "https://example.com/a?x=1#one"
    const result = await readWithProvenance(4, { kind: "document" }, async () => ({ url: current }), async () => {
      current = changed
      return { content: "still available for ordinary read", rawUrl: current, channel: "cdp", truncated: false, limit: null }
    })
    assert.equal(result.provenance.capture_status, "TARGET_CHANGED")
    assert.equal(result.provenance.target, undefined)
    assert.equal(result.payload.content, "still available for ordinary read")
  }
})

test("missing target and clipping remain explicit and read errors propagate", async () => {
  const result = await readWithProvenance(4, { kind: "document" }, async () => { throw new Error("closed") },
    async () => ({ content: "prefix", channel: "dom", truncated: true, limit: 500000 }))
  assert.equal(result.provenance.capture_status, "TARGET_UNAVAILABLE")
  assert.equal(result.provenance.coverage, "partial")
  assert.equal(result.provenance.stop_reason, "CONTENT_LIMIT")
  assert.equal(result.provenance.target, undefined)
  let message = ""
  try {
    await readWithProvenance(4, { kind: "document" }, async () => ({ url: "https://example.com" }),
      async () => { throw new Error("read failed") })
  } catch (error) { message = (error as Error).message }
  assert.equal(message, "read failed")
})

test("a content snapshot from B is rejected even when both tab samples report A", async () => {
  const result = await readWithProvenance(4, { kind: "document" },
    async () => ({ url: "https://a.test/", title: "A" }),
    async () => ({ content: "B content", rawUrl: "https://b.test/", channel: "cdp", truncated: false, limit: null }))
  assert.equal(result.provenance.capture_status, "TARGET_CHANGED")
  assert.equal(result.provenance.target, undefined)
  assert.equal(result.provenance.title, "")
  assert.equal(result.payload.content, "B content")
  assert.equal((result.payload as any).rawUrl, undefined)
})

test("URL-shaped title reflections are redacted; unsampled content cannot be evidence-eligible", async () => {
  const result = await readWithProvenance(4, { kind: "document" },
    async () => ({ url: "https://example.test/?token=secret", title: "Page https://user:password@example.test/?token=secret#private" }),
    async () => ({ content: "page", rawUrl: "https://example.test/?token=secret", channel: "cdp", truncated: false, limit: null }))
  assert.equal(result.provenance.title, "Page https://example.test/")
  assert.ok(!JSON.stringify(result).includes("secret"))
  const missing = await readWithProvenance(4, { kind: "document" }, async () => ({ url: "https://example.test/" }),
    async () => ({ content: "legacy DOM", channel: "dom", truncated: false, limit: 500000 }))
  assert.equal(missing.provenance.capture_status, "TARGET_UNAVAILABLE")
  assert.equal(missing.payload.content, "legacy DOM")
})
