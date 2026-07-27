// Pure helpers for L1 ContextStrip — no chrome APIs

import test from "node:test"
import assert from "node:assert/strict"
import {
  formatTabHost,
  formatTabLabel,
} from "../src/sidepanel/components/ContextStrip"

test("formatTabLabel prefers title", () => {
  assert.equal(formatTabLabel({ title: "Example Domain", url: "https://example.com" }), "Example Domain")
})

test("formatTabLabel truncates long titles", () => {
  const long = "A".repeat(60)
  const out = formatTabLabel({ title: long })
  assert.ok(out.endsWith("…"))
  assert.ok(out.length <= 48)
})

test("formatTabLabel falls back to hostname", () => {
  assert.equal(formatTabLabel({ title: "", url: "https://docs.example.com/path" }), "docs.example.com")
})

test("formatTabLabel falls back to tab id", () => {
  assert.equal(formatTabLabel({ id: 42 }), "标签 42")
})

test("formatTabHost extracts hostname", () => {
  assert.equal(formatTabHost("https://www.example.com/x"), "www.example.com")
  assert.equal(formatTabHost("chrome://extensions"), "chrome")
  assert.equal(formatTabHost(null), null)
  assert.equal(formatTabHost("not-a-url"), null)
})
