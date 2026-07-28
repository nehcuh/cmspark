// Pure hostname extraction for site-knowledge chat attach (no chrome APIs)
import test from "node:test"
import assert from "node:assert/strict"
import { hostnameFromTabUrl } from "../src/background/active-tab-hostname"

test("hostnameFromTabUrl accepts https and lowercases", () => {
  assert.equal(hostnameFromTabUrl("https://Example.com/path?q=1"), "example.com")
  assert.equal(hostnameFromTabUrl("http://api.github.com/"), "api.github.com")
})

test("hostnameFromTabUrl rejects non-http(s)", () => {
  assert.equal(hostnameFromTabUrl("chrome://extensions"), undefined)
  assert.equal(hostnameFromTabUrl("chrome-extension://abc/sidepanel.html"), undefined)
  assert.equal(hostnameFromTabUrl("about:blank"), undefined)
  assert.equal(hostnameFromTabUrl("file:///tmp/x"), undefined)
  assert.equal(hostnameFromTabUrl(""), undefined)
  assert.equal(hostnameFromTabUrl(null), undefined)
})

test("hostnameFromTabUrl strips trailing dots", () => {
  assert.equal(hostnameFromTabUrl("https://example.com./x"), "example.com")
})
